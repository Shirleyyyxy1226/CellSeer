/**
 * Aggregation and color logic for rate performance plots when tree selection is active.
 * When a higher-level node is selected, show average traces per next-level group with matched colors.
 */

import type { TreeFilterPath } from '@/components/tree/treeTypes';
import { formatNodeLabel, assignColourMapPerceptual } from './treeUtils';
import type { ColStats, LabelDecoration } from './treeUtils';
import {
  buildCellColorMap,
  cellIdentityColor,
  conditionHue,
  fallbackPathColor,
  getCellEncoding,
  pathColorFromHues,
} from './cellColorScheme';
import type { CellColorAttrs } from './cellColorScheme';
import type { CellEncoding, LineDash, MarkerSymbol } from '@/charts';

import type { RatePerfCell as CyclingCellLike } from '@/lib/cellTypes';

const DEFAULT_COLOR = '#6b7280';

function colorFromCellIdentity(cell: CellColorAttrs): string {
  return cellIdentityColor(cell);
}

/** Build cell name → color map. Canonical scheme: fixed per cell, condition-similar hues. */
export function buildCanonicalCellColorMap(allCells: CyclingCellLike[]): Map<string, string> {
  return buildCellColorMap(allCells);
}

/** Path key format: cathode, cathode|separator, cathode|separator|spacer, or cathode|separator|spacer|cellName. */
export function pathKeyForCell(cell: CyclingCellLike, upToLevel: 0 | 1 | 2 | 3): string {
  const parts = [
    cell.cathode ?? '',
    cell.separatorType ?? '',
    String(cell.spacerMm ?? ''),
    cell.cellName ?? `Cell ${cell.idNo}`,
  ];
  return parts.slice(0, upToLevel + 1).join('|');
}

/** Get color for a cell from the canonical map. */
export function getCellColorFromMap(
  cell: CyclingCellLike,
  cellColorMap: Map<string, string>,
): string {
  const key = cell.cellName ?? `Cell ${cell.idNo}`;
  return cellColorMap.get(key) ?? colorFromCellIdentity(cell);
}

/**
 * Build path→color map. Each path prefix is coloured by the circular-mean hue
 * of its member cells, so branch colours match the cells beneath them no
 * matter how the hierarchy levels are ordered.
 */
export function buildPathToColorMap(
  allCells: CyclingCellLike[],
  hierCols?: ColStats[],
  metadataByIdNo?: Map<number, Record<string, string>>,
): Map<string, string> {
  const huesByPath = new Map<string, number[]>();
  const add = (key: string, cell: CyclingCellLike) => {
    if (!key) return;
    const hues = huesByPath.get(key) ?? [];
    hues.push(conditionHue(cell.cathode, cell.separatorType, cell.spacerMm));
    huesByPath.set(key, hues);
  };
  if (hierCols && hierCols.length > 0) {
    allCells.forEach((c) => {
      const metaRow = metadataByIdNo?.get(c.idNo);
      const vals = hierCols.map((col) => resolveHierarchyCellValue(c, col.header, metaRow));
      for (let i = 0; i < vals.length; i++) {
        add(vals.slice(0, i + 1).join('|'), c);
      }
    });
  } else {
    allCells.forEach((c) => {
      for (const level of [0, 1, 2] as const) {
        add(pathKeyForCell(c, level), c);
      }
    });
  }
  const map = new Map<string, string>();
  huesByPath.forEach((hues, key) => map.set(key, pathColorFromHues(hues)));
  return map;
}

type GroupField = string;

const HEADER_ALIAS_FIELDS: Record<string, string[]> = {
  cathode: ['cathode'],
  anode: ['anode'],
  separator_type: ['separatorType', 'separator_type'],
  separator: ['separatorType', 'separator_type'],
  spacer_mm: ['spacerMm', 'spacer_mm'],
  spacer: ['spacerMm', 'spacer_mm'],
  cell: ['cellName', 'cellId', 'cell_id'],
  cell_id: ['cellId', 'cell_id', 'cellName'],
  id_no: ['idNo', 'id_no'],
  idno: ['idNo', 'id_no'],
  batch: ['batch'],
  category: ['category'],
  repeat: ['repeat'],
  electrolyte: ['electrolyte'],
  notes: ['notes'],
};

function normalizeHeaderKey(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/[().]/g, '')
    .replace(/[^a-z0-9]+/g, '_')
    .replace(/^_+|_+$/g, '');
}

function headerVariants(normalized: string): string[] {
  const out = new Set<string>([normalized]);
  const stripLeadingIndexed = normalized.replace(/^[a-z]\d+_/, '');
  if (stripLeadingIndexed && stripLeadingIndexed !== normalized) out.add(stripLeadingIndexed);
  const tokens = stripLeadingIndexed.split('_').filter(Boolean);
  if (tokens.length > 1) {
    out.add(tokens.slice(1).join('_'));
    out.add(tokens[tokens.length - 1]);
  }
  // Map decorated headers like "A2:ANODE" / "B5_separator_type" to semantic keys.
  Object.keys(HEADER_ALIAS_FIELDS).forEach((k) => {
    const parts = k.split('_').filter(Boolean);
    if (parts.length && parts.every((p) => tokens.includes(p))) out.add(k);
  });
  return Array.from(out);
}

function resolveValueFromRecord(record: Record<string, unknown>, field: GroupField): string {
  const normalized = normalizeHeaderKey(field);
  const variants = headerVariants(normalized);
  const aliasFields = variants.flatMap((v) => HEADER_ALIAS_FIELDS[v] ?? []);
  const dynamicFields = [
    field,
    ...variants,
    ...variants.map((v) => v.replace(/_/g, '')),
    field.replace(/\s+/g, ''),
  ];
  const candidates = [...new Set([...aliasFields, ...dynamicFields])];
  const keyMap = new Map<string, string>();
  Object.keys(record).forEach((k) => keyMap.set(normalizeHeaderKey(k), k));
  for (const key of candidates) {
    if (key in record) {
      const raw = record[key];
      if (raw != null && String(raw).trim() !== '') return String(raw).trim();
    }
    const mapped = keyMap.get(normalizeHeaderKey(key));
    if (!mapped) continue;
    const raw = record[mapped];
    if (raw != null && String(raw).trim() !== '') return String(raw).trim();
  }
  return '';
}

export function resolveHierarchyCellValue(
  cell: CyclingCellLike,
  field: GroupField,
  metadataRow?: Record<string, unknown>,
): string {
  if (metadataRow) {
    const fromMeta = resolveValueFromRecord(metadataRow, field);
    if (fromMeta) return fromMeta;
  }
  const fromCell = resolveValueFromRecord(cell as unknown as Record<string, unknown>, field);
  if (fromCell) return fromCell;
  const normalized = normalizeHeaderKey(field);
  if (normalized === 'cell' || normalized === 'cell_id' || normalized === 'id_no' || normalized === 'idno') {
    return cell.cellName ?? `Cell ${cell.idNo}`;
  }
  return '';
}

function getCellVal(cell: CyclingCellLike, field: GroupField): string {
  return resolveHierarchyCellValue(cell, field);
}

/** Path key in hierarchy order – matches tree pathFromRoot for color alignment. */
function pathKeyInOrder(cell: CyclingCellLike, hierCols: ColStats[], upToLevel: number): string {
  const parts: string[] = [];
  for (let i = 0; i <= upToLevel && i < hierCols.length; i++) {
    const col = hierCols[i];
    parts.push(getCellVal(cell, col.header));
  }
  if (upToLevel >= hierCols.length) {
    parts.push(cell.cellName ?? `Cell ${cell.idNo}`);
  }
  return parts.join('|');
}

/** Effective group level: show (path.length+1)th level + detailDepth. Max = hierCols.length + 1 (last = cell). */
function getEffectiveGroupLevel(
  path: TreeFilterPath,
  detailDepth: number,
  hierCols: ColStats[],
): number {
  const hasCell = path.some((p) => p.header === 'Cell');
  const maxLevel = hierCols.length + 1;
  if (hasCell) return maxLevel;
  return Math.min(path.length + 1 + detailDepth, maxLevel);
}

/** Max detailDepth before hitting last level. Derived from hierCols (hierCols.length + 1 - path.length - 1). */
export function getMaxDetailDepth(path: TreeFilterPath, hierCols: ColStats[]): number {
  const hasCell = path.some((p) => p.header === 'Cell');
  if (hasCell || hierCols.length === 0) return 0;
  const maxLevel = hierCols.length + 1;
  return Math.max(0, maxLevel - path.length - 1);
}

/** Get group-by field from hierarchy. Hierarchy-aware: uses hierCols order. */
function getGrouping(
  path: TreeFilterPath,
  detailDepth: number,
  hierCols: ColStats[],
): { field: GroupField; parentField?: GroupField; composite: boolean; fieldHeader?: string; parentHeader?: string } {
  if (path.length === 0) {
    const first = hierCols[0];
    const field = first ? first.header : 'Separator Type';
    return { field, fieldHeader: first?.header, composite: false };
  }
  const hasCell = path.some((p) => p.header === 'Cell');
  if (hasCell) return { field: 'Cell', fieldHeader: 'Cell', composite: false };
  const level = getEffectiveGroupLevel(path, detailDepth, hierCols);
  const levelIdx = level - 1;
  if (levelIdx < 0 || levelIdx >= hierCols.length) return { field: 'Cell', fieldHeader: 'Cell', composite: false };
  const col = hierCols[levelIdx];
  const field = col.header;
  const parentIdx = levelIdx - 1;
  const parentHeader = parentIdx >= 0 ? hierCols[parentIdx].header : undefined;
  const parentField = parentHeader ?? undefined;
  const composite = parentField != null && normalizeHeaderKey(field) !== 'cell';
  return { field, parentField, composite, fieldHeader: col.header, parentHeader };
}

/** Aggregate capacity by cycle: mean and optional asymmetric range [lower, upper] from mean when n>1. */
function aggregateCapacity(
  cells: CyclingCellLike[],
  useSpecific: boolean,
  direction: 'discharge' | 'charge',
): { cycles: number[]; values: number[]; errorMinus?: number[]; errorPlus?: number[] } {
  const allCycles = new Set<number>();
  const sumByCycle = new Map<number, number>();
  const countByCycle = new Map<number, number>();
  const valsByCycle = new Map<number, number[]>();

  cells.forEach((cell) => {
    const yVals =
      direction === 'charge'
        ? (cell.chargeCapacityMah ?? [])
        : (useSpecific ? cell.specificCapacityMahG ?? cell.dischargeCapacityMah : cell.dischargeCapacityMah);
    cell.cycles.forEach((cy, i) => {
      const v = yVals[i];
      if (typeof v === 'number' && isFinite(v)) {
        allCycles.add(cy);
        sumByCycle.set(cy, (sumByCycle.get(cy) ?? 0) + v);
        countByCycle.set(cy, (countByCycle.get(cy) ?? 0) + 1);
        const arr = valsByCycle.get(cy) ?? [];
        arr.push(v);
        valsByCycle.set(cy, arr);
      }
    });
  });

  const cycles = Array.from(allCycles).sort((a, b) => a - b);

  const values = cycles.map((cy) => {
    const sum = sumByCycle.get(cy) ?? 0;
    const n = countByCycle.get(cy) ?? 1;
    return sum / n;
  });

  let errorMinus: number[] | undefined;
  let errorPlus: number[] | undefined;
  if (cells.length > 1) {
    errorMinus = cycles.map((cy, i) => {
      const arr = valsByCycle.get(cy) ?? [];
      const mean = values[i];
      if (arr.length < 2) return 0;
      const min = Math.min(...arr);
      return mean - min;
    });
    errorPlus = cycles.map((cy, i) => {
      const arr = valsByCycle.get(cy) ?? [];
      const mean = values[i];
      if (arr.length < 2) return 0;
      const max = Math.max(...arr);
      return max - mean;
    });
  }

  return { cycles, values, errorMinus, errorPlus };
}

/** Group cells by field value. */
function groupCells<T extends CyclingCellLike>(
  cells: T[],
  field: GroupField,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  cells.forEach((c) => {
    const key = getCellVal(c, field);
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  });
  return map;
}

/** Group cells by composite key (e.g. separatorType + spacerMm). Returns Map<displayKey, cells>. */
function groupCellsByComposite<T extends CyclingCellLike>(
  cells: T[],
  parentField: GroupField,
  childField: GroupField,
): { groups: Map<string, T[]> } {
  const groups = new Map<string, T[]>();
  cells.forEach((c) => {
    const pk = getCellVal(c, parentField);
    const ck = getCellVal(c, childField);
    const displayKey = `${pk} · ${ck}`;
    const arr = groups.get(displayKey) ?? [];
    arr.push(c);
    groups.set(displayKey, arr);
  });
  return { groups };
}

export interface AggregatedTrace {
  name: string;
  x: number[];
  y: number[];
  color: string;
  /** Orthogonal line-style discriminator (per-cell traces only). */
  dash?: LineDash;
  /** Orthogonal marker discriminator (per-cell traces only). */
  symbol?: MarkerSymbol;
  isAggregated: boolean;
  cell?: CyclingCellLike;
  hasCrate: boolean;
  cRates?: number[];
  /** Asymmetric error bars: distance from mean down to min (errorMinus) and up to max (errorPlus). */
  errorMinus?: number[];
  errorPlus?: number[];
}

export interface TraceOptions {
  filteredCells: CyclingCellLike[];
  treeFilterPath: TreeFilterPath;
  hierCols: ColStats[];
  useSpecificCapacity: boolean;
  direction?: 'discharge' | 'charge';
  /** How many levels to drill down from the default (0 = first level below path). */
  detailDepth?: number;
  /** Path→color map (string-based, perceptually uniform). Same string = same color everywhere. */
  pathToColorMap?: Map<string, string>;
  /** Per-cell visual encodings (colour + orthogonal dash/symbol). Applied to
   *  individual-cell traces so overlaid similar cells stay distinguishable. */
  cellEncodings?: Map<string, CellEncoding>;
  /** Format trace names to match hierarchy labels (e.g. "1" → "Sp 1.0 mm"). */
  labelDecorations?: LabelDecoration[];
  annotations?: Array<{ map: Record<string, string>; unit?: string } | null>;
  /** Optional hierarchy metadata row keyed by idNo (diagnosed from parsed metadata). */
  metadataByIdNo?: Map<number, Record<string, string>>;
}

function colorForPath(pathKey: string, pathToColorMap?: Map<string, string>): string {
  return pathToColorMap?.get(pathKey) ?? fallbackPathColor(pathKey);
}

/**
 * Categorical branch/group colour shared with the hierarchy tree, so a chart
 * band uses the exact colour its child node shows in the tree. The tree colours
 * a node at depth D via `assignColourMapPerceptual(hierCols)[D-1][rawVal]`; a
 * pathKey's last `|`-segment is exactly that node at level `segs.length - 1`, so
 * this returns the identical colour. It is keyed only by `hierCols`, so it
 * follows hierarchy reorder automatically. Falls back to the hue-mean path
 * colour when a value isn't present in the perceptual map (formatting/metadata
 * edge cases), so it never throws.
 */
export function colorForHierPath(
  pathKey: string,
  perceptualMaps: Record<string, string>[],
  pathToColorMap?: Map<string, string>,
): string {
  const segs = pathKey.split('|');
  const lvl = segs.length - 1;
  const val = segs[lvl];
  return perceptualMaps[lvl]?.[val] ?? colorForPath(pathKey, pathToColorMap);
}

function colorForIndividualCell(cell: CellColorAttrs): string {
  return colorFromCellIdentity(cell);
}

/** Format raw key to match hierarchy label (e.g. spacer "1" → "Sp 1.0 mm"). */
function formatTraceName(
  key: string,
  field: GroupField,
  fieldHeader: string | undefined,
  hierCols: ColStats[],
  labelDecorations?: LabelDecoration[],
  annotations?: Array<{ map: Record<string, string> } | null>,
): string {
  if (!labelDecorations?.length || !hierCols.length) return key || '(unknown)';
  const idx = fieldHeader
    ? hierCols.findIndex((c) => c.header === fieldHeader)
    : hierCols.findIndex((c) => normalizeHeaderKey(c.header) === normalizeHeaderKey(field));
  if (idx < 0) return key || '(unknown)';
  return formatNodeLabel(key, idx, annotations ?? [], labelDecorations) || key || '(unknown)';
}

export function buildTraces(opts: TraceOptions): AggregatedTrace[] {
  const {
    filteredCells,
    treeFilterPath,
    hierCols,
    useSpecificCapacity,
    direction = 'discharge',
    detailDepth = 0,
    pathToColorMap,
    cellEncodings,
    labelDecorations,
    annotations,
    metadataByIdNo,
  } = opts;
  const path = treeFilterPath;
  // Per-cell colour + orthogonal dash/symbol; falls back to plain identity
  // colour when no encoding map was supplied.
  const encFields = (cell: CyclingCellLike): { color: string; dash?: LineDash; symbol?: MarkerSymbol } => {
    const enc = cellEncodings && getCellEncoding(cellEncodings, cell);
    return enc
      ? { color: enc.color, dash: enc.dash, symbol: enc.symbol }
      : { color: colorForIndividualCell(cell) };
  };
  const pathPrefix = path.map((p) => p.val).filter(Boolean).join('|');
  const hasSelection = path.length > 0;

  const seriesForCell = (cell: CyclingCellLike): number[] => {
    if (direction === 'charge') {
      return cell.chargeCapacityMah ?? [];
    }
    return useSpecificCapacity ? cell.specificCapacityMahG ?? cell.dischargeCapacityMah : cell.dischargeCapacityMah;
  };

  const valueForCell = (cell: CyclingCellLike, field: GroupField): string =>
    resolveHierarchyCellValue(cell, field, metadataByIdNo?.get(cell.idNo));

  if (!hasSelection) {
    return filteredCells.map((row) => {
      const yVals = seriesForCell(row);
      const hasCrate = !!(row.cRates && row.cRates.length === row.cycles.length);
      return {
        name: row.cellName ?? `Cell ${row.idNo}`,
        x: row.cycles,
        y: yVals,
        ...encFields(row),
        isAggregated: false,
        cell: row,
        hasCrate,
        cRates: hasCrate ? row.cRates : undefined,
      };
    });
  }

  const { field, parentField, composite, fieldHeader, parentHeader } = getGrouping(path, detailDepth, hierCols);

  // Categorical colours shared with the hierarchy tree: each aggregated band
  // takes the colour its child node shows in the tree. Keyed only by hierCols,
  // so it follows hierarchy reorder. See colorForHierPath.
  const perceptualMaps = assignColourMapPerceptual(hierCols);

  if (normalizeHeaderKey(field) === 'cell' && !composite) {
    return filteredCells.map((row) => {
      const yVals = seriesForCell(row);
      const hasCrate = !!(row.cRates && row.cRates.length === row.cycles.length);
      return {
        name: row.cellName ?? `Cell ${row.idNo}`,
        x: row.cycles,
        y: yVals,
        ...encFields(row),
        isAggregated: false,
        cell: row,
        hasCrate,
        cRates: hasCrate ? row.cRates : undefined,
      };
    });
  }

  if (composite && parentField) {
    const groups = new Map<string, CyclingCellLike[]>();
    filteredCells.forEach((c) => {
      const pk = valueForCell(c, parentField);
      const ck = valueForCell(c, field);
      const displayKey = `${pk} · ${ck}`;
      const arr = groups.get(displayKey) ?? [];
      arr.push(c);
      groups.set(displayKey, arr);
    });
    const sortedKeys = Array.from(groups.keys()).sort();
    const traces: AggregatedTrace[] = [];
    sortedKeys.forEach((displayKey) => {
      const cells = groups.get(displayKey)!;
      const isSingleCell = cells.length === 1;
      const { cycles, values, errorMinus, errorPlus } = aggregateCapacity(
        cells,
        direction === 'charge' ? false : useSpecificCapacity,
        direction,
      );
      const firstCell = cells[0];
      const hasCrate = !!(firstCell?.cRates && firstCell.cycles.length === firstCell.cRates?.length);
      const [pk, ck] = displayKey.split(' · ');
      const pathToParent = pathPrefix === pk ? pathPrefix : (pathPrefix ? `${pathPrefix}|${pk}` : pk);
      const pathKey = detailDepth > 0 ? pathToParent : (pathPrefix ? `${pathPrefix}|${ck}` : ck);
      const displayName = formatTraceName(pk, parentField, parentHeader, hierCols, labelDecorations, annotations)
        + ' · ' + formatTraceName(ck, field, fieldHeader, hierCols, labelDecorations, annotations);
      traces.push({
        name: displayName,
        x: cycles,
        y: values,
        color: colorForHierPath(pathKey, perceptualMaps, pathToColorMap),
        isAggregated: !isSingleCell,
        hasCrate: isSingleCell ? hasCrate : false,
        cRates: isSingleCell && hasCrate ? firstCell?.cRates : undefined,
        errorMinus: !isSingleCell ? errorMinus : undefined,
        errorPlus: !isSingleCell ? errorPlus : undefined,
      });
    });
    return traces;
  }

  const groups = new Map<string, CyclingCellLike[]>();
  filteredCells.forEach((c) => {
    const key = valueForCell(c, field);
    const arr = groups.get(key) ?? [];
    arr.push(c);
    groups.set(key, arr);
  });
  const sortedKeys = Array.from(groups.keys()).filter(Boolean).sort();
  const traces: AggregatedTrace[] = [];

  sortedKeys.forEach((key) => {
    const cells = groups.get(key)!;
    const { cycles, values, errorMinus, errorPlus } = aggregateCapacity(
      cells,
      direction === 'charge' ? false : useSpecificCapacity,
      direction,
    );
    const pathKey = detailDepth > 0 && pathPrefix ? pathPrefix : (pathPrefix ? `${pathPrefix}|${key}` : key);
    const displayName = formatTraceName(key, field, fieldHeader, hierCols, labelDecorations, annotations);
    traces.push({
      name: displayName,
      x: cycles,
      y: values,
      color: colorForPath(pathKey, pathToColorMap),
      isAggregated: true,
      hasCrate: false,
      cRates: undefined,
      errorMinus,
      errorPlus,
    });
  });

  return traces;
}

/** Get color for a cell (e.g. initial voltage chart). Same path string = same color everywhere. */
export function getColorForCell(
  cell: CellColorAttrs,
  _treeFilterPath: TreeFilterPath,
  _hierCols: ColStats[],
  _pathToColorMap?: Map<string, string>,
): string {
  return colorForIndividualCell(cell);
}
