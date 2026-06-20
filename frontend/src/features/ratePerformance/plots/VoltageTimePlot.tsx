import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import { buildVoltageTimeFigure, type RecordDataset } from 'cellseer-lib';
import type { ExportContext } from '@/lib/exportUtils';

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
  exportContext?: ExportContext;
  maxCycles?: number;
  /** When false the (below-the-plot) legend is hidden and its margin reclaimed. */
  showLegend?: boolean;
}

export function VoltageTimePlot({ cellRecords, config, width, height, exportContext, maxCycles = 5, showLegend = true }: Props) {
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

  const { data: traces } = useMemo(
    () => buildVoltageTimeFigure(datasets, { maxCycles }),
    [datasets, maxCycles],
  );

  // One trace per (cell × cycle): the legend explodes fast. Past this count the
  // discrete legend is omitted (cycles read from the colour gradient).
  const legendVisible = showLegend && traces.length <= 12;

  const { titleFontSize: tfs, labelFontSize: lfs, legendFontSize: lgfs, fontFamily: ff } = config;

  const layout = useMemo((): Partial<Plotly.Layout> => ({
    width, height, autosize: false,
    font: { family: `${ff}, sans-serif` },
    title: { text: config.title, font: { size: tfs } },
    xaxis: { title: { text: config.xLabel, font: { size: lfs } }, tickfont: { size: Math.max(9, lfs - 1) }, gridcolor: 'rgba(128,128,128,0.2)' },
    yaxis: { title: { text: config.yLabel, font: { size: lfs } }, tickfont: { size: Math.max(9, lfs - 1) }, gridcolor: 'rgba(128,128,128,0.2)' },
    showlegend: legendVisible,
    // Legend sits in a horizontal row BELOW the x-axis (never in the right gutter,
    // which overflowed and forced an inner scrollbar). Clear of the axis title.
    legend: legendVisible
      ? { orientation: 'h' as const, x: 0, y: -0.28, xanchor: 'left' as const, yanchor: 'top' as const, font: { size: lgfs } }
      : undefined,
    margin: { t: 48, r: 44, b: legendVisible ? 110 : 70, l: 65 },
    uirevision: 'rate-perf-initial-v',
  }), [width, height, config, tfs, lfs, lgfs, ff, legendVisible]);

  return (
    <PlotlyChart
      key={`vt-${width}-${height}`}
      data={traces}
      layout={layout}
      config={{ responsive: true }}
      style={{ width, height }}
      exportContext={exportContext ?? { plotType: 'voltage-time' }}
    />
  );
}
