import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { Slider } from '@/components/ui/slider';
import { DirectionToggle, type ChargeDirection } from '@/components/DirectionToggle';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { useDifferentialData } from './useDifferentialData';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { getColorForCell } from '@/lib/ratePerfAggregation';
import { Surface3dPlot } from './plots/Surface3dPlot';
import { PeakAnalysisPlot } from './plots/PeakAnalysisPlot';
import { buildDqDvFigure, type Dataset } from 'cellseer-lib';
import { ResizableChartCard } from '@/components/ResizableChartCard';
import { ChartEditPopover } from '@/components/ChartEditPopover';
import { useResizableChart } from '@/hooks/useResizableChart';
import { useChartAppearance } from '@/hooks/useChartAppearance';
import type { ExportContext } from '@/lib/exportUtils';

interface Props {
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
}

const DqDvDashboard = ({ cathodeFilter, spacerFilter, separatorFilter }: Props) => {
  const { multiselectionMode, selectedCellIds } = useCellSelection();
  const { treeFilterPath } = useTreeFilter();
  const [direction, setDirection] = useState<ChargeDirection>('discharge');
  const TRACE_WARN_THRESHOLD = 200;
  const [heavyRenderConfirmed, setHeavyRenderConfirmed] = useState(false);
  const { dqdvData, cells, loading, error, noDifferentialHint, noFilterMatch, totalAvailableCells } = useDifferentialData(
    cathodeFilter,
    spacerFilter,
    separatorFilter,
    direction,
    selectedCellIds,
  );
  const data = dqdvData;
  const { apiData, matchPathToIdNos } = useProjectHierarchy();
  const activeAnalysis = apiData?.analysis ?? null;

  const pathToColorMap = useMemo(
    () => apiData?.pathToColorMap && Object.keys(apiData.pathToColorMap).length > 0
      ? new Map(Object.entries(apiData.pathToColorMap))
      : new Map<string, string>(),
    [apiData?.pathToColorMap]
  );

  const cycles = useMemo(() => data?.cycles ?? [], [data?.cycles]);
  const closestCycleIndex = useCallback((num: number): number => {
    if (cycles.length === 0) return 0;
    let best = 0;
    let bestDiff = Math.abs(cycles[0] - num);
    for (let i = 1; i < cycles.length; i++) {
      const d = Math.abs(cycles[i] - num);
      if (d < bestDiff) { bestDiff = d; best = i; }
    }
    return best;
  }, [cycles]);
  const [cycleIndex, setCycleIndex] = useState(Math.max(0, cycles.length - 1));
  const [cycleInput, setCycleInput] = useState(() => String(cycles[cycles.length - 1] ?? 0));
  const selectedCycle = cycles[cycleIndex] ?? 0;

  useEffect(() => {
    const lastIdx = Math.max(0, cycles.length - 1);
    setCycleIndex((prev) => Math.min(prev, lastIdx));
    setCycleInput(String(cycles[lastIdx] ?? 0));
  }, [cycles]);

  useEffect(() => setCycleInput(String(selectedCycle)), [selectedCycle]);

  const [snapNote, setSnapNote] = useState<string | null>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitCycleInput = useCallback(() => {
    if (cycles.length === 0) return;
    const num = parseInt(cycleInput, 10);
    if (Number.isNaN(num)) { setCycleInput(String(selectedCycle)); return; }
    const best = closestCycleIndex(num);
    const resolvedCycle = cycles[best];
    if (resolvedCycle !== num) {
      setSnapNote(`Snapped to cycle ${resolvedCycle}`);
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      snapTimerRef.current = setTimeout(() => setSnapNote(null), 2500);
    }
    setCycleIndex(best);
    setCycleInput(String(resolvedCycle));
  }, [cycleInput, selectedCycle, cycles, closestCycleIndex]);

  const filteredCellIds = useMemo(() => {
    const allIds = new Set((data?.cellData ?? []).map((cd) => cd.cell.id));
    if (multiselectionMode && selectedCellIds.length > 0) {
      const selIds = new Set(cells.filter((c) => selectedCellIds.includes(c.idNo)).map((c) => c.cellId));
      return new Set([...allIds].filter((id) => selIds.has(id)));
    }
    if (treeFilterPath.length > 0) {
      const matchedIdNos = matchPathToIdNos(treeFilterPath);
      if (matchedIdNos && matchedIdNos.size > 0) {
        const treeIds = new Set(cells.filter((c) => matchedIdNos.has(c.idNo)).map((c) => c.cellId));
        return new Set([...allIds].filter((id) => treeIds.has(id)));
      }
      if (!multiselectionMode && selectedCellIds.length > 0) {
        const selIds = new Set(cells.filter((c) => selectedCellIds.includes(c.idNo)).map((c) => c.cellId));
        return new Set([...allIds].filter((id) => selIds.has(id)));
      }
      return new Set<string>();
    }
    return allIds;
  }, [data?.cellData, cells, treeFilterPath, multiselectionMode, selectedCellIds, matchPathToIdNos]);

  const hierCols = useMemo(() => activeAnalysis?.hierCols ?? [], [activeAnalysis?.hierCols]);

  const datasets = useMemo<Dataset[]>(() => {
    if (!data?.cellData?.length) return [];
    return data.cellData
      .filter((cd) => filteredCellIds.has(cd.cell.id))
      .map((cd) => {
        const cellMatch = cells.find((c) => c.cellId === cd.cell.id);
        const color = cellMatch
          ? getColorForCell(cellMatch, treeFilterPath, hierCols, pathToColorMap)
          : cd.cell.color;
        return {
          id: cd.cell.id,
          label: cd.cell.name,
          color,
          cycles: cd.cycleTraces.map((ct) => ({
            cycle: ct.cycle,
            x: data.voltages,
            y: ct.dqdv,
          })),
        };
      });
  }, [data, filteredCellIds, cells, treeFilterPath, hierCols, pathToColorMap]);

  const estimatedTraceCount = useMemo(
    () => datasets.reduce((acc, d) => acc + d.cycles.length, 0),
    [datasets],
  );
  const isHeavy3D = estimatedTraceCount > TRACE_WARN_THRESHOLD;
  // Reset confirmation whenever the dataset changes
  useEffect(() => { setHeavyRenderConfirmed(false); }, [datasets]);

  const { data: traces3d, layout: layout3D } = useMemo(
    () => buildDqDvFigure(datasets, { mode: '3d', cycleIndex }),
    [datasets, cycleIndex]
  );
  const { data: traces2d, layout: layout2D } = useMemo(
    () => buildDqDvFigure(datasets, {
      mode: '2d',
      viewMode: 'range',
      cycleIndex,
      selectedCycle,
    }),
    [datasets, cycleIndex, selectedCycle]
  );

  const exportContext = useMemo<ExportContext>(
    () => ({
      plotType: 'dqdv',
      sourceCellIds: datasets.map((d) => d.id),
      sourceEndpoints: datasets.map((d) =>
        new URL(`/api/cell-record/${encodeURIComponent(d.id)}/differential?direction=${direction}`, window.location.origin).toString(),
      ),
      settings: { direction },
    }),
    [datasets, direction],
  );

  const directionLabel = direction === 'charge' ? 'Charge' : 'Discharge';
  const title2d = `dQ/dV vs voltage — ${directionLabel.toLowerCase()} (all cycles · selected cycle highlighted)`;
  const title3d = `Incremental capacity (dQ/dV) — ${directionLabel.toLowerCase()}`;

  const surfaceChart = useResizableChart();
  const peakChart = useResizableChart();
  const surfaceAppearance = useChartAppearance({
    chartTitle: title3d,
    xAxisLabel: 'Voltage (V)',
    yAxisLabel: 'dQ/dV (mAh V⁻¹)',
    titleFontSize: 11,
    labelFontSize: 10,
    legendFontSize: 10,
  });
  const peakAppearance = useChartAppearance({
    chartTitle: title2d,
    xAxisLabel: 'Voltage (V)',
    yAxisLabel: 'dQ/dV (mAh V⁻¹)',
    titleFontSize: 11,
    labelFontSize: 10,
    legendFontSize: 10,
  });
  useEffect(() => { surfaceAppearance.setChartTitle(title3d); }, [title3d, surfaceAppearance]);
  useEffect(() => { peakAppearance.setChartTitle(title2d); }, [title2d, peakAppearance]);

  // Collapsible legend: local control, default shown. Forced below the plot in
  // the plot components; this gates visibility (and honours the popover's own
  // showLegend). When collapsed the bottom margin shrinks and the plot reclaims it.
  const [legendShown, setLegendShown] = useState(true);
  const surfaceConfig = useMemo(
    () => ({ ...surfaceAppearance.config, showLegend: surfaceAppearance.config.showLegend && legendShown }),
    [surfaceAppearance.config, legendShown],
  );
  const peakConfig = useMemo(
    () => ({ ...peakAppearance.config, showLegend: peakAppearance.config.showLegend && legendShown }),
    [peakAppearance.config, legendShown],
  );

  // Determine whether there is anything to plot yet
  const hasTraces = datasets.length > 0;
  const isInFlight = loading;

  // Empty-state shown when the fetch has settled with no data
  const EmptyState = (
    <div className="flex flex-col items-center justify-center gap-3 text-center h-full min-h-[420px] px-8">
      <svg
        xmlns="http://www.w3.org/2000/svg"
        className="h-10 w-10 text-muted-foreground/50"
        fill="none"
        viewBox="0 0 24 24"
        stroke="currentColor"
        strokeWidth={1.5}
        aria-hidden="true"
      >
        <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
      </svg>
      <p className="text-base font-medium text-foreground">
        Select one or more cells in the sidebar to plot dQ/dV curves
      </p>
      <p className="text-sm text-muted-foreground max-w-xs">
        Use the hierarchy tree on the left to pick individual cells or a
        condition group, then switch to this tab.
      </p>
    </div>
  );

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm flex flex-col gap-3 h-full min-h-0">
      {error && !loading && <p className="text-sm text-amber-600">Database unavailable: {error}</p>}
      {!loading && (noDifferentialHint || noFilterMatch) && (
        <div className="flex flex-col items-center justify-center gap-2 rounded-lg border border-dashed border-border bg-muted/30 px-6 py-10 text-center">
          <span className="text-3xl" aria-hidden="true">&#128202;</span>
          {noFilterMatch ? (
            <>
              <p className="font-semibold text-sm text-foreground">
                No cells with dQ/dV data match the current filters.
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Try clearing or changing the cathode, spacer, or separator filter.
              </p>
            </>
          ) : (
            <>
              <p className="font-semibold text-sm text-foreground">
                No dQ/dV data found for the selected cells.
              </p>
              <p className="text-xs text-muted-foreground max-w-sm">
                Select a cell with cycling data from the hierarchy tree.
              </p>
            </>
          )}
        </div>
      )}
      {/* Auto-load cap indicator — only shown when fewer cells are displayed than available */}
      {!loading && datasets.length > 0 && datasets.length < totalAvailableCells && (
        <div className="flex items-center gap-2 rounded-md border border-amber-300 bg-amber-50 dark:border-amber-700 dark:bg-amber-950/30 px-3 py-2 text-xs text-amber-800 dark:text-amber-300">
          <svg xmlns="http://www.w3.org/2000/svg" className="h-4 w-4 shrink-0" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
          </svg>
          <span>
            <strong>Showing {datasets.length} of {totalAvailableCells} cells</strong> — select specific cells in the sidebar tree to override the default limit.
          </span>
        </div>
      )}
      <div className="flex items-center justify-end gap-3 shrink-0 flex-wrap">
        <button
          type="button"
          onClick={() => setLegendShown((v) => !v)}
          aria-pressed={legendShown}
          className="shrink-0 rounded-md border border-border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted/60 transition-colors"
          title={legendShown ? 'Hide the legend below the plots' : 'Show the legend below the plots'}
        >
          {legendShown ? 'Legend ▾' : 'Legend ▸'}
        </button>
        <DirectionToggle value={direction} onChange={setDirection} />
      </div>
      <div className="grid grid-cols-1 gap-3 flex-1 min-h-[520px] lg:grid-cols-2">
        <ResizableChartCard
          size={surfaceChart.size}
          onResizeStart={surfaceChart.onResizeStart}
          aspectRatio={1}
          minHeight={420}
          fillHeight
        >
          {({ width, height, ResizeHandle }) => isInFlight ? (
            <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
              <LoadingIndicator variant="frame" size="lg" label="Loading cell data from database…" />
              <ResizeHandle />
            </div>
          ) : !hasTraces ? (
            <div className="relative bg-white dark:bg-card rounded flex items-center justify-center" style={{ width, height }}>
              {EmptyState}
              <ResizeHandle />
            </div>
          ) : (
            <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
              {isHeavy3D && !heavyRenderConfirmed ? (
                <div className="flex flex-col items-center justify-center gap-4 h-full min-h-[420px] px-8 text-center">
                  <svg xmlns="http://www.w3.org/2000/svg" className="h-10 w-10 text-amber-500" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2} aria-hidden="true">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                  </svg>
                  <p className="font-semibold text-foreground">
                    Large 3D scene — {estimatedTraceCount} traces
                  </p>
                  <p className="text-sm text-muted-foreground max-w-xs">
                    Rendering this many WebGL traces may freeze the browser. Consider
                    reducing the cell or cycle selection before proceeding.
                  </p>
                  <button
                    type="button"
                    onClick={() => setHeavyRenderConfirmed(true)}
                    className="rounded-md bg-amber-500 px-4 py-2 text-sm font-medium text-white hover:bg-amber-600 transition-colors"
                  >
                    Render anyway ({estimatedTraceCount} traces)
                  </button>
                </div>
              ) : (
                <Surface3dPlot
                  traces={traces3d}
                  xValues={data?.voltages ?? []}
                  appearance={surfaceConfig}
                  uirevision="dqdv-3d"
                  layoutOverride={layout3D}
                  width={width}
                  height={height}
                  exportContext={exportContext}
                />
              )}
              <ChartEditPopover
                config={surfaceAppearance.config}
                onConfigChange={surfaceAppearance.onConfigChange}
                chartLabel="3D surface"
              />
              <ResizeHandle />
            </div>
          )}
        </ResizableChartCard>
        <ResizableChartCard
          size={peakChart.size}
          onResizeStart={peakChart.onResizeStart}
          aspectRatio={1}
          minHeight={420}
          fillHeight
        >
          {({ width, height, ResizeHandle }) => {
            // The cycle-picker control lives inside this card under the plot, so
            // when filling the cell height we reserve room for it and give the
            // rest to the plot — keeping both cards the same overall height.
            const CONTROL_H = 72;
            const plotH = peakChart.size ? height : Math.max(240, height - CONTROL_H);
            return (
            <div className="flex flex-col gap-2 h-full" style={{ width }}>
              <div className="relative bg-white dark:bg-card rounded" style={{ width, height: plotH }}>
                {loading ? (
                  <LoadingIndicator
                    variant="frame"
                    size="lg"
                    label="Loading cell data from database…"
                  />
                ) : (
                  <>
                    <PeakAnalysisPlot
                      traces={traces2d}
                      appearance={peakConfig}
                      uirevision="dqdv-2d"
                      layoutOverride={layout2D}
                      width={width}
                      height={plotH}
                      exportContext={exportContext}
                    />
                    <ChartEditPopover
                      config={peakAppearance.config}
                      onConfigChange={peakAppearance.onConfigChange}
                      chartLabel="Peak analysis"
                    />
                  </>
                )}
                <ResizeHandle />
              </div>
              <div className="flex flex-col gap-1 pt-1 shrink-0">
                <div className="flex items-center gap-3">
                  <label htmlFor="dqdv-cycle-input" className="text-xs text-muted-foreground whitespace-nowrap">
                    Cycle number
                  </label>
                  <Slider
                    value={[cycleIndex]}
                    onValueChange={([v]) => { setCycleIndex(v); setCycleInput(String(cycles[v])); }}
                    min={0}
                    max={Math.max(0, cycles.length - 1)}
                    step={1}
                    className="flex-1"
                    aria-label="Select cycle number"
                  />
                  <span className="text-xs font-semibold tabular-nums text-foreground w-10 text-right shrink-0">
                    {selectedCycle}
                  </span>
                  <input
                    id="dqdv-cycle-input"
                    type="text"
                    inputMode="numeric"
                    value={cycleInput}
                    onChange={(e) => setCycleInput(e.target.value)}
                    onBlur={commitCycleInput}
                    onKeyDown={(e) => e.key === 'Enter' && commitCycleInput()}
                    className="w-14 rounded border border-input bg-background px-2 py-1 text-xs font-medium tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1"
                    aria-label="Type a cycle number"
                  />
                </div>
                {snapNote && (
                  <p className="text-xs text-amber-600 pl-1" role="status">
                    {snapNote}
                  </p>
                )}
              </div>
            </div>
            );
          }}
        </ResizableChartCard>
      </div>
    </div>
  );
};

export default DqDvDashboard;
