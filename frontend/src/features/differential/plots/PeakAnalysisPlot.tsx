import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';

interface Props {
  traces: Plotly.Data[];
  xLabel: string;
  yLabel: string;
  title: string;
  uirevision: string;
  layoutOverride?: Partial<Plotly.Layout>;
}

const smallFont = { size: 10, family: 'Inter' as const };

export function PeakAnalysisPlot({ traces, xLabel, yLabel, title, uirevision, layoutOverride }: Props) {
  const layout = useMemo<Partial<Plotly.Layout>>(() => ({
    uirevision,
    title: { text: title, font: { size: 11, family: 'Inter' } },
    font: smallFont,
    xaxis: { title: { text: xLabel, font: smallFont }, tickfont: smallFont, gridcolor: '#e0e0e0', showgrid: true },
    yaxis: { title: { text: yLabel, font: smallFont }, tickfont: smallFont, gridcolor: '#e0e0e0', showgrid: true },
    legend: { x: 0.5, y: -0.12, xanchor: 'center', yanchor: 'top', orientation: 'h', font: smallFont },
    margin: { t: 36, r: 8, b: 48, l: 40 },
    showlegend: true,
    ...layoutOverride,
  }), [uirevision, title, xLabel, yLabel, layoutOverride]);

  return <PlotlyChart data={traces} layout={layout} style={{ width: '100%', height: '450px' }} />;
}
