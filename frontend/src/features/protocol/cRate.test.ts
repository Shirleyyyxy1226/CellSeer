import { describe, expect, it } from 'vitest';
import {
  parseCRate,
  formatCRate,
  formatCRateInput,
  formatCycleRange,
  synthesiseProtocolName,
} from './cRate';

describe('parseCRate', () => {
  it('parses bare decimals', () => {
    expect(parseCRate('0.1')).toBeCloseTo(0.1, 10);
    expect(parseCRate('2')).toBe(2);
    expect(parseCRate('0.33')).toBeCloseTo(0.33, 10);
  });

  it('parses plain numbers', () => {
    expect(parseCRate(2)).toBe(2);
    expect(parseCRate(0.5)).toBe(0.5);
  });

  it('parses legacy "C/N" prefix fractions (case-insensitive)', () => {
    expect(parseCRate('C/10')).toBeCloseTo(0.1, 10);
    expect(parseCRate('C/2')).toBe(0.5);
    expect(parseCRate('c/4')).toBe(0.25);
  });

  it('parses legacy "nC" suffix form', () => {
    expect(parseCRate('1C')).toBe(1);
    expect(parseCRate('2C')).toBe(2);
    expect(parseCRate('0.5C')).toBe(0.5);
    expect(parseCRate('1c')).toBe(1);
  });

  it('parses "/NC" (C/N written backwards with C suffix)', () => {
    expect(parseCRate('/10C')).toBeCloseTo(0.1, 10);
    expect(parseCRate('/2C')).toBe(0.5);
  });

  it('parses bare "N/D" fractions', () => {
    expect(parseCRate('1/10')).toBeCloseTo(0.1, 10);
    expect(parseCRate('3/4')).toBe(0.75);
    expect(parseCRate('5/2')).toBe(2.5);
  });

  it('trims surrounding whitespace', () => {
    expect(parseCRate('  0.5  ')).toBe(0.5);
    expect(parseCRate('  C/10 ')).toBeCloseTo(0.1, 10);
  });

  it('returns null for null/undefined', () => {
    expect(parseCRate(null)).toBeNull();
    expect(parseCRate(undefined)).toBeNull();
  });

  it('returns null for empty / whitespace-only strings', () => {
    expect(parseCRate('')).toBeNull();
    expect(parseCRate('   ')).toBeNull();
  });

  it('returns null for garbage', () => {
    expect(parseCRate('abc')).toBeNull();
    expect(parseCRate('C/')).toBeNull();
    expect(parseCRate('C/x')).toBeNull();
  });

  it('returns null for non-positive values', () => {
    expect(parseCRate('0')).toBeNull();
    expect(parseCRate('-1')).toBeNull();
    expect(parseCRate(0)).toBeNull();
    expect(parseCRate(-2)).toBeNull();
  });

  it('returns null for non-positive denominators / numerators in fractions', () => {
    expect(parseCRate('C/0')).toBeNull();
    expect(parseCRate('C/-2')).toBeNull();
    expect(parseCRate('1/0')).toBeNull();
    expect(parseCRate('0/5')).toBeNull();
    expect(parseCRate('-1/5')).toBeNull();
  });

  it('returns null for non-finite numbers', () => {
    expect(parseCRate(Number.POSITIVE_INFINITY)).toBeNull();
    expect(parseCRate(Number.NaN)).toBeNull();
  });
});

describe('formatCRate', () => {
  it('formats rates >= 1 with a C suffix', () => {
    expect(formatCRate(1)).toBe('1C');
    expect(formatCRate(2)).toBe('2C');
    expect(formatCRate(1.5)).toBe('1.5C');
  });

  it('rounds rates >= 1 to two decimals', () => {
    expect(formatCRate(2.001)).toBe('2C');
    expect(formatCRate(1.234)).toBe('1.23C');
  });

  it('formats clean reciprocals as "C/N"', () => {
    expect(formatCRate(0.1)).toBe('C/10');
    expect(formatCRate(0.5)).toBe('C/2');
    expect(formatCRate(0.25)).toBe('C/4');
  });

  it('falls back to "X.XXC" for non-clean sub-1 rates', () => {
    // 0.33 -> 1/0.33 = 3.03..., not within 1% of an integer
    expect(formatCRate(0.33)).toBe('0.33C');
  });

  it('returns the em-dash placeholder for invalid rates', () => {
    expect(formatCRate(0)).toBe('—');
    expect(formatCRate(-1)).toBe('—');
    expect(formatCRate(Number.NaN)).toBe('—');
    expect(formatCRate(Number.POSITIVE_INFINITY)).toBe('—');
  });
});

describe('formatCRateInput', () => {
  it('returns bare number for rates >= 1 (no C suffix)', () => {
    expect(formatCRateInput(2)).toBe('2');
    expect(formatCRateInput(1)).toBe('1');
    expect(formatCRateInput(1.5)).toBe('1.5');
  });

  it('returns "1/N" fraction form for clean reciprocals', () => {
    expect(formatCRateInput(0.1)).toBe('1/10');
    expect(formatCRateInput(0.5)).toBe('1/2');
    expect(formatCRateInput(0.25)).toBe('1/4');
  });

  it('returns a rounded decimal for non-clean sub-1 rates', () => {
    expect(formatCRateInput(0.33)).toBe('0.33');
  });

  it('returns an empty string for invalid rates', () => {
    expect(formatCRateInput(0)).toBe('');
    expect(formatCRateInput(-1)).toBe('');
    expect(formatCRateInput(Number.NaN)).toBe('');
  });
});

describe('parse/format round-trip', () => {
  it('round-trips clean reciprocal labels value -> label -> value', () => {
    for (const v of [0.1, 0.25, 0.5]) {
      const label = formatCRate(v);
      expect(parseCRate(label)).toBeCloseTo(v, 10);
    }
  });

  it('round-trips rates >= 1 value -> label -> value', () => {
    for (const v of [1, 2, 1.5]) {
      expect(parseCRate(formatCRate(v))).toBeCloseTo(v, 10);
    }
  });

  it('round-trips input form via parseCRate', () => {
    expect(parseCRate(formatCRateInput(0.1))).toBeCloseTo(0.1, 10);
    expect(parseCRate(formatCRateInput(2))).toBe(2);
  });
});

describe('formatCycleRange', () => {
  it('renders an open-ended range with the "→ end" affordance', () => {
    expect(formatCycleRange(5, null)).toBe('5 → end');
  });

  it('renders a single cycle when start === end', () => {
    expect(formatCycleRange(3, 3)).toBe('3');
  });

  it('renders a closed range with an en-dash', () => {
    expect(formatCycleRange(1, 10)).toBe('1–10');
  });
});

describe('synthesiseProtocolName', () => {
  it('joins per-segment tokens with " | "', () => {
    expect(
      synthesiseProtocolName([{ cRate: 0.1 }, { cRate: 2 }]),
    ).toBe('C/10 | 2C');
  });

  it('prefixes uppercased segment names when present', () => {
    expect(
      synthesiseProtocolName([{ name: 'form', cRate: 0.1 }]),
    ).toBe('FORM-C/10');
  });

  it('treats blank/whitespace names as nameless', () => {
    expect(
      synthesiseProtocolName([{ name: '   ', cRate: 1 }]),
    ).toBe('1C');
    expect(
      synthesiseProtocolName([{ name: null, cRate: 1 }]),
    ).toBe('1C');
  });

  it('collapses consecutive duplicate tokens', () => {
    expect(
      synthesiseProtocolName([
        { cRate: 0.1 },
        { cRate: 0.1 },
        { cRate: 2 },
      ]),
    ).toBe('C/10 | 2C');
  });

  it('keeps non-adjacent duplicate tokens', () => {
    expect(
      synthesiseProtocolName([
        { cRate: 0.1 },
        { cRate: 2 },
        { cRate: 0.1 },
      ]),
    ).toBe('C/10 | 2C | C/10');
  });

  it('returns an empty string for no segments', () => {
    expect(synthesiseProtocolName([])).toBe('');
  });
});
