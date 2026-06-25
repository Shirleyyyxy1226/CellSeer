/**
 * Adapts the server overview aggregate into the CellSummary shape the condition
 * views consume. The overview is the source of truth for the per-cell scalars;
 * these summaries feed the groupConditions → computeCondStats pipeline, which
 * derives condition statistics client-side (over the filtered cohort).
 *
 * The one field the aggregate does NOT carry is capacitySeries (the per-cycle
 * sparkline): it stays empty here and is grafted on from the lazily-fetched
 * per-cycle payload when a cell-level view (inspector / Trajectories) is opened.
 */
import type { MasterPlotOverview } from '@/lib/api';
import type { CellSummary } from './metrics';

export function summariesFromOverview(ov: MasterPlotOverview): CellSummary[] {
  return ov.cells.map((c) => {
    const cond = ov.conditions[c.condKey];
    return {
      idNo: c.idNo,
      cellId: c.cellId,
      cellName: c.cellName,
      cathode: cond?.cathode ?? 'Unknown',
      separatorType: cond?.separatorType ?? '—',
      spacerMm: cond?.spacerMm ?? null,
      hasProtocol: c.hasProtocol,
      protocolName: c.protocolName,
      cycleCount: c.cycleCount,
      peakCapacitySpec: c.peakCapacitySpec,
      peakCapacityRaw: c.peakCapacityRaw,
      medianCE: c.medianCE,
      retention: c.retention,
      peakShiftMv: null,
      capacitySeries: [],
      capacityBasis: c.capacityBasis,
    };
  });
}
