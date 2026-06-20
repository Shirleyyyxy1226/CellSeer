import { useMemo, useState } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import { turboColor } from '@/lib/turboColormap';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { getColorForCell } from '@/lib/ratePerfAggregation';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { ChartEditPopover } from '@/components/ChartEditPopover';
import { ResizableChartCard } from '@/components/ResizableChartCard';
import { CycleColorScale } from '@/components/CycleColorScale';
import { DirectionToggle, type ChargeDirection } from '@/components/DirectionToggle';
import { ArrowLeft, Info, MousePointerClick } from 'lucide-react';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from '@/components/ui/tooltip';
import { useChartAppearance } from '@/hooks/useChartAppearance';
import { useResizableChart } from '@/hooks/useResizableChart';
import { parseCycleFilter } from '@/lib/cycleFilter';
import {
  buildGcdCumulativeFigure,
  buildGcdFigure,
  buildRatePerformanceFigure,
  buildVoltageTimeFigure,
  type RatePerfTraceSpec,
  type RecordDataset,
} from 'cellseer-lib';
import { useGcdCellData, type VQCell } from './useGcdCellData';

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
const INITIAL_V_MAX_CYCLES = 5;
// Above this many traces a per-cycle discrete legend can't fit under the plot
// without occluding the axis title; cycles read from the colour gradient instead.
const GCD_LEGEND_MAX_ITEMS = 8;

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
    cellsDataList,
    selectedCell,
    selectedCellData,
    cycleFilter,
    setCycleFilter,
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
    showConnectedLine: false,
  });
  const {
    chartTitle,
    xAxisLabel,
    yAxisLabel,
    fontFamily,
    titleFontSize,
    labelFontSize,
    legendFontSize,
    showLegend,
    legendPosition,
    showConnectedLine,
  } = appearance.config;

  const [gcdDirection, setGcdDirection] = useState<ChargeDirection>('discharge');
  const [combinedHighlightCycle, setCombinedHighlightCycle] = useState<number | null>(null);
  // Collapsible legend: local control, default shown. When collapsed every chart
  // hides its (below-the-plot) legend and reclaims the reserved bottom margin.
  const [legendShown, setLegendShown] = useState(true);

  const main = useResizableChart();
  const combined = useResizableChart();
  const ratePerf = useResizableChart();
  const initialVoltage = useResizableChart();

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

  const recordDatasets = useMemo<RecordDataset[]>(() => {
    return cellsDataList
      .filter((cellData) => !!cellData?.curves)
      .map((cellData: VQCell) => {
        return {
          id: String(cellData.idNo),
          label: cellData.cellName ?? `Cell ${cellData.idNo}`,
          // Canonical identity colour — matches the hierarchy tree and sidebar.
          color: getColorForCell(cellData, treeFilterPath, hierCols),
          cathodeMassG: cellData.cathodeMassG ?? null,
          curves: cellData.curves,
        };
      });
  }, [cellsDataList, treeFilterPath, hierCols]);

  const { traces, gcdTraceIndexToCell } = useMemo(() => {
    try {
      const fig = buildGcdFigure(recordDatasets, {
        mode: 'scatter',
        direction: gcdDirection,
        showConnectedLine,
        allowedCycles: allowedCycles ?? null,
        maxCycles: MAX_CYCLES,
        maxPointsPerTrace: MAX_PTS_TRACE,
      });
      const traceIndexMap = new Map<number, { idNo: number; cellName: string }>();
      fig.traceIndexToCell.forEach((value, key) => {
        traceIndexMap.set(key, { idNo: Number(value.id), cellName: value.label });
      });
      return { traces: fig.data, gcdTraceIndexToCell: traceIndexMap };
    } catch (e) {
      console.warn('VoltageCapacityPanel: error building traces', e);
      return { traces: [] as Plotly.Data[], gcdTraceIndexToCell: new Map<number, { idNo: number; cellName: string }>() };
    }
  }, [recordDatasets, allowedCycles, showConnectedLine, gcdDirection]);

  const combinedGcdTraces = useMemo((): Plotly.Data[] => {
    try {
      const fig = buildGcdCumulativeFigure(recordDatasets, {
        direction: gcdDirection,
        allowedCycles: allowedCycles ?? null,
        highlightCycle: combinedHighlightCycle,
        maxCycles: MAX_CYCLES,
        maxPointsPerTrace: MAX_PTS_TRACE,
      });
      return fig.data;
    } catch (e) {
      console.warn('VoltageCapacityPanel: error building combined traces', e);
      return [];
    }
  }, [recordDatasets, allowedCycles, combinedHighlightCycle, gcdDirection]);

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
  const someCellsHaveMass = useMemo(
    () => recordDatasets.some((rd) => rd.cathodeMassG != null && rd.cathodeMassG > 0),
    [recordDatasets],
  );
  const cumulativeXLabel = allCellsHaveMass
    ? 'Cumulative specific capacity (mAh g⁻¹)'
    : 'Cumulative capacity (mAh)';
  const cumulativeBasisBadge = allCellsHaveMass
    ? 'mass-normalised'
    : someCellsHaveMass
    ? 'mixed (some cells lack mass)'
    : 'raw mAh';

  const combinedGcdLayout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 360,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: {
        text:
          cellsDataList.length > 1
            ? `${cellsDataList.length} cells: All cycles`
            : selectedCell
              ? `${selectedCell.cellName}: All cycles`
              : 'All cycles',
        font: { size: titleFontSize },
      },
      xaxis: {
        title: {
          text: cumulativeXLabel,
          font: { size: labelFontSize },
        },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: 'Voltage (V)', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      showlegend: cellsDataList.length > 1 && legendShown,
      // Legend forced below the plot (horizontal row under the x-axis).
      legend: cellsDataList.length > 1 && legendShown
        ? { orientation: 'h' as const, x: 0, y: -0.2, xanchor: 'left' as const, yanchor: 'top' as const, font: { size: 10 } }
        : undefined,
      margin: { t: 48, r: 44, b: cellsDataList.length > 1 && legendShown ? 120 : 80, l: 65 },
      uirevision: 'combined-gcd',
    }),
    [fontFamily, titleFontSize, labelFontSize, selectedCell, cumulativeXLabel, cellsDataList.length, legendShown],
  );

  const initialVoltageTraces = useMemo((): Plotly.Data[] => {
    const datasets: RecordDataset[] = recordDatasets.map((rd) => {
      if (!allowedCycles) return rd;
      const filtered: Record<string, typeof rd.curves[string]> = {};
      Object.entries(rd.curves).forEach(([key, value]) => {
        const c = parseInt(key, 10);
        if (!isNaN(c) && allowedCycles.has(c)) filtered[key] = value;
      });
      return { ...rd, curves: filtered };
    });
    return buildVoltageTimeFigure(datasets, { maxCycles: INITIAL_V_MAX_CYCLES }).data;
  }, [recordDatasets, allowedCycles]);

  const initialVoltageLayout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 320,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: {
        text: `${selectedCell?.cellName ?? 'Cell'}: Voltage vs time (first few cycles)`,
        font: { size: titleFontSize },
      },
      xaxis: {
        title: { text: 'Time (s)', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: 'Voltage (V)', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      showlegend: legendShown,
      // Legend forced below the plot (horizontal row under the x-axis); the
      // collapse toggle hides it and reclaims the reserved bottom margin.
      legend: legendShown
        ? { orientation: 'h' as const, x: 0, y: -0.2, xanchor: 'left' as const, yanchor: 'top' as const, font: { size: legendFontSize } }
        : undefined,
      margin: { t: 48, r: 44, b: legendShown ? 120 : 80, l: 65 },
      uirevision: 'initial-voltage',
    }),
    [fontFamily, titleFontSize, labelFontSize, legendFontSize, selectedCell, legendShown],
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
      // A per-cycle GCD shows one trace PER CYCLE. A discrete legend with dozens
      // of "Cycle N" rows can't fit under a fixed-height plot — it collides with
      // the x-axis title and overflows the card. Cycles are sequential and already
      // read from the colour gradient (and the companion "All cycles" colourbar),
      // so past a small count we simply omit the discrete legend.
      showlegend: showLegend && legendShown && traces.length <= GCD_LEGEND_MAX_ITEMS,
      // 'in' (compact, inside top-right — kept as a popover option) vs the default
      // 'below' (horizontal row under the x-axis, never in the right gutter).
      legend:
        showLegend && legendShown && traces.length <= GCD_LEGEND_MAX_ITEMS
          ? legendPosition === 'in'
            ? {
                orientation: 'v' as const,
                font: { size: legendFontSize },
                x: 0.99,
                y: 1,
                xanchor: 'right' as const,
                yanchor: 'top' as const,
                bgcolor: 'rgba(255,255,255,0.9)',
              }
            : {
                orientation: 'h' as const,
                font: { size: legendFontSize },
                x: 0,
                // Sit well clear of the x-axis title so the two never overlap.
                y: -0.32,
                xanchor: 'left' as const,
                yanchor: 'top' as const,
              }
          : undefined,
      margin: {
        t: 48,
        r: 44,
        b:
          showLegend && legendShown && legendPosition !== 'in' && traces.length <= GCD_LEGEND_MAX_ITEMS
            ? 150
            : 80,
        l: 65,
      },
      uirevision: 'voltage-capacity',
    }),
    [
      effectiveTitle,
      effectiveXLabel,
      yAxisLabel,
      fontFamily,
      titleFontSize,
      labelFontSize,
      legendFontSize,
      showLegend,
      legendPosition,
      legendShown,
      traces.length,
    ],
  );

  const ratePerfFig = useMemo(() => {
    if (!selectedCellRatePerf) return null;
    const row = selectedCellRatePerf;
    const hasCrate = !!(row.cRates && row.cRates.length === row.cycles.length);
    const useSpec = row.specificCapacityMahG != null;
    const traceSpec: RatePerfTraceSpec[] = [
      {
        name: row.cellName,
        x: row.cycles,
        y: row.specificCapacityMahG ?? row.dischargeCapacityMah,
        color: turboColor(0),
        hasCrate,
        cRates: hasCrate ? row.cRates : undefined,
        cell: { idNo: row.idNo, cellName: row.cellName },
      },
    ];
    return buildRatePerformanceFigure(traceSpec, {
      direction: 'discharge',
      useSpecificCapacity: useSpec,
      showConnectedLine,
      protocolSegments: row.protocolSegments,
    });
  }, [selectedCellRatePerf, showConnectedLine]);

  const ratePerfLayout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 360,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: {
        text: `${selectedCellRatePerf?.cellName ?? 'Rate performance'}: discharge capacity vs cycle`,
        font: { size: titleFontSize },
      },
      xaxis: {
        title: { text: 'Cycle number', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: 'Capacity (mAh g⁻¹)', font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      showlegend: false,
      margin: { t: 48, r: 40, b: 80, l: 65 },
      uirevision: 'rate-perf-gcd',
      shapes: ratePerfFig?.shapes ?? [],
      annotations: ratePerfFig?.annotations ?? [],
    }),
    [fontFamily, titleFontSize, labelFontSize, selectedCellRatePerf, ratePerfFig],
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
      <div className="shrink-0 px-1 pt-1">
        <h1 className="text-lg font-semibold text-foreground flex items-center gap-1.5">
          <TooltipProvider delayDuration={150}>
            <Tooltip>
              <TooltipTrigger asChild>
                <span className="flex items-center gap-1 cursor-default">
                  <span>GCD</span>
                  <Info className="h-3.5 w-3.5 text-muted-foreground" />
                </span>
              </TooltipTrigger>
              <TooltipContent side="right" className="max-w-xs">
                Galvanostatic charge–discharge: a cycling protocol where a constant current is applied and voltage is recorded as a function of transferred charge (capacity).
              </TooltipContent>
            </Tooltip>
          </TooltipProvider>
          <span>Plot</span>
        </h1>
        <p className="text-xs text-muted-foreground mt-0.5">
          Galvanostatic charge–discharge — voltage vs capacity
        </p>
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
        <div className="space-y-4 p-4 w-full min-w-0">
          {/* Direction toggle: only rendered once at least one chart exists */}
          {(combinedGcdTraces.length > 0 || traces.length > 0) && (
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-xs text-muted-foreground shrink-0">
                Curve direction (GCD charts only — does not affect rate performance):
              </span>
              <DirectionToggle value={gcdDirection} onChange={setGcdDirection} />
              <button
                type="button"
                onClick={() => setLegendShown((v) => !v)}
                aria-pressed={legendShown}
                className="ml-auto shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 transition-colors"
                title={legendShown ? 'Hide the legend below the plots' : 'Show the legend below the plots'}
              >
                {legendShown ? 'Legend ▾' : 'Legend ▸'}
              </button>
            </div>
          )}

          {/* ── Section: Cumulative GCD ── */}
          <div className="flex items-center gap-2 min-h-[1.5rem]">
            {combinedGcdTraces.length > 0 && (
              <h2 className="text-sm font-medium text-foreground">All cycles (cumulative GCD)</h2>
            )}
          </div>

          {combinedGcdTraces.length > 0 && (
            <ResizableChartCard
              size={combined.size}
              onResizeStart={combined.onResizeStart}
              aspectRatio={800 / 360}
              minHeight={240}
              cardClassName="rounded-lg border border-border bg-card p-4 w-full min-w-0"
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
                      <div className="absolute top-2 left-2 z-10 flex items-center gap-1 pointer-events-none">
                        <span className="text-[9px] px-1.5 py-0.5 rounded bg-muted/80 text-muted-foreground">
                          Basis: {cumulativeBasisBadge}
                        </span>
                      </div>
                      <PlotlyChart
                        exportContext={exportContext}
                        key={`combined-${chartW}-${height}`}
                        data={combinedGcdTracesWithCellLabels}
                        layout={{ ...combinedGcdLayout, width: chartW, height }}
                        config={{ responsive: true }}
                        style={{ width: chartW, height }}
                      />
                      {combinedHighlightCycle != null && (
                        <button
                          type="button"
                          onClick={() => setCombinedHighlightCycle(null)}
                          className="absolute bottom-2 right-2 z-10 text-[10px] px-2 py-1 rounded bg-muted/80 hover:bg-muted"
                        >
                          Clear (Cycle {combinedHighlightCycle})
                        </button>
                      )}
                      <ResizeHandle />
                    </div>
                    <CycleColorScale
                      cycles={combinedUniqueCycles}
                      width={SCALE_W}
                      height={height}
                      highlight={combinedHighlightCycle}
                      onHighlight={setCombinedHighlightCycle}
                    />
                  </div>
                );
              }}
            </ResizableChartCard>
          )}

          {/* ── Section: Per-cell GCD ── */}
          <h2 className="text-sm font-medium text-foreground">GCD curves</h2>

          <ResizableChartCard
            size={main.size}
            onResizeStart={main.onResizeStart}
            aspectRatio={800 / 480}
            minHeight={280}
          >
            {({ width, height, ResizeHandle }) => (
              <>
                <div className="flex items-center gap-3 mb-4 flex-wrap">
                  <Label className="text-xs text-muted-foreground shrink-0">Cycles</Label>
                  <div className="flex flex-col gap-0.5">
                    <Input
                      value={cycleFilter}
                      onChange={(e) => setCycleFilter(e.target.value)}
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
                </div>
                {traces.length > 0 ? (
                  <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                    <div className="absolute inset-0" style={{ minWidth: 1, minHeight: 1 }}>
                      <PlotlyChart
                        exportContext={exportContext}
                        key={`gcd-${width}-${height}`}
                        data={traces}
                        layout={{ ...layout, width, height }}
                        config={{ responsive: true }}
                        style={{ width, height }}
                        traceIndexToCell={gcdTraceIndexToCell}
                        onContextMenu={(cell) => setSelectedCellIds([cell.idNo])}
                        onClick={(ev) => {
                          const pt = ev.points?.[0];
                          if (pt && selectedCell) setSelectedCellIds([selectedCell.idNo]);
                        }}
                      />
                    </div>
                    <ChartEditPopover
                      config={appearance.config}
                      onConfigChange={appearance.onConfigChange}
                      showConnectedLineOption
                      chartLabel="GCD"
                    />
                    <ResizeHandle />
                  </div>
                ) : cellIndexLoading || cellDataLoading ? (
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
          <div className="flex items-center gap-2 min-h-[1.5rem]">
            {ratePerfFig && ratePerfFig.data.length > 0 && (
              <h2 className="text-sm font-medium text-foreground">Rate performance</h2>
            )}
          </div>

          {ratePerfFig && ratePerfFig.data.length > 0 && (
            <ResizableChartCard
              size={ratePerf.size}
              onResizeStart={ratePerf.onResizeStart}
              aspectRatio={800 / 360}
              minHeight={240}
            >
              {({ width, height, ResizeHandle }) => (
                <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                  <PlotlyChart
                        exportContext={exportContext}
                    key={`rateperf-${width}-${height}`}
                    data={ratePerfFig.data}
                    layout={{ ...ratePerfLayout, width, height }}
                    config={{ responsive: true }}
                    style={{ width, height }}
                  />
                  <ChartEditPopover
                    config={appearance.config}
                    onConfigChange={appearance.onConfigChange}
                    showConnectedLineOption
                    chartLabel="Rate performance"
                  />
                  <ResizeHandle />
                </div>
              )}
            </ResizableChartCard>
          )}

          {/* ── Section: Initial voltage transient ── */}
          <div className="flex items-center gap-2 min-h-[1.5rem]">
            {initialVoltageTraces.length > 0 && (
              <h2 className="text-sm font-medium text-foreground">Voltage vs time (first {INITIAL_V_MAX_CYCLES} cycles)</h2>
            )}
          </div>

          {initialVoltageTraces.length > 0 && (
            <ResizableChartCard
              size={initialVoltage.size}
              onResizeStart={initialVoltage.onResizeStart}
              aspectRatio={800 / 320}
              minHeight={200}
              minWidth={500}
              cardClassName="rounded-lg border border-border bg-card p-4 w-full min-w-0"
            >
              {({ width, height, ResizeHandle }) => (
                <div className="relative bg-white dark:bg-card rounded overflow-hidden" style={{ width, height }}>
                  <PlotlyChart
                        exportContext={exportContext}
                    key={`initial-${width}-${height}`}
                    data={initialVoltageTraces}
                    layout={{ ...initialVoltageLayout, width, height }}
                    config={{ responsive: true }}
                    style={{ width, height }}
                  />
                  <ChartEditPopover
                    config={appearance.config}
                    onConfigChange={appearance.onConfigChange}
                    chartLabel="Initial voltage"
                  />
                  <ResizeHandle />
                </div>
              )}
            </ResizableChartCard>
          )}
        </div>
      </div>
    </div>
  );
};

export default GcdDashboard;
