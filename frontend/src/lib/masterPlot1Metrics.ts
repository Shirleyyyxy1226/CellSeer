/**
 * Master Plot 1 — metric extraction and stats (browser-side).
 * Data sources: rate-performance.json shape + cell-record-index fields.
 */

export type { ProtocolSegment, RatePerfCellRaw, IndexCellRaw } from '@/lib/cellTypes';

/** Longest protocol segment by cycle span — used as "main cycling" window per cell. */
export function mainCyclingSegment(segments: ProtocolSegment[] | undefined): ProtocolSegment | null {
  if (!segments?.length) return null;
  let best = segments[0];
  let bestLen = -1;
  for (const s of segments) {
    const len = s.cycleEnd - s.cycleStart + 1;
    if (len > bestLen) {
      bestLen = len;
      best = s;
    }
  }
  return best;
}

function meanSeriesInMainCyclingPhase(
  cycles: number[],
  protocolSegments: ProtocolSegment[],
  series: number[],
): number | null {
  const seg = mainCyclingSegment(protocolSegments);
  const nSteps = Math.min(cycles.length, series.length);
  let sum = 0;
  let n = 0;
  for (let i = 0; i < nSteps; i++) {
    const cy = cycles[i];
    if (seg && (cy < seg.cycleStart || cy > seg.cycleEnd)) continue;
    const v = series[i];
    if (!Number.isFinite(v)) continue;
    sum += v;
    n++;
  }
  return n > 0 ? sum / n : null;
}

export type DimKey =
  | 'retention'
  | 'capacity'
  | 'fade_rate'
  | 'cathode_mass'
  | 'ce'
  | 'ice'
  | 'retention_cycle'
  | 'capacity_cycle'
  | 'ce_cycle'
  | 'dqdv_shift'
  | 'cathode'
  | 'separator'
  | 'spacer'
  | 'protocol'
  | 'c_rate_group'
  | 'electrolyte';

export const DIMENSION_CATALOG: {
  key: DimKey;
  label: string;
  kind: 'scalar' | 'per_cycle' | 'categorical';
  /** Extra UI hint */
  hint?: string;
  stub?: boolean;
}[] = [
  { key: 'retention', label: 'Retention', kind: 'scalar' },
  { key: 'capacity', label: 'Capacity', kind: 'scalar' },
  { key: 'fade_rate', label: 'Fade rate', kind: 'scalar' },
  { key: 'cathode_mass', label: 'Cathode mass', kind: 'scalar' },
  {
    key: 'ce',
    label: 'CE (proxy)',
    kind: 'scalar',
    hint: 'Discharge-only proxy when charge not in JSON; true CE if chargeCapacityMah is exported.',
  },
  {
    key: 'ice',
    label: 'ICE (proxy)',
    kind: 'scalar',
    hint: 'Early-cycle specific-capacity drop vs first point (~formation loss).',
  },
  { key: 'retention_cycle', label: 'Retention (cycle)', kind: 'per_cycle' },
  { key: 'capacity_cycle', label: 'Capacity (cycle)', kind: 'per_cycle' },
  {
    key: 'ce_cycle',
    label: 'CE (cycle)',
    kind: 'per_cycle',
    hint: 'Per-step CE proxy (same C-rate steps) or true CE if charge present.',
  },
  {
    key: 'dqdv_shift',
    label: 'dQ/dV shift',
    kind: 'per_cycle',
    hint: 'ΔV of dominant |dQ/dV| peak vs reference; loads /api/cell-record/{id}/differential.',
  },
  { key: 'cathode', label: 'Cathode', kind: 'categorical' },
  { key: 'separator', label: 'Separator', kind: 'categorical' },
  { key: 'spacer', label: 'Spacer', kind: 'categorical' },
  { key: 'electrolyte', label: 'Electrolyte', kind: 'categorical' },
  { key: 'protocol', label: 'Protocol', kind: 'categorical' },
  { key: 'c_rate_group', label: 'C-rate group', kind: 'categorical' },
];

export interface CellMetricRow {
  idNo: number;
  cellId: string;
  cellName: string;
  protocol: string;
  protocolSegments: ProtocolSegment[];
  cycles: number[];
  cRates: number[];
  specificMahG: number[];
  dischargeMah: number[];
  retentionScalar: number;
  capacityScalar: number;
  fadeRate: number;
  cathodeMassG: number | null;
  retentionSeries: number[];
  ceSeries: number[];
  ceScalar: number;
  iceScalar: number;
  /** Filled async in UI when user selects dQ/dV shift */
  dqdvShiftSeries?: number[];
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  spacerLabel: string;
  electrolyte: string;
  cRateGroup: string;
  confTierRetention: 1 | 2 | 3;
  confTierCE: 1 | 2 | 3;
  /** Mean retention % over steps in this cell's main cycling segment (cross-protocol comparable). */
  retentionMeanMain: number;
  /** Mean CE % over the same main-segment steps. */
  ceMeanMain: number;
}

function baselineMeanFirstSegment(cell: RatePerfCellRaw): number {
  const spec = cell.specificCapacityMahG;
  if (!spec?.length) return 1;
  const seg = cell.protocolSegments?.[0];
  if (seg && cell.cycles?.length) {
    let sum = 0;
    let n = 0;
    for (let i = 0; i < cell.cycles.length; i++) {
      const cy = cell.cycles[i];
      if (cy >= seg.cycleStart && cy <= seg.cycleEnd && spec[i] != null) {
        sum += spec[i]!;
        n++;
      }
    }
    if (n > 0) return sum / n;
  }
  return spec[0]! > 0 ? spec[0]! : 1;
}

function retentionSeries(cell: RatePerfCellRaw): number[] {
  const spec = cell.specificCapacityMahG;
  if (!spec?.length) return [];
  const base = baselineMeanFirstSegment(cell);
  return spec.map((v) => (base > 0 ? (100 * v) / base : 0));
}

/** Slope of retention % vs step index (negative = fading). */
function fadeRateFromSeries(series: number[]): number {
  if (series.length < 3) return 0;
  const n = series.length;
  let sx = 0;
  let sy = 0;
  let sxx = 0;
  let sxy = 0;
  for (let i = 0; i < n; i++) {
    sx += i;
    sy += series[i];
    sxx += i * i;
    sxy += i * series[i];
  }
  const denom = n * sxx - sx * sx;
  if (Math.abs(denom) < 1e-9) return 0;
  return (n * sxy - sx * sy) / denom;
}

function dominantCRateGroup(cell: RatePerfCellRaw): string {
  const rates = cell.cRates?.filter((r) => r > 0) ?? [];
  if (!rates.length) return '—';
  const max = Math.max(...rates);
  return `${max}C`;
}

/** True CE per cycle if chargeCapacityMah aligns; else null. */
function ceSeriesFromCharge(cell: RatePerfCellRaw): number[] | null {
  const ch = cell.chargeCapacityMah;
  const dch = cell.dischargeCapacityMah;
  if (!ch?.length || !dch?.length || ch.length !== dch.length) return null;
  return dch.map((d, i) => {
    const c = ch[i] ?? 0;
    if (c <= 1e-9) return NaN;
    return Math.min(102, (d / c) * 100);
  });
}

/**
 * CE proxy from consecutive discharge capacities when C-rate is unchanged (no charge data).
 */
function ceSeriesDischargeProxy(cell: RatePerfCellRaw): number[] {
  const d = cell.dischargeCapacityMah ?? [];
  const cr = cell.cRates ?? [];
  const n = d.length;
  if (n === 0) return [];
  const out: number[] = new Array(n).fill(NaN);
  out[0] = 100;
  for (let i = 1; i < n; i++) {
    if (d[i - 1] <= 1e-9) continue;
    const r0 = cr[i - 1] ?? 0;
    const r1 = cr[i] ?? 0;
    if (Math.abs(r1 - r0) > 0.051) {
      out[i] = out[i - 1];
      continue;
    }
    let ratio = (d[i] / d[i - 1]) * 100;
    if (ratio > 100.5) ratio = 100.5;
    if (ratio < 75) ratio = NaN;
    out[i] = ratio;
  }
  let last = 100;
  for (let i = 0; i < n; i++) {
    if (!Number.isNaN(out[i])) last = out[i]!;
    else out[i] = last;
  }
  return out;
}

function meanLastProtocolSegmentCe(ce: number[], cell: RatePerfCellRaw): number {
  const segs = cell.protocolSegments;
  const cyc = cell.cycles;
  if (!segs?.length || !cyc.length) {
    const tail = ce.slice(Math.max(0, ce.length - 5));
    const v = tail.filter((x) => Number.isFinite(x));
    if (!v.length) return 99;
    return v.reduce((a, b) => a + b, 0) / v.length;
  }
  const last = segs[segs.length - 1];
  let sum = 0;
  let n = 0;
  for (let i = 0; i < cyc.length; i++) {
    if (cyc[i] >= last.cycleStart && cyc[i] <= last.cycleEnd && Number.isFinite(ce[i])) {
      sum += ce[i];
      n++;
    }
  }
  if (n > 0) return sum / n;
  const v = ce.filter((x) => Number.isFinite(x));
  return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 99;
}

function iceProxyFromSpec(spec: number[]): number {
  if (spec.length < 2) return 0;
  const a = spec[0] ?? 0;
  const b = spec[1] ?? 0;
  if (a <= 1e-9) return 0;
  return Math.max(0, Math.min(100, (100 * (a - b)) / a));
}

function retentionConfidenceTier(cell: RatePerfCellRaw, retSeries: number[]): 1 | 2 | 3 {
  const n = retSeries.length;
  if (n < 5) return 3;
  const hasSeg = (cell.protocolSegments?.length ?? 0) >= 2;
  if (n >= 15 && hasSeg) {
    const tail = retSeries.slice(Math.max(0, n - 8));
    const m = tail.reduce((a, b) => a + b, 0) / tail.length;
    const v = Math.sqrt(tail.reduce((s, x) => s + (x - m) ** 2, 0) / tail.length);
    if (v < 2.5) return 1;
  }
  if (n >= 8 && hasSeg) return 2;
  return 3;
}

function ceConfidenceTier(ceSeries: number[], hasTrueCe: boolean): 1 | 2 | 3 {
  const v = ceSeries.filter((x) => Number.isFinite(x) && x > 0);
  if (v.length < 4) return 3;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  const sd = Math.sqrt(v.reduce((s, x) => s + (x - m) ** 2, 0) / v.length);
  if (hasTrueCe && sd < 0.35 && m > 98) return 1;
  if (hasTrueCe && sd < 0.6) return 2;
  if (!hasTrueCe && sd < 0.8 && m > 97) return 2;
  return 3;
}

export function buildMetricRows(
  rateCells: RatePerfCellRaw[],
  indexByIdNo: Map<number, IndexCellRaw>,
): CellMetricRow[] {
  return rateCells
    .filter((c) => c.specificCapacityMahG && c.specificCapacityMahG.length > 0)
    .map((c) => {
      const idx = indexByIdNo.get(c.idNo);
      const spec = c.specificCapacityMahG!;
      const retSeries = retentionSeries(c);
      const lastSpec = spec[spec.length - 1] ?? 0;
      const dch = c.dischargeCapacityMah ?? [];
      const trueCe = ceSeriesFromCharge(c);
      const ceSeries = trueCe ?? ceSeriesDischargeProxy(c);
      const ceScalar = meanLastProtocolSegmentCe(ceSeries, c);
      const iceScalar = iceProxyFromSpec(spec);
      const segs = c.protocolSegments ?? [];
      const retentionMeanMain =
        meanSeriesInMainCyclingPhase(c.cycles, segs, retSeries) ??
        (retSeries.length ? retSeries[retSeries.length - 1]! : 100);
      const ceMeanMain = meanSeriesInMainCyclingPhase(c.cycles, segs, ceSeries) ?? ceScalar;
      return {
        idNo: c.idNo,
        cellId: c.cellId,
        cellName: c.cellName,
        protocol: c.protocol?.trim() || '(no protocol)',
        protocolSegments: c.protocolSegments ?? [],
        cycles: c.cycles,
        cRates: c.cRates ?? [],
        specificMahG: spec,
        dischargeMah: dch,
        retentionScalar: retSeries[retSeries.length - 1] ?? 100,
        capacityScalar: lastSpec,
        fadeRate: fadeRateFromSeries(retSeries),
        cathodeMassG: idx?.cathodeMassG ?? null,
        retentionSeries: retSeries,
        ceSeries,
        ceScalar,
        iceScalar,
        cathode: c.cathode || idx?.cathode || '',
        separatorType: c.separatorType || idx?.separatorType || '',
        spacerMm: c.spacerMm ?? idx?.spacerMm ?? null,
        spacerLabel: String(c.spacerMm ?? idx?.spacerMm ?? '—'),
        electrolyte: (idx?.electrolyte ?? '').trim() || '—',
        cRateGroup: dominantCRateGroup(c),
        confTierRetention: retentionConfidenceTier(c, retSeries),
        confTierCE: ceConfidenceTier(ceSeries, trueCe != null),
        retentionMeanMain,
        ceMeanMain,
      };
    })
    .sort((a, b) => a.idNo - b.idNo);
}

export function getNumericValue(row: CellMetricRow, key: DimKey, cycleIndex: number): number | null {
  switch (key) {
    case 'retention':
      return row.retentionScalar;
    case 'capacity':
      return row.capacityScalar;
    case 'fade_rate':
      return row.fadeRate;
    case 'cathode_mass':
      return row.cathodeMassG;
    case 'ce':
      return row.ceScalar;
    case 'ice':
      return row.iceScalar;
    case 'retention_cycle': {
      const s = row.retentionSeries;
      const i = Math.min(Math.max(0, cycleIndex), s.length - 1);
      return s.length ? s[i] : null;
    }
    case 'capacity_cycle': {
      const s = row.specificMahG;
      const i = Math.min(Math.max(0, cycleIndex), s.length - 1);
      return s.length ? s[i] : null;
    }
    case 'ce_cycle': {
      const s = row.ceSeries;
      const i = Math.min(Math.max(0, cycleIndex), s.length - 1);
      return s.length ? s[i] : null;
    }
    case 'dqdv_shift': {
      const s = row.dqdvShiftSeries;
      if (!s?.length) return null;
      const i = Math.min(Math.max(0, cycleIndex), s.length - 1);
      return s[i] ?? null;
    }
    default:
      return null;
  }
}

export function getCategoricalValue(row: CellMetricRow, key: DimKey): string {
  switch (key) {
    case 'cathode':
      return row.cathode || '—';
    case 'separator':
      return row.separatorType || '—';
    case 'spacer':
      return row.spacerLabel;
    case 'electrolyte':
      return row.electrolyte || '—';
    case 'protocol':
      return row.protocol;
    case 'c_rate_group':
      return row.cRateGroup;
    default:
      return '—';
  }
}

export function isCategoricalKey(key: DimKey): boolean {
  return ['cathode', 'separator', 'spacer', 'electrolyte', 'protocol', 'c_rate_group'].includes(key);
}

export function isPerCycleKey(key: DimKey): boolean {
  return key === 'retention_cycle' || key === 'capacity_cycle' || key === 'ce_cycle' || key === 'dqdv_shift';
}

/** One-way ANOVA η² for categorical groups vs numeric y. */
export function etaSquared(groups: Map<string, number[]>): number {
  const all: number[] = [];
  groups.forEach((arr) => arr.forEach((v) => all.push(v)));
  if (all.length < 3) return 0;
  const grandMean = all.reduce((a, b) => a + b, 0) / all.length;
  let ssTotal = 0;
  for (const v of all) ssTotal += (v - grandMean) ** 2;
  if (ssTotal < 1e-12) return 0;
  let ssBetween = 0;
  groups.forEach((arr, _g) => {
    if (arr.length === 0) return;
    const m = arr.reduce((a, b) => a + b, 0) / arr.length;
    ssBetween += arr.length * (m - grandMean) ** 2;
  });
  return Math.max(0, Math.min(1, ssBetween / ssTotal));
}

export function groupByCategory(rows: CellMetricRow[], catKey: DimKey, yKey: DimKey, cycleIndex: number): Map<string, number[]> {
  const m = new Map<string, number[]>();
  for (const row of rows) {
    const cat = getCategoricalValue(row, catKey);
    const y = getNumericValue(row, yKey, cycleIndex);
    if (y == null || Number.isNaN(y)) continue;
    if (!m.has(cat)) m.set(cat, []);
    m.get(cat)!.push(y);
  }
  return m;
}

/**
 * Okabe–Ito–style palette (colorblind-friendly, distinct on light & dark UI).
 * Order: orange, sky blue, bluish green, yellow, blue, vermillion, reddish purple, gray.
 */
const CAT_PALETTE = [
  '#E69F00',
  '#56B4E9',
  '#009E73',
  '#F0E442',
  '#0072B2',
  '#D55E00',
  '#CC79A7',
  '#999999',
  '#332288',
  '#88CCEE',
  '#44AA99',
  '#DDCC77',
];

export function colourForCategory(value: string, domain: string[]): string {
  const i = domain.indexOf(value);
  if (i < 0) return '#64748b';
  return CAT_PALETTE[i % CAT_PALETTE.length];
}

export function shapeForCategory(value: string, domain: string[]): 'circle' | 'rect' | 'triangle' {
  const i = domain.indexOf(value);
  const shapes: ('circle' | 'rect' | 'triangle')[] = ['circle', 'rect', 'triangle'];
  return shapes[i % 3];
}

/** Replace non-finite entries with the column mean (for clustering when some cells lack a metric). */
export function imputeColumnMeans(rows: number[][]): number[][] {
  const n = rows.length;
  if (n === 0) return [];
  const d = rows[0].length;
  if (d === 0) return rows.map(() => []);
  const sums = new Array(d).fill(0);
  const counts = new Array(d).fill(0);
  for (let i = 0; i < n; i++) {
    for (let j = 0; j < d; j++) {
      const v = rows[i][j];
      if (v != null && Number.isFinite(v)) {
        sums[j] += v;
        counts[j]++;
      }
    }
  }
  const means = sums.map((s, j) => (counts[j] > 0 ? s / counts[j] : 0));
  return rows.map((r) => r.map((v, j) => (v != null && Number.isFinite(v) ? v : means[j])));
}

function kmeansAssign(vectors: number[][], centers: number[][]): number[] {
  const labels = new Array(vectors.length).fill(0);
  for (let i = 0; i < vectors.length; i++) {
    let best = 0;
    let bestD = Infinity;
    for (let k = 0; k < centers.length; k++) {
      let d = 0;
      for (let j = 0; j < vectors[i].length; j++) {
        const t = vectors[i][j] - centers[k][j];
        d += t * t;
      }
      if (d < bestD) {
        bestD = d;
        best = k;
      }
    }
    labels[i] = best;
  }
  return labels;
}

export function kmeansFit(vectors: number[][], k: number, seed: number): number[] {
  const n = vectors.length;
  if (n === 0) return [];
  const d = vectors[0].length;
  if (n < k) return vectors.map((_, i) => i);
  const rng = (i: number) => {
    let h = seed + i * 374761393;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return (h >>> 0) / 4294967296;
  };
  const centers = Array.from({ length: k }, (_, kk) => {
    const idx = Math.min(n - 1, Math.floor(rng(kk) * n));
    return [...vectors[idx]];
  });
  let labels = kmeansAssign(vectors, centers);
  for (let it = 0; it < 25; it++) {
    const sums = Array.from({ length: k }, () => new Array(d).fill(0));
    const counts = new Array(k).fill(0);
    for (let i = 0; i < n; i++) {
      const lb = labels[i];
      counts[lb]++;
      for (let j = 0; j < d; j++) sums[lb][j] += vectors[i][j];
    }
    for (let kk = 0; kk < k; kk++) {
      if (counts[kk] === 0) continue;
      for (let j = 0; j < d; j++) centers[kk][j] = sums[kk][j] / counts[kk];
    }
    const next = kmeansAssign(vectors, centers);
    if (next.every((v, i) => v === labels[i])) break;
    labels = next;
  }
  return labels;
}

export function silhouetteScore(vectors: number[][], labels: number[]): number {
  const n = vectors.length;
  if (n < 3) return -1;
  const dist = (i: number, j: number) => {
    let s = 0;
    for (let d = 0; d < vectors[i].length; d++) s += (vectors[i][d] - vectors[j][d]) ** 2;
    return Math.sqrt(s);
  };
  const clusterIds = [...new Set(labels)];
  let total = 0;
  for (let i = 0; i < n; i++) {
    const li = labels[i];
    let aSum = 0;
    let aCnt = 0;
    for (let j = 0; j < n; j++) {
      if (i === j || labels[j] !== li) continue;
      aSum += dist(i, j);
      aCnt++;
    }
    const a = aCnt > 0 ? aSum / aCnt : 0;
    let bMin = Infinity;
    for (const oc of clusterIds) {
      if (oc === li) continue;
      let bSum = 0;
      let bCnt = 0;
      for (let j = 0; j < n; j++) {
        if (labels[j] !== oc) continue;
        bSum += dist(i, j);
        bCnt++;
      }
      if (bCnt > 0) bMin = Math.min(bMin, bSum / bCnt);
    }
    if (!isFinite(bMin)) bMin = 0;
    const s = Math.max(a, bMin) < 1e-9 ? 0 : (bMin - a) / Math.max(a, bMin);
    total += s;
  }
  return total / n;
}

export function kmeansBestK(
  vectors: number[][],
  kMin: number,
  kMax: number,
  seed: number,
): { k: number; labels: number[]; score: number } {
  const n = vectors.length;
  if (n < kMin + 1) {
    const labels = kmeansFit(vectors, Math.min(kMin, Math.max(2, n)), seed);
    return { k: Math.min(kMin, Math.max(2, n)), labels, score: silhouetteScore(vectors, labels) };
  }
  let best = { k: kMin, labels: kmeansFit(vectors, kMin, seed), score: -2 };
  best.score = silhouetteScore(vectors, best.labels);
  for (let k = kMin; k <= Math.min(kMax, n - 1); k++) {
    const labels = kmeansFit(vectors, k, seed + k);
    const sc = silhouetteScore(vectors, labels);
    if (sc > best.score) best = { k, labels, score: sc };
  }
  return best;
}

/** Simple force-like positions for 1D continuous: x = value, y from repulsion. */
export function layoutForce1D(
  values: number[],
  width: number,
  height: number,
  seed: number,
): { x: number; y: number }[] {
  const n = values.length;
  if (n === 0) return [];
  const minV = Math.min(...values);
  const maxV = Math.max(...values);
  const span = Math.max(maxV - minV, 1e-6);
  const rng = (i: number) => {
    let h = seed + i * 374761393;
    h = Math.imul(h ^ (h >>> 13), 1274126177);
    return ((h >>> 0) % 10000) / 10000;
  };
  const pos = values.map((v, i) => ({
    x: 40 + ((v - minV) / span) * (width - 80),
    y: height / 2 + (rng(i) - 0.5) * (height * 0.35),
  }));
  const kRep = 1200;
  const kSpring = 0.08;
  for (let iter = 0; iter < 60; iter++) {
    const fx = new Array(n).fill(0);
    const fy = new Array(n).fill(0);
    for (let i = 0; i < n; i++) {
      const tx = 40 + ((values[i] - minV) / span) * (width - 80);
      fx[i] += (tx - pos[i].x) * kSpring;
      for (let j = i + 1; j < n; j++) {
        const dx = pos[i].x - pos[j].x;
        const dy = pos[i].y - pos[j].y;
        const d2 = dx * dx + dy * dy + 4;
        const f = kRep / d2;
        fx[i] += dx * f;
        fy[i] += dy * f;
        fx[j] -= dx * f;
        fy[j] -= dy * f;
      }
    }
    for (let i = 0; i < n; i++) {
      pos[i].x += fx[i] * 0.12;
      pos[i].y += fy[i] * 0.12;
      pos[i].x = Math.max(20, Math.min(width - 20, pos[i].x));
      pos[i].y = Math.max(20, Math.min(height - 20, pos[i].y));
    }
  }
  return pos;
}
