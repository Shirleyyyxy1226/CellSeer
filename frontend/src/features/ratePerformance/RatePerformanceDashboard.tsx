import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRatePerformanceQuery, useCellRecordQueries } from '@/hooks/useCellData';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { Button } from '@/components/ui/button';
import { ArrowLeft, ChevronUp, Layers } from 'lucide-react';
import { ChartEditPopover, type ChartAppearanceConfig, type ChartAppearanceKey } from '@/components/ChartEditPopover';
import { ChartLegend, type LegendItem } from '@/components/ChartLegend';
import { ResizableChartCard } from '@/components/ResizableChartCard';
import { DirectionToggle, type ChargeDirection } from '@/components/DirectionToggle';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { useResizableChart } from '@/hooks/useResizableChart';
import { useChartAppearance } from '@/hooks/useChartAppearance';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProtocolFilter } from '@/contexts/ProtocolFilterContext';
import {
  buildPathToColorMap,
  getColorForCell,
  getMaxDetailDepth,
  resolveHierarchyCellValue,
} from '@/lib/ratePerfAggregation';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import type { RatePerfCell as CyclingCell } from '@/lib/cellTypes';
import { formatNodeLabel } from '@/lib/treeUtils';
import { VoltageTimePlot, type VoltageTimeCellRecord, type VoltageTimePlotConfig } from './plots/VoltageTimePlot';
import { RatePerformancePlot } from './plots/RatePerformancePlot';
import { hasRatePerfTraces } from './plots/ratePerfTraceCheck';

interface Props {
  visibleCells: string[];
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
  onCathodeFilter?: (v: string) => void;
  onSeparatorFilter?: (v: string) => void;
}

type NodePreviewItem = {
  rawValue: string;
  label: string;
  count: number;
  color: string;
  minY: number | null;
  maxY: number | null;
};

function detectIdNoHeaderIndex(headers: string[]): number {
  const patterns = [
    /^id\s*no\.?$/i,
    /^id_no$/i,
    /^idno$/i,
    /^number$/i,
    /^cell\s*no\.?$/i,
    /^cel\s*no\.?$/i,
  ];
  for (let i = 0; i < headers.length; i += 1) {
    const h = String(headers[i] ?? '').trim();
    if (patterns.some((p) => p.test(h))) return i;
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

const RatePerformanceDashboard = (_: Props) => {
  const { setSelectedCellIds, multiselectionMode, selectedCellIds } =
    useCellSelection();
  const rateQuery = useRatePerformanceQuery();
  const cyclingData = rateQuery.data?.cells?.length ? (rateQuery.data.cells as CyclingCell[]) : null;
  const cyclingLoading = rateQuery.isLoading;
  const { apiData: hierarchyData, matchPathToIdNos } = useProjectHierarchy();
  const { protocolFilter } = useProtocolFilter();
  const { treeFilterPath } = useTreeFilter();
  const [detailDepth, setDetailDepth] = useState(0);
  const [direction, setDirection] = useState<ChargeDirection>('discharge');

  const defaultChartTitle = useMemo(
    () => treeFilterPath.length === 0 ? 'Rate Performance' : `Rate Performance: ${treeFilterPath.map((p) => p.val).join(' · ')}`,
    [treeFilterPath],
  );

  const appearance = useChartAppearance({
    chartTitle: defaultChartTitle,
    xAxisLabel: 'Cycle number',
    yAxisLabel: 'Capacity (mAh g⁻¹)',
    showConnectedLine: false,
    // Enables the "Maximise contrast" toggle in the chart Edit popover (R2).
    maximizeContrast: false,
  });
  const { fontFamily, titleFontSize, labelFontSize, legendFontSize } = appearance.config;
  useEffect(() => { appearance.setChartTitle(defaultChartTitle); }, [defaultChartTitle, appearance]);

  const mainChart = useResizableChart();
  const initialVoltageChart = useResizableChart();
  // Each plot builds its traces internally (after aggregation / downsampling),
  // then reports the derived legend entries so we can render the legend as a
  // block below the plot (see ChartLegend).
  const [rateLegendItems, setRateLegendItems] = useState<LegendItem[]>([]);
  const [voltageLegendItems, setVoltageLegendItems] = useState<LegendItem[]>([]);

  const activeAnalysis = hierarchyData?.analysis ?? null;

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
      headers.forEach((h, i) => {
        rec[h] = String(row[i] ?? '');
      });
      out.set(idNo, rec);
    });
    return out;
  }, [hierarchyData?.parsed?.headers, hierarchyData?.parsed?.rows, hierarchyData?.analysis?.leafCol]);

  const pathToColorMap = useMemo(
    () => cyclingData?.length
      ? buildPathToColorMap(cyclingData, activeAnalysis?.hierCols ?? [], metadataByIdNo)
      : new Map<string, string>(),
    [cyclingData, activeAnalysis?.hierCols, metadataByIdNo],
  );

  const maxDetailDepth = getMaxDetailDepth(treeFilterPath, activeAnalysis?.hierCols ?? []);
  const canDrillDown = treeFilterPath.length > 0 && detailDepth < maxDetailDepth;
  const handleDrillDown = useCallback(() => { setDetailDepth((d) => Math.min(d + 1, maxDetailDepth)); }, [maxDetailDepth]);

  const canDrillUp = detailDepth > 0;
  const handleDrillUp = useCallback(() => { setDetailDepth((d) => Math.max(d - 1, 0)); }, []);

  // Reset detailDepth to 0 whenever the user selects a different tree node
  const prevTreeFilterPathRef = useRef(treeFilterPath);
  useEffect(() => {
    if (prevTreeFilterPathRef.current !== treeFilterPath) {
      prevTreeFilterPathRef.current = treeFilterPath;
      setDetailDepth(0);
    }
  }, [treeFilterPath]);

  const filteredNeware = useMemo(() => {
    if (!cyclingData) return [];
    let out: CyclingCell[];
    if (multiselectionMode && selectedCellIds.length > 0) {
      out = cyclingData.filter((c) => selectedCellIds.includes(c.idNo));
    } else {
      const matchedIds = matchPathToIdNos(treeFilterPath);
      if (treeFilterPath.length > 0) {
        if (matchedIds && matchedIds.size > 0) {
          // Tree path takes priority when it can resolve real cells.
          out = cyclingData.filter((c) => matchedIds.has(c.idNo));
        } else if (!multiselectionMode && selectedCellIds.length === 1) {
          // Fallback for leaf labels that don't map cleanly via path matching.
          out = cyclingData.filter((c) => c.idNo === selectedCellIds[0]);
        } else {
          return [];
        }
      } else if (!multiselectionMode && selectedCellIds.length === 1) {
        out = cyclingData.filter((c) => c.idNo === selectedCellIds[0]);
      } else {
        return [];
      }
    }
    if (protocolFilter !== 'All') out = out.filter((c) => c.protocol === protocolFilter);
    return out.sort((a, b) => a.idNo - b.idNo);
  }, [
    cyclingData,
    treeFilterPath,
    protocolFilter,
    multiselectionMode,
    selectedCellIds,
    matchPathToIdNos,
  ]);

  // Keep right-side CellDetail in sync with current tree focus.
  // In single-select mode:
  // - exactly one matched cell path => auto-select that cell only when no explicit selection exists
  // - never clear an explicit selection here (leaf click owns explicit selection)
  useEffect(() => {
    if (multiselectionMode) return;
    if (selectedCellIds.length > 0) return;
    if (!treeFilterPath.length) return;
    const matched = matchPathToIdNos(treeFilterPath);
    if (!matched || matched.size !== 1) return;
    const [onlyId] = Array.from(matched);
    const timer = window.setTimeout(() => {
      setSelectedCellIds([onlyId]);
    }, 0);
    return () => window.clearTimeout(timer);
  }, [multiselectionMode, treeFilterPath, matchPathToIdNos, selectedCellIds, setSelectedCellIds]);

  // Full per-cell curves for the voltage-time chart. Shared React Query hook —
  // same cache / retry-skip-on-404 / dedup as GCD & Differential (replaces the
  // hand-rolled fetch + in-flight/missing/loaded refs this dashboard used to
  // keep). Order matches filteredNeware, so we map back by index.
  const recordQueries = useCellRecordQueries(filteredNeware.map((c) => c.cellId));
  const cellRecordsByCell = useMemo(() => {
    const out: Record<
      number,
      { curves: Record<string, Record<string, (number | string | null)[]>>; cellName: string }
    > = {};
    filteredNeware.forEach((cell, i) => {
      const rec = recordQueries[i]?.data as
        | { curves?: Record<string, Record<string, (number | string | null)[]>>; cellName?: string }
        | undefined;
      if (rec?.curves) out[cell.idNo] = { curves: rec.curves, cellName: rec.cellName ?? cell.cellId };
    });
    return out;
  }, [filteredNeware, recordQueries]);

  const directionLabelLower = direction === 'charge' ? 'charge' : 'discharge';
  const hasPlot = !!activeAnalysis && hasRatePerfTraces(filteredNeware, direction);
  const useSpecificCapacity =
    direction === 'discharge' && filteredNeware.some((r) => r.specificCapacityMahG != null);

  // Detect mixed-capacity selections: some rows have specificCapacityMahG, some do not.
  const specificCapacityCount = useMemo(
    () => filteredNeware.filter((r) => r.specificCapacityMahG != null).length,
    [filteredNeware],
  );
  const mixedCapacityWarning =
    direction === 'discharge' &&
    filteredNeware.length > 0 &&
    specificCapacityCount > 0 &&
    specificCapacityCount < filteredNeware.length;
  const excludedCount = filteredNeware.length - specificCapacityCount;
  const activeYUnit = useSpecificCapacity ? 'mAh g⁻¹' : 'mAh';

  const cellRecords = useMemo((): VoltageTimeCellRecord[] =>
    filteredNeware
      .map((cell) => {
        const record = cellRecordsByCell[cell.idNo];
        if (!record?.curves) return null;
        const color = getColorForCell(cell, treeFilterPath, activeAnalysis?.hierCols ?? [], pathToColorMap);
        return { cellName: record.cellName, curves: record.curves, color };
      })
      .filter(Boolean) as VoltageTimeCellRecord[],
    [filteredNeware, cellRecordsByCell, treeFilterPath, activeAnalysis?.hierCols, pathToColorMap],
  );

  // Initial-voltage chart keeps its own title + axis labels but reuses
  // the main chart's font sizes / family (existing cross-coupling behaviour).
  const [maxVoltageCycles, setMaxVoltageCycles] = useState(5);
  // Local text mirror so the field can be cleared / partially edited while
  // typing; the cycle count commits when the value is valid and clamps on blur.
  // (A controlled number input would snap back mid-edit.)
  const [cyclesText, setCyclesText] = useState('5');
  // Legend visibility for the voltage-vs-time chart (the eye toggle and the
  // edit-popover checkbox both write this single value).
  const [voltageLegendShown, setVoltageLegendShown] = useState(true);
  const derivedVoltageTitle = useMemo(() => {
    const cellCount = cellRecords.length;
    const cellNote = cellCount === 1 ? `cell ${cellRecords[0]?.cellName ?? ''}` : `${cellCount} cells`;
    return `Voltage vs time (cycles 1–${maxVoltageCycles}, ${cellNote})`;
  }, [cellRecords, maxVoltageCycles]);
  const [initialVoltageTitleOverride, setInitialVoltageTitleOverride] = useState<string | null>(null);
  const initialVoltageTitle = initialVoltageTitleOverride ?? derivedVoltageTitle;
  const [initialVoltageXLabel, setInitialVoltageXLabel] = useState('Time (s)');
  const [initialVoltageYLabel, setInitialVoltageYLabel] = useState('Voltage (V)');

  const initialVoltageAppearanceConfig: ChartAppearanceConfig = useMemo(
    () => ({
      chartTitle: initialVoltageTitle,
      xAxisLabel: initialVoltageXLabel,
      yAxisLabel: initialVoltageYLabel,
      fontFamily,
      titleFontSize,
      labelFontSize,
      legendFontSize,
      showLegend: voltageLegendShown,
      legendPosition: 'right-bottom',
    }),
    [initialVoltageTitle, initialVoltageXLabel, initialVoltageYLabel, fontFamily, titleFontSize, labelFontSize, legendFontSize, voltageLegendShown],
  );

  const onInitialVoltageConfigChange = useCallback(
    <K extends ChartAppearanceKey>(key: K, value: ChartAppearanceConfig[K]) => {
      if (key === 'chartTitle') setInitialVoltageTitleOverride(value as string);
      else if (key === 'xAxisLabel') setInitialVoltageXLabel(value as string);
      else if (key === 'yAxisLabel') setInitialVoltageYLabel(value as string);
      else if (key === 'showLegend') setVoltageLegendShown(value === true);
      else if (key === 'fontFamily' || key === 'titleFontSize' || key === 'labelFontSize' || key === 'legendFontSize') {
        // Font knobs are shared with the main chart on purpose.
        appearance.onConfigChange(key, value);
      }
      // legendPosition / showConnectedLine: intentionally no-op
      // (these are hardcoded for the initial-voltage chart).
    },
    [appearance],
  );

  const nextLevelPreview = useMemo(() => {
    if (!activeAnalysis || !canDrillDown || treeFilterPath.length === 0 || filteredNeware.length === 0) {
      return null;
    }
    // Must match aggregation logic in `getGrouping()` (ratePerfAggregation):
    // next visible split index is `path.length + detailDepth`.
    // Example: selecting NMC811 (path length 1) should preview its direct
    // children (index 1), i.e. Graphite / Single Layer ...
    const nextLevelIdx = treeFilterPath.length + detailDepth;
    const nextCol = activeAnalysis.hierCols[nextLevelIdx];
    const isCellLevelNext = nextLevelIdx >= activeAnalysis.hierCols.length;
    if (!nextCol && !isCellLevelNext) return null;

    const seriesForCell = (cell: CyclingCell): number[] =>
      direction === 'charge'
        ? (cell.chargeCapacityMah ?? [])
        : (useSpecificCapacity ? (cell.specificCapacityMahG ?? cell.dischargeCapacityMah) : cell.dischargeCapacityMah);

    if (isCellLevelNext) {
      return {
        header: 'Cell',
        isCellLevelNext: true,
        metricLabel: useSpecificCapacity ? 'specific capacity' : 'capacity',
        items: [] as NodePreviewItem[],
        hiddenCount: 0,
      };
    }

    const grouped = new Map<string, CyclingCell[]>();
    filteredNeware.forEach((cell) => {
      const key = resolveHierarchyCellValue(cell, nextCol!.header, metadataByIdNo.get(cell.idNo));
      if (!key) return;
      const arr = grouped.get(key) ?? [];
      arr.push(cell);
      grouped.set(key, arr);
    });
    if (grouped.size === 0) return null;

    const pathPrefix = treeFilterPath.map((p) => p.val).filter(Boolean).join('|');
    const items: NodePreviewItem[] = Array.from(grouped.entries())
      .map(([rawValue, cells]) => {
        const yVals: number[] = [];
        cells.forEach((cell) => {
          seriesForCell(cell).forEach((v) => {
            if (typeof v === 'number' && Number.isFinite(v)) yVals.push(v);
          });
        });
        const minY = yVals.length ? Math.min(...yVals) : null;
        const maxY = yVals.length ? Math.max(...yVals) : null;
        const pathKey = pathPrefix ? `${pathPrefix}|${rawValue}` : rawValue;
        return {
          rawValue,
          label: formatNodeLabel(
            rawValue,
            nextLevelIdx,
            activeAnalysis.annotations ?? [],
            activeAnalysis.labelDecorations,
          ) || rawValue,
          count: cells.length,
          color: pathToColorMap.get(pathKey) ?? '#6b7280',
          minY,
          maxY,
        };
      })
      .sort((a, b) => b.count - a.count || a.label.localeCompare(b.label));

    return {
      header: nextCol!.header,
      isCellLevelNext: false,
      metricLabel: useSpecificCapacity ? 'specific capacity' : 'capacity',
      items: items.slice(0, 8),
      hiddenCount: Math.max(0, items.length - 8),
    };
  }, [
    activeAnalysis,
    canDrillDown,
    treeFilterPath,
    filteredNeware,
    detailDepth,
    pathToColorMap,
    direction,
    useSpecificCapacity,
    metadataByIdNo,
  ]);

  const voltageConfig = useMemo((): VoltageTimePlotConfig => ({
    title: initialVoltageTitle, xLabel: initialVoltageXLabel, yLabel: initialVoltageYLabel,
    fontFamily, titleFontSize, labelFontSize, legendFontSize,
  }), [initialVoltageTitle, initialVoltageXLabel, initialVoltageYLabel, fontFamily, titleFontSize, labelFontSize, legendFontSize]);

  const noSelection = treeFilterPath.length === 0 && !multiselectionMode;

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 min-w-0 flex gap-0">
        <div className="flex-1 min-w-0 min-h-0 overflow-auto transition-all duration-300">
          <div className="space-y-4 p-4 w-full min-w-0">
            <ResizableChartCard
              size={mainChart.size}
              onResizeStart={mainChart.onResizeStart}
              aspectRatio={800 / 480}
              minHeight={280}
            >
              {({ width, height, ResizeHandle }) => (
                <>
                  <div className="mb-3 flex flex-wrap items-start justify-between gap-3">
                    <DirectionToggle
                      value={direction}
                      onChange={setDirection}
                      disabled={noSelection}
                      title={noSelection ? 'Select a hierarchy node first' : undefined}
                    />
                    <div className="flex items-center gap-2">
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDrillUp}
                        disabled={!canDrillUp}
                        className="gap-1.5"
                        title={canDrillUp
                          ? 'Return to the parent grouping level'
                          : 'Already at the top grouping level'}
                      >
                        <ChevronUp className="h-3.5 w-3.5" />
                        Go back up
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={handleDrillDown}
                        disabled={!canDrillDown}
                        className="gap-1.5"
                        title={canDrillDown
                          ? 'Split the current traces by the next hierarchy level'
                          : treeFilterPath.length === 0
                            ? 'Select a hierarchy node first'
                            : 'Already showing the finest level of detail'}
                      >
                        <Layers className="h-3.5 w-3.5" />
                        Drill into next level
                      </Button>
                    </div>
                  </div>
                  {hasPlot && activeAnalysis ? (
                    <>
                    <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                      {/* Y-axis unit badge + mixed-capacity warning */}
                      <div className="absolute bottom-2 left-2 z-10 flex flex-col gap-1 items-start pointer-events-none">
                        <span className="px-2 py-0.5 rounded-full text-[10px] font-medium bg-background/80 border border-border/60 text-muted-foreground backdrop-blur-sm">
                          Y: {activeYUnit}
                        </span>
                        {mixedCapacityWarning && (
                          <span className="px-2 py-1 rounded-md text-[10.5px] bg-yellow-50 border border-yellow-300 text-yellow-800 dark:bg-yellow-900/30 dark:border-yellow-700 dark:text-yellow-300 max-w-[280px] leading-snug pointer-events-auto">
                            Plotting specific capacity (mAh g⁻¹).
                            {' '}{excludedCount} cell{excludedCount === 1 ? '' : 's'} without mass data excluded.
                          </span>
                        )}
                      </div>
                      <div className="absolute inset-0" style={{ minWidth: 1, minHeight: 1 }}>
                        <RatePerformancePlot
                          filteredCells={filteredNeware}
                          analysis={activeAnalysis}
                          treeFilterPath={treeFilterPath}
                          pathToColorMap={pathToColorMap}
                          direction={direction}
                          detailDepth={detailDepth}
                          metadataByIdNo={metadataByIdNo}
                          showConnectedLine={appearance.config.showConnectedLine ?? false}
                          config={appearance.config}
                          width={width}
                          height={height}
                          onCellSelect={(cell) => setSelectedCellIds([cell.idNo])}
                          onLegendItems={setRateLegendItems}
                        />
                      </div>
                      <ChartEditPopover
                        config={appearance.config}
                        onConfigChange={appearance.onConfigChange}
                        showConnectedLineOption
                        chartLabel="Rate performance"
                      />
                      <ResizeHandle />
                    </div>
                    <ChartLegend
                      items={rateLegendItems}
                      shown={appearance.config.showLegend}
                      onToggle={() => appearance.onConfigChange('showLegend', !appearance.config.showLegend)}
                      chartLabel="Rate performance"
                      fontSize={legendFontSize}
                    />
                    </>
                  ) : cyclingLoading ? (
                    <LoadingIndicator
                      variant="frame"
                      size="lg"
                      label="Loading rate performance data…"
                      minHeight={420}
                    />
                  ) : (
                    <div className="h-[420px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                      {cyclingData === null ? (
                        <p>No rate performance data found.</p>
                      ) : treeFilterPath.length === 0 && !multiselectionMode ? (
                        <div className="flex flex-col items-center gap-3 text-center px-8">
                          <div className="flex items-center gap-2 text-primary/70">
                            <ArrowLeft className="h-5 w-5 shrink-0" />
                            <span className="text-sm font-medium text-foreground">
                              Select a node in the hierarchy tree
                            </span>
                          </div>
                          <p className="text-xs text-muted-foreground max-w-xs">
                            Click any branch or leaf in the left sidebar to load its rate performance data here.
                          </p>
                        </div>
                      ) : direction === 'charge' ? (
                        <p>No {directionLabelLower} capacity data for the current selection.</p>
                      ) : (
                        <p>No cells match the current filters.</p>
                      )}
                    </div>
                  )}
                </>
              )}
            </ResizableChartCard>

            {cellRecords.length > 0 && (
              <ResizableChartCard
                size={initialVoltageChart.size}
                onResizeStart={initialVoltageChart.onResizeStart}
                aspectRatio={800 / 320}
                minHeight={200}
              >
                {({ width, height, ResizeHandle }) => (
                  <>
                  <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                    <div className="absolute top-2 left-2 z-10 flex items-center gap-1.5">
                      <label className="text-[10px] text-muted-foreground whitespace-nowrap" htmlFor="max-cycles-input">
                        Cycles:
                      </label>
                      <input
                        id="max-cycles-input"
                        type="text"
                        inputMode="numeric"
                        pattern="[0-9]*"
                        value={cyclesText}
                        onChange={(e) => {
                          const t = e.target.value.replace(/\D/g, '').slice(0, 2);
                          setCyclesText(t);
                          const v = parseInt(t, 10);
                          if (Number.isFinite(v) && v >= 1) setMaxVoltageCycles(Math.min(50, v));
                        }}
                        onBlur={() => {
                          const v = parseInt(cyclesText, 10);
                          const clamped = Number.isFinite(v) ? Math.min(50, Math.max(1, v)) : maxVoltageCycles;
                          setMaxVoltageCycles(clamped);
                          setCyclesText(String(clamped));
                        }}
                        className="w-14 h-6 rounded border border-border text-[10px] px-1.5 bg-background/80"
                      />
                    </div>
                    <VoltageTimePlot
                      cellRecords={cellRecords}
                      config={voltageConfig}
                      width={width}
                      height={height}
                      maxCycles={maxVoltageCycles}
                      onLegendItems={setVoltageLegendItems}
                    />
                    <ChartEditPopover
                      config={initialVoltageAppearanceConfig}
                      onConfigChange={(key, value) => {
                        if (key === 'chartTitle') setInitialVoltageTitleOverride(value as string);
                        else onInitialVoltageConfigChange(key, value);
                      }}
                      chartLabel="Initial voltage"
                    />
                    <ResizeHandle />
                  </div>
                  <ChartLegend
                    items={voltageLegendItems}
                    shown={voltageLegendShown}
                    onToggle={() => setVoltageLegendShown((v) => !v)}
                    chartLabel="Initial voltage"
                    fontSize={legendFontSize}
                  />
                  </>
                )}
              </ResizableChartCard>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RatePerformanceDashboard;
