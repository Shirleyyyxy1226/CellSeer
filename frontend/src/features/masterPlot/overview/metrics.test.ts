import { describe, expect, it } from 'vitest';
import type { RatePerfCell } from '@/lib/cellTypes';
import { METRICS, metricAvailability, summariseCell } from './metrics';

function rawWith(spec: number[]): RatePerfCell {
  const cycles = spec.map((_, i) => i + 1);
  return {
    idNo: 1,
    cellId: 'T-CEL-1',
    cellName: 'test',
    cathode: 'LFP',
    separatorType: 'PP',
    spacerMm: null,
    protocol: 'p',
    cycles,
    dischargeCapacityMah: spec,
    chargeCapacityMah: spec.map((v) => v / 0.99),
    specificCapacityMahG: spec,
  };
}

describe('cycleLife80', () => {
  it('returns the first cycle where capacity drops below 80% of peak', () => {
    // peak 100, threshold 80. 100,96,92,88,84,80,76,... → first <80 is 76 at cycle 7.
    const c = summariseCell(rawWith([100, 96, 92, 88, 84, 80, 76, 72]));
    expect(c.cycleLife80).toBe(7);
  });

  it('is null when capacity never falls below 80%', () => {
    const c = summariseCell(rawWith([100, 99, 98, 97, 96, 95]));
    expect(c.cycleLife80).toBeNull();
  });

  it('is null when the series is too short to be meaningful', () => {
    const c = summariseCell(rawWith([100, 50]));
    expect(c.cycleLife80).toBeNull();
  });
});

describe('metricAvailability', () => {
  it('flags a metric available when at least one cell has a finite value', () => {
    const cells = [summariseCell(rawWith([100, 96, 92, 88, 84, 80]))];
    const avail = metricAvailability(METRICS, cells);
    // raw capacity is always computable from discharge data.
    expect(avail['capacity-raw']).toBe(true);
    // this cell has specificCapacityMahG, so spec capacity is available too.
    expect(avail['capacity-spec']).toBe(true);
  });

  it('marks a metric unavailable when no cell has a value for it', () => {
    // No specific capacity (no cathode mass) → peakCapacitySpec is null everywhere.
    const noSpec: RatePerfCell = {
      idNo: 2,
      cellId: 'T-CEL-2',
      cellName: 'nospec',
      cathode: 'LFP',
      separatorType: 'PP',
      spacerMm: null,
      protocol: 'p',
      cycles: [1, 2, 3, 4, 5],
      dischargeCapacityMah: [100, 99, 98, 97, 96],
      chargeCapacityMah: [101, 100, 99, 98, 97],
      specificCapacityMahG: null,
    };
    const avail = metricAvailability(METRICS, [summariseCell(noSpec)]);
    expect(avail['capacity-spec']).toBe(false);
    expect(avail['capacity-raw']).toBe(true);
  });

  it('returns all-false for an empty cell list', () => {
    const avail = metricAvailability(METRICS, []);
    expect(Object.values(avail).every((v) => v === false)).toBe(true);
  });
});
