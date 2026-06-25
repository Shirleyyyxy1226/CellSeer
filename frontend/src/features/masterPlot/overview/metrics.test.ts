import { describe, expect, it } from 'vitest';
import type { RatePerfCell } from '@/lib/cellTypes';
import { type CellSummary, METRICS, metricAvailability, capacitySeriesForCell } from './metrics';

function rawWith(spec: number[] | null, dch: number[]): RatePerfCell {
  const cycles = dch.map((_, i) => i + 1);
  return {
    idNo: 1,
    cellId: 'T-CEL-1',
    cellName: 'test',
    cathode: 'LFP',
    separatorType: 'PP',
    spacerMm: null,
    protocol: 'p',
    cycles,
    dischargeCapacityMah: dch,
    chargeCapacityMah: dch.map((v) => v / 0.99),
    specificCapacityMahG: spec,
  };
}

function summary(partial: Partial<CellSummary>): CellSummary {
  return {
    idNo: 1,
    cellId: 'c',
    cellName: 'c',
    cathode: 'LFP',
    separatorType: 'PP',
    spacerMm: null,
    hasProtocol: false,
    protocolName: null,
    cycleCount: 0,
    peakCapacitySpec: null,
    peakCapacityRaw: null,
    medianCE: null,
    retention: null,
    peakShiftMv: null,
    capacitySeries: [],
    capacityBasis: 'mAh',
    flags: [],
    ...partial,
  };
}

describe('capacitySeriesForCell', () => {
  it('prefers specific capacity when present (mAh/g basis)', () => {
    const { series, basis } = capacitySeriesForCell(rawWith([100, 96, 92], [110, 105, 100]));
    expect(basis).toBe('mAh/g');
    expect(series.map((d) => d.value)).toEqual([100, 96, 92]);
  });

  it('falls back to raw discharge capacity (mAh basis) when no specific capacity', () => {
    const { series, basis } = capacitySeriesForCell(rawWith(null, [110, 105, 100]));
    expect(basis).toBe('mAh');
    expect(series.map((d) => d.value)).toEqual([110, 105, 100]);
  });

  it('drops non-positive and non-finite points', () => {
    const { series } = capacitySeriesForCell(rawWith(null, [100, 0, -5, 95]));
    expect(series.map((d) => d.cycle)).toEqual([1, 4]);
  });
});

describe('metricAvailability', () => {
  it('flags a metric available when at least one cell has a finite value', () => {
    const avail = metricAvailability(METRICS, [
      summary({ peakCapacityRaw: 100, peakCapacitySpec: 92 }),
    ]);
    expect(avail['capacity-raw']).toBe(true);
    expect(avail['capacity-spec']).toBe(true);
  });

  it('marks a metric unavailable when no cell has a value for it', () => {
    // No specific capacity (no cathode mass) → peakCapacitySpec is null everywhere.
    const avail = metricAvailability(METRICS, [
      summary({ peakCapacityRaw: 100, peakCapacitySpec: null }),
    ]);
    expect(avail['capacity-spec']).toBe(false);
    expect(avail['capacity-raw']).toBe(true);
  });

  it('returns all-false for an empty cell list', () => {
    const avail = metricAvailability(METRICS, []);
    expect(Object.values(avail).every((v) => v === false)).toBe(true);
  });
});
