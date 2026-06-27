/**
 * Shared edit-state helpers for the per-cell metadata patch endpoint
 * (PATCH /api/cells/{cellId}).
 *
 * Two consumers use this module:
 *   - `frontend/src/pages/ProjectDetailPage.tsx` (the project-upload-page
 *     row drawer)
 *   - `frontend/src/components/CellDetailPanel.tsx` (the right-side
 *     cell-detail sidebar shown across the dashboard tabs)
 *
 * Keeping the field list, draft↔string projection, and patch builder in
 * one place ensures the two surfaces stay in lock-step: if we add a new
 * editable field, it shows up in both UIs automatically.
 */

import type { CellMetadataPatch } from '@/lib/api';
import type { IndexCell } from '@/lib/cell/cellTypes';

/**
 * Cell columns that can be patched through `PATCH /api/cells/{id}`.
 * Order here drives the default presentation order in the edit grid.
 */
export const PATCH_FIELDS = [
  'batch',
  'category',
  'repeat',
  'cathode',
  'cathodeDiameterMm',
  'cathodeMassG',
  'anode',
  'anodeDiameterMm',
  'anodeMassG',
  'npRatio',
  'separatorType',
  'separatorDiameterMm',
  'electrolyte',
  'electrolyteVolumeUl',
  'spacerMm',
  'doFormation',
  'doRateTest',
  'doEis',
  'notes',
] as const;
export type PatchField = (typeof PATCH_FIELDS)[number];

export type EditFieldKind = 'text' | 'number';

export const PATCH_FIELD_KIND: Record<PatchField, EditFieldKind> = {
  batch: 'number',
  category: 'text',
  repeat: 'number',
  cathode: 'text',
  cathodeDiameterMm: 'number',
  cathodeMassG: 'number',
  anode: 'text',
  anodeDiameterMm: 'number',
  anodeMassG: 'number',
  npRatio: 'number',
  separatorType: 'text',
  separatorDiameterMm: 'number',
  electrolyte: 'text',
  electrolyteVolumeUl: 'number',
  spacerMm: 'number',
  doFormation: 'text',
  doRateTest: 'text',
  doEis: 'text',
  notes: 'text',
};

/** String-typed draft (so empty inputs round-trip cleanly). */
export type EditDraft = Record<PatchField, string>;

/**
 * Lookup the underlying value on a CellRow regardless of the field's type.
 * Using an indexed access keeps this trivially correct as new fields are
 * added to {@link PATCH_FIELDS}.
 */
export function rawFieldValue(cell: IndexCell, field: PatchField): unknown {
  return (cell as unknown as Record<string, unknown>)[field];
}

/** Build a draft seeded from the cell's current values. */
export function draftFromCell(cell: IndexCell): EditDraft {
  const out = {} as EditDraft;
  for (const f of PATCH_FIELDS) {
    const v = rawFieldValue(cell, f);
    out[f] = v == null ? '' : String(v);
  }
  return out;
}

/**
 * Convert the draft back into the JSON patch the backend expects.
 * Only fields that actually changed from the original cell are included.
 *
 * Empty strings encode "clear this field" (sent as `null`). Numbers that
 * fail to parse are skipped so the patch never sends a bad payload.
 */
export function buildPatch(cell: IndexCell, draft: EditDraft): CellMetadataPatch {
  const patch: CellMetadataPatch = {};
  for (const f of PATCH_FIELDS) {
    const original = rawFieldValue(cell, f);
    const originalStr = original == null ? '' : String(original);
    const next = (draft[f] ?? '').trim();
    if (next === originalStr.trim()) continue;
    const kind = PATCH_FIELD_KIND[f];
    if (next === '') {
      (patch as Record<string, unknown>)[f] = null;
    } else if (kind === 'number') {
      const num = Number(next);
      if (!Number.isFinite(num)) continue;
      (patch as Record<string, unknown>)[f] = num;
    } else {
      (patch as Record<string, unknown>)[f] = next;
    }
  }
  return patch;
}
