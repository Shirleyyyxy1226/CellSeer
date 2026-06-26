#!/usr/bin/env python3
"""
tree_utils.py — parse, analyse, and tree-building logic ported from treeUtils.ts
Pure logic; no DOM/UI. Produces JSON-serializable structures for frontend or API use.
"""

from __future__ import annotations

import csv
import re
from dataclasses import dataclass, field
from typing import Any

# ── Config (override via AnalysisConfig) ────────────────────────────────
@dataclass(frozen=True)
class AnalysisConfig:
    """Configurable keywords and thresholds. Pass to analyse_columns/build_tree."""
    notes_kw: frozenset[str] = field(default_factory=lambda: frozenset(("notes", "comments", "remarks", "description")))
    nonstd_kw: frozenset[str] = field(default_factory=lambda: frozenset(("extra", "repeat", "control", "spare", "duplicate")))
    replicate_kw: frozenset[str] = field(default_factory=lambda: frozenset(("repeat", "replicate", "rep", "run", "trial")))
    vol_kw: frozenset[str] = field(default_factory=lambda: frozenset(("ul", "µl", "ml", "volume", "vol")))
    spacer_kw: frozenset[str] = field(default_factory=lambda: frozenset(("spacer", "space", "gap", "thick")))
    leaf_avg_len_max: float = 22.0
    coverage_min: float = 0.5
    constant_coverage_min: float = 0.8
    max_card_default: int = 5
    card_ratio: float = 0.25
    unknown_placeholder: str = "(unknown)"
    tbc_placeholder: str = "TBC"
    root_label: str = "Root"


DEFAULT_CONFIG = AnalysisConfig()


# ── Types ─────────────────────────────────────────────────────────────
@dataclass
class ParsedCSV:
    headers: list[str]
    rows: list[list[str]]


@dataclass
class ColStats:
    j: int
    header: str
    cardinality: int
    coverage: float
    distinct_vals: list[str]
    all_vals: list[str]
    avg_len: float
    is_notes: bool
    is_replicate: bool
    is_numeric: bool
    has_nonstd_val: bool


@dataclass
class Annotation:
    col: int
    header: str
    unit: str
    map: dict[str, str]


@dataclass
class LabelDecoration:
    prefix: str
    suffix: str


@dataclass
class HierVal:
    name: str
    val: str
    disp: str


@dataclass
class TreeNode:
    label: str
    raw_val: str
    depth: int
    is_leaf: bool
    children: list["TreeNode"]
    col_header: str | None = None
    is_tbc: bool = False
    is_non_std: bool = False
    row_data: list[str] | None = None
    cell_id: str | None = None
    hier_vals: list[HierVal] | None = None
    x: float | None = None
    y: float | None = None


@dataclass
class AnalysisResult:
    leaf_col: int
    row_id_col: int
    flag_col: int
    root_label_col_idx: int
    root_label_val: str
    hier_cols: list[ColStats]
    annotations: list[Annotation | None]
    label_decorations: list[LabelDecoration]
    redundant_js: set[int]
    excluded_js: set[int]
    stats: list[ColStats]
    n: int
    headers: list[str]
    all_constants: list[ColStats]
    all_candidates: list[ColStats]


# ── CSV parser ────────────────────────────────────────────────────────
import csv as _csv
import io as _io


def _parse_csv_line(line: str) -> list[str]:
    return next(_csv.reader(_io.StringIO(line)), [])


def parse_csv(raw: str) -> ParsedCSV:
    """Parse raw CSV string into headers and rows."""
    lines = [l.strip() for l in raw.strip().split("\n") if l.strip()]
    if not lines:
        return ParsedCSV(headers=[], rows=[])
    return ParsedCSV(
        headers=_parse_csv_line(lines[0]),
        rows=[_parse_csv_line(l) for l in lines[1:]],
    )


def parse_csv_file(path: str | None = None, fileobj: Any = None) -> ParsedCSV:
    """Parse CSV from file path or file-like object."""
    if fileobj is not None:
        reader = csv.reader(fileobj)
        rows = list(reader)
    elif path:
        with open(path, newline="", encoding="utf-8-sig") as f:
            reader = csv.reader(f)
            rows = list(reader)
    else:
        raise ValueError("Provide path or fileobj")
    rows = [r for r in rows if any(c.strip() for c in r)]
    if not rows:
        return ParsedCSV(headers=[], rows=[])
    headers = [h.strip() for h in rows[0]]
    data = [[c.strip() for c in row] for row in rows[1:]]
    return ParsedCSV(headers=headers, rows=data)


# ── Column helpers ────────────────────────────────────────────────────
def _is_float(s: str) -> bool:
    if not s:
        return False
    try:
        float(s)
        return True
    except ValueError:
        return False


def _is_numeric_col(distinct_vals: list[str]) -> bool:
    return len(distinct_vals) > 0 and all(_is_float(v) for v in distinct_vals)


def _col_determines(a_vals: list[str], b_vals: list[str]) -> bool:
    mapping: dict[str, str] = {}
    for i, a in enumerate(a_vals):
        b = b_vals[i] if i < len(b_vals) else ""
        if not a or not b:
            continue
        if a in mapping:
            if mapping[a] != b:
                return False
        else:
            mapping[a] = b
    return True


def unit_from_header(h: str, config: AnalysisConfig = DEFAULT_CONFIG) -> str:
    lc = h.lower()
    if any(k in lc for k in config.vol_kw):
        return "μL"
    if "_mm" in lc or "(mm)" in lc:
        return "mm"
    if "mg" in lc:
        return "mg"
    return ""


def prefix_from_header(h: str, config: AnalysisConfig = DEFAULT_CONFIG) -> str:
    lc = h.lower()
    if any(k in lc for k in config.spacer_kw):
        return "Sp "
    return ""


def _norm_header(h: str) -> str:
    """Case/underscore/punctuation-insensitive header key (matches build_tree's
    norm_header) so 'Spacer_mm' and 'spacer (mm)' both reduce to 'spacermm'."""
    return re.sub(r"[^a-z0-9]+", "", h.lower())


# Default-hierarchy priority: physical/chemical DESIGN parameters first (the
# analytically meaningful build), organisational labels (category/batch/repeat)
# last. Lower number = higher priority. Matched on a normalised header, so the
# first substring that appears in the column header wins.
_DESIGN_PRIORITY: list[str] = [
    "cathode",
    "anode",
    "separator",
    "spacer",
    "electrolyte",
    "npratio",
    "cathodemass",
    "anodemass",
    "cathodediameter",
    "anodediameter",
    "electrolytevolume",
]


def design_priority(header: str) -> int:
    """Sort priority for the DEFAULT hierarchy. Design-parameter columns sort
    first by their position in _DESIGN_PRIORITY; everything else (organisational
    labels such as Category / Batch / Repeat) shares the lowest priority and so
    keeps its column-index order among itself."""
    norm = _norm_header(header)
    best = len(_DESIGN_PRIORITY)
    for i, key in enumerate(_DESIGN_PRIORITY):
        if key in norm:
            best = min(best, i)
    return best


# ── Annotation finder ─────────────────────────────────────────────────
def compute_annotations(
    hier_cols: list[ColStats],
    stats: list[ColStats],
    redundant_js: set[int],
    excluded_js: set[int],
    n: int,
    config: AnalysisConfig = DEFAULT_CONFIG,
) -> list[Annotation | None]:
    max_card = max(config.max_card_default, int(n * config.card_ratio))
    result: list[Annotation | None] = []
    for hc in hier_cols:
        search_pool: list[ColStats] = []
        for s in stats:
            if s.j in redundant_js:
                search_pool.append(s)
        for s in stats:
            if (
                s.j not in redundant_js
                and s.j != hc.j
                and s.j not in excluded_js
                and s.is_numeric
                and 1 < s.cardinality <= max_card
            ):
                search_pool.append(s)
        ann = None
        for s in search_pool:
            if s.cardinality <= 1:
                continue
            if _col_determines(hc.all_vals, s.all_vals):
                val_map: dict[str, str] = {}
                for i, a in enumerate(hc.all_vals):
                    if a and i < len(s.all_vals) and s.all_vals[i]:
                        val_map[a] = s.all_vals[i]
                ann = Annotation(
                    col=s.j,
                    header=s.header,
                    unit=unit_from_header(s.header, config),
                    map=val_map,
                )
                break
        result.append(ann)
    return result


# ── Column analysis ───────────────────────────────────────────────────
def analyse_columns(
    headers: list[str],
    rows: list[list[str]],
    max_levels: int = 4,
    config: AnalysisConfig = DEFAULT_CONFIG,
) -> AnalysisResult:
    n = len(rows)

    def cell(r: list[str], j: int) -> str:
        return (r[j].strip() if j < len(r) else "")

    stats: list[ColStats] = []
    for j, h in enumerate(headers):
        vals = [cell(r, j) for r in rows]
        nonempty = [v for v in vals if v]
        uniq = sorted(set(nonempty))
        avg_len = sum(len(v) for v in nonempty) / len(nonempty) if nonempty else 0
        lc = h.lower()
        stats.append(
            ColStats(
                j=j,
                header=h,
                cardinality=len(uniq),
                coverage=len(nonempty) / n if n > 0 else 0,
                distinct_vals=uniq,
                all_vals=vals,
                avg_len=avg_len,
                is_notes=any(k in lc for k in config.notes_kw),
                is_replicate=any(k in lc for k in config.replicate_kw),
                is_numeric=_is_numeric_col(uniq),
                has_nonstd_val=any(
                    any(k in v.lower() for k in config.nonstd_kw) for v in nonempty
                ),
            )
        )

    # Leaf label: rightmost short non-notes non-constant column
    leaf_col = -1
    for j in range(len(headers) - 1, -1, -1):
        s = stats[j]
        if s.is_notes or s.avg_len > config.leaf_avg_len_max or s.coverage < config.coverage_min or s.cardinality <= 1:
            continue
        leaf_col = j
        break

    # Row identifier: fully unique
    row_id_col = next(
        (s.j for s in stats if s.cardinality == n and s.coverage >= 0.9),
        -1,
    )

    # Flag column
    flag_col = next(
        (
            s.j
            for s in stats
            if s.has_nonstd_val
            and s.j != leaf_col
            and s.j != row_id_col
            and s.cardinality <= max(config.max_card_default, n // 4)
        ),
        -1,
    )

    # Root label
    constants = [s for s in stats if s.cardinality == 1 and s.coverage >= config.constant_coverage_min]
    root_label_col = next(
        (s for s in constants if not s.is_notes and not s.is_numeric),
        None,
    )
    if not root_label_col:
        root_label_col = next((s for s in constants if not s.is_notes), None)
    root_label_col_idx = root_label_col.j if root_label_col else -1
    root_label_val = ""
    if root_label_col:
        for r in rows:
            v = cell(r, root_label_col.j)
            if v:
                root_label_val = v
                break

    excluded_js = {j for j in (leaf_col, row_id_col, flag_col) if j >= 0}

    def is_candidate(s: ColStats) -> bool:
        if s.j in excluded_js:
            return False
        if s.is_notes or s.is_replicate:
            return False
        if s.cardinality <= 1 or s.cardinality >= n:
            return False
        if s.coverage < config.coverage_min:
            return False
        if s.cardinality > max(config.max_card_default, int(n * config.card_ratio)):
            return False
        return True

    candidates = [s for s in stats if is_candidate(s)]
    if not candidates:
        # Small / sparse projects (only a few cells, or columns with missing
        # values) can fail every threshold above, leaving the hierarchy-order
        # picker empty. Fall back to any usable column (not a leaf / id / flag
        # column, not notes / replicate, with at least 2 distinct values) so the
        # picker still offers dimensions to reorder and add.
        candidates = [
            s
            for s in stats
            if s.j not in excluded_js
            and not s.is_notes
            and not s.is_replicate
            and s.cardinality > 1
        ]
    string_cands = [s for s in candidates if not s.is_numeric]
    numeric_cands = [s for s in candidates if s.is_numeric]

    redundant_js = set()
    for nc in numeric_cands:
        for sc in string_cands:
            if _col_determines(sc.all_vals, nc.all_vals):
                redundant_js.add(nc.j)
                break

    non_redundant_numerics = [s for s in numeric_cands if s.j not in redundant_js]
    # Default hierarchy ordering: DESIGN-PARAMETER columns (cathode, separator,
    # spacer, electrolyte, …) sort first by their design priority, organisational
    # labels (category / batch / repeat) sort last and keep column-index order.
    # String-before-numeric is preserved as a secondary tie-break so categorical
    # design dimensions still lead the numeric ones at the same priority.
    ordered = sorted(
        string_cands + non_redundant_numerics,
        key=lambda s: (design_priority(s.header), 0 if not s.is_numeric else 1, s.j),
    )

    # Candidates for the hierarchy-order PICKER (drag-to-reorder / click-to-add).
    # Broader than `ordered`: it must also include the leaf / id / flag columns,
    # because those appear in the ACTIVE hierarchy and the editor needs them to
    # render and reorder the active chips; plus any column the strict
    # is_candidate rejected (common on tiny projects). `ordered` still seeds the
    # DEFAULT levels; this only widens what the user can pick from.
    ordered_js = {s.j for s in ordered}
    picker_extra = [
        s
        for s in stats
        if s.j not in ordered_js
        and not s.is_notes
        and not s.is_replicate
        and s.cardinality >= 1
    ]
    picker_candidates = ordered + sorted(picker_extra, key=lambda s: s.j)

    hier_cols = ordered[:max_levels]
    # Fallback: on fully-uniform / tiny projects `ordered` can be empty, leaving
    # the ORDER control blank. Seed one level from picker_extra (prefer any
    # non-excluded column with cardinality > 1; settle for a constant column if
    # that is all that exists) so the user always sees at least a flat cell list.
    if not hier_cols:
        seed = next(
            (s for s in picker_extra if s.j not in excluded_js and s.cardinality > 1),
            next((s for s in picker_extra if s.j not in excluded_js), None),
        )
        if seed:
            hier_cols = [seed]

    annotations = compute_annotations(
        hier_cols, stats, redundant_js, excluded_js, n, config
    )
    label_decorations = [
        LabelDecoration(
            prefix=prefix_from_header(hc.header, config),
            suffix=unit_from_header(hc.header, config),
        )
        for hc in hier_cols
    ]

    return AnalysisResult(
        leaf_col=leaf_col,
        row_id_col=row_id_col,
        flag_col=flag_col,
        root_label_col_idx=root_label_col_idx,
        root_label_val=root_label_val,
        hier_cols=hier_cols,
        annotations=annotations,
        label_decorations=label_decorations,
        redundant_js=redundant_js,
        excluded_js=excluded_js,
        stats=stats,
        n=n,
        headers=headers,
        all_constants=constants,
        all_candidates=picker_candidates,
    )


# ── Build active analysis from user-selected column order ─────────────
def build_active_analysis(
    base: AnalysisResult,
    column_order: list[int],
    config: AnalysisConfig = DEFAULT_CONFIG,
) -> AnalysisResult:
    stats_by_j = {s.j: s for s in base.stats}
    hier_cols = [stats_by_j[j] for j in column_order if j in stats_by_j]
    return AnalysisResult(
        leaf_col=base.leaf_col,
        row_id_col=base.row_id_col,
        flag_col=base.flag_col,
        root_label_col_idx=base.root_label_col_idx,
        root_label_val=base.root_label_val,
        hier_cols=hier_cols,
        annotations=compute_annotations(
            hier_cols, base.stats, base.redundant_js, base.excluded_js, base.n, config
        ),
        label_decorations=[
            LabelDecoration(
                prefix=prefix_from_header(hc.header, config),
                suffix=unit_from_header(hc.header, config),
            )
            for hc in hier_cols
        ],
        redundant_js=base.redundant_js,
        excluded_js=base.excluded_js,
        stats=base.stats,
        n=base.n,
        headers=base.headers,
        all_constants=base.all_constants,
        all_candidates=base.all_candidates,
    )


# ── Format node label ─────────────────────────────────────────────────
def format_node_label(
    raw_val: str,
    level_idx: int,
    annotations: list[Annotation | None],
    label_decorations: list[LabelDecoration],
) -> str:
    dec = label_decorations[level_idx] if level_idx < len(label_decorations) else None
    ann = annotations[level_idx] if level_idx < len(annotations) else None
    label = raw_val
    if dec and (dec.prefix or dec.suffix):
        try:
            num = float(raw_val)
            formatted = f"{num:.1f}"
        except ValueError:
            formatted = raw_val
        label = (dec.prefix + formatted + (f" {dec.suffix}" if dec.suffix else "")).strip()
    if ann and raw_val in ann.map:
        ann_val = ann.map[raw_val]
        unit_str = "\u202F" + ann.unit if ann.unit else ""
        label += " \u00B7 " + ann_val + unit_str
    return label


# ── Tree builder ──────────────────────────────────────────────────────
def build_tree(
    rows: list[list[str]],
    analysis: AnalysisResult,
    config: AnalysisConfig = DEFAULT_CONFIG,
) -> TreeNode:
    leaf_col = analysis.leaf_col
    row_id_col = analysis.row_id_col
    flag_col = analysis.flag_col
    hier_cols = analysis.hier_cols
    annotations = analysis.annotations
    label_decorations = analysis.label_decorations

    def cell(r: list[str], j: int) -> str:
        return (r[j].strip() if 0 <= j < len(r) else "")

    def norm_header(s: str) -> str:
        return re.sub(r"[^a-z0-9]+", "", s.lower())

    headers = analysis.headers or []
    by_norm = {norm_header(h): i for i, h in enumerate(headers)}

    def find_header_idx(aliases: list[str]) -> int:
        for a in aliases:
            idx = by_norm.get(norm_header(a))
            if idx is not None:
                return idx
        return -1

    id_no_col = find_header_idx(["ID no.", "ID no", "id_no", "ID_NO"])
    cell_id_col = find_header_idx(["Cell_ID", "Cell ID", "CellID"])
    cathode_col = find_header_idx(["Cathode"])
    anode_col = find_header_idx(["Anode"])

    root = TreeNode(label=config.root_label, raw_val=config.root_label, depth=0, children=[], is_leaf=False)

    for row in rows:
        node = root
        for lvl, col in enumerate(hier_cols):
            raw_val = cell(row, col.j) or config.unknown_placeholder
            disp_label = format_node_label(
                raw_val, lvl, annotations, label_decorations
            )
            child = None
            for c in node.children:
                if not c.is_leaf and c.raw_val == raw_val:
                    child = c
                    break
            if not child:
                child = TreeNode(
                    label=disp_label,
                    raw_val=raw_val,
                    depth=lvl + 1,
                    col_header=col.header,
                    children=[],
                    is_leaf=False,
                )
                node.children.append(child)
            node = child

        id_val = cell(row, leaf_col) if leaf_col >= 0 else ""
        id_no_val = cell(row, id_no_col) if id_no_col >= 0 else ""
        leaf_label = id_no_val or id_val or config.tbc_placeholder
        is_tbc = not (id_no_val or id_val)
        cell_id = cell(row, row_id_col) if row_id_col >= 0 else ""
        # Display label for leaf: "id_no_cathode_anode", skipping missing parts.
        leaf_name_parts = [
            id_no_val,
            cell(row, cathode_col) if cathode_col >= 0 else "",
            cell(row, anode_col) if anode_col >= 0 else "",
        ]
        leaf_display_label = "_".join([p for p in leaf_name_parts if p]) or leaf_label
        flag_val = cell(row, flag_col) if flag_col >= 0 else ""
        is_non_std = any(
            k in flag_val.lower() for k in config.nonstd_kw
        ) or (
            not flag_val
            and any(
                any(k in v.lower() for k in config.nonstd_kw)
                for v in row
            )
        )

        leaf = TreeNode(
            label=leaf_display_label,
            raw_val=leaf_label,
            depth=len(hier_cols) + 1,
            is_leaf=True,
            is_tbc=is_tbc,
            is_non_std=is_non_std,
            row_data=row,
            cell_id=cell_id,
            children=[],
            hier_vals=[
                HierVal(
                    name=col.header,
                    val=cell(row, col.j),
                    disp=format_node_label(
                        cell(row, col.j), i, annotations, label_decorations
                    ),
                )
                for i, col in enumerate(hier_cols)
            ],
        )
        node.children.append(leaf)

    return root


# ── Colour assignment ─────────────────────────────────────────────────
LEVEL_PALETTES: list[list[str]] = [
    ["#c24a3a", "#d07848", "#2a9d8f", "#6c3483", "#b7410e", "#2471a3"],
    ["#4a7cbf", "#7952a3", "#2e8b72", "#c06030", "#5a7a32", "#8b4060"],
    ["#2d7869", "#9a8230", "#5a6ea0", "#a04828", "#3a8a50", "#7a4868"],
    ["#3a6e88", "#8a6030", "#4a8860", "#924060", "#5a7050", "#6a5090"],
]

HIGH_CONTRAST_PALETTE: list[str] = [
    "#e41a1c", "#4daf4a", "#377eb8", "#ff7f00", "#984ea3", "#a65628", "#f781bf", "#999999",
]

GOLDEN_ANGLE_DEG = 137.508


def _hash_string(s: str) -> int:
    h = 5381
    for c in s:
        h = ((h << 5) + h) + ord(c)
    return h & 0xFFFFFFFF


def _hsl_to_hex(h: float, s: float, l: float) -> str:
    s /= 100
    l /= 100
    a = s * min(l, 1 - l)

    def f(n: float) -> float:
        k = (n + h / 30) % 12
        return l - a * max(-1, min(k - 3, 9 - k, 1))

    r = round(f(0) * 255)
    g = round(f(8) * 255)
    b = round(f(4) * 255)
    return f"#{r:02x}{g:02x}{b:02x}"


def string_to_color(path_str: str) -> str:
    """Map path string to colour. Cell level (4 parts) uses golden angle for separation."""
    parts = path_str.split("|")
    if len(parts) == 4:
        last = parts[3]
        import re
        m = re.match(r"^(?:Cell\s*)?(\d+)$", last)
        if m:
            cell_num = int(m.group(1))
            hue = (cell_num * GOLDEN_ANGLE_DEG) % 360
            return _hsl_to_hex(hue, 75, 50)
    h = _hash_string(path_str)
    hue = (h * 0.618033988749895) % 360
    return _hsl_to_hex(hue, 72, 52)


def leaf_key_to_color(leaf_key: str) -> str:
    """Map a leaf identity string to a stable color (independent of hierarchy path)."""
    import re

    m = re.search(r"(\d+)", leaf_key)
    if m:
        cell_num = int(m.group(1))
        hue = (cell_num * GOLDEN_ANGLE_DEG) % 360
        return _hsl_to_hex(hue, 75, 50)
    h = _hash_string(leaf_key)
    hue = (h * 0.618033988749895) % 360
    return _hsl_to_hex(hue, 72, 52)


def assign_colour_map(hier_cols: list[ColStats]) -> list[dict[str, str]]:
    """Level → value → hex. Positional palette per level, no chemistry-specific mapping."""
    result = []
    for lvl, col in enumerate(hier_cols):
        palette = LEVEL_PALETTES[min(lvl, len(LEVEL_PALETTES) - 1)]
        m: dict[str, str] = {}
        for pi, v in enumerate(col.distinct_vals):
            m[v] = palette[pi % len(palette)]
        result.append(m)
    return result


def assign_colour_map_perceptual(hier_cols: list[ColStats]) -> list[dict[str, str]]:
    """High-contrast palette for tree/plot matching."""
    return [
        {v: HIGH_CONTRAST_PALETTE[i % len(HIGH_CONTRAST_PALETTE)] for i, v in enumerate(col.distinct_vals)}
        for col in hier_cols
    ]


def _collect_paths(node: TreeNode, path_parts: list[str]) -> list[str]:
    """Collect all path keys from root to each leaf."""
    out: list[str] = []
    if node.is_leaf:
        key = "|".join(path_parts)
        if key:
            out.append(key)
        return out
    for c in node.children:
        if c.is_leaf:
            key = "|".join(path_parts + [c.raw_val])
            if key:
                out.append(key)
        else:
            out.extend(_collect_paths(c, path_parts + [c.raw_val]))
    return out


def build_path_to_color_map(
    tree: TreeNode,
    colour_maps: list[dict[str, str]],
    hier_cols: list[ColStats],
) -> dict[str, str]:
    """Path key → hex for hierarchy levels only (exclude individual cell leaf paths)."""
    paths = _collect_paths(tree, [])
    result: dict[str, str] = {}
    # Add only prefix paths (L1, L1|L2, L1|L2|L3...), never full leaf path.
    seen_prefixes: set[str] = set()
    for path in paths:
        parts = path.split("|")
        for i in range(1, len(parts)):
            pref = "|".join(parts[:i])
            if pref and pref not in seen_prefixes:
                seen_prefixes.add(pref)
                if i - 1 < len(colour_maps) and parts[i - 1] in colour_maps[i - 1]:
                    result[pref] = colour_maps[i - 1][parts[i - 1]]
    return result


# ── JSON serialization ────────────────────────────────────────────────
def _col_stats_to_dict(s: ColStats) -> dict:
    return {
        "j": s.j,
        "header": s.header,
        "cardinality": s.cardinality,
        "coverage": s.coverage,
        "distinctVals": s.distinct_vals,
        "allVals": s.all_vals,
        "avgLen": s.avg_len,
        "isNotes": s.is_notes,
        "isReplicate": s.is_replicate,
        "isNumeric": s.is_numeric,
        "hasNonstdVal": s.has_nonstd_val,
    }


def _tree_node_to_dict(node: TreeNode) -> dict:
    d: dict = {
        "label": node.label,
        "rawVal": node.raw_val,
        "depth": node.depth,
        "isLeaf": node.is_leaf,
        "children": [_tree_node_to_dict(c) for c in node.children],
    }
    if node.col_header is not None:
        d["colHeader"] = node.col_header
    if node.is_leaf:
        if node.is_tbc:
            d["isTBC"] = True
        if node.is_non_std:
            d["isNonStd"] = True
        if node.row_data is not None:
            d["rowData"] = node.row_data
        if node.cell_id:
            d["cellId"] = node.cell_id
        if node.hier_vals:
            d["hierVals"] = [
                {"name": v.name, "val": v.val, "disp": v.disp}
                for v in node.hier_vals
            ]
    if node.x is not None:
        d["x"] = node.x
    if node.y is not None:
        d["y"] = node.y
    return d


def analysis_to_dict(analysis: AnalysisResult) -> dict:
    """Convert AnalysisResult to a JSON-serializable dict (camelCase for frontend)."""
    return {
        "leafCol": analysis.leaf_col,
        "rowIdCol": analysis.row_id_col,
        "flagCol": analysis.flag_col,
        "rootLabelColIdx": analysis.root_label_col_idx,
        "rootLabelVal": analysis.root_label_val,
        "hierCols": [_col_stats_to_dict(c) for c in analysis.hier_cols],
        "annotations": [
            {
                "col": a.col,
                "header": a.header,
                "unit": a.unit,
                "map": a.map,
            }
            if a
            else None
            for a in analysis.annotations
        ],
        "labelDecorations": [
            {"prefix": ld.prefix, "suffix": ld.suffix}
            for ld in analysis.label_decorations
        ],
        "redundantJs": list(analysis.redundant_js),
        "excludedJs": list(analysis.excluded_js),
        "stats": [_col_stats_to_dict(s) for s in analysis.stats],
        "N": analysis.n,
        "headers": analysis.headers,
        "allConstants": [_col_stats_to_dict(c) for c in analysis.all_constants],
        "allCandidates": [_col_stats_to_dict(c) for c in analysis.all_candidates],
    }


def tree_to_dict(root: TreeNode) -> dict:
    """Convert TreeNode to a JSON-serializable dict (camelCase for frontend)."""
    return _tree_node_to_dict(root)


def parse_analyse_build(
    csv_raw: str | None = None,
    csv_path: str | None = None,
    max_levels: int = 4,
    config: AnalysisConfig = DEFAULT_CONFIG,
) -> tuple[ParsedCSV, AnalysisResult, TreeNode]:
    """
    Convenience: parse CSV, run analysis, build tree.
    Provide csv_raw (string) or csv_path (file path).
    """
    if csv_raw is not None:
        parsed = parse_csv(csv_raw)
    elif csv_path is not None:
        parsed = parse_csv_file(path=csv_path)
    else:
        raise ValueError("Provide csv_raw or csv_path")
    analysis = analyse_columns(parsed.headers, parsed.rows, max_levels=max_levels, config=config)
    tree = build_tree(parsed.rows, analysis, config=config)
    return parsed, analysis, tree
