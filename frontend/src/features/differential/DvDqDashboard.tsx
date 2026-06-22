import { useMemo, useState, useCallback, useEffect, useRef } from 'react';
import { DirectionToggle, type ChargeDirection } from '@/components/DirectionToggle';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { useDifferentialData } from './useDifferentialData';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { getColorForCell } from '@/lib/ratePerfAggregation';
import { Surface3dPlot } from './plots/Surface3dPlot';
import { PeakAnalysisPlot } from './plots/PeakAnalysisPlot';
import { EvolutionHeatmapPlot } from './plots/EvolutionHeatmapPlot';
import { buildDvDqFigure, type Dataset } from 'cellseer-lib';
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

const DvDqDashboard = ({ cathodeFilter, spacerFilter, separatorFilter }: Props) => {
  const { multiselectionMode, selectedCellIds } = useCellSelection();
  const { treeFilterPath } = useTreeFilter();
  const [direction, setDirection] = useState<ChargeDirection>('discharge');
  const { dvdqData, cells, loading, error, noDifferentialHint, noFilterMatch } = useDifferentialData(
    cathodeFilter,
    spacerFilter,
    separatorFilter,
    direction,
    selectedCellIds,
  );
  const data = dvdqData;
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
            x: data.capacities,
            y: ct.dvdq,
          })),
        };
      });
  }, [data, filteredCellIds, cells, treeFilterPath, hierCols, pathToColorMap]);

  const { data: traces3d, layout: layout3D } = useMemo(
    () => buildDvDqFigure(datasets, { mode: '3d' }),
    [datasets]
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
  useEffect(() => { surfaceAppearance.setChartTitle(title3d); }, [title3d, surfaceAppearance]);
  useEffect(() => { peakAppearance.setChartTitle(title2d); }, [title2d, peakAppearance]);

  // Collapsible legend: local control, default shown. Forced below the plot in
  // the plot components; this gates visibility (and honours the popover's own
  // showLegend). When collapsed the bottom margin shrinks and the plot reclaims it.
  const [legendShown, setLegendShown] = useState(true);
  const [activePanel, setActivePanel] = useState<'profile' | 'evolution' | null>(null);
  const openPanel = useCallback((panel: 'profile' | 'evolution') => setActivePanel(panel), []);
  const closePanel = useCallback(() => setActivePanel(null), []);
  const surfaceConfig = useMemo(
    () => ({ ...surfaceAppearance.config, showLegend: surfaceAppearance.config.showLegend && legendShown }),
    [surfaceAppearance.config, legendShown],
  );
  const peakConfig = useMemo(
    () => ({ ...peakAppearance.config, showLegend: peakAppearance.config.showLegend && legendShown }),
    [peakAppearance.config, legendShown],
  );
  const evoConfig = useMemo(
    () => ({ ...evoAppearance.config, showLegend: evoAppearance.config.showLegend && legendShown }),
    [evoAppearance.config, legendShown],
  );

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
      <div className={`gap-3 flex-1 min-h-[520px] ${activePanel !== null ? 'grid grid-cols-1 lg:grid-cols-2' : 'flex flex-col'}`}>
        <ResizableChartCard
          size={surfaceChart.size}
          onResizeStart={surfaceChart.onResizeStart}
          aspectRatio={activePanel !== null ? 1 : 16 / 9}
          minHeight={420}
          fillHeight
        >
          {({ width, height, ResizeHandle }) => (
            <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
              {loading ? (
                <LoadingIndicator
                  variant="frame"
                  size="lg"
                  label="Loading cell data from database…"
                />
              ) : (
                <>
                  <Surface3dPlot
                    traces={traces3d}
                    xValues={data?.capacities ?? []}
                    appearance={surfaceConfig}
                    uirevision="dvdq-3d"
                    layoutOverride={layout3D}
                    width={width}
                    height={height}
                    exportContext={exportContext}
                    onOpenPanel={openPanel}
                  />
                  <ChartEditPopover
                    config={surfaceAppearance.config}
                    onConfigChange={surfaceAppearance.onConfigChange}
                    chartLabel="3D surface"
                  />
                </>
              )}
              <ResizeHandle />
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
          {({ width, height, ResizeHandle }) => {
            const CONTROL_H = 84;
            const plotH = peakChart.size ? height : Math.max(240, height - CONTROL_H);
            return (
            <div className="flex flex-col gap-2 h-full" style={{ width }}>
              <div className="flex items-center justify-between px-0.5 shrink-0">
                <span className="text-xs font-medium text-muted-foreground">Peak profile (2D)</span>
                <button type="button" aria-label="Close panel" onClick={closePanel}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✕</button>
              </div>
              <div className="relative bg-white dark:bg-card rounded" style={{ width, height: plotH }}>
                {loading ? (
                  <LoadingIndicator variant="frame" size="lg" label="Loading cell data from database…" />
                ) : (
                  <>
                    <PeakAnalysisPlot
                      traces={traces2d}
                      appearance={peakConfig}
                      uirevision="dvdq-2d"
                      layoutOverride={layout2D}
                      width={width}
                      height={plotH}
                      exportContext={exportContext}
                    />
                    <ChartEditPopover config={peakAppearance.config} onConfigChange={peakAppearance.onConfigChange} chartLabel="Peak analysis" />
                  </>
                )}
                <ResizeHandle />
              </div>
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
          {({ width, height, ResizeHandle }) => (
            <div className="flex flex-col gap-2 h-full" style={{ width }}>
              <div className="flex items-center justify-between px-0.5 shrink-0">
                <span className="text-xs font-medium text-muted-foreground">Cycle evolution (2D)</span>
                <button type="button" aria-label="Close panel" onClick={closePanel}
                  className="rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors">✕</button>
              </div>
              <div className="relative bg-white dark:bg-card rounded flex-1 min-h-0" style={{ width }}>
                {loading ? (
                  <LoadingIndicator variant="frame" size="lg" label="Loading cell data from database…" />
                ) : (
                  <>
                    <EvolutionHeatmapPlot
                      datasets={datasets}
                      xLabel="Capacity (mAh)"
                      zLabel="dV/dQ (V mAh⁻¹)"
                      appearance={evoConfig}
                      width={width}
                      height={height}
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
            </div>
          )}
        </ResizableChartCard>}
      </div>
    </div>
  );
};

export default DvDqDashboard;
