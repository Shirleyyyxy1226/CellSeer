import { describe, expect, it } from 'vitest';
import { parseCycleFilter } from './cycleFilter';

describe('parseCycleFilter', () => {
  it('returns null for empty / whitespace / unparseable input', () => {
    expect(parseCycleFilter('')).toBeNull();
    expect(parseCycleFilter('   ')).toBeNull();
    expect(parseCycleFilter('garbage')).toBeNull();
  });

  it('parses ASCII values and inclusive ranges', () => {
    expect([...(parseCycleFilter('1, 3, 5-8') ?? [])]).toEqual([1, 3, 5, 6, 7, 8]);
    expect([...(parseCycleFilter('10;12') ?? [])]).toEqual([10, 12]);
  });

  // Regression: a Chinese IME emits the full-width comma '，' (U+FF0C), which the
  // splitter didn't recognise — so '1，2，4，10' collapsed to one token and
  // parseInt read only the leading '1', silently filtering to just cycle 1.
  it('treats full-width comma the same as ASCII comma', () => {
    expect([...(parseCycleFilter('1，2，4，10') ?? [])]).toEqual([1, 2, 4, 10]);
    expect([...(parseCycleFilter('1，3，4') ?? [])]).toEqual([1, 3, 4]);
  });

  it('accepts the ideographic comma as a separator', () => {
    expect([...(parseCycleFilter('1、2、3') ?? [])]).toEqual([1, 2, 3]);
  });

  it('accepts full-width and wave-dash range separators', () => {
    expect([...(parseCycleFilter('5－8') ?? [])]).toEqual([5, 6, 7, 8]); // full-width hyphen
    expect([...(parseCycleFilter('1～4') ?? [])]).toEqual([1, 2, 3, 4]); // wave dash
    expect([...(parseCycleFilter('1—3') ?? [])]).toEqual([1, 2, 3]); // em dash
  });

  it('normalises full-width digits', () => {
    expect([...(parseCycleFilter('１，２') ?? [])]).toEqual([1, 2]);
  });

  it('handles mixed full-width and ASCII punctuation', () => {
    expect([...(parseCycleFilter('1，3, 5－6') ?? [])]).toEqual([1, 3, 5, 6]);
  });
});
