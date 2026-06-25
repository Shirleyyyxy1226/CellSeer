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

describe('protocol-scoped metrics', () => {
  // Median CE and capacity retention are not computed yet: over the full
  // (phase-mixed) cycle series they are misleading, so they stay null until
  // segment-aware computation lands. The UI shows "coming soon" for them.
  // (Fade rate / cycle life / CE drift were removed entirely.)
  it('leaves median CE and retention null', () => {
    const c = summariseCell(rawWith([100, 96, 92, 88, 84, 80, 76, 72]));
    expect(c.medianCE).toBeNull();
    expect(c.retention).toBeNull();
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
