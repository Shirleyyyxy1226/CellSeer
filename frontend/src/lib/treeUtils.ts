/* ═══════════════════════════════════════════════════════════════════════
   treeUtils.ts — pure tree-logic utilities.
   No DOM access; everything is pure TypeScript functions.
═══════════════════════════════════════════════════════════════════════ */

// ── Keyword lists ─────────────────────────────────────────────────────
export const NOTES_KW     = ['notes', 'comments', 'remarks', 'description'];
export const NONSTD_KW    = ['extra', 'repeat', 'control', 'spare', 'duplicate'];
export const REPLICATE_KW = ['repeat', 'replicate', 'rep', 'run', 'trial'];
export const VOL_KW       = ['ul', 'µl', 'ml', 'volume', 'vol'];
export const SPACER_KW    = ['spacer', 'space', 'gap', 'thick'];

// ── Colour palettes ───────────────────────────────────────────────────
/** High-contrast categorical palette – hues spread ~60° apart for maximum distinction at same level. */
export const HIGH_CONTRAST_PALETTE: string[] = [
  '#e41a1c', '#4daf4a', '#377eb8', '#ff7f00', '#984ea3', '#a65628', '#f781bf', '#999999',
];

/** Simple string hash (djb2) – deterministic. */
function hashString(str: string): number {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h) + str.charCodeAt(i);
  return h >>> 0;
}

/** Golden angle in degrees – maximises perceptual separation for consecutive integers. */
const GOLDEN_ANGLE_DEG = 137.508;

/**
 * Map string to perceptually uniform color. Same string → same color everywhere.
 * Cathode, separator, spacer levels: hash-based (unchanged).
 * Cell level only (4-segment path): uses cell number × golden angle for max separation.
 */
function stringToColor(str: string): string {
  const parts = str.split('|');
  // Cell level only: cathode|separator|spacer|cell with numeric id
  if (parts.length === 4) {
    const last = parts[3];
    const cellMatch = last.match(/^(?:Cell\s*)?(\d+)$/);
    if (cellMatch) {
      const cellNum = parseInt(cellMatch[1], 10);
      const hue = (cellNum * GOLDEN_ANGLE_DEG) % 360;
      return hslToHex(hue, 75, 50);
    }
  }
  const h = hashString(str);
  const hue = (h * 0.618033988749895) % 360;
  return hslToHex(hue, 72, 52);
}

function hslToHex(h: number, s: number, l: number): string {
  s /= 100;
  l /= 100;
  const a = s * Math.min(l, 1 - l);
  const f = (n: number) => {
    const k = (n + h / 30) % 12;
    return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1));
  };
  const r = Math.round(f(0) * 255);
  const g = Math.round(f(8) * 255);
  const b = Math.round(f(4) * 255);
  return '#' + [r, g, b].map((x) => x.toString(16).padStart(2, '0')).join('');
}

export const LEVEL_PALETTES: string[][] = [
  ['#c24a3a', '#d07848', '#2a9d8f', '#6c3483', '#b7410e', '#2471a3'],
  ['#4a7cbf', '#7952a3', '#2e8b72', '#c06030', '#5a7a32', '#8b4060'],
  ['#2d7869', '#9a8230', '#5a6ea0', '#a04828', '#3a8a50', '#7a4868'],
  ['#3a6e88', '#8a6030', '#4a8860', '#924060', '#5a7050', '#6a5090'],
];

export const NONSTD_COLOUR = '#b7950b';
export const TBC_COLOUR    = '#9a9080';

// ── Layout constants ──────────────────────────────────────────────────
const ROW_H  = 30;
const COL_SP = 110;
const PAD_T  = 90;
const PAD_L  = -100;

// ── Types ─────────────────────────────────────────────────────────────
export interface ParsedTable {
  headers: string[];
  rows: string[][];
}

export interface ColStats {
  j: number;
  header: string;
  cardinality: number;
  coverage: number;
  distinctVals: string[];
  allVals: string[];
  avgLen: number;
  isNotes: boolean;
  isReplicate: boolean;
  isNumeric: boolean;
  hasNonstdVal: boolean;
}

export interface Annotation {
  col: number;
  header: string;
  unit: string;
  map: Record<string, string>;
}

export interface LabelDecoration {
  prefix: string;
  suffix: string;
}

export interface HierVal {
  name: string;
  val: string;
  disp: string;
}

export interface TreeNode {
  label: string;
  rawVal: string;
  depth: number;
  isLeaf: boolean;
  colHeader?: string;
  children: TreeNode[];
  // leaf-only
  isTBC?: boolean;
  isNonStd?: boolean;
  rowData?: string[];
  cellId?: string;
  hierVals?: HierVal[];
  // set by doLayout
  x?: number;
  y?: number;
}

export interface ConstantDisplay {
  header: string;
  val: string;
  j: number;
}

export interface AnalysisResult {
  leafCol: number;
  rowIdCol: number;
  flagCol: number;
  rootLabelColIdx: number;
  rootLabelVal: string;
  hierCols: ColStats[];
  annotations: (Annotation | null)[];
  labelDecorations: LabelDecoration[];
  redundantJs?: Set<number> | number[];
  excludedJs?: Set<number> | number[];
  stats?: ColStats[];
  N: number;
  headers: string[];
  allConstants: ColStats[];
  allCandidates: ColStats[];
}

// ── Colour assignment ─────────────────────────────────────────────────
export function assignColourMap(hierCols: ColStats[]): Record<string, string>[] {
  return hierCols.map((col, lvl) => {
    const palette = LEVEL_PALETTES[Math.min(lvl, LEVEL_PALETTES.length - 1)];
    const map: Record<string, string> = {};
    let pi = 0;
    col.distinctVals.forEach(v => {
      map[v] = palette[pi++ % palette.length];
    });
    return map;
  });
}

/** Perceptual uniform colour map for tree/plot matching when selected. Uses high-contrast palette for maximum distinction. */
export function assignColourMapPerceptual(hierCols: ColStats[]): Record<string, string>[] {
  return hierCols.map((col) => {
    const map: Record<string, string> = {};
    col.distinctVals.forEach((v, i) => {
      map[v] = HIGH_CONTRAST_PALETTE[i % HIGH_CONTRAST_PALETTE.length];
    });
    return map;
  });
}

// ── Format node label ─────────────────────────────────────────────────
export function formatNodeLabel(
  rawVal: string,
  levelIdx: number,
  // Only `map` and `unit` are read here, so accept any structural subset of
  // Annotation (rate-perf builds lightweight {map, unit} entries without
  // col/header). Full Annotation[] callers remain compatible.
  annotations: ({ map?: Record<string, string>; unit?: string } | null)[],
  labelDecorations: LabelDecoration[],
): string {
  const dec = labelDecorations[levelIdx];
  const ann = annotations[levelIdx];

  let label = rawVal;

  if (dec && (dec.prefix || dec.suffix)) {
    const num = parseFloat(rawVal);
    const formatted = isNaN(num) ? rawVal : num.toFixed(1);
    label = (dec.prefix + formatted + (dec.suffix ? ' ' + dec.suffix : '')).trim();
  }

  if (ann?.map && ann.map[rawVal]) {
    const annVal  = ann.map[rawVal];
    const unitStr = ann.unit ? '\u202F' + ann.unit : '';
    label += ' \u00B7 ' + annVal + unitStr;
  }

  return label;
}

// ── Layout ────────────────────────────────────────────────────────────
export function countLeaves(node: TreeNode): number {
  return node.isLeaf ? 1 : node.children.reduce((s, c) => s + countLeaves(c), 0);
}

/** Stable key for a tree node based on root-to-node path. */
export function treeNodeStableKey(pathSegments: string[]): string {
  return pathSegments.join('||');
}

/** Collect keys for nodes whose direct children are all leaf cells. */
export function collectPreLeafNodeKeys(root: TreeNode): Set<string> {
  const keys = new Set<string>();

  function walk(node: TreeNode, path: string[]) {
    const nodeSeg = `${node.colHeader ?? 'root'}=${node.rawVal ?? node.label ?? ''}`;
    const nextPath = [...path, nodeSeg];
    if (!node.isLeaf && node.children.length > 0 && node.children.every((c) => c.isLeaf)) {
      keys.add(treeNodeStableKey(nextPath));
    }
    node.children.forEach((child) => walk(child, nextPath));
  }

  walk(root, []);
  return keys;
}

/** Optional colSp overrides COL_SP for adjustable branch length (e.g. to fill container). */
function doLayout(node: TreeNode, colSp?: number): void {
  const sp = colSp ?? COL_SP;
  let li = 0;
  function layout(n: TreeNode): void {
    n.x = n.depth === 0 ? PAD_L : PAD_L + n.depth * sp;
    if (n.isLeaf) { n.y = PAD_T + li++ * ROW_H; return; }
    n.children.forEach(c => layout(c));
    const ys = n.children.map(c => c.y!);
    n.y = (Math.min(...ys) + Math.max(...ys)) / 2;
  }
  layout(node);
}

// ── Node geometry ─────────────────────────────────────────────────────
export function nodeRightEdge(depth: number, x: number, isLeaf: boolean): number {
  if (isLeaf)      return x + 4.5;
  if (depth === 0) return x + 6;
  if (depth === 1) return x + 10;
  return x + 7;
}

export function nodeLeftEdge(depth: number, x: number, isLeaf: boolean): number {
  if (isLeaf)      return x - 4.5;
  if (depth === 0) return x - 6;
  if (depth === 1) return x - 10;
  return x - 7;
}

/** Collect path from root to target node (for filtering). Returns [{header, val}, ...]. Includes leaf when target is a leaf (for individual cell selection). */
/**
 * True when a tree-filter path points at an individual cell (a leaf click),
 * rather than a group/branch node. Leaf clicks are encoded by
 * `getPathFromRootToNode` with a synthetic last segment `{ header: 'Cell', … }`;
 * branch paths end in a hierarchy column header. Views that only plot per-cell
 * data (GCD / dV/dQ / dQ/dV) use this to ignore group selections.
 */
export function isCellSelectionPath(path: Array<{ header: string; val: string }>): boolean {
  const last = path[path.length - 1];
  return !!last && last.header.trim().toLowerCase() === 'cell';
}

export function getPathFromRootToNode(
  node: TreeNode,
  target: TreeNode,
): Array<{ header: string; val: string }> | null {
  if (node === target) {
    if (target.isLeaf && target.rawVal) {
      return [{ header: 'Cell', val: target.rawVal }];
    }
    return [];
  }
  for (const child of node.children) {
    const sub = getPathFromRootToNode(child, target);
    if (sub !== null) {
      if (!child.isLeaf && child.colHeader && child.rawVal) {
        return [{ header: child.colHeader, val: child.rawVal }, ...sub];
      }
      if (child.isLeaf) {
        const prefix = node.colHeader && node.rawVal ? [{ header: node.colHeader, val: node.rawVal }] : [];
        return [...prefix, ...sub];
      }
      return sub;
    }
  }
  return null;
}

export function hex2rgb(h: string): string {
  if (!h || h.length < 7) return '128,128,128';
  return [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16)).join(',');
}

// ── Build display constants list ──────────────────────────────────────
export function buildDisplayConstants(
  analysis: AnalysisResult,
  rows: string[][],
): ConstantDisplay[] {
  const cell = (r: string[], j: number) => (j < r.length ? r[j] : '').trim();
  const { allConstants, rootLabelColIdx } = analysis;
  return (allConstants ?? [])
    .filter(s => !s.isNotes)
    .sort((a, b) => {
      if (a.j === rootLabelColIdx) return -1;
      if (b.j === rootLabelColIdx) return 1;
      if (!a.isNumeric && b.isNumeric) return -1;
      if (a.isNumeric && !b.isNumeric) return 1;
      return a.j - b.j;
    })
    .map(s => ({
      header: s.header,
      val: rows.map(r => cell(r, s.j)).find(Boolean) ?? '',
      j: s.j,
    }));
}
