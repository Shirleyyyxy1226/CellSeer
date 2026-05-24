import { cellColor, cycleFadeColor } from '../style';
import type { BuildIcaOpts, Dataset, Ica2DViewMode, IcaFigure } from '../types';

function hexToRgba(hex: string, opacity: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const a = Math.max(0.3, Math.min(1, opacity));
  return `rgba(${r},${g},${b},${a})`;
}

function findPeak(arr: number[]): { index: number; value: number } {
  let index = 0;
  let value = arr[0] ?? 0;
  for (let i = 1; i < arr.length; i++) {
    if (arr[i] > value) {
      value = arr[i];
      index = i;
    }
  }
  return { index, value };
}

function baseColor(d: Dataset, idx: number): string {
  return d.color ?? cellColor(d.id, idx);
}

function voltageExtent(datasets: Dataset[]): [number, number] | undefined {
  let min = Number.POSITIVE_INFINITY;
  let max = Number.NEGATIVE_INFINITY;
  for (const dataset of datasets) {
    for (const cycle of dataset.cycles) {
      for (const v of cycle.x) {
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
  }
  if (!Number.isFinite(min) || !Number.isFinite(max)) return undefined;
  return [max, min];
}

function smallFont(): { size: number; family: 'Inter' } {
  return { size: 10, family: 'Inter' };
}

function build3D(datasets: Dataset[]): IcaFigure {
  const traces: Plotly.Data[] = [];
  datasets.forEach((dataset, i) => {
    const color = baseColor(dataset, i);
    const total = dataset.cycles.length;
    dataset.cycles.forEach((cycle, idx) => {
      traces.push({
        x: cycle.x,
        y: new Array(cycle.x.length).fill(cycle.cycle),
        z: cycle.y,
        type: 'scatter3d',
        mode: 'lines',
        name: `${dataset.label} - Cycle ${cycle.cycle}`,
        line: { color: cycleFadeColor(color, total <= 1 ? 1 : idx / (total - 1)), width: 3 },
        legendgroup: dataset.id,
        showlegend: idx === total - 1,
        hovertemplate: `${dataset.label}<br>Voltage: %{x:.2f} V<br>Cycle: %{y}<br>IC: %{z:.2f} Ah/V<extra></extra>`,
      });
    });
  });

  const font = smallFont();
  return {
    data: traces,
    layout: {
      font,
      scene: {
        xaxis: { title: { text: 'Voltage (V)', font }, range: voltageExtent(datasets), gridcolor: '#e0e0e0', tickfont: font },
        yaxis: { title: { text: 'Cycle', font }, gridcolor: '#e0e0e0', tickfont: font },
        zaxis: { title: { text: 'dQ/dV (Ah/V)', font }, gridcolor: '#e0e0e0', tickfont: font },
        camera: { eye: { x: 1.25, y: 1.25, z: 1.25 } },
      },
      legend: { x: 0, y: -0.12, orientation: 'h', font },
      margin: { t: 36, r: 8, b: 8, l: 8 },
    },
  };
}

function build2D(datasets: Dataset[], opts: BuildIcaOpts): IcaFigure {
  const cycleIndex = opts.cycleIndex ?? 0;
  const viewMode: Ica2DViewMode = opts.viewMode ?? 'baseline';
  const baselineCycle = opts.baselineCycle;
  const baselineCycleIndex = opts.baselineCycleIndex ?? 1;
  const traces: Plotly.Data[] = [];

  if (viewMode === 'range') {
    const rangeTraces: Plotly.Data[] = [];
    const lines: Plotly.Data[] = [];
    const peaks: Plotly.Data[] = [];
    datasets.forEach((dataset, i) => {
      const color = baseColor(dataset, i);
      const xParts: (number | null)[] = [];
      const yParts: (number | null)[] = [];
      dataset.cycles.forEach((cycle, idx) => {
        if (idx > 0) {
          xParts.push(null);
          yParts.push(null);
        }
        xParts.push(...cycle.x);
        yParts.push(...cycle.y);
      });
      rangeTraces.push({
        x: xParts,
        y: yParts,
        type: 'scatter',
        mode: 'lines',
        name: `${dataset.label} range`,
        line: { color: hexToRgba(color, 0.25), width: 1.5 },
        hovertemplate: `${dataset.label}<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>`,
        showlegend: true,
        connectgaps: false,
      });

      const cycle = dataset.cycles[cycleIndex];
      if (!cycle) return;
      lines.push({
        x: cycle.x,
        y: cycle.y,
        type: 'scatter',
        mode: 'lines',
        name: `${dataset.label} Cycle ${cycle.cycle}`,
        line: { color, width: 2 },
        hovertemplate: `${dataset.label}<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>`,
      });

      const { index: peakIndex, value: peakValue } = findPeak(cycle.y);
      peaks.push({
        x: [cycle.x[peakIndex]],
        y: [peakValue],
        type: 'scatter',
        mode: 'markers',
        name: `${dataset.label} peak`,
        marker: { size: 10, color, symbol: 'diamond', line: { width: 1, color: '#fff' } },
        hovertemplate: `${dataset.label} peak<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>`,
      });
    });
    traces.push(...rangeTraces, ...lines, ...peaks);
  } else {
    const baselineLines: Plotly.Data[] = [];
    const lines: Plotly.Data[] = [];
    const peaks: Plotly.Data[] = [];
    datasets.forEach((dataset, i) => {
      const color = baseColor(dataset, i);
      const cycle = dataset.cycles[cycleIndex];
      if (!cycle) return;
      const baseline = baselineCycle != null
        ? dataset.cycles.find((c) => c.cycle === baselineCycle)
        : dataset.cycles[baselineCycleIndex];
      if (baseline) {
        baselineLines.push({
          x: baseline.x,
          y: baseline.y,
          type: 'scatter',
          mode: 'lines',
          name: `${dataset.label} Cycle ${baseline.cycle}`,
          line: { color: hexToRgba(color, 0.4), width: 1.5 },
          hovertemplate: `${dataset.label} Cycle ${baseline.cycle}<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>`,
        });
      }
      const { index: peakIndex, value: peakValue } = findPeak(cycle.y);
      const peakVoltage = cycle.x[peakIndex] ?? 0;
      lines.push({
        x: cycle.x,
        y: cycle.y,
        type: 'scatter',
        mode: 'lines',
        name: dataset.label,
        line: { color, width: 2 },
        hovertemplate: `${dataset.label}<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<br>Peak: ${peakVoltage.toFixed(2)} V, ${peakValue.toFixed(2)} Ah/V<extra></extra>`,
      });
      peaks.push({
        x: [peakVoltage],
        y: [peakValue],
        type: 'scatter',
        mode: 'markers',
        name: `${dataset.label} peak`,
        marker: { size: 10, color, symbol: 'diamond', line: { width: 1, color: '#fff' } },
        hovertemplate: `${dataset.label} peak<br>Voltage: %{x:.2f} V<br>IC: %{y:.2f} Ah/V<extra></extra>`,
      });
    });
    traces.push(...baselineLines, ...lines, ...peaks);
  }

  const font = smallFont();
  return {
    data: traces,
    layout: {
      font,
      xaxis: { title: { text: 'Voltage (V)', font }, tickfont: font, gridcolor: '#e0e0e0', showgrid: true },
      yaxis: { title: { text: 'Incremental Capacity (Ah/V)', font }, tickfont: font, gridcolor: '#e0e0e0', showgrid: true },
      legend: { x: 0.5, y: -0.12, xanchor: 'center', yanchor: 'top', orientation: 'h', font },
      margin: { t: 36, r: 8, b: 48, l: 40 },
      showlegend: true,
    },
  };
}

export function buildIcaFigure(datasets: Dataset[], opts: BuildIcaOpts = {}): IcaFigure {
  const mode = opts.mode ?? '3d';
  return mode === '2d' ? build2D(datasets, opts) : build3D(datasets);
}
