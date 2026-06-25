/**
 * Mirror of the backend ``_parse_c_rate_value`` helper. Accepts the same
 * "1C", "C/10", "0.5C", "0.1" inputs that the cell-record stores, so the
 * wizard can ingest legacy meta and round-trip without normalisation drift.
 *
 * Also supports plain fraction form "1/10" (no C prefix) since the
 * segment editor now uses a bare-number / fraction input with a "C" suffix
 * label rendered separately.
 */

/**
 * Parse a C-rate from a string or number. Returns ``null`` for inputs that
 * can't be interpreted (the caller should keep the previous valid value).
 *
 * Accepted formats:
 *   "0.1"    bare decimal
 *   "1/10"   fraction (N/D)
 *   "C/10"   legacy C/ prefix
 *   "1C"     legacy nC suffix
 *   2        plain number
 */
export function parseCRate(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === 'number') {
    return Number.isFinite(input) && input > 0 ? input : null;
  }
  const s = String(input).trim().toUpperCase();
  if (!s) return null;

  // Legacy "C/N" prefix format
  if (s.startsWith('C/')) {
    const denom = Number(s.slice(2));
    return Number.isFinite(denom) && denom > 0 ? 1 / denom : null;
  }

  // Legacy "nC" suffix format (also "/NC" for C/N written backwards)
  if (s.endsWith('C')) {
    const base = s.slice(0, -1).trim();
    if (base.startsWith('/')) {
      const denom = Number(base.slice(1));
      return Number.isFinite(denom) && denom > 0 ? 1 / denom : null;
    }
    const n = Number(base);
    return Number.isFinite(n) && n > 0 ? n : null;
  }

  // Fraction "N/D" (no C)
  if (s.includes('/')) {
    const [numStr, denomStr] = s.split('/');
    const num = Number(numStr);
    const denom = Number(denomStr);
    return Number.isFinite(num) && Number.isFinite(denom) && denom > 0 && num > 0
      ? num / denom
      : null;
  }

  // Plain decimal / integer
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Format a C-rate for display (e.g. in band labels, chips).
 * Rates ≥ 1 → "2C"; rates < 1 → "C/10", "C/2", or "0.33C" as fallback.
 */
export function formatCRate(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '—';
  if (rate >= 1) {
    const rounded = Math.round(rate * 100) / 100;
    return `${Number.isInteger(rounded) ? rounded : rounded}C`;
  }
  const inv = 1 / rate;
  const invRounded = Math.round(inv);
  if (Math.abs(inv - invRounded) / invRounded < 0.01) {
    return `C/${invRounded}`;
  }
  return `${(Math.round(rate * 100) / 100).toString()}C`;
}

/**
 * Format a C-rate for the editor input field — returns only the numeric /
 * fraction part, without a "C" suffix (the UI renders "C" as a separate
 * unit label). E.g. 0.1 → "1/10", 2 → "2", 0.33 → "0.33".
 */
export function formatCRateInput(rate: number): string {
  if (!Number.isFinite(rate) || rate <= 0) return '';
  if (rate >= 1) {
    const rounded = Math.round(rate * 100) / 100;
    return String(Number.isInteger(rounded) ? rounded : rounded);
  }
  const inv = 1 / rate;
  const invRounded = Math.round(inv);
  if (Math.abs(inv - invRounded) / invRounded < 0.01) {
    return `1/${invRounded}`;
  }
  return String(Math.round(rate * 100) / 100);
}

/** Render a cycle range with the open-end "→ end" affordance. */
export function formatCycleRange(start: number, end: number | null): string {
  if (end == null) return `${start} → end`;
  if (end === start) return `${start}`;
  return `${start}–${end}`;
}

/**
 * Build the one-line label the backend would synthesise (kept in sync with
 * ``_synth_protocol_name``) so the wizard preview stays accurate before
 * the user gets the round-trip from the server.
 */
export function synthesiseProtocolName(
  segments: { name?: string | null; cRate: number }[],
): string {
  const tokens: string[] = [];
  for (const seg of segments) {
    const label = formatCRate(seg.cRate);
    const name = (seg.name ?? '').trim();
    const token = name ? `${name.toUpperCase()}-${label}` : label;
    if (tokens.length === 0 || tokens[tokens.length - 1] !== token) {
      tokens.push(token);
    }
  }
  return tokens.join(' | ');
}
