import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import { buildVoltageTimeFigure, type RecordDataset } from '@/cellviz-lib';

export interface VoltageTimeCellRecord {
  cellName: string;
  curves: Record<string, Record<string, (number | string | null)[]>>;
  color?: string;
}

export interface VoltageTimePlotConfig {
  title: string;
  xLabel: string;
  yLabel: string;
  fontFamily: string;
  titleFontSize: number;
  labelFontSize: number;
  legendFontSize: number;
}

interface Props {
  cellRecords: VoltageTimeCellRecord[];
  config: VoltageTimePlotConfig;
  width: number;
  height: number;
}

export function VoltageTimePlot({ cellRecords, config, width, height }: Props) {
  const datasets = useMemo<RecordDataset[]>(
    () =>
      cellRecords.map((record, idx) => ({
        id: `${record.cellName ?? 'cell'}-${idx}`,
        label: record.cellName,
        color: record.color,
        curves: record.curves,
      })),
    [cellRecords],
  );

  const { data: traces } = useMemo(() => buildVoltageTimeFigure(datasets, { maxCycles: 5 }), [datasets]);

  const { titleFontSize: tfs, labelFontSize: lfs, legendFontSize: lgfs, fontFamily: ff } = config;

  const layout = useMemo((): Partial<Plotly.Layout> => ({
    width, height, autosize: false,
    font: { family: `${ff}, sans-serif` },
    title: { text: config.title, font: { size: tfs } },
    xaxis: { title: { text: config.xLabel, font: { size: lfs } }, tickfont: { size: Math.max(9, lfs - 1) }, gridcolor: 'rgba(128,128,128,0.2)' },
    yaxis: { title: { text: config.yLabel, font: { size: lfs } }, tickfont: { size: Math.max(9, lfs - 1) }, gridcolor: 'rgba(128,128,128,0.2)' },
    showlegend: true,
    legend: { x: 1.02, y: 1, xanchor: 'left', yanchor: 'top', font: { size: lgfs } },
    margin: { t: 48, r: 120, b: 80, l: 65 },
    uirevision: 'rate-perf-initial-v',
  }), [width, height, config, tfs, lfs, lgfs, ff]);

  return (
    <PlotlyChart
      key={`vt-${width}-${height}`}
      data={traces}
      layout={layout}
      config={{ responsive: true }}
      style={{ width, height }}
    />
  );
}
