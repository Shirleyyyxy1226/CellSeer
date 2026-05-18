import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRatePerformance, fetchCellRecordIndex } from '@/lib/api';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { useMasterPlotBridge } from '@/contexts/MasterPlotBridgeContext';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  type CellMetricRow,
  type DimKey,
  type IndexCellRaw,
  type RatePerfCellRaw,
  buildMetricRows,
  colourForCategory,
  getCategoricalValue,
  imputeColumnMeans,
  kmeansBestK,
} from '@/lib/masterPlot1Metrics';
import { MASTER_PLOT_CHART_HEIGHT_PX } from '@/lib/masterPlotLayout';
import {
  ADDABLE_AXES,
  type BrushState,
  type PCAxisDef,
  axisLabel,
  computeBrushPassing,
  continuousNorm,
  defaultParallelCoordAxes,
  findAddableAxis,
  getAxisNumericValue,
  getCategoricalBand,
} from '@/lib/masterPlot2PC';

function axisUsesRetentionPercentTicks(ax: PCAxisDef): boolean {
  if (ax.kind === 'per_cycle' && ax.metric === 'retention') return true;
  return ax.kind === 'continuous' && ax.scalar === 'retention_mean_main';
}

function formatNumericAxisTick(ax: PCAxisDef, v: number): string {
  if (axisUsesRetentionPercentTicks(ax)) return `${v.toFixed(1)}%`;
  return `${v.toFixed(2)}`;
}

interface RatePerfData {
  cells?: RatePerfCellRaw[];
}

interface IndexData {
  cells?: IndexCellRaw[];
}

const PC_H = MASTER_PLOT_CHART_HEIGHT_PX;
const HEADER_H = 36;
const FOOTER_H = 24;
const MARGIN_L = 8;
const MARGIN_R = 8;
/** Room past the rightmost axis for left-aligned numeric tick labels (avoids clipping). */
const RIGHT_NUM_TICK_GUTTER = 56;
/** When the panel is narrow but there are many axes, keep at least this column width and widen the canvas + scroll horizontally. */
const MIN_PC_COL_W = 50;
/** Horizontal inset so categorical band columns don’t touch neighbours. */
const CAT_STRIP_PAD = 3;

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

function jitter01(idNo: number, axisId: string): number {
  let h = idNo * 2654435761 + axisId.length * 97;
  for (let i = 0; i < axisId.length; i++) h = Math.imul(h ^ axisId.charCodeAt(i), 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000 - 0.5;
}

/** Tint categorical bands with the same palette as line encoding (meaningful per level). */
function hexToRgba(hex: string, a: number): string {
  const m = /^#?([a-f\d]{2})([a-f\d]{2})([a-f\d]{2})$/i.exec(hex.trim());
  if (!m) return `rgba(100, 116, 139, ${a})`;
  return `rgba(${parseInt(m[1], 16)}, ${parseInt(m[2], 16)}, ${parseInt(m[3], 16)}, ${a})`;
}

export interface MasterPlot2PanelProps {
  visibleCells: string[];
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
}

export default function MasterPlot2Panel({
  visibleCells,
  cathodeFilter,
  spacerFilter,
  separatorFilter,
}: MasterPlot2PanelProps) {
  const { selectedCellIds, handleCellSelect } = useCellSelection();
  const { hoveredIdNo, setHoveredIdNo, clearHoverIfFrom, setPcBrushPassingIds } = useMasterPlotBridge();
  const { dataVersion } = useDataRefresh();

  const [rateCells, setRateCells] = useState<RatePerfCellRaw[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [indexCells, setIndexCells] = useState<IndexCellRaw[]>([]);

  const [crateFilter, setCrateFilter] = useState('All');
  const [lineColour, setLineColour] = useState<'cluster' | DimKey>('cluster');
  const [axes, setAxes] = useState<PCAxisDef[]>(() => defaultParallelCoordAxes());
  const [brushes, setBrushes] = useState<BrushState>({});

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerW, setContainerW] = useState(900);

  const brushDragRef = useRef<{ axisId: string; n0: number; n1: number } | null>(null);
  const suppressClickRef = useRef(false);

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

  const indexByIdNo = useMemo(() => {
    const m = new Map<number, IndexCellRaw>();
    for (const c of indexCells) {
      if (c?.idNo != null) m.set(c.idNo, c);
    }
    return m;
  }, [indexCells]);

  const metricRowsAll = useMemo(() => {
    if (!rateCells?.length) return [];
    return buildMetricRows(rateCells, indexByIdNo);
  }, [rateCells, indexByIdNo]);

  const useVisibleCellFilter = useMemo(() => {
    if (!metricRowsAll.length || visibleCells.length === 0) return false;
    return metricRowsAll.some((c) => visibleCells.includes(c.cellId));
  }, [metricRowsAll, visibleCells]);

  const crateOptions = useMemo(() => {
    const s = new Set<string>();
    for (const r of metricRowsAll) s.add(r.cRateGroup);
    return ['All', ...Array.from(s).sort()];
  }, [metricRowsAll]);

  const plotRows = useMemo(() => {
    let out = [...metricRowsAll];
    if (useVisibleCellFilter) out = out.filter((c) => visibleCells.includes(c.cellId));
    if (cathodeFilter !== 'All') out = out.filter((c) => c.cathode === cathodeFilter);
    if (separatorFilter !== 'All') out = out.filter((c) => c.separatorType === separatorFilter);
    if (spacerFilter !== 'All') out = out.filter((c) => String(c.spacerMm ?? '') === spacerFilter);
    if (crateFilter !== 'All') out = out.filter((c) => c.cRateGroup === crateFilter);
    return out;
  }, [
    metricRowsAll,
    useVisibleCellFilter,
    visibleCells,
    cathodeFilter,
    separatorFilter,
    spacerFilter,
    crateFilter,
  ]);

  const categoricalDomains = useMemo(() => {
    const m = new Map<string, { domain: string[]; counts: Map<string, number> }>();
    for (const ax of axes) {
      if (ax.kind !== 'categorical') continue;
      const counts = new Map<string, number>();
      for (const r of plotRows) {
        const v = getCategoricalValue(r, ax.catKey);
        counts.set(v, (counts.get(v) ?? 0) + 1);
      }
      const domain = Array.from(counts.keys()).sort();
      m.set(ax.id, { domain, counts });
    }
    return m;
  }, [axes, plotRows]);

  const continuousExtents = useMemo(() => {
    const m = new Map<string, { min: number; max: number }>();
    for (const ax of axes) {
      if (ax.kind !== 'continuous' && ax.kind !== 'per_cycle') continue;
      const vals: number[] = [];
      for (const r of plotRows) {
        const v = getAxisNumericValue(r, ax);
        if (v != null && Number.isFinite(v)) vals.push(v);
      }
      if (vals.length === 0) continue;
      let min = Math.min(...vals);
      let max = Math.max(...vals);
      if (max - min < 1e-9) {
        min -= 1;
        max += 1;
      }
      m.set(ax.id, { min, max });
    }
    return m;
  }, [axes, plotRows]);

  const brushPassing = useMemo(() => {
    if (Object.keys(brushes).length === 0) return null;
    return computeBrushPassing(plotRows, axes, brushes, categoricalDomains, continuousExtents);
  }, [plotRows, axes, brushes, categoricalDomains, continuousExtents]);

  const brushKey =
    Object.keys(brushes).length === 0
      ? ''
      : brushPassing
        ? [...brushPassing].sort((a, b) => a - b).join(',')
        : 'empty';

  useEffect(() => {
    if (Object.keys(brushes).length === 0) setPcBrushPassingIds(null);
    else if (brushPassing) setPcBrushPassingIds(brushPassing);
  }, [brushKey, brushPassing, brushes, setPcBrushPassingIds]);

  useEffect(() => {
    return () => setPcBrushPassingIds(null);
  }, [setPcBrushPassingIds]);

  const clusterNumericAxes = useMemo(
    () => axes.filter((a) => a.kind === 'continuous' || a.kind === 'per_cycle'),
    [axes],
  );

  const featureVectors = useMemo(() => {
    if (clusterNumericAxes.length === 0) {
      return plotRows.map((r) => [r.retentionScalar, r.capacityScalar, r.fadeRate, r.ceScalar]);
    }
    return plotRows.map((r) =>
      clusterNumericAxes.map((ax) => {
        const v = getAxisNumericValue(r, ax);
        return v != null && Number.isFinite(v) ? v : NaN;
      }),
    );
  }, [plotRows, clusterNumericAxes]);

  const zFeatures = useMemo(
    () => zscoreRows(imputeColumnMeans(featureVectors)),
    [featureVectors],
  );
  const clusterLabels = useMemo(() => {
    const n = zFeatures.length;
    if (n < 4) return new Array(n).fill(0);
    return kmeansBestK(zFeatures, 2, 6, 42).labels;
  }, [zFeatures]);

  const lineColourDomain = useMemo(() => {
    if (lineColour === 'cluster') {
      const k = clusterLabels.length ? Math.max(...clusterLabels) + 1 : 1;
      return Array.from({ length: k }, (_, i) => `c${i}`);
    }
    const s = new Set<string>();
    for (const r of plotRows) s.add(getCategoricalValue(r, lineColour));
    return Array.from(s).sort();
  }, [plotRows, lineColour, clusterLabels]);

  const lineColourForRow = useCallback(
    (row: CellMetricRow, idx: number): string => {
      if (lineColour === 'cluster') {
        const lab = clusterLabels[idx] ?? 0;
        return colourForCategory(`c${lab}`, lineColourDomain);
      }
      return colourForCategory(getCategoricalValue(row, lineColour), lineColourDomain);
    },
    [lineColour, clusterLabels, lineColourDomain],
  );

  const { colW, plotCanvasW } = useMemo(() => {
    const n = Math.max(1, axes.length);
    const innerBudget = Math.max(80, containerW - MARGIN_L - MARGIN_R - RIGHT_NUM_TICK_GUTTER);
    const colW = Math.max(MIN_PC_COL_W, innerBudget / n);
    const contentW = MARGIN_L + n * colW + RIGHT_NUM_TICK_GUTTER + MARGIN_R;
    const plotCanvasW = Math.max(containerW, contentW);
    return { colW, plotCanvasW };
  }, [containerW, axes.length]);

  const trackTop = HEADER_H;
  const trackH = PC_H - HEADER_H - FOOTER_H;

  const getYForRow = useCallback(
    (row: CellMetricRow, ax: PCAxisDef, rowIdx: number): number | null => {
      if (ax.kind === 'categorical') {
        const meta = categoricalDomains.get(ax.id);
        if (!meta) return null;
        const band = getCategoricalBand(row, ax, meta.domain, meta.counts);
        if (!band) return null;
        const j = jitter01(row.idNo, ax.id) * 0.42 * (band.n1 - band.n0);
        const yn = Math.min(band.n1 - 0.02, Math.max(band.n0 + 0.02, band.yCenter + j));
        return trackTop + yn * trackH;
      }
      const v = getAxisNumericValue(row, ax);
      if (v == null || Number.isNaN(v)) return null;
      const ex = continuousExtents.get(ax.id);
      if (!ex) return null;
      const yn = continuousNorm(v, ex.min, ex.max);
      return trackTop + yn * trackH;
    },
    [categoricalDomains, continuousExtents, trackTop, trackH],
  );

  const getXForAxis = useCallback(
    (i: number) => MARGIN_L + i * colW + colW / 2,
    [colW],
  );

  /** Line endpoints: middle of categorical strip, axis center for numeric. */
  const getConnectorX = useCallback(
    (i: number) => {
      const ax = axes[i];
      if (ax?.kind === 'categorical') {
        const xL = MARGIN_L + i * colW + CAT_STRIP_PAD;
        const xR = MARGIN_L + (i + 1) * colW - CAT_STRIP_PAD;
        return (xL + xR) / 2;
      }
      return MARGIN_L + i * colW + colW / 2;
    },
    [axes, colW],
  );

  const axisIndexAt = useCallback(
    (lx: number): number => {
      const n = axes.length;
      if (n === 0) return -1;
      if (lx < MARGIN_L || lx >= MARGIN_L + n * colW) return -1;
      const i = Math.floor((lx - MARGIN_L) / colW);
      return i >= 0 && i < n ? i : -1;
    },
    [colW, axes.length],
  );

  const normFromMouseY = useCallback(
    (ly: number) => {
      const t = (ly - trackTop) / Math.max(1e-6, trackH);
      return Math.max(0, Math.min(1, t));
    },
    [trackTop, trackH],
  );

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    if (!canvas || !plotRows.length || !axes.length) return;
    const w = plotCanvasW;
    const h = PC_H;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, w, h);

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');

    ctx.strokeStyle = isDark ? 'rgba(248,250,252,0.25)' : 'rgba(15,23,42,0.2)';
    ctx.setLineDash([4, 4]);
    for (let i = 1; i < axes.length; i++) {
      if (axes[i].group !== axes[i - 1].group) {
        const x = MARGIN_L + i * colW;
        ctx.beginPath();
        ctx.moveTo(x, trackTop - 4);
        ctx.lineTo(x, trackTop + trackH + 4);
        ctx.stroke();
      }
    }
    ctx.setLineDash([]);

    const fg = isDark ? '#e2e8f0' : '#0f172a';
    const muted = isDark ? 'rgba(148,163,184,0.78)' : 'rgba(71,85,105,0.88)';
    const brushFill = isDark ? 'rgba(249,115,22,0.35)' : 'rgba(234,88,12,0.28)';

    /* Categorical columns: stacked bands (height ∝ count), labels inside. */
    for (let i = 0; i < axes.length; i++) {
      const ax = axes[i];
      if (ax.kind !== 'categorical') continue;
      const meta = categoricalDomains.get(ax.id);
      if (!meta?.domain.length) continue;
      const xL = MARGIN_L + i * colW + CAT_STRIP_PAD;
      const xR = MARGIN_L + (i + 1) * colW - CAT_STRIP_PAD;
      const wStrip = Math.max(8, xR - xL);
      const total = meta.domain.reduce((s, d) => s + (meta.counts.get(d) ?? 0), 0) || 1;
      let acc = 0;
      for (const d of meta.domain) {
        const frac = (meta.counts.get(d) ?? 0) / total;
        const n0 = acc;
        const n1 = acc + frac;
        const y0 = trackTop + n0 * trackH;
        const y1 = trackTop + n1 * trackH;
        const hBand = Math.max(1, y1 - y0);
        const levelCol = colourForCategory(d, meta.domain);
        ctx.fillStyle = hexToRgba(levelCol, isDark ? 0.32 : 0.26);
        ctx.fillRect(xL, y0, wStrip, hBand);
        ctx.strokeStyle = isDark ? 'rgba(248,250,252,0.42)' : 'rgba(15,23,42,0.28)';
        ctx.lineWidth = 1.35;
        ctx.strokeRect(xL + 0.5, y0 + 0.5, wStrip - 1, hBand - 1);
        const cx = (xL + xR) / 2;
        const cy = (y0 + y1) / 2;
        const cnt = meta.counts.get(d) ?? 0;
        const shortLab = d.length > 14 ? `${d.slice(0, 12)}…` : d;
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        if (hBand >= 26) {
          ctx.fillStyle = fg;
          ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(shortLab, cx, cy - 6);
          ctx.fillStyle = muted;
          ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(`${cnt} cells`, cx, cy + 7);
        } else if (hBand >= 14) {
          ctx.fillStyle = fg;
          ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(shortLab, cx, cy);
        }
        acc = n1;
      }
      ctx.strokeStyle = isDark ? 'rgba(248,250,252,0.38)' : 'rgba(15,23,42,0.3)';
      ctx.lineWidth = 1.35;
      ctx.beginPath();
      ctx.moveTo(xL, trackTop);
      ctx.lineTo(xL, trackTop + trackH);
      ctx.moveTo(xR, trackTop);
      ctx.lineTo(xR, trackTop + trackH);
      ctx.stroke();
    }

    for (let i = 0; i < axes.length; i++) {
      const ax = axes[i];
      const x = getXForAxis(i);
      if (ax.kind === 'continuous' || ax.kind === 'per_cycle') {
        ctx.strokeStyle = muted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, trackTop);
        ctx.lineTo(x, trackTop + trackH);
        ctx.stroke();
      }

      const br = brushes[axes[i].id];
      if (br) {
        const lo = Math.min(br.n0, br.n1) * trackH;
        const hi = Math.max(br.n0, br.n1) * trackH;
        ctx.fillStyle = brushFill;
        if (ax.kind === 'categorical') {
          const xL = MARGIN_L + i * colW + CAT_STRIP_PAD;
          const xR = MARGIN_L + (i + 1) * colW - CAT_STRIP_PAD;
          ctx.fillRect(xL, trackTop + lo, xR - xL, hi - lo);
        } else {
          ctx.fillRect(x - 5, trackTop + lo, 10, hi - lo);
        }
      }
    }

    for (let i = 0; i < axes.length; i++) {
      const ax = axes[i];
      const x = getXForAxis(i);
      ctx.fillStyle = fg;
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      const tier = ax.confKind === 'retention' ? 1 : ax.confKind === 'ce' ? 2 : 3;
      const dot = tier === 1 ? '●' : tier === 2 ? '◐' : '○';
      const title = ax.kind === 'categorical' ? axisLabel(ax) : `${dot} ${axisLabel(ax)}`;
      ctx.fillText(title, x, HEADER_H - 2);

      if (ax.kind === 'continuous' || ax.kind === 'per_cycle') {
        const ex = continuousExtents.get(ax.id);
        if (ex) {
          const span = ex.max - ex.min;
          const nTicks = span < 1e-9 ? 1 : trackH >= 360 ? 7 : 5;
          ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = muted;
          /** All tick marks & labels on the right of the axis (one consistent side). */
          const tickLen = 5;
          const labelGap = 4;
          let prevPrinted = '';
          for (let ti = 0; ti < nTicks; ti++) {
            const t = nTicks === 1 ? 0 : ti / (nTicks - 1);
            const v = ex.max - t * span;
            const y = trackTop + t * trackH;
            const lab = formatNumericAxisTick(ax, v);
            if (lab === prevPrinted) continue;
            prevPrinted = lab;
            ctx.strokeStyle = muted;
            ctx.globalAlpha = 0.75;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(x + tickLen, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.textAlign = 'left';
            const lx = x + tickLen + labelGap;
            if (ti === 0) {
              ctx.textBaseline = 'top';
              ctx.fillText(lab, lx, y + 1);
            } else if (ti === nTicks - 1) {
              ctx.textBaseline = 'bottom';
              ctx.fillText(lab, lx, y - 1);
            } else {
              ctx.textBaseline = 'middle';
              ctx.fillText(lab, lx, y);
            }
          }
        }
      }
    }

    const passing = brushPassing;
    const dimOthers = passing != null && Object.keys(brushes).length > 0;

    const drawSegmentsForRow = (row: CellMetricRow, idx: number, alpha: number, lw: number) => {
      const col = lineColourForRow(row, idx);
      ctx.strokeStyle = col;
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let i = 0; i < axes.length - 1; i++) {
        const y0 = getYForRow(row, axes[i], idx);
        const y1 = getYForRow(row, axes[i + 1], idx);
        if (y0 == null || y1 == null) continue;
        const x0 = getConnectorX(i);
        const x1 = getConnectorX(i + 1);
        ctx.beginPath();
        ctx.moveTo(x0, y0);
        ctx.lineTo(x1, y1);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    for (let idx = 0; idx < plotRows.length; idx++) {
      const row = plotRows[idx];
      const pass = !dimOthers || passing?.has(row.idNo);
      const a = pass ? 0.72 : 0.06;
      const lw = 1.15;
      drawSegmentsForRow(row, idx, a, lw);
    }

    const hiId = hoveredIdNo;
    const selSet = new Set(selectedCellIds);
    for (let idx = 0; idx < plotRows.length; idx++) {
      const row = plotRows[idx];
      if (row.idNo !== hiId && !selSet.has(row.idNo)) continue;
      const pass = !dimOthers || passing?.has(row.idNo);
      const a = pass ? 1 : 0.2;
      const lw = selSet.has(row.idNo) ? 2.75 : 2.2;
      drawSegmentsForRow(row, idx, a, lw);
    }
  }, [
    plotRows,
    axes,
    plotCanvasW,
    brushes,
    brushPassing,
    clusterLabels,
    continuousExtents,
    categoricalDomains,
    getXForAxis,
    getConnectorX,
    getYForRow,
    hoveredIdNo,
    lineColourForRow,
    selectedCellIds,
    trackH,
    trackTop,
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

  const pickRowAt = useCallback(
    (lx: number, ly: number): CellMetricRow | null => {
      const threshold = 14;
      let best: { row: CellMetricRow; idx: number; d: number } | null = null;
      for (let idx = 0; idx < plotRows.length; idx++) {
        const row = plotRows[idx];
        for (let i = 0; i < axes.length - 1; i++) {
          const y0 = getYForRow(row, axes[i], idx);
          const y1 = getYForRow(row, axes[i + 1], idx);
          if (y0 == null || y1 == null) continue;
          const x0 = getConnectorX(i);
          const x1 = getConnectorX(i + 1);
          const d = distToSegment(lx, ly, x0, y0, x1, y1);
          if (d < threshold && (!best || d < best.d)) best = { row, idx, d };
        }
      }
      return best?.row ?? null;
    },
    [plotRows, axes, getConnectorX, getYForRow],
  );

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    const drag = brushDragRef.current;
    if (drag) {
      const n = normFromMouseY(ly);
      drag.n1 = n;
      setBrushes((b) => ({ ...b, [drag.axisId]: { n0: drag.n0, n1: n } }));
      return;
    }
    const hit = pickRowAt(lx, ly);
    setHoveredIdNo(hit?.idNo ?? null, 'plot2');
  };

  const onCanvasPointerDown = (e: React.PointerEvent<HTMLCanvasElement>) => {
    if (!e.shiftKey) return;
    const rect = e.currentTarget.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    const ai = axisIndexAt(lx);
    if (ai < 0) return;
    if (ly < trackTop || ly > trackTop + trackH) return;
    const ax = axes[ai];
    const n = normFromMouseY(ly);
    brushDragRef.current = { axisId: ax.id, n0: n, n1: n };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onCanvasPointerUp = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const drag = brushDragRef.current;
    brushDragRef.current = null;
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      /* noop */
    }
    if (!drag) return;
    const lo = Math.min(drag.n0, drag.n1);
    const hi = Math.max(drag.n0, drag.n1);
    if (hi - lo < 0.02) {
      setBrushes((b) => {
        const { [drag.axisId]: _, ...rest } = b;
        return rest;
      });
      return;
    }
    suppressClickRef.current = true;
    setBrushes((b) => ({ ...b, [drag.axisId]: { n0: lo, n1: hi } }));
  };

  const onCanvasDblClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ai = axisIndexAt(lx);
    if (ai < 0) return;
    const id = axes[ai].id;
    setBrushes((b) => {
      const { [id]: _, ...rest } = b;
      return rest;
    });
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    if (suppressClickRef.current) {
      suppressClickRef.current = false;
      return;
    }
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = pickRowAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) handleCellSelect(hit.idNo, e.nativeEvent);
  };

  const clearAllBrushes = () => setBrushes({});

  const removeAxis = (id: string) => {
    setAxes((ax) => ax.filter((a) => a.id !== id));
    setBrushes((b) => {
      const { [id]: _, ...rest } = b;
      return rest;
    });
  };

  const addAxis = (id: string) => {
    const def = findAddableAxis(id);
    if (!def || axes.some((a) => a.id === def.id)) return;
    setAxes((ax) => [...ax, def]);
  };

  const onChipDragStart = (e: React.DragEvent, index: number) => {
    e.dataTransfer.setData('text/mp2-axis', String(index));
    e.dataTransfer.effectAllowed = 'move';
  };

  const onChipDrop = (e: React.DragEvent, targetIndex: number) => {
    e.preventDefault();
    const from = Number(e.dataTransfer.getData('text/mp2-axis'));
    if (Number.isNaN(from) || from === targetIndex) return;
    setAxes((ax) => {
      const n = [...ax];
      const [item] = n.splice(from, 1);
      n.splice(targetIndex, 0, item);
      return n;
    });
  };

  const brushSummaryText = useMemo(() => {
    const parts: string[] = [];
    for (const id of Object.keys(brushes)) {
      const ax = axes.find((a) => a.id === id);
      if (!ax) continue;
      const br = brushes[id];
      const lo = Math.min(br.n0, br.n1);
      const hi = Math.max(br.n0, br.n1);
      if (ax.kind === 'continuous' || ax.kind === 'per_cycle') {
        const ex = continuousExtents.get(id);
        if (!ex) continue;
        const vmin = ex.min;
        const vmax = ex.max;
        const span = vmax - vmin;
        const vHi = vmax - lo * span;
        const vLo = vmax - hi * span;
        const fmt = (v: number) => (axisUsesRetentionPercentTicks(ax) ? `${v.toFixed(1)}%` : v.toFixed(2));
        parts.push(`${axisLabel(ax)}: ${fmt(vLo)}–${fmt(vHi)}`);
      } else {
        parts.push(`${axisLabel(ax)}: band`);
      }
    }
    return parts;
  }, [brushes, axes, continuousExtents]);

  const filteredRows = useMemo(() => {
    if (!brushPassing || Object.keys(brushes).length === 0) return plotRows;
    return plotRows.filter((r) => brushPassing.has(r.idNo));
  }, [plotRows, brushPassing, brushes]);

  const commonTraits = useMemo(() => {
    if (filteredRows.length === 0) return '—';
    const cath = new Map<string, number>();
    for (const r of filteredRows) cath.set(r.cathode, (cath.get(r.cathode) ?? 0) + 1);
    const top = [...cath.entries()].sort((a, b) => b[1] - a[1])[0];
    const pct = top ? Math.round((top[1] / filteredRows.length) * 100) : 0;
    const ret = filteredRows.map((r) => r.retentionScalar);
    const rmin = Math.min(...ret);
    const rmax = Math.max(...ret);
    return `${pct}% ${top?.[0] ?? '—'} · retention ${rmin.toFixed(0)}–${rmax.toFixed(0)}%`;
  }, [filteredRows]);

  const addableOptions = useMemo(
    () => ADDABLE_AXES.filter((a) => !axes.some((x) => x.id === a.id)),
    [axes],
  );

  return (
    <div ref={containerRef} className="flex flex-col gap-3 min-w-0 xl:flex-1 xl:min-h-0">
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm flex flex-col gap-3 xl:flex-1 xl:min-h-0">
        <div>
          <h2 className="text-sm font-semibold text-foreground">Master Plot 2 · Parallel coordinates</h2>
          <p className="text-xs text-muted-foreground mt-1 max-w-3xl leading-relaxed">
            Categorical axes use band height ∝ count and <span className="text-foreground">the same colours as category levels</span> (e.g. each
            cathode keeps a consistent hue). <span className="text-foreground">Ret̄ (main)</span> and{' '}
            <span className="text-foreground">CĒ (main)</span> are each cell&apos;s mean over its longest cycling segment — comparable across
            protocols. <span className="text-foreground">Auto cluster</span> colours lines by k-means on the{' '}
            <span className="text-foreground">current numeric / per-cycle axes</span> (z-scored; missing values column-imputed).{' '}
            <span className="text-foreground">Shift</span>-drag to brush; double-click an axis to clear. Linked to Master Plot 1. On numeric axes, ● ◐
            ○ = confidence tier.
          </p>
        </div>

        <div className="rounded-md border border-border/80 bg-muted/15 px-3 py-2.5">
          <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
            <div className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">Line colour</Label>
              <Select value={lineColour} onValueChange={(v) => setLineColour(v as 'cluster' | DimKey)}>
                <SelectTrigger className="h-8 w-[130px] text-xs">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="cluster">Auto cluster</SelectItem>
                  <SelectItem value="cathode">Cathode</SelectItem>
                  <SelectItem value="separator">Separator</SelectItem>
                  <SelectItem value="spacer">Spacer</SelectItem>
                  <SelectItem value="electrolyte">Electrolyte</SelectItem>
                  <SelectItem value="protocol">Protocol</SelectItem>
                  <SelectItem value="c_rate_group">C-rate group</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-0.5">
              <Label className="text-[10px] text-muted-foreground">C-rate</Label>
              <Select value={crateFilter} onValueChange={setCrateFilter}>
                <SelectTrigger className="h-8 w-[88px] text-xs">
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
          </div>

          <details className="mt-2.5 text-[10px] border-t border-border/50 pt-2">
            <summary className="cursor-pointer text-muted-foreground hover:text-foreground select-none">
              Axis order &amp; add
            </summary>
            <div className="flex flex-wrap gap-1.5 mt-2">
              {axes.map((ax, i) => (
                <button
                  key={ax.id}
                  type="button"
                  draggable
                  onDragStart={(e) => onChipDragStart(e, i)}
                  onDragOver={(e) => e.preventDefault()}
                  onDrop={(e) => onChipDrop(e, i)}
                  className="inline-flex items-center gap-0.5 pl-1.5 pr-0.5 py-0.5 rounded border border-border/80 bg-background/80 text-[10px] cursor-grab active:cursor-grabbing"
                >
                  <span className="truncate max-w-[6.5rem]">{axisLabel(ax)}</span>
                  <span
                    role="button"
                    tabIndex={0}
                    className="text-muted-foreground hover:text-foreground px-0.5"
                    onClick={(ev) => {
                      ev.stopPropagation();
                      removeAxis(ax.id);
                    }}
                    onKeyDown={(ev) => {
                      if (ev.key === 'Enter' || ev.key === ' ') {
                        ev.preventDefault();
                        removeAxis(ax.id);
                      }
                    }}
                  >
                    ×
                  </span>
                </button>
              ))}
              {addableOptions.length > 0 && (
                <Select onValueChange={addAxis}>
                  <SelectTrigger className="h-6 w-[108px] text-[10px]">
                    <SelectValue placeholder="+ Axis" />
                  </SelectTrigger>
                  <SelectContent>
                    {addableOptions.map((a) => (
                      <SelectItem key={a.id} value={a.id}>
                        {axisLabel(a)}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              )}
            </div>
          </details>
        </div>

        {loadError && <p className="text-xs text-destructive">{loadError}</p>}

        {plotRows.length > 0 && (
          <div className="flex flex-col xl:flex-1 xl:min-h-0 xl:min-w-0">
            <div className="hidden xl:block xl:flex-1 xl:min-h-0 xl:shrink-0 xl:basis-0" aria-hidden />
            <div className="rounded-md border border-border/60 overflow-x-auto overflow-y-hidden bg-transparent">
              <canvas
                ref={canvasRef}
                className="block max-w-none touch-none cursor-default shrink-0"
                onPointerMove={onCanvasPointerMove}
                onPointerDown={onCanvasPointerDown}
                onPointerUp={onCanvasPointerUp}
                onPointerLeave={() => {
                  brushDragRef.current = null;
                  clearHoverIfFrom('plot2');
                }}
                onClick={onCanvasClick}
                onDoubleClick={onCanvasDblClick}
              />
            </div>
          </div>
        )}

        <div className="rounded-md border border-border/80 bg-muted/15 px-3 py-2 text-xs space-y-1">
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-muted-foreground">
              <span className="text-foreground font-medium tabular-nums">{filteredRows.length}</span> /{' '}
              <span className="tabular-nums">{plotRows.length}</span> cells
            </span>
            {Object.keys(brushes).length > 0 && (
              <button
                type="button"
                className="text-[10px] text-primary hover:underline"
                onClick={clearAllBrushes}
              >
                Clear all brushes
              </button>
            )}
          </div>
          {brushSummaryText.length > 0 && (
            <p className="text-[10px] text-muted-foreground">Active filters: {brushSummaryText.join(' · ')}</p>
          )}
          <p className="text-[10px] text-muted-foreground">Common traits: {commonTraits}</p>
        </div>

        <details className="rounded-md border border-border/60 bg-card/40 text-sm">
          <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-foreground">
            Cell list ({filteredRows.length})
          </summary>
          <div className="px-3 pb-3 pt-0 text-[10px] text-muted-foreground max-h-40 overflow-y-auto font-mono">
            {filteredRows.map((r) => r.cellName || r.cellId).join(', ') || '—'}
          </div>
        </details>
      </div>
    </div>
  );
}

function distToSegment(px: number, py: number, x0: number, y0: number, x1: number, y1: number): number {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const len2 = dx * dx + dy * dy;
  if (len2 < 1e-12) return Math.hypot(px - x0, py - y0);
  let t = ((px - x0) * dx + (py - y0) * dy) / len2;
  t = Math.max(0, Math.min(1, t));
  const qx = x0 + t * dx;
  const qy = y0 + t * dy;
  return Math.hypot(px - qx, py - qy);
}
