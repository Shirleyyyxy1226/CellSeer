import { useMemo } from 'react';
import { turboColor } from '@/lib/turboColormap';

interface CycleColorScaleProps {
  /** Sorted, deduped list of cycle numbers to map across the turbo scale. */
  cycles: number[];
  /** Width of the outer column in pixels (chart-side gap is the caller's). */
  width?: number;
  /** Total available height; the gradient bar sits centred within it. */
  height: number;
  /** Currently highlighted cycle (null = none). */
  highlight: number | null;
  /** Toggle highlight for a clicked cycle; receive null when the user presses Escape. */
  onHighlight: (cycle: number | null) => void;
}

/**
 * Vertical turbo color scale annotated with the min/max cycle. Clicking the
 * bar maps the click position to a cycle number; pressing Escape clears the
 * highlight. Designed to sit beside a Plotly chart and drive a `highlightCycle`
 * prop on `buildGcdCumulativeFigure` (or similar).
 */
export function CycleColorScale({
  cycles,
  width = 44,
  height,
  highlight,
  onHighlight,
}: CycleColorScaleProps) {
  const turboStops = useMemo(
    () => Array.from({ length: 32 }, (_, i) => turboColor(i / 31)).join(', '),
    [],
  );
  if (cycles.length === 0) return null;
  const minCycle = cycles[0];
  const maxCycle = cycles[cycles.length - 1];

  return (
    <div
      className="shrink-0 flex flex-col items-center justify-center gap-0.5"
      style={{ width, minHeight: height, alignSelf: 'stretch' }}
    >
      <span className="text-[9px] text-muted-foreground">Cycle {minCycle}</span>
      <div
        role="slider"
        aria-valuemin={minCycle}
        aria-valuemax={maxCycle}
        aria-valuenow={highlight ?? minCycle}
        tabIndex={0}
        className="rounded cursor-pointer border border-border/60 hover:border-border shadow-sm shrink-0"
        style={{
          width: 18,
          height: 140,
          background: `linear-gradient(to bottom, ${turboStops})`,
        }}
        onClick={(e) => {
          const rect = (e.target as HTMLElement).getBoundingClientRect();
          const y = e.clientY - rect.top;
          const t = Math.max(0, Math.min(1, y / rect.height));
          const idx = cycles.length <= 1 ? 0 : Math.round(t * (cycles.length - 1));
          const cycle = cycles[idx] ?? null;
          onHighlight(highlight === cycle ? null : cycle);
        }}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onHighlight(null);
        }}
        title={`Click to highlight cycle (${minCycle}–${maxCycle}). Escape to clear.`}
        aria-label={`Color scale: cycle ${minCycle} to ${maxCycle}. Click to highlight.`}
      />
      <span className="text-[9px] text-muted-foreground">Cycle {maxCycle}</span>
    </div>
  );
}
