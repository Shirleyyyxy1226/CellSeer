import { describe, expect, it } from 'vitest';
import { buildDqDvFigure, normalizeCyclerDatasets, type Dataset } from './index';

function sampleDatasets(): Dataset[] {
  return [
    {
      id: 'cell-a',
      label: 'Cell A',
      color: '#1f77b4',
      cycles: [
        { cycle: 1, x: [4.2, 4.0], y: [0.1, 0.2] },
        { cycle: 2, x: [4.2, 4.0], y: [0.3, 0.4] },
      ],
    },
  ];
}

function sparseDataset(): Dataset[] {
  return [{ id: 'cell-a', label: 'Cell A', color: '#1f77b4', cycles: [
    { cycle: 5, x: [4.2, 4.0], y: [0.1, 0.2] },
    { cycle: 10, x: [4.2, 4.0], y: [0.3, 0.4] },
    { cycle: 28, x: [4.2, 4.0], y: [0.5, 0.9] },
  ] }];
}

describe('buildDqDvFigure', () => {
  it('builds one scatter3d trace per cycle and reverses x range', () => {
    const fig = buildDqDvFigure(sampleDatasets(), { mode: '3d' });
    expect(fig.data).toHaveLength(2);
    expect(fig.data[0]?.type).toBe('scatter3d');
    expect((fig.data[1] as Partial<Plotly.ScatterData>)?.showlegend).toBe(true);
    const scene = fig.layout.scene as Partial<Plotly.Layout['scene']>;
    expect(scene?.xaxis?.range).toEqual([4.2, 4.0]);
  });

  it('builds baseline 2d traces including peak in hover', () => {
    const fig = buildDqDvFigure(sampleDatasets(), {
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
  });

  it('omits baseline trace when exact baseline cycle is missing', () => {
    const fig = buildDqDvFigure(sampleDatasets(), {
      mode: '2d',
      viewMode: 'baseline',
      cycleIndex: 1,
      baselineCycle: 99,
    });
    const baseline = fig.data.find((d) => d.type === 'scatter' && d.mode === 'lines' && d.name === 'Cell A Cycle 99');
    expect(baseline).toBeUndefined();
  });

  it('highlights by selected cycle NUMBER, not positional index, for sparse cells', () => {
    // cycleIndex 27 runs off the end of this 3-cycle cell; resolving by the
    // selected cycle NUMBER (28) finds the real curve regardless of position.
    const fig = buildDqDvFigure(sparseDataset(), {
      mode: '2d',
      viewMode: 'range',
      cycleIndex: 27,
      selectedCycle: 28,
    });
    const highlight = fig.data.find((d) => d.type === 'scatter' && d.mode === 'lines' && d.name === 'Cell A Cycle 28');
    expect(highlight).toBeDefined();
    expect((highlight as Partial<Plotly.ScatterData> | undefined)?.y).toEqual([0.5, 0.9]);
  });

  it('highlights nothing for a cell when the selected cycle is absent (no nearest fallback)', () => {
    // 12 is not in {5,10,28}; the cell must not get any highlighted cycle line.
    const fig = buildDqDvFigure(sparseDataset(), {
      mode: '2d',
      viewMode: 'range',
      cycleIndex: 27,
      selectedCycle: 12,
    });
    const highlight = fig.data.find(
      (d) => d.type === 'scatter' && d.mode === 'lines' && String(d.name).startsWith('Cell A Cycle'),
    );
    expect(highlight).toBeUndefined();
  });
});

describe('normalizeCyclerDatasets', () => {
  it('normalizes map, single record, and mixed array inputs', () => {
    const fromMap = normalizeCyclerDatasets({
      Sample: { id: 'id-1', cycles: [{ cycle: 1, v: [4.2, 4.1], dqdv: [0.1, 0.2] }] },
    });
    expect(fromMap).toHaveLength(1);
    expect(fromMap[0]?.label).toBe('Sample');

    const fromSingle = normalizeCyclerDatasets({
      cellId: 'id-2',
      cellName: 'Cell 2',
      cycles: [{ cycle: 2, v: [4.2], dqdv: [0.1] }],
    });
    expect(fromSingle).toHaveLength(1);

    const fromMixed = normalizeCyclerDatasets([
      { id: 'id-3', label: 'Cell 3', cycles: [{ cycle: 1, x: [4.2, 4.1], y: [0.2, 0.3] }] },
      { id: 'id-4', cycles: [{ cycle: 1, v: [4.2, 4.1], dqdv: [0.1, 0.2] }] },
    ]);
    expect(fromMixed).toHaveLength(2);
  });
});
