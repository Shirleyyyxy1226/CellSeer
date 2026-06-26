import { useEffect, useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import type { ExportContext } from '@/lib/exportUtils';
import {
  buildRatePerformanceFigure,
  type RatePerfTraceSpec,
} from '@/charts';
import { buildTraces } from '@/lib/ratePerfAggregation';
import { buildCellEncodings } from '@/lib/cellColorScheme';
import type {
  RatePerfCell as CyclingCell,
  ProtocolSegment,
} from '@/lib/cellTypes';
import type { TreeFilterPath } from '@/components/tree/treeTypes';
import type { AnalysisResult } from '@/lib/treeUtils';
import type { ChartAppearanceConfig } from '@/components/ChartEditPopover';
import type { ChargeDirection } from '@/components/DirectionToggle';
import { tracesToLegendItems } from '@/lib/traceLegend';
import type { LegendItem } from '@/components/ChartLegend';

export interface RatePerformancePlotProps {
  /** Cells after upstream filters (cathode/spacer/separator/tree/protocol). */
  filteredCells: CyclingCell[];
  /** Active project analysis providing hierarchy columns + label formatting. */
  analysis: AnalysisResult;
  treeFilterPath: TreeFilterPath;
  pathToColorMap: Map<string, string>;
  direction: ChargeDirection;
  /** 0 = first level below selected tree path; >0 = drill down. */
  detailDepth: number;
  /** Optional hierarchy metadata rows keyed by idNo for non-hardcoded grouping. */
  metadataByIdNo?: Map<number, Record<string, string>>;
  /** Title / labels / fonts / legend; the Y-axis label is data-derived and overrides config.yAxisLabel. */
  config: ChartAppearanceConfig;
  width: number;
  height: number;
  /** Fired on click or right-click of a trace whose underlying cell is known. */
  onCellSelect?: (cell: { idNo: number; cellName: string }) => void;
  /** Receives the derived legend entries so the dashboard can render the legend block below the plot. */
  onLegendItems?: (items: LegendItem[]) => void;
  /** When true, overlay per-cell Coulombic efficiency on a right-hand axis (ignored for aggregated bands). */
  showCE?: boolean;
  /** Reports whether the current view is aggregated (band mode), so the parent can disable the CE toggle. */
  onAggregatedChange?: (aggregated: boolean) => void;
}

/**
 * Hierarchy-aware rate-performance chart. Internally:
 *   buildTraces (aggregation) → RatePerfTraceSpec[] → buildRatePerformanceFigure
 * Owns layout construction and `<PlotlyChart>` rendering; the parent only
 * supplies inputs and receives selection events via `onCellSelect`.
 */
export function RatePerformancePlot({
  filteredCells,
  analysis,
  treeFilterPath,
  pathToColorMap,
  direction,
  detailDepth,
  metadataByIdNo,
  config,
  width,
  height,
  showCE = false,
  onAggregatedChange,
  onCellSelect,
  onLegendItems,
}: RatePerformancePlotProps) {
  const useSpecificCapacity =
    direction === 'discharge' && filteredCells.some((r) => r.specificCapacityMahG != null);
  const directionLabel = direction === 'charge' ? 'Charge' : 'Discharge';
  const effectiveYLabel = useSpecificCapacity
    ? `${directionLabel} specific capacity (mAh g⁻¹)`
    : `${directionLabel} capacity (mAh)`;

  const protocolSegments = useMemo<ProtocolSegment[]>(() => {
    const cell = filteredCells.find((c) => c.protocolSegments?.length);
    return cell?.protocolSegments ?? [];
  }, [filteredCells]);

  const { data: baseData, traceIndexToCell, shapes, annotations, ceTraces, isAggregated } = useMemo(() => {
    // Per-cell colour + orthogonal dash/symbol for the cells on screen, so
    // overlaid similar cells stay distinguishable (and recolour to the
    // max-contrast palette when that toggle is on).
    const cellEncodings = buildCellEncodings(filteredCells, {
      maximizeContrast: config.maximizeContrast ?? false,
    });
    const agg = buildTraces({
      filteredCells,
      treeFilterPath,
      hierCols: analysis.hierCols,
      useSpecificCapacity,
      direction,
      detailDepth,
      pathToColorMap,
      cellEncodings,
      labelDecorations: analysis.labelDecorations,
      annotations: analysis.annotations,
      metadataByIdNo,
    });
    const traceSpecs: RatePerfTraceSpec[] = agg.map((t) => {
      const cell = (t as { cell?: CyclingCell }).cell;
      return {
        name: t.name,
        x: t.x,
        y: t.y,
        color: t.color,
        dash: t.dash,
        symbol: t.symbol,
        isAggregated: t.isAggregated,
        hasCrate: t.hasCrate,
        cRates: t.cRates,
        errorMinus: t.errorMinus,
        errorPlus: t.errorPlus,
        cell: cell ? { idNo: cell.idNo, cellName: cell.cellName ?? `Cell ${cell.idNo}` } : undefined,
      };
    });
    const figure = buildRatePerformanceFigure(traceSpecs, {
      direction,
      useSpecificCapacity,
      protocolSegments,
    });

    // Per-cell Coulombic efficiency (discharge ÷ charge, %) for the optional
    // right-axis overlay. Only for non-aggregated per-cell traces; a dotted line
    // per cell in the cell's own colour so many cells stay distinguishable.
    const cellById = new Map(filteredCells.map((c) => [c.idNo, c]));
    const ceTraces: Plotly.Data[] = [];
    for (const t of agg) {
      if (t.isAggregated) continue;
      const ref = (t as { cell?: { idNo: number } }).cell;
      const cell = ref ? cellById.get(ref.idNo) : undefined;
      if (!cell) continue;
      const ch = cell.chargeCapacityMah;
      const dch = cell.dischargeCapacityMah;
      const cyc = cell.cycles ?? [];
      if (!ch?.length || !dch?.length || ch.length !== dch.length) continue;
      const x: number[] = [];
      const y: number[] = [];
      for (let i = 0; i < dch.length; i++) {
        const c = ch[i];
        const d = dch[i];
        if (c == null || d == null || c <= 1e-9) continue;
        const ce = (d / c) * 100;
        if (Number.isFinite(ce)) {
          x.push(cyc[i] ?? i);
          y.push(ce);
        }
      }
      if (!x.length) continue;
      ceTraces.push({
        x,
        y,
        type: 'scatter',
        mode: 'lines+markers',
        name: `${t.name} CE`,
        line: { color: t.color, dash: 'dot', width: 1.5 },
        marker: { color: t.color, size: 3 },
        opacity: 0.65,
        yaxis: 'y2',
        showlegend: false,
        hovertemplate: 'cycle %{x}<br>CE %{y:.1f}%<extra></extra>',
      } as Plotly.Data);
    }

    return { ...figure, ceTraces, isAggregated: agg.some((t) => t.isAggregated) };
  }, [
    filteredCells,
    treeFilterPath,
    analysis,
    useSpecificCapacity,
    direction,
    detailDepth,
    metadataByIdNo,
    pathToColorMap,
    protocolSegments,
    config.maximizeContrast,
  ]);

  const ceActive = showCE && !isAggregated;
  const traces = useMemo(
    () => (ceActive ? [...baseData, ...ceTraces] : baseData),
    [ceActive, baseData, ceTraces],
  );

  // Let the dashboard disable the CE toggle while the view is an aggregated band.
  useEffect(() => {
    onAggregatedChange?.(isAggregated);
  }, [isAggregated, onAggregatedChange]);

  const {
    chartTitle,
    xAxisLabel,
    fontFamily,
    titleFontSize,
    labelFontSize,
  } = config;

  // Surface the derived legend entries: the real trace set is only known here,
  // after aggregation. CE overlay lines are excluded (showlegend off / no cell).
  const legendItems = useMemo(() => tracesToLegendItems(baseData), [baseData]);
  useEffect(() => {
    onLegendItems?.(legendItems);
  }, [legendItems, onLegendItems]);

  const layout = useMemo<Partial<Plotly.Layout>>(
    () => ({
      width,
      height,
      autosize: false,
      font: { family: `${fontFamily}, sans-serif` },
      title: { text: chartTitle, font: { size: titleFontSize } },
      xaxis: {
        title: { text: xAxisLabel, font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      yaxis: {
        title: { text: effectiveYLabel, font: { size: labelFontSize } },
        tickfont: { size: Math.max(9, labelFontSize - 1) },
        gridcolor: 'rgba(128,128,128,0.2)',
      },
      ...(ceActive
        ? {
            yaxis2: {
              title: { text: 'Coulombic efficiency (%)', font: { size: labelFontSize } },
              tickfont: { size: Math.max(9, labelFontSize - 1) },
              overlaying: 'y' as const,
              side: 'right' as const,
              showgrid: false,
            },
          }
        : {}),
      // Legend is drawn as an HTML block below the plot (see ChartLegend), so the
      // in-figure legend is off and the inflated bottom margin is reclaimed.
      showlegend: false,
      margin: { t: 48, r: ceActive ? 62 : 44, b: 80, l: 65 },
      uirevision: 'rate-perf-hier',
      shapes,
      annotations,
    }),
    [
      width,
      height,
      chartTitle,
      xAxisLabel,
      effectiveYLabel,
      fontFamily,
      titleFontSize,
      labelFontSize,
      shapes,
      annotations,
      ceActive,
    ],
  );

  const exportContext = useMemo<ExportContext>(
    () => ({
      plotType: 'rate',
      sourceCellIds: filteredCells.map((c) => c.cellId),
      sourceEndpoints: filteredCells.map((c) =>
        new URL(`/api/rate-performance?cellId=${encodeURIComponent(c.cellId)}`, window.location.origin).toString(),
      ),
      settings: { direction },
    }),
    [filteredCells, direction],
  );

  return (
    <PlotlyChart
      key={`main-${width}-${height}`}
      data={traces}
      layout={layout}
      config={{ responsive: true }}
      style={{ width, height }}
      hoverFocus={filteredCells.length > 1}
      traceIndexToCell={traceIndexToCell}
      exportContext={exportContext}
      onContextMenu={(cell) => onCellSelect?.(cell)}
      onClick={(ev) => {
        const curveNumber = ev.points?.[0]?.curveNumber;
        if (curveNumber != null) {
          const cell = traceIndexToCell.get(curveNumber);
          if (cell) onCellSelect?.(cell);
        }
      }}
    />
  );
}
