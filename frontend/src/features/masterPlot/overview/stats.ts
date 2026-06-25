/**
 * Small, dependency-free statistics helpers for cohort summaries.
 * Pure functions, unit-testable, no React.
 */

/** Two-sided t critical values at 95% confidence, indexed by degrees of freedom. */
const T95: Record<number, number> = {
  1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
  8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145,
  15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.08,
  22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056, 27: 2.052, 28: 2.048,
  29: 2.045, 30: 2.042,
};

/** t critical (two-sided, 95%) for df = n − 1; large-df → normal z = 1.96. */
export function tCritical95(df: number): number {
  if (df <= 0) return Number.POSITIVE_INFINITY;
  if (df <= 30) return T95[df];
  if (df <= 60) return 2.0;
  return 1.96;
}

/** Sample standard deviation (n − 1 denominator). null for n < 2. */
export function sampleSd(values: number[]): number | null {
  const n = values.length;
  if (n < 2) return null;
  const mean = values.reduce((a, b) => a + b, 0) / n;
  const ss = values.reduce((s, v) => s + (v - mean) ** 2, 0);
  return Math.sqrt(ss / (n - 1));
}

export interface MeanCI {
  mean: number;
  /** Standard error of the mean; null for n < 2. */
  sem: number | null;
  /** 95% CI bounds and half-width; null for n < 2. */
  low: number | null;
  high: number | null;
  half: number | null;
  n: number;
}

/**
 * 95% confidence interval on the mean (t-based). For n = 2 the interval is
 * very wide and should be treated as indicative only; for n = 1 there is no
 * interval. Callers should surface n alongside the CI.
 */
export function meanCI(values: number[]): MeanCI {
  const n = values.length;
  const mean = n ? values.reduce((a, b) => a + b, 0) / n : NaN;
  if (n < 2) return { mean, sem: null, low: null, high: null, half: null, n };
  const sd = sampleSd(values)!;
  const sem = sd / Math.sqrt(n);
  const half = tCritical95(n - 1) * sem;
  return { mean, sem, low: mean - half, high: mean + half, half, n };
}

export function median(sorted: number[]): number {
  const n = sorted.length;
  if (!n) return NaN;
  const mid = Math.floor(n / 2);
  return n % 2 ? sorted[mid] : (sorted[mid - 1] + sorted[mid]) / 2;
}

/** Median absolute deviation (robust dispersion). */
export function mad(values: number[]): number {
  if (values.length < 2) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  const devs = values.map((v) => Math.abs(v - med)).sort((a, b) => a - b);
  return median(devs);
}

/**
 * Iglewicz–Hoaglin modified Z-scores: 0.6745·(x − median) / MAD.
 * Robust to the outliers themselves (unlike mean/SD). Returns 0 for every
 * point when MAD = 0 (degenerate cohort) so nothing is spuriously flagged.
 */
export function modifiedZScores(values: number[]): number[] {
  const m = mad(values);
  if (m === 0) return values.map(() => 0);
  const sorted = [...values].sort((a, b) => a - b);
  const med = median(sorted);
  return values.map((v) => (0.6745 * (v - med)) / m);
}

/** Conventional modified-Z outlier threshold. */
export const OUTLIER_Z = 3.5;

/** Do two 95% CIs overlap? Used to qualify "best" / significance claims. */
export function ciOverlap(a: MeanCI, b: MeanCI): boolean {
  if (a.low == null || a.high == null || b.low == null || b.high == null) return true;
  return a.low <= b.high && b.low <= a.high;
}

/** Ordinary least-squares slope of y vs x. null for <2 points or zero x-variance. */
export function linregSlope(points: { x: number; y: number }[]): number | null {
  const n = points.length;
  if (n < 2) return null;
  let sx = 0;
  let sy = 0;
  for (const p of points) {
    sx += p.x;
    sy += p.y;
  }
  const mx = sx / n;
  const my = sy / n;
  let num = 0;
  let den = 0;
  for (const p of points) {
    const dx = p.x - mx;
    num += dx * (p.y - my);
    den += dx * dx;
  }
  if (den === 0) return null;
  return num / den;
}

export function clamp01(v: number): number {
  return Math.min(1, Math.max(0, v));
}

/* ------------------------------------------------------------------ */
/* Significance testing (Welch's t + Student-t p-value + BH FDR)       */
/* ------------------------------------------------------------------ */

/** ln Γ(x) — Lanczos approximation, accurate enough for p-values. */
function logGamma(x: number): number {
  const g = 7;
  const c = [
    0.99999999999980993, 676.5203681218851, -1259.1392167224028,
    771.32342877765313, -176.61502916214059, 12.507343278686905,
    -0.13857109526572012, 9.9843695780195716e-6, 1.5056327351493116e-7,
  ];
  if (x < 0.5) return Math.log(Math.PI / Math.sin(Math.PI * x)) - logGamma(1 - x);
  x -= 1;
  let a = c[0];
  const t = x + g + 0.5;
  for (let i = 1; i < g + 2; i++) a += c[i] / (x + i);
  return 0.5 * Math.log(2 * Math.PI) + (x + 0.5) * Math.log(t) - t + Math.log(a);
}

/** Continued fraction for the incomplete beta function (Numerical Recipes betacf). */
function betacf(a: number, b: number, x: number): number {
  const FPMIN = 1e-300;
  const qab = a + b;
  const qap = a + 1;
  const qam = a - 1;
  let c = 1;
  let d = 1 - (qab * x) / qap;
  if (Math.abs(d) < FPMIN) d = FPMIN;
  d = 1 / d;
  let h = d;
  for (let m = 1; m <= 200; m++) {
    const m2 = 2 * m;
    let aa = (m * (b - m) * x) / ((qam + m2) * (a + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    h *= d * c;
    aa = (-(a + m) * (qab + m) * x) / ((a + m2) * (qap + m2));
    d = 1 + aa * d;
    if (Math.abs(d) < FPMIN) d = FPMIN;
    c = 1 + aa / c;
    if (Math.abs(c) < FPMIN) c = FPMIN;
    d = 1 / d;
    const del = d * c;
    h *= del;
    if (Math.abs(del - 1) < 3e-12) break;
  }
  return h;
}

/** Regularized incomplete beta I_x(a,b). */
function betai(a: number, b: number, x: number): number {
  if (x <= 0) return 0;
  if (x >= 1) return 1;
  const bt = Math.exp(
    logGamma(a + b) - logGamma(a) - logGamma(b) + a * Math.log(x) + b * Math.log(1 - x),
  );
  if (x < (a + 1) / (a + b + 2)) return (bt * betacf(a, b, x)) / a;
  return 1 - (bt * betacf(b, a, 1 - x)) / b;
}

/** Two-sided p-value for a Student-t statistic with df degrees of freedom. */
export function studentTwoSidedP(t: number, df: number): number {
  if (!Number.isFinite(t) || df <= 0) return 1;
  const x = df / (df + t * t);
  return clamp01(betai(df / 2, 0.5, x));
}

export interface WelchResult {
  /** Two-sided p-value (null when either group has n<2). */
  p: number | null;
  t: number | null;
  df: number | null;
}

/** Welch's unequal-variance two-sample t-test. */
export function welchT(a: number[], b: number[]): WelchResult {
  if (a.length < 2 || b.length < 2) return { p: null, t: null, df: null };
  const ma = a.reduce((s, v) => s + v, 0) / a.length;
  const mb = b.reduce((s, v) => s + v, 0) / b.length;
  const va = a.reduce((s, v) => s + (v - ma) ** 2, 0) / (a.length - 1);
  const vb = b.reduce((s, v) => s + (v - mb) ** 2, 0) / (b.length - 1);
  const sa = va / a.length;
  const sb = vb / b.length;
  const denom = sa + sb;
  if (denom === 0) return { p: ma === mb ? 1 : 0, t: ma === mb ? 0 : Infinity, df: a.length + b.length - 2 };
  const t = (ma - mb) / Math.sqrt(denom);
  const df = denom ** 2 / (sa ** 2 / (a.length - 1) + sb ** 2 / (b.length - 1));
  return { p: studentTwoSidedP(t, df), t, df };
}

/**
 * Benjamini–Hochberg FDR adjustment. Returns adjusted p-values in the input
 * order; nulls (untestable pairs) pass through as null.
 */
export function benjaminiHochberg(pvalues: (number | null)[]): (number | null)[] {
  const idx = pvalues
    .map((p, i) => ({ p, i }))
    .filter((e): e is { p: number; i: number } => e.p != null);
  const m = idx.length;
  if (m === 0) return pvalues.map(() => null);
  idx.sort((x, y) => x.p - y.p);
  const adj = new Array<number>(m);
  let prev = 1;
  for (let k = m - 1; k >= 0; k--) {
    const raw = (idx[k].p * m) / (k + 1);
    prev = Math.min(prev, raw);
    adj[k] = clamp01(prev);
  }
  const out: (number | null)[] = pvalues.map(() => null);
  idx.forEach((e, rank) => {
    out[e.i] = adj[rank];
  });
  return out;
}
