import type { Dataset, DqDvCyclePoint } from '../types';

export interface CellRecordLike {
  id?: string;
  cellId?: string;
  label?: string;
  cellName?: string;
  name?: string;
  color?: string;
  cycles?: unknown;
  dqdv?: unknown;
}

export type DatasetInput = Dataset | CellRecordLike;
export type DatasetsInput = DatasetInput | DatasetInput[] | Record<string, DatasetInput>;

function hasCurves(input: unknown): input is { cycles?: unknown; dqdv?: unknown } {
  if (!input || typeof input !== 'object') return false;
  const obj = input as Record<string, unknown>;
  return Array.isArray(obj.cycles) || typeof obj.dqdv === 'object';
}

function looksLikeRecord(input: unknown): input is DatasetInput {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  if (hasCurves(input)) return true;
  const obj = input as Record<string, unknown>;
  return (
    typeof obj.id === 'string' ||
    typeof obj.cellId === 'string' ||
    typeof obj.label === 'string' ||
    typeof obj.cellName === 'string' ||
    typeof obj.name === 'string'
  );
}

function toDqDvCycles(cycles: unknown): DqDvCyclePoint[] {
  if (!Array.isArray(cycles)) return [];
  return cycles
    .map((entry) => {
      if (!entry || typeof entry !== 'object') return null;
      const row = entry as Record<string, unknown>;
      const cycle = Number(row.cycle);
      const v = Array.isArray(row.v)
        ? row.v.map(Number)
        : Array.isArray(row.x)
          ? row.x.map(Number)
          : [];
      const dqdv = Array.isArray(row.dqdv)
        ? row.dqdv.map(Number)
        : Array.isArray(row.y)
          ? row.y.map(Number)
          : [];
      if (!Number.isFinite(cycle) || v.length === 0 || dqdv.length === 0) return null;
      return { cycle, v, dqdv };
    })
    .filter((point): point is DqDvCyclePoint => point !== null);
}

function toCycles(input: CellRecordLike): Dataset['cycles'] {
  const directCycles = toDqDvCycles(input.cycles);
  if (directCycles.length > 0) {
    return directCycles.map((c) => ({ cycle: c.cycle, x: c.v, y: c.dqdv }));
  }

  if (!input.dqdv || typeof input.dqdv !== 'object') return [];
  const out: Dataset['cycles'] = [];
  for (const [cycleKey, value] of Object.entries(input.dqdv as Record<string, unknown>)) {
    if (!value || typeof value !== 'object') continue;
    const row = value as Record<string, unknown>;
    const cycle = Number(cycleKey);
    const v = Array.isArray(row.v) ? row.v.map(Number) : [];
    const dqdv = Array.isArray(row.dqdv) ? row.dqdv.map(Number) : [];
    if (!Number.isFinite(cycle) || v.length === 0 || dqdv.length === 0) continue;
    out.push({ cycle, x: v, y: dqdv });
  }
  return out.sort((a, b) => a.cycle - b.cycle);
}

function normalizeOne(input: DatasetInput, index: number, labelHint?: string): Dataset {
  if ('cycles' in input && Array.isArray(input.cycles) && 'id' in input && 'label' in input) {
    return input as Dataset;
  }
  const record = input as CellRecordLike;
  const id = record.id ?? record.cellId ?? record.label ?? record.cellName ?? record.name ?? `dataset-${index + 1}`;
  const label = record.label ?? labelHint ?? record.cellName ?? record.name ?? id;
  return {
    id,
    label,
    color: record.color,
    cycles: toCycles(record),
  };
}

export function normalizeCyclerDatasets(input: DatasetsInput): Dataset[] {
  if (Array.isArray(input)) {
    return input.map((entry, idx) => normalizeOne(entry, idx)).filter((d) => d.cycles.length > 0);
  }

  if (looksLikeRecord(input)) {
    return [normalizeOne(input, 0)].filter((d) => d.cycles.length > 0);
  }

  const out: Dataset[] = [];
  let idx = 0;
  for (const [name, value] of Object.entries(input)) {
    if (!looksLikeRecord(value)) continue;
    out.push(normalizeOne(value, idx, name));
    idx += 1;
  }
  return out.filter((d) => d.cycles.length > 0);
}
