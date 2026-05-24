import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';

interface Props {
  traces: Plotly.Data[];
  xValues: number[];
  xLabel: string;
  zLabel: string;
  title: string;
  uirevision: string;
  layoutOverride?: Partial<Plotly.Layout>;
}

const smallFont = { size: 10, family: 'Inter' as const };

export function Surface3dPlot({ traces, xValues, xLabel, zLabel, title, uirevision, layoutOverride }: Props) {
  const layout = useMemo<Partial<Plotly.Layout>>(() => ({
    uirevision,
    title: { text: title, font: { size: 11, family: 'Inter' } },
    font: smallFont,
    scene: {
      xaxis: {
        title: { text: xLabel, font: smallFont },
        range: xValues.length > 0 ? [Math.max(...xValues), Math.min(...xValues)] : undefined,
        gridcolor: '#e0e0e0',
        tickfont: smallFont,
      },
      yaxis: { title: { text: 'Cycle', font: smallFont }, gridcolor: '#e0e0e0', tickfont: smallFont },
      zaxis: { title: { text: zLabel, font: smallFont }, gridcolor: '#e0e0e0', tickfont: smallFont },
      camera: { eye: { x: 1.25, y: 1.25, z: 1.25 } },
    },
    legend: { x: 0, y: -0.12, orientation: 'h', font: smallFont },
    margin: { t: 36, r: 8, b: 8, l: 8 },
    ...layoutOverride,
  }), [uirevision, title, xLabel, zLabel, xValues, layoutOverride]);

  return <PlotlyChart data={traces} layout={layout} style={{ width: '100%', height: '500px' }} />;
}
