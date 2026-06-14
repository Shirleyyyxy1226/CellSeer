import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRatePerformance, fetchCellRecordIndex, fetchDifferential } from '@/lib/api';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { useMasterPlotBridgeOptional } from '@/contexts/MasterPlotBridgeContext';
import { Button } from '@/components/ui/button';
import { Slider } from '@/components/ui/slider';
import { Label } from '@/components/ui/label';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { Pause, Play, SkipBack, SkipForward } from 'lucide-react';
import {
  type CellMetricRow,
  type DimKey,
  type IndexCellRaw,
  type ProtocolSegment,
  type RatePerfCellRaw,
  DIMENSION_CATALOG,
  buildMetricRows,
  colourForCategory,
  etaSquared,
  getCategoricalValue,
  getNumericValue,
  groupByCategory,
  imputeColumnMeans,
  isCategoricalKey,
  isPerCycleKey,
  kmeansBestK,
  layoutForce1D,
  shapeForCategory,
} from '@/lib/masterPlot1Metrics';
import { peakVoltagePerCycle, shiftSeriesVsRef } from '@/lib/dqdvPeaks';
import { MASTER_PLOT_CHART_HEIGHT_PX } from '@/lib/masterPlotLayout';

interface RatePerfData {
  cells?: RatePerfCellRaw[];
}

interface IndexData {
  cells?: IndexCellRaw[];
}

const CAT_ENCODE_KEYS: DimKey[] = ['cathode', 'separator', 'spacer', 'electrolyte', 'protocol', 'c_rate_group'];
const NUM_ENCODE_KEYS: DimKey[] = [
  'retention',
  'capacity',
  'fade_rate',
  'cathode_mass',
  'ce',
  'ice',
  'retention_cycle',
  'capacity_cycle',
  'ce_cycle',
  'dqdv_shift',
];

function hashJitter(idNo: number): number {
  let h = idNo * 2654435761;
  h ^= h >>> 16;
  h = Math.imul(h, 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 1000) / 1000 - 0.5;
}

function layoutSegments(segments: ProtocolSegment[] | undefined, innerW: number) {
  if (!segments?.length)
    return { layouts: [] as Array<ProtocolSegment & { x0: number; width: number; nCyc: number }>, totalCycles: 0 };
  const sorted = [...segments].sort((a, b) => a.cycleStart - b.cycleStart);
  const totalCycles = sorted.reduce((s, seg) => s + (seg.cycleEnd - seg.cycleStart + 1), 0);
  const w = Math.max(1, innerW);
  let acc = 0;
  const layouts = sorted.map((seg) => {
    const nCyc = seg.cycleEnd - seg.cycleStart + 1;
    const segW = (nCyc / totalCycles) * w;
    const layout = { ...seg, x0: acc, width: segW, nCyc };
    acc += segW;
    return layout;
  });
  return { layouts, totalCycles };
}

function cycleToInnerX(
  cycle: number,
  layouts: ReturnType<typeof layoutSegments>['layouts'],
  innerW: number,
): number | null {
  for (const sl of layouts) {
    if (cycle >= sl.cycleStart && cycle <= sl.cycleEnd) {
      const idx = cycle - sl.cycleStart;
      const step = sl.nCyc > 0 ? sl.width / sl.nCyc : sl.width;
      return sl.x0 + (idx + 0.5) * step;
    }
  }
  return null;
}

function zscoreRows(rows: number[][]): number[][] {
  const n = rows.length;
  if (n === 0) return [];
  const d = rows[0].length;
  const out = rows.map((r) => [...r]);
  for (let j = 0; j < d; j++) {
    let sum = 0;
    for (let i = 0; i < n; i++) sum += rows[i][j];
    const mean = sum / n;
    let v = 0;
    for (let i = 0; i < n; i++) v += (rows[i][j] - mean) ** 2;
    const sd = Math.sqrt(v / n) || 1;
    for (let i = 0; i < n; i++) out[i][j] = (rows[i][j] - mean) / sd;
  }
  return out;
}

function cosineSim(a: number[], b: number[]): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  return dot / (Math.sqrt(na) * Math.sqrt(nb) + 1e-9);
}

function convexHull2D(points: { x: number; y: number }[]): { x: number; y: number }[] {
  if (points.length < 3) return [...points];
  const sorted = [...points].sort((a, b) => a.x - b.x || a.y - b.y);
  const cross = (o: { x: number; y: number }, a: { x: number; y: number }, b: { x: number; y: number }) =>
    (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
  const lower: typeof points = [];
  for (const p of sorted) {
    while (lower.length >= 2 && cross(lower[lower.length - 2], lower[lower.length - 1], p) <= 0) lower.pop();
    lower.push(p);
  }
  const upper: typeof points = [];
  for (let i = sorted.length - 1; i >= 0; i--) {
    const p = sorted[i];
    while (upper.length >= 2 && cross(upper[upper.length - 2], upper[upper.length - 1], p) <= 0) upper.pop();
    upper.push(p);
  }
  upper.pop();
  lower.pop();
  return lower.concat(upper);
}

function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x;
    const yi = poly[i].y;
    const xj = poly[j].x;
    const yj = poly[j].y;
    const intersect = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + 1e-12) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function drawShape(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  r: number,
  shape: 'circle' | 'rect' | 'triangle',
  fill: string,
  stroke: string,
  lineWidth = 1.75,
) {
  ctx.fillStyle = fill;
  ctx.strokeStyle = stroke;
  ctx.lineWidth = lineWidth;
  if (shape === 'circle') {
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
  } else if (shape === 'rect') {
    ctx.beginPath();
    ctx.rect(x - r, y - r, r * 2, r * 2);
    ctx.fill();
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(x, y - r * 1.15);
    ctx.lineTo(x - r, y + r * 0.85);
    ctx.lineTo(x + r, y + r * 0.85);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  }
}

const PLOT_H = MASTER_PLOT_CHART_HEIGHT_PX;
const MARGIN_L = 52;
const MARGIN_B = 52;
const MARGIN_R_MARGINAL = 60;
const MARGIN_T_MARGINAL = 52;
/** Inner inset so markers (and jitter) stay inside the frame — every cell remains visible. */
const DATA_PAD = 18;

function formatAxisTick(v: number): string {
  if (!Number.isFinite(v)) return '—';
  const a = Math.abs(v);
  if (a >= 10000) return v.toExponential(2);
  if (a >= 100) return v.toFixed(0);
  if (a >= 10) return v.toFixed(1);
  if (a >= 1) return v.toFixed(2);
  return v.toPrecision(3);
}

function niceStep(rough: number): number {
  if (!Number.isFinite(rough) || rough <= 0) return 1;
  const exp = Math.floor(Math.log10(rough));
  const f = rough / 10 ** exp;
  const nf = f <= 1 ? 1 : f <= 2 ? 2 : f <= 5 ? 5 : 10;
  return nf * 10 ** exp;
}

/** `target` ≈ desired tick count along axis; capped to avoid unreadable overlap on tiny spans. */
function pointInRect(
  x: number,
  y: number,
  r: { x0: number; y0: number; x1: number; y1: number },
): boolean {
  return x >= r.x0 && x <= r.x1 && y >= r.y0 && y <= r.y1;
}

function pickAxisLabelHit(
  lx: number,
  ly: number,
  hit: {
    x?: { x0: number; y0: number; x1: number; y1: number };
    y?: { x0: number; y0: number; x1: number; y1: number };
  },
): 'x' | 'y' | null {
  if (hit.y && pointInRect(lx, ly, hit.y)) return 'y';
  if (hit.x && pointInRect(lx, ly, hit.x)) return 'x';
  return null;
}

function linearAxisTicks(min: number, max: number, target = 9): number[] {
  if (min > max) [min, max] = [max, min];
  if (min === max) return [min];
  const step = niceStep((max - min) / Math.max(1, target - 1));
  const ticks: number[] = [];
  const t0 = Math.ceil(min / step - 1e-9) * step;
  for (let t = t0; t <= max + step * 1e-6; t += step) {
    ticks.push(t);
    if (ticks.length > 22) break;
  }
  return ticks.length ? ticks : [min, max];
}

function drawAxisTicksAndLabels(
  ctx: CanvasRenderingContext2D,
  fg: string,
  tickColor: string,
  opts: {
    plotX0: number;
    plotY0: number;
    plotW: number;
    plotH: number;
    ix0: number;
    iy0: number;
    iw: number;
    ih: number;
    xMin: number;
    xMax: number;
    yMin: number;
    yMax: number;
    xCategorical: boolean;
    yCategorical: boolean;
    xCats?: string[];
    yCats?: string[];
  },
) {
  const { plotX0, plotY0, plotW, plotH, ix0, iy0, iw, ih } = opts;
  const xBottom = plotY0 + plotH;
  const yLeft = plotX0;
  ctx.strokeStyle = tickColor;
  ctx.fillStyle = fg;
  ctx.lineWidth = 1;
  ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'top';

  if (opts.xCategorical && opts.xCats?.length) {
    const n = opts.xCats.length;
    for (let i = 0; i < n; i++) {
      const dataX = i + 0.5;
      const px = ix0 + ((dataX - 0) / Math.max(1e-6, n)) * iw;
      ctx.beginPath();
      ctx.moveTo(px, xBottom - 6);
      ctx.lineTo(px, xBottom);
      ctx.stroke();
      const lab = opts.xCats[i].length > 14 ? `${opts.xCats[i].slice(0, 12)}…` : opts.xCats[i];
      ctx.fillText(lab, px, xBottom + 3);
    }
  } else {
    const xt = linearAxisTicks(opts.xMin, opts.xMax);
    for (const tv of xt) {
      const px = ix0 + ((tv - opts.xMin) / Math.max(1e-9, opts.xMax - opts.xMin)) * iw;
      if (px < ix0 - 2 || px > ix0 + iw + 2) continue;
      ctx.beginPath();
      ctx.moveTo(px, xBottom - 5);
      ctx.lineTo(px, xBottom);
      ctx.stroke();
      ctx.fillText(formatAxisTick(tv), px, xBottom + 2);
    }
  }

  ctx.textAlign = 'right';
  ctx.textBaseline = 'middle';
  if (opts.yCategorical && opts.yCats?.length) {
    const n = opts.yCats.length;
    for (let i = 0; i < n; i++) {
      const dataY = i + 0.5;
      const py = iy0 + ih - ((dataY - 0) / Math.max(1e-6, n)) * ih;
      ctx.beginPath();
      ctx.moveTo(yLeft + 5, py);
      ctx.lineTo(yLeft, py);
      ctx.stroke();
      const lab = opts.yCats[i].length > 12 ? `${opts.yCats[i].slice(0, 10)}…` : opts.yCats[i];
      ctx.fillText(lab, yLeft - 6, py);
    }
  } else {
    const yt = linearAxisTicks(opts.yMin, opts.yMax);
    for (const tv of yt) {
      const py = iy0 + ih - ((tv - opts.yMin) / Math.max(1e-9, opts.yMax - opts.yMin)) * ih;
      if (py < iy0 - 2 || py > iy0 + ih + 2) continue;
      ctx.beginPath();
      ctx.moveTo(yLeft + 5, py);
      ctx.lineTo(yLeft, py);
      ctx.stroke();
      ctx.fillText(formatAxisTick(tv), yLeft - 6, py);
    }
  }
}

/** Crowding factor: shrink glyphs slightly when many cells so overlaps stay parseable. */
function crowdingScale(nCells: number): number {
  return Math.min(1, Math.sqrt(100 / Math.max(nCells, 1)));
}

export interface MasterPlot1PanelProps {
  visibleCells: string[];
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
  onCathodeFilter?: (v: string) => void;
  onSeparatorFilter?: (v: string) => void;
  onSpacerFilter?: (v: string) => void;
}

export default function MasterPlot1Panel({
  visibleCells,
  cathodeFilter,
  spacerFilter,
  separatorFilter,
  onCathodeFilter,
  onSeparatorFilter,
  onSpacerFilter,
}: MasterPlot1PanelProps) {
  const masterBridge = useMasterPlotBridgeOptional();
  const { multiselectionMode, selectedCellIds, setSelectedCellIds, handleCellSelect, clearSelection } =
    useCellSelection();
  const { dataVersion } = useDataRefresh();
  const [rateCells, setRateCells] = useState<RatePerfCellRaw[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedDims, setSelectedDims] = useState<DimKey[]>(['retention']);
  const [colourDim, setColourDim] = useState<DimKey>('cathode');
  const [shapeDim, setShapeDim] = useState<DimKey>('separator');
  const [sizeDim, setSizeDim] = useState<DimKey>('capacity');
  const [crateFilter, setCrateFilter] = useState('All');
  const [use3D, setUse3D] = useState(false);
  const [rotX, setRotX] = useState(0.45);
  const [rotY, setRotY] = useState(-0.55);
  const drag3dRef = useRef<{ x: number; y: number } | null>(null);

  const [cycleIndex, setCycleIndex] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [playSpeed, setPlaySpeed] = useState('1');
  const [showTrails, setShowTrails] = useState(false);
  const [showProtocolMarkers, setShowProtocolMarkers] = useState(true);

  const [hover, setHover] = useState<{ idNo: number; x: number; y: number } | null>(null);
  const [lassoPath, setLassoPath] = useState<{ x: number; y: number }[] | null>(null);
  const lassoActiveRef = useRef(false);

  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerW, setContainerW] = useState(900);
  const trailRef = useRef<Map<number, { x: number; y: number; alpha: number }[]>>(new Map());
  const lastLayoutRef = useRef<{ idNo: number; x: number; y: number; r: number }[]>([]);
  const rafRef = useRef<number | null>(null);
  const lastTickRef = useRef(0);
  const axisPickHitRef = useRef<{
    x?: { x0: number; y0: number; x1: number; y1: number };
    y?: { x0: number; y0: number; x1: number; y1: number };
  }>({});
  const [axisPickOpen, setAxisPickOpen] = useState<'x' | 'y' | null>(null);
  const [axisPickPos, setAxisPickPos] = useState<{ x: number; y: number } | null>(null);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setContainerW(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoadError(null);
    fetchRatePerformance()
      .then((d) => {
        if (cancelled) return;
        if (d.cells.length) setRateCells(d.cells);
        else {
          setRateCells(null);
          setLoadError('No rate-performance data.');
        }
      })
      .catch(() => {
        if (!cancelled) {
          setRateCells(null);
          setLoadError('Failed to load rate-performance data.');
        }
      });
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  const [indexCells, setIndexCells] = useState<IndexCellRaw[]>([]);
  const indexByIdNo = useMemo(() => {
    const m = new Map<number, IndexCellRaw>();
    for (const c of indexCells) {
      if (c?.idNo != null) m.set(c.idNo, c);
    }
    return m;
  }, [indexCells]);

  useEffect(() => {
    let cancelled = false;
    fetchCellRecordIndex()
      .then((d) => {
        if (cancelled) return;
        setIndexCells(d.cells.filter((c) => c?.idNo != null));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [dataVersion]);

  const metricRowsAll = useMemo(() => {
    if (!rateCells?.length) return [];
    return buildMetricRows(rateCells, indexByIdNo);
  }, [rateCells, indexByIdNo]);

  const useVisibleCellFilter = useMemo(() => {
    if (!metricRowsAll.length || visibleCells.length === 0) return false;
    return metricRowsAll.some((c) => visibleCells.includes(c.cellId));
  }, [metricRowsAll, visibleCells]);

  const filterOptions = useMemo(() => {
    if (!rateCells?.length) {
      return { cathodes: ['All'] as string[], separators: ['All'] as string[], spacers: ['All'] as string[] };
    }
    const cathodes = Array.from(new Set(rateCells.map((c) => c.cathode).filter(Boolean))).sort();
    const separators = Array.from(new Set(rateCells.map((c) => c.separatorType).filter(Boolean))).sort();
    const spacers = Array.from(
      new Set(rateCells.map((c) => (c.spacerMm != null ? String(c.spacerMm) : '')).filter(Boolean)),
    ).sort();
    return {
      cathodes: ['All', ...cathodes],
      separators: ['All', ...separators],
      spacers: ['All', ...spacers],
    };
  }, [rateCells]);

  const crateOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of metricRowsAll) s.add(r.cRateGroup);
    return ['All', ...Array.from(s).sort()];
  }, [metricRowsAll]);

  const rowsFiltered = useMemo(() => {
    let out = [...metricRowsAll];
    if (multiselectionMode && selectedCellIds.length > 0) {
      out = out.filter((c) => selectedCellIds.includes(c.idNo));
    }
    if (useVisibleCellFilter) {
      out = out.filter((c) => visibleCells.includes(c.cellId));
    }
    if (cathodeFilter !== 'All') out = out.filter((c) => c.cathode === cathodeFilter);
    if (separatorFilter !== 'All') out = out.filter((c) => c.separatorType === separatorFilter);
    if (spacerFilter !== 'All') out = out.filter((c) => String(c.spacerMm ?? '') === spacerFilter);
    if (crateFilter !== 'All') out = out.filter((c) => c.cRateGroup === crateFilter);
    return out;
  }, [
    metricRowsAll,
    multiselectionMode,
    selectedCellIds,
    useVisibleCellFilter,
    visibleCells,
    cathodeFilter,
    separatorFilter,
    spacerFilter,
    crateFilter,
  ]);

  const [dqdvByIdNo, setDqdvByIdNo] = useState<Record<number, number[]>>({});
  const [dqdvLoading, setDqdvLoading] = useState(false);
  const [dqdvError, setDqdvError] = useState<string | null>(null);

  const plotRows = useMemo(
    () => rowsFiltered.map((r) => (dqdvByIdNo[r.idNo] ? { ...r, dqdvShiftSeries: dqdvByIdNo[r.idNo] } : r)),
    [rowsFiltered, dqdvByIdNo],
  );

  const dqdvFetchKey = useMemo(() => rowsFiltered.map((r) => r.idNo).join(','), [rowsFiltered]);

  useEffect(() => {
    if (!selectedDims.includes('dqdv_shift')) {
      setDqdvLoading(false);
      return;
    }
    let cancelled = false;
    setDqdvLoading(true);
    setDqdvError(null);
    const acc: Record<number, number[]> = {};
    (async () => {
      try {
        const CONC = 4;
        for (let i = 0; i < rowsFiltered.length; i += CONC) {
          if (cancelled) break;
          const chunk = rowsFiltered.slice(i, i + CONC);
          await Promise.all(
            chunk.map(async (row) => {
              try {
                const data = await fetchDifferential(row.idNo);
                const peaks = peakVoltagePerCycle(data, row.cycles);
                let refStep = 0;
                if (row.protocolSegments.length >= 2) {
                  const target = row.protocolSegments[1].cycleStart;
                  const idx = row.cycles.findIndex((c) => c >= target);
                  refStep = idx >= 0 ? idx : 0;
                }
                acc[row.idNo] = shiftSeriesVsRef(peaks, refStep);
              } catch {
                /* skip cell */
              }
            }),
          );
        }
        if (!cancelled) setDqdvByIdNo(acc);
      } catch {
        if (!cancelled) setDqdvError('dQ/dV request failed');
      } finally {
        if (!cancelled) setDqdvLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [selectedDims, dqdvFetchKey]);

  const hasPerCycleSelected = useMemo(() => selectedDims.some((d) => isPerCycleKey(d)), [selectedDims]);

  const maxCycleIndex = useMemo(() => {
    if (!plotRows.length) return 0;
    return Math.max(
      0,
      ...plotRows.map((r) =>
        Math.max(
          r.retentionSeries.length,
          r.specificMahG.length,
          r.ceSeries.length,
          r.dqdvShiftSeries?.length ?? 0,
        ) - 1,
      ),
    );
  }, [plotRows]);

  useEffect(() => {
    setCycleIndex((c) => Math.min(c, maxCycleIndex));
  }, [maxCycleIndex]);

  const playIntervalMs = playSpeed === '0.5' ? 520 : playSpeed === '2' ? 160 : 320;

  const tickAnim = useCallback(
    (ts: number) => {
      if (!playing || maxCycleIndex <= 0 || !hasPerCycleSelected) return;
      if (lastTickRef.current === 0) lastTickRef.current = ts;
      const dt = ts - lastTickRef.current;
      if (dt > playIntervalMs) {
        lastTickRef.current = ts;
        setCycleIndex((c) => (c >= maxCycleIndex ? 0 : c + 1));
      }
      rafRef.current = requestAnimationFrame(tickAnim);
    },
    [playing, maxCycleIndex, playIntervalMs, hasPerCycleSelected],
  );

  useEffect(() => {
    if (playing && hasPerCycleSelected) {
      lastTickRef.current = 0;
      rafRef.current = requestAnimationFrame(tickAnim);
    } else if (rafRef.current != null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    return () => {
      if (rafRef.current != null) cancelAnimationFrame(rafRef.current);
    };
  }, [playing, tickAnim, hasPerCycleSelected]);

  const refSegments = plotRows[0]?.protocolSegments;
  const timelineLayouts = useMemo(() => layoutSegments(refSegments, Math.max(200, containerW - 120)).layouts, [refSegments, containerW]);
  const totalTimelineCycles = useMemo(
    () => layoutSegments(refSegments, 100).totalCycles,
    [refSegments],
  );

  const toggleDim = (key: DimKey) => {
    const entry = DIMENSION_CATALOG.find((d) => d.key === key);
    if (entry?.stub) return;
    setSelectedDims((prev) => {
      if (prev.includes(key)) return prev.filter((k) => k !== key);
      if (prev.length >= 3) return prev;
      return [...prev, key];
    });
  };

  const applyAxisDimension = useCallback((which: 'x' | 'y', key: DimKey) => {
    const entry = DIMENSION_CATALOG.find((d) => d.key === key);
    if (entry?.stub) return;
    setSelectedDims((prev) => {
      if (prev.length < 2) return prev;
      const i = which === 'x' ? 0 : 1;
      const j = 1 - i;
      if (key === prev[j]) {
        const next = [...prev];
        [next[i], next[j]] = [next[j], next[i]];
        return next;
      }
      if (key === prev[i]) return prev;
      const next = [...prev];
      next[i] = key;
      return next;
    });
    setAxisPickOpen(null);
    setAxisPickPos(null);
  }, []);

  useEffect(() => {
    if (!axisPickOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setAxisPickOpen(null);
        setAxisPickPos(null);
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [axisPickOpen]);

  useEffect(() => {
    if (selectedDims.length < 2) {
      setAxisPickOpen(null);
      setAxisPickPos(null);
    }
  }, [selectedDims.length]);

  const modeCount = selectedDims.length;
  const modeLabel =
    modeCount === 0 ? '—' : modeCount === 1 ? 'Force / 1D layout' : modeCount === 2 ? '2D scatter' : use3D ? '3D scatter' : '2D + size';

  const colourDomain = useMemo(() => {
    const s = new Set<string>();
    for (const r of plotRows) s.add(getCategoricalValue(r, colourDim));
    return Array.from(s).sort();
  }, [plotRows, colourDim]);

  const shapeDomain = useMemo(() => {
    const s = new Set<string>();
    for (const r of plotRows) s.add(getCategoricalValue(r, shapeDim));
    return Array.from(s).sort();
  }, [plotRows, shapeDim]);

  const clusterNumericDims = useMemo(
    () => selectedDims.filter((k) => !isCategoricalKey(k)),
    [selectedDims],
  );

  const featureVectors = useMemo(() => {
    if (clusterNumericDims.length === 0) {
      return plotRows.map((r) => [r.retentionScalar, r.capacityScalar, r.fadeRate, r.ceScalar]);
    }
    return plotRows.map((r) =>
      clusterNumericDims.map((k) => {
        const v = getNumericValue(r, k, cycleIndex);
        return v != null && Number.isFinite(v) ? v : NaN;
      }),
    );
  }, [plotRows, clusterNumericDims, cycleIndex]);

  const zFeatures = useMemo(
    () => zscoreRows(imputeColumnMeans(featureVectors)),
    [featureVectors],
  );

  const clusterLabels = useMemo(() => {
    const n = zFeatures.length;
    if (n < 4) return new Array(n).fill(0);
    return kmeansBestK(zFeatures, 2, 6, 42).labels;
  }, [zFeatures]);

  const similarityEdges = useMemo(() => {
    const thresh = 0.92;
    const edges: [number, number][] = [];
    const n = zFeatures.length;
    for (let i = 0; i < n; i++) {
      for (let j = i + 1; j < n; j++) {
        if (cosineSim(zFeatures[i], zFeatures[j]) >= thresh) edges.push([i, j]);
      }
    }
    return edges;
  }, [zFeatures]);

  const insight = useMemo(() => {
    const yKey: DimKey = 'retention';
    let topCat: DimKey = 'cathode';
    let topEta = 0;
    for (const k of CAT_ENCODE_KEYS) {
      const g = groupByCategory(plotRows, k, yKey, 0);
      const e = etaSquared(g);
      if (e > topEta) {
        topEta = e;
        topCat = k;
      }
    }
    const nClusters = new Set(clusterLabels).size;
    const retVals = plotRows.map((r) => r.retentionScalar);
    const mean = retVals.reduce((a, b) => a + b, 0) / Math.max(1, retVals.length);
    const sd = Math.sqrt(retVals.reduce((s, v) => s + (v - mean) ** 2, 0) / Math.max(1, retVals.length)) || 1;
    let anomalies = 0;
    for (const v of retVals) if (Math.abs(v - mean) > 2.5 * sd) anomalies++;
    return { topCat, topEta, nClusters, anomalies };
  }, [plotRows, clusterLabels]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !plotRows.length) return;
    const w = containerW;
    const h = PLOT_H;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const isDark =
      typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    /** Plot chrome only — canvas stays transparent so parent background shows through. */
    const frameStroke = isDark ? 'rgba(248, 250, 252, 0.28)' : 'rgba(15, 23, 42, 0.2)';
    const edgeMuted = isDark ? 'rgba(248, 250, 252, 0.14)' : 'rgba(15, 23, 42, 0.12)';
    const hullStroke = isDark ? 'rgba(248, 250, 252, 0.42)' : 'rgba(15, 23, 42, 0.35)';
    const fg = getComputedStyle(document.documentElement).getPropertyValue('--foreground').trim() || '20 20 20';
    const toRgb = (v: string, fallback: string) => {
      if (v.includes('hsl')) return fallback;
      const parts = v.split(/\s+/).map((x) => x.trim());
      if (parts.length >= 3) return `rgb(${parts[0]}, ${parts[1]}, ${parts[2]})`;
      return fallback;
    };
    const fgC = toRgb(fg, isDark ? '#f8fafc' : '#0f172a');
    const axisTitleInk = isDark ? '#f8fafc' : '#000000';
    const nodeOutline = isDark ? 'rgba(248, 250, 252, 0.9)' : 'rgba(255, 255, 255, 0.92)';
    const lassoStroke = isDark ? 'rgba(125, 211, 252, 0.95)' : 'rgba(2, 132, 199, 0.92)';
    const plotW = w - MARGIN_L - (modeCount === 2 || modeCount === 3 ? MARGIN_R_MARGINAL : 16);
    const plotH = h - MARGIN_B - (modeCount === 2 || modeCount === 3 ? MARGIN_T_MARGINAL : 16);
    const plotX0 = MARGIN_L;
    const plotY0 = modeCount === 2 || modeCount === 3 ? MARGIN_T_MARGINAL : 12;

    ctx.strokeStyle = frameStroke;
    ctx.lineWidth = 1.25;
    ctx.strokeRect(plotX0 + 0.5, plotY0 + 0.5, plotW - 1, plotH - 1);

    const ix0 = plotX0 + DATA_PAD;
    const iy0 = plotY0 + DATA_PAD;
    const iw = Math.max(40, plotW - 2 * DATA_PAD);
    const ih = Math.max(40, plotH - 2 * DATA_PAD);
    const tickCol = isDark ? 'rgba(248, 250, 252, 0.45)' : 'rgba(15, 23, 42, 0.4)';
    const crowd = crowdingScale(plotRows.length);

    const cycleForFrame = cycleIndex;

    type Node = { x: number; y: number; r: number; row: CellMetricRow; idx: number };
    const nodes: Node[] = [];

    if (modeCount === 1) {
      const d0 = selectedDims[0];
      if (isCategoricalKey(d0)) {
        const cats = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, d0)))).sort();
        const colW = iw / Math.max(1, cats.length);
        plotRows.forEach((row, idx) => {
          const cat = getCategoricalValue(row, d0);
          const ci = cats.indexOf(cat);
          let cx = ix0 + ci * colW + colW / 2 + hashJitter(row.idNo) * colW * 0.32;
          let cy = iy0 + ih / 2 + hashJitter(row.idNo + 7) * ih * 0.36;
          const rv = getNumericValue(row, 'retention', cycleForFrame) ?? row.retentionScalar;
          const r = (5 + Math.min(10, Math.abs(rv - 95) * 0.15)) * crowd;
          cx = Math.min(ix0 + iw - r, Math.max(ix0 + r, cx));
          cy = Math.min(iy0 + ih - r, Math.max(iy0 + r, cy));
          nodes.push({ x: cx, y: cy, r, row, idx });
        });
        similarityEdges.forEach(([a, b]) => {
          const na = nodes[a];
          const nb = nodes[b];
          if (!na || !nb) return;
          ctx.strokeStyle = edgeMuted;
          ctx.globalAlpha = 0.55;
          ctx.beginPath();
          ctx.moveTo(na.x, na.y);
          ctx.lineTo(nb.x, nb.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        });
      } else {
        const vals = plotRows.map((r) => getNumericValue(r, d0, cycleForFrame) ?? 0);
        const positions = layoutForce1D(vals, iw, ih, 13).map((p) => ({
          x: ix0 + p.x,
          y: iy0 + p.y,
        }));
        plotRows.forEach((row, idx) => {
          const p = positions[idx];
          const rv = getNumericValue(row, d0, cycleForFrame) ?? 0;
          let r = (5 + Math.min(8, Math.abs(rv) * 0.02)) * crowd;
          let cx = Math.min(ix0 + iw - r, Math.max(ix0 + r, p.x));
          let cy = Math.min(iy0 + ih - r, Math.max(iy0 + r, p.y));
          nodes.push({ x: cx, y: cy, r, row, idx });
        });
        similarityEdges.forEach(([a, b]) => {
          const na = nodes[a];
          const nb = nodes[b];
          if (!na || !nb) return;
          ctx.strokeStyle = edgeMuted;
          ctx.globalAlpha = 0.6;
          ctx.beginPath();
          ctx.moveTo(na.x, na.y);
          ctx.lineTo(nb.x, nb.y);
          ctx.stroke();
          ctx.globalAlpha = 1;
        });
      }
      const byCl = new Map<number, { x: number; y: number }[]>();
      nodes.forEach((n, i) => {
        const lb = clusterLabels[i] ?? 0;
        if (!byCl.has(lb)) byCl.set(lb, []);
        byCl.get(lb)!.push({ x: n.x, y: n.y });
      });
      byCl.forEach((pts) => {
        if (pts.length < 3) return;
        const hull = convexHull2D(pts);
        if (hull.length < 3) return;
        ctx.strokeStyle = hullStroke;
        ctx.setLineDash([6, 4]);
        ctx.beginPath();
        ctx.moveTo(hull[0].x, hull[0].y);
        for (let i = 1; i < hull.length; i++) ctx.lineTo(hull[i].x, hull[i].y);
        ctx.closePath();
        ctx.stroke();
        ctx.setLineDash([]);
      });
      const xBottom = plotY0 + plotH;
      const yLeft = plotX0;
      ctx.strokeStyle = tickCol;
      ctx.fillStyle = fgC;
      ctx.beginPath();
      ctx.moveTo(ix0, xBottom);
      ctx.lineTo(ix0 + iw, xBottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(yLeft, iy0);
      ctx.lineTo(yLeft, iy0 + ih);
      ctx.stroke();
      if (isCategoricalKey(d0)) {
        const cats = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, d0)))).sort();
        const colW = iw / Math.max(1, cats.length);
        ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        cats.forEach((lab, i) => {
          const px = ix0 + i * colW + colW / 2;
          ctx.beginPath();
          ctx.moveTo(px, xBottom - 5);
          ctx.lineTo(px, xBottom);
          ctx.stroke();
          const t = lab.length > 14 ? `${lab.slice(0, 12)}…` : lab;
          ctx.fillText(t, px, xBottom + 2);
        });
      } else {
        const vals = plotRows.map((r) => getNumericValue(r, d0, cycleForFrame) ?? 0);
        const vmin = Math.min(...vals);
        const vmax = Math.max(...vals);
        const xt = linearAxisTicks(vmin, vmax);
        ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'top';
        for (const tv of xt) {
          const px = ix0 + ((tv - vmin) / (Math.max(1e-9, vmax - vmin))) * iw;
          if (px < ix0 - 2 || px > ix0 + iw + 2) continue;
          ctx.beginPath();
          ctx.moveTo(px, xBottom - 5);
          ctx.lineTo(px, xBottom);
          ctx.stroke();
          ctx.fillText(formatAxisTick(tv), px, xBottom + 2);
        }
      }
    } else if (modeCount === 2) {
      const dx = selectedDims[0];
      const dy = selectedDims[1];
      const xDom = isCategoricalKey(dx)
        ? Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dx)))).sort()
        : [];
      const yDom = isCategoricalKey(dy)
        ? Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dy)))).sort()
        : [];
      const xs: number[] = [];
      const ys: number[] = [];
      plotRows.forEach((row) => {
        if (isCategoricalKey(dx)) {
          const ix = xDom.indexOf(getCategoricalValue(row, dx));
          xs.push(ix + 0.5 + hashJitter(row.idNo) * 0.36);
        } else {
          xs.push(getNumericValue(row, dx, cycleForFrame) ?? 0);
        }
        if (isCategoricalKey(dy)) {
          const iy = yDom.indexOf(getCategoricalValue(row, dy));
          ys.push(iy + 0.5 + hashJitter(row.idNo + 3) * 0.36);
        } else {
          ys.push(getNumericValue(row, dy, cycleForFrame) ?? 0);
        }
      });
      const xMin = isCategoricalKey(dx) ? 0 : Math.min(...xs);
      const xMax = isCategoricalKey(dx) ? xDom.length : Math.max(...xs);
      const yMin = isCategoricalKey(dy) ? 0 : Math.min(...ys);
      const yMax = isCategoricalKey(dy) ? yDom.length : Math.max(...ys);
      const xSpan = Math.max(1e-6, xMax - xMin);
      const ySpan = Math.max(1e-6, yMax - yMin);
      const sx = (xv: number) => ix0 + ((xv - xMin) / xSpan) * iw;
      const sy = (yv: number) => iy0 + ih - ((yv - yMin) / ySpan) * ih;

      plotRows.forEach((row, idx) => {
        let xv: number;
        let yv: number;
        if (isCategoricalKey(dx)) {
          xv = xDom.indexOf(getCategoricalValue(row, dx)) + 0.5 + hashJitter(row.idNo) * 0.36;
        } else xv = getNumericValue(row, dx, cycleForFrame) ?? 0;
        if (isCategoricalKey(dy)) {
          yv = yDom.indexOf(getCategoricalValue(row, dy)) + 0.5 + hashJitter(row.idNo + 3) * 0.36;
        } else yv = getNumericValue(row, dy, cycleForFrame) ?? 0;
        let cx = sx(xv);
        let cy = sy(yv);
        const sz = getNumericValue(row, sizeDim, cycleForFrame);
        const baseR = 5 * crowd;
        const sizeK =
          sizeDim === 'ce' || sizeDim === 'ce_cycle'
            ? 0.35
            : sizeDim === 'ice'
              ? 0.25
              : sizeDim === 'dqdv_shift'
                ? 6
                : sizeDim === 'retention' || sizeDim === 'retention_cycle' || sizeDim === 'capacity_cycle'
                  ? 0.06
                  : 0.04;
        let r =
          sz != null && Number.isFinite(sz) ? baseR + Math.min(12, Math.abs(sz) * sizeK) * crowd : baseR;
        cx = Math.min(ix0 + iw - r, Math.max(ix0 + r, cx));
        cy = Math.min(iy0 + ih - r, Math.max(iy0 + r, cy));
        nodes.push({ x: cx, y: cy, r, row, idx });
      });

      const bins = 12;
      const hx = new Array(bins).fill(0);
      const hy = new Array(bins).fill(0);
      nodes.forEach((n) => {
        const bx = Math.min(bins - 1, Math.floor(((n.x - ix0) / iw) * bins));
        const by = Math.min(bins - 1, Math.floor(((n.y - iy0) / ih) * bins));
        hx[bx]++;
        hy[by]++;
      });
      const mTop = Math.max(1, ...hx, ...hy);
      const margW = MARGIN_T_MARGINAL - 4;
      const margR = MARGIN_R_MARGINAL - 4;
      const rightMargX = plotX0 + plotW + 3;
      /** Marginal bars: fill only, no strip background; skip empty bins. */
      const barFillTop = isDark ? 'rgba(148, 163, 184, 0.38)' : 'rgba(71, 85, 105, 0.22)';
      const barFillRight = isDark ? 'rgba(148, 163, 184, 0.34)' : 'rgba(71, 85, 105, 0.18)';
      const binGap = 1;
      hx.forEach((v, bi) => {
        if (v <= 0) return;
        const bw = Math.max(1.5, iw / bins - binGap);
        const bx0 = ix0 + (bi / bins) * iw + binGap / 2;
        const bh = Math.max(1.5, (v / mTop) * (margW - 6));
        const by = plotY0 - 3 - bh;
        ctx.fillStyle = barFillTop;
        ctx.fillRect(bx0, by, bw, bh);
      });
      hy.forEach((v, bi) => {
        if (v <= 0) return;
        const bh = Math.max(1.5, ih / bins - binGap);
        const by0 = iy0 + ih - ((bi + 1) / bins) * ih + binGap / 2;
        const bw = Math.max(1.5, (v / mTop) * (margR - 6));
        const bx = rightMargX + 2;
        ctx.fillStyle = barFillRight;
        ctx.fillRect(bx, by0, bw, bh);
      });

      const xBottom = plotY0 + plotH;
      const yLeft = plotX0;
      ctx.strokeStyle = tickCol;
      ctx.beginPath();
      ctx.moveTo(ix0, xBottom);
      ctx.lineTo(ix0 + iw, xBottom);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(yLeft, iy0);
      ctx.lineTo(yLeft, iy0 + ih);
      ctx.stroke();
      drawAxisTicksAndLabels(ctx, fgC, tickCol, {
        plotX0,
        plotY0,
        plotW,
        plotH,
        ix0,
        iy0,
        iw,
        ih,
        xMin,
        xMax,
        yMin,
        yMax,
        xCategorical: isCategoricalKey(dx),
        yCategorical: isCategoricalKey(dy),
        xCats: isCategoricalKey(dx) ? xDom : undefined,
        yCats: isCategoricalKey(dy) ? yDom : undefined,
      });
    } else if (modeCount === 3) {
      const dx = selectedDims[0];
      const dy = selectedDims[1];
      const dz = selectedDims[2];
      const xDom3 = isCategoricalKey(dx)
        ? Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dx)))).sort()
        : [];
      const yDom3 = isCategoricalKey(dy)
        ? Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dy)))).sort()
        : [];
      const zDom3 = isCategoricalKey(dz)
        ? Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dz)))).sort()
        : [];
      const xv = (row: CellMetricRow) =>
        isCategoricalKey(dx) ? xDom3.indexOf(getCategoricalValue(row, dx)) : (getNumericValue(row, dx, cycleForFrame) ?? 0);
      const yv = (row: CellMetricRow) =>
        isCategoricalKey(dy) ? yDom3.indexOf(getCategoricalValue(row, dy)) : (getNumericValue(row, dy, cycleForFrame) ?? 0);
      const zv = (row: CellMetricRow) =>
        isCategoricalKey(dz) ? zDom3.indexOf(getCategoricalValue(row, dz)) : (getNumericValue(row, dz, cycleForFrame) ?? 0);
      const zs = plotRows.map((row) => zv(row));
      const xData = (row: CellMetricRow) =>
        isCategoricalKey(dx)
          ? xDom3.indexOf(getCategoricalValue(row, dx)) + 0.5 + hashJitter(row.idNo) * 0.28
          : (getNumericValue(row, dx, cycleForFrame) ?? 0);
      const yData = (row: CellMetricRow) =>
        isCategoricalKey(dy)
          ? yDom3.indexOf(getCategoricalValue(row, dy)) + 0.5 + hashJitter(row.idNo + 3) * 0.28
          : (getNumericValue(row, dy, cycleForFrame) ?? 0);
      const xVals = plotRows.map((r) => xData(r));
      const yVals = plotRows.map((r) => yData(r));
      const minX = isCategoricalKey(dx) ? 0 : Math.min(...xVals);
      const maxX = isCategoricalKey(dx) ? xDom3.length : Math.max(...xVals);
      const minY = isCategoricalKey(dy) ? 0 : Math.min(...yVals);
      const maxY = isCategoricalKey(dy) ? yDom3.length : Math.max(...yVals);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      const xSpan = Math.max(1e-6, maxX - minX);
      const ySpan = Math.max(1e-6, maxY - minY);
      const nx = (row: CellMetricRow) => (2 * (xData(row) - minX)) / xSpan - 1;
      const ny = (row: CellMetricRow) => (2 * (yData(row) - minY)) / ySpan - 1;
      const nz = (v: number) => (2 * (v - minZ)) / (Math.max(1e-6, maxZ - minZ) || 1) - 1;
      const cx0 = ix0 + iw / 2;
      const cy0 = iy0 + ih / 2;
      const scale = Math.min(iw, ih) * 0.32;
      const project = (x: number, y: number, z: number) => {
        if (!use3D) return { x: cx0 + x * scale, y: cy0 - y * scale, z };
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        let x1 = x * cosY + z * sinY;
        let z1 = -x * sinY + z * cosY;
        const cosX = Math.cos(rotX);
        const sinX = Math.sin(rotX);
        const y2 = y * cosX - z1 * sinX;
        return { x: cx0 + x1 * scale, y: cy0 - y2 * scale, z: z1 };
      };
      const projected = plotRows.map((row, idx) => {
        const x = nx(row);
        const y = ny(row);
        const z = nz(zv(row));
        const p = project(x, y, z);
        const baseR = (use3D ? 4 : 5) * crowd;
        let r = baseR;
        if (!use3D) {
          const sz = getNumericValue(row, sizeDim, cycleForFrame);
          const sizeK =
            sizeDim === 'ce' || sizeDim === 'ce_cycle'
              ? 0.4
              : sizeDim === 'ice'
                ? 0.28
                : sizeDim === 'dqdv_shift'
                  ? 7
                  : sizeDim === 'retention' || sizeDim === 'retention_cycle'
                    ? 0.07
                    : 0.05;
          if (sz != null && Number.isFinite(sz)) r = baseR + Math.min(14, Math.abs(sz) * sizeK) * crowd;
        } else {
          r = baseR + (z + 1) * 3.2 * crowd;
        }
        let cx = Math.min(ix0 + iw - r, Math.max(ix0 + r, p.x));
        let cy = Math.min(iy0 + ih - r, Math.max(iy0 + r, p.y));
        return { x: cx, y: cy, r, row, idx, zKey: p.z ?? z };
      });
      projected.sort((a, b) => (a.zKey ?? 0) - (b.zKey ?? 0));
      projected.forEach((n) => nodes.push(n));

      const xBottom3 = plotY0 + plotH;
      const yLeft3 = plotX0;
      ctx.strokeStyle = tickCol;
      ctx.beginPath();
      ctx.moveTo(ix0, xBottom3);
      ctx.lineTo(ix0 + iw, xBottom3);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(yLeft3, iy0);
      ctx.lineTo(yLeft3, iy0 + ih);
      ctx.stroke();
      if (!use3D) {
        drawAxisTicksAndLabels(ctx, fgC, tickCol, {
          plotX0,
          plotY0,
          plotW,
          plotH,
          ix0,
          iy0,
          iw,
          ih,
          xMin: minX,
          xMax: maxX,
          yMin: minY,
          yMax: maxY,
          xCategorical: isCategoricalKey(dx),
          yCategorical: isCategoricalKey(dy),
          xCats: isCategoricalKey(dx) ? xDom3 : undefined,
          yCats: isCategoricalKey(dy) ? yDom3 : undefined,
        });
      } else {
        const lz = DIMENSION_CATALOG.find((d) => d.key === dz)?.label ?? dz;
        ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
        ctx.fillStyle = fgC;
        ctx.textAlign = 'left';
        ctx.textBaseline = 'bottom';
        const lx3 = DIMENSION_CATALOG.find((d) => d.key === dx)?.label ?? dx;
        const ly3 = DIMENSION_CATALOG.find((d) => d.key === dy)?.label ?? dy;
        let zLo = formatAxisTick(minZ);
        let zHi = formatAxisTick(maxZ);
        if (isCategoricalKey(dz)) {
          zLo = `${zDom3.length} cats`;
          zHi = '';
        }
        ctx.fillText(
          `${lx3}: ${formatAxisTick(minX)}–${formatAxisTick(maxX)}  ·  ${ly3}: ${formatAxisTick(minY)}–${formatAxisTick(maxY)}  ·  ${lz}: ${zLo}${zHi ? `–${zHi}` : ''}`,
          ix0,
          iy0 + ih - 4,
        );
      }
    }

    lastLayoutRef.current = nodes.map((n) => ({ idNo: n.row.idNo, x: n.x, y: n.y, r: n.r }));

    if (modeCount === 3 && use3D && nodes.length) {
      const floorY = plotY0 + plotH - 8;
      const sortedBack = [...nodes].sort(
        (a, b) => ((a as { zKey?: number }).zKey ?? 0) - ((b as { zKey?: number }).zKey ?? 0),
      );
      for (const n of sortedBack) {
        const zk = (n as { zKey?: number }).zKey ?? 0;
        const t = Math.max(0, Math.min(1, (zk + 1) / 2));
        ctx.fillStyle = isDark
          ? `rgba(0,0,0,${0.22 + t * 0.28})`
          : `rgba(15,23,42,${0.06 + t * 0.1})`;
        ctx.beginPath();
        ctx.ellipse(n.x, floorY, Math.max(2.5, n.r * 1.35), Math.max(1, n.r * 0.42), 0, 0, Math.PI * 2);
        ctx.fill();
      }
    }

    if (showTrails && hasPerCycleSelected && (modeCount === 2 || modeCount === 3)) {
      const map = trailRef.current;
      ctx.save();
      ctx.globalCompositeOperation = 'lighter';
      nodes.forEach((n) => {
        const arr = map.get(n.row.idNo) ?? [];
        arr.forEach((pt) => {
          ctx.fillStyle = colourForCategory(getCategoricalValue(n.row, colourDim), colourDomain);
          ctx.globalAlpha = pt.alpha * 0.25;
          ctx.beginPath();
          ctx.arc(pt.x, pt.y, 3, 0, Math.PI * 2);
          ctx.fill();
        });
      });
      ctx.restore();
    }

    const pcPass = masterBridge?.pcBrushPassingIds;
    const pcBrushActive = pcPass != null;

    nodes.forEach((n) => {
      const col = colourForCategory(getCategoricalValue(n.row, colourDim), colourDomain);
      const sh = shapeForCategory(getCategoricalValue(n.row, shapeDim), shapeDomain);
      const sel = selectedCellIds.includes(n.row.idNo);
      const inBrush = !pcBrushActive || pcPass.has(n.row.idNo);
      ctx.globalAlpha = pcBrushActive && !inBrush ? 0.06 : 1;
      drawShape(ctx, n.x, n.y, n.r, sh, col, sel ? fgC : nodeOutline, sel ? 2.25 : 1.75);
      ctx.globalAlpha = 1;
    });

    if (lassoPath && lassoPath.length > 1) {
      ctx.strokeStyle = lassoStroke;
      ctx.lineWidth = 2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.moveTo(lassoPath[0].x, lassoPath[0].y);
      for (let i = 1; i < lassoPath.length; i++) ctx.lineTo(lassoPath[i].x, lassoPath[i].y);
      ctx.stroke();
      ctx.setLineDash([]);
    }

    const hoverTargetId = hover?.idNo ?? masterBridge?.hoveredIdNo ?? null;
    if (hoverTargetId != null) {
      const hn = nodes.find((n) => n.row.idNo === hoverTargetId);
      if (hn) {
        ctx.strokeStyle = fgC;
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hn.x, hn.y, hn.r + 4, 0, Math.PI * 2);
        ctx.stroke();
      }
    }

    const axisTitleFont = '600 11px ui-sans-serif, system-ui, sans-serif';
    const expandGlyphFont = '600 13px ui-sans-serif, system-ui, sans-serif';
    ctx.font = axisTitleFont;
    if (modeCount >= 2) {
      const dx = selectedDims[0];
      const dy = selectedDims[1];
      const lx = DIMENSION_CATALOG.find((d) => d.key === dx)?.label ?? dx;
      const ly = DIMENSION_CATALOG.find((d) => d.key === dy)?.label ?? dy;
      const expandGlyph = '\u25BE';
      const twx = ctx.measureText(lx).width;
      ctx.font = expandGlyphFont;
      const twChev = ctx.measureText(expandGlyph).width;
      const gap = 6;
      const xTitleW = twx + gap + twChev;
      /** Center X title on the data axis (not the full plot frame incl. right marginal). */
      const axisMidX = ix0 + iw / 2;
      const tcx = axisMidX - xTitleW / 2;
      const tly = plotY0 + plotH + 28;
      ctx.textAlign = 'left';
      ctx.textBaseline = 'alphabetic';
      ctx.font = axisTitleFont;
      ctx.fillStyle = axisTitleInk;
      ctx.fillText(lx, tcx, tly);
      ctx.font = expandGlyphFont;
      ctx.fillText(expandGlyph, tcx + twx + gap, tly + 1);
      axisPickHitRef.current.x = {
        x0: tcx - 10,
        y0: tly - 16,
        x1: tcx + xTitleW + 10,
        y1: tly + 10,
      };

      ctx.font = axisTitleFont;
      const twy = ctx.measureText(ly).width;
      ctx.font = expandGlyphFont;
      const twChevY = ctx.measureText(expandGlyph).width;
      /** Vertical middle of the Y data axis (plot inner height). */
      const cy = iy0 + ih / 2;
      const yGroupW = twy + gap + twChevY;
      axisPickHitRef.current.y = { x0: 2, y0: cy - yGroupW / 2 - 12, x1: 52, y1: cy + yGroupW / 2 + 12 };
      ctx.save();
      ctx.translate(22, cy);
      ctx.rotate(-Math.PI / 2);
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.font = axisTitleFont;
      ctx.fillStyle = axisTitleInk;
      ctx.fillText(ly, -yGroupW / 2, 0);
      ctx.font = expandGlyphFont;
      ctx.fillText(expandGlyph, -yGroupW / 2 + twy + gap, 0);
      ctx.restore();
      ctx.textBaseline = 'alphabetic';
      ctx.fillStyle = fgC;
    } else {
      axisPickHitRef.current = {};
    }

    if (modeCount === 1) {
      ctx.fillStyle = fgC;
      ctx.font = '10px sans-serif';
      const d0 = selectedDims[0];
      ctx.fillText(`${DIMENSION_CATALOG.find((d) => d.key === d0)?.label ?? d0} · clusters: ${insight.nClusters}`, plotX0 + 8, plotY0 + plotH - 8);
    }
  }, [
    plotRows,
    selectedDims,
    modeCount,
    containerW,
    colourDim,
    shapeDim,
    sizeDim,
    colourDomain,
    shapeDomain,
    clusterLabels,
    similarityEdges,
    cycleIndex,
    hover,
    lassoPath,
    selectedCellIds,
    showTrails,
    hasPerCycleSelected,
    use3D,
    rotX,
    rotY,
    insight.nClusters,
    masterBridge?.hoveredIdNo,
    masterBridge?.pcBrushPassingIds,
  ]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const el = document.documentElement;
    const ro = new MutationObserver(() => draw());
    ro.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => ro.disconnect();
  }, [draw]);

  useEffect(() => {
    if (!showTrails || !hasPerCycleSelected) {
      trailRef.current.clear();
      return;
    }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = PLOT_H;
    const plotW = w - MARGIN_L - (modeCount === 2 || modeCount === 3 ? MARGIN_R_MARGINAL : 16);
    const plotH = h - MARGIN_B - (modeCount === 2 || modeCount === 3 ? MARGIN_T_MARGINAL : 16);
    const plotX0 = MARGIN_L;
    const plotY0 = modeCount === 2 || modeCount === 3 ? MARGIN_T_MARGINAL : 12;
    const dx = selectedDims[0];
    const dy = selectedDims[1];
    if (modeCount < 2) return;

    const xMinMax = (() => {
      const xs: number[] = [];
      plotRows.forEach((row) => {
        if (isCategoricalKey(dx)) {
          const dom = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dx)))).sort();
          xs.push(dom.indexOf(getCategoricalValue(row, dx)) + 0.5 + hashJitter(row.idNo) * 0.4);
        } else {
          xs.push(getNumericValue(row, dx, cycleIndex) ?? 0);
        }
      });
      return { min: isCategoricalKey(dx) ? 0 : Math.min(...xs), max: isCategoricalKey(dx) ? Math.max(...xs) + 0.5 : Math.max(...xs) };
    })();
    const yMinMax = (() => {
      const ys: number[] = [];
      plotRows.forEach((row) => {
        if (isCategoricalKey(dy)) {
          const dom = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dy)))).sort();
          ys.push(dom.indexOf(getCategoricalValue(row, dy)) + 0.5 + hashJitter(row.idNo + 3) * 0.4);
        } else {
          ys.push(getNumericValue(row, dy, cycleIndex) ?? 0);
        }
      });
      return { min: isCategoricalKey(dy) ? 0 : Math.min(...ys), max: isCategoricalKey(dy) ? Math.max(...ys) + 0.5 : Math.max(...ys) };
    })();
    const sx = (xv: number) => plotX0 + ((xv - xMinMax.min) / (Math.max(1e-6, xMinMax.max - xMinMax.min))) * plotW;
    const sy = (yv: number) => plotY0 + plotH - ((yv - yMinMax.min) / (Math.max(1e-6, yMinMax.max - yMinMax.min))) * plotH;

    plotRows.forEach((row) => {
      let xv: number;
      let yv: number;
      if (isCategoricalKey(dx)) {
        const dom = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dx)))).sort();
        xv = dom.indexOf(getCategoricalValue(row, dx)) + 0.5 + hashJitter(row.idNo) * 0.4;
      } else xv = getNumericValue(row, dx, cycleIndex) ?? 0;
      if (isCategoricalKey(dy)) {
        const dom = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dy)))).sort();
        yv = dom.indexOf(getCategoricalValue(row, dy)) + 0.5 + hashJitter(row.idNo + 3) * 0.4;
      } else yv = getNumericValue(row, dy, cycleIndex) ?? 0;
      const cx = sx(xv);
      const cy = sy(yv);
      const list = trailRef.current.get(row.idNo) ?? [];
      list.push({ x: cx, y: cy, alpha: 1 });
      const trimmed = list.slice(-24).map((p, i) => ({ ...p, alpha: (i + 1) / list.length }));
      trailRef.current.set(row.idNo, trimmed);
    });
  }, [cycleIndex, showTrails, hasPerCycleSelected, modeCount, plotRows, selectedDims]);

  const canvasToLocal = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { x: 0, y: 0 };
    const r = canvas.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  };

  const pickNode = (lx: number, ly: number): CellMetricRow | null => {
    const canvas = canvasRef.current;
    if (!canvas || !plotRows.length) return null;
    const w = containerW;
    const h = PLOT_H;
    const plotW = w - MARGIN_L - (modeCount === 2 || modeCount === 3 ? MARGIN_R_MARGINAL : 16);
    const plotH = h - MARGIN_B - (modeCount === 2 || modeCount === 3 ? MARGIN_T_MARGINAL : 16);
    const plotX0 = MARGIN_L;
    const plotY0 = modeCount === 2 || modeCount === 3 ? MARGIN_T_MARGINAL : 12;
    const cycleForFrame = cycleIndex;
    type P = { x: number; y: number; r: number; row: CellMetricRow };
    const pts: P[] = [];
    if (modeCount === 1) {
      const d0 = selectedDims[0];
      if (isCategoricalKey(d0)) {
        const cats = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, d0)))).sort();
        const colW = plotW / Math.max(1, cats.length);
        plotRows.forEach((row) => {
          const cat = getCategoricalValue(row, d0);
          const ci = cats.indexOf(cat);
          const cx = plotX0 + ci * colW + colW / 2 + hashJitter(row.idNo) * colW * 0.35;
          const cy = plotY0 + plotH / 2 + hashJitter(row.idNo + 7) * plotH * 0.38;
          const rv = getNumericValue(row, 'retention', cycleForFrame) ?? row.retentionScalar;
          const r = 5 + Math.min(10, Math.abs(rv - 95) * 0.15);
          pts.push({ x: cx, y: cy, r, row });
        });
      } else {
        const vals = plotRows.map((r) => getNumericValue(r, d0, cycleForFrame) ?? 0);
        const positions = layoutForce1D(vals, plotW, plotH, 13).map((p) => ({
          x: plotX0 + p.x,
          y: plotY0 + p.y,
        }));
        plotRows.forEach((row, idx) => {
          const p = positions[idx];
          const rv = getNumericValue(row, d0, cycleForFrame) ?? 0;
          const r = 5 + Math.min(8, Math.abs(rv) * 0.02);
          pts.push({ x: p.x, y: p.y, r, row });
        });
      }
    } else if (modeCount === 2) {
      const dx = selectedDims[0];
      const dy = selectedDims[1];
      const xs: number[] = [];
      const ys: number[] = [];
      plotRows.forEach((row) => {
        if (isCategoricalKey(dx)) {
          const dom = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dx)))).sort();
          const ix = dom.indexOf(getCategoricalValue(row, dx));
          xs.push(ix + 0.5 + hashJitter(row.idNo) * 0.4);
        } else {
          xs.push(getNumericValue(row, dx, cycleForFrame) ?? 0);
        }
        if (isCategoricalKey(dy)) {
          const dom = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dy)))).sort();
          const iy = dom.indexOf(getCategoricalValue(row, dy));
          ys.push(iy + 0.5 + hashJitter(row.idNo + 3) * 0.4);
        } else {
          ys.push(getNumericValue(row, dy, cycleForFrame) ?? 0);
        }
      });
      const xMin = isCategoricalKey(dx) ? 0 : Math.min(...xs);
      const xMax = isCategoricalKey(dx) ? Math.max(...xs) + 0.5 : Math.max(...xs);
      const yMin = isCategoricalKey(dy) ? 0 : Math.min(...ys);
      const yMax = isCategoricalKey(dy) ? Math.max(...ys) + 0.5 : Math.max(...ys);
      const sx = (xv: number) => plotX0 + ((xv - xMin) / (Math.max(1e-6, xMax - xMin))) * plotW;
      const sy = (yv: number) => plotY0 + plotH - ((yv - yMin) / (Math.max(1e-6, yMax - yMin))) * plotH;
      plotRows.forEach((row) => {
        let xv: number;
        let yv: number;
        if (isCategoricalKey(dx)) {
          const dom = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dx)))).sort();
          xv = dom.indexOf(getCategoricalValue(row, dx)) + 0.5 + hashJitter(row.idNo) * 0.4;
        } else xv = getNumericValue(row, dx, cycleForFrame) ?? 0;
        if (isCategoricalKey(dy)) {
          const dom = Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dy)))).sort();
          yv = dom.indexOf(getCategoricalValue(row, dy)) + 0.5 + hashJitter(row.idNo + 3) * 0.4;
        } else yv = getNumericValue(row, dy, cycleForFrame) ?? 0;
        const cx = sx(xv);
        const cy = sy(yv);
        const sz = getNumericValue(row, sizeDim, cycleForFrame);
        const baseR = 5;
        const sizeK =
          sizeDim === 'ce' || sizeDim === 'ce_cycle'
            ? 0.35
            : sizeDim === 'ice'
              ? 0.25
              : sizeDim === 'dqdv_shift'
                ? 6
                : sizeDim === 'retention' || sizeDim === 'retention_cycle' || sizeDim === 'capacity_cycle'
                  ? 0.06
                  : 0.04;
        const r =
          sz != null && Number.isFinite(sz) ? baseR + Math.min(12, Math.abs(sz) * sizeK) : baseR;
        pts.push({ x: cx, y: cy, r, row });
      });
    } else if (modeCount === 3) {
      const dx = selectedDims[0];
      const dy = selectedDims[1];
      const dz = selectedDims[2];
      const xv = (row: CellMetricRow) =>
        isCategoricalKey(dx)
          ? Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dx)))).sort().indexOf(getCategoricalValue(row, dx))
          : (getNumericValue(row, dx, cycleForFrame) ?? 0);
      const yv = (row: CellMetricRow) =>
        isCategoricalKey(dy)
          ? Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dy)))).sort().indexOf(getCategoricalValue(row, dy))
          : (getNumericValue(row, dy, cycleForFrame) ?? 0);
      const zv = (row: CellMetricRow) =>
        isCategoricalKey(dz)
          ? Array.from(new Set(plotRows.map((r) => getCategoricalValue(r, dz)))).sort().indexOf(getCategoricalValue(row, dz))
          : (getNumericValue(row, dz, cycleForFrame) ?? 0);
      const xs = plotRows.map(xv);
      const ys = plotRows.map(yv);
      const zs = plotRows.map(zv);
      const minX = Math.min(...xs);
      const maxX = Math.max(...xs);
      const minY = Math.min(...ys);
      const maxY = Math.max(...ys);
      const minZ = Math.min(...zs);
      const maxZ = Math.max(...zs);
      const nx = (v: number) => (2 * (v - minX)) / (Math.max(1e-6, maxX - minX) || 1) - 1;
      const ny = (v: number) => (2 * (v - minY)) / (Math.max(1e-6, maxY - minY) || 1) - 1;
      const nz = (v: number) => (2 * (v - minZ)) / (Math.max(1e-6, maxZ - minZ) || 1) - 1;
      const cx0 = plotX0 + plotW / 2;
      const cy0 = plotY0 + plotH / 2;
      const scale = Math.min(plotW, plotH) * 0.32;
      const project = (x: number, y: number, z: number) => {
        if (!use3D) return { x: cx0 + x * scale, y: cy0 - y * scale, z };
        const cosY = Math.cos(rotY);
        const sinY = Math.sin(rotY);
        let x1 = x * cosY + z * sinY;
        let z1 = -x * sinY + z * cosY;
        const cosX = Math.cos(rotX);
        const sinX = Math.sin(rotX);
        const y2 = y * cosX - z1 * sinX;
        return { x: cx0 + x1 * scale, y: cy0 - y2 * scale, z: z1 };
      };
      plotRows.forEach((row) => {
        const p = project(nx(xv(row)), ny(yv(row)), nz(zv(row)));
        const baseR = use3D ? 4 : 5;
        let r = baseR;
        if (!use3D) {
          const sz = getNumericValue(row, sizeDim, cycleForFrame);
          const sizeK =
            sizeDim === 'ce' || sizeDim === 'ce_cycle'
              ? 0.4
              : sizeDim === 'ice'
                ? 0.28
                : sizeDim === 'dqdv_shift'
                  ? 7
                  : sizeDim === 'retention' || sizeDim === 'retention_cycle'
                    ? 0.07
                    : 0.05;
          if (sz != null && Number.isFinite(sz)) r = baseR + Math.min(14, Math.abs(sz) * sizeK);
        } else {
          r = baseR + (nz(zv(row)) + 1) * 4;
        }
        pts.push({ x: p.x, y: p.y, r, row });
      });
    }
    for (let i = pts.length - 1; i >= 0; i--) {
      const p = pts[i];
      const d = Math.hypot(lx - p.x, ly - p.y);
      if (d <= p.r + 6) return p.row;
    }
    return null;
  };

  const onCanvasMouseMove = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const { x, y } = canvasToLocal(e.clientX, e.clientY);
    if (lassoActiveRef.current) {
      setLassoPath((prev) => (prev ? [...prev, { x, y }] : [{ x, y }]));
      return;
    }
    if (use3D && modeCount === 3 && drag3dRef.current) {
      const dx = e.clientX - drag3dRef.current.x;
      const dy = e.clientY - drag3dRef.current.y;
      drag3dRef.current = { x: e.clientX, y: e.clientY };
      setRotY((r) => r + dx * 0.01);
      setRotX((r) => Math.max(-1.2, Math.min(1.2, r + dy * 0.01)));
      return;
    }
    if (modeCount >= 2) {
      const axHit = pickAxisLabelHit(x, y, axisPickHitRef.current);
      e.currentTarget.style.cursor = axHit ? 'pointer' : 'crosshair';
    }
    const hit = pickNode(x, y);
    setHover(hit ? { idNo: hit.idNo, x: e.clientX, y: e.clientY } : null);
    masterBridge?.setHoveredIdNo(hit?.idNo ?? null, 'plot1');
  };

  const onCanvasMouseDown = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.shiftKey && (modeCount === 2 || modeCount === 3 || modeCount === 1)) {
      const { x, y } = canvasToLocal(e.clientX, e.clientY);
      lassoActiveRef.current = true;
      setLassoPath([{ x, y }]);
      return;
    }
    if (use3D && modeCount === 3 && e.button === 0) {
      drag3dRef.current = { x: e.clientX, y: e.clientY };
    }
  };

  const onCanvasMouseUp = (_e: React.MouseEvent<HTMLCanvasElement>) => {
    if (lassoActiveRef.current && lassoPath && lassoPath.length > 2 && modeCount >= 1) {
      const poly = lassoPath;
      const ids = lastLayoutRef.current
        .filter((p) => pointInPolygon(p.x, p.y, poly))
        .map((p) => p.idNo);
      const uniq = [...new Set(ids)];
      if (uniq.length) setSelectedCellIds(uniq);
    }
    lassoActiveRef.current = false;
    setLassoPath(null);
    drag3dRef.current = null;
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (e.shiftKey) return;
    const { x, y } = canvasToLocal(e.clientX, e.clientY);
    if (modeCount >= 2) {
      const ax = pickAxisLabelHit(x, y, axisPickHitRef.current);
      if (ax) {
        setAxisPickOpen(ax);
        setAxisPickPos({ x: e.clientX + 6, y: e.clientY + 6 });
        return;
      }
    }
    const hit = pickNode(x, y);
    if (hit) handleCellSelect(hit.idNo, e.nativeEvent);
  };

  const onCanvasDblClick = () => {
    clearSelection();
    setLassoPath(null);
  };

  const onCanvasWheel = (e: React.WheelEvent<HTMLCanvasElement>) => {
    if (!use3D || modeCount !== 3) return;
    e.preventDefault();
    /* zoom-like: nudge rotation */
    setRotX((r) => Math.max(-1.2, Math.min(1.2, r + e.deltaY * 0.002)));
  };

  const firstRow = plotRows[0];
  const cycleLabel =
    firstRow && cycleIndex < firstRow.cycles.length ? firstRow.cycles[cycleIndex] : '—';

  return (
    <div ref={containerRef} className="flex flex-col gap-3 min-w-0 xl:flex-1 xl:min-h-0">
      <div className="sticky top-0 z-20 flex flex-wrap items-center justify-between gap-2 py-2 px-1 -mx-1 border-b border-border bg-card/95 backdrop-blur-sm">
        <div className="flex items-center gap-2">
          <span className="text-sm font-semibold text-foreground">CellSeer</span>
          <span className="text-xs text-muted-foreground hidden sm:inline">Adaptive plot</span>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled title="Uses loaded demo / API data">
            Demo data
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled title="CSV upload not wired in this build">
            Upload CSV
          </Button>
          <Button type="button" variant="outline" size="sm" className="h-8 text-xs" disabled title="Neware ingest is backend-driven">
            Upload Neware
          </Button>
        </div>
      </div>

      <div className="rounded-lg border border-border bg-card p-3 shadow-sm flex flex-col gap-3 xl:flex-1 xl:min-h-0">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Master Plot 1 · Adaptive dimensionality</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-4xl">
            Canvas rendering for many cells. Pick up to three analysis dimensions; the layout switches between a force-style view (1D),
            scatter with marginals (2D), and size- or 3D-encoded view (3D). In 2D/3D, click the{' '}
            <span className="text-foreground">X / Y axis titles</span> on the canvas to change that axis metric. Shift-drag on the plot to
            lasso (adds to selection). Double-click background clears selection.
          </p>
        </div>

        {(onCathodeFilter || onSeparatorFilter || onSpacerFilter) && rateCells && (
          <div className="flex flex-wrap items-end gap-3">
            {onCathodeFilter && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Cathode</Label>
                <Select value={cathodeFilter} onValueChange={onCathodeFilter}>
                  <SelectTrigger className="h-8 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filterOptions.cathodes.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {onSeparatorFilter && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Separator</Label>
                <Select value={separatorFilter} onValueChange={onSeparatorFilter}>
                  <SelectTrigger className="h-8 w-[130px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filterOptions.separators.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
            {onSpacerFilter && (
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Spacer (mm)</Label>
                <Select value={spacerFilter} onValueChange={onSpacerFilter}>
                  <SelectTrigger className="h-8 w-[100px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {filterOptions.spacers.map((v) => (
                      <SelectItem key={v} value={v}>
                        {v}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            )}
          </div>
        )}

        <div className="rounded-md border border-border/80 bg-muted/20 p-3 space-y-2">
          <p className="text-xs font-medium text-foreground">Select dimensions (max 3)</p>
          {(['scalar', 'per_cycle', 'categorical'] as const).map((kind) => (
            <div key={kind} className="space-y-1">
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground">
                {kind === 'per_cycle' ? 'Per-cycle' : kind}
              </span>
              <div className="flex flex-wrap gap-1.5">
                {DIMENSION_CATALOG.filter((d) => d.kind === kind).map((d) => {
                  const on = selectedDims.includes(d.key);
                  return (
                    <button
                      key={d.key}
                      type="button"
                      disabled={!!d.stub}
                      onClick={() => toggleDim(d.key)}
                      className={`px-2 py-1 rounded-md text-xs border transition-colors ${
                        d.stub
                          ? 'opacity-40 cursor-not-allowed border-border text-muted-foreground'
                          : on
                            ? 'bg-primary text-primary-foreground border-primary'
                            : 'bg-card border-border hover:bg-secondary/80 text-foreground'
                      }`}
                      title={
                        d.stub
                          ? 'Not available in current pipeline'
                          : d.hint
                            ? `${d.label} — ${d.hint}`
                            : d.label
                      }
                    >
                      {d.label}
                      {on ? ' ✓' : ''}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
          <p className="text-xs text-muted-foreground pt-1">
            Selected: {selectedDims.map((k) => DIMENSION_CATALOG.find((d) => d.key === k)?.label ?? k).join(', ') || '—'} → Mode:{' '}
            <span className="text-foreground font-medium">{modeLabel}</span>
          </p>
        </div>

        <div className="rounded-md border border-border/80 bg-muted/10 p-3 flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-end">
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Colour</Label>
            <Select value={colourDim} onValueChange={(v) => setColourDim(v as DimKey)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAT_ENCODE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {DIMENSION_CATALOG.find((d) => d.key === k)?.label ?? k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Shape</Label>
            <Select value={shapeDim} onValueChange={(v) => setShapeDim(v as DimKey)}>
              <SelectTrigger className="h-8 w-[140px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {CAT_ENCODE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {DIMENSION_CATALOG.find((d) => d.key === k)?.label ?? k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">Size</Label>
            <Select value={sizeDim} onValueChange={(v) => setSizeDim(v as DimKey)}>
              <SelectTrigger className="h-8 w-[160px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {NUM_ENCODE_KEYS.map((k) => (
                  <SelectItem key={k} value={k}>
                    {DIMENSION_CATALOG.find((d) => d.key === k)?.label ?? k}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-1">
            <Label className="text-[10px] text-muted-foreground">C-rate filter</Label>
            <Select value={crateFilter} onValueChange={setCrateFilter}>
              <SelectTrigger className="h-8 w-[120px] text-xs">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {crateOptions.map((v) => (
                  <SelectItem key={v} value={v}>
                    {v}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {modeCount === 3 && (
            <label className="flex items-center gap-2 text-xs cursor-pointer select-none pt-1">
              <Checkbox checked={use3D} onCheckedChange={(c) => setUse3D(!!c)} id="use-3d" />
              <span className="text-muted-foreground">3D view (drag to rotate, wheel nudges tilt)</span>
            </label>
          )}
        </div>

        {loadError && <p className="text-xs text-destructive">{loadError}</p>}
        {!loadError && rowsFiltered.length === 0 && rateCells && (
          <p className="text-sm text-muted-foreground">No cells match filters.</p>
        )}

        {modeCount === 0 && <p className="text-sm text-muted-foreground">Select at least one dimension to draw the plot.</p>}

        {selectedDims.includes('dqdv_shift') && dqdvLoading && (
          <p className="text-xs text-muted-foreground">Loading dQ/dV data for dQ/dV shift…</p>
        )}
        {dqdvError && <p className="text-xs text-destructive">{dqdvError}</p>}

        {modeCount > 0 && plotRows.length > 0 && (
          <div className="flex flex-col xl:flex-1 xl:min-h-0 xl:min-w-0">
            <div className="hidden xl:block xl:flex-1 xl:min-h-0 xl:shrink-0 xl:basis-0" aria-hidden />
            <div className="relative rounded-md border border-border/60 dark:border-border overflow-hidden bg-transparent">
              <canvas
                ref={canvasRef}
                className="block w-full cursor-crosshair touch-none"
                onMouseMove={onCanvasMouseMove}
                onMouseDown={onCanvasMouseDown}
                onMouseUp={onCanvasMouseUp}
                onMouseLeave={() => {
                  setHover(null);
                  masterBridge?.clearHoverIfFrom('plot1');
                  lassoActiveRef.current = false;
                  drag3dRef.current = null;
                  const c = canvasRef.current;
                  if (c) c.style.cursor = 'crosshair';
                }}
                onClick={onCanvasClick}
                onDoubleClick={onCanvasDblClick}
                onWheel={onCanvasWheel}
              />
              {hover && (
                <div
                  className="pointer-events-none fixed z-50 rounded border border-border bg-popover text-popover-foreground shadow-md px-2 py-1.5 text-[10px] max-w-xs"
                  style={{ left: hover.x + 12, top: hover.y + 12 }}
                >
                  <div className="font-semibold">
                    #{hover.idNo} · {plotRows.find((r) => r.idNo === hover.idNo)?.cellName ?? ''}
                  </div>
                  <div className="text-muted-foreground mt-0.5 space-y-0.5">
                    {plotRows
                      .filter((r) => r.idNo === hover.idNo)
                      .slice(0, 1)
                      .map((r) => (
                        <div key={r.idNo}>
                          <div>Cathode: {r.cathode}</div>
                          <div>Electrolyte: {r.electrolyte}</div>
                          <div>Retention: {r.retentionScalar.toFixed(2)}%</div>
                          <div>Capacity: {r.capacityScalar.toFixed(1)} mAh/g</div>
                          <div>CE (proxy): {r.ceScalar.toFixed(2)}%</div>
                          <div>ICE (proxy): {r.iceScalar.toFixed(2)}%</div>
                          <div>Fade slope: {r.fadeRate.toFixed(3)}</div>
                          <div>
                            Conf: R{r.confTierRetention} · C{r.confTierCE}
                          </div>
                          <div>Protocol: {r.protocol}</div>
                        </div>
                      ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {axisPickOpen && axisPickPos && selectedDims.length >= 2 && (
          <>
            <button
              type="button"
              className="fixed inset-0 z-[80] cursor-default bg-background/40"
              aria-label="Close"
              onClick={() => {
                setAxisPickOpen(null);
                setAxisPickPos(null);
              }}
            />
            <div
              role="dialog"
              aria-modal="true"
              className="fixed z-[90] w-72 max-h-72 overflow-y-auto rounded-md border border-border bg-popover p-2 shadow-lg text-popover-foreground"
              style={{
                left: Math.max(
                  8,
                  Math.min(axisPickPos.x, (typeof window !== 'undefined' ? window.innerWidth : 1200) - 296),
                ),
                top: Math.max(
                  8,
                  Math.min(axisPickPos.y, (typeof window !== 'undefined' ? window.innerHeight : 800) - 320),
                ),
              }}
              onClick={(ev) => ev.stopPropagation()}
            >
              <p className="text-[11px] font-medium text-foreground px-1 pb-2 border-b border-border/60">
                {axisPickOpen === 'x' ? 'Horizontal axis (X)' : 'Vertical axis (Y)'}
                <span className="block text-[10px] font-normal text-muted-foreground mt-0.5">
                  Choose a dimension · picking the other axis swaps
                </span>
              </p>
              <div className="pt-2 space-y-2">
                {(['scalar', 'per_cycle', 'categorical'] as const).map((kind) => (
                  <div key={kind} className="space-y-1">
                    <span className="text-[9px] uppercase tracking-wide text-muted-foreground px-1">
                      {kind === 'per_cycle' ? 'Per-cycle' : kind}
                    </span>
                    <div className="flex flex-wrap gap-1">
                      {DIMENSION_CATALOG.filter((d) => d.kind === kind).map((d) => {
                        const cur = axisPickOpen === 'x' ? selectedDims[0] : selectedDims[1];
                        const active = d.key === cur;
                        return (
                          <button
                            key={d.key}
                            type="button"
                            disabled={!!d.stub}
                            onClick={() => applyAxisDimension(axisPickOpen, d.key)}
                            className={`px-2 py-0.5 rounded text-[10px] border transition-colors ${
                              d.stub
                                ? 'opacity-40 cursor-not-allowed border-border'
                                : active
                                  ? 'bg-primary text-primary-foreground border-primary'
                                  : 'bg-background border-border hover:bg-secondary/80'
                            }`}
                            title={d.hint ? `${d.label} — ${d.hint}` : d.label}
                          >
                            {d.label}
                          </button>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </>
        )}

        {hasPerCycleSelected && plotRows.length > 0 && (
          <div className="rounded-md border border-border bg-muted/15 p-3 space-y-2">
            <div className="flex flex-wrap items-center gap-2">
              <Button type="button" variant="outline" size="sm" onClick={() => setCycleIndex(0)}>
                <SkipBack className="w-4 h-4" />
              </Button>
              <Button type="button" variant={playing ? 'secondary' : 'default'} size="sm" onClick={() => setPlaying((p) => !p)}>
                {playing ? <Pause className="w-4 h-4" /> : <Play className="w-4 h-4" />}
                <span className="ml-1">{playing ? 'Pause' : 'Play'}</span>
              </Button>
              <Button type="button" variant="outline" size="sm" onClick={() => setCycleIndex((c) => Math.min(maxCycleIndex, c + 1))}>
                <SkipForward className="w-4 h-4" />
              </Button>
              <Slider
                value={[cycleIndex]}
                min={0}
                max={maxCycleIndex}
                step={1}
                onValueChange={([v]) => {
                  setCycleIndex(v);
                  setPlaying(false);
                }}
                className="w-full max-w-xl flex-1 min-w-[120px]"
              />
              <span className="text-xs text-muted-foreground tabular-nums whitespace-nowrap">
                Cycle idx {cycleIndex + 1}/{maxCycleIndex + 1} · instrument cycle ~ {cycleLabel}
              </span>
            </div>
            {showProtocolMarkers && refSegments && refSegments.length > 0 && (
              <div className="w-full overflow-x-auto">
                <div className="relative h-8 min-w-[280px]" style={{ width: Math.max(280, containerW - 48) }}>
                  {timelineLayouts.map((sl, si) => {
                    const hue = ((sl.cRate * 47) % 360) + 20;
                    const innerW = Math.max(200, containerW - 120);
                    return (
                      <button
                        key={`${si}-${sl.cycleStart}`}
                        type="button"
                        className="absolute top-1 h-6 rounded border border-foreground/15 text-[9px] px-1 truncate text-foreground/90 shadow-sm hover:opacity-95"
                        style={{
                          left: `${(sl.x0 / innerW) * 100}%`,
                          width: `${(sl.width / innerW) * 100}%`,
                          background: `hsl(${hue} 62% 46% / 0.42)`,
                        }}
                        title={`${sl.cRate}C · cycles ${sl.cycleStart}–${sl.cycleEnd}`}
                        onClick={() => {
                          const cycles = firstRow?.cycles ?? [];
                          const idx = cycles.findIndex((c) => c >= sl.cycleStart);
                          setCycleIndex(idx >= 0 ? idx : 0);
                          setPlaying(false);
                        }}
                      >
                        {sl.cRate}C
                      </button>
                    );
                  })}
                </div>
                <p className="text-[10px] text-muted-foreground mt-1">
                  Timeline from first filtered cell · {totalTimelineCycles} instrument cycles in segments (approx).
                </p>
              </div>
            )}
            <div className="flex flex-wrap items-center gap-4">
              <div className="space-y-1">
                <Label className="text-[10px] text-muted-foreground">Speed</Label>
                <Select value={playSpeed} onValueChange={setPlaySpeed}>
                  <SelectTrigger className="h-8 w-[88px] text-xs">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="0.5">0.5×</SelectItem>
                    <SelectItem value="1">1×</SelectItem>
                    <SelectItem value="2">2×</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox checked={showTrails} onCheckedChange={(c) => setShowTrails(!!c)} id="trails" />
                Show trails
              </label>
              <label className="flex items-center gap-2 text-xs cursor-pointer select-none">
                <Checkbox checked={showProtocolMarkers} onCheckedChange={(c) => setShowProtocolMarkers(!!c)} id="proto-mark" />
                Show protocol markers
              </label>
            </div>
          </div>
        )}

        <div className="rounded-md border border-dashed border-border bg-muted/10 px-3 py-2 text-xs text-muted-foreground">
          <span className="text-foreground font-medium">Insight: </span>
          {DIMENSION_CATALOG.find((d) => d.key === insight.topCat)?.label ?? insight.topCat} explains about{' '}
          <span className="text-foreground font-medium">{(insight.topEta * 100).toFixed(0)}%</span> of retention variance (η²).{' '}
          Auto-clusters (k-means on <span className="text-foreground font-medium">selected numeric dimensions</span>, z-scored):{' '}
          <span className="text-foreground font-medium">{insight.nClusters}</span>. Rough outliers (&gt;2.5σ):{' '}
          <span className="text-foreground font-medium">{insight.anomalies}</span>.
        </div>
      </div>
    </div>
  );
}
