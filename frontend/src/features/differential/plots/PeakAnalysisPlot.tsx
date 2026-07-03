import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import type { ExportContext } from '@/lib/plot/exportUtils';
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
  /** R0 hover-to-focus: dim other cells on hover (enable for multi-cell overlays). */
  hoverFocus?: boolean;
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
  hoverFocus = false,
}: Props) {
  const layout = useMemo<Partial<Plotly.Layout>>(() => {
    const fontFamily = appearance?.fontFamily ?? FALLBACK_FONT_FAMILY;
    const titleSize = appearance?.titleFontSize ?? FALLBACK_TITLE_FONT_SIZE;
    const labelSize = appearance?.labelFontSize ?? FALLBACK_FONT_SIZE;
    const tickSize = Math.max(9, labelSize - 1);
    const titleText = appearance?.chartTitle ?? title ?? '';
    const xText = appearance?.xAxisLabel ?? xLabel ?? '';
    const yText = appearance?.yAxisLabel ?? yLabel ?? '';

    const baseFont = { size: labelSize, family: fontFamily };
    const tickFont = { size: tickSize, family: fontFamily };

    return {
      uirevision,
      // Left-anchored so a long title grows leftward and never runs under the
      // edit / export buttons floating at the chart's top-right corner.
      title: { text: titleText, font: { size: titleSize, family: fontFamily }, x: 0, xref: 'paper', xanchor: 'left', pad: { l: 4 } },
      font: baseFont,
      xaxis: { title: { text: xText, font: baseFont }, tickfont: tickFont, gridcolor: '#e0e0e0', showgrid: true },
      yaxis: { title: { text: yText, font: baseFont }, tickfont: tickFont, gridcolor: '#e0e0e0', showgrid: true },
      ...layoutOverride,
      // Legend is now an HTML block below the plot (see ChartLegend); force the
      // in-figure legend off and reclaim the bottom margin, overriding anything
      // the figure builder put in layoutOverride.
      legend: undefined,
      margin: { t: 36, r: 44, b: 48, l: 40 },
      showlegend: false,
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    };
  }, [uirevision, title, xLabel, yLabel, layoutOverride, appearance, width, height]);

  const style: React.CSSProperties =
    width != null && height != null
      ? { width, height }
      : { width: '100%', height: '100%' };

  return <PlotlyChart data={traces} layout={layout} style={style} hoverFocus={hoverFocus} exportContext={exportContext} />;
}
