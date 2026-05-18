import { useCallback, useEffect, useRef, useState } from 'react';

/** Returns the width and height of a container, updating when it resizes (e.g. panel squeeze). */
export function useContainerSize<T extends HTMLElement = HTMLDivElement>() {
  const ref = useRef<T | null>(null);
  const [size, setSize] = useState({ width: 0, height: 0 });

  const updateSize = useCallback(() => {
    const el = ref.current;
    if (!el) return;
    const { clientWidth, clientHeight } = el;
    if (clientWidth > 0 && clientHeight > 0) {
      setSize({ width: clientWidth, height: clientHeight });
    }
  }, []);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    updateSize();
    const ro = new ResizeObserver(updateSize);
    ro.observe(el);
    return () => ro.disconnect();
  }, [updateSize]);

  return [ref, size] as const;
}
