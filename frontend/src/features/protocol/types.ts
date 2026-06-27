/**
 * Shared types for the protocol-attach wizard and the chip / button surfaces.
 *
 * Two segment shapes coexist on purpose:
 *
 *   1. ``OpenEndedProtocolSegment`` (re-exported from cellTypes) is the
 *      *wire* format. ``cycleEnd`` may be ``null`` to mean "to end of test"
 *      so the wizard can author a tail segment before the user knows the
 *      stop cycle.
 *   2. ``EditableProtocolSegment`` adds a stable client-side ``id`` so the
 *      sequence editor can re-order rows without React losing focus on the
 *      currently-edited input. The id is stripped before sending to the
 *      backend.
 */

import type { OpenEndedProtocolSegment } from '@/lib/cell/cellTypes';

export type { OpenEndedProtocolSegment };

export interface EditableProtocolSegment {
  /** Client-side stable key (uuid). Stripped on save. */
  id: string;
  name: string;
  cycleStart: number;
  /** ``null`` ⇢ "to end of test". */
  cycleEnd: number | null;
  /** Always a positive C-rate; the editor coerces from any input string. */
  cRate: number;
}

/** Scope describes which cells the wizard will write the protocol to. */
export interface AttachProtocolScope {
  /** Concrete cell IDs the user selected. */
  cellIds: string[];
  /** Friendly label for the modal header (e.g. "1 cell" / "3 cells"). */
  summary: string;
}

/**
 * Optional caller payload passed into ``openAttachProtocol``. ``cellIds``
 * pre-selects the scope; everything else is wizard state seed-only.
 *
 * The ``onSaved`` callback fires *after* the backend confirms write. Used
 * by the cell drawer to refresh its parent's cell-record-index without
 * polling.
 */
export interface OpenAttachProtocolOptions {
  cellIds?: string[];
  seedSegments?: EditableProtocolSegment[] | OpenEndedProtocolSegment[];
  seedName?: string | null;
  /** Open directly on a given step. The wizard has two steps: 'schedule'
   *  (name + stages) and 'apply' (target cells + review). */
  initialStep?: 'schedule' | 'apply';
  onSaved?: (result: {
    applied: string[];
    protocolName: string;
    segments: OpenEndedProtocolSegment[];
  }) => void;
}
