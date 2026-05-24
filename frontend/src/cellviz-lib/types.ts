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

export interface IcaCyclePoint {
  cycle: number;
  v: number[];
  dqdv: number[];
}

export type IcaMode = '3d' | '2d';
export type Ica2DViewMode = 'baseline' | 'range';

export interface BuildIcaOpts {
  mode?: IcaMode;
  viewMode?: Ica2DViewMode;
  cycleIndex?: number;
  selectedCycle?: number;
  baselineCycle?: number;
  baselineCycleIndex?: number;
}

export interface IcaFigure {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
}
