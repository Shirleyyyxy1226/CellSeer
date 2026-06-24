/**
 * Shared cross-view brush dimming. Any overview view calls this
 * to learn whether a cross-view brush is active and, if so, which cells pass.
 * Cells that don't pass are rendered dimmed (cross-highlight, not cross-filter
 * — the default chosen for the Master Plot). A "filter to brush" action in the
 * orchestrator promotes the brush into the real filters when the user wants it.
 */
import { useCallback } from 'react';
import { useMasterPlotBridgeOptional } from '@/contexts/MasterPlotBridgeContext';

/** Opacity for cells outside an active brush. */
export const BRUSH_DIM_OPACITY = 0.12;

export interface BrushDim {
  /** True when a cross-view brush is currently narrowing the set. */
  active: boolean;
  /** Does this cell pass the active brush? (always true when inactive) */
  passes: (idNo: number) => boolean;
  /** Convenience: opacity multiplier for a cell (1 when passing or inactive). */
  opacity: (idNo: number) => number;
}

export function useBrushDim(): BrushDim {
  const bridge = useMasterPlotBridgeOptional();
  const ids = bridge?.brushPassingIds ?? null;
  const active = ids != null;
  const passes = useCallback((idNo: number) => (ids ? ids.has(idNo) : true), [ids]);
  const opacity = useCallback(
    (idNo: number) => (!ids || ids.has(idNo) ? 1 : BRUSH_DIM_OPACITY),
    [ids],
  );
  return { active, passes, opacity };
}
