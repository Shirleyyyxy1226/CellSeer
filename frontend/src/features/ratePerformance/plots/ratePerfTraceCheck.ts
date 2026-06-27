import type { RatePerfCell as CyclingCell } from '@/lib/cell/cellTypes';
import type { ChargeDirection } from '@/components/DirectionToggle';

/**
 * Whether the given filter set yields any plottable traces for the chosen
 * direction. Used by the dashboard to switch between rendering the
 * `<RatePerformancePlot>` and an empty-state message without duplicating
 * (or re-running) the hierarchy aggregation that the plot does internally.
 *
 * Returns `false` when there are no cells, or when the cells have no
 * capacity samples in the requested direction (the most common cause of
 * "I selected charge but nothing shows up" before).
 */
export function hasRatePerfTraces(
  filteredCells: CyclingCell[],
  direction: ChargeDirection,
): boolean {
  if (filteredCells.length === 0) return false;
  if (direction === 'charge') {
    return filteredCells.some((c) => (c.chargeCapacityMah?.length ?? 0) > 0);
  }
  return filteredCells.some((c) => c.dischargeCapacityMah.length > 0);
}
