import { describe, expect, it } from 'vitest';
import { buildDvDqFigure, type Dataset } from './index';

function sampleDatasets(): Dataset[] {
  return [
    {
      id: 'cell-a',
      label: 'Cell A',
      color: '#1f77b4',
      cycles: [
        { cycle: 1, x: [0.0, 0.01], y: [0.05, 0.1] },
        { cycle: 2, x: [0.0, 0.01], y: [0.2, 0.3] },
      ],
    },
  ];
}

function sparseDataset(): Dataset[] {
  return [{ id: 'cell-a', label: 'Cell A', color: '#1f77b4', cycles: [
    { cycle: 5, x: [0.0, 0.01], y: [0.1, 0.2] },
    { cycle: 10, x: [0.0, 0.01], y: [0.3, 0.4] },
    { cycle: 28, x: [0.0, 0.01], y: [0.5, 0.9] },
  ] }];
}

describe('buildDvDqFigure', () => {
  it('builds one scatter3d trace per cycle with capacity-axis label', () => {
    const fig = buildDvDqFigure(sampleDatasets(), { mode: '3d' });
    expect(fig.data).toHaveLength(2);
    expect(fig.data[0]?.type).toBe('scatter3d');
    expect((fig.data[1] as Partial<Plotly.ScatterData>)?.showlegend).toBe(true);
    const scene = fig.layout.scene as Partial<Plotly.Layout['scene']>;
    expect(scene?.xaxis?.title).toMatchObject({ text: 'Capacity (mAh)' });
    expect(scene?.zaxis?.title).toMatchObject({ text: 'dV/dQ (V mAh⁻¹)' });
    expect(scene?.xaxis?.range).toBeUndefined();
  });

  it('builds baseline 2d traces with capacity-based peak hover', () => {
    const fig = buildDvDqFigure(sampleDatasets(), {
      mode: '2d',
      viewMode: 'baseline',
      cycleIndex: 1,
      baselineCycleIndex: 0,
    });
    expect(fig.data.length).toBeGreaterThanOrEqual(3);
    const baseline = fig.data.find((d) => d.type === 'scatter' && d.mode === 'lines' && d.name === 'Cell A Cycle 1');
    expect(baseline).toBeDefined();
    const line = fig.data.find((d) => d.type === 'scatter' && d.mode === 'lines' && d.name === 'Cell A');
    expect(String((line as Partial<Plotly.ScatterData> | undefined)?.hovertemplate)).toContain('Peak:');
    expect(String((line as Partial<Plotly.ScatterData> | undefined)?.hovertemplate)).toContain('Ah');
    expect(fig.layout.xaxis?.title).toMatchObject({ text: 'Capacity (mAh)' });
    expect(fig.layout.yaxis?.title).toMatchObject({ text: 'dV/dQ (V mAh⁻¹)' });
  });

  it('omits baseline trace when exact baseline cycle is missing', () => {
    const fig = buildDvDqFigure(sampleDatasets(), {
      mode: '2d',
      viewMode: 'baseline',
      cycleIndex: 1,
      baselineCycle: 99,
    });
    const baseline = fig.data.find((d) => d.type === 'scatter' && d.mode === 'lines' && d.name === 'Cell A Cycle 99');
    expect(baseline).toBeUndefined();
  });

  it('builds range 2d traces with one range trace per dataset plus selected cycle + peak', () => {
    const fig = buildDvDqFigure(sampleDatasets(), {
      mode: '2d',
      viewMode: 'range',
      cycleIndex: 0,
    });
    const rangeTrace = fig.data.find((d) => d.type === 'scatter' && d.mode === 'lines' && d.name === 'Cell A');
    expect(rangeTrace).toBeDefined();
    const cycleLine = fig.data.find((d) => d.type === 'scatter' && d.mode === 'lines' && d.name === 'Cell A · Cycle 1');
    expect(cycleLine).toBeDefined();
    const peak = fig.data.find((d) => d.type === 'scatter' && d.mode === 'markers' && d.name === 'Peak');
    expect(peak).toBeDefined();
  });

  it('highlights by selected cycle NUMBER, not positional index, for sparse cells', () => {
    const fig = buildDvDqFigure(sparseDataset(), {
      mode: '2d',
      viewMode: 'range',
      cycleIndex: 27,
      selectedCycle: 28,
    });
    const highlight = fig.data.find((d) => d.type === 'scatter' && d.mode === 'lines' && d.name === 'Cell A · Cycle 28');
    expect(highlight).toBeDefined();
    expect((highlight as Partial<Plotly.ScatterData> | undefined)?.y).toEqual([0.5, 0.9]);
  });

  it('highlights nothing for a cell when the selected cycle is absent (no nearest fallback)', () => {
    const fig = buildDvDqFigure(sparseDataset(), {
      mode: '2d',
      viewMode: 'range',
      cycleIndex: 27,
      selectedCycle: 12,
    });
    const highlight = fig.data.find(
      (d) => d.type === 'scatter' && d.mode === 'lines' && String(d.name).startsWith('Cell A · Cycle'),
    );
    expect(highlight).toBeUndefined();
  });
});
