import { describe, expect, it } from 'vitest';
import {
  benjaminiHochberg,
  ciOverlap,
  clamp01,
  linregSlope,
  meanCI,
  sampleSd,
  studentTwoSidedP,
  tCritical95,
  welchT,
} from './stats';

describe('tCritical95', () => {
  it('uses tabulated small-df values and converges to z=1.96', () => {
    expect(tCritical95(1)).toBeCloseTo(12.706, 2);
    expect(tCritical95(9)).toBeCloseTo(2.262, 2);
    expect(tCritical95(30)).toBeCloseTo(2.042, 2);
    expect(tCritical95(500)).toBe(1.96);
  });
  it('is infinite for df<=0 (no interval from a single point)', () => {
    expect(tCritical95(0)).toBe(Number.POSITIVE_INFINITY);
  });
});

describe('sampleSd', () => {
  it('uses the n-1 denominator', () => {
    // values 2,4,6 -> mean 4, ss=8, /(n-1)=4, sd=2
    expect(sampleSd([2, 4, 6])).toBeCloseTo(2, 6);
  });
  it('is null for n<2', () => {
    expect(sampleSd([5])).toBeNull();
  });
});

describe('meanCI', () => {
  it('computes a t-based 95% CI', () => {
    const ci = meanCI([2, 4, 6]); // mean 4, sd 2, sem 2/sqrt3, t(2)=4.303
    expect(ci.mean).toBeCloseTo(4, 6);
    expect(ci.sem).toBeCloseTo(2 / Math.sqrt(3), 5);
    expect(ci.half).toBeCloseTo(4.303 * (2 / Math.sqrt(3)), 2);
    expect(ci.low).toBeLessThan(4);
    expect(ci.high).toBeGreaterThan(4);
  });
  it('returns no interval for n<2', () => {
    const ci = meanCI([7]);
    expect(ci.mean).toBe(7);
    expect(ci.half).toBeNull();
    expect(ci.sem).toBeNull();
  });
});

describe('linregSlope', () => {
  it('recovers a known slope', () => {
    // y = 2x + 1
    const pts = [0, 1, 2, 3, 4].map((x) => ({ x, y: 2 * x + 1 }));
    expect(linregSlope(pts)).toBeCloseTo(2, 6);
  });
  it('is null for <2 points or zero x-variance', () => {
    expect(linregSlope([{ x: 1, y: 1 }])).toBeNull();
    expect(linregSlope([{ x: 5, y: 1 }, { x: 5, y: 9 }])).toBeNull();
  });
  it('is negative for a fading capacity series', () => {
    const cap = [100, 98, 96, 94, 92].map((y, i) => ({ x: i, y }));
    expect(linregSlope(cap)).toBeCloseTo(-2, 6);
  });
});

describe('clamp01', () => {
  it('clamps to [0,1]', () => {
    expect(clamp01(-0.3)).toBe(0);
    expect(clamp01(0.4)).toBe(0.4);
    expect(clamp01(1.7)).toBe(1);
  });
});

describe('ciOverlap', () => {
  it('detects overlapping and separated intervals', () => {
    const a = meanCI([10, 10.1, 9.9]); // tight, ~10
    const b = meanCI([10.05, 10.15, 9.95]); // overlaps a
    const c = meanCI([50, 50.1, 49.9]); // far away
    expect(ciOverlap(a, b)).toBe(true);
    expect(ciOverlap(a, c)).toBe(false);
  });
  it('treats a missing interval (n<2) as overlapping (cannot rule out)', () => {
    expect(ciOverlap(meanCI([10]), meanCI([50, 50.1, 49.9]))).toBe(true);
  });
});

describe('studentTwoSidedP', () => {
  it('matches known t-critical points (p≈0.05 at the 95% critical t)', () => {
    // t_crit(df=10, two-sided 95%) = 2.228 → p ≈ 0.05
    expect(studentTwoSidedP(2.228, 10)).toBeCloseTo(0.05, 3);
    // t=0 → p=1 (no difference)
    expect(studentTwoSidedP(0, 10)).toBeCloseTo(1, 6);
    // large t → tiny p
    expect(studentTwoSidedP(10, 10)).toBeLessThan(0.001);
  });
  it('is symmetric in the sign of t', () => {
    expect(studentTwoSidedP(2.3, 8)).toBeCloseTo(studentTwoSidedP(-2.3, 8), 10);
  });
});

describe('welchT', () => {
  it('finds no difference between identical-ish groups', () => {
    const r = welchT([10, 10.1, 9.9, 10.05], [10.02, 9.98, 10.0, 10.03]);
    expect(r.p).toBeGreaterThan(0.2);
  });
  it('finds a clear difference between well-separated groups', () => {
    const r = welchT([10, 10.1, 9.9], [20, 20.1, 19.9]);
    expect(r.p).not.toBeNull();
    expect(r.p as number).toBeLessThan(0.001);
  });
  it('returns null p for n<2 in either group', () => {
    expect(welchT([5], [1, 2, 3]).p).toBeNull();
  });
});

describe('benjaminiHochberg', () => {
  it('adjusts p-values upward and preserves order/nulls', () => {
    const adj = benjaminiHochberg([0.01, 0.04, 0.03, null]);
    expect(adj[3]).toBeNull();
    // every adjusted p >= raw p
    expect(adj[0]! >= 0.01).toBe(true);
    expect(adj[1]! >= 0.04).toBe(true);
    // monotonicity isn't guaranteed in input order, but all <= 1
    for (const p of adj) if (p != null) expect(p).toBeLessThanOrEqual(1);
  });
  it('leaves a single p-value unchanged', () => {
    expect(benjaminiHochberg([0.03])[0]).toBeCloseTo(0.03, 6);
  });
});
