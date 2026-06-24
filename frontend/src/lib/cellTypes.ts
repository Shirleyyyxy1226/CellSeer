/**
 * Rate-performance / cycling-derived protocol segment. The rate-performance
 * backend always returns finite cycleEnd (segments are materialised against
 * the observed cycles), so callers downstream of /api/rate-performance can
 * safely do arithmetic without null-guarding.
 *
 * For the wizard-authoring shape (which allows ``cycleEnd: null`` to mean
 * "to end of test"), see ``EditableProtocolSegment`` in
 * ``features/protocol/types.ts``.
 */
export interface ProtocolSegment {
  cycleStart: number;
  cycleEnd: number;
  cRate: number;
  /** Optional human label (e.g. "formation", "rate test", "main cycling"). */
  name?: string;
}

/**
 * Open-ended segment shape used by the index API (carries ``cycleEnd: null``
 * when the protocol is attached to a cell that hasn't been cycled to its
 * final stop). The drawer/chip code uses this to render "→ end" labels.
 */
export interface OpenEndedProtocolSegment {
  cycleStart: number;
  cycleEnd: number | null;
  cRate: number;
  name?: string;
}

export interface RatePerfCell {
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

export interface IndexCell {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
  cathodeMassG?: number | null;
  electrolyte?: string | null;
  // Extended metadata (optional — only present when /api/cell-record-index
  // is served by a backend that surfaces the full cell schema).
  batch?: number | null;
  category?: string | null;
  repeat?: number | null;
  cathodeDiameterMm?: number | null;
  anode?: string | null;
  anodeDiameterMm?: number | null;
  anodeMassG?: number | null;
  npRatio?: number | null;
  separatorDiameterMm?: number | null;
  electrolyteVolumeUl?: number | null;
  doFormation?: string | null;
  doRateTest?: string | null;
  doEis?: string | null;
  notes?: string | null;
  sourceSystem?: string | null;
  sourceRefcode?: string | null;
  sourceItemId?: string | null;
  lastSeenAt?: string | null;
  /** Test datasets attached to this cell (cycling, dqdv, dvdq, eis, …). */
  datasets?: CellDatasetSummary[];
  /** Compact protocol label (e.g. "FORM-3 | 1C"). Null when unattached. */
  protocolName?: string | null;
  /**
   * Full segment list — present iff a protocol is attached to the cell.
   * Open-ended (``cycleEnd: null``) shape: this is the *wire* format and may
   * carry trailing-null segments the wizard wrote before cycling data
   * landed. UI code should consult ``cycleEnd ?? '…'`` for display.
   */
  protocolSegments?: OpenEndedProtocolSegment[] | null;
  protocolUpdatedAt?: string | null;
}

export interface CellDatasetSummary {
  /** Logical dataset name, e.g. "cycling", "discharge_dqdv", "eis". */
  name: string;
  sizeBytes?: number | null;
  createdAt?: string | null;
  sourceFileId?: string | null;
  sourceVersion?: string | null;
}
