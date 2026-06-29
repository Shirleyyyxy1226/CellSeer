import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useCellRecordIndexQuery, useRatePerformanceQuery } from '@/hooks/useCellData';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useMasterPlotBridge } from '@/contexts/MasterPlotBridgeContext';
import { HelpCircle, Info } from 'lucide-react';
import { Label } from '@/components/ui/label';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { SearchInput } from '@/components/SearchInput';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip';
import {
  type CellMetricRow,
  type DimKey,
  type IndexCell,
  buildMetricRows,
  colourForCategory,
  getCategoricalValue,
} from '@/lib/cell/cellMetricRows';
import type { RateScope } from '@/lib/api';
import { MASTER_PLOT_CHART_HEIGHT_PX } from '@/lib/plot/masterPlotLayout';
import {
  ADDABLE_AXES,
  type PCAxisDef,
  axisDescription,
  axisLabel,
  continuousNorm,
  defaultParallelCoordAxes,
  findAddableAxis,
  getAxisNumericValue,
  getCategoricalBand,
} from '@/lib/plot/parallelCoordsConfig';

function axisUsesPercentTicks(ax: PCAxisDef): boolean {
  if (ax.kind === 'per_cycle') return ax.metric === 'ce';
  if (ax.kind !== 'continuous') return false;
  return ax.scalar === 'ice';
}

function axisIsCapacity(ax: PCAxisDef): boolean {
  if (ax.kind === 'per_cycle') return ax.metric === 'capacity';
  return ax.kind === 'continuous' && (ax.scalar === 'capacity_peak' || ax.scalar === 'capacity_end');
}

function axisIsCount(ax: PCAxisDef): boolean {
  return ax.kind === 'continuous' && ax.scalar === 'cycle_count';
}

/** SI-style abbreviation for large signed magnitudes (e.g. 14762 → 15k, -52107 → -52k). */
function abbreviateSigned(v: number): string {
  const a = Math.abs(v);
  if (a >= 1e6) return `${(v / 1e6).toFixed(a >= 1e7 ? 0 : 1)}M`;
  if (a >= 1e3) return `${(v / 1e3).toFixed(a >= 1e4 ? 0 : 1)}k`;
  if (a >= 10) return `${Math.round(v)}`;
  return `${v.toFixed(1)}`;
}

function formatNumericAxisTick(ax: PCAxisDef, v: number): string {
  if (axisUsesPercentTicks(ax)) return `${v.toFixed(1)}%`;
  if (axisIsCount(ax)) return `${Math.round(v)}`;
  if (Math.abs(v) >= 1000) return abbreviateSigned(v);
  return `${v.toFixed(2)}`;
}

/** Unit suffix shown in the axis header (capacity basis resolved by caller). */
function axisUnitSuffix(ax: PCAxisDef, capacityBasis: string): string {
  if (axisIsCapacity(ax)) return ` (${capacityBasis})`;
  if (axisUsesPercentTicks(ax)) return ' (%)';
  if (axisIsCount(ax)) return ' (n)';
  return '';
}

/** Floor for the auto-sized plot height so it never collapses in a short panel. */
const MIN_PC_H = 280;
/** Two-line header: bold title row (with an inline remove handle to its right) and a
 *  lighter secondary (units / clamp) row beneath it. */
const HEADER_H = 44;
const FOOTER_H = 24;
/** Breathing room inside the plot frame so the outermost axis labels/ticks aren’t clipped. */
const MARGIN_L = 20;
const MARGIN_R = 20;
/** Small trailing gutter only — the rightmost axis now draws its tick labels to
 * its LEFT (inside the plot), so we no longer reserve a wide right margin and the
 * final axis sits near the right edge. */
const RIGHT_NUM_TICK_GUTTER = 12;
/** Horizontal inset so categorical band columns don’t touch neighbours. */
const CAT_STRIP_PAD = 3;

let _headerMeasureCtx: CanvasRenderingContext2D | null = null;
/** Width (CSS px) of an axis title in the canvas header font, so the remove (×)
 *  handle can sit just to the right of each centred, canvas-drawn title. */
function measureHeaderLabelW(text: string): number {
  if (typeof document === 'undefined') return text.length * 6.2;
  if (!_headerMeasureCtx) _headerMeasureCtx = document.createElement('canvas').getContext('2d');
  if (!_headerMeasureCtx) return text.length * 6.2;
  _headerMeasureCtx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
  return _headerMeasureCtx.measureText(text).width;
}

function jitter01(idNo: number, axisId: string): number {
  let h = idNo * 2654435761 + axisId.length * 97;
  for (let i = 0; i < axisId.length; i++) h = Math.imul(h ^ axisId.charCodeAt(i), 2246822519);
  h ^= h >>> 13;
  return ((h >>> 0) % 10000) / 10000 - 0.5;
}

/**
 * Stroke a row's polyline through its axis crossings. In a parallel-coordinates
 * plot only the axis crossings and the *straight* inter-axis slope carry meaning
 * (slope = magnitude of change; segments crossing between two axes = anti-
 * correlation). Segments are therefore straight lines — a curve would hide the
 * slope and invent intermediate values the cell never had. `pts` skips null
 * crossings, breaking the path so a cell missing one axis draws no phantom segment.
 */
function strokePolyline(ctx: CanvasRenderingContext2D, pts: ({ x: number; y: number } | null)[]): void {
  let prev: { x: number; y: number } | null = null;
  let drew = false;
  ctx.beginPath();
  for (const p of pts) {
    if (!p) {
      prev = null;
      continue;
    }
    if (!prev) {
      ctx.moveTo(p.x, p.y);
    } else {
      ctx.lineTo(p.x, p.y);
      drew = true;
    }
    prev = p;
  }
  if (drew) ctx.stroke();
}

/** Hover info card for an axis head — mirrors the GCD tooltip (Info icon + concise
 *  one-line definition). Renders nothing for axes without a description. */
function AxisInfoTooltip({ ax }: { ax: PCAxisDef }) {
  const desc = axisDescription(ax);
  if (!desc) return null;
  return (
    <TooltipProvider delayDuration={150}>
      <Tooltip>
        <TooltipTrigger asChild>
          <span
            onClick={(ev) => ev.stopPropagation()}
            aria-label={`About ${axisLabel(ax)}`}
            className="flex h-4 w-4 cursor-help items-center justify-center text-muted-foreground hover:text-foreground"
          >
            <Info className="h-3.5 w-3.5" />
          </span>
        </TooltipTrigger>
        <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
          {desc}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  );
}

export interface MasterPlot2PanelProps {
  visibleCells: string[];
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
  /** Page-wide categorical filters owned by the overview dashboard. */
  electrolyteFilter: string;
  protocolFilter: string;
  /** Cohort scope for the rate-performance fetch — set by the
   * overview orchestrator on the large-project path so parcoords pulls only the
   * drawn cohort and shares the trajectories/inspector fetch. */
  rateScope?: RateScope;
  /** Open the shared Inspector for a cell — wired to the same sidebar the other
   * overview tabs use, so clicking a line behaves consistently. */
  onInspect?: (cellId: string) => void;
}

export default function MasterPlot2Panel({
  visibleCells,
  cathodeFilter,
  spacerFilter,
  separatorFilter,
  electrolyteFilter,
  protocolFilter,
  rateScope,
  onInspect,
}: MasterPlot2PanelProps) {
  const { selectedCellIds, handleCellSelect, addToSelection, removeFromSelection, clearSelection } =
    useCellSelection();
  const { hoveredIdNo, setHoveredIdNo, clearHoverIfFrom } = useMasterPlotBridge();

  const rateQuery = useRatePerformanceQuery({ scope: rateScope });
  const indexQuery = useCellRecordIndexQuery();
  const rateCells = rateQuery.data?.cells?.length ? rateQuery.data.cells : null;
  const rateLoading = rateQuery.isLoading;
  const loadError = rateQuery.isError
    ? 'Failed to load rate-performance data.'
    : rateQuery.data && !rateQuery.data.cells?.length
      ? 'No rate-performance data.'
      : null;

  const [lineColour, setLineColour] = useState<DimKey>('cathode');
  const [cellSearch, setCellSearch] = useState('');
  // Legend isolate (findings 2 & 3): click a legend entry to focus one group so
  // a dominant category (e.g. 141 lines) can't bury the 12-line ones. null = all.
  const [isolatedKey, setIsolatedKey] = useState<string | null>(null);
  const [axes, setAxes] = useState<PCAxisDef[]>(() => defaultParallelCoordAxes());

  const containerRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [containerW, setContainerW] = useState(900);
  // Actual inner width available to the plot (the scroll box, inside the card's
  // padding/borders) — drives a no-scroll layout that always fits the panel.
  const [plotBoxW, setPlotBoxW] = useState(0);
  // Measured height of the plot box too, so the canvas fills the panel and the
  // view never scrolls.
  const [plotBoxH, setPlotBoxH] = useState(0);
  const plotBoxRoRef = useRef<ResizeObserver | null>(null);
  const plotBoxRef = useCallback((node: HTMLDivElement | null) => {
    plotBoxRoRef.current?.disconnect();
    plotBoxRoRef.current = null;
    if (!node) return;
    const measure = () => {
      setPlotBoxW(node.clientWidth);
      setPlotBoxH(node.clientHeight);
    };
    const ro = new ResizeObserver(measure);
    ro.observe(node);
    plotBoxRoRef.current = ro;
    measure();
  }, []);

  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const ro = new ResizeObserver(() => setContainerW(Math.max(320, el.clientWidth)));
    ro.observe(el);
    setContainerW(Math.max(320, el.clientWidth));
    return () => ro.disconnect();
  }, []);

  const indexByIdNo = useMemo(() => {
    const m = new Map<number, IndexCell>();
    for (const c of indexQuery.data?.cells ?? []) {
      if (c?.idNo != null) m.set(c.idNo, c);
    }
    return m;
  }, [indexQuery.data]);

  const metricRowsAll = useMemo(() => {
    if (!rateCells?.length) return [];
    return buildMetricRows(rateCells, indexByIdNo);
  }, [rateCells, indexByIdNo]);

  // Set lookups — Array.includes here is O(cells × visible) ≈ 25M ops at 5k cells.
  const visibleCellSet = useMemo(() => new Set(visibleCells), [visibleCells]);
  const useVisibleCellFilter = useMemo(() => {
    if (!metricRowsAll.length || visibleCellSet.size === 0) return false;
    return metricRowsAll.some((c) => visibleCellSet.has(c.cellId));
  }, [metricRowsAll, visibleCellSet]);

  const plotRows = useMemo(() => {
    let out = metricRowsAll;
    if (useVisibleCellFilter) out = out.filter((c) => visibleCellSet.has(c.cellId));
    if (cathodeFilter !== 'All') out = out.filter((c) => c.cathode === cathodeFilter);
    if (separatorFilter !== 'All') out = out.filter((c) => c.separatorType === separatorFilter);
    if (spacerFilter !== 'All') out = out.filter((c) => String(c.spacerMm ?? '') === spacerFilter);
    if (protocolFilter !== 'All') out = out.filter((c) => c.protocol === protocolFilter);
    if (electrolyteFilter !== 'All') out = out.filter((c) => c.electrolyte === electrolyteFilter);
    return out;
  }, [
    metricRowsAll,
    useVisibleCellFilter,
    visibleCellSet,
    cathodeFilter,
    separatorFilter,
    spacerFilter,
    protocolFilter,
    electrolyteFilter,
  ]);

  // Cell tracing: search options + id↔label maps for the picker and the tray.
  const cellSearchOptions = useMemo(
    () =>
      plotRows
        .map((r) => ({ idNo: r.idNo, label: r.cellName || r.cellId }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    [plotRows],
  );
  const labelByIdNo = useMemo(() => {
    const m = new Map<number, string>();
    for (const r of plotRows) m.set(r.idNo, r.cellName || r.cellId);
    return m;
  }, [plotRows]);
  const idNoByLabel = useMemo(() => {
    const m = new Map<string, number>();
    for (const o of cellSearchOptions) m.set(o.label, o.idNo);
    return m;
  }, [cellSearchOptions]);

  const onCellSearchChange = useCallback(
    (v: string) => {
      setCellSearch(v);
      const id = idNoByLabel.get(v.trim());
      if (id != null) {
        addToSelection(id);
        setHoveredIdNo(id, 'plot2');
        setCellSearch('');
      }
    },
    [idNoByLabel, addToSelection, setHoveredIdNo],
  );

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

  // Robust continuous domains: a single runaway outlier on e.g. the
  // retention/fade axis used to stretch the domain to 0–260336%, crushing every
  // real line onto the baseline. Clamp the *axis domain* to a robust percentile
  // window (p1–p99) so the scale carries information for the bulk of cells; cells
  // outside the window are clipped to the ends and counted as overflow for the
  // subtitle. This is purely a display transform — getAxisNumericValue sees the
  // real values; only the normalisation window is clamped.
  const continuousExtents = useMemo(() => {
    const m = new Map<string, { min: number; max: number; nLow: number; nHigh: number; rawMin: number; rawMax: number }>();
    const percentile = (sorted: number[], q: number) => {
      if (sorted.length === 1) return sorted[0];
      const idx = (sorted.length - 1) * q;
      const lo = Math.floor(idx);
      const hi = Math.ceil(idx);
      if (lo === hi) return sorted[lo];
      return sorted[lo] + (sorted[hi] - sorted[lo]) * (idx - lo);
    };
    for (const ax of axes) {
      if (ax.kind !== 'continuous' && ax.kind !== 'per_cycle') continue;
      const vals: number[] = [];
      for (const r of plotRows) {
        const v = getAxisNumericValue(r, ax);
        if (v != null && Number.isFinite(v)) vals.push(v);
      }
      if (vals.length === 0) continue;
      vals.sort((a, b) => a - b);
      const rawMin = vals[0];
      const rawMax = vals[vals.length - 1];
      // Robust window. Below ~12 points percentiles are unstable, so fall back
      // to the true extent (no clamping) to avoid hiding a small real spread.
      let min = rawMin;
      let max = rawMax;
      if (vals.length >= 12) {
        min = percentile(vals, 0.01);
        max = percentile(vals, 0.99);
      }
      // Only keep the clamp if it materially tightens the range (otherwise the
      // outlier label would be noise). "Material" = the raw extent is >25% wider.
      const robustSpan = Math.max(1e-9, max - min);
      const rawSpan = Math.max(1e-9, rawMax - rawMin);
      const clampHelps = rawSpan > robustSpan * 1.25;
      if (!clampHelps) {
        min = rawMin;
        max = rawMax;
      }
      if (max - min < 1e-9) {
        min -= 1;
        max += 1;
      }
      let nLow = 0;
      let nHigh = 0;
      if (clampHelps) {
        for (const v of vals) {
          if (v < min) nLow++;
          else if (v > max) nHigh++;
        }
      }
      m.set(ax.id, { min, max, nLow, nHigh, rawMin, rawMax });
    }
    return m;
  }, [axes, plotRows]);

  const lineColourDomain = useMemo(() => {
    const s = new Set<string>();
    for (const r of plotRows) s.add(getCategoricalValue(r, lineColour));
    return Array.from(s).sort();
  }, [plotRows, lineColour]);

  const lineColourForRow = useCallback(
    (row: CellMetricRow, _idx: number): string =>
      colourForCategory(getCategoricalValue(row, lineColour), lineColourDomain),
    [lineColour, lineColourDomain],
  );

  /** Legend-group key for a row under the active encoding (matches legend `key`). */
  const colourKeyForRow = useCallback(
    (row: CellMetricRow, _idx: number): string => getCategoricalValue(row, lineColour),
    [lineColour],
  );

  // The isolate target only makes sense for the current encoding; drop it when
  // the user switches the colour dimension.
  useEffect(() => {
    setIsolatedKey(null);
  }, [lineColour]);

  /** Legend entries (swatch + label + n-count) for the active line-colour encoding. */
  const legendEntries = useMemo<{ key: string; label: string; colour: string; n: number }[]>(() => {
    const counts = new Map<string, number>();
    for (const r of plotRows) {
      const v = getCategoricalValue(r, lineColour);
      counts.set(v, (counts.get(v) ?? 0) + 1);
    }
    return lineColourDomain.map((v) => ({
      key: v,
      label: v,
      colour: colourForCategory(v, lineColourDomain),
      n: counts.get(v) ?? 0,
    }));
  }, [lineColour, plotRows, lineColourDomain]);

  // Most-populous group: gets a slight opacity haircut so it doesn't swamp the
  // small groups in the tangle. Only when it's genuinely dominant.
  const dominantKey = useMemo(() => {
    if (legendEntries.length < 2) return null;
    let top = legendEntries[0];
    let total = 0;
    for (const e of legendEntries) {
      total += e.n;
      if (e.n > top.n) top = e;
    }
    return total > 0 && top.n / total >= 0.45 ? top.key : null;
  }, [legendEntries]);

  const { colW, plotCanvasW, addColX } = useMemo(() => {
    // Fit-to-panel (never scroll): the metric columns plus the trailing add column
    // (same width as a metric) divide the available width evenly.
    const availW = plotBoxW > 0 ? plotBoxW : Math.max(320, containerW - 28);
    const showAddCol = axes.length < ADDABLE_AXES.length;
    const slots = Math.max(1, axes.length + (showAddCol ? 1 : 0));
    const innerBudget = Math.max(80, availW - MARGIN_L - MARGIN_R - RIGHT_NUM_TICK_GUTTER);
    const colW = innerBudget / slots;
    const addColX = MARGIN_L + axes.length * colW;
    return { colW, plotCanvasW: availW, addColX };
  }, [plotBoxW, containerW, axes.length]);

  const headerLabelW = useMemo(() => axes.map((a) => measureHeaderLabelW(axisLabel(a))), [axes]);

  // The plot fills whatever vertical space the panel leaves (measured from the
  // plot box) so it never scrolls; clamp to a sane minimum.
  const pcH = Math.max(MIN_PC_H, plotBoxH > 0 ? plotBoxH : MASTER_PLOT_CHART_HEIGHT_PX);
  const trackTop = HEADER_H;
  const trackH = pcH - HEADER_H - FOOTER_H;

  const getYForRow = useCallback(
    (row: CellMetricRow, ax: PCAxisDef, rowIdx: number): number | null => {
      if (ax.kind === 'categorical') {
        const meta = categoricalDomains.get(ax.id);
        if (!meta) return null;
        const band = getCategoricalBand(row, ax, meta.domain, meta.counts);
        if (!band) return null;
        // Jitter only separates lines that share a category among *other*
        // categories. When the axis has a single value, every cell is identical
        // here, so jitter would only manufacture meaningless crossings — collapse
        // them onto the band centre for a clean, aligned pass-through.
        const j =
          meta.domain.length <= 1
            ? 0
            : jitter01(row.idNo, ax.id) * 0.42 * (band.n1 - band.n0);
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

  /** Screen-space crossings for a row, one per axis (null where the cell has no value). */
  const rowPoints = useCallback(
    (row: CellMetricRow, idx: number): ({ x: number; y: number } | null)[] => {
      const out: ({ x: number; y: number } | null)[] = new Array(axes.length);
      for (let i = 0; i < axes.length; i++) {
        const y = getYForRow(row, axes[i], idx);
        out[i] = y == null ? null : { x: getConnectorX(i), y };
      }
      return out;
    },
    [axes, getConnectorX, getYForRow],
  );

  /** Shared by the base render and the hover/selection overlay pass. */
  const drawRowSegments = useCallback(
    (ctx: CanvasRenderingContext2D, row: CellMetricRow, idx: number, alpha: number, lw: number) => {
      ctx.strokeStyle = lineColourForRow(row, idx);
      ctx.globalAlpha = alpha;
      ctx.lineWidth = lw;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      strokePolyline(ctx, rowPoints(row, idx));
      ctx.globalAlpha = 1;
    },
    [lineColourForRow, rowPoints],
  );

  // Hover redraws used to repaint every polyline (~35k segments at 5k cells,
  // ~100 ms per mousemove). The static scene renders once into an offscreen
  // canvas; pointer interaction only blits it and draws the highlighted rows.
  const baseCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const dprRef = useRef(1);

  const renderBase = useCallback(() => {
    if (!plotRows.length || !axes.length) return;
    let canvas = baseCanvasRef.current;
    if (!canvas) {
      canvas = document.createElement('canvas');
      baseCanvasRef.current = canvas;
    }
    const w = plotCanvasW;
    const h = pcH;
    const dpr = Math.min(2, typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1);
    dprRef.current = dpr;
    canvas.width = Math.floor(w * dpr);
    canvas.height = Math.floor(h * dpr);
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
    // Higher-contrast colour reserved for numeric tick labels.
    const tickInk = isDark ? 'rgba(203,213,225,0.95)' : 'rgba(51,65,85,0.95)';
    const trackBg = isDark ? 'rgba(148,163,184,0.16)' : 'rgba(100,116,139,0.14)';

    const drawCapsule = (cx: number, top: number, h: number, w: number, fill: string) => {
      const r = w / 2;
      ctx.fillStyle = fill;
      ctx.beginPath();
      ctx.moveTo(cx - r, top + r);
      ctx.arc(cx, top + r, r, Math.PI, 0);
      ctx.lineTo(cx + r, top + h - r);
      ctx.arc(cx, top + h - r, r, 0, Math.PI);
      ctx.closePath();
      ctx.fill();
    };

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
      // Neutral zebra tints with a clearer ~3% vs ~7% contrast so adjacent bands
      // read as distinct without saturated colour. Hue never reused.
      const zebraA = isDark ? 'rgba(148,163,184,0.13)' : 'rgba(100,116,139,0.08)';
      const zebraB = isDark ? 'rgba(148,163,184,0.05)' : 'rgba(100,116,139,0.025)';
      let acc = 0;
      let zi = 0;
      for (const d of meta.domain) {
        const frac = (meta.counts.get(d) ?? 0) / total;
        const n0 = acc;
        const n1 = acc + frac;
        const y0 = trackTop + n0 * trackH;
        const y1 = trackTop + n1 * trackH;
        const hBand = Math.max(1, y1 - y0);
        // Very-light neutral zebra fill (no saturated colour competing with lines).
        ctx.fillStyle = zi % 2 === 0 ? zebraA : zebraB;
        ctx.fillRect(xL, y0, wStrip, hBand);
        // Thin hairline divider between bands (clear boundary, no heavy outline).
        if (zi > 0) {
          ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.30)' : 'rgba(100,116,139,0.28)';
          ctx.lineWidth = 1;
          ctx.beginPath();
          ctx.moveTo(xL, y0 + 0.5);
          ctx.lineTo(xR, y0 + 0.5);
          ctx.stroke();
        }
        const cx = (xL + xR) / 2;
        const cy = (y0 + y1) / 2;
        const cnt = meta.counts.get(d) ?? 0;
        const shortLab = d.length > 14 ? `${d.slice(0, 12)}…` : d;
        // Category label: centred metadata, slightly lighter than data so it
        // reads as a band caption, not as a line. The per-band count
        // is demoted to a muted caption tucked at the band's top-left edge so it
        // no longer competes with the line bundles crossing the band centre.
        ctx.textBaseline = 'middle';
        if (hBand >= 16) {
          ctx.textAlign = 'center';
          ctx.fillStyle = fg;
          ctx.font = '600 10px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(shortLab, cx, cy);
        }
        if (hBand >= 24) {
          ctx.textAlign = 'left';
          ctx.textBaseline = 'top';
          ctx.fillStyle = muted;
          ctx.font = '8px ui-sans-serif, system-ui, sans-serif';
          ctx.fillText(`n=${cnt}`, xL + 3, y0 + 3);
          ctx.textBaseline = 'middle';
        }
        acc = n1;
        zi++;
      }
      // Faint capsule outline of the whole categorical column.
      ctx.strokeStyle = isDark ? 'rgba(148,163,184,0.28)' : 'rgba(100,116,139,0.24)';
      ctx.lineWidth = 1;
      ctx.strokeRect(xL + 0.5, trackTop + 0.5, wStrip - 1, trackH - 1);
    }

    const TRACK_W = 9;
    for (let i = 0; i < axes.length; i++) {
      const ax = axes[i];
      const x = getXForAxis(i);
      if (ax.kind === 'continuous' || ax.kind === 'per_cycle') {
        // Axis track: a faint capsule behind the vertical axis line.
        drawCapsule(x, trackTop, trackH, TRACK_W, trackBg);
        ctx.strokeStyle = muted;
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(x, trackTop);
        ctx.lineTo(x, trackTop + trackH);
        ctx.stroke();
      }
    }

    for (let i = 0; i < axes.length; i++) {
      const ax = axes[i];
      const x = getXForAxis(i);
      // Unified header typography for every axis: one bold title row, with units
      // and any clamp note on a lighter secondary row beneath. Same
      // weight/size/colour treatment for categorical and numeric headers.
      ctx.fillStyle = fg;
      ctx.font = '600 11px ui-sans-serif, system-ui, sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'alphabetic';
      ctx.fillText(axisLabel(ax), x, 16);

      // Secondary metadata row: units (e.g. "%") plus a robust-range / overflow
      // note when the axis domain was clamped.
      const unitRaw = axisUnitSuffix(ax, plotRows[0]?.capacityBasis ?? 'mAh/g').trim();
      const unitTxt = unitRaw.replace(/^\(/, '').replace(/\)$/, '');
      const subParts: string[] = [];
      if (unitTxt) subParts.push(unitTxt);
      if (ax.kind === 'continuous' || ax.kind === 'per_cycle') {
        const ex0 = continuousExtents.get(ax.id);
        if (ex0) {
          const clipped = ex0.nLow + ex0.nHigh;
          if (clipped > 0) {
            subParts.push(`${clipped} clipped`);
          }
        }
      }
      if (subParts.length) {
        ctx.fillStyle = muted;
        ctx.font = '9px ui-sans-serif, system-ui, sans-serif';
        let sub = subParts.join(' · ');
        // Keep the secondary row inside its column.
        const maxW = colW - 6;
        while (sub.length > 4 && ctx.measureText(sub).width > maxW) {
          sub = sub.slice(0, -2);
        }
        ctx.fillText(sub, x, 30);
      }

      if (ax.kind === 'continuous' || ax.kind === 'per_cycle') {
        const ex = continuousExtents.get(ax.id);
        if (ex) {
          const span = ex.max - ex.min;
          const nTicks = span < 1e-9 ? 1 : trackH >= 360 ? 7 : 5;
          // Larger, higher-contrast tick labels.
          ctx.font = '10px ui-sans-serif, system-ui, sans-serif';
          ctx.fillStyle = tickInk;
          // Ticks sit on the right of the axis, except the rightmost axis, whose
          // labels are drawn to the LEFT and right-aligned so they stay inside
          // the plot instead of being clipped against the canvas edge.
          const onLeft = i === axes.length - 1;
          const tickLen = 5;
          const labelGap = 4;
          let prevPrinted = '';
          for (let ti = 0; ti < nTicks; ti++) {
            const t = nTicks === 1 ? 0 : ti / (nTicks - 1);
            const v = ex.max - t * span;
            const y = trackTop + t * trackH;
            // When the domain is clamped, the end ticks represent "everything at
            // or beyond this" — mark them with ≥ / ≤ so the outlier overflow is
            // explicit instead of misread as a true maximum.
            let lab = formatNumericAxisTick(ax, v);
            if (ti === 0 && ex.nHigh > 0) lab = `≥${lab}`;
            else if (ti === nTicks - 1 && ex.nLow > 0) lab = `≤${lab}`;
            if (lab === prevPrinted) continue;
            prevPrinted = lab;
            ctx.strokeStyle = muted;
            ctx.globalAlpha = 0.75;
            ctx.lineWidth = 1;
            ctx.beginPath();
            ctx.moveTo(x, y);
            ctx.lineTo(onLeft ? x - tickLen : x + tickLen, y);
            ctx.stroke();
            ctx.globalAlpha = 1;
            ctx.textAlign = onLeft ? 'right' : 'left';
            const lx = onLeft ? x - tickLen - labelGap : x + tickLen + labelGap;
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

    // Per-line alpha pushed lower so the dense core resolves as
    // tonal build-up rather than a solid blob.
    const n = plotRows.length;
    const baseAlpha = n > 400 ? 0.16 : n > 150 ? 0.24 : n > 60 ? 0.36 : 0.55;
    const lw = n > 400 ? 0.8 : n > 150 ? 1.0 : 1.2;
    const ctxGrey = isDark ? 'rgba(148,163,184,1)' : 'rgba(100,116,139,1)';

    // A row is "muted" when a legend group is isolated and the row isn't in it.
    const isMuted = (row: CellMetricRow, idx: number): boolean => {
      if (isolatedKey != null && colourKeyForRow(row, idx) !== isolatedKey) return true;
      return false;
    };

    // Pass 1: muted rows as a desaturated grey context layer (curved, faint).
    const anyMuted = isolatedKey != null;
    if (anyMuted) {
      ctx.strokeStyle = ctxGrey;
      ctx.globalAlpha = isolatedKey != null ? 0.035 : 0.05;
      ctx.lineWidth = 0.6;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      for (let idx = 0; idx < plotRows.length; idx++) {
        const row = plotRows[idx];
        if (!isMuted(row, idx)) continue;
        strokePolyline(ctx, rowPoints(row, idx));
      }
      ctx.globalAlpha = 1;
    }

    // Pass 2: focused rows in colour. When a group is isolated the survivors are
    // drawn bolder and more opaque so the focus pops against the faint muted
    // layer; otherwise the most-populous group gets a small alpha haircut so it
    // can't bury the smaller ones.
    const focusBoost = isolatedKey != null;
    const focusAlpha = focusBoost ? Math.max(baseAlpha, 0.6) : baseAlpha;
    const focusLw = focusBoost ? lw + 0.6 : lw;
    for (let idx = 0; idx < plotRows.length; idx++) {
      const row = plotRows[idx];
      if (isMuted(row, idx)) continue;
      let a = focusAlpha;
      if (!focusBoost && dominantKey != null && colourKeyForRow(row, idx) === dominantKey) {
        a *= 0.6;
      }
      drawRowSegments(ctx, row, idx, a, focusLw);
    }
  }, [
    plotRows,
    axes,
    plotCanvasW,
    continuousExtents,
    categoricalDomains,
    getXForAxis,
    rowPoints,
    colW,
    drawRowSegments,
    colourKeyForRow,
    isolatedKey,
    dominantKey,
    trackH,
    trackTop,
    pcH,
  ]);

  /** Blit the cached base scene, then draw only hovered/selected rows on top. */
  const composite = useCallback(() => {
    const canvas = canvasRef.current;
    const base = baseCanvasRef.current;
    if (!canvas || !base || !base.width) return;
    const dpr = dprRef.current;
    canvas.width = base.width;
    canvas.height = base.height;
    canvas.style.width = `${Math.floor(base.width / dpr)}px`;
    canvas.style.height = `${Math.floor(base.height / dpr)}px`;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    ctx.drawImage(base, 0, 0);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    const hiId = hoveredIdNo;
    const selSet = new Set(selectedCellIds);
    if (hiId == null && selSet.size === 0) return;

    const isDark = typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
    const halo = isDark ? 'rgba(15,23,42,0.85)' : 'rgba(255,255,255,0.9)';
    const labelBg = isDark ? 'rgba(15,23,42,0.92)' : 'rgba(255,255,255,0.94)';
    const labelInk = isDark ? '#e2e8f0' : '#0f172a';

    // Draw value labels pinned at each axis crossing for a focused row.
    const drawValueLabels = (row: CellMetricRow, idx: number) => {
      ctx.font = '600 9px ui-sans-serif, system-ui, sans-serif';
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      for (let i = 0; i < axes.length; i++) {
        const ax = axes[i];
        const y = getYForRow(row, ax, idx);
        if (y == null) continue;
        let lab: string;
        if (ax.kind === 'categorical') {
          lab = getCategoricalValue(row, ax.catKey);
          if (lab.length > 12) lab = `${lab.slice(0, 11)}…`;
        } else {
          const v = getAxisNumericValue(row, ax);
          if (v == null || Number.isNaN(v)) continue;
          lab = formatNumericAxisTick(ax, v);
        }
        const x = getXForAxis(i);
        const w = ctx.measureText(lab).width + 8;
        ctx.fillStyle = labelBg;
        ctx.fillRect(x - w / 2, y - 8, w, 16);
        ctx.fillStyle = labelInk;
        ctx.fillText(lab, x, y + 0.5);
      }
    };

    for (let idx = 0; idx < plotRows.length; idx++) {
      const row = plotRows[idx];
      if (row.idNo !== hiId && !selSet.has(row.idNo)) continue;
      const a = 1;
      const lw = selSet.has(row.idNo) ? 2.75 : 2.5;
      // Outer halo so the focused path reads against a dense background.
      ctx.save();
      ctx.strokeStyle = halo;
      ctx.globalAlpha = 0.6;
      ctx.lineWidth = lw + 3.5;
      ctx.lineCap = 'round';
      ctx.lineJoin = 'round';
      strokePolyline(ctx, rowPoints(row, idx));
      ctx.restore();
      // Crisp coloured line on top.
      drawRowSegments(ctx, row, idx, a, lw);
    }

    // Value labels last so they sit above every focused path.
    for (let idx = 0; idx < plotRows.length; idx++) {
      const row = plotRows[idx];
      if (row.idNo === hiId || selSet.has(row.idNo)) drawValueLabels(row, idx);
    }
  }, [
    plotRows,
    axes,
    hoveredIdNo,
    selectedCellIds,
    drawRowSegments,
    rowPoints,
    getYForRow,
    getXForAxis,
  ]);

  useEffect(() => {
    renderBase();
    composite();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [renderBase]);

  useEffect(() => {
    composite();
  }, [composite]);

  useEffect(() => {
    const el = document.documentElement;
    const ro = new MutationObserver(() => {
      renderBase();
      composite();
    });
    ro.observe(el, { attributes: true, attributeFilter: ['class'] });
    return () => ro.disconnect();
  }, [renderBase, composite]);

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

  // Coalesce hover hit-testing to one pick per animation frame — pointermove
  // can fire far faster than we can scan 5k polylines.
  const hoverRafRef = useRef<number | null>(null);
  const pendingHoverRef = useRef<{ lx: number; ly: number } | null>(null);

  const onCanvasPointerMove = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const lx = e.clientX - rect.left;
    const ly = e.clientY - rect.top;
    pendingHoverRef.current = { lx, ly };
    if (hoverRafRef.current == null) {
      hoverRafRef.current = requestAnimationFrame(() => {
        hoverRafRef.current = null;
        const p = pendingHoverRef.current;
        if (!p) return;
        const hit = pickRowAt(p.lx, p.ly);
        setHoveredIdNo(hit?.idNo ?? null, 'plot2');
      });
    }
  };

  const onCanvasClick = (e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    const hit = pickRowAt(e.clientX - rect.left, e.clientY - rect.top);
    if (hit) {
      handleCellSelect(hit.idNo, e.nativeEvent);
      onInspect?.(hit.cellId);
    }
  };

  const removeAxis = (id: string) => {
    setAxes((ax) => ax.filter((a) => a.id !== id));
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

  const addableOptions = useMemo(
    () => ADDABLE_AXES.filter((a) => !axes.some((x) => x.id === a.id)),
    [axes],
  );

  return (
    <div ref={containerRef} className="flex h-full min-h-0 min-w-0 flex-1 flex-col gap-3">
      <div className="flex min-h-0 flex-1 flex-col gap-3 rounded-lg border border-border bg-card p-3 shadow-sm">
        <div className="flex items-center gap-1.5">
          <h2 className="text-sm font-semibold text-foreground">Parallel coordinates</h2>
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <button
                  type="button"
                  aria-label="How to use this chart"
                  className="inline-flex h-5 w-5 items-center justify-center rounded-full text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <HelpCircle className="h-3.5 w-3.5" />
                </button>
              </TooltipTrigger>
              <TooltipContent side="bottom" align="start" className="max-w-xs text-xs leading-relaxed">
                <p className="font-medium text-foreground">How to use</p>
                <ul className="mt-1.5 space-y-1 text-muted-foreground">
                  <li>Click a line to inspect a cell</li>
                  {legendEntries.length > 1 && <li>Click a legend swatch to isolate a group</li>}
                </ul>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
        </div>

        {/* Row 1: colour picker · search · legend chips */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
          <span className="text-[10px] text-muted-foreground shrink-0">Line colour</span>
          <Select value={lineColour} onValueChange={(v) => setLineColour(v as DimKey)}>
            <SelectTrigger className="h-7 w-[110px] text-xs bg-muted border-input shadow-sm">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="cathode">Cathode</SelectItem>
              <SelectItem value="separator">Separator</SelectItem>
              <SelectItem value="spacer">Spacer</SelectItem>
              <SelectItem value="electrolyte">Electrolyte</SelectItem>
              <SelectItem value="protocol">Protocol</SelectItem>
            </SelectContent>
          </Select>

          <SearchInput
            value={cellSearch}
            onChange={onCellSearchChange}
            placeholder="Search by name…"
            aria-label="Find a cell to trace"
            widthClass="w-[160px]"
            list="pc-cell-search"
          />
          <datalist id="pc-cell-search">
            {cellSearchOptions.map((o) => (
              <option key={o.idNo} value={o.label} />
            ))}
          </datalist>

          {legendEntries.length > 0 && (
            <>
              <span className="text-[10px] text-muted-foreground shrink-0">
                {isolatedKey != null ? '· isolating' : '·'}
              </span>
              {legendEntries.map((e) => {
                const active = isolatedKey === e.key;
                const dimmed = isolatedKey != null && !active;
                return (
                  <button
                    key={e.key}
                    type="button"
                    aria-pressed={active}
                    title={active ? 'Show all groups' : `Isolate ${e.label}`}
                    onClick={() => setIsolatedKey((k) => (k === e.key ? null : e.key))}
                    className={`inline-flex items-center gap-1 rounded px-1 py-0.5 text-[10px] text-foreground transition-opacity hover:bg-muted/60 ${
                      active ? 'bg-muted ring-1 ring-border' : ''
                    } ${dimmed ? 'opacity-45' : ''}`}
                  >
                    <span
                      className="inline-block h-2.5 w-2.5 rounded-[2px] border border-black/10 dark:border-white/15 shrink-0"
                      style={{ backgroundColor: e.colour }}
                      aria-hidden
                    />
                    <span className="truncate max-w-[7rem]">{e.label}</span>
                    <span className="text-muted-foreground tabular-nums">({e.n})</span>
                  </button>
                );
              })}
            </>
          )}
        </div>

        {/* Row 2: traced cells — only visible when cells are pinned */}
        {selectedCellIds.length > 0 && (
          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
            <span className="text-[10px] text-muted-foreground shrink-0">
              Traced ({selectedCellIds.length})
            </span>
            {selectedCellIds.map((id) => (
              <span
                key={id}
                onMouseEnter={() => setHoveredIdNo(id, 'plot2')}
                onMouseLeave={() => clearHoverIfFrom('plot2')}
                className="inline-flex items-center gap-1 rounded bg-muted px-1.5 py-0.5 text-[10px] text-foreground ring-1 ring-border"
              >
                <span className="truncate max-w-[8rem]">{labelByIdNo.get(id) ?? `#${id}`}</span>
                <button
                  type="button"
                  aria-label={`Stop tracing ${labelByIdNo.get(id) ?? `#${id}`}`}
                  title="Stop tracing"
                  onClick={() => removeFromSelection(id)}
                  className="text-muted-foreground hover:text-destructive"
                >
                  ×
                </button>
              </span>
            ))}
            <button
              type="button"
              onClick={clearSelection}
              className="ml-auto text-[10px] text-primary hover:underline"
            >
              Clear all
            </button>
          </div>
        )}

        {rateLoading && !loadError && (
          <LoadingIndicator size="sm" label="Loading rate-performance data…" />
        )}
        {!rateLoading && loadError && <p className="text-xs text-destructive">{loadError}</p>}

        {plotRows.length > 0 && (
          <div className="flex min-h-0 min-w-0 flex-1 flex-col">
            <div
              ref={plotBoxRef}
              className="min-h-0 flex-1 overflow-hidden rounded-md border border-border/60 bg-transparent"
            >
              <div className="relative shrink-0" style={{ width: plotCanvasW }}>
                <canvas
                  ref={canvasRef}
                  className="block max-w-none touch-none cursor-default shrink-0"
                  onPointerMove={onCanvasPointerMove}
                  onPointerLeave={() => clearHoverIfFrom('plot2')}
                  onClick={onCanvasClick}
                />
                {/* Axis-head controls overlaid on the canvas, aligned via getXForAxis
                    (CSS px). The container is click-through; only the handles below
                    capture pointer events, so hover on the plot is unaffected. */}
                <div className="pointer-events-none absolute inset-0">
                  {axes.map((ax, i) => (
                    <div
                      key={ax.id}
                      draggable
                      onDragStart={(e) => onChipDragStart(e, i)}
                      onDragOver={(e) => e.preventDefault()}
                      onDrop={(e) => onChipDrop(e, i)}
                      title="Drag to reorder · × to remove"
                      style={{ left: getXForAxis(i) + headerLabelW[i] / 2 + 5, top: 4 }}
                      className="group pointer-events-auto absolute flex items-center gap-0.5 cursor-grab active:cursor-grabbing"
                    >
                      <AxisInfoTooltip ax={ax} />
                      <button
                        type="button"
                        aria-label={`Remove ${axisLabel(ax)}`}
                        title={`Remove ${axisLabel(ax)}`}
                        onClick={(ev) => {
                          ev.stopPropagation();
                          removeAxis(ax.id);
                        }}
                        className="flex h-4 w-4 items-center justify-center rounded text-[12px] leading-none text-muted-foreground hover:bg-muted hover:text-destructive"
                      >
                        ×
                      </button>
                    </div>
                  ))}
                  {addableOptions.length > 0 && (
                    <div
                      className="pointer-events-auto absolute"
                      style={{ left: addColX, top: 0, width: colW, height: pcH - FOOTER_H }}
                    >
                      <Select value="" onValueChange={addAxis}>
                        <SelectTrigger
                          aria-label="Add metric"
                          className="h-full w-full flex-col items-center justify-center gap-1.5 whitespace-nowrap rounded-md border-2 border-dashed border-primary/40 bg-primary/5 px-2 text-center text-xs font-semibold text-primary transition-colors hover:border-primary/60 hover:bg-primary/10 [&>svg]:hidden"
                        >
                          <span className="flex h-6 w-6 items-center justify-center rounded-full border border-primary/40 text-base leading-none">
                            +
                          </span>
                          <span>Add metric</span>
                        </SelectTrigger>
                        <SelectContent>
                          {addableOptions.map((a) => (
                            <SelectItem key={a.id} value={a.id}>
                              {axisLabel(a)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                  )}
                </div>
              </div>
            </div>
          </div>
        )}
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
