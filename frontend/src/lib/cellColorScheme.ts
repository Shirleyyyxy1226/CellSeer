import type { CellEncoding, LineDash, MarkerSymbol } from 'cellseer-lib';

/**
 * cellColorScheme.ts — single source of truth for cell identity colours.
 *
 * Every surface that colours a cell (hierarchy tree, tree filter sidebar,
 * GCD / rate-performance / differential plots) must go through this module
 * so the same cell is the same colour everywhere.
 *
 * Properties:
 * - A cell's colour is a pure function of its own attributes
 *   (cathode, separator, spacer, cell number). It never changes with
 *   hierarchy order, tree filters, selection, or which other cells happen
 *   to be loaded.
 * - Similar cells look similar: replicates of one condition share a hue and
 *   differ in lightness; the hue is derived purely from a hash of the
 *   cathode/separator/spacer strings with no chemistry-specific mapping.
 * - Branch/path colours are the circular mean of their member-cell hues,
 *   so a branch visually "contains" its leaf cells.
 */

export interface CellColorAttrs {
  idNo?: number | null;
  cellId?: string | null;
  cellName?: string | null;
  cathode?: string | null;
  separatorType?: string | null;
  spacerMm?: number | string | null;
}

const PHI = 0.618033988749895;

function djb2(s: string): number {
  let h = 5381;
  for (let i = 0; i < s.length; i++) h = ((h << 5) + h) + s.charCodeAt(i);
  return h >>> 0;
}

/** Deterministic pseudo-uniform value in [0, 1) from a string. */
function hash01(s: string): number {
  return (djb2(s) * PHI) % 1;
}

const frac = (x: number) => x - Math.floor(x);
const wrapHue = (h: number) => ((h % 360) + 360) % 360;

function normKey(s: string): string {
  return s.toUpperCase().replace(/[^A-Z0-9]/g, '');
}

function cathodeHue(cathode?: string | null): number {
  return hash01(`cathode:${normKey(cathode ?? '')}`) * 360;
}

/** Hue of a condition (cathode × separator × spacer); replicates share it. */
export function conditionHue(
  cathode?: string | null,
  separatorType?: string | null,
  spacerMm?: number | string | null,
): number {
  let hue = cathodeHue(cathode);
  const sep = (separatorType ?? '').toString().trim();
  if (sep) hue += hash01(`sep:${normKey(sep)}`) * 44 - 22;
  const sp = spacerMm == null ? '' : String(spacerMm).trim();
  if (sp) hue += hash01(`sp:${sp}`) * 16 - 8;
  return wrapHue(hue);
}

/** Extract the cell number used for the replicate lightness ladder. */
function cellNumber(cell: CellColorAttrs): number {
  const text = `${cell.cellName ?? ''} ${cell.cellId ?? ''}`.trim();
  const m = text.match(/(\d+)/);
  if (m) return parseInt(m[1], 10);
  if (cell.idNo != null) return cell.idNo;
  return djb2(text || 'cell') % 1024;
}

/**
 * The canonical colour of a cell. Same hue as its condition (± small
 * per-cell nudge); lightness spread over a 38–62% ladder by cell number
 * (golden-ratio sequence, so consecutive replicates separate well).
 */
export function cellIdentityColor(cell: CellColorAttrs): string {
  const n = cellNumber(cell);
  const hue = wrapHue(
    conditionHue(cell.cathode, cell.separatorType, cell.spacerMm) +
      (frac(n * PHI * PHI) * 10 - 5),
  );
  const lightness = 38 + frac(n * PHI) * 24;
  return hslToHex(hue, 64, lightness);
}

/**
 * Cell key → colour map. Keyed by every identity string consumers look up
 * with (cellName, cellId, "Cell <idNo>", "<idNo>"), all mapping to the same
 * colour for that cell.
 */
export function buildCellColorMap(cells: CellColorAttrs[]): Map<string, string> {
  const map = new Map<string, string>();
  cells.forEach((c) => {
    const color = cellIdentityColor(c);
    const keys = [
      c.cellName,
      c.cellId,
      c.idNo != null ? `Cell ${c.idNo}` : null,
      c.idNo != null ? String(c.idNo) : null,
    ];
    keys.forEach((k) => {
      const key = (k ?? '').toString().trim();
      if (key && !map.has(key)) map.set(key, color);
    });
  });
  return map;
}

/* ────────────────────────────────────────────────────────────────────────
 * Orthogonal discriminability channel (line style + marker).
 *
 * The identity hue alone cannot separate visually-similar cells (replicates
 * share a hue; same-cathode siblings sit within ±30°). When such cells are
 * overlaid for comparison, we add a SECOND, orthogonal channel that does not
 * touch the hue: a line-dash + marker-symbol keyed by within-condition
 * replicate index. Hue keeps meaning "which condition"; dash/symbol answer
 * "which replicate of it". This is Wilke's redundant-coding recommendation.
 * ──────────────────────────────────────────────────────────────────────── */

/** Dash styles ordered by visual distinctness; index 0 = primary replicate. */
const DASH_LADDER: LineDash[] = ['solid', 'dash', 'dot', 'dashdot', 'longdash', 'longdashdot'];
/** Marker glyphs ordered by visual distinctness; index 0 = primary replicate. */
const SYMBOL_LADDER: MarkerSymbol[] = [
  'circle', 'square', 'diamond', 'triangle-up', 'star', 'cross', 'pentagon', 'x',
];

/**
 * CVD-safe categorical palette for the opt-in "Maximise contrast" mode.
 * Okabe-Ito (8) followed by a Glasbey-style extension. Adjacent entries are
 * maximally separable, so cells that are semantically *adjacent* (and would
 * otherwise be near-identical in hue) land far apart in colour.
 */
const CONTRAST_PALETTE: string[] = [
  '#E69F00', // orange
  '#56B4E9', // sky blue
  '#009E73', // bluish green
  '#0072B2', // blue
  '#D55E00', // vermillion
  '#CC79A7', // reddish purple
  '#F0E442', // yellow
  '#000000', // black
  // Glasbey-style extension for larger active selections
  '#999999', '#8B4513', '#FF1493', '#00CED1',
  '#9400D3', '#228B22', '#FF8C00', '#4169E1',
];

/** Stable grouping key for a condition (cathode × separator × spacer). */
function conditionKey(cell: CellColorAttrs): string {
  const cathode = normKey(cell.cathode ?? '');
  const sep = normKey((cell.separatorType ?? '').toString());
  const sp = cell.spacerMm == null ? '' : String(cell.spacerMm).trim();
  return `${cathode}|${sep}|${sp}`;
}

function encodingKeysFor(cell: CellColorAttrs): string[] {
  return [
    cell.cellName,
    cell.cellId,
    cell.idNo != null ? `Cell ${cell.idNo}` : null,
    cell.idNo != null ? String(cell.idNo) : null,
  ]
    .map((k) => (k ?? '').toString().trim())
    .filter(Boolean);
}

export interface BuildEncodingsOpts {
  /** Recolour the passed set from a max-contrast CVD-safe palette. */
  maximizeContrast?: boolean;
}

/**
 * Build the full visual encoding (colour + dash + symbol) for a set of cells.
 *
 * Pass the cells *currently being displayed* (the active selection): dash and
 * symbol are assigned by replicate index *within that set*, so an overlay
 * always starts from a clean solid/circle and walks the ladder — the cleanest
 * possible separation for exactly the cells on screen.
 *
 * - Colour (default): the cell's identity hue, unchanged.
 * - Colour (maximizeContrast): a CVD-safe categorical colour assigned in
 *   semantic-rank order, so similar cells become maximally different.
 * - Dash + symbol (always): orthogonal to colour, keyed by within-condition
 *   replicate index — this is what separates replicates that share a hue.
 *
 * Returns a map keyed by every identity string a consumer might look up with
 * (cellName, cellId, "Cell <idNo>", "<idNo>").
 */
export function buildCellEncodings(
  cells: CellColorAttrs[],
  opts: BuildEncodingsOpts = {},
): Map<string, CellEncoding> {
  const maximizeContrast = opts.maximizeContrast ?? false;

  // 1. Group by condition, sort each group by cell number for a stable index.
  const groups = new Map<string, CellColorAttrs[]>();
  for (const c of cells) {
    const k = conditionKey(c);
    const g = groups.get(k);
    if (g) g.push(c);
    else groups.set(k, [c]);
  }
  for (const g of groups.values()) g.sort((a, b) => cellNumber(a) - cellNumber(b));

  // 2. Within-condition replicate index → dash + symbol (orthogonal channel).
  const dashOf = new Map<CellColorAttrs, LineDash>();
  const symbolOf = new Map<CellColorAttrs, MarkerSymbol>();
  for (const g of groups.values()) {
    g.forEach((c, i) => {
      dashOf.set(c, DASH_LADDER[i % DASH_LADDER.length]);
      symbolOf.set(c, SYMBOL_LADDER[i % SYMBOL_LADDER.length]);
    });
  }

  // 3. Colour: identity hue or adaptive max-contrast palette.
  const colorOf = new Map<CellColorAttrs, string>();
  if (maximizeContrast) {
    const ranked = [...cells].sort((a, b) => {
      const ha = conditionHue(a.cathode, a.separatorType, a.spacerMm);
      const hb = conditionHue(b.cathode, b.separatorType, b.spacerMm);
      if (ha !== hb) return ha - hb;
      return cellNumber(a) - cellNumber(b);
    });
    ranked.forEach((c, i) => colorOf.set(c, CONTRAST_PALETTE[i % CONTRAST_PALETTE.length]));
  } else {
    for (const c of cells) colorOf.set(c, cellIdentityColor(c));
  }

  // 4. Emit keyed by every identity string consumers resolve with.
  const map = new Map<string, CellEncoding>();
  for (const c of cells) {
    const enc: CellEncoding = {
      color: colorOf.get(c) ?? cellIdentityColor(c),
      dash: dashOf.get(c) ?? 'solid',
      symbol: symbolOf.get(c) ?? 'circle',
    };
    for (const key of encodingKeysFor(c)) if (!map.has(key)) map.set(key, enc);
  }
  return map;
}

/** Resolve a cell's encoding from a map built by {@link buildCellEncodings}. */
export function getCellEncoding(
  map: Map<string, CellEncoding>,
  cell: CellColorAttrs,
): CellEncoding | undefined {
  for (const key of encodingKeysFor(cell)) {
    const enc = map.get(key);
    if (enc) return enc;
  }
  return undefined;
}

const PATH_SATURATION = 58;
const PATH_LIGHTNESS = 46;

/** Colour for a branch/path node: circular mean of its member-cell hues. */
export function pathColorFromHues(hues: number[]): string {
  if (hues.length === 0) return hslToHex(0, 0, 55);
  let x = 0;
  let y = 0;
  for (const h of hues) {
    const rad = (h * Math.PI) / 180;
    x += Math.cos(rad);
    y += Math.sin(rad);
  }
  const mean = wrapHue((Math.atan2(y, x) * 180) / Math.PI);
  return hslToHex(mean, PATH_SATURATION, PATH_LIGHTNESS);
}

/** Deterministic fallback for a path key with no resolvable member cells. */
export function fallbackPathColor(pathKey: string): string {
  return hslToHex(hash01(`path:${pathKey}`) * 360, PATH_SATURATION, PATH_LIGHTNESS);
}

/**
 * Canonical solid colour for a cathode, for condition-level surfaces (the Master
 * Plot overview's trajectory cards / ranking bars / heatmap row dots). A pure
 * function of the cathode string — the same hue the cathode gets in every
 * per-cell view and in its tree branch, so it never shifts with the cathode set.
 */
export function cathodeColor(cathode?: string | null): string {
  return pathColorFromHues([cathodeHue(cathode)]);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const toHex = (x: number) =>
    Math.round(Math.max(0, Math.min(1, x)) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${toHex(f(0))}${toHex(f(8))}${toHex(f(4))}`;
}
