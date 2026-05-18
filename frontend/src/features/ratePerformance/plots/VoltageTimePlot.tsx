import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';

const COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b'];
const MAX_CYCLES = 5;

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
  const traces = useMemo((): Plotly.Data[] => {
    const result: Plotly.Data[] = [];
    cellRecords.forEach((record) => {
      const curveKeys = Object.keys(record.curves).slice(0, 200);
      const cycles = curveKeys
        .map((k) => parseInt(k, 10))
        .filter((x) => !isNaN(x))
        .sort((a, b) => a - b)
        .slice(0, MAX_CYCLES);
      for (const cyc of cycles) {
        const curve = record.curves[String(cyc)];
        if (!curve) continue;
        const vKey = 'Voltage [V]' in curve ? 'Voltage [V]' : 'voltage';
        const tKey = 'Time [s]' in curve ? 'Time [s]' : null;
        const v = (curve[vKey] ?? []) as (number | null)[];
        const tRaw = tKey ? (curve[tKey] ?? []) as (number | null)[] : null;
        const times: number[] = [];
        const volts: number[] = [];
        for (let j = 0; j < v.length; j++) {
          const vv = v[j];
          if (vv == null) continue;
          times.push(tRaw && tRaw[j] != null ? (tRaw[j] as number) : j);
          volts.push(vv);
        }
        if (times.length >= 2) {
          const traceColor = record.color ?? COLORS[result.length % COLORS.length];
          result.push({
            x: times, y: volts,
            type: 'scatter', mode: 'lines',
            name: `${record.cellName} — Cycle ${cyc}`,
            line: { width: 1.5, color: traceColor },
            hovertemplate: `${record.cellName} Cycle ${cyc}<br>Time: %{x:.1f} s<br>Voltage: %{y:.3f} V<extra></extra>`,
          });
        }
      }
    });
    return result;
  }, [cellRecords]);

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
