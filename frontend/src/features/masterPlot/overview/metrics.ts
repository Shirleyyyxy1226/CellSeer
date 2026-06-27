/**
 * Project-overview data model: per-cell summaries derived from the raw
 * rate-performance payload, and the metric registry that drives every
 * overview visual (heatmap colour, ranking bars, treemap colour, KPIs).
 *
 * Per-cell scalars come from the server overview aggregate (see
 * summariesFromOverview); this module owns the metric registry and the
 * per-cycle capacity-series extraction the aggregate omits.
 *
 * To add a metric: extend CellSummary and the backend per-cell output, then
 * append a MetricDef to METRICS — the heatmap, ranking, treemap, metric
 * selector and inspector pick it up automatically.
 *
 * NOTE: the treemap view (LibraryTreemap) is in development and not currently
 * mounted; it still consumes this registry for when it is re-enabled.
 */
import type { RatePerfCell } from '@/lib/cellTypes';

export interface CellSummary {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  hasProtocol: boolean;
  protocolName: string | null;
  cycleCount: number;
  /** Peak specific capacity, mAh/g (95th percentile) — null when cathode mass is unknown. */
  peakCapacitySpec: number | null;
  /** Peak raw discharge capacity, mAh (95th percentile) — always computable from cycling data. */
  peakCapacityRaw: number | null;
  /** Median coulombic efficiency, %. Null until segment-aware (main-cycling-only)
   *  computation lands — the full-series median mixes formation / rate-test /
   *  main-cycling phases into a misleading value (it can even exceed 100%). The
   *  UI shows "coming soon". */
  medianCE: number | null;
  /** Capacity retention last/peak, % — only trustworthy with a protocol. Null
   *  until segment-aware computation lands; the UI shows "coming soon". */
  retention: number | null;
  /**
   * dQ/dV dominant-peak voltage shift early→late, mV. Null until the
   * lazy peak-shift aggregate loads, or when the project has no differential
   * data / the peak couldn't be reliably tracked. Populated by a separate merge
   * (it needs the differential Parquet, not the rate payload).
   */
  peakShiftMv: number | null;
  /** Per-cycle capacity for the inspector sparkline (specific when available, else raw). */
  capacitySeries: { cycle: number; value: number }[];
  capacityBasis: 'mAh/g' | 'mAh';
  /** Per-cycle Coulombic efficiency (%) for the trajectories CE view. */
  ceSeries: { cycle: number; value: number }[];
}

export function percentile(sorted: number[], p: number): number {
  if (!sorted.length) return NaN;
  const idx = Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * p)));
  return sorted[idx];
}

function seriesFrom(cycles: number[], values: (number | null)[]): { cycle: number; value: number }[] {
  const out: { cycle: number; value: number }[] = [];
  for (let i = 0; i < cycles.length; i++) {
    const v = values[i];
    if (v != null && Number.isFinite(v) && v > 0) out.push({ cycle: cycles[i], value: v });
  }
  return out;
}

/**
 * Per-cycle capacity series + basis for one cell, used by the inspector
 * sparkline and the Trajectories view. The per-cell scalars (peak capacity,
 * cycle count, …) come from the server overview aggregate; this extracts only
 * the series the aggregate omits, from the lazily-fetched per-cycle payload.
 */
export function capacitySeriesForCell(raw: RatePerfCell): {
  series: { cycle: number; value: number }[];
  basis: 'mAh/g' | 'mAh';
} {
  const cycles = raw.cycles ?? [];
  const specSeries = seriesFrom(cycles, raw.specificCapacityMahG ?? []);
  // Specific capacity needs cathode mass, which DIGIBAT cells often lack —
  // fall back to raw mAh so every cell still gets a sparkline.
  if (specSeries.length) return { series: specSeries, basis: 'mAh/g' };
  return { series: seriesFrom(cycles, raw.dischargeCapacityMah ?? []), basis: 'mAh' };
}

/** Per-cycle Coulombic efficiency (%) = discharge/charge, unclamped. Empty when
 *  the cell has no aligned charge capacity. Note: noisy/phase-mixed cycles can
 *  spike past 100% — this is a raw per-cycle curve, not a protocol-gated scalar. */
export function ceSeriesForCell(raw: RatePerfCell): { cycle: number; value: number }[] {
  const cycles = raw.cycles ?? [];
  const ch = raw.chargeCapacityMah ?? [];
  const dch = raw.dischargeCapacityMah ?? [];
  if (!dch.length || ch.length !== dch.length) return [];
  const out: { cycle: number; value: number }[] = [];
  for (let i = 0; i < cycles.length; i++) {
    const c = ch[i];
    const d = dch[i];
    if (c == null || d == null || c <= 1e-9) continue;
    const ce = (d / c) * 100;
    if (Number.isFinite(ce) && ce > 0) out.push({ cycle: cycles[i], value: ce });
  }
  return out;
}

export interface MetricDef {
  id: string;
  label: string;
  unit: string;
  requiresProtocol: boolean;
  /** Needs cathode mass to compute (specific capacity). Gated in the UI like
   *  requiresProtocol — a lock + "needs cathode mass" notice, not bare "no data". */
  requiresMass?: boolean;
  higherIsBetter: boolean;
  value: (c: CellSummary) => number | null;
  format: (v: number) => string;
  /**
   * Maps a raw value to "goodness" (higher = better) for colour ramps and ranking.
   * Lets CE colour by closeness to 100% instead of treating 102% as best.
   * Defaults to the raw value (negated when !higherIsBetter).
   */
  score?: (v: number) => number;
  /**
   * On-target metrics: the value where the cell is healthiest (e.g. CE → 100%,
   * peak shift → 0). When set, the metric is "diverging" — both below and above
   * the target are worse — so the legend mirrors the ramp with the target
   * (green) at the centre. Omit for ordinary monotonic metrics.
   */
  target?: number;
}

export function metricScore(metric: MetricDef, v: number): number {
  if (metric.score) return metric.score(v);
  return metric.higherIsBetter ? v : -v;
}

/**
 * A metric is "available" for a project when at least one cell has a finite
 * value for it. Coverage, not trust: protocol-locking is a separate
 * gate. Lets the UI grey out a metric (e.g. specific capacity with no cathode
 * mass) instead of rendering an empty view.
 */
export function metricAvailability(
  metrics: MetricDef[],
  cells: CellSummary[],
): Record<string, boolean> {
  const out: Record<string, boolean> = {};
  for (const m of metrics) {
    out[m.id] = cells.some((c) => {
      const v = m.value(c);
      return v != null && Number.isFinite(v);
    });
  }
  return out;
}

export const METRICS: MetricDef[] = [
  {
    id: 'capacity-raw',
    label: 'Peak capacity',
    unit: 'mAh',
    requiresProtocol: false,
    higherIsBetter: true,
    value: (c) => c.peakCapacityRaw,
    format: (v) => (v >= 10 ? v.toFixed(0) : v.toFixed(2)),
  },
  {
    id: 'capacity-spec',
    label: 'Peak specific capacity',
    unit: 'mAh/g',
    requiresProtocol: false,
    requiresMass: true,
    higherIsBetter: true,
    value: (c) => c.peakCapacitySpec,
    format: (v) => v.toFixed(0),
  },
  {
    id: 'ce',
    label: 'Coulombic efficiency',
    unit: '%',
    // Shelved: medianCE is null until segment-aware (main-cycling-only) CE lands;
    // the full-series median is phase-mixed. Protocol-gated so the UI shows the
    // lock → "coming soon" flow, same as retention.
    requiresProtocol: true,
    higherIsBetter: true,
    value: (c) => c.medianCE,
    format: (v) => v.toFixed(2),
    // CE >100% signals a measurement/parasitic anomaly, not a better cell —
    // goodness is closeness to 100%, so both 95% and 105% colour as poor.
    // (Confirmed against the literature: CE approaches but rarely exceeds 100%.)
    score: (v) => -Math.abs(v - 100),
    target: 100,
  },
  {
    id: 'cycles',
    label: 'Cycles completed',
    unit: '',
    requiresProtocol: false,
    higherIsBetter: true,
    value: (c) => (c.cycleCount > 0 ? c.cycleCount : null),
    format: (v) => String(Math.round(v)),
  },
  {
    id: 'retention',
    label: 'Capacity retention',
    unit: '%',
    requiresProtocol: true,
    higherIsBetter: true,
    value: (c) => c.retention,
    format: (v) => v.toFixed(1),
  },
  {
    id: 'dqdv-peak-shift',
    label: 'dQ/dV peak shift',
    unit: 'mV',
    // Shelved (2026-06-26): peakShiftMv is null at source. The previous metric
    // compared early/late cycles blind to C-rate, but ICA peaks shift with C-rate,
    // not only ageing (many cells here are rate tests). A correct version needs
    // same-C-rate windows, which needs protocol segmentation — so it is
    // protocol-gated like CE/retention (lock → "coming soon").
    requiresProtocol: true,
    higherIsBetter: true, // score overrides: a stable peak (≈0 shift) is best
    value: (c) => c.peakShiftMv,
    format: (v) => (v >= 0 ? `+${v.toFixed(0)}` : v.toFixed(0)),
    // Mechanism signal: a peak that barely moves is healthiest; a large shift in
    // either direction flags phase-change / impedance growth.
    score: (v) => -Math.abs(v),
    target: 0,
  },
];
