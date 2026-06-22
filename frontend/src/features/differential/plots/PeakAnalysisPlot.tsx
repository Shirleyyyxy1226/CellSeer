import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import type { ExportContext } from '@/lib/exportUtils';
import type { ChartAppearanceConfig } from '@/components/ChartEditPopover';

interface Props {
  traces: Plotly.Data[];
  /** Hardcoded fallbacks; ignored when `appearance` is provided. */
  xLabel?: string;
  yLabel?: string;
  title?: string;
  uirevision: string;
  layoutOverride?: Partial<Plotly.Layout>;
  /** Optional appearance config from `useChartAppearance`. */
  appearance?: ChartAppearanceConfig;
  exportContext?: ExportContext;
  /** Render size (passed both to the wrapping element and Plotly layout). */
  width?: number;
  height?: number;
}

const FALLBACK_FONT_SIZE = 10;
const FALLBACK_TITLE_FONT_SIZE = 11;
const FALLBACK_FONT_FAMILY = 'Inter';

export function PeakAnalysisPlot({
  traces,
  xLabel,
  yLabel,
  title,
  uirevision,
  layoutOverride,
  appearance,
  width,
  height,
  exportContext,
}: Props) {
  const layout = useMemo<Partial<Plotly.Layout>>(() => {
    const fontFamily = appearance?.fontFamily ?? FALLBACK_FONT_FAMILY;
    const titleSize = appearance?.titleFontSize ?? FALLBACK_TITLE_FONT_SIZE;
    const labelSize = appearance?.labelFontSize ?? FALLBACK_FONT_SIZE;
    const legendSize = appearance?.legendFontSize ?? FALLBACK_FONT_SIZE;
    const tickSize = Math.max(9, labelSize - 1);
    const titleText = appearance?.chartTitle ?? title ?? '';
    const xText = appearance?.xAxisLabel ?? xLabel ?? '';
    const yText = appearance?.yAxisLabel ?? yLabel ?? '';
    const showLegend = appearance?.showLegend ?? true;

    const baseFont = { size: labelSize, family: fontFamily };
    const tickFont = { size: tickSize, family: fontFamily };
    const legendFont = { size: legendSize, family: fontFamily };

    // Legend is forced BELOW the plot (horizontal row under the x-axis) so it
    // never steals plot width or occludes traces. The dashboard's collapse
    // toggle drives `showLegend`; when off, the bottom margin shrinks back.
    const legend: Partial<Plotly.Layout>['legend'] | undefined = showLegend
      ? {
          orientation: 'h',
          x: 0,
          y: -0.2,
          xanchor: 'left',
          yanchor: 'top',
          font: legendFont,
        }
      : undefined;

    const margin = showLegend
      ? { t: 36, r: 44, b: 120, l: 40 }
      : { t: 36, r: 44, b: 48, l: 40 };

    return {
      uirevision,
      title: { text: titleText, font: { size: titleSize, family: fontFamily } },
      font: baseFont,
      xaxis: { title: { text: xText, font: baseFont }, tickfont: tickFont, gridcolor: '#e0e0e0', showgrid: true },
      yaxis: { title: { text: yText, font: baseFont }, tickfont: tickFont, gridcolor: '#e0e0e0', showgrid: true },
      ...layoutOverride,
      // Legend placement / collapse must win over any legend, margin or
      // showlegend that the figure builder put in `layoutOverride`, so these are
      // applied AFTER the spread.
      legend,
      margin,
      showlegend: showLegend,
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    };
  }, [uirevision, title, xLabel, yLabel, layoutOverride, appearance, width, height]);

  const style: React.CSSProperties =
    width != null && height != null
      ? { width, height }
      : { width: '100%', height: '450px' };

  return <PlotlyChart data={traces} layout={layout} style={style} exportContext={exportContext} />;
}
