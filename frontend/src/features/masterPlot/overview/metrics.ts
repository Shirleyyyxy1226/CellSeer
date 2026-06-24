/**
 * Project-overview data model: per-cell summaries derived from the raw
 * rate-performance payload, and the metric registry that drives every
 * overview visual (heatmap colour, ranking bars, treemap colour, KPIs).
 *
 * To add a metric: extend CellSummary (and summariseCell) with the new
 * per-cell value, then append a MetricDef to METRICS — the heatmap,
 * ranking, treemap, metric selector and inspector pick it up automatically.
 */
import type { RatePerfCell } from '@/lib/cellTypes';
import { linregSlope } from './stats';

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
  /** Median coulombic efficiency over meaningful cycles, %. */
  medianCE: number | null;
  /** Capacity retention last/peak, % — only trustworthy with a protocol. */
  retention: number | null;
  /** Capacity fade, % of peak lost per 100 cycles (positive = fading). Needs protocol to be clean. */
  fadeRatePctPer100: number | null;
  /** CE drift, percentage points per 100 cycles (0 = stable). Needs protocol to be clean. */
  ceTrendPctPer100: number | null;
  /** Cycle at which capacity first falls below 80% of peak (standard cycle-life). Needs protocol. */
  cycleLife80: number | null;
  /**
   * dQ/dV dominant-peak voltage shift early→late, mV. Null until the
   * lazy peak-shift aggregate loads, or when the project has no differential
   * data / the peak couldn't be reliably tracked. Populated by merge, not by
   * summariseCell (it needs the differential Parquet, not the rate payload).
   */
  peakShiftMv: number | null;
  /** Per-cycle capacity for the inspector sparkline (specific when available, else raw). */
  capacitySeries: { cycle: number; value: number }[];
  capacityBasis: 'mAh/g' | 'mAh';
  flags: CellFlag[];
}

export interface CellFlag {
  id: string;
  title: string;
  body: string;
  needsProtocol: boolean;
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

function peakOf(series: { cycle: number; value: number }[]): number | null {
  if (!series.length) return null;
  const vals = series.map((d) => d.value).sort((a, b) => a - b);
  return percentile(vals, 0.95);
}

export function summariseCell(raw: RatePerfCell): CellSummary {
  const spec = raw.specificCapacityMahG ?? [];
  const dch = raw.dischargeCapacityMah ?? [];
  const chg = raw.chargeCapacityMah ?? [];
  const cycles = raw.cycles ?? [];

  const specSeries = seriesFrom(cycles, spec);
  const rawSeries = seriesFrom(cycles, dch);
  const peakCapacitySpec = peakOf(specSeries);
  const peakCapacityRaw = peakOf(rawSeries);

  // Specific capacity needs cathode mass, which DIGIBAT cells often lack —
  // fall back to raw mAh so every cell still gets a sparkline.
  const capacitySeries = specSeries.length ? specSeries : rawSeries;
  const capacityBasis: 'mAh/g' | 'mAh' = specSeries.length ? 'mAh/g' : 'mAh';

  // CE only over meaningful cycles (≥5% of peak discharge); rest/zero-current
  // steps in raw exports otherwise flood the median with garbage ratios.
  const ceFloor = (peakCapacityRaw ?? 0) * 0.05;
  const ceVals: number[] = [];
  const ceSeries: { cycle: number; value: number }[] = [];
  for (let i = 0; i < cycles.length; i++) {
    const c = chg[i];
    const d = dch[i];
    if (c != null && d != null && c > ceFloor && d > ceFloor && ceFloor > 0) {
      const ce = (d / c) * 100;
      if (ce > 0 && ce < 150) {
        ceVals.push(ce);
        ceSeries.push({ cycle: cycles[i], value: ce });
      }
    }
  }
  ceVals.sort((a, b) => a - b);
  const medianCE = ceVals.length ? percentile(ceVals, 0.5) : null;

  const hasProtocol = Boolean(raw.protocolSegments?.length || raw.protocol);

  // Retention only means "degradation" once the cycle sequence is segmented;
  // raw indices mix formation / rate-test / main-cycling steps.
  const peakForRetention = peakOf(capacitySeries);
  let retention: number | null = null;
  if (peakForRetention && capacitySeries.length >= 5) {
    const tail = capacitySeries.slice(-3).map((d) => d.value);
    retention = (tail.reduce((a, b) => a + b, 0) / tail.length / peakForRetention) * 100;
  }

  // Fade rate: OLS slope of capacity vs cycle, expressed as % of peak lost per
  // 100 cycles (positive = fading). Like retention, only clean once the cycle
  // sequence is segmented — the metric is marked requiresProtocol so the UX
  // gates it; we still compute it so the value is ready when protocols attach.
  let fadeRatePctPer100: number | null = null;
  if (peakForRetention && peakForRetention > 0 && capacitySeries.length >= 5) {
    const slope = linregSlope(capacitySeries.map((s) => ({ x: s.cycle, y: s.value })));
    if (slope != null) fadeRatePctPer100 = -(slope / peakForRetention) * 10000;
  }

  // CE drift: OLS slope of per-cycle CE, in percentage points per 100 cycles.
  // 0 = stable; negative = declining efficiency (side reactions).
  let ceTrendPctPer100: number | null = null;
  if (ceSeries.length >= 5) {
    const slope = linregSlope(ceSeries.map((s) => ({ x: s.cycle, y: s.value })));
    if (slope != null) ceTrendPctPer100 = slope * 100;
  }

  // Cycle life: first cycle where capacity drops below 80% of peak (the
  // universally-reported end-of-life threshold). Robust on noisy data — no
  // curve fitting. Null if it never crosses or the series is too short.
  let cycleLife80: number | null = null;
  if (peakForRetention && peakForRetention > 0 && capacitySeries.length >= 5) {
    const threshold = 0.8 * peakForRetention;
    for (let i = 0; i + 1 < capacitySeries.length; i++) {
      if (capacitySeries[i].value < threshold && capacitySeries[i + 1].value < threshold) {
        cycleLife80 = capacitySeries[i].cycle;
        break;
      }
    }
  }

  return {
    idNo: raw.idNo,
    cellId: raw.cellId,
    cellName: raw.cellName || raw.cellId,
    cathode: raw.cathode || 'Unknown',
    separatorType: raw.separatorType || '—',
    spacerMm: raw.spacerMm,
    hasProtocol,
    protocolName: raw.protocol ?? null,
    cycleCount: capacitySeries.length,
    peakCapacitySpec,
    peakCapacityRaw,
    medianCE,
    retention,
    fadeRatePctPer100,
    ceTrendPctPer100,
    cycleLife80,
    peakShiftMv: null,
    capacitySeries,
    capacityBasis,
    flags: [],
  };
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
    requiresProtocol: false,
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
    id: 'fade-rate',
    label: 'Fade rate',
    unit: '%/100cyc',
    requiresProtocol: true,
    higherIsBetter: false, // less fade is better
    value: (c) => c.fadeRatePctPer100,
    format: (v) => v.toFixed(2),
  },
  {
    id: 'cycle-life-80',
    label: 'Cycle life (80%)',
    unit: 'cyc',
    requiresProtocol: true,
    higherIsBetter: true, // surviving more cycles before 80% is better
    value: (c) => c.cycleLife80,
    format: (v) => v.toFixed(0),
  },
  {
    id: 'ce-trend',
    label: 'CE drift',
    unit: 'pp/100cyc',
    requiresProtocol: true,
    // Literature: a rising CE (esp. early) is SEI stabilising — a positive sign;
    // a falling CE signals accelerating degradation. So higher (more positive)
    // slope is better — a plain monotonic metric, NOT on-target.
    higherIsBetter: true,
    value: (c) => c.ceTrendPctPer100,
    format: (v) => (v >= 0 ? `+${v.toFixed(2)}` : v.toFixed(2)),
  },
  {
    id: 'dqdv-peak-shift',
    label: 'dQ/dV peak shift',
    unit: 'mV',
    requiresProtocol: false,
    higherIsBetter: true, // score overrides: a stable peak (≈0 shift) is best
    value: (c) => c.peakShiftMv,
    format: (v) => (v >= 0 ? `+${v.toFixed(0)}` : v.toFixed(0)),
    // Mechanism signal: a peak that barely moves is healthiest; a large shift in
    // either direction flags phase-change / impedance growth.
    score: (v) => -Math.abs(v),
    target: 0,
  },
];
