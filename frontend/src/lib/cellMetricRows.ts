/**
 * Master Plot 1 — metric extraction and stats (browser-side).
 * Data sources: rate-performance.json shape + cell-record-index fields.
 */

import type { ProtocolSegment, RatePerfCell, IndexCell } from '@/lib/cellTypes';

export type { ProtocolSegment, RatePerfCell, IndexCell };

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
  capacityScalar: number;
  cathodeMassG: number | null;
  retentionSeries: number[];
  ceSeries: number[];
  /** True initial CE % (first-cycle discharge ÷ charge); null when the cell has no charge data. */
  iceScalar: number | null;
  /** Filled async in UI when user selects dQ/dV shift */
  dqdvShiftSeries?: number[];
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  spacerLabel: string;
  electrolyte: string;
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
      const lastSpec = spec[spec.length - 1] ?? 0;
      const dch = c.dischargeCapacityMah ?? [];
      // CE/ICE are TRUE metrics only — discharge ÷ charge from the exported charge
      // capacity. A cell without charge data has NO CE/ICE (a gap on the axis); we
      // never fabricate a discharge-only proxy.
      const ceSeries = ceSeriesFromCharge(c) ?? [];
      const iceScalar = initialCeFromSeries(ceSeries);
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
        capacityScalar: lastSpec,
        cathodeMassG: idx?.cathodeMassG ?? null,
        retentionSeries: retSeries,
        ceSeries,
        iceScalar,
        cathode: c.cathode || idx?.cathode || '',
        separatorType: c.separatorType || idx?.separatorType || '',
        spacerMm: c.spacerMm ?? idx?.spacerMm ?? null,
        spacerLabel: String(c.spacerMm ?? idx?.spacerMm ?? '—'),
        electrolyte: (idx?.electrolyte ?? '').trim() || '—',
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
