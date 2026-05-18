/**
 * Master Plot 2 — parallel coordinates: axis defs, cycle sampling, brush filtering.
 */

import type { ProtocolSegment } from '@/lib/masterPlot1Metrics';
import type { CellMetricRow, DimKey } from '@/lib/masterPlot1Metrics';
import { getCategoricalValue, mainCyclingSegment } from '@/lib/masterPlot1Metrics';

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

export function cyclesInSegment(seg: ProtocolSegment, allCycles: number[]): number[] {
  return allCycles.filter((c) => c >= seg.cycleStart && c <= seg.cycleEnd);
}

/** Instrument cycles present on `row` that fall in its main cycling segment (or all cycles if segment metadata is missing). */
export function instrumentCyclesInMainPhase(row: CellMetricRow): number[] {
  const seg = mainCyclingSegment(row.protocolSegments);
  const out: number[] = [];
  for (const c of row.cycles) {
    if (!seg || (c >= seg.cycleStart && c <= seg.cycleEnd)) out.push(c);
  }
  return out;
}

/**
 * Cycles every visible cell records within its own main cycling phase — intersection across `rows`.
 * Empty means no single instrument cycle is shared in-phase by all cells (e.g. disjoint protocols).
 */
export function consensusInstrumentCyclesInMainPhase(rows: CellMetricRow[]): number[] {
  if (!rows.length) return [];
  let common = new Set(instrumentCyclesInMainPhase(rows[0]));
  for (let i = 1; i < rows.length; i++) {
    const next = new Set(instrumentCyclesInMainPhase(rows[i]));
    common = new Set([...common].filter((c) => next.has(c)));
  }
  return [...common].sort((a, b) => a - b);
}

/** Overlap of main-segment cycle ranges; only rows with a resolved main segment contribute. */
export function overlappingMainSegmentCycleWindow(rows: CellMetricRow[]): { lo: number; hi: number } | null {
  const segs: ProtocolSegment[] = [];
  for (const r of rows) {
    const s = mainCyclingSegment(r.protocolSegments);
    if (s) segs.push(s);
  }
  if (!segs.length) return null;
  const lo = Math.max(...segs.map((s) => s.cycleStart));
  const hi = Math.min(...segs.map((s) => s.cycleEnd));
  if (lo > hi) return null;
  return { lo, hi };
}

export function sampleCyclesAutoFromList(availSorted: number[]): number[] {
  const avail = [...new Set(availSorted)].sort((a, b) => a - b);
  if (avail.length === 0) return [];
  const at = (q: number) => avail[Math.min(avail.length - 1, Math.max(0, Math.round((avail.length - 1) * q)))];
  const raw = [at(0.12), at(0.5), at(0.88)];
  return [...new Set(raw)].sort((a, b) => a - b);
}

export function sampleCyclesEvery10FromList(availSorted: number[]): number[] {
  const avail = [...new Set(availSorted)].sort((a, b) => a - b);
  if (avail.length === 0) return [];
  const out: number[] = [];
  for (let i = 0; i < avail.length; i++) {
    if (i % 10 === 0 || i === avail.length - 1) out.push(avail[i]);
  }
  return [...new Set(out)];
}

export function sampleCyclesAuto(seg: ProtocolSegment, unionCycles: number[]): number[] {
  const avail = [...new Set(unionCycles.filter((c) => c >= seg.cycleStart && c <= seg.cycleEnd))].sort(
    (a, b) => a - b,
  );
  return sampleCyclesAutoFromList(avail);
}

export function sampleCyclesEvery10(seg: ProtocolSegment, unionCycles: number[]): number[] {
  const avail = [...new Set(unionCycles.filter((c) => c >= seg.cycleStart && c <= seg.cycleEnd))].sort(
    (a, b) => a - b,
  );
  return sampleCyclesEvery10FromList(avail);
}

export function unionInstrumentCycles(rows: CellMetricRow[]): number[] {
  const s = new Set<number>();
  for (const r of rows) for (const c of r.cycles) s.add(c);
  return [...s].sort((a, b) => a - b);
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

export function continuousNorm(v: number, vmin: number, vmax: number): number {
  const span = Math.max(1e-9, vmax - vmin);
  return (vmax - v) / span;
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

/** Default PC layout: mean Ret / mean CE over each cell's main cycling segment (fair cross-protocol comparison). */
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
      id: 'fce',
      kind: 'continuous',
      group: 'formation',
      scalar: 'formation_ce',
      label: 'F.CE',
      confKind: 'ce',
    },
    {
      id: 'ret_mean_main',
      kind: 'continuous',
      group: 'cycling',
      scalar: 'retention_mean_main',
      label: 'Ret̄ (main)',
      confKind: 'retention',
    },
    {
      id: 'ce_mean_main',
      kind: 'continuous',
      group: 'cycling',
      scalar: 'ce_mean_main',
      label: 'CĒ (main)',
      confKind: 'ce',
    },
    {
      id: 'fade',
      kind: 'continuous',
      group: 'summary',
      scalar: 'fade_rate',
      label: 'Fade',
      confKind: 'retention',
    },
  ];
}

export const ADDABLE_AXES: PCAxisDef[] = [
  { id: 'electrolyte', kind: 'categorical', group: 'input', catKey: 'electrolyte', label: 'Electrolyte' },
  { id: 'protocol', kind: 'categorical', group: 'input', catKey: 'protocol', label: 'Protocol' },
  { id: 'c_rate_group', kind: 'categorical', group: 'input', catKey: 'c_rate_group', label: 'C-rate grp' },
  { id: 'ce_main', kind: 'continuous', group: 'formation', scalar: 'ce_main', label: 'CĒ main', confKind: 'ce' },
  { id: 'ret_end', kind: 'continuous', group: 'summary', scalar: 'retention_end', label: 'Ret (end)', confKind: 'retention' },
  { id: 'cap_end', kind: 'continuous', group: 'summary', scalar: 'capacity_end', label: 'Cap (end)' },
];

export function findAddableAxis(id: string): PCAxisDef | undefined {
  return ADDABLE_AXES.find((a) => a.id === id);
}
