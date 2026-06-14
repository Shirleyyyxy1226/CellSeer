import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import {
  buildRatePerformanceFigure,
  type RatePerfTraceSpec,
} from '@/cellviz-lib';
import { buildTraces } from '@/lib/ratePerfAggregation';
import type {
  RatePerfCellRaw as NewareCell,
  ProtocolSegment,
} from '@/lib/cellTypes';
import type { TreeFilterPath } from '@/components/tree/treeTypes';
import type { AnalysisResult } from '@/lib/treeUtils';
import type { ChartAppearanceConfig } from '@/components/ChartEditPopover';
import type { ChargeDirection } from '@/components/DirectionToggle';

export interface RatePerformancePlotProps {
  /** Cells after upstream filters (cathode/spacer/separator/tree/protocol). */
  filteredCells: NewareCell[];
  /** Active project analysis providing hierarchy columns + label formatting. */
  analysis: AnalysisResult;
  treeFilterPath: TreeFilterPath;
  pathToColorMap: Map<string, string>;
  direction: ChargeDirection;
  /** 0 = first level below selected tree path; >0 = drill down. */
  detailDepth: number;
  /** Connect points with lines when each cycle has a known C-rate. */
  showConnectedLine: boolean;
  /** Title / labels / fonts / legend; the Y-axis label is data-derived and overrides config.yAxisLabel. */
  config: ChartAppearanceConfig;
  width: number;
  height: number;
  /** Fired on click or right-click of a trace whose underlying cell is known. */
  onCellSelect?: (cell: { idNo: number; cellName: string }) => void;
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
  showConnectedLine,
  config,
  width,
  height,
  onCellSelect,
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

  const { data: traces, traceIndexToCell, shapes, annotations } = useMemo(() => {
    const agg = buildTraces({
      filteredCells,
      treeFilterPath,
      hierCols: analysis.hierCols,
      useSpecificCapacity,
      direction,
      detailDepth,
      pathToColorMap,
      labelDecorations: analysis.labelDecorations,
      annotations: analysis.annotations,
    });
    const traceSpecs: RatePerfTraceSpec[] = agg.map((t) => {
      const cell = (t as { cell?: NewareCell }).cell;
      return {
        name: t.name,
        x: t.x,
        y: t.y,
        color: t.color,
        isAggregated: t.isAggregated,
        hasCrate: t.hasCrate,
        cRates: t.cRates,
        errorMinus: t.errorMinus,
        errorPlus: t.errorPlus,
        cell: cell ? { idNo: cell.idNo, cellName: cell.cellName ?? `Cell ${cell.idNo}` } : undefined,
      };
    });
    return buildRatePerformanceFigure(traceSpecs, {
      direction,
      useSpecificCapacity,
      showConnectedLine,
      protocolSegments,
    });
  }, [
    filteredCells,
    treeFilterPath,
    analysis,
    useSpecificCapacity,
    direction,
    detailDepth,
    pathToColorMap,
    showConnectedLine,
    protocolSegments,
  ]);

  const {
    chartTitle,
    xAxisLabel,
    fontFamily,
    titleFontSize,
    labelFontSize,
    legendFontSize,
    showLegend,
    legendPosition,
  } = config;

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
      legendFontSize,
      showLegend,
      legendPosition,
      shapes,
      annotations,
    ],
  );

  return (
    <PlotlyChart
      key={`main-${width}-${height}`}
      data={traces}
      layout={layout}
      config={{ responsive: true }}
      style={{ width, height }}
      traceIndexToCell={traceIndexToCell}
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
