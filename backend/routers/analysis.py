"""Hierarchy analysis endpoints."""

import json
import re
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_db
from project_scope import normalize_project_id
from tree_utils import (
    analyse_columns,
    assign_colour_map,
    assign_colour_map_perceptual,
    build_active_analysis,
    build_path_to_color_map,
    build_tree,
    analysis_to_dict,
    parse_csv,
    tree_to_dict,
)

router = APIRouter()


class AnalyseRequest(BaseModel):
    csvText: str
    maxLevels: int = 4
    columnOrder: Optional[List[int]] = None
    # Column indices to keep out of the default-tree auto-pick (dynamic
    # metadata). Echoed by /api/hierarchy so reorder/reset stays consistent.
    extraCols: Optional[List[int]] = None


class HierarchyOrderRequest(BaseModel):
    order: List[int]


@router.get("/api/health")
def health():
    return {"status": "ok"}


def _cell_number_token(cell_id: Optional[str]) -> Optional[int]:
    if not cell_id:
        return None
    m = re.search(r"(?:^|[^a-z0-9])(?:cel|cell)[-_ ]*(\d+)(?:[^a-z0-9]|$)", cell_id, flags=re.IGNORECASE)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None


def _row_custom_meta(r: dict) -> dict[str, str]:
    """Parse a cell row's ``custom_meta`` JSON blob into a flat string map.

    Returns an empty dict when the column is absent, null, or unparseable, so
    callers can treat every cell uniformly.
    """
    try:
        raw = r["custom_meta"]
    except (KeyError, IndexError, TypeError):
        return {}
    if not raw:
        return {}
    if isinstance(raw, (bytes, bytearray)):
        try:
            raw = raw.decode("utf-8")
        except Exception:
            return {}
    parsed = raw if isinstance(raw, dict) else None
    if parsed is None:
        try:
            parsed = json.loads(raw)
        except Exception:
            return {}
    if not isinstance(parsed, dict):
        return {}
    return {str(k): str(v) for k, v in parsed.items() if v not in (None, "")}


def _dedupe_rows_for_hierarchy(rows: list[dict]) -> list[dict]:
    """Remove duplicate cells, preferring rows with id_no set."""
    out: dict[object, dict] = {}

    def score(r: dict) -> tuple[int, int]:
        has_id_no = 1 if r["id_no"] is not None else 0
        prefixed = 1 if (r["cell_id"] and str(r["cell_id"]).upper().startswith("P")) else 0
        return (has_id_no, prefixed)

    for r in rows:
        token = _cell_number_token(r["cell_id"])
        key: object = token if token is not None else f"cell_id::{r['cell_id']}"
        if key not in out or score(r) > score(out[key]):
            out[key] = r
    return list(out.values())


def _analyse_from_headers_rows(
    headers: list[str],
    rows: list[list[str]],
    max_levels: int,
    column_order: Optional[List[int]],
    extra_cols: Optional[set[int]] = None,
):
    if not headers or not rows:
        raise HTTPException(status_code=400, detail="CSV appears empty")
    analysis = analyse_columns(
        headers, rows, max_levels=max_levels, extra_cols=frozenset(extra_cols or ())
    )
    if column_order:
        analysis = build_active_analysis(analysis, column_order)
    tree = build_tree(rows, analysis)
    colour_maps = assign_colour_map(analysis.hier_cols)
    colour_maps_perceptual = assign_colour_map_perceptual(analysis.hier_cols)
    path_to_color = build_path_to_color_map(tree, colour_maps, analysis.hier_cols)
    path_to_color_perceptual = build_path_to_color_map(
        tree, colour_maps_perceptual, analysis.hier_cols
    )
    return {
        "parsed": {"headers": headers, "rows": rows},
        "analysis": analysis_to_dict(analysis),
        "tree": tree_to_dict(tree),
        "colourMaps": colour_maps,
        "colourMapsPerceptual": colour_maps_perceptual,
        "pathToColorMap": path_to_color,
        "pathToColorMapPerceptual": path_to_color_perceptual,
        # Opt-in dynamic-metadata columns: excluded from the default tree but
        # offered in the level picker. Echoed so re-analyse (reorder / reset)
        # keeps the same exclusion on the POST path.
        "extraCols": sorted(extra_cols or ()),
    }


@router.post("/api/hierarchy/analyse")
def analyse(req: AnalyseRequest):
    try:
        parsed = parse_csv(req.csvText.strip())
        return _analyse_from_headers_rows(
            parsed.headers,
            parsed.rows,
            max_levels=req.maxLevels,
            column_order=req.columnOrder,
            extra_cols=set(req.extraCols or ()),
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


def _normalize_project_key(project_key: Optional[str]) -> str:
    value = (project_key or "").strip()
    if not value:
        return "default"
    return value[:160]


def _preference_storage_key(pref_name: str, project_key: Optional[str]) -> str:
    return f"{pref_name}::{_normalize_project_key(project_key)}"


# Schema design fields not among the fixed hierarchy columns. Offered as opt-in
# levels (appended + flagged extra_cols) so e.g. electrolyte volume / diameters
# are pickable; the groupable filter drops the ones that are constant or unique.
_SCHEMA_EXTRA_FIELDS: list[tuple[str, str]] = [
    ("electrolyte_volume_ul", "Electrolyte volume (uL)"),
    ("np_ratio", "N/P ratio"),
    ("cathode_mass", "Cathode mass (g)"),
    ("anode_mass", "Anode mass (g)"),
    ("cathode_diameter_mm", "Cathode diameter (mm)"),
    ("anode_diameter_mm", "Anode diameter (mm)"),
    ("separator_diameter_mm", "Separator diameter (mm)"),
]


@router.get("/api/hierarchy")
def analyse_default_from_db(maxLevels: int = 4, projectId: Optional[str] = None):
    """Build and return the hierarchy tree from cell metadata in the DB."""
    project_id = normalize_project_id(projectId)
    headers = [
        "ID no.",
        "Cell_ID",
        "Batch",
        "Category",
        "Cathode",
        "Anode",
        "Separator_Type",
        "Spacer_mm",
        "Repeat",
        "Electrolyte",
        "Notes",
    ]
    try:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT
                    id_no, cell_id, batch, category, cathode, anode,
                    separator_type, spacer_mm, repeat, electrolyte, notes,
                    electrolyte_volume_ul, np_ratio, cathode_mass, anode_mass,
                    cathode_diameter_mm, anode_diameter_mm, separator_diameter_mm,
                    custom_meta
                FROM cell
                WHERE project_id = ?
                  AND deleted_at IS NULL
                ORDER BY COALESCE(id_no, 2147483647), cell_id
                """
                ,
                (project_id,),
            ).fetchall()
    except Exception:
        raise HTTPException(status_code=404, detail="No metadata in DB")

    if not rows:
        raise HTTPException(status_code=404, detail="No metadata in DB")

    rows = _dedupe_rows_for_hierarchy(rows)

    # Extra opt-in levels = schema design fields (electrolyte volume, masses,
    # diameters, …) + dynamic source metadata (DIGIBAT supplier, …). Appended
    # after the fixed columns so existing indices and any saved hierarchy order
    # stay valid, and flagged as extra_cols so they're offered in the picker
    # without disturbing the default auto-built tree. A field is offered only
    # when it can group cells: identifier-like (a distinct value per cell),
    # constant (a single value), and unnamed placeholder columns are skipped.
    n_rows = len(rows)

    def _extra_fields(r: dict) -> dict[str, str]:
        out: dict[str, str] = {}
        for col, header in _SCHEMA_EXTRA_FIELDS:
            v = r[col]
            if v is not None and str(v) != "":
                out[header] = str(v)
        out.update(_row_custom_meta(r))
        return out

    extra_by_row = [_extra_fields(r) for r in rows]
    distinct_by_key: dict[str, set[str]] = {}
    for d in extra_by_row:
        for k, v in d.items():
            distinct_by_key.setdefault(k, set()).add(v)

    def _groupable(key: str) -> bool:
        if re.match(r"(?i)^unnamed", key.strip()):
            return False
        d = len(distinct_by_key.get(key, ()))
        return 2 <= d < n_rows

    extra_keys: list[str] = sorted(k for k in distinct_by_key if _groupable(k))
    headers = headers + extra_keys
    extra_cols = set(range(len(headers) - len(extra_keys), len(headers)))

    str_rows = [
        [
            "" if r["id_no"] is None else str(r["id_no"]),
            "" if r["cell_id"] is None else str(r["cell_id"]),
            "" if r["batch"] is None else str(r["batch"]),
            "" if r["category"] is None else str(r["category"]),
            "" if r["cathode"] is None else str(r["cathode"]),
            "" if r["anode"] is None else str(r["anode"]),
            "" if r["separator_type"] is None else str(r["separator_type"]),
            "" if r["spacer_mm"] is None else str(r["spacer_mm"]),
            "" if r["repeat"] is None else str(r["repeat"]),
            "" if r["electrolyte"] is None else str(r["electrolyte"]),
            "" if r["notes"] is None else str(r["notes"]),
            *[extra.get(k, "") for k in extra_keys],
        ]
        for r, extra in zip(rows, extra_by_row)
    ]
    payload = _analyse_from_headers_rows(
        headers, str_rows, max_levels=maxLevels, column_order=None, extra_cols=extra_cols
    )
    payload["projectKey"] = project_id
    return payload


def _ensure_preference_table(conn: Any):
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ui_preference (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL,
            updated_at TEXT DEFAULT (datetime('now'))
        )
        """
    )
    conn.commit()


@router.get("/api/hierarchy-order")
def get_hierarchy_order(projectId: Optional[str] = None, projectKey: Optional[str] = None):
    pref_key = _preference_storage_key("hierarchy_order_js", projectId or projectKey)
    with get_db() as conn:
        _ensure_preference_table(conn)
        row = conn.execute(
            "SELECT value FROM ui_preference WHERE key = ?",
            (pref_key,),
        ).fetchone()
    if row is None:
        return {"order": []}
    try:
        parsed = json.loads(row["value"])
        if isinstance(parsed, list):
            return {"order": [x for x in parsed if isinstance(x, int) and x >= 0]}
    except Exception:
        pass
    return {"order": []}


@router.put("/api/hierarchy-order")
def save_hierarchy_order(req: HierarchyOrderRequest, projectId: Optional[str] = None, projectKey: Optional[str] = None):
    clean = [x for x in req.order if isinstance(x, int) and x >= 0]
    pref_key = _preference_storage_key("hierarchy_order_js", projectId or projectKey)
    with get_db() as conn:
        _ensure_preference_table(conn)
        conn.execute(
            """
            INSERT INTO ui_preference (key, value, updated_at)
            VALUES (?, ?, datetime('now'))
            ON CONFLICT(key) DO UPDATE SET
                value=excluded.value,
                updated_at=datetime('now')
            """,
            (pref_key, json.dumps(clean)),
        )
        conn.commit()
    return {"order": clean}


@router.delete("/api/hierarchy-order")
def clear_hierarchy_order(projectId: Optional[str] = None, projectKey: Optional[str] = None):
    pref_key = _preference_storage_key("hierarchy_order_js", projectId or projectKey)
    with get_db() as conn:
        _ensure_preference_table(conn)
        conn.execute("DELETE FROM ui_preference WHERE key = ?", (pref_key,))
        conn.commit()
    return {"ok": True}

