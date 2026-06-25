/**
 * Stateless display helpers shared by the project-upload row drawer and
 * the right-side cell-detail sidebar. Splitting these out of
 * `ProjectDetailPage.tsx` keeps the formatting rules (number digits,
 * dataset label map, flag truthiness, file-accept string) in one place.
 */

import type { CellDatasetSummary } from '@/lib/cellTypes';

/**
 * Cycling file extensions accepted by the per-cell upload endpoint.
 * Mirrors `SUPPORTED_PER_CELL_TEST_TYPES` in `backend/routers/upload.py`.
 */
export const CYCLING_FILE_ACCEPT = '.xlsx,.xls,.csv,.mpt,.mpr';

/**
 * Treat strings like "y" / "yes" / "true" / "1" as positive flags; anything
 * else (including empty / "no" / "n") is read as negative. The metadata
 * sheet uses many different conventions so we collapse them at read-time.
 */
const TRUTHY_FLAG = new Set(['y', 'yes', 'true', '1', '✓', 'x', 'on']);
export function flagIsOn(value: string | null | undefined): boolean {
  if (!value) return false;
  return TRUTHY_FLAG.has(value.trim().toLowerCase());
}

/** Render a numeric metadata value, returning `—` for null/NaN. */
export function fmtNum(value: number | null | undefined, digits = 3, unit = ''): string {
  if (value == null || !Number.isFinite(value)) return '—';
  const formatted =
    Number.isInteger(value) && digits === 0
      ? String(value)
      : Number(value.toFixed(digits)).toString();
  return unit ? `${formatted} ${unit}` : formatted;
}

/** Render a string metadata value, returning `—` for null/empty/whitespace. */
export function fmtText(value: string | null | undefined): string {
  const s = (value ?? '').trim();
  return s || '—';
}

export function fmtBytes(n: number | null | undefined): string | null {
  if (n == null || !Number.isFinite(n) || n <= 0) return null;
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i += 1;
  }
  return `${v < 10 ? v.toFixed(1) : Math.round(v)} ${units[i]}`;
}

/**
 * Friendly labels for `dataset.name` values that the backend stores in
 * snake_case. Anything not in the map falls back to tidy Title Case.
 */
const DATASET_LABELS: Record<string, string> = {
  cycling: 'Cycling',
  dqdv: 'dQ/dV',
  dvdq: 'dV/dQ',
  discharge_dqdv: 'Discharge dQ/dV',
  discharge_dvdq: 'Discharge dV/dQ',
  charge_dqdv: 'Charge dQ/dV',
  charge_dvdq: 'Charge dV/dQ',
  eis: 'EIS',
  formation: 'Formation',
  rate_test: 'Rate test',
};

export function prettyDatasetName(name: string): string {
  const known = DATASET_LABELS[name];
  if (known) return known;
  return name
    .split('_')
    .map((p) => (p.length === 0 ? p : p[0].toUpperCase() + p.slice(1)))
    .join(' ');
}

export function hasCyclingDataset(datasets: CellDatasetSummary[] | undefined): boolean {
  return (datasets ?? []).some((d) => d.name === 'cycling');
}

/** Status string the upload hook reports up to UI surfaces. */
export type AttachStatusName = 'idle' | 'uploading' | 'processing' | 'done' | 'error';

export function statusLine(
  status: AttachStatusName,
  message: string | null,
  progress: number,
): string | null {
  if (status === 'uploading' || status === 'processing') {
    return message || `${progress}%`;
  }
  if (status === 'done') return message || 'Upload complete';
  if (status === 'error') return message || 'Upload failed';
  return null;
}
