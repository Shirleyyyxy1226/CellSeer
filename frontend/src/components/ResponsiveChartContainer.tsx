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
}: ResponsiveChartContainerProps) {
  const [containerRef, size] = useContainerSize<HTMLDivElement>();

  const measuredWidth = size.width > 0 ? Math.max(minWidth, size.width) : DEFAULT_WIDTH;
  const measuredHeight = size.height > 0 ? Math.max(minHeight, size.height) : DEFAULT_HEIGHT;

  const width = overrideSize ? overrideSize.width : measuredWidth;
  const height = overrideSize ? overrideSize.height : measuredHeight;

  return (
    <div
      ref={containerRef}
      className={`w-full min-w-0 ${className}`}
      style={
        overrideSize
          ? { width: overrideSize.width, height: overrideSize.height, minWidth: overrideSize.width, minHeight: overrideSize.height }
          : { minHeight, aspectRatio: String(aspectRatio) }
      }
    >
      {children({ width, height })}
    </div>
  );
}
