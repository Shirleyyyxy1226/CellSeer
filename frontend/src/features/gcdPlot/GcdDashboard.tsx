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
} from '@/cellviz-lib';
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
const COLORS = ['#1f77b4', '#ff7f0e', '#2ca02c', '#d62728', '#9467bd', '#8c564b', '#e377c2', '#7f7f7f'];

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

  const appearance = useChartAppearance({
    chartTitle: 'GCD plot',
    xAxisLabel: 'Capacity (mAh)',
    yAxisLabel: 'Voltage (V)',
    showConnectedLine: false,
  });
  const {
    chartTitle,
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

  const main = useResizableChart();
  const combined = useResizableChart();
  const ratePerf = useResizableChart();
  const initialVoltage = useResizableChart();

  const allowedCycles = useMemo(() => parseCycleFilter(cycleFilter), [cycleFilter]);

  const activeAnalysis = hierarchyData?.analysis ?? null;
  const pathToColorMap = useMemo(
    () =>
      hierarchyData?.pathToColorMap && Object.keys(hierarchyData.pathToColorMap).length > 0
        ? new Map(Object.entries(hierarchyData.pathToColorMap))
        : new Map<string, string>(),
    [hierarchyData?.pathToColorMap],
  );
  const hierCols = useMemo(() => activeAnalysis?.hierCols ?? [], [activeAnalysis?.hierCols]);

  const recordDatasets = useMemo<RecordDataset[]>(() => {
    return cellsDataList
      .filter((cellData) => !!cellData?.curves)
      .map((cellData: VQCell, cellIdx: number) => {
        const color =
          cellsDataList.length > 1 && pathToColorMap.size > 0
            ? getColorForCell(cellData, treeFilterPath, hierCols, pathToColorMap)
            : COLORS[cellIdx % COLORS.length];
        return {
          id: String(cellData.idNo),
          label: cellData.cellName ?? `Cell ${cellData.idNo}`,
          color,
          cathodeMassG: cellData.cathodeMassG ?? null,
          curves: cellData.curves,
        };
      });
  }, [cellsDataList, pathToColorMap, treeFilterPath, hierCols]);

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
          text:
            selectedCellData?.cathodeMassG != null && selectedCellData.cathodeMassG > 0
              ? 'Cumulative specific capacity (mAh g⁻¹)'
              : 'Cumulative capacity (mAh)',
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
      showlegend: false,
      margin: { t: 48, r: 44, b: 80, l: 65 },
      uirevision: 'combined-gcd',
    }),
    [fontFamily, titleFontSize, labelFontSize, selectedCell, selectedCellData, cellsDataList.length],
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
      showlegend: true,
      legend: { x: 0.99, y: 1, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)' },
      margin: { t: 48, r: 40, b: 80, l: 65 },
      uirevision: 'initial-voltage',
    }),
    [fontFamily, titleFontSize, labelFontSize, selectedCell],
  );

  const useSpecificCapacity =
    selectedCellData?.cathodeMassG != null && selectedCellData.cathodeMassG > 0;
  const effectiveXLabel = useSpecificCapacity ? 'Specific capacity (mAh g⁻¹)' : 'Capacity (mAh)';

  const layout: Partial<Plotly.Layout> = useMemo(
    () => ({
      width: 800,
      height: 480,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: { text: selectedCell ? `${selectedCell.cellName}: GCD` : chartTitle, font: { size: titleFontSize } },
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
      showlegend: showLegend,
      legend: showLegend
        ? {
            orientation: 'v',
            font: { size: legendFontSize },
            ...(legendPosition === 'in'
              ? { x: 0.99, y: 1, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)' }
              : { x: 1.02, y: 0, xanchor: 'left', yanchor: 'bottom' }),
          }
        : undefined,
      margin: { t: 48, r: showLegend && legendPosition === 'right-bottom' ? 120 : 40, b: 80, l: 65 },
      uirevision: 'voltage-capacity',
    }),
    [
      selectedCell,
      chartTitle,
      effectiveXLabel,
      yAxisLabel,
      fontFamily,
      titleFontSize,
      labelFontSize,
      legendFontSize,
      showLegend,
      legendPosition,
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

  return (
    <div className="flex flex-col gap-4 h-full">
      {loadError && <p className="text-xs text-destructive">{loadError}</p>}
      {cellDataLoading && <p className="text-xs text-muted-foreground">Loading…</p>}
      {cellDataError && !cellDataLoading && <p className="text-xs text-destructive">{cellDataError}</p>}

      <div className="flex items-center justify-end gap-3 shrink-0 flex-wrap">
        <DirectionToggle value={gcdDirection} onChange={setGcdDirection} />
      </div>

      <div className="flex-1 min-w-0 min-h-0 overflow-auto transition-all duration-300">
        <div className="space-y-4 p-4 w-full min-w-0">
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
                      <PlotlyChart
                        key={`combined-${chartW}-${height}`}
                        data={combinedGcdTraces}
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

          <ResizableChartCard
            size={main.size}
            onResizeStart={main.onResizeStart}
            aspectRatio={800 / 480}
            minHeight={280}
          >
            {({ width, height, ResizeHandle }) => (
              <>
                {filteredCells.length > 0 && (
                  <div className="flex items-center gap-3 mb-4 flex-wrap">
                    <Label className="text-xs text-muted-foreground shrink-0">Cycles</Label>
                    <Input
                      value={cycleFilter}
                      onChange={(e) => setCycleFilter(e.target.value)}
                      placeholder="All or 1, 2, 5 or 1-5"
                      className="h-9 w-48 text-xs"
                    />
                  </div>
                )}
                {traces.length > 0 ? (
                  <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                    <div className="absolute inset-0" style={{ minWidth: 1, minHeight: 1 }}>
                      <PlotlyChart
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
                ) : (
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

          {initialVoltageTraces.length > 0 && (
            <ResizableChartCard
              size={initialVoltage.size}
              onResizeStart={initialVoltage.onResizeStart}
              aspectRatio={800 / 320}
              minHeight={200}
              minWidth={500}
              cardClassName="rounded-lg border border-border bg-card p-4 overflow-auto w-full min-w-0"
            >
              {({ width, height, ResizeHandle }) => (
                <div className="relative bg-white dark:bg-card rounded overflow-visible" style={{ width, height }}>
                  <PlotlyChart
                    key={`initial-${width}-${height}`}
                    data={initialVoltageTraces}
                    layout={initialVoltageLayout}
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
