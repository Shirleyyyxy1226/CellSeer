import type {
  BuildRatePerfOpts,
  RatePerfFigure,
  RatePerfProtocolSegment,
  RatePerfTraceSpec,
} from '../types';

function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

function segmentByCrate(
  x: number[],
  y: number[],
  cRates?: number[],
): { x: (number | null)[]; y: (number | null)[]; customdata?: (number | null)[] } {
  if (!cRates || cRates.length !== x.length) return { x, y, customdata: cRates };
  const xOut: (number | null)[] = [];
  const yOut: (number | null)[] = [];
  const cOut: (number | null)[] = [];
  for (let i = 0; i < x.length; i++) {
    if (i > 0 && cRates[i] !== cRates[i - 1]) {
      xOut.push(null);
      yOut.push(null);
      cOut.push(null);
    }
    xOut.push(x[i]);
    yOut.push(y[i]);
    cOut.push(cRates[i]);
  }
  return { x: xOut, y: yOut, customdata: cOut };
}

function buildProtocolShapes(
  segments: RatePerfProtocolSegment[],
  yMax: number,
): Partial<Plotly.Shape>[] {
  if (segments.length <= 1) return [];
  const yTop = yMax * 1.02 || 1;
  return segments.slice(0, -1).map((seg) => ({
    type: 'line' as const,
    x0: seg.cycleEnd + 0.5,
    x1: seg.cycleEnd + 0.5,
    y0: 0,
    y1: yTop,
    xref: 'x',
    yref: 'y',
    line: { dash: 'dash', width: 1.5, color: 'rgba(128,128,128,0.7)' },
    layer: 'below',
  }));
}

function buildProtocolAnnotations(
  segments: RatePerfProtocolSegment[],
): Partial<Plotly.Annotations>[] {
  if (!segments.length) return [];
  return segments.map((seg) => ({
    x: (seg.cycleStart + seg.cycleEnd) / 2,
    y: 1,
    yref: 'paper',
    xanchor: 'center',
    yanchor: 'top',
    text: `${seg.cRate}C`,
    showarrow: false,
    font: { size: 10, color: '#555' },
  }));
}

export function buildRatePerformanceFigure(
  traces: RatePerfTraceSpec[],
  opts: BuildRatePerfOpts = {},
): RatePerfFigure {
  const direction = opts.direction ?? 'discharge';
  const useSpecificCapacity = opts.useSpecificCapacity ?? false;
  const showConnectedLine = opts.showConnectedLine ?? false;
  const segments = opts.protocolSegments ?? [];

  const directionLabel = direction === 'charge' ? 'Charge' : 'Discharge';
  const capacityYUnit = useSpecificCapacity ? 'mAh g⁻¹' : 'mAh';

  const out: Plotly.Data[] = [];
  const traceIndexToCell = new Map<number, { idNo: number; cellName: string }>();
  let maxY = 0;

  traces.forEach((t) => {
    const useLines = showConnectedLine && t.hasCrate && t.cRates;
    const hasRange = t.isAggregated && t.errorMinus && t.errorPlus && t.errorMinus.length === t.y.length;
    if (hasRange && t.errorMinus && t.errorPlus) {
      const yMin = t.y.map((v, i) => v - t.errorMinus![i]);
      const yMax = t.y.map((v, i) => v + t.errorPlus![i]);
      out.push({
        x: t.x,
        y: yMin,
        type: 'scatter',
        mode: 'lines',
        line: { width: 0, color: 'rgba(0,0,0,0)' },
        fillcolor: hexToRgba(t.color, 0.25),
        fill: undefined,
        showlegend: false,
        hoverinfo: 'skip' as const,
      });
      out.push({
        x: t.x,
        y: yMax,
        type: 'scatter',
        mode: 'lines',
        line: { width: 0, color: 'rgba(0,0,0,0)' },
        fillcolor: hexToRgba(t.color, 0.25),
        fill: 'tonexty' as const,
        showlegend: false,
        hoverinfo: 'skip' as const,
      });
    }

    const { x, y, customdata } = useLines
      ? segmentByCrate(t.x, t.y, t.cRates)
      : { x: t.x, y: t.y, customdata: t.cRates };

    out.push({
      x,
      y,
      type: 'scatter',
      mode: useLines ? ('lines+markers' as const) : ('markers' as const),
      name: t.name,
      line: useLines
        ? { width: 2, color: t.color, ...(t.dash ? { dash: t.dash } : {}) }
        : undefined,
      marker: {
        size: t.isAggregated ? 5 : 6,
        color: t.color,
        ...(t.symbol ? { symbol: t.symbol } : {}),
      },
      connectgaps: false,
      hovertemplate: t.hasCrate
        ? `${t.name}<br>Cycle: %{x}<br>${directionLabel} capacity: %{y:.2f} ${capacityYUnit}${hasRange ? ' (range)' : ''}<br>C-rate: %{customdata}C<extra></extra>`
        : `${t.name}<br>Cycle: %{x}<br>${directionLabel} capacity: %{y:.2f} ${capacityYUnit}${hasRange ? ' (range)' : ''}<extra></extra>`,
      customdata,
    });

    if (t.cell) traceIndexToCell.set(out.length - 1, t.cell);
    for (const v of t.y) if (Number.isFinite(v) && v > maxY) maxY = v;
    if (t.errorPlus) for (let i = 0; i < t.y.length; i++) {
      const top = t.y[i] + t.errorPlus[i];
      if (Number.isFinite(top) && top > maxY) maxY = top;
    }
  });

  const shapes = buildProtocolShapes(segments, maxY);
  const annotations = buildProtocolAnnotations(segments);

  const layout: Partial<Plotly.Layout> = {
    xaxis: { title: { text: 'Cycle number' }, gridcolor: 'rgba(128,128,128,0.2)' },
    yaxis: {
      title: {
        text: useSpecificCapacity
          ? `${directionLabel} specific capacity (mAh g⁻¹)`
          : `${directionLabel} capacity (mAh)`,
      },
      gridcolor: 'rgba(128,128,128,0.2)',
    },
    shapes,
    annotations,
  };

  return { data: out, layout, shapes, annotations, traceIndexToCell };
}
