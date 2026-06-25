import type { BuildVoltageTimeOpts, RecordDataset, VoltageTimeFigure } from '../types';

const DEFAULT_MAX_CYCLES = 5;

export function buildVoltageTimeFigure(
  datasets: RecordDataset[],
  opts: BuildVoltageTimeOpts = {},
): VoltageTimeFigure {
  const maxCycles = opts.maxCycles ?? DEFAULT_MAX_CYCLES;
  const traces: Plotly.Data[] = [];

  datasets.forEach((dataset) => {
    const curveKeys = Object.keys(dataset.curves).slice(0, 200);
    const cycles = curveKeys
      .map((k) => parseInt(k, 10))
      .filter((x) => !isNaN(x))
      .sort((a, b) => a - b)
      .slice(0, maxCycles);
    const namePrefix = datasets.length > 1 ? `${dataset.label} — ` : '';
    const fallbackColor = dataset.color ?? '#6b7280';

    let firstCycleRendered = false;
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
        const isFirst = !firstCycleRendered;
        firstCycleRendered = true;
        traces.push({
          x: times,
          y: volts,
          type: 'scatter',
          mode: 'lines',
          name: isFirst ? dataset.label : `${namePrefix}Cycle ${cyc}`,
          showlegend: isFirst,
          line: { width: 1.5, color: fallbackColor },
          hovertemplate: `${dataset.label} Cycle ${cyc}<br>Time: %{x:.1f} s<br>Voltage: %{y:.3f} V<extra></extra>`,
        });
      }
    }
  });

  return {
    data: traces,
    layout: {},
  };
}
