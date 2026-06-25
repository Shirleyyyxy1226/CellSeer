/**
 * Master Plot 2 — parallel coordinates: axis defs and cycle sampling.
 */

import type { CellMetricRow, DimKey } from '@/lib/cellMetricRows';
import { getCategoricalValue } from '@/lib/cellMetricRows';

export type PCAxisGroup = 'input' | 'formation' | 'cycling' | 'summary';

export type PCAxisKind = 'categorical' | 'continuous' | 'per_cycle';

export type PCMetricKey = 'retention' | 'ce' | 'capacity';

export interface PCAxisCategorical {
  id: string;
  kind: 'categorical';
  group: PCAxisGroup;
  catKey: DimKey;
  label: string;
  /** Confidence: retention=1, CE=2, generic=3 */
  confKind?: 'retention' | 'ce' | 'none';
}

export interface PCAxisContinuous {
  id: string;
  kind: 'continuous';
  group: PCAxisGroup;
  scalar: 'ice' | 'capacity_end' | 'capacity_peak' | 'cycle_count';
  label: string;
  confKind?: 'retention' | 'ce' | 'none';
}

export interface PCAxisPerCycle {
  id: string;
  kind: 'per_cycle';
  group: PCAxisGroup;
  metric: PCMetricKey;
  /** Instrument cycle number (must exist in row.cycles for a cell to have a value). */
  cycle: number;
  label: string;
  confKind?: 'retention' | 'ce' | 'none';
}

export type PCAxisDef = PCAxisCategorical | PCAxisContinuous | PCAxisPerCycle;

export function axisLabel(def: PCAxisDef): string {
  return def.label;
}

/** Concise one-line definitions surfaced behind an info icon on the axis head. */
const AXIS_DESCRIPTIONS: Record<string, string> = {
  ice: 'CE of the first non-zero cycle',
};

/** Optional one-line explanation for an axis, shown in a hover info card. */
export function axisDescription(def: PCAxisDef): string | undefined {
  return AXIS_DESCRIPTIONS[def.id];
}

function cycleIndexFor(row: CellMetricRow, instrumentCycle: number): number {
  return row.cycles.indexOf(instrumentCycle);
}

/** 95th-percentile capacity — robust "what this cell can deliver" vs noisy end-of-test values. */
function valuePeakCapacity(row: CellMetricRow): number | null {
  const vals = row.specificMahG.filter((v) => v != null && Number.isFinite(v) && v > 0);
  if (!vals.length) return null;
  vals.sort((a, b) => a - b);
  return vals[Math.min(vals.length - 1, Math.round((vals.length - 1) * 0.95))];
}

function valueCycleCount(row: CellMetricRow): number {
  return row.specificMahG.filter((v) => v != null && Number.isFinite(v) && v > 0).length;
}

export function getAxisNumericValue(row: CellMetricRow, def: PCAxisDef): number | null {
  if (def.kind === 'categorical') return null;
  if (def.kind === 'continuous') {
    switch (def.scalar) {
      case 'ice':
        return row.iceScalar;
      case 'capacity_end':
        return row.capacityScalar;
      case 'capacity_peak':
        return valuePeakCapacity(row);
      case 'cycle_count':
        return valueCycleCount(row);
      default:
        return null;
    }
  }
  const ix = cycleIndexFor(row, def.cycle);
  if (ix < 0) return null;
  switch (def.metric) {
    case 'retention':
      return row.retentionSeries[ix] ?? null;
    case 'ce':
      return row.ceSeries[ix] ?? null;
    case 'capacity':
      return row.specificMahG[ix] ?? null;
    default:
      return null;
  }
}

export function getCategoricalBand(
  row: CellMetricRow,
  def: PCAxisCategorical,
  domain: string[],
  counts: Map<string, number>,
): { cat: string; n0: number; n1: number; yCenter: number } | null {
  const cat = getCategoricalValue(row, def.catKey);
  if (!domain.length) return null;
  const total = domain.reduce((s, d) => s + (counts.get(d) ?? 0), 0) || 1;
  let acc = 0;
  for (const d of domain) {
    const frac = (counts.get(d) ?? 0) / total;
    const n0 = acc;
    const n1 = acc + frac;
    if (d === cat) {
      const yCenter = n0 + frac / 2;
      return { cat, n0, n1, yCenter };
    }
    acc = n1;
  }
  const yCenter = 0.5;
  return { cat, n0: 0, n1: 1, yCenter };
}

/**
 * Normalised vertical position (0 = top, 1 = bottom). The domain [vmin, vmax]
 * may be a robust (p1–p99) window, so out-of-window values are clamped to the
 * axis ends rather than drawn off-track — this keeps a runaway outlier pinned at
 * the top tick instead of stretching every other line onto the baseline.
 */
export function continuousNorm(v: number, vmin: number, vmax: number): number {
  const span = Math.max(1e-9, vmax - vmin);
  const n = (vmax - v) / span;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}

/**
 * Default PC layout — a curated set of metrics that suit a parallel plot: a stable
 * per-cell *level* that (nearly) every cell has and that compares fairly. Inputs
 * (cathode/separator/spacer) plus cycle count and end capacity.
 * Retention and CE are deliberately NOT axes (here or as opt-ins): without protocol
 * segmentation their baseline / main-cycling window is undefined, so the values can
 * exceed 100% and mislead. The dQ/dV peak-shift metric is likewise excluded as
 * unsuitable for a parallel plot.
 */
export function defaultParallelCoordAxes(): PCAxisDef[] {
  return [
    {
      id: 'cathode',
      kind: 'categorical',
      group: 'input',
      catKey: 'cathode',
      label: 'Cathode',
      confKind: 'none',
    },
    {
      id: 'separator',
      kind: 'categorical',
      group: 'input',
      catKey: 'separator',
      label: 'Separator',
      confKind: 'none',
    },
    {
      id: 'spacer',
      kind: 'categorical',
      group: 'input',
      catKey: 'spacer',
      label: 'Spacer',
      confKind: 'none',
    },
    {
      id: 'cycles',
      kind: 'continuous',
      group: 'cycling',
      scalar: 'cycle_count',
      label: 'Cycles',
      confKind: 'none',
    },
    {
      id: 'cap_end',
      kind: 'continuous',
      group: 'summary',
      scalar: 'capacity_end',
      label: 'End capacity',
      confKind: 'none',
    },
  ];
}

/** Opt-in axes beyond the default view. Retention / CE / fade / cycle-life / CE-drift /
 *  peak-shift are intentionally absent — without protocol segmentation they mislead,
 *  and they are unsuitable for a parallel plot anyway. */
const EXTRA_AXES: PCAxisDef[] = [
  { id: 'electrolyte', kind: 'categorical', group: 'input', catKey: 'electrolyte', label: 'Electrolyte', confKind: 'none' },
  { id: 'ice', kind: 'continuous', group: 'formation', scalar: 'ice', label: 'ICE', confKind: 'ce' },
  { id: 'cap_peak', kind: 'continuous', group: 'cycling', scalar: 'capacity_peak', label: 'Peak cap', confKind: 'none' },
];

/**
 * Full catalog of selectable axes = the default view plus the opt-in extras, unique
 * by id. Because every default is also here, removing any axis (even a default)
 * returns it to the "Add metric" menu — so add/remove is fully reversible.
 */
export const ADDABLE_AXES: PCAxisDef[] = (() => {
  const seen = new Set<string>();
  const out: PCAxisDef[] = [];
  for (const a of [...defaultParallelCoordAxes(), ...EXTRA_AXES]) {
    if (seen.has(a.id)) continue;
    seen.add(a.id);
    out.push(a);
  }
  return out;
})();

export function findAddableAxis(id: string): PCAxisDef | undefined {
  return ADDABLE_AXES.find((a) => a.id === id);
}
