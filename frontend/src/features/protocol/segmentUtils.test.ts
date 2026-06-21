import { describe, expect, it } from 'vitest';
import {
  toEditable,
  toEditableList,
  toWire,
  toWireList,
  makeBlankSegment,
  validateSequence,
} from './segmentUtils';
import type { EditableProtocolSegment } from './types';

const editable = (
  over: Partial<EditableProtocolSegment> = {},
): EditableProtocolSegment => ({
  id: over.id ?? 'x',
  name: over.name ?? '',
  cycleStart: over.cycleStart ?? 1,
  cycleEnd: over.cycleEnd === undefined ? null : over.cycleEnd,
  cRate: over.cRate ?? 0.1,
});

describe('segmentUtils', () => {
  describe('toEditable', () => {
    it('assigns a fresh non-empty client id', () => {
      const a = toEditable({ cycleStart: 1, cycleEnd: 5, cRate: 1 });
      const b = toEditable({ cycleStart: 1, cycleEnd: 5, cRate: 1 });
      expect(a.id).toBeTruthy();
      expect(b.id).toBeTruthy();
      expect(a.id).not.toBe(b.id);
    });

    it('copies a string name and defaults a missing name to ""', () => {
      expect(toEditable({ name: 'form' }).name).toBe('form');
      expect(toEditable({}).name).toBe('');
    });

    it('floors and clamps cycleStart to a minimum of 1', () => {
      expect(toEditable({ cycleStart: 3.9 }).cycleStart).toBe(3);
      expect(toEditable({ cycleStart: 0 }).cycleStart).toBe(1);
      expect(toEditable({ cycleStart: -5 }).cycleStart).toBe(1);
    });

    it('defaults cycleStart to 1 when missing or non-finite', () => {
      expect(toEditable({}).cycleStart).toBe(1);
      expect(toEditable({ cycleStart: Number.NaN }).cycleStart).toBe(1);
    });

    it('preserves null cycleEnd (open-ended) and floors finite ends', () => {
      expect(toEditable({ cycleEnd: null }).cycleEnd).toBeNull();
      expect(toEditable({}).cycleEnd).toBeNull();
      expect(toEditable({ cycleEnd: 9.8 }).cycleEnd).toBe(9);
    });

    it('falls back cycleEnd to null when non-finite', () => {
      expect(toEditable({ cycleEnd: Number.NaN }).cycleEnd).toBeNull();
    });

    it('keeps a positive cRate and defaults to 0.1 otherwise', () => {
      expect(toEditable({ cRate: 2 }).cRate).toBe(2);
      expect(toEditable({ cRate: 0 }).cRate).toBe(0.1);
      expect(toEditable({ cRate: -1 }).cRate).toBe(0.1);
      expect(toEditable({}).cRate).toBe(0.1);
    });
  });

  describe('toEditableList', () => {
    it('returns [] for null/undefined', () => {
      expect(toEditableList(null)).toEqual([]);
      expect(toEditableList(undefined)).toEqual([]);
    });

    it('maps each wire segment to an editable one', () => {
      const out = toEditableList([
        { cycleStart: 1, cycleEnd: 5, cRate: 1 },
        { cycleStart: 6, cycleEnd: null, cRate: 0.5 },
      ]);
      expect(out).toHaveLength(2);
      expect(out[0].cRate).toBe(1);
      expect(out[1].cycleEnd).toBeNull();
    });
  });

  describe('toWire', () => {
    it('strips the client id and copies positional fields', () => {
      const w = toWire(
        editable({ id: 'seg_abc', cycleStart: 2, cycleEnd: 8, cRate: 1.5 }),
      );
      expect(w).toEqual({ cycleStart: 2, cycleEnd: 8, cRate: 1.5 });
      expect('id' in w).toBe(false);
    });

    it('includes a trimmed name only when non-empty', () => {
      expect(toWire(editable({ name: '  form  ' })).name).toBe('form');
      expect('name' in toWire(editable({ name: '   ' }))).toBe(false);
      expect('name' in toWire(editable({ name: '' }))).toBe(false);
    });

    it('preserves an open-ended cycleEnd', () => {
      expect(toWire(editable({ cycleEnd: null })).cycleEnd).toBeNull();
    });
  });

  describe('toWireList', () => {
    it('maps a list, stripping ids', () => {
      const out = toWireList([
        editable({ id: 'a', cycleStart: 1, cycleEnd: 5, cRate: 1 }),
        editable({ id: 'b', cycleStart: 6, cycleEnd: null, cRate: 0.5 }),
      ]);
      expect(out).toEqual([
        { cycleStart: 1, cycleEnd: 5, cRate: 1 },
        { cycleStart: 6, cycleEnd: null, cRate: 0.5 },
      ]);
    });
  });

  describe('makeBlankSegment', () => {
    it('starts at cycle 1 with default rate when no previous', () => {
      const s = makeBlankSegment();
      expect(s.cycleStart).toBe(1);
      expect(s.cycleEnd).toBeNull();
      expect(s.cRate).toBe(0.1);
      expect(s.id).toBeTruthy();
    });

    it('continues from the previous closed end + 1, inheriting cRate', () => {
      const s = makeBlankSegment(editable({ cycleStart: 1, cycleEnd: 5, cRate: 2 }));
      expect(s.cycleStart).toBe(6);
      expect(s.cRate).toBe(2);
      expect(s.cycleEnd).toBeNull();
    });

    it('uses previous cycleStart + 1 when previous is open-ended', () => {
      const s = makeBlankSegment(editable({ cycleStart: 4, cycleEnd: null, cRate: 1 }));
      expect(s.cycleStart).toBe(5);
    });
  });

  describe('validateSequence', () => {
    it('returns all-empty (valid) for well-ordered non-overlapping segments', () => {
      const errs = validateSequence([
        editable({ cycleStart: 1, cycleEnd: 5, cRate: 1 }),
        editable({ cycleStart: 6, cycleEnd: 10, cRate: 0.5 }),
        editable({ cycleStart: 11, cycleEnd: null, cRate: 0.1 }),
      ]);
      expect(errs).toEqual(['', '', '']);
    });

    it('flags non-integer or sub-1 cycleStart', () => {
      const errs = validateSequence([
        editable({ cycleStart: 0, cRate: 1 }),
        editable({ cycleStart: 2.5, cRate: 1 }),
      ]);
      expect(errs[0]).toBe('Start cycle must be a positive integer');
      expect(errs[1]).toBe('Start cycle must be a positive integer');
    });

    it('flags cycleEnd < cycleStart', () => {
      const errs = validateSequence([
        editable({ cycleStart: 5, cycleEnd: 3, cRate: 1 }),
      ]);
      expect(errs[0]).toBe('End cycle must be ≥ start cycle');
    });

    it('allows cycleEnd === cycleStart (single-cycle segment)', () => {
      const errs = validateSequence([
        editable({ cycleStart: 5, cycleEnd: 5, cRate: 1 }),
      ]);
      expect(errs[0]).toBe('');
    });

    it('flags a non-positive or non-finite cRate', () => {
      const errs = validateSequence([
        editable({ cycleStart: 1, cycleEnd: 5, cRate: 0 }),
        editable({ cycleStart: 6, cycleEnd: 10, cRate: -1 }),
        editable({ cycleStart: 11, cycleEnd: 15, cRate: Number.NaN }),
      ]);
      expect(errs[0]).toBe('C-rate must be a positive number');
      expect(errs[1]).toBe('C-rate must be a positive number');
      expect(errs[2]).toBe('C-rate must be a positive number');
    });

    it('flags a segment overlapping the previous closed segment', () => {
      const errs = validateSequence([
        editable({ cycleStart: 1, cycleEnd: 10, cRate: 1 }),
        editable({ cycleStart: 5, cycleEnd: 20, cRate: 0.5 }),
      ]);
      expect(errs[0]).toBe('');
      expect(errs[1]).toBe('Overlaps previous segment ending at cycle 10');
    });

    it('flags an overlap against an open-ended previous segment (uses its start)', () => {
      // prev open-ended -> prevEnd falls back to prev.cycleStart (8)
      const errs = validateSequence([
        editable({ cycleStart: 8, cycleEnd: null, cRate: 1 }),
        editable({ cycleStart: 8, cycleEnd: null, cRate: 0.5 }),
      ]);
      expect(errs[1]).toBe('Overlaps previous segment ending at cycle 8');
    });

    it('does not flag overlap when next starts exactly after prev end + 1', () => {
      const errs = validateSequence([
        editable({ cycleStart: 1, cycleEnd: 10, cRate: 1 }),
        editable({ cycleStart: 11, cycleEnd: null, cRate: 0.5 }),
      ]);
      expect(errs).toEqual(['', '']);
    });

    it('checks the cheapest failing rule first (cycleStart before cRate)', () => {
      // both cycleStart and cRate are invalid -> the start error wins (continue)
      const errs = validateSequence([
        editable({ cycleStart: 0, cRate: -1 }),
      ]);
      expect(errs[0]).toBe('Start cycle must be a positive integer');
    });

    it('returns an empty array for an empty sequence', () => {
      expect(validateSequence([])).toEqual([]);
    });
  });
});
