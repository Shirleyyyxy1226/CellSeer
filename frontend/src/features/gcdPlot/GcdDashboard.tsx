import { useCallback, useMemo, useState } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { buildPathToColorMap, getColorForCell } from '@/lib/ratePerfAggregation';
import { buildCellEncodings, getCellEncoding } from '@/lib/cellColorScheme';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ChartEditPopover } from '@/components/ChartEditPopover';
import { ChartLegend, type LegendItem } from '@/components/ChartLegend';
import { ResizableChartCard } from '@/components/ResizableChartCard';
import { CycleColorScale } from '@/components/CycleColorScale';
import { ArrowLeft, Info, MousePointerClick } from 'lucide-react';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useChartAppearance } from '@/hooks/useChartAppearance';
import { useResizableChart } from '@/hooks/useResizableChart';
import { parseCycleFilter } from '@/lib/cycleFilter';
import type { AnalysisResult } from '@/lib/treeUtils';
import {
  buildGcdCumulativeFigure,
  buildGcdFigure,
  type RecordDataset,
} from 'cellseer-lib';
import { RatePerformancePlot } from '../ratePerformance/plots/RatePerformancePlot';
import { useGcdCellData, type VQCell } from './useGcdCellData';

function detectIdNoHeaderIndex(headers: string[]): number {
  const patterns = [/^id\s*no\.?$/i, /^id_no$/i, /^idno$/i, /^number$/i, /^cell\s*no\.?$/i, /^cel\s*no\.?$/i];
  for (let i = 0; i < headers.length; i++) {
    if (patterns.some((p) => p.test(String(headers[i] ?? '').trim()))) return i;
  }
  return -1;
}

function parseIdNoFromLeafValue(raw: string): number | null {
  const trimmed = String(raw ?? '').trim();
  const m = trimmed.match(/^Cell\s*(\d+)$/i) ?? trimmed.match(/^(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isFinite(n) ? n : null;
}

const EMPTY_ANALYSIS: AnalysisResult = {
  leafCol: 0, rowIdCol: -1, flagCol: -1, rootLabelColIdx: -1, rootLabelVal: '',
  hierCols: [], annotations: [], labelDecorations: [],
  N: 0, headers: [], allConstants: [], allCandidates: [],
};

interface VoltageCapacityPanelProps {
  visibleCells: string[];
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
  onCathodeFilter?: (v: string) => void;
  onSeparatorFilter?: (v: string) => void;
}

const MAX_CYCLES = 60;
const MAX_PTS_TRACE = 2500;

const GcdDashboard = ({
  cathodeFilter,
  spacerFilter,
  separatorFilter,
}: VoltageCapacityPanelProps) => {
  const { setSelectedCellIds } = useCellSelection();
  const { treeFilterPath } = useTreeFilter();
  const { apiData: hierarchyData } = useProjectHierarchy();

  const {
    cellIndex,
    cellIndexLoading,
    filteredCells,
    cellsForCharts,
    cellsDataList,
    selectedCell,
    selectedCellData,
    cycleFilter,
    setCycleFilter,
    ratePerfCells,
    selectedCellRatePerf,
    loadError,
    cellDataLoading,
    cellDataError,
  } = useGcdCellData({ cathodeFilter, spacerFilter, separatorFilter });

  // Defaults double as "has the user edited this?" sentinels: smart per-cell
  // titles / basis-aware axis labels apply until the user types their own,
  // which then always wins (the edit popover must never be a no-op).
  const GCD_TITLE_DEFAULT = 'GCD plot';
  const GCD_X_DEFAULT = 'Capacity (mAh)';
  const appearance = useChartAppearance({
    chartTitle: GCD_TITLE_DEFAULT,
    xAxisLabel: GCD_X_DEFAULT,
    yAxisLabel: 'Voltage (V)',
    // GCD curves are continuous V–Q lines — default to connected lines, not the
    // old scatter-dots (still toggleable via the chart Edit popover).
    showConnectedLine: true,
    maximizeContrast: false,
  });
  const {
    chartTitle,
    xAxisLabel,
    yAxisLabel,
    fontFamily,
    titleFontSize,
    labelFontSize,
    legendFontSize,
    showConnectedLine,
    maximizeContrast,
  } = appearance.config;

  // Direction of the per-cycle ZOOM (GCD curves). 'both' overlays the full
  // charge+discharge loop. The cumulative overview always shows 'both'.
  const [gcdDirection, setGcdDirection] = useState<'discharge' | 'charge' | 'both'>('discharge');
  const [combinedHighlightCycle, setCombinedHighlightCycle] = useState<number | null>(null);
  // The GCD chart's legend is owned by its appearance config (the eye toggle and
  // the edit-popover checkbox share one value). The CE chart has no edit popover,
  // so it keeps a local legend-visibility flag driven by its own eye toggle.
  const [ceLegendShown, setCeLegendShown] = useState(true);

  const main = useResizableChart();
  const combined = useResizableChart();
  const ratePerf = useResizableChart();
  const ceCycle = useResizableChart();

  const allowedCycles = useMemo(() => parseCycleFilter(cycleFilter), [cycleFilter]);

  // An invalid filter is a non-empty input that did not parse to any cycles.
  const isFilterInvalid = useMemo(
    () => cycleFilter.trim().length > 0 && allowedCycles === null,
    [cycleFilter, allowedCycles],
  );

  // Provenance for ZIP exports: which cells fed the figure, where the original
  // full-resolution data lives, and the view settings that shaped the traces.
  const exportContext = useMemo(
    () => ({
      plotType: 'gcd' as const,
      sourceCellIds: cellsDataList.map((c) => c.cellId),
      sourceEndpoints: cellsDataList.map((c) =>
        new URL(`/api/cell-record/${encodeURIComponent(c.cellId)}`, window.location.origin).toString(),
      ),
      settings: {
        direction: gcdDirection,
        cycleFilter: cycleFilter || 'all cycles',
        display: 'traces stride-downsampled to ≤500 points/cycle; sourceEndpoints serve full resolution',
      },
    }),
    [cellsDataList, gcdDirection, cycleFilter],
  );

  const activeAnalysis = hierarchyData?.analysis ?? null;
  const hierCols = useMemo(() => activeAnalysis?.hierCols ?? [], [activeAnalysis?.hierCols]);

  // Visual encodings for every cell shown on this tab: identity hue (or the
  // max-contrast palette when toggled) PLUS an orthogonal line-dash + marker
  // keyed by within-condition replicate, so visually-similar cells overlaid for
  // comparison stay distinguishable. Built once from the union of the cells the
  // GCD curves and the CE chart draw, so a cell looks the same in both.
  const cellEncodings = useMemo(() => {
    const byId = new Map<number, VQCell | (typeof cellsForCharts)[number]>();
    for (const c of cellsForCharts) if (!byId.has(c.idNo)) byId.set(c.idNo, c);
    for (const c of cellsDataList) if (!byId.has(c.idNo)) byId.set(c.idNo, c);
    return buildCellEncodings([...byId.values()], { maximizeContrast: maximizeContrast ?? false });
  }, [cellsForCharts, cellsDataList, maximizeContrast]);

  const recordDatasets = useMemo<RecordDataset[]>(() => {
    return cellsDataList
      .filter((cellData) => !!cellData?.curves)
      .map((cellData: VQCell) => {
        const enc = getCellEncoding(cellEncodings, cellData);
        return {
          id: String(cellData.idNo),
          label: cellData.cellName ?? `Cell ${cellData.idNo}`,
          // Canonical identity colour — matches the hierarchy tree and sidebar
          // (or the max-contrast palette when that toggle is on).
          color: enc?.color ?? getColorForCell(cellData, treeFilterPath, hierCols),
          dash: enc?.dash,
          symbol: enc?.symbol,
          cathodeMassG: cellData.cathodeMassG ?? null,
          curves: cellData.curves,
        };
      });
  }, [cellsDataList, cellEncodings, treeFilterPath, hierCols]);

  // Overlaying every cycle (often 30–60) turns the per-cycle GCD plot into an
  // unreadable tangle. When the user hasn't typed a cycle filter, default the
  // GCD-curves overlay to a representative, evenly-spaced subset (first → last)
  // so the early→late colour gradient stays legible; the Cycles input overrides.
  const GCD_OVERLAY_DEFAULT = 10;
  const gcdCycleSubset = useMemo(() => {
    if (allowedCycles) return { set: allowedCycles as Set<number> | null, subset: false, shown: 0, total: 0 };
    const all = new Set<number>();
    for (const rd of recordDatasets)
      for (const k of Object.keys(rd.curves)) {
        const n = parseInt(k, 10);
        if (!isNaN(n)) all.add(n);
      }
    const sorted = [...all].sort((a, b) => a - b);
    if (sorted.length <= GCD_OVERLAY_DEFAULT)
      return { set: null as Set<number> | null, subset: false, shown: sorted.length, total: sorted.length };
    const pick = new Set<number>();
    const step = (sorted.length - 1) / (GCD_OVERLAY_DEFAULT - 1);
    for (let i = 0; i < GCD_OVERLAY_DEFAULT; i++) pick.add(sorted[Math.round(i * step)]);
    return { set: pick as Set<number> | null, subset: true, shown: pick.size, total: sorted.length };
  }, [allowedCycles, recordDatasets]);

  // Overview → zoom linking: in single-cell mode, clicking a cycle in the
  // cumulative overview's colour scale sets combinedHighlightCycle, which here
  // FOCUSES the per-cycle "zoom" on that one cycle (the detail view). With
  // nothing focused it shows the representative subset. Multi-cell keeps the
  // dim-others highlight instead (colour encodes cell there, not cycle).
  const isSingleCell = cellsDataList.length <= 1;
  const zoomFocusCycle = isSingleCell ? combinedHighlightCycle : null;
  const { traces, gcdTraceIndexToCell } = useMemo(() => {
    try {
      // When the user has an explicit text filter, zoomFocusCycle highlights
      // (dims non-focused cycles) but does not hide them — the typed filter wins.
      // Without a text filter, zoomFocusCycle narrows to that single cycle (zoom).
      const gcdAllowedCycles =
        zoomFocusCycle != null && !allowedCycles ? new Set([zoomFocusCycle]) : gcdCycleSubset.set;
      const gcdHighlightCycle = isSingleCell
        ? (allowedCycles != null ? zoomFocusCycle : null)
        : combinedHighlightCycle;
      const fig = buildGcdFigure(recordDatasets, {
        mode: 'scatter',
        direction: gcdDirection,
        showConnectedLine,
        allowedCycles: gcdAllowedCycles,
        maxCycles: MAX_CYCLES,
        maxPointsPerTrace: MAX_PTS_TRACE,
        highlightCycle: gcdHighlightCycle,
      });
      const traceIndexMap = new Map<number, { idNo: number; cellName: string }>();
      fig.traceIndexToCell.forEach((value, key) => {
        traceIndexMap.set(key, { idNo: Number(value.id), cellName: value.label });
      });
      return { traces: fig.data, gcdTraceIndexToCell: traceIndexMap };
    } catch (e) {
      return { traces: [] as Plotly.Data[], gcdTraceIndexToCell: new Map<number, { idNo: number; cellName: string }>() };
    }
  }, [recordDatasets, gcdCycleSubset, allowedCycles, showConnectedLine, gcdDirection, combinedHighlightCycle, isSingleCell, zoomFocusCycle]);

  // Multi-cell GCD colours lines by cell, so a discrete legend (one entry per
  // cell) is useful. Single-cell mode colours by cycle and already shows the
  // CycleColorScale ramp, so a per-cycle discrete legend would be redundant.
  const gcdLegendItems = useMemo<LegendItem[]>(
    () =>
      isSingleCell
        ? []
        : recordDatasets.map((rd) => ({
            label: rd.label,
            color: rd.color ?? '#6b7280',
            dash: rd.dash,
            symbol: rd.symbol,
            hasLine: true,
            hasMarker: false,
          })),
    [isSingleCell, recordDatasets],
  );

  // Cycles present in the per-cell GCD curves, for the colour scale (single-cell
  // mode only — in multi-cell mode line colour encodes the cell, not the cycle).
  const gcdUniqueCycles = useMemo<number[]>(() => {
    const set = new Set<number>();
    for (const t of traces) {
      const lg = (t as { legendgroup?: string }).legendgroup;
      if (!lg) continue;
      const raw = lg.split('-').pop();
      const n = raw ? parseInt(raw, 10) : NaN;
      if (!isNaN(n)) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }, [traces]);

  const combinedGcdTraces = useMemo((): Plotly.Data[] => {
    try {
      const fig = buildGcdCumulativeFigure(recordDatasets, {
        // Overview always shows the full profile (charge + discharge); the
        // direction toggle controls the zoom only.
        direction: 'both',
        allowedCycles: allowedCycles ?? null,
        highlightCycle: combinedHighlightCycle,
        maxCycles: MAX_CYCLES,
        maxPointsPerTrace: MAX_PTS_TRACE,
      });
      return fig.data;
    } catch (e) {
      return [];
    }
  }, [recordDatasets, allowedCycles, combinedHighlightCycle]);

  const combinedUniqueCycles = useMemo<number[]>(() => {
    const set = new Set<number>();
    for (const t of combinedGcdTraces) {
      const lg = (t as { legendgroup?: string }).legendgroup;
      if (!lg) continue;
      const raw = lg.includes('-') ? lg.split('-').pop() : lg;
      const n = raw ? parseInt(raw, 10) : NaN;
      if (!isNaN(n)) set.add(n);
    }
    return [...set].sort((a, b) => a - b);
  }, [combinedGcdTraces]);

  const combinedGcdTracesWithCellLabels = useMemo((): Plotly.Data[] => {
    if (cellsDataList.length <= 1) return combinedGcdTraces;
    return combinedGcdTraces.map((trace, i) => {
      const t = trace as Plotly.ScatterData & { legendgroup?: string; name?: string };
      const cellIdx = Math.floor(i / Math.max(1, Math.round(combinedGcdTraces.length / cellsDataList.length)));
      const cellLabel = recordDatasets[cellIdx]?.label ?? `Cell ${cellIdx + 1}`;
      const originalGroup = t.legendgroup ?? '';
      return {
        ...t,
        legendgroup: `${cellLabel}::${originalGroup}`,
        legendgrouptitle: { text: cellLabel },
      };
    });
  }, [combinedGcdTraces, cellsDataList.length, recordDatasets]);

  const allCellsHaveMass = useMemo(
    () =>
      recordDatasets.length > 0 &&
      recordDatasets.every((rd) => rd.cathodeMassG != null && rd.cathodeMassG > 0),
    [recordDatasets],
  );
  const cumulativeXLabel = allCellsHaveMass
    ? 'Cumulative specific capacity (mAh g⁻¹)'
    : 'Cumulative capacity (mAh)';

  // Cumulative GCD lays every cycle end-to-end along cumulative capacity, so a
  // single cell already spans the full width — overlaying ≥2 cells is an
  // unreadable tangle and the per-cycle colour ramp can't also encode cell.
  // Above the threshold we switch to small multiples: one compact cumulative
  // panel per cell, each keeping its own early→late cycle colour ramp.
  const SMALL_MULTIPLE_THRESHOLD = 2;
  const useSmallMultiples = cellsDataList.length >= SMALL_MULTIPLE_THRESHOLD;

  const perCellCumulative = useMemo(() => {
    if (!useSmallMultiples) return [];
    return recordDatasets.map((rd) => {
      let data: Plotly.Data[] = [];
      try {
        data = buildGcdCumulativeFigure([rd], {
          direction: 'both',
          allowedCycles: allowedCycles ?? null,
          highlightCycle: combinedHighlightCycle,
          maxCycles: MAX_CYCLES,
          maxPointsPerTrace: MAX_PTS_TRACE,
        }).data;
      } catch (e) {
        void e;
      }
      return { id: rd.id, label: rd.label, data };
    });
  }, [useSmallMultiples, recordDatasets, allowedCycles, combinedHighlightCycle]);

  const perCellCumulativeLayout = (label: string): Partial<Plotly.Layout> => ({
    autosize: true,
    font: { family: `${fontFamily}, sans-serif` },
    title: { text: `${label}: all cycles`, font: { size: Math.max(11, titleFontSize - 2) } },
    xaxis: {
      title: { text: cumulativeXLabel, font: { size: Math.max(9, labelFontSize - 1) } },
      tickfont: { size: Math.max(8, labelFontSize - 2) },
      gridcolor: 'rgba(128,128,128,0.2)',
    },
    yaxis: {
      title: { text: 'Voltage (V)', font: { size: Math.max(9, labelFontSize - 1) } },
      tickfont: { size: Math.max(8, labelFontSize - 2) },
      gridcolor: 'rgba(128,128,128,0.2)',
    },
    showlegend: false,
    margin: { t: 34, r: 14, b: 44, l: 50 },
    uirevision: 'combined-gcd-sm',
  });

  const combinedGcdLayout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 360,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      // Compact overview (single-cell here; ≥2 cells use small multiples), so
      // keep the title inline-small and margins tight to fit overview + zoom
      // on one screen.
      title: {
        text: selectedCell ? `${selectedCell.cellName}: all cycles (overview)` : 'All cycles',
        font: { size: Math.max(11, titleFontSize - 2) },
      },
      xaxis: {
        title: { text: cumulativeXLabel, font: { size: Math.max(9, labelFontSize - 1) } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: 'Voltage (V)', font: { size: Math.max(9, labelFontSize - 1) } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      showlegend: false,
      margin: { t: 30, r: 44, b: 42, l: 56 },
      uirevision: 'combined-gcd',
    }),
    [fontFamily, titleFontSize, labelFontSize, selectedCell, cumulativeXLabel],
  );


  const useSpecificCapacity =
    selectedCellData?.cathodeMassG != null && selectedCellData.cathodeMassG > 0;
  const autoXLabel = useSpecificCapacity ? 'Specific capacity (mAh g⁻¹)' : 'Capacity (mAh)';
  const effectiveXLabel = xAxisLabel !== GCD_X_DEFAULT ? xAxisLabel : autoXLabel;
  const effectiveTitle =
    chartTitle !== GCD_TITLE_DEFAULT
      ? chartTitle
      : selectedCell
        ? `${selectedCell.cellName}: GCD`
        : chartTitle;

  const layout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 480,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: { text: effectiveTitle, font: { size: titleFontSize } },
      xaxis: {
        title: { text: effectiveXLabel, font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: yAxisLabel, font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      // Legend is drawn as an HTML block below the plot (see ChartLegend), so the
      // in-figure legend is off and the inflated bottom margin is reclaimed.
      showlegend: false,
      margin: { t: 48, r: 44, b: 80, l: 65 },
      uirevision: 'voltage-capacity',
    }),
    [
      effectiveTitle,
      effectiveXLabel,
      yAxisLabel,
      fontFamily,
      titleFontSize,
      labelFontSize,
    ],
  );

  const metadataByIdNo = useMemo(() => {
    const headers = hierarchyData?.parsed?.headers ?? [];
    const rows = hierarchyData?.parsed?.rows ?? [];
    if (!headers.length || !rows.length) return new Map<number, Record<string, string>>();
    const idIdx = detectIdNoHeaderIndex(headers);
    const leafIdx = hierarchyData?.analysis?.leafCol ?? Math.max(0, headers.length - 1);
    const out = new Map<number, Record<string, string>>();
    rows.forEach((row) => {
      const directId = idIdx >= 0 ? parseInt(String(row[idIdx] ?? '').trim(), 10) : NaN;
      const idNo = Number.isFinite(directId) ? directId : parseIdNoFromLeafValue(String(row[leafIdx] ?? ''));
      if (idNo == null) return;
      const rec: Record<string, string> = {};
      headers.forEach((h, i) => { rec[h] = String(row[i] ?? ''); });
      out.set(idNo, rec);
    });
    return out;
  }, [hierarchyData?.parsed?.headers, hierarchyData?.parsed?.rows, hierarchyData?.analysis?.leafCol]);

  const visibleRatePerfCells = useMemo(() => {
    if (!ratePerfCells?.length) return [];
    const idNos = new Set(cellsForCharts.map((c) => c.idNo));
    return ratePerfCells.filter((r) => idNos.has(r.idNo));
  }, [ratePerfCells, cellsForCharts]);

  const ratePerfPathToColorMap = useMemo(
    () => visibleRatePerfCells.length
      ? buildPathToColorMap(visibleRatePerfCells, activeAnalysis?.hierCols ?? [], metadataByIdNo)
      : new Map<string, string>(),
    [visibleRatePerfCells, activeAnalysis?.hierCols, metadataByIdNo],
  );

  const ratePerfAppearance = useChartAppearance({
    chartTitle: 'Rate performance',
    xAxisLabel: 'Cycle number',
    yAxisLabel: 'Discharge capacity (mAh)',
    showConnectedLine: false,
    maximizeContrast: false,
  });

  const [ratePerfLegendItems, setRatePerfLegendItems] = useState<LegendItem[]>([]);
  const [ratePerfLegendShown, setRatePerfLegendShown] = useState(true);
  const handleRatePerfLegendItems = useCallback((items: LegendItem[]) => setRatePerfLegendItems(items), []);

  // ── Coulombic efficiency vs cycle ──
  // CE_n = discharge_n / charge_n × 100, computed per charted cell with the same
  // guards as the medianCE metric: a 5%-of-peak-discharge floor (skips
  // formation/rest/near-zero cycles that would blow up the ratio) and a 0–150%
  // sanity clamp. Excluded cycles are counted and surfaced, not hidden.
  const ceSeriesByCell = useMemo(() => {
    if (!ratePerfCells) return [];
    return cellsForCharts
      .map((c) => {
        const rp = ratePerfCells.find((r) => r.cellId === c.cellId || r.idNo === c.idNo);
        const cyc = rp?.cycles ?? [];
        const dch = rp?.dischargeCapacityMah ?? [];
        const chg = rp?.chargeCapacityMah ?? [];
        if (!cyc.length || !chg.length) return null; // no CE without charge capacity
        const finite = dch.filter((v) => Number.isFinite(v));
        const floor = (finite.length ? Math.max(...finite) : 0) * 0.05;
        const x: number[] = [];
        const y: number[] = [];
        for (let i = 0; i < cyc.length; i++) {
          const d = dch[i];
          const ch = chg[i];
          if (d != null && ch != null && floor > 0 && ch > floor && d > floor) {
            const ce = (d / ch) * 100;
            if (ce > 0 && ce < 150) {
              x.push(cyc[i]);
              y.push(ce);
            }
          }
        }
        if (!x.length) return null;
        const enc = getCellEncoding(cellEncodings, c);
        return {
          id: String(c.idNo),
          label: c.cellName ?? `Cell ${c.idNo}`,
          color: enc?.color ?? getColorForCell(c, treeFilterPath, hierCols),
          dash: enc?.dash,
          symbol: enc?.symbol,
          x,
          y,
          excluded: cyc.length - x.length,
        };
      })
      .filter((v): v is NonNullable<typeof v> => v != null);
  }, [ratePerfCells, cellsForCharts, cellEncodings, treeFilterPath, hierCols]);

  const ceTraces = useMemo(
    (): Plotly.Data[] =>
      ceSeriesByCell.map((s) => ({
        x: s.x,
        y: s.y,
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        name: ceSeriesByCell.length > 1 ? s.label : 'Coulombic efficiency',
        line: { width: 1.8, color: s.color, ...(s.dash ? { dash: s.dash } : {}) },
        marker: { size: 5, color: s.color, ...(s.symbol ? { symbol: s.symbol } : {}) },
        hovertemplate: `${s.label}<br>Cycle %{x}<br>CE %{y:.2f}%<extra></extra>`,
      })),
    [ceSeriesByCell],
  );

  const ceLegendItems = useMemo<LegendItem[]>(
    () =>
      ceSeriesByCell.map((s) => ({
        label: ceSeriesByCell.length > 1 ? s.label : 'Coulombic efficiency',
        color: s.color,
        dash: s.dash,
        symbol: s.symbol,
        hasLine: true,
        hasMarker: true,
      })),
    [ceSeriesByCell],
  );

  // CE is a protocol-conditioned quantity (C-rate, voltage window, CV holds all
  // shift it), so comparing cells run under DIFFERENT protocols can mislead —
  // a CE gap may be the protocol, not the cell. Warn when ≥2 charted cells have
  // differing protocol signatures.
  const protocolMismatch = useMemo(() => {
    if (cellsForCharts.length < 2 || !ratePerfCells) return false;
    const sigs = new Set<string>();
    for (const c of cellsForCharts) {
      const rp = ratePerfCells.find((r) => r.cellId === c.cellId || r.idNo === c.idNo);
      const segs = rp?.protocolSegments;
      sigs.add(
        segs && segs.length
          ? JSON.stringify(segs.map((s) => [s.cycleStart, s.cycleEnd, s.cRate]))
          : 'none',
      );
    }
    return sigs.size > 1;
  }, [cellsForCharts, ratePerfCells]);

  const ceLayout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 320,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: {
        text:
          ceSeriesByCell.length > 1
            ? `Coulombic efficiency vs cycle (${ceSeriesByCell.length} cells)`
            : `${selectedCell?.cellName ?? 'Cell'}: Coulombic efficiency vs cycle`,
        font: { size: titleFontSize },
      },
      xaxis: {
        // The legend is now an HTML block below the plot, so the x-axis title and
        // the legend can no longer collide — always show "Cycle number".
        title: { text: 'Cycle number', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: 'Coulombic efficiency (%)', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      // Legend renders as an HTML block below the plot (see ChartLegend).
      showlegend: false,
      margin: { t: 48, r: 40, b: 80, l: 65 },
      uirevision: 'ce-vs-cycle',
    }),
    [fontFamily, titleFontSize, labelFontSize, selectedCell, ceSeriesByCell.length],
  );

  /** Detect silent cycle truncation caused by MAX_CYCLES cap. */
  const truncationWarning = useMemo(() => {
    const hits: { name: string; total: number; shown: number }[] = [];
    for (const rd of recordDatasets) {
      const allCycles = Object.keys(rd.curves)
        .map(Number)
        .filter((n) => !isNaN(n));
      if (allCycles.length === 0) continue;
      const applicable = allowedCycles
        ? allCycles.filter((c) => allowedCycles.has(c))
        : allCycles;
      const shown = Math.min(applicable.length, MAX_CYCLES);
      if (applicable.length > MAX_CYCLES) {
        hits.push({ name: rd.label, total: applicable.length, shown });
      }
    }
    return hits.length > 0 ? hits : null;
  }, [recordDatasets, allowedCycles]);

  return (
    <div className="flex flex-col gap-4 h-full">
      {/* ── Page header ── */}
      <div className="shrink-0 px-1 pt-1 flex items-baseline gap-2 flex-wrap">
        <h1 className="text-base font-semibold text-foreground flex items-center gap-1.5">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 cursor-default">
                  <span>GCD</span>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs text-xs leading-relaxed">
                <p>
                  Galvanostatic charge–discharge (GCD): a cycling protocol where a constant current is applied and
                  the cell voltage is recorded as a function of transferred charge (capacity).
                </p>
                <p className="mt-1">
                  <a
                    href="https://doi.org/10.1039/b820555h"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    Palacín, Chem. Soc. Rev. 2009, 38, 2565
                  </a>{' '}
                  ·{' '}
                  <a
                    href="https://goldbook.iupac.org/terms/view/G02574"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="underline text-primary"
                    onClick={(e) => e.stopPropagation()}
                  >
                    IUPAC definition
                  </a>
                </p>
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span>Plot</span>
        </h1>
        <p className="text-xs text-muted-foreground">Galvanostatic charge–discharge — voltage vs capacity</p>
      </div>

      {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      {cellDataError && !cellDataLoading && <p className="text-xs text-destructive">{cellDataError}</p>}

      {truncationWarning && (
        <div
          role="alert"
          className="shrink-0 flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
        >
          <span className="mt-0.5 shrink-0">⚠</span>
          <span>
            <strong>Cycle cap active ({MAX_CYCLES} cycles shown).</strong>{' '}
            {truncationWarning.map((w, i) => (
              <span key={i}>
                {w.name}: showing {w.shown} of {w.total} cycles ({w.total - w.shown} omitted).{' '}
              </span>
            ))}
            Full-resolution data is available via the source export endpoint listed in the chart download.
          </span>
        </div>
      )}

      <div className="flex-1 min-w-0 min-h-0 overflow-auto transition-all duration-300">
        <div className="space-y-2 p-3 w-full min-w-0">
          {/* ── Section: Cumulative GCD (overview) ── */}
          <div className="flex items-baseline gap-2 flex-wrap">
            {combinedGcdTraces.length > 0 && (
              <>
                <h2 className="text-sm font-medium text-foreground">All cycles (cumulative GCD)</h2>
                {/* Overview hint removed — colourbar icon is the visual affordance */}
              </>
            )}
          </div>

          {combinedGcdTraces.length > 0 && useSmallMultiples && (
            <div className="space-y-2">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-3">
                {perCellCumulative.map((p) => (
                  <div key={p.id} className="rounded-lg border border-border bg-card p-2">
                    <div className="h-[280px] w-full bg-white dark:bg-card rounded overflow-hidden">
                      {p.data.length > 0 ? (
                        <PlotlyChart
                          exportContext={exportContext}
                          key={`combined-sm-${p.id}`}
                          data={p.data}
                          layout={perCellCumulativeLayout(p.label)}
                          config={{ responsive: true }}
                          style={{ width: '100%', height: '100%' }}
                        />
                      ) : (
                        <div className="h-full flex items-center justify-center text-xs text-muted-foreground">
                          No cumulative data
                        </div>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {combinedGcdTraces.length > 0 && !useSmallMultiples && (
            <ResizableChartCard
              size={combined.size}
              onResizeStart={combined.onResizeStart}
              aspectRatio={800 / 220}
              minHeight={170}
              cardClassName="rounded-lg border border-border bg-card p-3 w-full min-w-0"
            >
              {({ width, height, ResizeHandle }) => {
                const SCALE_W = 44;
                const GAP = 12;
                const chartW = width - SCALE_W - GAP;
                return (
                  <div className="flex gap-3 items-stretch shrink-0" style={{ width, height }}>
                    <div
                      className="relative shrink-0 bg-white dark:bg-card rounded overflow-hidden"
                      style={{ width: chartW, height }}
                    >
                      <PlotlyChart
                        exportContext={exportContext}
                        key={`combined-${chartW}-${height}`}
                        data={combinedGcdTracesWithCellLabels}
                        layout={{ ...combinedGcdLayout, width: chartW, height }}
                        config={{ responsive: true }}
                        style={{ width: chartW, height, cursor: 'pointer' }}
                        onClick={(ev) => {
                          const pt = ev.points?.[0];
                          const lg = (pt?.data as { legendgroup?: string } | undefined)?.legendgroup;
                          if (!lg) return;
                          const cyc = parseInt(lg.split('-').pop() ?? '', 10);
                          if (!isNaN(cyc))
                            setCombinedHighlightCycle((prev) => (prev === cyc ? null : cyc));
                        }}
                      />
                      <ResizeHandle />
                    </div>
                    <CycleColorScale
                      cycles={combinedUniqueCycles}
                      width={SCALE_W}
                      height={height}
                      highlight={combinedHighlightCycle}
                      baseColor={recordDatasets[0]?.color}
                    />
                  </div>
                );
              }}
            </ResizableChartCard>
          )}
          {combinedHighlightCycle != null && (
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => setCombinedHighlightCycle(null)}
                className="text-[11px] px-2.5 py-1 rounded border border-border bg-muted/60 hover:bg-muted text-muted-foreground"
              >
                Clear (Cycle {combinedHighlightCycle})
              </button>
            </div>
          )}

          {/* ── Section: Per-cell GCD (zoom / detail) ── */}
          <div className="flex items-baseline gap-2 flex-wrap">
            <h2 className="text-sm font-medium text-foreground">GCD curves</h2>
            {zoomFocusCycle != null && (
              <span className="inline-flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 px-2 py-0.5 text-[11px] text-primary">
                Zoomed to cycle {zoomFocusCycle}
                <button
                  type="button"
                  onClick={() => setCombinedHighlightCycle(null)}
                  className="font-medium underline-offset-2 hover:underline"
                >
                  show all
                </button>
              </span>
            )}
          </div>

          <ResizableChartCard
            size={main.size}
            onResizeStart={main.onResizeStart}
            aspectRatio={800 / 360}
            minHeight={240}
          >
            {({ width, height, ResizeHandle }) => (
              <>
                <div className="flex items-center gap-3 mb-2 flex-wrap">
                  <Label className="text-xs text-muted-foreground shrink-0">Cycles</Label>
                  <div className="flex flex-col gap-0.5">
                    <Input
                      value={cycleFilter}
                      onChange={(e) => {
                        setCycleFilter(e.target.value);
                        // Editing the filter takes over from a single-cycle colour-scale
                        // zoom, so the box always reflects what the plot shows.
                        setCombinedHighlightCycle(null);
                      }}
                      disabled={filteredCells.length === 0}
                      placeholder={filteredCells.length === 0 ? 'Loading…' : 'All, or e.g. 1-3, 5, 10-15'}
                      aria-invalid={isFilterInvalid}
                      className={`h-9 w-48 text-xs${
                        isFilterInvalid ? ' border-destructive focus-visible:ring-destructive' : ''
                      }`}
                    />
                    {isFilterInvalid && (
                      <span className="text-[10px] text-destructive">
                        Invalid filter — showing all cycles.
                      </span>
                    )}
                  </div>
                  {/* Direction toggle controls the zoom (GCD curves) only. */}
                  <div className="ml-auto inline-flex items-center rounded-md border border-border overflow-hidden">
                    {(['discharge', 'charge', 'both'] as const).map((d, i) => (
                      <button
                        key={d}
                        type="button"
                        onClick={() => setGcdDirection(d)}
                        className={`px-3 h-7 text-[11px] capitalize transition-colors ${i > 0 ? 'border-l border-border' : ''} ${
                          gcdDirection === d
                            ? 'bg-primary text-primary-foreground'
                            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
                        }`}
                      >
                        {d}
                      </button>
                    ))}
                  </div>
                </div>
                {traces.length > 0 ? (() => {
                  // Single-cell mode colours lines by cycle, so show the Cycle
                  // 1→N scale (click to focus a cycle). It's overlaid on the
                  // plot's right margin so the chart container stays exactly the
                  // known-good full-width structure. Multi-cell colours by cell.
                  const showScale = cellsDataList.length <= 1 && gcdUniqueCycles.length > 1;
                  const SCALE_W = 46;
                  const chartLayout = {
                    ...layout,
                    width,
                    height,
                    margin: { ...(layout.margin ?? {}), r: showScale ? SCALE_W + 16 : (layout.margin?.r ?? 44) },
                  };
                  return (
                    <>
                    <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                      <div className="absolute inset-0" style={{ minWidth: 1, minHeight: 1 }}>
                        <PlotlyChart
                          exportContext={exportContext}
                          key={`gcd-${width}-${height}`}
                          data={traces}
                          layout={chartLayout}
                          config={{ responsive: true }}
                          style={{ width, height }}
                          hoverFocus={cellsDataList.length > 1}
                          traceIndexToCell={gcdTraceIndexToCell}
                          onContextMenu={(cell) => setSelectedCellIds([cell.idNo])}
                          onClick={(ev) => {
                            const pt = ev.points?.[0];
                            if (pt && selectedCell) setSelectedCellIds([selectedCell.idNo]);
                          }}
                        />
                      </div>
                      {showScale && (
                        <div className="absolute top-0 right-0 z-10" style={{ height }}>
                          <CycleColorScale
                            cycles={gcdUniqueCycles}
                            width={SCALE_W}
                            height={height}
                            highlight={combinedHighlightCycle}
                            baseColor={recordDatasets[0]?.color}
                          />
                        </div>
                      )}
                      <ChartEditPopover
                        config={appearance.config}
                        onConfigChange={appearance.onConfigChange}
                        showConnectedLineOption
                        chartLabel="GCD"
                      />
                      <ResizeHandle />
                    </div>
                    <ChartLegend
                      items={gcdLegendItems}
                      shown={appearance.config.showLegend}
                      onToggle={() => appearance.onConfigChange('showLegend', !appearance.config.showLegend)}
                      chartLabel="GCD"
                      fontSize={legendFontSize}
                    />
                    </>
                  );
                })() : cellIndexLoading || cellDataLoading ? (
                  <LoadingIndicator
                    variant="frame"
                    size="lg"
                    label="Loading cell data…"
                    minHeight={420}
                  />
                ) : cellIndex !== null && filteredCells.length > 0 && traces.length === 0 && !cellDataLoading && !selectedCell ? (
                  /* ── Onboarding empty state: index loaded, cells exist, nothing selected yet ── */
                  <div className="h-[420px] flex flex-col items-center justify-center gap-3 text-muted-foreground select-none">
                    <div className="flex items-center gap-2 text-primary/70">
                      <ArrowLeft className="h-5 w-5" />
                      <MousePointerClick className="h-6 w-6" />
                    </div>
                    <p className="text-base font-semibold text-foreground">Select a cell to begin</p>
                    <p className="text-sm text-center max-w-xs">
                      Select a cell in the sidebar to begin. GCD voltage–capacity curves will appear here.
                    </p>
                  </div>
                ) : (
                  /* ── Error / no-data states ── */
                  <div className="h-[420px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                    {cellIndex === null ? (
                      <p>No record data found.</p>
                    ) : filteredCells.length === 0 ? (
                      <p>No cells match the current filters. Try different cathode or separator settings.</p>
                    ) : (
                      <p>No V–Q data for the selected cell.</p>
                    )}
                  </div>
                )}
              </>
            )}
          </ResizableChartCard>

          {/* ── Section: Rate performance ── */}
          {visibleRatePerfCells.length > 0 && (
            <>
              <div className="flex items-center gap-2 min-h-[1.5rem]">
                <h2 className="text-sm font-medium text-foreground">Rate performance</h2>
              </div>
              <ResizableChartCard
                size={ratePerf.size}
                onResizeStart={ratePerf.onResizeStart}
                aspectRatio={800 / 360}
                minHeight={240}
              >
                {({ width, height, ResizeHandle }) => (
                  <>
                    <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                      <RatePerformancePlot
                        filteredCells={visibleRatePerfCells}
                        analysis={activeAnalysis ?? EMPTY_ANALYSIS}
                        treeFilterPath={treeFilterPath}
                        pathToColorMap={ratePerfPathToColorMap}
                        direction="discharge"
                        detailDepth={0}
                        metadataByIdNo={metadataByIdNo}
                        showConnectedLine={ratePerfAppearance.config.showConnectedLine ?? false}
                        config={ratePerfAppearance.config}
                        width={width}
                        height={height}
                        onLegendItems={handleRatePerfLegendItems}
                      />
                      <ChartEditPopover
                        config={ratePerfAppearance.config}
                        onConfigChange={ratePerfAppearance.onConfigChange}
                        showConnectedLineOption
                        chartLabel="Rate performance"
                      />
                      <ResizeHandle />
                    </div>
                    <ChartLegend
                      items={ratePerfLegendItems}
                      shown={ratePerfLegendShown}
                      onToggle={() => setRatePerfLegendShown((v) => !v)}
                      chartLabel="Rate performance"
                      fontSize={legendFontSize}
                    />
                  </>
                )}
              </ResizableChartCard>
            </>
          )}

          {/* ── Section: Coulombic efficiency vs cycle ── */}
          {ceTraces.length > 0 && (
            <>
              <div className="flex items-center gap-2 min-h-[1.5rem]">
                <h2 className="text-sm font-medium text-foreground">Coulombic efficiency vs cycle</h2>
              </div>
              {protocolMismatch && (
                <div
                  role="alert"
                  className="flex items-start gap-2 rounded-md border border-amber-400 bg-amber-50 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300"
                >
                  <span className="mt-0.5 shrink-0">⚠</span>
                  <span>
                    Comparing cells run under <strong>different cycling protocols</strong> — a CE
                    difference may reflect the protocol (C-rate, voltage window, CV hold), not the
                    cells. Compare CE only within a matched protocol.
                  </span>
                </div>
              )}
              <ResizableChartCard
                size={ceCycle.size}
                onResizeStart={ceCycle.onResizeStart}
                aspectRatio={800 / 320}
                minHeight={220}
              >
                {({ width, height, ResizeHandle }) => (
                  <>
                  <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                    <PlotlyChart
                      exportContext={exportContext}
                      key={`ce-${width}-${height}`}
                      data={ceTraces}
                      layout={{ ...ceLayout, width, height }}
                      config={{ responsive: true }}
                      style={{ width, height }}
                    />
                    <ResizeHandle />
                  </div>
                  <ChartLegend
                    items={ceLegendItems}
                    shown={ceLegendShown}
                    onToggle={() => setCeLegendShown((v) => !v)}
                    chartLabel="Coulombic efficiency"
                    fontSize={legendFontSize}
                  />
                  </>
                )}
              </ResizableChartCard>
            </>
          )}
        </div>
      </div>
    </div>
  );
};

export default GcdDashboard;
