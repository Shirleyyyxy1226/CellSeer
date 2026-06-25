/**
 * Condition (cathode × separator × spacer) grouping and cohort statistics.
 * A "condition" is the experiment-design unit: its cells are replicates, so
 * cohort mean / SD / CV all live here.
 */
import type { CellSummary, MetricDef } from './metrics';
import { meanCI } from './stats';

export type CondRow = {
  key: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  cells: CellSummary[];
};

export interface CondStat {
  mean: number | null;
  /** Population SD across replicates (spread of the cells you have). */
  sd: number | null;
  /** Coefficient of variation across replicates, % — null when <2 values. */
  cv: number | null;
  /** Standard error of the mean (uncertainty of the mean, not spread). */
  sem: number | null;
  /** 95% CI half-width on the mean; null for n < 2. */
  ciHalf: number | null;
  n: number;
}

/** Shared empty stat for cohorts with no usable values for a metric. */
export const EMPTY_COND_STAT: CondStat = {
  mean: null, sd: null, cv: null, sem: null, ciHalf: null, n: 0,
};

export type HeatmapSort = 'condition' | 'best' | 'variable';

/** Replicate scatter above this CV% is worth a lab manager's attention. */
export const HIGH_CV_PCT = 15;

/** Cohorts with fewer than this many replicates can't support a real CI — flag them. */
export const LOW_N = 3;

/** Most conditions a user can pin for side-by-side comparison. */
export const MAX_PINS = 4;

/** Condition key for a cell — must match the key groupConditions builds. */
export function cellConditionKey(c: CellSummary): string {
  return `${c.cathode}|${c.separatorType}|${c.spacerMm ?? '—'}`;
}

/** Group cells into condition rows, sorted cathode → separator → spacer. */
export function groupConditions(cells: CellSummary[]): CondRow[] {
  const map = new Map<string, CellSummary[]>();
  for (const c of cells) {
    const key = cellConditionKey(c);
    const arr = map.get(key) ?? [];
    arr.push(c);
    map.set(key, arr);
  }
  return Array.from(map.entries())
    .map(([key, group]) => ({
      key,
      cathode: group[0].cathode,
      separatorType: group[0].separatorType,
      spacerMm: group[0].spacerMm,
      cells: group.sort((a, b) => a.idNo - b.idNo),
    }))
    .sort(
      (a, b) =>
        a.cathode.localeCompare(b.cathode) ||
        a.separatorType.localeCompare(b.separatorType) ||
        (a.spacerMm ?? 0) - (b.spacerMm ?? 0),
    );
}

export function computeCondStats(conditions: CondRow[], metric: MetricDef): Map<string, CondStat> {
  const m = new Map<string, CondStat>();
  for (const cond of conditions) {
    const vals = cond.cells
      .map((c) => metric.value(c))
      .filter((v): v is number => v != null && Number.isFinite(v));
    if (!vals.length) {
      m.set(cond.key, EMPTY_COND_STAT);
      continue;
    }
    const mean = vals.reduce((a, b) => a + b, 0) / vals.length;
    // Population SD describes the spread of the observed replicates (the ±1 SD
    // whisker); the CI/SEM (from meanCI, which uses the sample SD) describes
    // uncertainty of the mean. These are deliberately different quantities.
    const sd = Math.sqrt(vals.reduce((s, v) => s + (v - mean) ** 2, 0) / vals.length);
    const hasSpread = vals.length >= 2;
    // CV (spread ÷ |mean|) is only meaningful when the mean is larger than the
    // spread. For near-zero-mean metrics (e.g. CE drift) it blows up into
    // meaningless hundreds, so we null it rather than show / flag a bogus value.
    const cv = hasSpread && Math.abs(mean) > sd ? (sd / Math.abs(mean)) * 100 : null;
    const ci = meanCI(vals);
    m.set(cond.key, {
      mean,
      sd: hasSpread ? sd : null,
      cv,
      sem: ci.sem,
      ciHalf: ci.half,
      n: vals.length,
    });
  }
  return m;
}

export function condLabel(cond: CondRow): string {
  return `${cond.cathode} · ${cond.separatorType} · ${cond.spacerMm ?? '—'} mm`;
}

/**
 * Format a non-negative magnitude (e.g. a CI half-width) without the metric's
 * sign prefix — signed metrics like CE drift add a leading `+` for the mean,
 * which would otherwise double up next to a hardcoded `±` (the old `±+10`).
 */
export function formatMagnitude(metric: MetricDef, v: number): string {
  return metric.format(Math.abs(v)).replace(/^\+/, '');
}

/** Deterministic vertical jitter so replicate dots with near-equal values stay individually clickable. */
export function dotJitter(idNo: number): number {
  let h = idNo * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

// Pairwise significance (Welch's t + Benjamini–Hochberg) was removed along with
// the "Compare pinned" panel. welchT / benjaminiHochberg remain in stats.ts.
