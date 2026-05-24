import { useCallback, useEffect, useRef, useState } from 'react';

export interface ChartSize {
  width: number;
  height: number;
}

export interface UseResizableChartOptions {
  /** Initial overridden size, or null to let ResponsiveChartContainer auto-fit (default null). */
  initialSize?: ChartSize | null;
  /** Min/max bounds applied to width during drag. */
  minWidth?: number;
  maxWidth?: number;
  /** Min/max bounds applied to height during drag. */
  minHeight?: number;
  maxHeight?: number;
}

export interface UseResizableChartReturn {
  /** Current overridden size; null until the user drags or initialSize is set. */
  size: ChartSize | null;
  /** Imperatively set the size (e.g. to clear with null). */
  setSize: (s: ChartSize | null) => void;
  /**
   * Start a resize drag. Pass the chart's currently rendered width/height
   * (typically from a `ResponsiveChartContainer` render-prop) so deltas are
   * computed relative to what the user actually sees.
   */
  onResizeStart: (e: React.MouseEvent, currentSize: ChartSize) => void;
}

/**
 * Hook for "drag the bottom-right corner to resize a chart". Pairs with
 * `ResizableChartCard` and `ResponsiveChartContainer`. The hook owns the
 * size state and globally-attached mousemove/mouseup listeners — components
 * only need to render a small handle that calls `onResizeStart` from
 * `onMouseDown`.
 */
export function useResizableChart(
  options: UseResizableChartOptions = {},
): UseResizableChartReturn {
  const {
    initialSize = null,
    minWidth = 280,
    maxWidth = 1400,
    minHeight = 200,
    maxHeight = 900,
  } = options;

  const [size, setSize] = useState<ChartSize | null>(initialSize);
  const dragRef = useRef<{
    startX: number;
    startY: number;
    startW: number;
    startH: number;
  } | null>(null);

  const onResizeStart = useCallback(
    (e: React.MouseEvent, currentSize: ChartSize) => {
      e.preventDefault();
      dragRef.current = {
        startX: e.clientX,
        startY: e.clientY,
        startW: currentSize.width,
        startH: currentSize.height,
      };
    },
    [],
  );

  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      const d = dragRef.current;
      if (!d) return;
      const dx = e.clientX - d.startX;
      const dy = e.clientY - d.startY;
      setSize({
        width: Math.max(minWidth, Math.min(maxWidth, d.startW + dx)),
        height: Math.max(minHeight, Math.min(maxHeight, d.startH + dy)),
      });
    };
    const onUp = () => {
      dragRef.current = null;
    };
    window.addEventListener('mousemove', onMove);
    window.addEventListener('mouseup', onUp);
    return () => {
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
    };
  }, [minWidth, maxWidth, minHeight, maxHeight]);

  return { size, setSize, onResizeStart };
}
