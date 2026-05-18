import { useEffect, useRef, useState, type RefObject } from 'react';

export interface Dimensions {
  width: number;
  height: number;
}

/**
 * Observe element content-box size using ResizeObserver.
 * Returns a stable ref + latest dimensions.
 */
export function useDimensions<T extends HTMLElement = HTMLDivElement>(): [
  RefObject<T>,
  Dimensions,
] {
  const ref = useRef<T>(null);
  const [dims, setDims] = useState<Dimensions>({ width: 0, height: 0 });

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    const first = el.getBoundingClientRect();
    setDims({ width: first.width, height: first.height });

    let raf = 0;
    const ro = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        setDims((prev) => {
          if (Math.abs(prev.width - width) < 0.5 && Math.abs(prev.height - height) < 0.5) {
            return prev;
          }
          return { width, height };
        });
      });
    });

    ro.observe(el);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, []);

  return [ref, dims];
}

