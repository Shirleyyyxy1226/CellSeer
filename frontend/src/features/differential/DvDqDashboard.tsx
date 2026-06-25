import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { DirectionToggle, type ChargeDirection } from '@/components/DirectionToggle';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { useDifferentialData } from './useDifferentialData';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { getColorForCell } from '@/lib/ratePerfAggregation';
import { isCellSelectionPath } from '@/lib/treeUtils';
import { SelectionPrompt } from '@/components/SelectionPrompt';
import { buildCellEncodings, getCellEncoding } from '@/lib/cellColorScheme';
import { Surface3dPlot } from './plots/Surface3dPlot';
import { PeakAnalysisPlot } from './plots/PeakAnalysisPlot';
import { EvolutionHeatmapPlot } from './plots/EvolutionHeatmapPlot';
import { buildDvDqFigure, type Dataset } from 'cellseer-lib';
import { ResizableChartCard } from '@/components/ResizableChartCard';
import { ChartEditPopover } from '@/components/ChartEditPopover';
import { ChartLegend, type LegendItem } from '@/components/ChartLegend';
import { useResizableChart } from '@/hooks/useResizableChart';
import { useChartAppearance } from '@/hooks/useChartAppearance';
import type { ExportContext } from '@/lib/exportUtils';

interface Props {
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
}

const DvDqDashboard = ({ cathodeFilter, spacerFilter, separatorFilter }: Props) => {
  const { multiselectionMode, selectedCellIds } = useCellSelection();
  const { treeFilterPath } = useTreeFilter();
  const { apiData, matchPathToIdNos } = useProjectHierarchy();
  const [direction, setDirection] = useState<ChargeDirection>('discharge');
  const TRACE_WARN_THRESHOLD = 200;
  const [heavyRenderConfirmed, setHeavyRenderConfirmed] = useState(false);
  // dV/dQ plots per-cell curves, so it responds ONLY to individual-cell
  // selection: explicit selected cells (Multi mode / inspector drill-down) or a
  // Single-mode leaf click (a treeFilterPath ending in the synthetic "Cell"
  // segment). A group/branch selection resolves to no cells, so the dashboard
  // shows a "select a cell" prompt instead of plotting the whole group.
  const effectiveCellIdNos = useMemo(() => {
    if (selectedCellIds.length > 0) return selectedCellIds;
    if (isCellSelectionPath(treeFilterPath)) {
      const matched = matchPathToIdNos(treeFilterPath);
      return matched ? Array.from(matched) : [];
    }
    return [];
  }, [selectedCellIds, treeFilterPath, matchPathToIdNos]);
  const { dvdqData, cells, loading, error, noDifferentialHint, noFilterMatch } = useDifferentialData(
    cathodeFilter,
    spacerFilter,
    separatorFilter,
    direction,
    effectiveCellIdNos,
  );
  const data = dvdqData;
  const activeAnalysis = apiData?.analysis ?? null;

  const pathToColorMap = useMemo(() => new Map<string, string>(), []);

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

  // Default the selection to the most recent cycle, but ONLY when the cycle set
  // genuinely changes (new data) — not on every render. `cycles` gets a fresh
  // array identity each render, so keying the reset on a content signature keeps
  // it from clobbering the user's slider position mid-interaction.
  const cycleSigRef = useRef<string>('');
  useEffect(() => {
    const sig = `${cycles.length}:${cycles[cycles.length - 1] ?? ''}`;
    if (sig === cycleSigRef.current) return;
    cycleSigRef.current = sig;
    setCycleIndex(Math.max(0, cycles.length - 1));
  }, [cycles]);

  // Single source of truth: the text box always mirrors the slider's cycle.
  useEffect(() => setCycleInput(String(selectedCycle)), [selectedCycle]);

  const [snapNotice, setSnapNotice] = useState<string | null>(null);
  const snapTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const commitCycleInput = useCallback(() => {
    if (cycles.length === 0) return;
    const num = parseInt(cycleInput, 10);
    if (Number.isNaN(num)) { setCycleInput(String(selectedCycle)); return; }
    const best = closestCycleIndex(num);
    const snapped = cycles[best];
    setCycleIndex(best);
    setCycleInput(String(snapped));
    if (snapped !== num) {
      if (snapTimerRef.current) clearTimeout(snapTimerRef.current);
      setSnapNotice(`Snapped to ${snapped}`);
      snapTimerRef.current = setTimeout(() => setSnapNotice(null), 2000);
    }
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
    const shown = data.cellData.filter((cd) => filteredCellIds.has(cd.cell.id));
    // Orthogonal dash/symbol keyed by within-condition replicate index over
    // exactly the cells on screen, so overlaid same-hue replicates separate in
    // the 2D view. Hue stays the identity colour (contrast mode not applied to
    // this cycle-dominated plot).
    const matched = shown
      .map((cd) => cells.find((c) => c.cellId === cd.cell.id))
      .filter((c): c is NonNullable<typeof c> => !!c);
    const encodings = buildCellEncodings(matched, { maximizeContrast: false });
    return shown.map((cd) => {
      const cellMatch = cells.find((c) => c.cellId === cd.cell.id);
      const enc = cellMatch ? getCellEncoding(encodings, cellMatch) : undefined;
      const color = enc?.color
        ?? (cellMatch
          ? getColorForCell(cellMatch, treeFilterPath, hierCols, pathToColorMap)
          : cd.cell.color);
      return {
        id: cd.cell.id,
        label: cd.cell.name,
        color,
        dash: enc?.dash,
        symbol: enc?.symbol,
        cycles: cd.cycleTraces.map((ct) => ({
          cycle: ct.cycle,
          x: data.capacities,
          y: ct.dvdq,
        })),
      };
    });
  }, [data, filteredCellIds, cells, treeFilterPath, hierCols, pathToColorMap]);

  // One legend entry per cell for the 2D panels. Peak shows the cell's line
  // (dash) + peak marker (symbol); Evolution draws solid lines + circle markers,
  // so its swatches omit dash/symbol to match what's actually on the plot.
  const peakLegendItems = useMemo<LegendItem[]>(
    () =>
      datasets.map((d) => ({
        label: d.label,
        color: d.color ?? '#6b7280',
        dash: d.dash,
        symbol: d.symbol ?? 'diamond',
        hasLine: true,
        hasMarker: true,
      })),
    [datasets],
  );
  const evoLegendItems = useMemo<LegendItem[]>(
    () =>
      datasets.map((d) => ({
        label: d.label,
        color: d.color ?? '#6b7280',
        hasLine: true,
        hasMarker: true,
      })),
    [datasets],
  );
  // 3D surface legend: one plain-name entry per cell, rendered below the plot
  // (same ChartLegend block + toggle as the 2D panels).
  const surfaceLegendItems = useMemo<LegendItem[]>(
    () =>
      datasets.map((d) => ({
        label: d.label,
        color: d.color ?? '#6b7280',
        hasLine: true,
        hasMarker: true,
      })),
    [datasets],
  );

  const estimatedTraceCount = useMemo(
    () => datasets.reduce((acc, d) => acc + d.cycles.length, 0),
    [datasets],
  );
  const isHeavy3D = estimatedTraceCount > TRACE_WARN_THRESHOLD;
  // Reset confirmation whenever the dataset changes
  useEffect(() => { setHeavyRenderConfirmed(false); }, [datasets]);

  const { data: traces3d, layout: layout3D } = useMemo(
    () => buildDvDqFigure(datasets, { mode: '3d', cycleIndex }),
    [datasets, cycleIndex]
  );
  const { data: traces2d, layout: layout2D } = useMemo(
    () => buildDvDqFigure(datasets, {
      mode: '2d',
      viewMode: 'range',
      cycleIndex,
      selectedCycle,
    }),
    [datasets, cycleIndex, selectedCycle]
  );

  const exportContext = useMemo<ExportContext>(
    () => ({
      plotType: 'dvdq',
      sourceCellIds: datasets.map((d) => d.id),
      sourceEndpoints: datasets.map((d) =>
        new URL(`/api/cell-record/${encodeURIComponent(d.id)}/differential?direction=${direction}`, window.location.origin).toString(),
      ),
      settings: { direction },
    }),
    [datasets, direction],
  );

  const directionLabel = direction === 'charge' ? 'Charge' : 'Discharge';
  const title2d = selectedCycle
    ? `dV/dQ peak profile — ${directionLabel.toLowerCase()} · cycle ${selectedCycle} highlighted over all-cycle envelope`
    : `dV/dQ peak profile — ${directionLabel.toLowerCase()}`;
  const title3d = `dV/dQ vs capacity — ${directionLabel.toLowerCase()}`;

  const surfaceChart = useResizableChart();
  const peakChart = useResizableChart();
  const surfaceAppearance = useChartAppearance({
    chartTitle: title3d,
    xAxisLabel: 'Capacity (mAh)',
    yAxisLabel: 'dV/dQ (V mAh⁻¹)',
    titleFontSize: 11,
    labelFontSize: 10,
    legendFontSize: 10,
  });
  const peakAppearance = useChartAppearance({
    chartTitle: title2d,
    xAxisLabel: 'Capacity (mAh)',
    yAxisLabel: 'dV/dQ (V mAh⁻¹)',
    titleFontSize: 11,
    labelFontSize: 10,
    legendFontSize: 10,
  });
  const evoAppearance = useChartAppearance({
    chartTitle: 'Peak dV/dQ vs cycle',
    xAxisLabel: 'Cycle',
    yAxisLabel: 'dV/dQ (V mAh⁻¹)',
    titleFontSize: 11,
    labelFontSize: 10,
    legendFontSize: 10,
  });
  useEffect(() => { surfaceAppearance.setChartTitle(title3d); }, [title3d, surfaceAppearance.setChartTitle]);
  useEffect(() => { peakAppearance.setChartTitle(title2d); }, [title2d, peakAppearance.setChartTitle]);

  // Legend visibility is now per-plot, owned by each plot's appearance config
  // (the eye toggle and the edit-popover checkbox both write the same value).
  const [activePanel, setActivePanel] = useState<'profile' | 'evolution' | null>(null);
  const openPanel = useCallback((panel: 'profile' | 'evolution') => setActivePanel(panel), []);
  const closePanel = useCallback(() => {
    setActivePanel(null);
    surfaceChart.setSize(null);
  }, [surfaceChart]);

  // Determine whether there is anything to plot yet
  const hasTraces = datasets.length > 0;
  const isInFlight = loading;

  // Empty-state shown when the fetch has settled with no data
  const EmptyState = (
    <div className="flex items-center justify-center text-center h-full min-h-[420px] px-8 text-sm text-muted-foreground">
      Select one or more cells to plot dV/dQ curves.
    </div>
  );

  if (!loading && effectiveCellIdNos.length === 0) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm flex h-full min-h-[420px] items-center justify-center">
        <SelectionPrompt title="Select a cell to begin" />
      </div>
    );
  }

  if (!loading && !error && (noDifferentialHint || noFilterMatch)) {
    return (
      <div className="rounded-lg border border-border bg-card p-3 shadow-sm flex h-full min-h-[420px] items-center justify-center text-center text-sm text-muted-foreground">
        {noFilterMatch
          ? 'No cells match the current filters.'
          : 'No dV/dQ data for the selected cells.'}
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border bg-card p-3 shadow-sm flex flex-col gap-3 h-full min-h-0">
      {error && !loading && <p className="text-sm text-amber-600">Database unavailable: {error}</p>}
      <div className="flex items-center justify-end gap-3 shrink-0 flex-wrap">
        <DirectionToggle value={direction} onChange={setDirection} />
      </div>
      <div className={`gap-3 flex-1 min-h-[520px] ${activePanel !== null ? 'grid grid-cols-1 lg:grid-cols-2' : 'flex flex-col'}`}>
        <ResizableChartCard
          size={surfaceChart.size}
          onResizeStart={surfaceChart.onResizeStart}
          aspectRatio={activePanel !== null ? 1 : 16 / 9}
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
            <div className="flex flex-col" style={{ width, height }}>
              <div className="relative bg-white dark:bg-card rounded shrink-0" style={{ width, height: Math.max(300, height - 84) }}>
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
                  xValues={data?.capacities ?? []}
                  appearance={surfaceAppearance.config}
                  uirevision="dvdq-3d"
                  layoutOverride={layout3D}
                  width={width}
                  height={Math.max(300, height - 84)}
                  exportContext={exportContext}
                  onOpenPanel={openPanel}
                  ResizeHandle={ResizeHandle}
                />
              )}
              <ChartEditPopover
                config={surfaceAppearance.config}
                onConfigChange={surfaceAppearance.onConfigChange}
                chartLabel="3D surface"
              />
              </div>
              <ChartLegend
                items={surfaceLegendItems}
                shown={surfaceAppearance.config.showLegend}
                onToggle={() => surfaceAppearance.onConfigChange('showLegend', !surfaceAppearance.config.showLegend)}
                chartLabel="3D surface"
                fontSize={surfaceAppearance.config.legendFontSize}
                maxHeight={56}
                className="shrink-0"
              />
            </div>
          )}
        </ResizableChartCard>
        {/* Profile panel */}
        {activePanel === 'profile' && <ResizableChartCard
          size={peakChart.size}
          onResizeStart={peakChart.onResizeStart}
          aspectRatio={1}
          minHeight={420}
          fillHeight
        >
          {({ width, ResizeHandle }) => {
            return (
            <div className="flex flex-col gap-2 h-full" style={{ width }}>
              <div className="flex items-center justify-between px-0.5 shrink-0">
                <span className="text-xs font-medium text-muted-foreground">Peak profile (2D)</span>
                <button type="button" aria-label="Close panel" onClick={closePanel}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✕</button>
              </div>
              <div className="relative bg-white dark:bg-card rounded flex-1 min-h-0" style={{ width }}>
                {loading ? (
                  <LoadingIndicator variant="frame" size="lg" label="Loading cell data from database…" />
                ) : (
                  <>
                    <PeakAnalysisPlot
                      traces={traces2d}
                      appearance={peakAppearance.config}
                      uirevision="dvdq-2d"
                      layoutOverride={layout2D}
                      hoverFocus={datasets.length > 1}
                      exportContext={exportContext}
                    />
                    <ChartEditPopover config={peakAppearance.config} onConfigChange={peakAppearance.onConfigChange} chartLabel="Peak analysis" />
                  </>
                )}
                <ResizeHandle />
              </div>
              <ChartLegend
                items={peakLegendItems}
                shown={peakAppearance.config.showLegend}
                onToggle={() => peakAppearance.onConfigChange('showLegend', !peakAppearance.config.showLegend)}
                chartLabel="Peak analysis"
                fontSize={peakAppearance.config.legendFontSize}
                maxHeight={56}
                className="shrink-0"
              />
              <div className="rounded-md border border-border/60 bg-muted/20 px-3 py-2 mt-1 shrink-0">
                <p className="text-xs font-medium text-muted-foreground mb-1.5">Peak profile — select cycle</p>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-muted-foreground whitespace-nowrap">
                    Cycle{cycles.length > 0 && <span className="ml-1 text-muted-foreground/60">({cycles[0]}–{cycles[cycles.length - 1]})</span>}:
                  </span>
                  {cycles.length > 1 ? (
                    <input type="range" min={cycles[0]} max={cycles[cycles.length - 1]} value={selectedCycle}
                      onChange={(e) => { const best = closestCycleIndex(parseInt(e.target.value, 10)); setCycleIndex(best); setCycleInput(String(cycles[best])); }}
                      className="flex-1 accent-primary" />
                  ) : <div className="flex-1" />}
                  <input type="text" inputMode="numeric" value={cycleInput}
                    placeholder={cycles.length > 0 ? `${cycles[0]}–${cycles[cycles.length - 1]}` : ''}
                    aria-describedby="dvdq-cycle-snap-notice"
                    onChange={(e) => setCycleInput(e.target.value)}
                    onBlur={commitCycleInput}
                    onKeyDown={(e) => e.key === 'Enter' && commitCycleInput()}
                    className="w-16 rounded border border-input bg-background px-2 py-1 text-xs font-medium tabular-nums text-center focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1" />
                  {snapNotice && <span id="dvdq-cycle-snap-notice" role="status" aria-live="polite" className="text-xs text-amber-600 dark:text-amber-400 whitespace-nowrap">{snapNotice}</span>}
                </div>
              </div>
            </div>
            );
          }}
        </ResizableChartCard>}

        {/* Evolution heatmap panel */}
        {activePanel === 'evolution' && <ResizableChartCard
          size={peakChart.size}
          onResizeStart={peakChart.onResizeStart}
          aspectRatio={1}
          minHeight={420}
          fillHeight
        >
          {({ width, height, ResizeHandle }) => {
            // Reserve room for the header + legend block so the column doesn't
            // overflow; the plot box takes the remainder.
            const evoPlotH = Math.max(220, height - 28 - 84);
            return (
            <div className="flex flex-col gap-2 h-full" style={{ width }}>
              <div className="flex items-center justify-between px-0.5 shrink-0">
                <span className="text-xs font-medium text-muted-foreground">Cycle evolution (2D)</span>
                <button type="button" aria-label="Close panel" onClick={closePanel}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✕</button>
              </div>
              <div className="relative bg-white dark:bg-card rounded shrink-0" style={{ width, height: evoPlotH }}>
                {loading ? (
                  <LoadingIndicator variant="frame" size="lg" label="Loading cell data from database…" />
                ) : (
                  <>
                    <EvolutionHeatmapPlot
                      datasets={datasets}
                      zLabel="dV/dQ (V mAh⁻¹)"
                      appearance={evoAppearance.config}
                      width={width}
                      height={evoPlotH}
                      exportContext={exportContext}
                    />
                    <ChartEditPopover
                      config={evoAppearance.config}
                      onConfigChange={evoAppearance.onConfigChange}
                      chartLabel="Cycle evolution"
                    />
                  </>
                )}
                <ResizeHandle />
              </div>
              <ChartLegend
                items={evoLegendItems}
                shown={evoAppearance.config.showLegend}
                onToggle={() => evoAppearance.onConfigChange('showLegend', !evoAppearance.config.showLegend)}
                chartLabel="Cycle evolution"
                fontSize={evoAppearance.config.legendFontSize}
                maxHeight={56}
                className="shrink-0"
              />
            </div>
            );
          }}
        </ResizableChartCard>}
      </div>
    </div>
  );
};

export default DvDqDashboard;
