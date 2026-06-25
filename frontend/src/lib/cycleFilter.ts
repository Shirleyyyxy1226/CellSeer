/**
 * Parse a comma/semicolon-separated cycle filter string into a Set of cycle
 * numbers. Supports individual values and inclusive ranges.
 *
 * Full-width / CJK punctuation is normalised to ASCII first, so a filter typed
 * with a Chinese (or other CJK) IME parses the same as its ASCII form — the
 * full-width comma '，', ideographic comma '、', full-width digits '１２３', and
 * dash variants ('－', '～', '—') are all accepted.
 *
 * Examples:
 *   parseCycleFilter('')             -> null   (no filter)
 *   parseCycleFilter('  ')           -> null
 *   parseCycleFilter('1, 3, 5-8')    -> Set { 1, 3, 5, 6, 7, 8 }
 *   parseCycleFilter('1，3，5－8')     -> Set { 1, 3, 5, 6, 7, 8 }   (full-width)
 *   parseCycleFilter('garbage')      -> null   (nothing parseable)
 *
 * Returns `null` (rather than an empty Set) so callers can use a single
 * `allowedCycles ?? null` check to mean "no filtering".
 */
export function parseCycleFilter(input: string): Set<number> | null {
  const s = normalizeCjkPunctuation(input).trim();
  if (!s) return null;
  const out = new Set<number>();
  for (const part of s.split(/[,;]\s*/)) {
    const dash = part.indexOf('-');
    if (dash >= 0) {
      const lo = parseInt(part.slice(0, dash), 10);
      const hi = parseInt(part.slice(dash + 1), 10);
      if (!isNaN(lo) && !isNaN(hi)) {
        for (let i = lo; i <= hi; i++) out.add(i);
      }
    } else {
      const n = parseInt(part, 10);
      if (!isNaN(n)) out.add(n);
    }
  }
  return out.size ? out : null;
}

/**
 * Map full-width / CJK punctuation and digits to their ASCII equivalents so the
 * cycle filter accepts input typed with a CJK IME. Without this, a Chinese
 * comma '，' (U+FF0C) isn't recognised as a separator, so '1，2，4' collapses to
 * a single token and parseInt() reads only the leading '1' — silently filtering
 * to just cycle 1.
 */
function normalizeCjkPunctuation(input: string): string {
  return (
    input
      // Full-width ASCII block (U+FF01–U+FF5E) → ASCII (U+0021–U+007E). Covers
      // '，' → ',', '；' → ';', '－' → '-', and full-width digits '０'–'９'.
      .replace(/[！-～]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
      // Ideographic space → normal space; ideographic comma '、' → ','.
      .replace(/　/g, ' ')
      .replace(/、/g, ',')
      // Dash / wave-dash variants (and the tilde from a normalised '～') used
      // for ranges → ASCII hyphen.
      .replace(/[‐-―−〜〰~]/g, '-')
  );
}
