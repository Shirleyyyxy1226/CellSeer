/** Cycle colour utilities: sequential single-hue ramps for visualising cycle ageing. */

/**
 * Sequential single-hue blue ramp for an ordered value like cycle number.
 * t=0 (early) -> light blue, t=1 (late) -> dark navy. Lightness decreases
 * monotonically, so "darker = later" reads as a smooth progression — unlike a
 * rainbow, which has no intuitive direction.
 */
export function cycleColor(t: number): string {
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const lo = [191, 219, 245]; // #bfdbf5 — light blue (early)
  const hi = [11, 46, 99]; //    #0b2e63 — dark navy (late)
  const ch = (i: number) => Math.round(lo[i] + (hi[i] - lo[i]) * x);
  return '#' + [ch(0), ch(1), ch(2)].map((v) => v.toString(16).padStart(2, '0')).join('');
}

/**
 * Fade a cell's own colour across its cycles: early cycle (t=0) = a lighter
 * tint of the colour, late cycle (t=1) = the full colour. Only tints toward
 * white (keeps the hue), so every cycle still clearly reads as that cell's
 * colour — unlike a desaturating fade that washes early cycles to grey.
 * Returns the input unchanged if it isn't a 6-digit hex.
 */
export function cellCycleColor(hex: string, t: number): string {
  const m = /^#?([0-9a-fA-F]{6})$/.exec(hex ?? '');
  if (!m) return hex;
  const x = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0));
  const v = m[1];
  const r = parseInt(v.slice(0, 2), 16);
  const g = parseInt(v.slice(2, 4), 16);
  const b = parseInt(v.slice(4, 6), 16);
  const tint = 0.5 * (1 - x); // up to 50% toward white at the earliest cycle
  const ch = (c: number) => Math.round(c + (255 - c) * tint);
  return '#' + [ch(r), ch(g), ch(b)].map((c) => c.toString(16).padStart(2, '0')).join('');
}
