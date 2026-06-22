import { useMemo } from 'react';
import PlotlyChart from '@/components/PlotlyChart';
import type { Dataset } from 'cellseer-lib';
import type { ChartAppearanceConfig } from '@/components/ChartEditPopover';
import type { ExportContext } from '@/lib/exportUtils';

interface Props {
  datasets: Dataset[];
  /** Label for the capacity/voltage dimension (used on y-axis). */
  xLabel?: string;
  /** Differential capacity label (dV/dQ or dQ/dV) — used in hover. */
  zLabel?: string;
  appearance?: ChartAppearanceConfig;
  exportContext?: ExportContext;
  width?: number;
  height?: number;
}

const FALLBACK_FONT = 'Inter';
const FALLBACK_LABEL_SIZE = 10;

/**
 * Peak-amplitude evolution: Y = max |dV/dQ| per cycle, plotted against cycle.
 * This is the faithful 2D flattening of the cycle-facing 3D "Evolution" camera
 * (look along the capacity axis): both share dV/dQ on the vertical and cycle on
 * the horizontal, so the two panels stay aligned. A rising/falling peak height
 * tracks how sharply the phase transition resolves as the cell ages.
 */
export function EvolutionHeatmapPlot({
  datasets,
  zLabel = '',
  appearance,
  exportContext,
  width,
  height,
}: Props) {
  const yLabel = appearance?.yAxisLabel ?? zLabel;

  const traces = useMemo<Plotly.Data[]>(() => {
    return datasets.map((d) => {
      const xs = d.cycles.map((c) => c.cycle);
      const ys = d.cycles.map((c) => {
        const vals = c.y.filter((v) => v != null && isFinite(v));
        if (!vals.length) return null;
        return Math.max(...vals.map(Math.abs));
      });

      return {
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        name: d.label,
        x: xs,
        y: ys,
        line: { color: d.color, width: 1.5 },
        marker: { color: d.color, size: 4 },
        hovertemplate: `${d.label}<br>Cycle: %{x}<br>Peak ${yLabel}: %{y:.4f}<extra></extra>`,
      };
    });
  }, [datasets, yLabel]);

  const layout = useMemo<Partial<Plotly.Layout>>(() => {
    const family = appearance?.fontFamily ?? FALLBACK_FONT;
    const labelSize = appearance?.labelFontSize ?? FALLBACK_LABEL_SIZE;
    const titleSize = appearance?.titleFontSize ?? 11;
    const legendSize = appearance?.legendFontSize ?? FALLBACK_LABEL_SIZE;
    const showLegend = appearance?.showLegend ?? true;
    const baseFont = { size: labelSize, family };

    return {
      xaxis: { title: { text: 'Cycle', font: baseFont }, gridcolor: '#e0e0e0', tickfont: baseFont },
      yaxis: { title: { text: `Peak |${yLabel}|`, font: baseFont }, gridcolor: '#e0e0e0', tickfont: baseFont },
      title: {
        text: appearance?.chartTitle ?? `Peak ${yLabel || 'dV/dQ'} vs cycle`,
        font: { size: titleSize, family },
      },
      font: baseFont,
      showlegend: showLegend,
      legend: showLegend
        ? { orientation: 'h' as const, x: 0, y: -0.18, xanchor: 'left' as const, yanchor: 'top' as const, font: { size: legendSize, family } }
        : undefined,
      margin: { t: 36, r: 16, b: showLegend ? 90 : 56, l: 56 },
      ...(width != null ? { width } : {}),
      ...(height != null ? { height } : {}),
    };
  }, [appearance, yLabel, width, height]);

  if (!datasets.length) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-muted-foreground">
        No data available
      </div>
    );
  }

  const containerStyle: React.CSSProperties =
    width != null && height != null ? { width, height } : { width: '100%', height: '100%' };

  return (
    <div style={{ position: 'relative', ...containerStyle }}>
      <PlotlyChart
        data={traces}
        layout={layout}
        style={{ width: '100%', height: '100%' }}
        exportContext={exportContext}
      />
    </div>
  );
}
