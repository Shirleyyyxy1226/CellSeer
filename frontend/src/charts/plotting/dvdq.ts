import { cellColor, cellCycleColor, cycleFadeColor } from '../style';
import type { BuildDvDqOpts, Dataset, DvDq2DViewMode, DvDqFigure } from '../types';

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

function smallFont(): { size: number; family: 'Inter' } {
  return { size: 10, family: 'Inter' };
}

function build3D(datasets: Dataset[], opts: BuildDvDqOpts = {}): DvDqFigure {
  const capLabel = opts.normalizedCapacity ? 'Normalised capacity (Q/Q_max)' : 'Capacity (mAh)';
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
        name: `${dataset.label} · Cycle ${cycle.cycle}`,
        line: { color: cycleFadeColor(color, total <= 1 ? 1 : idx / (total - 1)), width: 3 },
        legendgroup: dataset.id,
        showlegend: idx === total - 1,
        hovertemplate: `${dataset.label}<br>Capacity: %{x:.2f}<br>Cycle: %{y}<br>dV/dQ: %{z:.4f} V mAh⁻¹<extra></extra>`,
      });
    });
  });

  const font = smallFont();
  return {
    data: traces,
    layout: {
      font,
      scene: {
        xaxis: { title: { text: capLabel, font }, gridcolor: '#e0e0e0', tickfont: font },
        yaxis: { title: { text: 'Cycle', font }, gridcolor: '#e0e0e0', tickfont: font },
        zaxis: { title: { text: 'dV/dQ (V mAh⁻¹)', font }, gridcolor: '#e0e0e0', tickfont: font },
        camera: { eye: { x: 1.25, y: 1.25, z: 1.25 } },
      },
      legend: { x: 1, y: 1, xanchor: 'right' as const, yanchor: 'top' as const, orientation: 'v' as const, font },
      margin: { t: 36, r: 8, b: 8, l: 8 },
    },
  };
}

function build2D(datasets: Dataset[], opts: BuildDvDqOpts): DvDqFigure {
  const cycleIndex = opts.cycleIndex ?? 0;
  const viewMode: DvDq2DViewMode = opts.viewMode ?? 'baseline';
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
      const hasMultipleCycles = dataset.cycles.length > 1;
      if (hasMultipleCycles) {
        rangeTraces.push({
          x: xParts,
          y: yParts,
          type: 'scatter',
          mode: 'lines',
          name: dataset.label,
          legendgroup: dataset.id,
          legendgrouptitle: { text: dataset.label },
          line: { color: hexToRgba(color, 0.25), width: 1.5, ...(dataset.dash ? { dash: dataset.dash } : {}) },
          hovertemplate: `${dataset.label}<br>Capacity: %{x:.2f} mAh<br>dV/dQ: %{y:.4f} V mAh⁻¹<extra></extra>`,
          showlegend: true,
          connectgaps: false,
        });
      }

      const cycle = resolveCycle(dataset, opts.selectedCycle, cycleIndex);
      if (!cycle) return;
      lines.push({
        x: cycle.x,
        y: cycle.y,
        type: 'scatter',
        mode: 'lines',
        name: `${dataset.label} · Cycle ${cycle.cycle}`,
        legendgroup: dataset.id,
        showlegend: false,
        line: { color, width: 2, ...(dataset.dash ? { dash: dataset.dash } : {}) },
        hovertemplate: `${dataset.label}<br>Capacity: %{x:.2f} mAh<br>dV/dQ: %{y:.4f} V mAh⁻¹<extra></extra>`,
      });

      const { index: peakIndex, value: peakValue } = findPeak(cycle.y);
      peaks.push({
        x: [cycle.x[peakIndex]],
        y: [peakValue],
        type: 'scatter',
        mode: 'markers',
        name: 'Peak',
        legendgroup: dataset.id,
        showlegend: false,
        marker: { size: 10, color, symbol: dataset.symbol ?? 'diamond', line: { width: 1, color: '#fff' } },
        hovertemplate: `${dataset.label} peak<br>Capacity: %{x:.2f} mAh<br>dV/dQ: %{y:.4f} V mAh⁻¹<extra></extra>`,
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
      // passes baselineCycles at all (even []), honour it exactly; only when it is
      // omitted do we fall back to the legacy single baselineCycle / index.
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
            hovertemplate: `${dataset.label} Cycle ${ref.cycle}<br>Capacity: %{x:.2f} mAh<br>dV/dQ: %{y:.4f} V mAh⁻¹<extra></extra>`,
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
            hovertemplate: `${dataset.label} Cycle ${baseline.cycle}<br>Capacity: %{x:.2f} mAh<br>dV/dQ: %{y:.4f} V mAh⁻¹<extra></extra>`,
          });
        }
      }
      const { index: peakIndex, value: peakValue } = findPeak(cycle.y);
      const peakCapacity = cycle.x[peakIndex] ?? 0;
      lines.push({
        x: cycle.x,
        y: cycle.y,
        type: 'scatter',
        mode: 'lines',
        name: dataset.label,
        line: { color, width: 2, ...(dataset.dash ? { dash: dataset.dash } : {}) },
        hovertemplate: `${dataset.label}<br>Capacity: %{x:.2f} mAh<br>dV/dQ: %{y:.4f} V mAh⁻¹<br>Peak: ${peakCapacity.toFixed(2)} mAh, ${peakValue.toFixed(4)} V mAh⁻¹<extra></extra>`,
      });
      peaks.push({
        x: [peakCapacity],
        y: [peakValue],
        type: 'scatter',
        mode: 'markers',
        name: `${dataset.label} · Peak`,
        marker: { size: 10, color, symbol: dataset.symbol ?? 'diamond', line: { width: 1, color: '#fff' } },
        hovertemplate: `${dataset.label} peak<br>Capacity: %{x:.2f} mAh<br>dV/dQ: %{y:.4f} V mAh⁻¹<extra></extra>`,
      });
    });
    traces.push(...baselineLines, ...lines, ...peaks);
  }

  const font = smallFont();
  const capLabel = opts.normalizedCapacity ? 'Normalised capacity (Q/Q_max)' : 'Capacity (mAh)';
  return {
    data: traces,
    layout: {
      font,
      xaxis: { title: { text: capLabel, font }, tickfont: font, gridcolor: '#e0e0e0', showgrid: true },
      yaxis: { title: { text: 'dV/dQ (V mAh⁻¹)', font }, tickfont: font, gridcolor: '#e0e0e0', showgrid: true },
      legend: { x: 1.02, y: 1, xanchor: 'left' as const, yanchor: 'top' as const, orientation: 'v' as const, font },
      margin: { t: 36, r: 8, b: 48, l: 40 },
      showlegend: true,
    },
  };
}

export function buildDvDqFigure(datasets: Dataset[], opts: BuildDvDqOpts = {}): DvDqFigure {
  const mode = opts.mode ?? '3d';
  return mode === '2d' ? build2D(datasets, opts) : build3D(datasets, opts);
}
