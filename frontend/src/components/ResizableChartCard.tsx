import type React from 'react';
import { ResponsiveChartContainer } from '@/components/ResponsiveChartContainer';
import type { ChartSize } from '@/hooks/useResizableChart';

interface ResizableChartCardProps {
  /** Current overridden size (from `useResizableChart().size`); null = auto-fit. */
  size: ChartSize | null;
  /**
   * Called from the resize handle's `onMouseDown`. Forward this directly to
   * `useResizableChart().onResizeStart` — the card supplies the current
   * rendered width/height for you.
   */
  onResizeStart: (e: React.MouseEvent, currentSize: ChartSize) => void;
  /** Aspect ratio for auto-fit mode. Ignored once `size` is set. */
  aspectRatio?: number;
  /** Minimum height passed to `ResponsiveChartContainer`. */
  minHeight?: number;
  /** Minimum width passed to `ResponsiveChartContainer`. */
  minWidth?: number;
  /** Optional outer card padding override (defaults to `p-4`). */
  cardClassName?: string;
  /**
   * When true (and not resized/dragged), the card and its chart fill the parent
   * cell's height instead of sizing by aspect ratio — used so differential
   * charts grow to use the available vertical space (no large empty grey band).
   */
  fillHeight?: boolean;
  /** Render-prop receives the current width/height and a ready-to-render `ResizeHandle`. */
  children: (args: {
    width: number;
    height: number;
    ResizeHandle: () => React.ReactElement;
  }) => React.ReactNode;
}

/**
 * The "outer shell" that every resizable chart in the app shares:
 * a bordered card → `ResponsiveChartContainer` → render-prop with the
 * measured width/height plus a `<ResizeHandle/>` component you drop wherever
 * you want the corner grip to appear.
 *
 * Usage:
 *   const main = useResizableChart();
 *   ...
 *   <ResizableChartCard size={main.size} onResizeStart={main.onResizeStart}
 *                       aspectRatio={800 / 480} minHeight={280}>
 *     {({ width, height, ResizeHandle }) => (
 *       <div className="relative bg-white dark:bg-card rounded" style={{ width, height }}>
 *         <PlotlyChart data={traces} layout={{ ...layout, width, height }} />
 *         <ChartEditPopover ... />
 *         <ResizeHandle />
 *       </div>
 *     )}
 *   </ResizableChartCard>
 */
export function ResizableChartCard({
  size,
  onResizeStart,
  aspectRatio,
  minHeight,
  minWidth,
  cardClassName = 'rounded-lg border border-border bg-card p-4 w-full min-w-0',
  fillHeight = false,
  children,
}: ResizableChartCardProps) {
  // Fill-height only applies while the card has not been manually resized.
  const useFill = fillHeight && !size;
  return (
    <div
      className={`${cardClassName}${useFill ? ' h-full flex flex-col min-h-0' : ''}`}
      // Width follows the panel (never pinned to the dragged size, so the card
      // can shrink to fit and never shows an inner horizontal scrollbar). Only
      // the dragged height grows the card vertically.
      style={size ? { minHeight: size.height + 32 } : undefined}
    >
      <ResponsiveChartContainer
        aspectRatio={aspectRatio}
        minHeight={minHeight}
        minWidth={minWidth}
        overrideSize={size}
        fillHeight={useFill}
      >
        {({ width, height }) => {
          const ResizeHandle = () => (
            <div
              role="button"
              tabIndex={0}
              onMouseDown={(e) => onResizeStart(e, { width, height })}
              className="absolute bottom-0 right-0 z-10 w-6 h-6 cursor-se-resize flex items-end justify-end p-0.5 hover:bg-muted/60 rounded-tl select-none border-t border-l border-muted/50"
              title="Drag to resize"
              aria-label="Resize chart"
            >
              <div className="w-2 h-2 border-b border-r border-muted-foreground/60 rounded-sm" />
            </div>
          );
          return <>{children({ width, height, ResizeHandle })}</>;
        }}
      </ResponsiveChartContainer>
    </div>
  );
}
