import { describe, expect, it } from 'vitest';
import {
  buildGcdFigure,
  buildGcdCumulativeFigure,
  buildVoltageTimeFigure,
  type RecordDataset,
} from './index';

function sampleDataset(): RecordDataset {
  const curves: RecordDataset['curves'] = {};
  for (const cyc of [1, 2]) {
    const n = 20;
    const v: number[] = [];
    const q: number[] = [];
    const i: number[] = [];
    const t: number[] = [];
    for (let j = 0; j < n; j++) {
      v.push(3.0 + j * 0.05);
      q.push(j * 0.001);
      i.push(j < n / 2 ? 0.2 : -0.2);
      t.push(j);
    }
    curves[String(cyc)] = {
      'Voltage [V]': v,
      'Capacity [Ah]': q,
      'Current [A]': i,
      'Time [s]': t,
    };
  }
  return {
    id: 'cell-a',
    label: 'Cell A',
    color: '#1f77b4',
    curves,
    cathodeMassG: null,
  };
}

describe('buildGcdFigure (scatter)', () => {
  it('produces one discharge trace per cycle by default', () => {
    const { data, traceIndexToCell } = buildGcdFigure([sampleDataset()], {
      direction: 'discharge',
    });
    expect(data.length).toBe(2);
    data.forEach((tr) => {
      const t = tr as { name?: string };
      expect(t.name).toMatch(/discharge/);
    });
    expect(traceIndexToCell.get(0)).toEqual({ id: 'cell-a', label: 'Cell A' });
  });

  it('produces charge traces when direction=charge', () => {
    const { data } = buildGcdFigure([sampleDataset()], { direction: 'charge' });
    expect(data.length).toBe(2);
    data.forEach((tr) => {
      const t = tr as { name?: string };
      expect(t.name).toMatch(/charge/);
    });
  });

  it('switches to lines when showConnectedLine is true', () => {
    const { data } = buildGcdFigure([sampleDataset()], {
      direction: 'discharge',
      showConnectedLine: true,
    });
    data.forEach((tr) => {
      const t = tr as { mode?: string };
      expect(t.mode).toBe('lines');
    });
  });
});

describe('buildGcdCumulativeFigure', () => {
  it('produces monotonically non-decreasing cumulative x for discharge traces', () => {
    const { data } = buildGcdCumulativeFigure([sampleDataset()], {
      direction: 'discharge',
    });
    expect(data.length).toBe(2);
    let lastEnd = -Infinity;
    data.forEach((tr) => {
      const xs = (tr as { x: number[] }).x;
      expect(xs[0]).toBeGreaterThanOrEqual(lastEnd - 1e-9);
      lastEnd = xs[xs.length - 1];
    });
  });

  it('dims non-highlighted cycles when highlightCycle is set', () => {
    const { data } = buildGcdCumulativeFigure([sampleDataset()], {
      direction: 'discharge',
      highlightCycle: 1,
    });
    const cycle1 = data.find((t) => (t as { legendgroup?: string }).legendgroup === 'cell-a-1');
    const cycle2 = data.find((t) => (t as { legendgroup?: string }).legendgroup === 'cell-a-2');
    expect((cycle1 as { opacity?: number }).opacity).toBeUndefined();
    expect((cycle2 as { opacity?: number }).opacity).toBe(0.2);
  });
});

describe('buildVoltageTimeFigure', () => {
  it('produces one line trace per cycle (within maxCycles)', () => {
    const { data } = buildVoltageTimeFigure([sampleDataset()], { maxCycles: 5 });
    expect(data.length).toBe(2);
    data.forEach((tr) => {
      const t = tr as { type?: string; mode?: string };
      expect(t.type).toBe('scatter');
      expect(t.mode).toBe('lines');
    });
  });
});
