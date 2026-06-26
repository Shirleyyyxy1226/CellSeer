/**
 * Trajectories data shaping. Builds one small-multiples panel
 * per condition: each replicate's capacity-vs-cycle line plus a cohort-mean
 * trajectory, in either absolute discharge capacity or per-cycle CE space.
 *
 * Pure, dependency-free, no React — the <Trajectories> component consumes the
 * already-shaped panels. Panels are downsampled to keep the DOM bounded for
 * large libraries (~5,000 cells).
 */
import type { CellSummary, MetricDef } from './metrics';
import { type CondRow, computeCondStats, condLabel, groupConditions } from './conditions';
import { metricScore } from './metrics';

export type TrajYMode = 'absolute' | 'ce';

/** Max plotted points per line — caps SVG path complexity for large series. */
export const MAX_TRAJ_POINTS = 80;

export interface TrajPoint {
  cycle: number;
  /** Y value in the active mode: raw capacity, or % of the cell's own peak. */
  value: number;
}

export interface TrajLine {
  cellId: string;
  cellName: string;
  idNo: number;
  points: TrajPoint[];
}

export interface TrajPanel {
  cond: CondRow;
  label: string;
  replicateCount: number;
  /** One faint line per replicate cell that has ≥2 usable points. */
  lines: TrajLine[];
  /** Bold cohort-mean trajectory across the shared cycle grid; empty if none. */
  meanLine: TrajPoint[];
  /** Axis extents across this panel's lines + mean, for SVG scaling. */
  xMin: number;
  xMax: number;
  yMin: number;
  yMax: number;
  /** Cohort mean of the active sort metric; null when no cell has a value. */
  sortValue: number | null;
}

export interface TrajData {
  panels: TrajPanel[];
  yMode: TrajYMode;
  /** Capacity basis shared across the (already-filtered) cells, for the Y label. */
  basis: CellSummary['capacityBasis'];
  yUnit: string;
}

/**
 * Largest-Triangle-Three-Buckets-style uniform downsample by index. Keeps the
 * first and last point and evenly samples between them — cheap, deterministic,
 * and enough to preserve the visual shape of a capacity-fade curve.
 */
function downsample(points: TrajPoint[], max: number): TrajPoint[] {
  if (points.length <= max) return points;
  const out: TrajPoint[] = [points[0]];
  const step = (points.length - 1) / (max - 1);
  for (let i = 1; i < max - 1; i++) {
    out.push(points[Math.round(i * step)]);
  }
  out.push(points[points.length - 1]);
  return out;
}

function buildLines(cond: CondRow, yMode: TrajYMode): TrajLine[] {
  const lines: TrajLine[] = [];
  for (const cell of cond.cells) {
    // 'ce' plots the per-cycle Coulombic efficiency (already in %); 'absolute'
    // plots discharge capacity. (Retention was removed — own-peak normalisation
    // isn't rigorous; capacity retention stays a protocol-gated scalar.)
    const series = yMode === 'ce' ? cell.ceSeries : cell.capacitySeries;
    if (series.length < 2) continue;
    const pts: TrajPoint[] = series.map((d) => ({ cycle: d.cycle, value: d.value }));
    lines.push({
      cellId: cell.cellId,
      cellName: cell.cellName,
      idNo: cell.idNo,
      points: downsample(pts, MAX_TRAJ_POINTS),
    });
  }
  return lines;
}

/**
 * Cohort-mean trajectory across the union of cycle indices. At each cycle we
 * average the value of every replicate that has a point there, so the mean line
 * stays defined even when replicates have uneven cycle counts.
 */
function buildMeanLine(lines: TrajLine[]): TrajPoint[] {
  if (!lines.length) return [];
  const acc = new Map<number, { sum: number; n: number }>();
  for (const line of lines) {
    for (const p of line.points) {
      const a = acc.get(p.cycle) ?? { sum: 0, n: 0 };
      a.sum += p.value;
      a.n += 1;
      acc.set(p.cycle, a);
    }
  }
  const mean = Array.from(acc.entries())
    .map(([cycle, a]) => ({ cycle, value: a.sum / a.n }))
    .sort((x, y) => x.cycle - y.cycle);
  return downsample(mean, MAX_TRAJ_POINTS);
}

/**
 * Shape filtered cells into sorted trajectory panels. Panels are ordered by the
 * active metric's cohort mean (best first via metricScore) so the strongest
 * condition leads; ties and no-data cohorts sink to the end.
 */
export function buildTrajData(
  cells: CellSummary[],
  metric: MetricDef,
  yMode: TrajYMode,
): TrajData {
  const conditions = groupConditions(cells);
  const stats = computeCondStats(conditions, metric);

  const basis: CellSummary['capacityBasis'] = cells[0]?.capacityBasis ?? 'mAh';
  const yUnit = yMode === 'ce' ? '%' : basis;

  const panels: TrajPanel[] = conditions.map((cond) => {
    const lines = buildLines(cond, yMode);
    const meanLine = buildMeanLine(lines);

    let xMin = Infinity;
    let xMax = -Infinity;
    let yMin = Infinity;
    let yMax = -Infinity;
    const visit = (pts: TrajPoint[]) => {
      for (const p of pts) {
        if (p.cycle < xMin) xMin = p.cycle;
        if (p.cycle > xMax) xMax = p.cycle;
        if (p.value < yMin) yMin = p.value;
        if (p.value > yMax) yMax = p.value;
      }
    };
    for (const l of lines) visit(l.points);
    visit(meanLine);
    if (!Number.isFinite(xMin)) {
      xMin = 0;
      xMax = 1;
      yMin = 0;
      yMax = 1;
    }

    return {
      cond,
      label: condLabel(cond),
      replicateCount: cond.cells.length,
      lines,
      meanLine,
      xMin,
      xMax,
      yMin,
      yMax,
      sortValue: stats.get(cond.key)?.mean ?? null,
    };
  });

  panels.sort((a, b) => {
    if (a.sortValue == null && b.sortValue == null) return 0;
    if (a.sortValue == null) return 1;
    if (b.sortValue == null) return -1;
    return metricScore(metric, b.sortValue) - metricScore(metric, a.sortValue);
  });

  return { panels, yMode, basis, yUnit };
}
