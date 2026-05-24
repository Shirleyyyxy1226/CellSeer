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
  cardClassName = 'rounded-lg border border-border bg-card p-4 overflow-auto w-full min-w-0',
  children,
}: ResizableChartCardProps) {
  return (
    <div
      className={cardClassName}
      style={size ? { minWidth: size.width + 32, minHeight: size.height + 32 } : undefined}
    >
      <ResponsiveChartContainer
        aspectRatio={aspectRatio}
        minHeight={minHeight}
        minWidth={minWidth}
        overrideSize={size}
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
