export interface CyclerCyclePoint {
  cycle: number;
  x: number[];
  y: number[];
}

export interface Dataset {
  id: string;
  label: string;
  color?: string;
  cycles: CyclerCyclePoint[];
}

export interface DqDvCyclePoint {
  cycle: number;
  v: number[];
  dqdv: number[];
}

export type DqDvMode = '3d' | '2d';
export type DqDv2DViewMode = 'baseline' | 'range';

export interface BuildDqDvOpts {
  mode?: DqDvMode;
  viewMode?: DqDv2DViewMode;
  cycleIndex?: number;
  selectedCycle?: number;
  baselineCycle?: number;
  baselineCycleIndex?: number;
}

export interface DqDvFigure {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
}

export interface DvDqCyclePoint {
  cycle: number;
  q: number[];
  dvdq: number[];
}

export type DvDqMode = '3d' | '2d';
export type DvDq2DViewMode = 'baseline' | 'range';

export interface BuildDvDqOpts {
  mode?: DvDqMode;
  viewMode?: DvDq2DViewMode;
  cycleIndex?: number;
  selectedCycle?: number;
  baselineCycle?: number;
  baselineCycleIndex?: number;
}

export interface DvDqFigure {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
}

export type RecordCurve = Record<string, (number | string | null)[]>;

export interface RecordDataset {
  id: string;
  label: string;
  color?: string;
  curves: Record<string, RecordCurve>;
  cathodeMassG?: number | null;
}

export type GcdDirection = 'discharge' | 'charge' | 'both';
export type GcdMode = 'scatter' | 'cumulative';

export interface BuildGcdOpts {
  direction?: GcdDirection;
  mode?: GcdMode;
  showConnectedLine?: boolean;
  allowedCycles?: Set<number> | null;
  highlightCycle?: number | null;
  maxCycles?: number;
  maxPointsPerTrace?: number;
  useSpecificCapacityWhenAvailable?: boolean;
  applyTurboColor?: boolean;
}

export interface GcdFigure {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
  traceIndexToCell: Map<number, { id: string; label: string }>;
}

export interface BuildVoltageTimeOpts {
  maxCycles?: number;
  applyTurboColor?: boolean;
}

export interface VoltageTimeFigure {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
}

export interface RatePerfTraceSpec {
  name: string;
  x: number[];
  y: number[];
  color: string;
  isAggregated?: boolean;
  hasCrate?: boolean;
  cRates?: number[];
  errorMinus?: number[];
  errorPlus?: number[];
  cell?: { idNo: number; cellName: string };
}

export interface RatePerfProtocolSegment {
  cycleStart: number;
  cycleEnd: number;
  cRate: number;
}

export interface BuildRatePerfOpts {
  direction?: GcdDirection;
  useSpecificCapacity?: boolean;
  showConnectedLine?: boolean;
  protocolSegments?: RatePerfProtocolSegment[];
}

export interface RatePerfFigure {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
  shapes: Partial<Plotly.Shape>[];
  annotations: Partial<Plotly.Annotations>[];
  traceIndexToCell: Map<number, { idNo: number; cellName: string }>;
}
