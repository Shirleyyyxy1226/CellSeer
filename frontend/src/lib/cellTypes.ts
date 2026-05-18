export interface ProtocolSegment {
  cycleStart: number;
  cycleEnd: number;
  cRate: number;
}

export interface RatePerfCellRaw {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  protocol?: string | null;
  cycles: number[];
  dischargeCapacityMah: number[];
  /** When present, true coulombic efficiency = discharge/charge × 100 per cycle. */
  chargeCapacityMah?: number[];
  specificCapacityMahG: number[] | null;
  cRates?: number[];
  protocolSegments?: ProtocolSegment[];
}

export interface IndexCellRaw {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  cathodeMassG?: number | null;
  electrolyte?: string | null;
}
