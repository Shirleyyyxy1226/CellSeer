import { cellColor, cellCycleColor, cycleFadeColor } from '../style';
import type { BuildDqDvOpts, Dataset, DqDv2DViewMode, DqDvFigure } from '../types';

// Categorical palette — distinguishable for up to ~12 cells.
const CATEGORICAL_COLORS = [
  '#1f77b4', '#ff7f0e', '#2ca02c', '#9467bd',
  '#8c564b', '#e377c2', '#7f7f7f', '#bcbd22',
  '#17becf', '#aec7e8', '#ffbb78', '#98df8a',
];

function categoricalColor(d: Dataset, idx: number): string {
  if (d.color && !d.color.startsWith('#e') && !d.color.startsWith('#f')) return d.color;
  return CATEGORICAL_COLORS[idx % CATEGORICAL_COLORS.length];
}

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

/**
 * Resolve which of a cell's cycles to highlight.
 *
 * `cycleIndex` is a position in the dashboard's *global* union of every cell's
 * cycles, but `dataset.cycles` holds only the cycles this cell actually has — so
 * indexing it positionally highlights the wrong curve, or none at all when the
 * index runs off the end, whenever a cell is missing cycles (dQ/dV is often
 * computed only every Nth cycle). Match the requested cycle *number*
 * (`selectedCycle`) exactly; if this cell does not have that cycle, highlight
 * nothing for it. Fall back to the positional index only when no cycle number
 * was supplied (legacy callers / tests).
 */
function resolveCycle(
  dataset: Dataset,
  selectedCycle: number | undefined,
  cycleIndex: number,
): Dataset['cycles'][number] | undefined {
  if (selectedCycle != null) {
    // Exact cycle-number match; if this cell lacks that cycle, highlight nothing.
    return dataset.cycles.find((c) => c.cycle === selectedCycle);
  }
  return dataset.cycles[cycleIndex];
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

function build3D(datasets: Dataset[], opts: BuildDqDvOpts = {}): DqDvFigure {
  const traces: Plotly.Data[] = [];
  datasets.forEach((dataset, i) => {
    const color = baseColor(dataset, i);
    const total = dataset.cycles.length;
    const active = resolveCycle(dataset, opts.selectedCycle, opts.cycleIndex ?? -1);
    dataset.cycles.forEach((cycle, idx) => {
      const isActive = active != null && cycle.cycle === active.cycle;
      traces.push({
        x: cycle.x,
        y: new Array(cycle.x.length).fill(cycle.cycle),
        z: cycle.y,
        type: 'scatter3d',
        mode: 'lines',
        name: `${dataset.label} - Cycle ${cycle.cycle}`,
        line: {
          color: isActive ? color : cycleFadeColor(color, total <= 1 ? 1 : idx / (total - 1)),
          width: isActive ? 5 : 2,
        },
        opacity: isActive ? 1 : 0.6,
        legendgroup: dataset.id,
        showlegend: idx === total - 1,
        hovertemplate: `${dataset.label}<br>Voltage: %{x:.2f} V<br>Cycle: %{y}<br>dQ/dV: %{z:.2f} mAh V⁻¹<extra></extra>`,
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
        yaxis: { title: { text: 'Cycle (absolute)', font }, gridcolor: '#e0e0e0', tickfont: font },
        zaxis: { title: { text: 'dQ/dV (mAh V⁻¹)', font }, gridcolor: '#e0e0e0', tickfont: font },
        camera: { eye: { x: 1.25, y: 1.25, z: 1.25 } },
      },
      legend: {
        orientation: 'v' as const,
        x: 1.02,
        y: 0,
        xanchor: 'left' as const,
        yanchor: 'bottom' as const,
        font,
      },
      margin: { t: 36, r: 120, b: 48, l: 8 },
    },
  };
}

function build2D(datasets: Dataset[], opts: BuildDqDvOpts): DqDvFigure {
  const cycleIndex = opts.cycleIndex ?? 0;
  const viewMode: DqDv2DViewMode = opts.viewMode ?? 'baseline';
  const baselineCycle = opts.baselineCycle;
  const baselineCycleIndex = opts.baselineCycleIndex ?? 1;
  const traces: Plotly.Data[] = [];

  if (viewMode === 'range') {
    const rangeTraces: Plotly.Data[] = [];
    const lines: Plotly.Data[] = [];
    const peaks: Plotly.Data[] = [];
    datasets.forEach((dataset, i) => {
      const color = categoricalColor(dataset, i);
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
        name: dataset.label,
        legendgroup: dataset.id,
        legendgrouptitle: { text: dataset.label },
        line: { color: hexToRgba(color, 0.25), width: 1.5, ...(dataset.dash ? { dash: dataset.dash } : {}) },
        hovertemplate: `${dataset.label}<br>Voltage: %{x:.2f} V<br>dQ/dV: %{y:.2f} mAh V⁻¹<extra></extra>`,
        showlegend: true,
        connectgaps: false,
      });

      const cycle = resolveCycle(dataset, opts.selectedCycle, cycleIndex);
      if (!cycle) return;
      lines.push({
        x: cycle.x,
        y: cycle.y,
        type: 'scatter',
        mode: 'lines',
        name: `${dataset.label} Cycle ${cycle.cycle}`,
        legendgroup: dataset.id,
        showlegend: false,
        line: { color, width: 2, ...(dataset.dash ? { dash: dataset.dash } : {}) },
        hovertemplate: `${dataset.label}<br>Voltage: %{x:.2f} V<br>dQ/dV: %{y:.2f} mAh V⁻¹<extra></extra>`,
      });

      const { index: peakIndex, value: peakValue } = findPeak(cycle.y);
      peaks.push({
        x: [cycle.x[peakIndex]],
        y: [peakValue],
        type: 'scatter',
        mode: 'markers',
        name: `${dataset.label} peak`,
        legendgroup: dataset.id,
        showlegend: false,
        marker: { size: 10, color, symbol: dataset.symbol ?? 'diamond', line: { width: 1, color: '#fff' } },
        hovertemplate: `${dataset.label} peak<br>Voltage: %{x:.2f} V<br>dQ/dV: %{y:.2f} mAh V⁻¹<extra></extra>`,
      });
    });
    traces.push(...rangeTraces, ...lines, ...peaks);
  } else {
    const baselineLines: Plotly.Data[] = [];
    const lines: Plotly.Data[] = [];
    const peaks: Plotly.Data[] = [];
    datasets.forEach((dataset, i) => {
      const color = baseColor(dataset, i);
      const cycle = resolveCycle(dataset, opts.selectedCycle, cycleIndex);
      if (!cycle) return;
      // Explicit reference cycles (light → dark by cycle order). When the caller
      // passes baselineCycles at all (even []), honour it exactly — an empty list
      // means "no references", so nothing faint is drawn until the user pins one.
      // Only when baselineCycles is omitted do we fall back to the legacy single
      // baselineCycle / baselineCycleIndex.
      const refCycles = opts.baselineCycles !== undefined
        ? opts.baselineCycles.filter((c) => c !== cycle.cycle).sort((a, b) => a - b)
        : null;
      if (refCycles) {
        refCycles.forEach((cyc, j) => {
          const ref = dataset.cycles.find((c) => c.cycle === cyc);
          if (!ref) return;
          const t = refCycles.length > 1 ? 0.18 + 0.42 * (j / (refCycles.length - 1)) : 0.3;
          baselineLines.push({
            x: ref.x,
            y: ref.y,
            type: 'scatter',
            mode: 'lines',
            name: `${dataset.label} Cycle ${ref.cycle}`,
            line: { color: cellCycleColor(color, t), width: 1.5, ...(dataset.dash ? { dash: dataset.dash } : {}) },
            hovertemplate: `${dataset.label} Cycle ${ref.cycle}<br>Voltage: %{x:.2f} V<br>dQ/dV: %{y:.2f} mAh V⁻¹<extra></extra>`,
          });
        });
      } else {
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
            line: { color: hexToRgba(color, 0.4), width: 1.5, ...(dataset.dash ? { dash: dataset.dash } : {}) },
            hovertemplate: `${dataset.label} Cycle ${baseline.cycle}<br>Voltage: %{x:.2f} V<br>dQ/dV: %{y:.2f} mAh V⁻¹<extra></extra>`,
          });
        }
      }
      const { index: peakIndex, value: peakValue } = findPeak(cycle.y);
      const peakVoltage = cycle.x[peakIndex] ?? 0;
      lines.push({
        x: cycle.x,
        y: cycle.y,
        type: 'scatter',
        mode: 'lines',
        name: dataset.label,
        line: { color, width: 2, ...(dataset.dash ? { dash: dataset.dash } : {}) },
        hovertemplate: `${dataset.label}<br>Voltage: %{x:.2f} V<br>dQ/dV: %{y:.2f} mAh V⁻¹<br>Peak: ${peakVoltage.toFixed(2)} V, ${peakValue.toFixed(2)} mAh V⁻¹<extra></extra>`,
      });
      peaks.push({
        x: [peakVoltage],
        y: [peakValue],
        type: 'scatter',
        mode: 'markers',
        name: `${dataset.label} peak`,
        marker: { size: 10, color, symbol: dataset.symbol ?? 'diamond', line: { width: 1, color: '#fff' } },
        hovertemplate: `${dataset.label} peak<br>Voltage: %{x:.2f} V<br>dQ/dV: %{y:.2f} mAh V⁻¹<extra></extra>`,
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
      yaxis: { title: { text: 'dQ/dV (mAh V⁻¹)', font }, tickfont: font, gridcolor: '#e0e0e0', showgrid: true },
      legend: { x: 1.02, y: 1, xanchor: 'left' as const, yanchor: 'top' as const, orientation: 'v' as const, font },
      margin: { t: 36, r: 8, b: 48, l: 40 },
      showlegend: true,
    },
  };
}

export function buildDqDvFigure(datasets: Dataset[], opts: BuildDqDvOpts = {}): DqDvFigure {
  const mode = opts.mode ?? '3d';
  return mode === '2d' ? build2D(datasets, opts) : build3D(datasets, opts);
}
