import { useEffect, useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import { buildVoltageTimeFigure, type RecordDataset } from 'cellseer-lib';
import type { ExportContext } from '@/lib/exportUtils';
import { tracesToLegendItems } from '@/lib/traceLegend';
import type { LegendItem } from '@/components/ChartLegend';

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
  /** Receives the derived legend entries so the dashboard can render the
   *  legend as a block below the plot (see ChartLegend). */
  onLegendItems?: (items: LegendItem[]) => void;
}

export function VoltageTimePlot({ cellRecords, config, width, height, exportContext, maxCycles = 5, onLegendItems }: Props) {
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

  const { titleFontSize: tfs, labelFontSize: lfs, fontFamily: ff } = config;

  const layout = useMemo((): Partial<Plotly.Layout> => ({
    width, height, autosize: false,
    font: { family: `${ff}, sans-serif` },
    title: { text: config.title, font: { size: tfs } },
    xaxis: { title: { text: config.xLabel, font: { size: lfs } }, tickfont: { size: Math.max(9, lfs - 1) }, gridcolor: 'rgba(128,128,128,0.2)' },
    yaxis: { title: { text: config.yLabel, font: { size: lfs } }, tickfont: { size: Math.max(9, lfs - 1) }, gridcolor: 'rgba(128,128,128,0.2)' },
    // Legend is drawn as an HTML block below the plot (see ChartLegend), so the
    // in-figure legend is off and the inflated bottom margin is reclaimed.
    showlegend: false,
    margin: { t: 48, r: 44, b: 70, l: 65 },
    uirevision: 'rate-perf-initial-v',
  }), [width, height, config, tfs, lfs, ff]);

  // Surface the derived legend entries for the block the dashboard renders.
  const legendItems = useMemo(() => tracesToLegendItems(traces), [traces]);
  useEffect(() => {
    onLegendItems?.(legendItems);
  }, [legendItems, onLegendItems]);

  return (
    <PlotlyChart
      key={`vt-${width}-${height}`}
      data={traces}
      layout={layout}
      config={{ responsive: true }}
      style={{ width, height }}
      hoverFocus={cellRecords.length > 1}
      exportContext={exportContext ?? { plotType: 'voltage-time' }}
    />
  );
}
