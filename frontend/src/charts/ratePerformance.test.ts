import { describe, expect, it } from 'vitest';
import { buildRatePerformanceFigure, type RatePerfTraceSpec } from './index';

function singleCellTrace(): RatePerfTraceSpec {
  return {
    name: 'Cell 1',
    x: [1, 2, 3, 4, 5, 6],
    y: [180, 175, 170, 150, 145, 140],
    color: '#1f77b4',
    isAggregated: false,
    hasCrate: true,
    cRates: [0.5, 0.5, 0.5, 1, 1, 1],
    cell: { idNo: 1, cellName: 'Cell 1' },
  };
}

function aggregatedTrace(): RatePerfTraceSpec {
  return {
    name: 'Group A',
    x: [1, 2, 3],
    y: [170, 165, 160],
    color: '#ff7f0e',
    isAggregated: true,
    hasCrate: false,
    errorMinus: [5, 5, 5],
    errorPlus: [5, 5, 5],
  };
}

describe('buildRatePerformanceFigure', () => {
  it('emits a single marker trace per cell trace when showConnectedLine=false', () => {
    const fig = buildRatePerformanceFigure([singleCellTrace()], { direction: 'discharge' });
    expect(fig.data).toHaveLength(1);
    const tr = fig.data[0] as { mode?: string; name?: string };
    expect(tr.mode).toBe('markers');
    expect(tr.name).toBe('Cell 1');
    expect(fig.traceIndexToCell.get(0)).toEqual({ idNo: 1, cellName: 'Cell 1' });
  });

  it('segments by C-rate (inserts nulls) and switches to lines+markers when showConnectedLine=true', () => {
    const fig = buildRatePerformanceFigure([singleCellTrace()], {
      direction: 'discharge',
      showConnectedLine: true,
    });
    const tr = fig.data[0] as { mode?: string; x?: (number | null)[] };
    expect(tr.mode).toBe('lines+markers');
    expect(tr.x).toContain(null);
  });

  it('emits two range traces plus the main trace for aggregated input', () => {
    const fig = buildRatePerformanceFigure([aggregatedTrace()], { direction: 'discharge' });
    expect(fig.data).toHaveLength(3);
    const skipHover = (fig.data[0] as { hoverinfo?: string }).hoverinfo;
    expect(skipHover).toBe('skip');
    const fill = (fig.data[1] as { fill?: string }).fill;
    expect(fill).toBe('tonexty');
  });

  it('produces protocol shapes (n-1) and annotations (n) for n segments', () => {
    const fig = buildRatePerformanceFigure([singleCellTrace()], {
      direction: 'discharge',
      protocolSegments: [
        { cycleStart: 1, cycleEnd: 3, cRate: 0.5 },
        { cycleStart: 4, cycleEnd: 6, cRate: 1 },
      ],
    });
    expect(fig.shapes).toHaveLength(1);
    expect(fig.annotations).toHaveLength(2);
  });

  it('labels Y axis differently based on useSpecificCapacity', () => {
    const figRaw = buildRatePerformanceFigure([singleCellTrace()], {
      direction: 'discharge',
      useSpecificCapacity: false,
    });
    const figSpecific = buildRatePerformanceFigure([singleCellTrace()], {
      direction: 'discharge',
      useSpecificCapacity: true,
    });
    const rawTitle = figRaw.layout.yaxis?.title as { text?: string } | undefined;
    const specificTitle = figSpecific.layout.yaxis?.title as { text?: string } | undefined;
    expect(rawTitle?.text).toContain('Discharge capacity');
    expect(specificTitle?.text).toContain('mAh g');
  });
});
