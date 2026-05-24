import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { fetchRatePerformance, fetchCellRecord } from '@/lib/api';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { Button } from '@/components/ui/button';
import { Layers } from 'lucide-react';
import { ChartEditPopover, type ChartAppearanceConfig, type ChartAppearanceKey } from '@/components/ChartEditPopover';
import { ResizableChartCard } from '@/components/ResizableChartCard';
import { DirectionToggle, type ChargeDirection } from '@/components/DirectionToggle';
import { useResizableChart } from '@/hooks/useResizableChart';
import { useChartAppearance } from '@/hooks/useChartAppearance';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProtocolFilter } from '@/contexts/ProtocolFilterContext';
import { getColorForCell, getMaxDetailDepth } from '@/lib/ratePerfAggregation';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import type { RatePerfCellRaw as NewareCell } from '@/lib/cellTypes';
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

const RatePerformanceDashboard = (_: Props) => {
  const { setSelectedCellIds, multiselectionMode, selectedCellIds } = useCellSelection();
  const [newareData, setNewareData] = useState<NewareCell[] | null>(null);
  const { apiData: hierarchyData, matchPathToIdNos } = useProjectHierarchy();
  const { protocolFilter } = useProtocolFilter();
  const { treeFilterPath } = useTreeFilter();
  const { dataVersion } = useDataRefresh();
  const [detailDepth, setDetailDepth] = useState(0);
  const [direction, setDirection] = useState<ChargeDirection>('discharge');
  const [cellRecordsByCell, setCellRecordsByCell] = useState<Record<
    number,
    { curves: Record<string, Record<string, (number | string | null)[]>>; cellName: string }
  >>({});
  const recordFetchInFlightRef = useRef<Set<number>>(new Set());
  const recordMissingRef = useRef<Set<number>>(new Set());
  const recordLoadedRef = useRef<Set<number>>(new Set());

  const defaultChartTitle = useMemo(
    () => treeFilterPath.length === 0 ? 'Rate Performance' : `Rate Performance: ${treeFilterPath.map((p) => p.val).join(' · ')}`,
    [treeFilterPath],
  );

  const appearance = useChartAppearance({
    chartTitle: defaultChartTitle,
    xAxisLabel: 'Cycle number',
    yAxisLabel: 'Capacity (mAh g⁻¹)',
    showConnectedLine: false,
  });
  const { fontFamily, titleFontSize, labelFontSize, legendFontSize } = appearance.config;
  useEffect(() => { appearance.setChartTitle(defaultChartTitle); }, [defaultChartTitle, appearance]);

  // Initial-voltage chart keeps its own title + axis labels but reuses
  // the main chart's font sizes / family (existing cross-coupling behaviour).
  const [initialVoltageTitle, setInitialVoltageTitle] = useState('Voltage vs time (first few cycles)');
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
      showLegend: true,
      legendPosition: 'right-bottom',
    }),
    [initialVoltageTitle, initialVoltageXLabel, initialVoltageYLabel, fontFamily, titleFontSize, labelFontSize, legendFontSize],
  );

  const onInitialVoltageConfigChange = useCallback(
    <K extends ChartAppearanceKey>(key: K, value: ChartAppearanceConfig[K]) => {
      if (key === 'chartTitle') setInitialVoltageTitle(value as string);
      else if (key === 'xAxisLabel') setInitialVoltageXLabel(value as string);
      else if (key === 'yAxisLabel') setInitialVoltageYLabel(value as string);
      else if (key === 'fontFamily' || key === 'titleFontSize' || key === 'labelFontSize' || key === 'legendFontSize') {
        // Font knobs are shared with the main chart on purpose.
        appearance.onConfigChange(key, value);
      }
      // showLegend / legendPosition / showConnectedLine: intentionally no-op
      // (these are hardcoded for the initial-voltage chart).
    },
    [appearance],
  );

  const mainChart = useResizableChart();
  const initialVoltageChart = useResizableChart();

  useEffect(() => {
    recordFetchInFlightRef.current.clear();
    recordMissingRef.current.clear();
    recordLoadedRef.current.clear();
    setCellRecordsByCell({});
    fetchRatePerformance()
      .then((d) => {
        if (d.cells.length) setNewareData(d.cells);
        else setNewareData(null);
      })
      .catch(() => { setNewareData(null); });
  }, [dataVersion]);

  const activeAnalysis = hierarchyData?.analysis ?? null;

  const pathToColorMap = useMemo(
    () => hierarchyData?.pathToColorMap && Object.keys(hierarchyData.pathToColorMap).length > 0
      ? new Map(Object.entries(hierarchyData.pathToColorMap))
      : new Map<string, string>(),
    [hierarchyData?.pathToColorMap],
  );

  const maxDetailDepth = getMaxDetailDepth(treeFilterPath, activeAnalysis?.hierCols ?? []);
  const canDrillDown = treeFilterPath.length > 0 && detailDepth < maxDetailDepth;
  const handleDrillDown = useCallback(() => { setDetailDepth((d) => Math.min(d + 1, maxDetailDepth)); }, [maxDetailDepth]);

  const filteredNeware = useMemo(() => {
    if (!newareData) return [];
    let out: NewareCell[];
    if (multiselectionMode && selectedCellIds.length > 0) {
      out = newareData.filter((c) => selectedCellIds.includes(c.idNo));
    } else {
      const matchedIds = matchPathToIdNos(treeFilterPath);
      if (treeFilterPath.length > 0) {
        if (matchedIds && matchedIds.size > 0) {
          // Tree path takes priority when it can resolve real cells.
          out = newareData.filter((c) => matchedIds.has(c.idNo));
        } else if (!multiselectionMode && selectedCellIds.length === 1) {
          // Fallback for leaf labels that don't map cleanly via path matching.
          out = newareData.filter((c) => c.idNo === selectedCellIds[0]);
        } else {
          return [];
        }
      } else if (!multiselectionMode && selectedCellIds.length === 1) {
        out = newareData.filter((c) => c.idNo === selectedCellIds[0]);
      } else {
        return [];
      }
    }
    if (protocolFilter !== 'All') out = out.filter((c) => c.protocol === protocolFilter);
    return out.sort((a, b) => a.idNo - b.idNo);
  }, [newareData, treeFilterPath, protocolFilter, multiselectionMode, selectedCellIds, matchPathToIdNos]);

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

  const filteredCellIds = useMemo(() => filteredNeware.map((c) => c.idNo).join(','), [filteredNeware]);

  useEffect(() => {
    if (filteredNeware.length === 0) {
      setCellRecordsByCell((prev) => (Object.keys(prev).length ? {} : prev));
      return;
    }
    const idNos = filteredNeware.map((c) => c.idNo);
    setCellRecordsByCell((prev) => {
      const next = { ...prev };
      let changed = false;
      for (const k of Object.keys(next)) {
        const keyNum = Number(k);
        if (!idNos.includes(keyNum)) {
          delete next[keyNum];
          recordLoadedRef.current.delete(keyNum);
          changed = true;
        }
      }
      return changed ? next : prev;
    });
    idNos.forEach((idNo) => {
      if (recordLoadedRef.current.has(idNo)) return;
      if (recordFetchInFlightRef.current.has(idNo)) return;
      if (recordMissingRef.current.has(idNo)) return;
      recordFetchInFlightRef.current.add(idNo);
      fetchCellRecord(idNo)
        .then((d) => {
          const record = d as { curves?: Record<string, Record<string, (number | string | null)[]>>; cellName?: string } | null;
          if (record?.curves) {
            setCellRecordsByCell((prev) => ({
              ...prev,
              [idNo]: { curves: record.curves!, cellName: record.cellName ?? `Cell ${idNo}` },
            }));
            recordLoadedRef.current.add(idNo);
          } else {
            recordMissingRef.current.add(idNo);
          }
        })
        .catch((err) => {
          const msg = err instanceof Error ? err.message : String(err ?? '');
          if (/not found/i.test(msg)) {
            recordMissingRef.current.add(idNo);
          }
        })
        .finally(() => {
          recordFetchInFlightRef.current.delete(idNo);
        });
    });
  }, [filteredCellIds, filteredNeware]);

  const directionLabelLower = direction === 'charge' ? 'charge' : 'discharge';
  const hasPlot = !!activeAnalysis && hasRatePerfTraces(filteredNeware, direction);

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

  const voltageConfig = useMemo((): VoltageTimePlotConfig => ({
    title: initialVoltageTitle, xLabel: initialVoltageXLabel, yLabel: initialVoltageYLabel,
    fontFamily, titleFontSize, labelFontSize, legendFontSize,
  }), [initialVoltageTitle, initialVoltageXLabel, initialVoltageYLabel, fontFamily, titleFontSize, labelFontSize, legendFontSize]);

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex-1 min-h-0 min-w-0 flex gap-0">
        <div className="flex-1 min-w-0 min-h-0 overflow-auto transition-all duration-300">
          <div className="space-y-4 p-4 w-full min-w-0">
            <div className="flex items-center justify-end gap-3">
              <DirectionToggle value={direction} onChange={setDirection} />
            </div>

            <ResizableChartCard
              size={mainChart.size}
              onResizeStart={mainChart.onResizeStart}
              aspectRatio={800 / 480}
              minHeight={280}
            >
              {({ width, height, ResizeHandle }) => (
                <>
                  <div className="flex justify-end gap-2 mb-3">
                    {treeFilterPath.length > 0 && (
                      <Button variant="outline" size="sm" onClick={handleDrillDown} disabled={!canDrillDown} className="gap-1.5"
                        title={canDrillDown ? 'Break down the current groups into the next level of detail' : 'Already showing the finest level of detail'}>
                        <Layers className="h-3.5 w-3.5" />
                        Break down by next level
                      </Button>
                    )}
                  </div>
                  {hasPlot && activeAnalysis ? (
                    <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                      <div className="absolute inset-0" style={{ minWidth: 1, minHeight: 1 }}>
                        <RatePerformancePlot
                          filteredCells={filteredNeware}
                          analysis={activeAnalysis}
                          treeFilterPath={treeFilterPath}
                          pathToColorMap={pathToColorMap}
                          direction={direction}
                          detailDepth={detailDepth}
                          showConnectedLine={appearance.config.showConnectedLine ?? false}
                          config={appearance.config}
                          width={width}
                          height={height}
                          onCellSelect={(cell) => setSelectedCellIds([cell.idNo])}
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
                  ) : (
                    <div className="h-[420px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                      {newareData === null
                        ? <p>No rate performance data found.</p>
                        : direction === 'charge'
                          ? <p>No {directionLabelLower} capacity data for the current selection.</p>
                          : <p>No cells match the current filters. Use the hierarchy tree in the left sidebar to select a node.</p>}
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
                  <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                    <VoltageTimePlot cellRecords={cellRecords} config={voltageConfig} width={width} height={height} />
                    <ChartEditPopover
                      config={initialVoltageAppearanceConfig}
                      onConfigChange={onInitialVoltageConfigChange}
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
    </div>
  );
};

export default RatePerformanceDashboard;
