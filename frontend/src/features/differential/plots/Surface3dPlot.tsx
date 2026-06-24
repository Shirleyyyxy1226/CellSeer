import { useEffect, useMemo, useRef, useState } from 'react';
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
  /** Called when a camera preset is clicked, signalling which 2D panel to open. */
  onOpenPanel?: (panel: 'profile' | 'evolution') => void;
  /** Resize handle rendered inside the plot area (above the footer strip). */
  ResizeHandle?: () => React.ReactElement;
}

const FALLBACK_FONT_SIZE = 10;
const FALLBACK_TITLE_FONT_SIZE = 11;
const FALLBACK_FONT_FAMILY = 'Inter';

/** Mildly off-axis default — upright (low roll), both axes readable. Pulled out
 *  to magnitude ≈2.9 (same as the presets) so axis labels never clip on Reset. */
const DEFAULT_EYE = { x: 2.3, y: 1.6, z: 0.95 } as const;

/** Camera presets for the differential-capacity surface (x=Capacity, y=Cycle,
 *  z=dV/dQ). Eyes verified by labelled snapshot sweep:
 *  - A CYCLE-dominant eye (y only) puts CAPACITY on the bottom horizontal axis
 *    → "Profile": read dV/dQ vs capacity (peak shapes), cycles stacked in depth.
 *  - A CAPACITY-dominant eye (x only) puts CYCLE on the bottom horizontal axis
 *    → "Evolution": read dV/dQ vs cycle (peak heights), capacity into depth.
 *  Each preset's horizontal axis matches its 2D panel's x-axis. The off-axis
 *  component is 0 so the view is FRONT-ON (not skewed); low z keeps it upright;
 *  magnitude ≈2.9 zooms out enough that no axis label is clipped. */
const CAMERA_PRESETS: Array<{
  label: string;
  title: string;
  eye: { x: number; y: number; z: number };
  panel: 'profile' | 'evolution';
}> = [
  { label: 'Profile', panel: 'profile', title: 'Capacity × dV/dQ — peak shapes & positions; opens 2D peak profile beside', eye: { x: 0, y: 2.9, z: 0.6 } },
  { label: 'Evolution', panel: 'evolution', title: 'Cycle × dV/dQ — how peaks evolve over cycling; opens 2D evolution plot beside', eye: { x: 2.9, y: 0, z: 0.6 } },
];

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
  onOpenPanel,
  ResizeHandle,
}: Props) {
  // Camera is state-driven (not imperative relayout) so a preset reliably wins
  // over the React re-render that follows opening the 2D panel. The eye is baked
  // into uirevision: changing it forces Plotly to apply the new camera, while an
  // unchanged eye lets free-rotation persist across data refreshes.
  const [cameraEye, setCameraEye] = useState<{ x: number; y: number; z: number }>({ ...DEFAULT_EYE });
  const [cameraSeq, setCameraSeq] = useState(0);
  const eyeKey = `${cameraEye.x},${cameraEye.y},${cameraEye.z}|${cameraSeq}`;

  // The camera toolbar sits in a footer strip BELOW the plot (not overlaid), so
  // the plot reserves room for it. Height passed in is the whole card; the plot
  // gets the remainder above the footer.
  const FOOTER_H = 36;
  const plotH = height != null ? Math.max(160, height - FOOTER_H) : undefined;

  const layout = useMemo<Partial<Plotly.Layout>>(() => {
    const fontFamily = appearance?.fontFamily ?? FALLBACK_FONT_FAMILY;
    const titleSize = appearance?.titleFontSize ?? FALLBACK_TITLE_FONT_SIZE;
    const labelSize = appearance?.labelFontSize ?? FALLBACK_FONT_SIZE;
    const tickSize = Math.max(9, labelSize - 1);
    const titleText = appearance?.chartTitle ?? title ?? '';
    const xText = appearance?.xAxisLabel ?? xLabel ?? '';
    const zText = appearance?.yAxisLabel ?? zLabel ?? '';

    const baseFont = { size: labelSize, family: fontFamily };
    const tickFont = { size: tickSize, family: fontFamily };

    // Deep-merge scene so our camera and axis labels win over the library defaults,
    // but library-supplied axis ranges (e.g. capacity min/max) are still preserved.
    const { scene: overrideScene, ...restOverride } = (layoutOverride ?? {}) as {
      scene?: Partial<Plotly.Scene>;
      [k: string]: unknown;
    };

    return {
      // Eye baked into uirevision so a preset change is applied; same eye keeps
      // the user's manual rotation across data updates.
      uirevision: `${uirevision}|${eyeKey}`,
      title: { text: titleText, font: { size: titleSize, family: fontFamily } },
      font: baseFont,
      ...restOverride,
      scene: {
        ...overrideScene,
        xaxis: {
          ...overrideScene?.xaxis,
          title: { text: xText, font: baseFont },
          range: xValues.length > 0 ? [Math.min(...xValues), Math.max(...xValues)] : (overrideScene?.xaxis as { range?: unknown } | undefined)?.range,
          gridcolor: '#e0e0e0',
          tickfont: tickFont,
        },
        yaxis: { ...overrideScene?.yaxis, title: { text: 'Cycle (absolute)', font: baseFont }, gridcolor: '#e0e0e0', tickfont: tickFont },
        zaxis: { ...overrideScene?.zaxis, title: { text: zText, font: baseFont }, gridcolor: '#e0e0e0', tickfont: tickFont },
        // up = z keeps the view upright (no roll); eye is state-driven.
        camera: { eye: cameraEye, up: { x: 0, y: 0, z: 1 } },
      },
      // The series legend is rendered as a ChartLegend block below the plot
      // (matching the 2D panels), not inside the Plotly figure.
      showlegend: false,
      // Generous side/bottom margins so 3D axis titles never clip at the card edge.
      margin: { t: 32, r: 24, b: 48, l: 24 },
      ...(width != null ? { width } : {}),
      ...(plotH != null ? { height: plotH } : {}),
    };
  }, [uirevision, eyeKey, cameraEye, title, xLabel, zLabel, xValues, layoutOverride, appearance, width, plotH]);

  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => e.preventDefault();
    el.addEventListener('wheel', onWheel, { passive: false });
    return () => el.removeEventListener('wheel', onWheel);
  }, [ref]);

  return (
    <div
      ref={ref}
      style={{
        display: 'flex',
        flexDirection: 'column',
        ...(width != null && height != null ? { width, height } : { width: '100%', height: '500px' }),
      }}
    >
      {/* Plot area — height reserves the footer below it */}
      <div style={{ position: 'relative', width: '100%', height: plotH ?? '100%', flex: plotH != null ? undefined : 1, minHeight: 0 }}>
        <PlotlyChart
          data={traces}
          layout={layout}
          style={{ width: '100%', height: '100%' }}
          exportContext={exportContext}
        />
        {ResizeHandle && <ResizeHandle />}
      </div>

      {/* Footer strip: camera presets + Reset 3D (below the plot, not overlaid) */}
      <div
        className="flex items-center gap-1 px-2 border-t border-border/50 bg-muted/20 shrink-0"
        style={{ height: FOOTER_H }}
      >
        <span className="text-[10px] uppercase tracking-wide text-muted-foreground/70 mr-1">View</span>
        {CAMERA_PRESETS.map((p) => (
          <button
            key={p.label}
            type="button"
            title={p.title}
            onClick={() => {
              setCameraEye({ ...p.eye });
              setCameraSeq((n) => n + 1);
              onOpenPanel?.(p.panel);
            }}
            className="rounded-md border border-border/50 bg-background px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            {p.label}
          </button>
        ))}
        <button
          type="button"
          title="Reset 3D camera to default perspective"
          onClick={() => { setCameraEye({ ...DEFAULT_EYE }); setCameraSeq((n) => n + 1); }}
          className="rounded-md border border-border/50 bg-background px-2 py-0.5 text-xs text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          Reset 3D
        </button>
      </div>
    </div>
  );
}
