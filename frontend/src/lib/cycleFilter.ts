/**
 * Parse a comma/semicolon-separated cycle filter string into a Set of cycle
 * numbers. Supports individual values and inclusive ranges.
 *
 * Examples:
 *   parseCycleFilter('')           -> null   (no filter)
 *   parseCycleFilter('  ')         -> null
 *   parseCycleFilter('1, 3, 5-8')  -> Set { 1, 3, 5, 6, 7, 8 }
 *   parseCycleFilter('garbage')    -> null   (nothing parseable)
 *
 * Returns `null` (rather than an empty Set) so callers can use a single
 * `allowedCycles ?? null` check to mean "no filtering".
 */
export function parseCycleFilter(input: string): Set<number> | null {
  const s = input.trim();
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
