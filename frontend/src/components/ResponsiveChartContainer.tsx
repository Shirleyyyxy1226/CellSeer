import { useContainerSize } from '@/hooks/useContainerSize';

const DEFAULT_WIDTH = 800;
const DEFAULT_HEIGHT = 480;
const MIN_WIDTH = 280;
const MIN_HEIGHT = 200;

interface ResponsiveChartContainerProps {
  children: (size: { width: number; height: number }) => React.ReactNode;
  /** Minimum width in pixels */
  minWidth?: number;
  /** Minimum height in pixels */
  minHeight?: number;
  /** Default aspect ratio (width/height) - used so container gets height from width. Ignored when overrideSize is set. */
  aspectRatio?: number;
  className?: string;
  /** When set, use these dimensions and allow free aspect ratio (independent horizontal & vertical resize) */
  overrideSize?: { width: number; height: number } | null;
  /**
   * When true (and not in override mode), the container fills its parent's
   * height (`h-full`) and the chart height tracks the measured container height
   * instead of being derived from the aspect ratio. Used so charts grow to use
   * available vertical space instead of leaving a large empty band below.
   */
  fillHeight?: boolean;
}

/**
 * Wraps chart content and provides responsive dimensions. When the panel is squeezed,
 * the chart scales down instead of being cut off. When overrideSize is set, allows
 * independent horizontal and vertical resize without aspect-ratio constraint.
 */
export function ResponsiveChartContainer({
  children,
  minWidth = MIN_WIDTH,
  minHeight = MIN_HEIGHT,
  aspectRatio = DEFAULT_WIDTH / DEFAULT_HEIGHT,
  className = '',
  overrideSize,
  fillHeight = false,
}: ResponsiveChartContainerProps) {
  const [containerRef, size] = useContainerSize<HTMLDivElement>();

  const measuredWidth = size.width > 0 ? Math.max(minWidth, size.width) : DEFAULT_WIDTH;
  const measuredHeight = size.height > 0 ? Math.max(minHeight, size.height) : DEFAULT_HEIGHT;

  // In override (dragged) mode we honour the dragged height freely but clamp the
  // width to the available container width so a chart dragged wider than its panel
  // reflows to fit instead of forcing the white card to scroll horizontally.
  const overrideWidth = overrideSize
    ? Math.max(minWidth, Math.min(overrideSize.width, measuredWidth))
    : undefined;

  // Non-override fill-height mode: stretch to the parent's height and feed the
  // measured container height to the chart so it uses the available vertical
  // space instead of being capped by the aspect ratio.
  const useFill = fillHeight && !overrideSize;

  // Default mode: derive the chart height from the measured WIDTH (not from the
  // container's own height). The container height stays auto so it grows to
  // contain any control rows the caller renders ABOVE the chart box — otherwise
  // a fixed aspect-ratio height makes the chart box overflow the card and spill
  // into the next card (the "connected white" overlap).
  const derivedHeight = Math.max(minHeight, Math.round(measuredWidth / aspectRatio));

  const width = overrideSize ? (overrideWidth as number) : measuredWidth;
  const height = overrideSize ? overrideSize.height : useFill ? measuredHeight : derivedHeight;

  return (
    <div
      ref={containerRef}
      className={`w-full min-w-0 ${useFill ? 'h-full' : ''} ${className}`}
      style={
        overrideSize
          // Auto height (floored at the dragged height) so the container grows to
          // contain any control row the caller renders ABOVE the chart box —
          // a fixed height makes the box overflow the card during/after a resize.
          ? { width: '100%', minHeight: height }
          : useFill
            ? { minHeight, height: '100%' }
            : { minHeight }
      }
    >
      {children({ width, height })}
    </div>
  );
}
