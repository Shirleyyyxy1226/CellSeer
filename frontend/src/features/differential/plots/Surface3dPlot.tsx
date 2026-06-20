import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import type { ExportContext } from '@/lib/exportUtils';
import type { ChartAppearanceConfig } from '@/components/ChartEditPopover';

interface Props {
  traces: Plotly.Data[];
  xValues: number[];
  /** Hardcoded fallbacks; ignored when `appearance` is provided. */
  xLabel?: string;
  zLabel?: string;
  title?: string;
  uirevision: string;
  layoutOverride?: Partial<Plotly.Layout>;
  /**
   * Optional appearance config from `useChartAppearance`. When set, the
   * popover's title/axis labels/fonts/legend drive the layout. The 3D
   * `yaxis` (cycle dimension) intentionally stays hardcoded — it is fixed
   * by the plot type.
   */
  appearance?: ChartAppearanceConfig;
  exportContext?: ExportContext;
  /** Render size (passed both to the wrapping element and Plotly layout). */
  width?: number;
  height?: number;
}

const FALLBACK_FONT_SIZE = 10;
const FALLBACK_TITLE_FONT_SIZE = 11;
const FALLBACK_FONT_FAMILY = 'Inter';

export function Surface3dPlot({
  traces,
  xValues,
  xLabel,
  zLabel,
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
    const zText = appearance?.yAxisLabel ?? zLabel ?? '';
    const showLegend = appearance?.showLegend ?? true;

    const baseFont = { size: labelSize, family: fontFamily };
    const tickFont = { size: tickSize, family: fontFamily };

    return {
      uirevision,
      title: { text: titleText, font: { size: titleSize, family: fontFamily } },
      font: baseFont,
      scene: {
        xaxis: {
          title: { text: xText, font: baseFont },
          range: xValues.length > 0 ? [Math.max(...xValues), Math.min(...xValues)] : undefined,
          gridcolor: '#e0e0e0',
          tickfont: tickFont,
        },
        yaxis: { title: { text: 'Cycle', font: baseFont }, gridcolor: '#e0e0e0', tickfont: tickFont },
        zaxis: { title: { text: zText, font: baseFont }, gridcolor: '#e0e0e0', tickfont: tickFont },
        camera: { eye: { x: 1.25, y: 1.25, z: 1.25 } },
      },
      showlegend: showLegend,
      legend: showLegend
        ? { x: 0, y: -0.12, orientation: 'h', font: { size: legendSize, family: fontFamily } }
        : undefined,
      margin: { t: 36, r: 8, b: 8, l: 8 },
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
      ...layoutOverride,
    };
  }, [uirevision, title, xLabel, zLabel, xValues, layoutOverride, appearance, width, height]);

  const style: React.CSSProperties =
    width != null && height != null
      ? { width, height }
      : { width: '100%', height: '500px' };

  return <PlotlyChart data={traces} layout={layout} style={style} exportContext={exportContext} />;
}
