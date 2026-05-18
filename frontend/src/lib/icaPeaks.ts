/**
 * Parse ICA dQ/dV peaks per cycle for Master Plot 1 (dQ/dV shift metric).
 */

export interface IcaDvqPayload {
  idNo?: number;
  cycles?: Record<
    string,
    {
      ica?: { v?: number[]; dqdv?: number[] };
    }
  >;
}

/** Voltage at dominant |dQ/dV| peak for each instrument cycle in cycleOrder. */
export function peakVoltagePerCycle(payload: IcaDvqPayload | null, cycleOrder: number[]): number[] {
  if (!payload?.cycles || !cycleOrder.length) return cycleOrder.map(() => NaN);
  return cycleOrder.map((c) => {
    const entry = payload.cycles![String(c)];
    const v = entry?.ica?.v;
    const dq = entry?.ica?.dqdv;
    if (!v?.length || !dq?.length || v.length !== dq.length) return NaN;
    let im = 0;
    let mx = Math.abs(dq[0] ?? 0);
    for (let i = 1; i < dq.length; i++) {
      const a = Math.abs(dq[i] ?? 0);
      if (a > mx) {
        mx = a;
        im = i;
      }
    }
    const volt = v[im];
    return volt != null && Number.isFinite(volt) ? volt : NaN;
  });
}

/** Shift vs reference step index (e.g. first main-segment cycle). */
export function shiftSeriesVsRef(series: number[], refStepIndex: number): number[] {
  const ref = series[Math.min(Math.max(0, refStepIndex), series.length - 1)];
  if (ref == null || Number.isNaN(ref)) return series.map(() => NaN);
  return series.map((x) => (Number.isFinite(x) ? x - ref : NaN));
}
