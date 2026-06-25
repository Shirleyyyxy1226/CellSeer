/**
 * Adapts the server overview aggregate into the CellSummary shape
 * the condition views already consume. At scale the orchestrator fetches the
 * aggregate instead of the full rate-performance payload and feeds these
 * scalar-only summaries through the unchanged groupConditions → computeCondStats
 * → computeFlaggedCells pipeline. Because the backend reduction is a
 * line-by-line twin of summariseCell (parity-locked to 1e-9), the condition
 * views render identically to the client path — and switch back to the full
 * path seamlessly once the per-cycle payload loads for a cell-level view.
 *
 * What the aggregate does NOT carry (only the per-cycle payload does):
 *   - capacitySeries → empty; the inspector sparkline and Trajectories view
 *     require the full payload, which the orchestrator lazily fetches for them.
 *   - cellName → falls back to cellId (used only in tooltips/labels).
 *   - per-cell hasProtocol → false; the project-level protocol gate uses the
 *     aggregate's protocolCellCount instead (see ProjectOverviewDashboard).
 *   - idNo → a stable array index stands in for replicate sort/jitter; real
 *     idNo arrives with the full payload when a cell-level view is opened.
 */
import type { MasterPlotOverview } from '@/lib/api';
import type { CellSummary } from './metrics';

export function summariesFromOverview(ov: MasterPlotOverview): CellSummary[] {
  return ov.cells.map((c, i) => {
    const cond = ov.conditions[c.condKey];
    return {
      idNo: i,
      cellId: c.cellId,
      cellName: c.cellId,
      cathode: cond?.cathode ?? 'Unknown',
      separatorType: cond?.separatorType ?? '—',
      spacerMm: cond?.spacerMm ?? null,
      hasProtocol: false,
      protocolName: null,
      cycleCount: c.cycleCount,
      peakCapacitySpec: c.peakCapacitySpec,
      peakCapacityRaw: c.peakCapacityRaw,
      medianCE: c.medianCE,
      retention: c.retention,
      peakShiftMv: null,
      capacitySeries: [],
      capacityBasis: c.capacityBasis,
      flags: [],
    };
  });
}
