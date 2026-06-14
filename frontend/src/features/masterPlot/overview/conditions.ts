/**
 * Condition (cathode × separator × spacer) grouping and cohort statistics.
 * A "condition" is the experiment-design unit: its cells are replicates, so
 * cohort mean / SD / CV and replicate-relative flags all live here.
 */
import type { CellFlag, CellSummary, MetricDef } from './metrics';
import { benjaminiHochberg, meanCI, modifiedZScores, OUTLIER_Z, welchT } from './stats';

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

/** Most conditions a user can pin for side-by-side comparison (03 · FR-6). */
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
    const cv = hasSpread && mean !== 0 ? (sd / Math.abs(mean)) * 100 : null;
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

/** Deterministic vertical jitter so replicate dots with near-equal values stay individually clickable. */
export function dotJitter(idNo: number): number {
  let h = idNo * 2654435761;
  h ^= h >>> 15;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

/** Flags computed against each cell's replicate cohort (not project-wide). */
export function computeFlaggedCells(conditions: CondRow[]): Map<string, CellFlag[]> {
  const flagMap = new Map<string, CellFlag[]>();
  for (const cond of conditions) {
    // Robust within-cohort outlier detection (Iglewicz–Hoaglin modified
    // Z-score on the median/MAD). Unlike the old "lowest decile" rule — which
    // flagged ~10% of every large cohort by construction and nothing in small
    // ones — this fires only on genuine outliers and needs ≥4 replicates.
    const capCells = cond.cells.filter((c) => c.peakCapacityRaw != null);
    const caps = capCells.map((c) => c.peakCapacityRaw as number);
    const capZ = caps.length >= 4 ? modifiedZScores(caps) : null;
    const capOutlierIds = new Map<string, number>();
    if (capZ) {
      capCells.forEach((c, i) => {
        if (Math.abs(capZ[i]) > OUTLIER_Z) capOutlierIds.set(c.cellId, capZ[i]);
      });
    }
    for (const c of cond.cells) {
      const flags: CellFlag[] = [];
      const z = capOutlierIds.get(c.cellId);
      if (z != null && c.peakCapacityRaw != null) {
        const dir = z < 0 ? 'below' : 'above';
        flags.push({
          id: 'cap-outlier',
          title: 'Raw-capacity outlier',
          body: `Peak capacity (${c.peakCapacityRaw.toFixed(2)} mAh) is a robust outlier (modified Z ${z.toFixed(1)}, ${dir} the cohort) within its ${cond.cells.length}-replicate cohort.`,
          needsProtocol: false,
        });
      }
      if (c.medianCE != null && (c.medianCE < 98 || c.medianCE > 102)) {
        flags.push({
          id: 'ce-anomaly',
          title: 'CE anomaly',
          body: `Median coulombic efficiency ${c.medianCE.toFixed(2)}% is outside the 98–102% band.`,
          needsProtocol: false,
        });
      }
      if (c.cycleCount > 0 && c.cycleCount < 5) {
        flags.push({
          id: 'few-cycles',
          title: 'Very few usable cycles',
          body: `Only ${c.cycleCount} cycles with non-zero capacity — the test may have failed early.`,
          needsProtocol: false,
        });
      }
      if (flags.length) flagMap.set(c.cellId, flags);
    }
  }
  return flagMap;
}

export interface PairwiseVerdict {
  aKey: string;
  bKey: string;
  /** BH-adjusted p-value; null when either cohort has n<2 for the metric. */
  p: number | null;
  /** Significant at the 5% FDR level (p_adj < 0.05). */
  significant: boolean;
}

/**
 * Pairwise Welch's t-tests across a set of conditions on the active metric,
 * with Benjamini–Hochberg FDR correction over the whole comparison family
 * (03 · FR-5 / 01). Answers "are these conditions actually distinguishable?".
 */
export function pairwiseSignificance(
  conditions: CondRow[],
  metric: MetricDef,
): PairwiseVerdict[] {
  const vals = conditions.map((c) =>
    c.cells.map((cell) => metric.value(cell)).filter((v): v is number => v != null && Number.isFinite(v)),
  );
  const pairs: { aKey: string; bKey: string; p: number | null }[] = [];
  for (let i = 0; i < conditions.length; i++) {
    for (let j = i + 1; j < conditions.length; j++) {
      pairs.push({ aKey: conditions[i].key, bKey: conditions[j].key, p: welchT(vals[i], vals[j]).p });
    }
  }
  const adj = benjaminiHochberg(pairs.map((pr) => pr.p));
  return pairs.map((pr, k) => ({
    aKey: pr.aKey,
    bKey: pr.bKey,
    p: adj[k],
    significant: adj[k] != null && (adj[k] as number) < 0.05,
  }));
}
