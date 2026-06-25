/**
 * Conversions between the wire format (``OpenEndedProtocolSegment``) the
 * backend speaks and the editor format (``EditableProtocolSegment``) the
 * sequence step uses.
 *
 * The editor format carries a stable client id so React doesn't lose focus
 * when a row is reordered; the wire format is positional.
 */

import type {
  EditableProtocolSegment,
  OpenEndedProtocolSegment,
} from './types';

let _seed = 0;
const nextId = (): string => {
  _seed += 1;
  return `seg_${Date.now().toString(36)}_${_seed.toString(36)}`;
};

/**
 * Lift a wire segment into the editor shape. Falls back to sane defaults
 * when the backend omits ``cRate`` or ``name``.
 */
export function toEditable(
  seg: Partial<OpenEndedProtocolSegment>,
): EditableProtocolSegment {
  return {
    id: nextId(),
    name: typeof seg.name === 'string' ? seg.name : '',
    cycleStart: Number.isFinite(seg.cycleStart as number)
      ? Math.max(1, Math.floor(seg.cycleStart as number))
      : 1,
    cycleEnd:
      seg.cycleEnd == null
        ? null
        : Number.isFinite(seg.cycleEnd)
          ? Math.floor(seg.cycleEnd as number)
          : null,
    cRate: Number.isFinite(seg.cRate as number) && (seg.cRate as number) > 0
      ? (seg.cRate as number)
      : 0.1,
  };
}

export function toEditableList(
  list: ReadonlyArray<Partial<OpenEndedProtocolSegment>> | null | undefined,
): EditableProtocolSegment[] {
  if (!list) return [];
  return list.map(toEditable);
}

/** Strip the editor id before sending to the backend. */
export function toWire(seg: EditableProtocolSegment): OpenEndedProtocolSegment {
  const out: OpenEndedProtocolSegment = {
    cycleStart: seg.cycleStart,
    cycleEnd: seg.cycleEnd,
    cRate: seg.cRate,
  };
  const trimmed = seg.name.trim();
  if (trimmed) out.name = trimmed;
  return out;
}

export function toWireList(
  list: ReadonlyArray<EditableProtocolSegment>,
): OpenEndedProtocolSegment[] {
  return list.map(toWire);
}

/** Build a fresh trailing "main cycling" segment for the "Add segment" CTA. */
export function makeBlankSegment(
  previous?: EditableProtocolSegment,
): EditableProtocolSegment {
  const start = previous
    ? (previous.cycleEnd ?? previous.cycleStart) + 1
    : 1;
  return {
    id: nextId(),
    name: '',
    cycleStart: start,
    cycleEnd: null,
    cRate: previous ? previous.cRate : 0.1,
  };
}

/**
 * Validate the sequence and return a list of per-segment error messages
 * (empty string for valid rows). The dialog disables the save button when
 * any non-empty entry remains.
 */
export function validateSequence(list: EditableProtocolSegment[]): string[] {
  const errs = new Array<string>(list.length).fill('');
  for (let i = 0; i < list.length; i += 1) {
    const seg = list[i];
    if (!Number.isInteger(seg.cycleStart) || seg.cycleStart < 1) {
      errs[i] = 'Start cycle must be a positive integer';
      continue;
    }
    if (seg.cycleEnd != null && seg.cycleEnd < seg.cycleStart) {
      errs[i] = 'End cycle must be ≥ start cycle';
      continue;
    }
    if (!Number.isFinite(seg.cRate) || seg.cRate <= 0) {
      errs[i] = 'C-rate must be a positive number';
      continue;
    }
    if (i > 0) {
      const prev = list[i - 1];
      const prevEnd = prev.cycleEnd ?? prev.cycleStart;
      if (seg.cycleStart <= prevEnd) {
        errs[i] = `Overlaps previous segment ending at cycle ${prevEnd}`;
      }
    }
  }
  return errs;
}
