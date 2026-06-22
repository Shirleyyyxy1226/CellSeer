import { turboColor } from '../style';
import type { BuildGcdOpts, GcdFigure, RecordCurve, RecordDataset } from '../types';

const DEFAULT_MAX_CYCLES = 60;
const DEFAULT_MAX_PTS_TRACE = 2500;
const DEFAULT_CUMULATIVE_STEPS_PER_CYCLE = 200;

interface ChargeDischargePoints {
  charge: { x: number; y: number }[];
  discharge: { x: number; y: number }[];
}

function resolveKeys(curve: RecordCurve): { vKey: string; qKey: string; iKey: string | null } {
  return {
    vKey: 'Voltage [V]' in curve ? 'Voltage [V]' : 'voltage',
    qKey: 'Capacity [Ah]' in curve ? 'Capacity [Ah]' : 'capacity',
    iKey: 'Current [A]' in curve ? 'Current [A]' : null,
  };
}

function splitByCurrent(
  curve: RecordCurve,
  scale: number,
  cathodeMassG: number | null | undefined,
  useSpecificCapacity: boolean,
): ChargeDischargePoints {
  const { vKey, qKey, iKey } = resolveKeys(curve);
  const v = (curve[vKey] ?? []) as (number | null)[];
  const q = (curve[qKey] ?? []) as (number | null)[];
  const current = iKey ? ((curve[iKey] ?? []) as (number | null)[]) : null;
  const n = Math.min(v.length, q.length);
  const charge: { x: number; y: number }[] = [];
  const discharge: { x: number; y: number }[] = [];
  for (let j = 0; j < n; j++) {
    const vv = v[j];
    const qq = q[j];
    if (vv == null || qq == null) continue;
    let qVal = (qq as number) * scale;
    if (useSpecificCapacity && cathodeMassG && cathodeMassG > 0) qVal = qVal / cathodeMassG;
    const isCharge = !current || current[j] == null || (current[j] as number) > 0;
    if (isCharge) charge.push({ x: qVal, y: vv as number });
    else discharge.push({ x: qVal, y: vv as number });
  }
  return { charge, discharge };
}

function selectCycles(curves: Record<string, RecordCurve>, allowedCycles: Set<number> | null | undefined, maxCycles: number): number[] {
  const curveKeys = Object.keys(curves).slice(0, 200);
  let cycles = curveKeys
    .map((k) => parseInt(k, 10))
    .filter((x) => !isNaN(x))
    .sort((a, b) => a - b);
  if (allowedCycles) cycles = cycles.filter((c) => allowedCycles.has(c));
  return cycles.slice(0, maxCycles);
}

function build3Scatter(datasets: RecordDataset[], opts: BuildGcdOpts): GcdFigure {
  const direction = opts.direction ?? 'discharge';
  const showConnectedLine = opts.showConnectedLine ?? false;
  const maxCycles = opts.maxCycles ?? DEFAULT_MAX_CYCLES;
  const maxPts = opts.maxPointsPerTrace ?? DEFAULT_MAX_PTS_TRACE;
  const useSpecificCapacity = opts.useSpecificCapacityWhenAvailable ?? true;
  const applyTurbo = opts.applyTurboColor ?? true;
  const highlightCycle = opts.highlightCycle ?? null;

  const traces: Plotly.Data[] = [];
  const traceIndexToCell = new Map<number, { id: string; label: string }>();

  datasets.forEach((dataset, cellIdx) => {
    const cycles = selectCycles(dataset.curves, opts.allowedCycles, maxCycles);
    const useSC = useSpecificCapacity && dataset.cathodeMassG != null && dataset.cathodeMassG > 0;
    const capacityUnit = useSC ? 'mAh g⁻¹' : 'mAh';
    const namePrefix = datasets.length > 1 ? `${dataset.label} — ` : '';
    const cellColor = datasets.length > 1 ? dataset.color ?? '' : (dataset.color ?? '');

    cycles.forEach((cyc) => {
      const curve = dataset.curves[String(cyc)];
      if (!curve) return;
      const { qKey } = resolveKeys(curve);
      const scale = qKey === 'Capacity [Ah]' ? 1000 : 1;
      const { charge, discharge } = splitByCurrent(curve, scale, dataset.cathodeMassG, useSC);
      const step = Math.max(1, Math.ceil(Math.max(charge.length, discharge.length) / maxPts));

      const qMinChg = charge.length > 0 ? charge.reduce((m, p) => (p.x < m ? p.x : m), charge[0].x) : 0;
      const qMaxDchg = discharge.length > 0 ? discharge.reduce((m, p) => (p.x > m ? p.x : m), discharge[0].x) : 0;

      const chargeSlice = charge.length <= maxPts ? charge : charge.slice(0, maxPts);
      const dchgSlice = discharge.length <= maxPts ? discharge : discharge.slice(0, maxPts);
      const doCharge = direction === 'charge' || direction === 'both';
      const doDischarge = direction === 'discharge' || direction === 'both';

      if (doCharge && chargeSlice.length >= 2) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k < chargeSlice.length; k += step) {
          xs.push(chargeSlice[k].x - qMinChg);
          ys.push(chargeSlice[k].y);
        }
        traceIndexToCell.set(traces.length, { id: dataset.id, label: dataset.label });
        traces.push({
          x: xs,
          y: ys,
          type: 'scatter' as const,
          mode: showConnectedLine ? ('lines' as const) : ('markers' as const),
          name: `${namePrefix}Cycle ${cyc} (charge)`,
          ...(showConnectedLine
            ? { line: { width: 1.5, color: cellColor } }
            : { marker: { size: 3, color: cellColor } }),
          legendgroup: `${dataset.id}-${cyc}`,
          hovertemplate: `${dataset.label}<br>Cycle: ${cyc} (charge)<br>Capacity: %{x:.2f} ${capacityUnit}<br>Voltage: %{y:.3f} V<extra></extra>`,
        });
      }
      if (doDischarge && dchgSlice.length >= 2) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k < dchgSlice.length; k += step) {
          xs.push(qMaxDchg - dchgSlice[k].x);
          ys.push(dchgSlice[k].y);
        }
        traceIndexToCell.set(traces.length, { id: dataset.id, label: dataset.label });
        traces.push({
          x: xs,
          y: ys,
          type: 'scatter' as const,
          mode: showConnectedLine ? ('lines' as const) : ('markers' as const),
          name: `${namePrefix}Cycle ${cyc} (discharge)`,
          ...(showConnectedLine
            ? { line: { width: 1.5, color: cellColor } }
            : { marker: { size: 3, color: cellColor } }),
          legendgroup: `${dataset.id}-${cyc}`,
          hovertemplate: `${dataset.label}<br>Cycle: ${cyc} (discharge)<br>Capacity: %{x:.2f} ${capacityUnit}<br>Voltage: %{y:.3f} V<extra></extra>`,
        });
      }
    });

    void cellIdx;
  });

  if (applyTurbo && datasets.length <= 1 && traces.length > 0) {
    const n = traces.length;
    traces.forEach((tr, idx) => {
      const c = turboColor(n > 1 ? idx / (n - 1) : 0);
      const s = tr as { line?: { color: string }; marker?: { color: string } };
      if (s.line) s.line.color = c;
      if (s.marker) s.marker.color = c;
    });
  }

  // Dim all cycles except the highlighted one (drives the cycle colour scale).
  if (highlightCycle != null) {
    traces.forEach((tr) => {
      const s = tr as { legendgroup?: string };
      const cyc = s.legendgroup ? s.legendgroup.split('-').pop() : undefined;
      if (cyc !== String(highlightCycle)) (tr as { opacity?: number }).opacity = 0.2;
    });
  }

  return {
    data: traces,
    layout: {},
    traceIndexToCell,
  };
}

function buildCumulative(datasets: RecordDataset[], opts: BuildGcdOpts): GcdFigure {
  const direction = opts.direction ?? 'discharge';
  const maxCycles = opts.maxCycles ?? DEFAULT_MAX_CYCLES;
  const maxPts = opts.maxPointsPerTrace ?? DEFAULT_MAX_PTS_TRACE;
  const stepsPerCycle = DEFAULT_CUMULATIVE_STEPS_PER_CYCLE;
  const useSpecificCapacity = opts.useSpecificCapacityWhenAvailable ?? true;
  const applyTurbo = opts.applyTurboColor ?? true;
  const highlightCycle = opts.highlightCycle ?? null;

  const traces: Plotly.Data[] = [];
  const traceIndexToCell = new Map<number, { id: string; label: string }>();

  datasets.forEach((dataset) => {
    const cycles = selectCycles(dataset.curves, opts.allowedCycles, maxCycles);
    const useSC = useSpecificCapacity && dataset.cathodeMassG != null && dataset.cathodeMassG > 0;
    const capacityUnit = useSC ? 'mAh g⁻¹' : 'mAh';
    const namePrefix = datasets.length > 1 ? `${dataset.label} — ` : '';
    const cellColor = datasets.length > 1 ? dataset.color ?? '' : '';
    let cum = 0;

    cycles.forEach((cyc) => {
      const curve = dataset.curves[String(cyc)];
      if (!curve) return;
      const { qKey } = resolveKeys(curve);
      const scale = qKey === 'Capacity [Ah]' ? 1000 : 1;
      const { charge, discharge } = splitByCurrent(curve, scale, dataset.cathodeMassG, useSC);

      const qMinChg = charge.length > 0 ? charge.reduce((m, p) => (p.x < m ? p.x : m), charge[0].x) : 0;
      const qMaxDchg = discharge.length > 0 ? discharge.reduce((m, p) => (p.x > m ? p.x : m), discharge[0].x) : 0;
      const chgEnd = charge.length > 0 ? charge.reduce((m, p) => Math.max(m, p.x - qMinChg), 0) : 0;
      const dchgEnd = discharge.length > 0 ? discharge.reduce((m, p) => Math.max(m, qMaxDchg - p.x), 0) : 0;

      const chargeSlice = charge.length <= maxPts ? charge : charge.slice(0, maxPts);
      const dchgSlice = discharge.length <= maxPts ? discharge : discharge.slice(0, maxPts);
      const stepChg = Math.max(1, Math.ceil(chargeSlice.length / stepsPerCycle));
      const stepDchg = Math.max(1, Math.ceil(dchgSlice.length / stepsPerCycle));
      const legendGroup = `${dataset.id}-${cyc}`;
      // 'both' lays the charge segment then the discharge segment end-to-end
      // within the cycle, so cum advances through both (full cycling profile).
      const doCharge = direction === 'charge' || direction === 'both';
      const doDischarge = direction === 'discharge' || direction === 'both';

      if (doCharge && chargeSlice.length >= 2) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k < chargeSlice.length; k += stepChg) {
          xs.push(cum + (chargeSlice[k].x - qMinChg));
          ys.push(chargeSlice[k].y);
        }
        cum += chgEnd;
        traceIndexToCell.set(traces.length, { id: dataset.id, label: dataset.label });
        traces.push({
          x: xs,
          y: ys,
          type: 'scatter' as const,
          mode: 'lines' as const,
          name: `${namePrefix}Cycle ${cyc} (charge)`,
          line: { width: 1.5, color: cellColor || '' },
          legendgroup: legendGroup,
          hovertemplate: `${dataset.label}<br>Cycle: ${cyc} (charge)<br>Cumulative: %{x:.2f} ${capacityUnit}<br>Voltage: %{y:.3f} V<extra></extra>`,
        });
      }
      if (doDischarge && dchgSlice.length >= 2) {
        const xs: number[] = [];
        const ys: number[] = [];
        for (let k = 0; k < dchgSlice.length; k += stepDchg) {
          xs.push(cum + (qMaxDchg - dchgSlice[k].x));
          ys.push(dchgSlice[k].y);
        }
        cum += dchgEnd;
        traceIndexToCell.set(traces.length, { id: dataset.id, label: dataset.label });
        traces.push({
          x: xs,
          y: ys,
          type: 'scatter' as const,
          mode: 'lines' as const,
          name: `${namePrefix}Cycle ${cyc} (discharge)`,
          line: { width: 1.5, color: cellColor || '' },
          legendgroup: legendGroup,
          hovertemplate: `${dataset.label}<br>Cycle: ${cyc} (discharge)<br>Cumulative: %{x:.2f} ${capacityUnit}<br>Voltage: %{y:.3f} V<extra></extra>`,
        });
      }
    });
  });

  const usePathColors = datasets.length > 1 && datasets.some((d) => d.color);
  if (applyTurbo) {
    const n = traces.length;
    traces.forEach((tr, idx) => {
      const s = tr as { line?: { color: string }; opacity?: number; legendgroup?: string };
      if (s.line && !usePathColors) {
        s.line.color = turboColor(n > 1 ? idx / (n - 1) : 0);
      }
      if (highlightCycle != null && s.legendgroup) {
        const cycleFromGroup = (s.legendgroup as string).split('-').pop();
        if (cycleFromGroup !== String(highlightCycle)) {
          (tr as { opacity?: number }).opacity = 0.2;
        }
      }
    });
  }

  return {
    data: traces,
    layout: {},
    traceIndexToCell,
  };
}

export function buildGcdFigure(datasets: RecordDataset[], opts: BuildGcdOpts = {}): GcdFigure {
  const mode = opts.mode ?? 'scatter';
  return mode === 'cumulative' ? buildCumulative(datasets, opts) : build3Scatter(datasets, opts);
}

export function buildGcdCumulativeFigure(datasets: RecordDataset[], opts: Omit<BuildGcdOpts, 'mode'> = {}): GcdFigure {
  return buildCumulative(datasets, { ...opts, mode: 'cumulative' });
}
