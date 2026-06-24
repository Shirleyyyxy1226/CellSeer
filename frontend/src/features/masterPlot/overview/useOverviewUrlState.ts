/**
 * Deep-link URL state for the Master Plot overview.
 *
 * Syncs a small set of string params (view, metric, filters) to the URL so a
 * coordinated overview is shareable and survives reload. Restores once on
 * mount, then writes on change with `replace` (preserving other params such as
 * the `?tab=` the page router owns). Values equal to their default are dropped
 * from the URL to keep links clean.
 */
import { useEffect, useRef } from 'react';
import { useSearchParams } from 'react-router-dom';

export interface UrlStateParam {
  /** Query-string key, e.g. "mpView". */
  key: string;
  /** Current value of the synced state. */
  value: string;
  /** Apply a restored value back into state on mount. */
  onRestore: (v: string) => void;
  /** When value === default the param is omitted from the URL. */
  default?: string;
}

export function useOverviewUrlState(params: UrlStateParam[]): void {
  const [search, setSearch] = useSearchParams();
  const restored = useRef(false);
  // Keep the latest params without re-subscribing the write effect to identity.
  const paramsRef = useRef(params);
  paramsRef.current = params;

  // Restore once, on mount.
  useEffect(() => {
    for (const p of paramsRef.current) {
      const v = search.get(p.key);
      if (v != null && v !== p.value) p.onRestore(v);
    }
    restored.current = true;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Write on any value change (after the initial restore).
  const signature = params.map((p) => `${p.key}=${p.value}`).join('');
  useEffect(() => {
    if (!restored.current) return;
    setSearch(
      (prev) => {
        const next = new URLSearchParams(prev);
        for (const p of paramsRef.current) {
          if (p.default != null && p.value === p.default) next.delete(p.key);
          else next.set(p.key, p.value);
        }
        return next;
      },
      { replace: true },
    );
  }, [signature, setSearch]);
}
