import { turboColor } from '../style';
import type { BuildVoltageTimeOpts, RecordDataset, VoltageTimeFigure } from '../types';

const DEFAULT_PALETTE = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];
const DEFAULT_MAX_CYCLES = 5;

export function buildVoltageTimeFigure(
  datasets: RecordDataset[],
  opts: BuildVoltageTimeOpts = {},
): VoltageTimeFigure {
  const maxCycles = opts.maxCycles ?? DEFAULT_MAX_CYCLES;
  const applyTurbo = opts.applyTurboColor ?? true;
  const traces: Plotly.Data[] = [];

  datasets.forEach((dataset, datasetIdx) => {
    const curveKeys = Object.keys(dataset.curves).slice(0, 200);
    const cycles = curveKeys
      .map((k) => parseInt(k, 10))
      .filter((x) => !isNaN(x))
      .sort((a, b) => a - b)
      .slice(0, maxCycles);
    const namePrefix = datasets.length > 1 ? `${dataset.label} — ` : '';
    const fallbackColor = dataset.color ?? DEFAULT_PALETTE[datasetIdx % DEFAULT_PALETTE.length];

    for (const cyc of cycles) {
      const curve = dataset.curves[String(cyc)];
      if (!curve) continue;
      const vKey = 'Voltage [V]' in curve ? 'Voltage [V]' : 'voltage';
      const tKey = 'Time [s]' in curve ? 'Time [s]' : null;
      const v = (curve[vKey] ?? []) as (number | null)[];
      const tRaw = tKey ? ((curve[tKey] ?? []) as (number | null)[]) : null;
      const n = v.length;
      const times: number[] = [];
      const volts: number[] = [];
      for (let j = 0; j < n; j++) {
        const vv = v[j];
        if (vv == null) continue;
        const tt = tRaw && tRaw[j] != null ? (tRaw[j] as number) : j;
        times.push(tt);
        volts.push(vv as number);
      }
      if (times.length >= 2) {
        const traceColor = datasets.length > 1 ? fallbackColor : fallbackColor;
        traces.push({
          x: times,
          y: volts,
          type: 'scatter',
          mode: 'lines',
          name: `${namePrefix}Cycle ${cyc}`,
          line: { width: 1.5, color: traceColor },
          hovertemplate: `${dataset.label} Cycle ${cyc}<br>Time: %{x:.1f} s<br>Voltage: %{y:.3f} V<extra></extra>`,
        });
      }
    }
  });

  if (applyTurbo && datasets.length <= 1 && traces.length > 0) {
    const n = traces.length;
    traces.forEach((tr, idx) => {
      const c = turboColor(n > 1 ? idx / (n - 1) : 0);
      const s = tr as { line?: { color: string } };
      if (s.line) s.line.color = c;
    });
  }

  return {
    data: traces,
    layout: {},
  };
}
