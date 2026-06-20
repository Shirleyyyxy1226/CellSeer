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
 *   differ in lightness; conditions under the same cathode sit in nearby
 *   hues (separator shifts the hue ±22°, spacer ±8°).
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

/**
 * Anchor hues for known cathode families (prefix-matched, longest first).
 * Hue families follow the established SEMANTIC_COLOURS conventions in
 * backend/tree_utils.py: NMC/NCA = red–orange, LFP = teal, LCO = purple.
 */
const CATHODE_HUES: Array<[string, number]> = [
  ['LIFEPO4', 170],
  ['NMC811', 8],
  ['NMC622', 20],
  ['NMC111', 28],
  ['LNMO', 330],
  ['NMC', 14],
  ['NCA', 24],
  ['LFP', 170],
  ['LCO', 282],
  ['LMO', 320],
  ['LTO', 205],
];

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

export function cathodeHue(cathode?: string | null): number {
  const key = normKey(cathode ?? '');
  for (const [prefix, hue] of CATHODE_HUES) {
    if (key.startsWith(prefix)) return hue;
  }
  return hash01(`cathode:${key}`) * 360;
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
