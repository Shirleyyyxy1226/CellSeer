/**
 * Master Plot 1 — metric extraction and stats (browser-side).
 * Data sources: rate-performance.json shape + cell-record-index fields.
 */

import type { ProtocolSegment, RatePerfCell, IndexCell } from '@/lib/cellTypes';

export type { ProtocolSegment, RatePerfCell, IndexCell };

/** Longest protocol segment by cycle span — used as "main cycling" window per cell. */
export function mainCyclingSegment(segments: ProtocolSegment[] | undefined): ProtocolSegment | null {
  if (!segments?.length) return null;
  let best: ProtocolSegment | null = null;
  let bestLen = -1;
  for (const s of segments) {
    const end = (s.cycleEnd as number | null);
    if (end == null) continue;
    const len = end - s.cycleStart + 1;
    if (len > bestLen) {
      bestLen = len;
      best = s;
    }
  }
  return best ?? segments[0];
}

function meanSeriesInMainCyclingPhase(
  cycles: number[],
  protocolSegments: ProtocolSegment[],
  series: number[],
): number | null {
  const seg = mainCyclingSegment(protocolSegments);
  const nSteps = Math.min(cycles.length, series.length);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < nSteps; i++) {
    const cy = cycles[i];
    if (seg && (cy < seg.cycleStart || ((seg.cycleEnd as number | null) != null && cy > seg.cycleEnd))) continue;
    const v = series[i];
    if (!Number.isFinite(v)) continue;
    sum += v;
    n++;
  }
  return n > 0 ? sum / n : null;
}

export type DimKey =
  | 'retention'
  | 'capacity'
  | 'fade_rate'
  | 'cathode_mass'
  | 'ce'
  | 'ice'
  | 'retention_cycle'
  | 'capacity_cycle'
  | 'ce_cycle'
  | 'dqdv_shift'
  | 'cathode'
  | 'separator'
  | 'spacer'
  | 'protocol'
  | 'electrolyte';

export const DIMENSION_CATALOG: {
  key: DimKey;
  label: string;
  kind: 'scalar' | 'per_cycle' | 'categorical';
  /** Extra UI hint */
  hint?: string;
  stub?: boolean;
}[] = [
  { key: 'retention', label: 'Retention', kind: 'scalar' },
  { key: 'capacity', label: 'Capacity', kind: 'scalar' },
  { key: 'fade_rate', label: 'Fade rate', kind: 'scalar' },
  { key: 'cathode_mass', label: 'Cathode mass', kind: 'scalar' },
  {
    key: 'ce',
    label: 'CE',
    kind: 'scalar',
    hint: 'Coulombic efficiency = discharge ÷ charge per cycle. Blank when charge capacity is not exported (no proxy).',
  },
  {
    key: 'ice',
    label: 'ICE',
    kind: 'scalar',
    hint: 'Initial Coulombic efficiency = first-cycle discharge ÷ charge. Blank when charge capacity is not exported (no proxy).',
  },
  { key: 'retention_cycle', label: 'Retention (cycle)', kind: 'per_cycle' },
  { key: 'capacity_cycle', label: 'Capacity (cycle)', kind: 'per_cycle' },
  {
    key: 'ce_cycle',
    label: 'CE (cycle)',
    kind: 'per_cycle',
    hint: 'Per-cycle true CE (discharge ÷ charge). Blank when charge capacity is not exported (no proxy).',
  },
  {
    key: 'dqdv_shift',
    label: 'dQ/dV shift',
    kind: 'per_cycle',
    hint: 'ΔV of dominant |dQ/dV| peak vs reference; loads /api/cell-record/{cellId}/differential.',
  },
  { key: 'cathode', label: 'Cathode', kind: 'categorical' },
  { key: 'separator', label: 'Separator', kind: 'categorical' },
  { key: 'spacer', label: 'Spacer', kind: 'categorical' },
  { key: 'electrolyte', label: 'Electrolyte', kind: 'categorical' },
  { key: 'protocol', label: 'Protocol', kind: 'categorical' },
];

export interface CellMetricRow {
  idNo: number;
  cellId: string;
  cellName: string;
  protocol: string;
  protocolSegments: ProtocolSegment[];
  cycles: number[];
  cRates: number[];
  specificMahG: number[];
  dischargeMah: number[];
  /** Last finite retention %, normalised to the initial-capacity baseline; null when no trustworthy baseline exists. */
  retentionScalar: number | null;
  capacityScalar: number;
  fadeRate: number;
  cathodeMassG: number | null;
  retentionSeries: number[];
  ceSeries: number[];
  /** Mean true CE % over the last protocol segment; null when the cell has no charge data. */
  ceScalar: number | null;
  /** True initial CE % (first-cycle discharge ÷ charge); null when the cell has no charge data. */
  iceScalar: number | null;
  /** Filled async in UI when user selects dQ/dV shift */
  dqdvShiftSeries?: number[];
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  spacerLabel: string;
  electrolyte: string;
  confTierRetention: 1 | 2 | 3;
  confTierCE: 1 | 2 | 3;
  /** Mean retention % over steps in this cell's main cycling segment (cross-protocol comparable). */
  retentionMeanMain: number | null;
  /** Mean true CE % over the same main-segment steps; null when the cell has no charge data. */
  ceMeanMain: number | null;
  /** Unit of specificMahG / capacityScalar — raw mAh when cathode mass is missing project-wide. */
  capacityBasis: 'mAh/g' | 'mAh';
}

function medianOf(vals: number[]): number {
  const s = [...vals].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid]! : (s[mid - 1]! + s[mid]!) / 2;
}

/**
 * Retention baseline = a representative INITIAL specific capacity, taken as the
 * median of the first protocol segment's positive capacities (median, not mean,
 * so a single near-zero glitch cycle can't drag the baseline down). Falls back to
 * the earliest positive capacities when segment timing is unavailable.
 *
 * Returns null — "no trustworthy baseline" — when there is no positive capacity,
 * or when the candidate baseline is a tiny fraction of the cell's own median
 * capacity. A glitch-low reference would otherwise divide retention up into the
 * thousands of percent (the source of the old "260336%" artifact); per the
 * no-fabrication rule, callers treat null as a gap rather than inventing a number.
 */
function baselineMeanFirstSegment(cell: RatePerfCell, spec: number[]): number | null {
  if (!spec.length) return null;
  const positives = spec.filter((v) => v != null && Number.isFinite(v) && v > 0);
  if (!positives.length) return null;
  const overallMedian = medianOf(positives);

  let base: number | null = null;
  const seg = cell.protocolSegments?.[0];
  if (seg && cell.cycles?.length) {
    const segVals: number[] = [];
    for (let i = 0; i < cell.cycles.length; i++) {
      const cy = cell.cycles[i];
      const v = spec[i];
      if (cy >= seg.cycleStart && cy <= seg.cycleEnd && v != null && Number.isFinite(v) && v > 0) {
        segVals.push(v);
      }
    }
    if (segVals.length) base = medianOf(segVals);
  }
  // No usable first segment: approximate initial capacity from the earliest points.
  if (base == null) base = medianOf(positives.slice(0, Math.min(5, positives.length)));

  // Glitch guard: a real initial capacity sits near the top of the cell's range,
  // never an order of magnitude below the median. Anything that small is a bad
  // reference, not a baseline → no data.
  if (!(base > 0) || base < 0.1 * overallMedian) return null;
  return base;
}

function retentionSeries(cell: RatePerfCell, spec: number[]): number[] {
  if (!spec.length) return [];
  const base = baselineMeanFirstSegment(cell, spec);
  if (base == null) return [];
  return spec.map((v) => (100 * v) / base);
}

/** Slope of retention % vs step index (negative = fading). */
function fadeRateFromSeries(series: number[]): number {
  if (series.length < 3) return 0;
  const n = series.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += series[i];
    sxx += i * i;
    sxy += i * series[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * sxy - sx * sy) / denom;
}

/** True CE per cycle if chargeCapacityMah aligns; else null. */
function ceSeriesFromCharge(cell: RatePerfCell): number[] | null {
  const ch = cell.chargeCapacityMah;
  const dch = cell.dischargeCapacityMah;
  if (!ch?.length || !dch?.length || ch.length !== dch.length) return null;
  return dch.map((d, i) => {
    const c = ch[i] ?? 0;
    if (c <= 1e-9) return NaN;
    return Math.min(102, (d / c) * 100);
  });
}

/** True initial CE % = first finite per-cycle CE; null when the cell has no charge data. */
function initialCeFromSeries(ce: number[]): number | null {
  for (const v of ce) {
    if (Number.isFinite(v)) return v;
  }
  return null;
}

function meanLastProtocolSegmentCe(ce: number[], cell: RatePerfCell): number {
  const segs = cell.protocolSegments;
  const cyc = cell.cycles;
  if (!segs?.length || !cyc.length) {
    const tail = ce.slice(Math.max(0, ce.length - 5));
    const v = tail.filter((x) => Number.isFinite(x));
    if (!v.length) return 99;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }
  const last = segs[segs.length - 1];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < cyc.length; i++) {
    if (cyc[i] >= last.cycleStart && cyc[i] <= last.cycleEnd && Number.isFinite(ce[i])) {
      sum += ce[i];
      n++;
    }
  }
  if (n > 0) return sum / n;
  const v = ce.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 99;
}

function retentionConfidenceTier(cell: RatePerfCell, retSeries: number[]): 1 | 2 | 3 {
  const n = retSeries.length;
  if (n < 5) return 3;
  const hasSeg = (cell.protocolSegments?.length ?? 0) >= 2;
  if (n >= 15 && hasSeg) {
    const tail = retSeries.slice(Math.max(0, n - 8));
    const m = tail.reduce((a, b) => a + b, 0) / tail.length;
    const v = Math.sqrt(tail.reduce((s, x) => s + (x - m) ** 2, 0) / tail.length);
    if (v < 2.5) return 1;
  }
  if (n >= 8 && hasSeg) return 2;
  return 3;
}

function ceConfidenceTier(ceSeries: number[], hasTrueCe: boolean): 1 | 2 | 3 {
  const v = ceSeries.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 4) return 3;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  if (hasTrueCe && sd < 0.35 && m > 98) return 1;
  if (hasTrueCe && sd < 0.6) return 2;
  if (!hasTrueCe && sd < 0.8 && m > 97) return 2;
  return 3;
}

export function buildMetricRows(
  rateCells: RatePerfCell[],
  indexByIdNo: Map<number, IndexCell>,
): CellMetricRow[] {
  // DIGIBAT exports often lack cathode mass, so specific capacity can be missing
  // project-wide. Pick ONE capacity basis for all cells (axes must stay comparable):
  // mAh/g when most cells have it, otherwise raw discharge mAh.
  const withSpec = rateCells.filter((c) => c.specificCapacityMahG?.length).length;
  const useSpec = rateCells.length > 0 && withSpec / rateCells.length > 0.5;
  const capacityBasis: 'mAh/g' | 'mAh' = useSpec ? 'mAh/g' : 'mAh';
  return rateCells
    .map((c) => ({
      c,
      series: useSpec ? (c.specificCapacityMahG ?? []) : (c.dischargeCapacityMah ?? []),
    }))
    .filter(({ series }) => series.length > 0)
    .map(({ c, series: spec }) => {
      const idx = indexByIdNo.get(c.idNo);
      const retSeries = retentionSeries(c, spec);
      // Scalar retention = last finite point; null (no fabrication) when the cell
      // has no trustworthy retention at all — e.g. no usable capacity baseline.
      let retentionScalar: number | null = null;
      for (let i = retSeries.length - 1; i >= 0; i--) {
        if (Number.isFinite(retSeries[i])) {
          retentionScalar = retSeries[i]!;
          break;
        }
      }
      const lastSpec = spec[spec.length - 1] ?? 0;
      const dch = c.dischargeCapacityMah ?? [];
      // CE/ICE are TRUE metrics only — discharge ÷ charge from the exported charge
      // capacity. A cell without charge data has NO CE/ICE (a gap on the axis); we
      // never fabricate a discharge-only proxy.
      const trueCe = ceSeriesFromCharge(c);
      const ceSeries = trueCe ?? [];
      const hasCe = ceSeries.some((v) => Number.isFinite(v));
      const ceScalar = hasCe ? meanLastProtocolSegmentCe(ceSeries, c) : null;
      const iceScalar = initialCeFromSeries(ceSeries);
      const segs = c.protocolSegments ?? [];
      const retentionMeanMain =
        meanSeriesInMainCyclingPhase(c.cycles, segs, retSeries) ?? retentionScalar;
      const ceMeanMain = hasCe ? (meanSeriesInMainCyclingPhase(c.cycles, segs, ceSeries) ?? ceScalar) : null;
      return {
        idNo: c.idNo,
        cellId: c.cellId,
        cellName: c.cellName,
        protocol: c.protocol?.trim() || '(no protocol)',
        protocolSegments: c.protocolSegments ?? [],
        cycles: c.cycles,
        cRates: c.cRates ?? [],
        specificMahG: spec,
        dischargeMah: dch,
        retentionScalar,
        capacityScalar: lastSpec,
        fadeRate: fadeRateFromSeries(retSeries),
        cathodeMassG: idx?.cathodeMassG ?? null,
        retentionSeries: retSeries,
        ceSeries,
        ceScalar,
        iceScalar,
        cathode: c.cathode || idx?.cathode || '',
        separatorType: c.separatorType || idx?.separatorType || '',
        spacerMm: c.spacerMm ?? idx?.spacerMm ?? null,
        spacerLabel: String(c.spacerMm ?? idx?.spacerMm ?? '—'),
        electrolyte: (idx?.electrolyte ?? '').trim() || '—',
        confTierRetention: retentionConfidenceTier(c, retSeries),
        confTierCE: ceConfidenceTier(ceSeries, trueCe != null),
        retentionMeanMain,
        ceMeanMain,
        capacityBasis,
      };
    })
    .sort((a, b) => a.idNo - b.idNo);
}

export function getCategoricalValue(row: CellMetricRow, key: DimKey): string {
  switch (key) {
    case 'cathode':
      return row.cathode || '—';
    case 'separator':
      return row.separatorType || '—';
    case 'spacer':
      return row.spacerLabel;
    case 'electrolyte':
      return row.electrolyte || '—';
    case 'protocol':
      return row.protocol;
    default:
      return '—';
  }
}

/**
 * Okabe–Ito–style palette (colorblind-friendly, distinct on light & dark UI).
 * Order: orange, sky blue, bluish green, yellow, blue, vermillion, reddish purple, gray.
 */
const CAT_PALETTE = [
  '#E69F00',
  '#56B4E9',
  '#009E73',
  '#F0E442',
  '#0072B2',
  '#D55E00',
  '#CC79A7',
  '#999999',
  '#332288',
  '#88CCEE',
  '#44AA99',
  '#DDCC77',
];

export function colourForCategory(value: string, domain: string[]): string {
  const i = domain.indexOf(value);
  if (i < 0) return '#64748b';
  return CAT_PALETTE[i % CAT_PALETTE.length];
}
