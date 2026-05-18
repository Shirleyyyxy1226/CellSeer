import { useMemo, useState, useEffect, useCallback, useRef } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import { fetchRatePerformance, fetchCellRecord } from '@/lib/api';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useDataRefresh } from '@/contexts/DataRefreshContext';
import { Button } from '@/components/ui/button';
import { Layers } from 'lucide-react';
import { ChartEditPopover } from '@/components/ChartEditPopover';
import { ResponsiveChartContainer } from '@/components/ResponsiveChartContainer';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProtocolFilter } from '@/contexts/ProtocolFilterContext';
import { buildTraces, getColorForCell, getMaxDetailDepth } from '@/lib/ratePerfAggregation';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import type { RatePerfCellRaw as NewareCell, ProtocolSegment } from '@/lib/cellTypes';
import { VoltageTimePlot, type VoltageTimeCellRecord, type VoltageTimePlotConfig } from './plots/VoltageTimePlot';

interface Props {
  visibleCells: string[];
  cathodeFilter: string;
  spacerFilter: string;
  separatorFilter: string;
  onCathodeFilter?: (v: string) => void;
  onSeparatorFilter?: (v: string) => void;
}

function hexToRgba(hex: string, a: number): string {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `rgba(${r},${g},${b},${a})`;
}

const RatePerformanceHierarchyDashboard = ({}: Props) => {
  const { setSelectedCellIds, multiselectionMode, selectedCellIds } = useCellSelection();
  const [newareData, setNewareData] = useState<NewareCell[] | null>(null);
  const { apiData: hierarchyData, matchPathToIdNos } = useProjectHierarchy();
  const { protocolFilter } = useProtocolFilter();
  const { treeFilterPath } = useTreeFilter();
  const { dataVersion } = useDataRefresh();
  const [detailDepth, setDetailDepth] = useState(0);
  const [showConnectedLine, setShowConnectedLine] = useState(false);
  const [direction, setDirection] = useState<'discharge' | 'charge'>('discharge');
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
  const [chartTitle, setChartTitle] = useState(defaultChartTitle);
  useEffect(() => { setChartTitle(defaultChartTitle); }, [defaultChartTitle]);

  const [xAxisLabel, setXAxisLabel] = useState('Cycle number');
  const [yAxisLabel, setYAxisLabel] = useState('Capacity (mAh g⁻¹)');
  const [fontFamily, setFontFamily] = useState('Inter');
  const [titleFontSize, setTitleFontSize] = useState(14);
  const [labelFontSize, setLabelFontSize] = useState(12);
  const [legendFontSize, setLegendFontSize] = useState(11);
  const [showLegend, setShowLegend] = useState(true);
  const [legendPosition, setLegendPosition] = useState<'in' | 'right-bottom'>('right-bottom');

  const [initialVoltageTitle, setInitialVoltageTitle] = useState('Voltage vs time (first few cycles)');
  const [initialVoltageXLabel, setInitialVoltageXLabel] = useState('Time (s)');
  const [initialVoltageYLabel, setInitialVoltageYLabel] = useState('Voltage (V)');

  const [chartSize, setChartSize] = useState<{ width: number; height: number } | null>(null);
  const [initialVoltageChartSize, setInitialVoltageChartSize] = useState<{ width: number; height: number } | null>(null);
  const resizeRef = useRef<{
    startX: number; startY: number; startW: number; startH: number;
    setSize: (s: { width: number; height: number }) => void;
  } | null>(null);

  const handleResizeStart = useCallback(
    (e: React.MouseEvent, setSize: (s: { width: number; height: number }) => void, currentSize: { width: number; height: number }) => {
      e.preventDefault();
      resizeRef.current = { startX: e.clientX, startY: e.clientY, startW: currentSize.width, startH: currentSize.height, setSize };
    }, [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const r = resizeRef.current;
      if (!r) return;
      r.setSize({ width: Math.max(280, Math.min(1400, r.startW + e.clientX - r.startX)), height: Math.max(200, Math.min(900, r.startH + e.clientY - r.startY)) });
    };
    const onUp = () => { resizeRef.current = null; };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => { window.removeEventListener('mousemove', onMove); window.removeEventListener('mouseup', onUp); };
  }, []);

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
        .then((d: any) => {
          if (d?.curves) {
            setCellRecordsByCell((prev) => ({ ...prev, [idNo]: { curves: d.curves, cellName: d.cellName ?? `Cell ${idNo}` } }));
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

  const useSpecificCapacity = direction === 'discharge' && filteredNeware.some((r) => r.specificCapacityMahG != null);
  const directionLabel = direction === 'charge' ? 'Charge' : 'Discharge';
  const directionLabelLower = direction === 'charge' ? 'charge' : 'discharge';
  const capacityYUnit = useSpecificCapacity ? 'mAh g⁻¹' : 'mAh';
  const effectiveYLabel = useSpecificCapacity
    ? `${directionLabel} specific capacity (mAh g⁻¹)`
    : `${directionLabel} capacity (mAh)`;

  const segmentByCrate = useCallback(
    (x: number[], y: number[], cRates?: number[]): { x: (number | null)[]; y: (number | null)[]; customdata?: (number | null)[] } => {
      if (!cRates || cRates.length !== x.length) return { x, y, customdata: cRates };
      const xOut: (number | null)[] = [], yOut: (number | null)[] = [], cOut: (number | null)[] = [];
      for (let i = 0; i < x.length; i++) {
        if (i > 0 && cRates[i] !== cRates[i - 1]) { xOut.push(null); yOut.push(null); cOut.push(null); }
        xOut.push(x[i]); yOut.push(y[i]); cOut.push(cRates[i]);
      }
      return { x: xOut, y: yOut, customdata: cOut };
    }, [],
  );

  const { traces, traceIndexToCell } = useMemo(() => {
    const empty = { traces: [] as Plotly.Data[], traceIndexToCell: new Map<number, { idNo: number; cellName: string }>() };
    if (!activeAnalysis) return empty;
    const agg = buildTraces({
      filteredCells: filteredNeware,
      treeFilterPath,
      hierCols: activeAnalysis.hierCols,
      useSpecificCapacity,
      direction,
      detailDepth,
      pathToColorMap,
      labelDecorations: activeAnalysis.labelDecorations,
      annotations: activeAnalysis.annotations,
    });
    const out: Plotly.Data[] = [];
    const map = new Map<number, { idNo: number; cellName: string }>();
    agg.forEach((t) => {
      const useLines = showConnectedLine && t.hasCrate && t.cRates;
      const hasRange = t.isAggregated && t.errorMinus && t.errorPlus && t.errorMinus.length === t.y.length;
      if (hasRange && t.errorMinus && t.errorPlus) {
        const yMin = t.y.map((v, i) => v - t.errorMinus![i]);
        const yMax = t.y.map((v, i) => v + t.errorPlus![i]);
        out.push({ x: t.x, y: yMin, type: 'scatter', mode: 'lines', line: { width: 0, color: 'rgba(0,0,0,0)' }, fillcolor: hexToRgba(t.color, 0.25), fill: undefined, showlegend: false, hoverinfo: 'skip' as const });
        out.push({ x: t.x, y: yMax, type: 'scatter', mode: 'lines', line: { width: 0, color: 'rgba(0,0,0,0)' }, fillcolor: hexToRgba(t.color, 0.25), fill: 'tonexty' as const, showlegend: false, hoverinfo: 'skip' as const });
      }
      const { x, y, customdata } = useLines ? segmentByCrate(t.x, t.y, t.cRates) : { x: t.x, y: t.y, customdata: t.cRates };
      out.push({
        x, y, type: 'scatter', mode: useLines ? 'lines+markers' as const : 'markers' as const,
        name: t.name, line: useLines ? { width: 2, color: t.color } : undefined,
        marker: { size: t.isAggregated ? 5 : 6, color: t.color }, connectgaps: false,
        hovertemplate: t.hasCrate
          ? `${t.name}<br>Cycle: %{x}<br>${directionLabel} capacity: %{y:.2f} ${capacityYUnit}${hasRange ? ' (range)' : ''}<br>C-rate: %{customdata}C<extra></extra>`
          : `${t.name}<br>Cycle: %{x}<br>${directionLabel} capacity: %{y:.2f} ${capacityYUnit}${hasRange ? ' (range)' : ''}<extra></extra>`,
        customdata,
      });
      const cell = (t as { cell?: NewareCell }).cell;
      if (cell) map.set(out.length - 1, { idNo: cell.idNo, cellName: cell.cellName ?? `Cell ${cell.idNo}` });
    });
    return { traces: out, traceIndexToCell: map };
  }, [filteredNeware, treeFilterPath, activeAnalysis, useSpecificCapacity, direction, directionLabel, capacityYUnit, detailDepth, pathToColorMap, showConnectedLine, segmentByCrate]);

  const protocolSegments = useMemo((): ProtocolSegment[] => {
    const cell = filteredNeware.find((c) => c.protocolSegments?.length);
    return cell?.protocolSegments ?? [];
  }, [filteredNeware]);

  const protocolShapes = useMemo((): Partial<Plotly.Shape>[] => {
    if (protocolSegments.length <= 1) return [];
    const maxY = Math.max(
      0,
      ...filteredNeware.flatMap((r) => {
        if (direction === 'charge') return r.chargeCapacityMah ?? [0];
        return useSpecificCapacity ? r.specificCapacityMahG ?? r.dischargeCapacityMah ?? [0] : r.dischargeCapacityMah ?? [0];
      }),
    );
    const yTop = maxY * 1.02 || 1;
    return protocolSegments.slice(0, -1).map((seg) => ({
      type: 'line' as const, x0: seg.cycleEnd + 0.5, x1: seg.cycleEnd + 0.5, y0: 0, y1: yTop,
      xref: 'x', yref: 'y', line: { dash: 'dash', width: 1.5, color: 'rgba(128,128,128,0.7)' }, layer: 'below',
    }));
  }, [protocolSegments, filteredNeware, direction, useSpecificCapacity]);

  const protocolAnnotations = useMemo((): Partial<Plotly.Annotations>[] => {
    if (!protocolSegments.length) return [];
    return protocolSegments.map((seg) => ({
      x: (seg.cycleStart + seg.cycleEnd) / 2, y: 1, yref: 'paper',
      xanchor: 'center', yanchor: 'top', text: `${seg.cRate}C`, showarrow: false, font: { size: 10, color: '#555' },
    }));
  }, [protocolSegments]);

  const layout = useMemo((): Partial<Plotly.Layout> => ({
    autosize: false,
    font: { family: `${fontFamily}, sans-serif` },
    title: { text: chartTitle, font: { size: titleFontSize } },
    xaxis: { title: { text: xAxisLabel, font: { size: labelFontSize } }, tickfont: { size: Math.max(9, labelFontSize - 1) }, gridcolor: 'rgba(128,128,128,0.2)' },
    yaxis: { title: { text: effectiveYLabel, font: { size: labelFontSize } }, tickfont: { size: Math.max(9, labelFontSize - 1) }, gridcolor: 'rgba(128,128,128,0.2)' },
    showlegend: showLegend,
    legend: showLegend
      ? { orientation: 'v', font: { size: legendFontSize }, ...(legendPosition === 'in' ? { x: 0.99, y: 1, xanchor: 'right', yanchor: 'top', bgcolor: 'rgba(255,255,255,0.9)' } : { x: 1.02, y: 0, xanchor: 'left', yanchor: 'bottom' }) }
      : undefined,
    margin: { t: 48, r: showLegend && legendPosition === 'right-bottom' ? 120 : 40, b: 80, l: 65 },
    uirevision: 'rate-perf-hier',
    shapes: protocolShapes,
    annotations: protocolAnnotations,
  }), [chartTitle, xAxisLabel, effectiveYLabel, fontFamily, titleFontSize, labelFontSize, legendFontSize, showLegend, legendPosition, protocolShapes, protocolAnnotations]);

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
              <div className="inline-flex items-center rounded-full border border-border bg-muted/60 p-1">
                <Button
                  variant="ghost"
                  size="sm"
                  className={`rounded-full px-4 ${direction === 'discharge' ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'}`}
                  onClick={() => setDirection('discharge')}
                >
                  Discharge
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  className={`rounded-full px-4 ${direction === 'charge' ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'}`}
                  onClick={() => setDirection('charge')}
                >
                  Charge
                </Button>
              </div>
            </div>
            <div className="rounded-lg border border-border bg-card p-4 overflow-auto w-full min-w-0">
              <div className="flex justify-end gap-2 mb-3">
                {treeFilterPath.length > 0 && (
                  <Button variant="outline" size="sm" onClick={handleDrillDown} disabled={!canDrillDown} className="gap-1.5"
                    title={canDrillDown ? 'Break down the current groups into the next level of detail' : 'Already showing the finest level of detail'}>
                    <Layers className="h-3.5 w-3.5" />
                    Break down by next level
                  </Button>
                )}
              </div>
              {traces.length > 0 ? (
                <ResponsiveChartContainer aspectRatio={800 / 480} minHeight={280} overrideSize={chartSize}>
                  {({ width, height }) => (
                    <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                      <div className="absolute inset-0" style={{ minWidth: 1, minHeight: 1 }}>
                        <PlotlyChart
                          key={`main-${width}-${height}`}
                          data={traces}
                          layout={{ ...layout, width, height }}
                          config={{ responsive: true }}
                          style={{ width, height }}
                          traceIndexToCell={traceIndexToCell}
                          onContextMenu={(cell) => setSelectedCellIds([cell.idNo])}
                          onClick={(ev) => {
                            const curveNumber = ev.points?.[0]?.curveNumber;
                            if (curveNumber != null) {
                              const cell = traceIndexToCell.get(curveNumber);
                              if (cell) setSelectedCellIds([cell.idNo]);
                            }
                          }}
                        />
                      </div>
                      <ChartEditPopover
                        config={{ chartTitle, xAxisLabel, yAxisLabel, fontFamily, titleFontSize, labelFontSize, legendFontSize, showLegend, legendPosition, showConnectedLine }}
                        onConfigChange={(k, v) => {
                          if (k === 'chartTitle') setChartTitle(v as string);
                          else if (k === 'xAxisLabel') setXAxisLabel(v as string);
                          else if (k === 'yAxisLabel') setYAxisLabel(v as string);
                          else if (k === 'fontFamily') setFontFamily(v as string);
                          else if (k === 'titleFontSize') setTitleFontSize(v as number);
                          else if (k === 'labelFontSize') setLabelFontSize(v as number);
                          else if (k === 'legendFontSize') setLegendFontSize(v as number);
                          else if (k === 'showLegend') setShowLegend(v as boolean);
                          else if (k === 'legendPosition') setLegendPosition(v as 'in' | 'right-bottom');
                          else if (k === 'showConnectedLine') setShowConnectedLine((v as boolean) ?? false);
                        }}
                        showConnectedLineOption
                        chartLabel="Rate performance"
                      />
                      <div
                        role="button" tabIndex={0}
                        onMouseDown={(e) => handleResizeStart(e, setChartSize, { width, height })}
                        className="absolute bottom-0 right-0 z-10 w-6 h-6 cursor-se-resize flex items-end justify-end p-0.5 hover:bg-muted/60 rounded-tl select-none border-t border-l border-muted/50"
                        title="Drag to resize" aria-label="Resize chart"
                      >
                        <div className="w-2 h-2 border-b border-r border-muted-foreground/60 rounded-sm" />
                      </div>
                    </div>
                  )}
                </ResponsiveChartContainer>
              ) : (
                <div className="h-[420px] flex flex-col items-center justify-center text-muted-foreground gap-2">
                  {newareData === null
                    ? <p>No rate performance data found.</p>
                    : direction === 'charge'
                      ? <p>No {directionLabelLower} capacity data for the current selection.</p>
                      : <p>No cells match the current filters. Use the hierarchy tree in the left sidebar to select a node.</p>}
                </div>
              )}
            </div>

            {cellRecords.length > 0 && (
              <div className="rounded-lg border border-border bg-card p-4 overflow-auto w-full min-w-0">
                <ResponsiveChartContainer aspectRatio={800 / 320} minHeight={200} overrideSize={initialVoltageChartSize}>
                  {({ width, height }) => (
                    <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
                      <VoltageTimePlot cellRecords={cellRecords} config={voltageConfig} width={width} height={height} />
                      <ChartEditPopover
                        config={{ chartTitle: initialVoltageTitle, xAxisLabel: initialVoltageXLabel, yAxisLabel: initialVoltageYLabel, fontFamily, titleFontSize, labelFontSize, legendFontSize, showLegend: true, legendPosition: 'right-bottom' }}
                        onConfigChange={(k, v) => {
                          if (k === 'chartTitle') setInitialVoltageTitle(v as string);
                          else if (k === 'xAxisLabel') setInitialVoltageXLabel(v as string);
                          else if (k === 'yAxisLabel') setInitialVoltageYLabel(v as string);
                          else if (k === 'fontFamily') setFontFamily(v as string);
                          else if (k === 'titleFontSize') setTitleFontSize(v as number);
                          else if (k === 'labelFontSize') setLabelFontSize(v as number);
                          else if (k === 'legendFontSize') setLegendFontSize(v as number);
                        }}
                        chartLabel="Initial voltage"
                      />
                      <div
                        role="button" tabIndex={0}
                        onMouseDown={(e) => handleResizeStart(e, setInitialVoltageChartSize, { width, height })}
                        className="absolute bottom-0 right-0 z-10 w-6 h-6 cursor-se-resize flex items-end justify-end p-0.5 hover:bg-muted/60 rounded-tl select-none border-t border-l border-muted/50"
                        title="Drag to resize" aria-label="Resize chart"
                      >
                        <div className="w-2 h-2 border-b border-r border-muted-foreground/60 rounded-sm" />
                      </div>
                    </div>
                  )}
                </ResponsiveChartContainer>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};

export default RatePerformanceHierarchyDashboard;
