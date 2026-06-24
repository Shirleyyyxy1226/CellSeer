/**
 * Master Plot 2 — parallel coordinates: axis defs, cycle sampling, brush filtering.
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
  scalar:
    | 'ice'
    | 'formation_ce'
    | 'ce_main'
    | 'fade_rate'
    | 'retention_end'
    | 'capacity_end'
    | 'capacity_peak'
    | 'cycle_count'
    | 'retention_mean_main'
    | 'ce_mean_main';
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

/** Normalized vertical position: 0 = top (high value for continuous), 1 = bottom. */
export type BrushRange = { n0: number; n1: number };

export function axisLabel(def: PCAxisDef): string {
  return def.label;
}

/** Concise one-line definitions surfaced behind an ⓘ on the axis head. */
const AXIS_DESCRIPTIONS: Record<string, string> = {
  ice: 'CE of the first non-zero cycle',
};

/** Optional one-line explanation for an axis, shown as an info tooltip. */
export function axisDescription(def: PCAxisDef): string | undefined {
  return AXIS_DESCRIPTIONS[def.id];
}

function cycleIndexFor(row: CellMetricRow, instrumentCycle: number): number {
  return row.cycles.indexOf(instrumentCycle);
}

function valueFormationCe(row: CellMetricRow): number | null {
  const segs = row.protocolSegments;
  const cyc = row.cycles;
  const ce = row.ceSeries;
  if (!ce.length) return null;
  if (!segs.length) return ce[0] ?? null;
  const first = segs[0];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < cyc.length; i++) {
    if (cyc[i] >= first.cycleStart && cyc[i] <= first.cycleEnd && Number.isFinite(ce[i])) {
      sum += ce[i];
      n++;
    }
  }
  return n > 0 ? sum / n : null;
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
      case 'formation_ce':
        return valueFormationCe(row);
      case 'ce_main':
        return row.ceScalar;
      case 'fade_rate':
        return row.fadeRate;
      case 'retention_end':
        return row.retentionScalar;
      case 'capacity_end':
        return row.capacityScalar;
      case 'capacity_peak':
        return valuePeakCapacity(row);
      case 'cycle_count':
        return valueCycleCount(row);
      case 'retention_mean_main':
        return row.retentionMeanMain;
      case 'ce_mean_main':
        return row.ceMeanMain;
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

export function brushOverlaps(a0: number, a1: number, b0: number, b1: number): boolean {
  const loA = Math.min(a0, a1);
  const hiA = Math.max(a0, a1);
  const loB = Math.min(b0, b1);
  const hiB = Math.max(b0, b1);
  return hiA >= loB && hiB >= loA;
}

export interface BrushState {
  /** axis id -> normalized brush [0,1] along axis track */
  [axisId: string]: BrushRange;
}

export function computeBrushPassing(
  rows: CellMetricRow[],
  axes: PCAxisDef[],
  brushes: BrushState,
  categoricalDomains: Map<string, { domain: string[]; counts: Map<string, number> }>,
  continuousExtents: Map<string, { min: number; max: number }>,
): Set<number> {
  const passing = new Set<number>();
  const brushIds = Object.keys(brushes);
  if (brushIds.length === 0) {
    for (const r of rows) passing.add(r.idNo);
    return passing;
  }

  for (const row of rows) {
    let ok = true;
    for (const bid of brushIds) {
      const br = brushes[bid];
      const def = axes.find((a) => a.id === bid);
      if (!def) continue;
      if (def.kind === 'categorical') {
        const meta = categoricalDomains.get(def.id);
        if (!meta) {
          ok = false;
          break;
        }
        const band = getCategoricalBand(row, def, meta.domain, meta.counts);
        if (!band) {
          ok = false;
          break;
        }
        const c0 = band.n0;
        const c1 = band.n1;
        if (!brushOverlaps(br.n0, br.n1, c0, c1)) {
          ok = false;
          break;
        }
      } else {
        const v = getAxisNumericValue(row, def);
        if (v == null || Number.isNaN(v)) {
          ok = false;
          break;
        }
        const ex = continuousExtents.get(def.id);
        if (!ex) {
          ok = false;
          break;
        }
        const nv = continuousNorm(v, ex.min, ex.max);
        const lo = Math.min(br.n0, br.n1);
        const hi = Math.max(br.n0, br.n1);
        if (nv < lo || nv > hi) {
          ok = false;
          break;
        }
      }
    }
    if (ok) passing.add(row.idNo);
  }
  return passing;
}

/**
 * Default PC layout — a curated set of metrics that suit a parallel plot: a stable
 * per-cell *level* that (nearly) every cell has and that compares fairly. Inputs
 * (cathode/separator/spacer) plus peak capacity, ICE and capacity retention.
 * Trend/slope/sparse metrics (fade rate, cycle-life-80, CE drift, dQ/dV peak shift)
 * are deliberately NOT axes here — they are null-heavy or protocol-/length-sensitive
 * and mislead on a parallel plot. CE and other levels are opt-in via ADDABLE_AXES.
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
      id: 'ice',
      kind: 'continuous',
      group: 'formation',
      scalar: 'ice',
      label: 'ICE',
      confKind: 'ce',
    },
    {
      // Peak capacity replaces F.CE as a default: without protocol segments,
      // formation CE degenerates to a constant 100 for every cell (proxy origin).
      id: 'cap_peak',
      kind: 'continuous',
      group: 'cycling',
      scalar: 'capacity_peak',
      label: 'Peak cap',
      confKind: 'none',
    },
    {
      id: 'ret_end',
      kind: 'continuous',
      group: 'summary',
      scalar: 'retention_end',
      label: 'Retention',
      confKind: 'retention',
    },
  ];
}

/** Opt-in axes beyond the default view. CE lives here (true value, may be blank for
 *  cells without charge data); fade/cycle-life/CE-drift/peak-shift are intentionally
 *  absent — they are unsuitable for a parallel plot. */
const EXTRA_AXES: PCAxisDef[] = [
  { id: 'electrolyte', kind: 'categorical', group: 'input', catKey: 'electrolyte', label: 'Electrolyte', confKind: 'none' },
  { id: 'ce_main', kind: 'continuous', group: 'cycling', scalar: 'ce_main', label: 'CE', confKind: 'ce' },
  { id: 'cycles', kind: 'continuous', group: 'cycling', scalar: 'cycle_count', label: 'Cycles', confKind: 'none' },
  { id: 'cap_end', kind: 'continuous', group: 'summary', scalar: 'capacity_end', label: 'End capacity', confKind: 'none' },
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
