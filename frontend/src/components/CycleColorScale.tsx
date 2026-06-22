import { useMemo } from 'react';
import type React from 'react';
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
  /** Toggle highlight for a clicked cycle; omit to make the scale a read-only legend. */
  onHighlight?: (cycle: number | null) => void;
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
      style={{ width: Math.max(width, 44), minHeight: height, alignSelf: 'stretch' }}
    >
      <span className="text-[9px] text-muted-foreground">Cycle {minCycle}</span>
      <div className="relative shrink-0">
        <div
          {...(onHighlight
            ? {
                role: 'slider',
                tabIndex: 0,
                'aria-valuemin': minCycle,
                'aria-valuemax': maxCycle,
                'aria-valuenow': highlight ?? minCycle,
                title: `Click a curve in the overview to focus that cycle (${minCycle}–${maxCycle}).`,
                'aria-label': `Color scale: cycle ${minCycle} to ${maxCycle}.`,
                onClick: (e: React.MouseEvent<HTMLElement>) => {
                  const rect = e.currentTarget.getBoundingClientRect();
                  const t = Math.max(0, Math.min(1, (e.clientY - rect.top) / rect.height));
                  const idx = cycles.length <= 1 ? 0 : Math.round(t * (cycles.length - 1));
                  const cycle = cycles[idx] ?? null;
                  onHighlight(highlight === cycle ? null : cycle);
                },
                onKeyDown: (e: React.KeyboardEvent) => {
                  if (e.key === 'Escape') onHighlight(null);
                },
              }
            : {
                title: `Cycle color scale: ${minCycle}–${maxCycle}. Click a curve in the overview to focus a cycle.`,
                'aria-label': `Color scale: cycle ${minCycle} to ${maxCycle}.`,
              })}
          className={`rounded border border-border/60 shadow-sm${onHighlight ? ' cursor-pointer hover:border-border' : ''}`}
          style={{
            width: 32,
            height: Math.max(140, Math.round(height * 0.55)),
            background: `linear-gradient(to bottom, ${turboStops})`,
          }}
        />
      </div>
      <span className="text-[9px] text-muted-foreground">Cycle {maxCycle}</span>
      {highlight != null && (
        <span className="text-[9px] font-medium text-primary mt-0.5">Cycle {highlight}</span>
      )}
    </div>
  );
}
