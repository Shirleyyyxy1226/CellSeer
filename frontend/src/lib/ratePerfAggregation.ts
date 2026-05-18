/**
 * Aggregation and color logic for rate performance plots when tree selection is active.
 * When a higher-level node is selected, show average traces per next-level group with matched colors.
 */

import type { TreeFilterPath } from '@/components/tree/HierarchyTreeSidebar';
import { stringToColor, formatNodeLabel } from './treeUtils';
import type { ColStats, LabelDecoration } from './treeUtils';

export type { RatePerfCellRaw as NewareCellLike } from '@/lib/cellTypes';

const DEFAULT_COLOR = '#6b7280';

function colorFromCellIdentity(cell: NewareCellLike): string {
  const identity = (cell.cellName ?? cell.cellId ?? `Cell ${cell.idNo}`).trim();
  const match = identity.match(/(\d+)/);
  if (match) {
    return stringToColor(`x|y|z|Cell ${match[1]}`);
  }
  return stringToColor(identity);
}

/** Build cell name → color map. Same cell path always gets same color (string-based, perceptually uniform). */
export function buildCanonicalCellColorMap(allCells: NewareCellLike[]): Map<string, string> {
  const map = new Map<string, string>();
  allCells.forEach((c) => {
    const cellKey = c.cellName ?? `Cell ${c.idNo}`;
    map.set(cellKey, colorFromCellIdentity(c));
  });
  return map;
}

/** Path key format: cathode, cathode|separator, cathode|separator|spacer, or cathode|separator|spacer|cellName. */
export function pathKeyForCell(cell: NewareCellLike, upToLevel: 0 | 1 | 2 | 3): string {
  const parts = [
    cell.cathode ?? '',
    cell.separatorType ?? '',
    String(cell.spacerMm ?? ''),
    cell.cellName ?? `Cell ${cell.idNo}`,
  ];
  return parts.slice(0, upToLevel + 1).filter(Boolean).join('|');
}

/** Get color for a cell from the canonical map. */
export function getCellColorFromMap(
  cell: NewareCellLike,
  cellColorMap: Map<string, string>,
): string {
  const key = cell.cellName ?? `Cell ${cell.idNo}`;
  return cellColorMap.get(key) ?? colorFromCellIdentity(cell);
}

/** Build path→color map. With hierCols, uses hierarchy order so chart colors match tree nodes. */
export function buildPathToColorMap(
  allCells: NewareCellLike[],
  hierCols?: ColStats[],
): Map<string, string> {
  const seen = new Set<string>();
  if (hierCols && hierCols.length > 0) {
    allCells.forEach((c) => {
      const vals = hierCols.map((col) => getCellVal(c, col.header));
      for (let i = 0; i < vals.length; i++) {
        const key = vals.slice(0, i + 1).filter(Boolean).join('|');
        if (key) seen.add(key);
      }
    });
  } else {
    allCells.forEach((c) => {
      for (const level of [0, 1, 2] as const) {
        const key = pathKeyForCell(c, level);
        if (key) seen.add(key);
      }
    });
  }
  const map = new Map<string, string>();
  seen.forEach((key) => map.set(key, stringToColor(key)));
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

function getCellVal(cell: NewareCellLike, field: GroupField): string {
  const normalized = normalizeHeaderKey(field);
  const aliasFields = HEADER_ALIAS_FIELDS[normalized] ?? [];
  const dynamicFields = [
    field,
    normalized,
    normalized.replace(/_/g, ''),
    field.replace(/\s+/g, ''),
  ];
  const candidates = [...new Set([...aliasFields, ...dynamicFields])];
  const cellRecord = cell as Record<string, unknown>;
  const keyMap = new Map<string, string>();
  Object.keys(cellRecord).forEach((k) => keyMap.set(normalizeHeaderKey(k), k));
  for (const key of candidates) {
    if (key in cellRecord) {
      const raw = cellRecord[key];
      if (raw != null && String(raw).trim() !== '') return String(raw).trim();
    }
    const mapped = keyMap.get(normalizeHeaderKey(key));
    if (!mapped) continue;
    const raw = cellRecord[mapped];
    if (raw != null && String(raw).trim() !== '') return String(raw).trim();
  }
  if (normalized === 'cell' || normalized === 'cell_id' || normalized === 'id_no' || normalized === 'idno') {
    return cell.cellName ?? `Cell ${cell.idNo}`;
  }
  return '';
}

/** Path key in hierarchy order – matches tree pathFromRoot for color alignment. */
function pathKeyInOrder(cell: NewareCellLike, hierCols: ColStats[], upToLevel: number): string {
  const parts: string[] = [];
  for (let i = 0; i <= upToLevel && i < hierCols.length; i++) {
    const col = hierCols[i];
    parts.push(getCellVal(cell, col.header));
  }
  if (upToLevel >= hierCols.length) {
    parts.push(cell.cellName ?? `Cell ${cell.idNo}`);
  }
  return parts.filter(Boolean).join('|');
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
  cells: NewareCellLike[],
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
    errorMinus = cycles.map((cy) => {
      const arr = valsByCycle.get(cy) ?? [];
      const mean = values[cycles.indexOf(cy)];
      if (arr.length < 2) return 0;
      const min = Math.min(...arr);
      return mean - min;
    });
    errorPlus = cycles.map((cy) => {
      const arr = valsByCycle.get(cy) ?? [];
      const mean = values[cycles.indexOf(cy)];
      if (arr.length < 2) return 0;
      const max = Math.max(...arr);
      return max - mean;
    });
  }

  return { cycles, values, errorMinus, errorPlus };
}

/** Group cells by field value. */
function groupCells<T extends NewareCellLike>(
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
function groupCellsByComposite<T extends NewareCellLike>(
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
  isAggregated: boolean;
  cell?: NewareCellLike;
  hasCrate: boolean;
  cRates?: number[];
  /** Asymmetric error bars: distance from mean down to min (errorMinus) and up to max (errorPlus). */
  errorMinus?: number[];
  errorPlus?: number[];
}

export interface TraceOptions {
  filteredCells: NewareCellLike[];
  treeFilterPath: TreeFilterPath;
  hierCols: ColStats[];
  useSpecificCapacity: boolean;
  direction?: 'discharge' | 'charge';
  /** How many levels to drill down from the default (0 = first level below path). */
  detailDepth?: number;
  /** Path→color map (string-based, perceptually uniform). Same string = same color everywhere. */
  pathToColorMap?: Map<string, string>;
  /** Format trace names to match hierarchy labels (e.g. "1" → "Sp 1.0 mm"). */
  labelDecorations?: LabelDecoration[];
  annotations?: Array<{ map: Record<string, string>; unit?: string } | null>;
}

function colorForPath(pathKey: string, pathToColorMap?: Map<string, string>): string {
  return pathToColorMap?.get(pathKey) ?? stringToColor(pathKey);
}

function colorForIndividualCell(cell: NewareCellLike): string {
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
    labelDecorations,
    annotations,
  } = opts;
  const path = treeFilterPath;
  const pathPrefix = path.map((p) => p.val).filter(Boolean).join('|');
  const hasSelection = path.length > 0;

  const seriesForCell = (cell: NewareCellLike): number[] => {
    if (direction === 'charge') {
      return cell.chargeCapacityMah ?? [];
    }
    return useSpecificCapacity ? cell.specificCapacityMahG ?? cell.dischargeCapacityMah : cell.dischargeCapacityMah;
  };

  if (!hasSelection) {
    return filteredCells.map((row) => {
      const yVals = seriesForCell(row);
      const hasCrate = !!(row.cRates && row.cRates.length === row.cycles.length);
      return {
        name: row.cellName ?? `Cell ${row.idNo}`,
        x: row.cycles,
        y: yVals,
        color: colorForIndividualCell(row),
        isAggregated: false,
        cell: row,
        hasCrate,
        cRates: hasCrate ? row.cRates : undefined,
      };
    });
  }

  const { field, parentField, composite, fieldHeader, parentHeader } = getGrouping(path, detailDepth, hierCols);

  if (normalizeHeaderKey(field) === 'cell' && !composite) {
    return filteredCells.map((row) => {
      const yVals = seriesForCell(row);
      const hasCrate = !!(row.cRates && row.cRates.length === row.cycles.length);
      return {
        name: row.cellName ?? `Cell ${row.idNo}`,
        x: row.cycles,
        y: yVals,
        color: colorForIndividualCell(row),
        isAggregated: false,
        cell: row,
        hasCrate,
        cRates: hasCrate ? row.cRates : undefined,
      };
    });
  }

  if (composite && parentField) {
    const { groups } = groupCellsByComposite(filteredCells, parentField, field);
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
        color: colorForPath(pathKey, pathToColorMap),
        isAggregated: !isSingleCell,
        hasCrate: isSingleCell ? hasCrate : false,
        cRates: isSingleCell && hasCrate ? firstCell?.cRates : undefined,
        errorMinus: !isSingleCell ? errorMinus : undefined,
        errorPlus: !isSingleCell ? errorPlus : undefined,
      });
    });
    return traces;
  }

  const groups = groupCells(filteredCells, field);
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
  cell: NewareCellLike,
  _treeFilterPath: TreeFilterPath,
  _hierCols: ColStats[],
  _pathToColorMap?: Map<string, string>,
): string {
  return colorForIndividualCell(cell);
}
