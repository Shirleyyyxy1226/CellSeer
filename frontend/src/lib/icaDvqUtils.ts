/**
 * Utilities for ICA/DVQ display. Backend computes ICA/DVQ; this module provides
 * cellColor, cycleFadeColor, and interpolateOntoGrid for resampling API data onto shared grids.
 */

const COLORS = [
  '#1f77b4',
  '#ff7f0e',
  '#2ca02c',
  '#d62728',
  '#9467bd',
  '#8c564b',
  '#e377c2',
  '#7f7f7f',
  '#bcbd22',
  '#17becf',
  '#aec7e8',
  '#ffbb78',
  '#98df8a',
  '#ff9896',
  '#c5b0d5',
  '#c49c94',
];

function hashString(s: string): number {
  let h = 0;
  for (let i = 0; i < s.length; i++) {
    h = (h << 5) - h + s.charCodeAt(i);
    h = h & h;
  }
  return Math.abs(h);
}

/** Assign a consistent color for a cell (e.g. by cellId). */
export function cellColor(cellId: string, index: number): string {
  return COLORS[hashString(cellId) % COLORS.length] ?? COLORS[index % COLORS.length];
}

/**
 * Fade color by cycle index without making early cycles look light.
 * Uses darkening + desaturation instead of opacity, so early cycles recede
 * without blending to white. Based on human color perception: opacity fade
 * against white background increases perceived lightness; varying luminance
 * and saturation preserves perceptual hierarchy.
 *
 * Refs:
 * - Ware, C. "Information Visualization: Perception for Design" (Morgan Kaufmann)
 * - Stone, M. "Choosing colors for data visualization" (Perceptual Edge, 2006)
 * - Turbo colormap: https://research.google/blog/turbo-an-improved-rainbow-colormap-for-visualization/
 *
 * @param hex Base color (e.g. cell color)
 * @param t Fade factor 0–1 (0 = early cycle, 1 = latest cycle)
 */
export function cycleFadeColor(hex: string, t: number): string {
  const r = parseInt(hex.slice(1, 3), 16) / 255;
  const g = parseInt(hex.slice(3, 5), 16) / 255;
  const b = parseInt(hex.slice(5, 7), 16) / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  let h = 0;
  let s = 0;
  const l = (max + min) / 2;
  if (max !== min) {
    const d = max - min;
    s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) / 6;
    else if (max === g) h = ((b - r) / d + 2) / 6;
    else h = ((r - g) / d + 4) / 6;
  }
  const sNew = 0.35 + t * Math.max(0, s - 0.35);
  // Early cycles (t≈0) get lighter; later cycles (t≈1) keep base color
  const lNew = Math.min(0.9, l + (1 - t) * 0.35);
  return hslToHex(h, sNew, lNew);
}

function hslToHex(h: number, s: number, l: number): string {
  let r: number, g: number, b: number;
  if (s === 0) {
    r = g = b = l;
  } else {
    const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
    const p = 2 * l - q;
    r = hue2rgb(p, q, h + 1 / 3);
    g = hue2rgb(p, q, h);
    b = hue2rgb(p, q, h - 1 / 3);
  }
  const toHex = (x: number) => Math.round(Math.max(0, Math.min(1, x)) * 255).toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function hue2rgb(p: number, q: number, t: number): number {
  if (t < 0) t += 1;
  if (t > 1) t -= 1;
  if (t < 1 / 6) return p + (q - p) * 6 * t;
  if (t < 1 / 2) return q;
  if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
  return p;
}

/** Linear interpolation: value at x from (x0,y0) and (x1,y1). */
function lerp(x: number, x0: number, y0: number, x1: number, y1: number): number {
  if (x1 === x0) return y0;
  return y0 + ((x - x0) * (y1 - y0)) / (x1 - x0);
}

/** Interpolate (x, y) data onto a regular grid. Used when backend provides pre-computed ica/dvq. */
export function interpolateOntoGrid(
  x: number[],
  y: number[],
  xGrid: number[],
  outOfRangeValue: number = 0
): number[] {
  if (x.length < 2 || y.length < 2) return xGrid.map(() => outOfRangeValue);
  const xMin = Math.min(x[0], x[x.length - 1]);
  const xMax = Math.max(x[0], x[x.length - 1]);
  const inc = x[1] >= x[0];
  return xGrid.map((xg) => {
    if (xg < xMin || xg > xMax) return outOfRangeValue;
    let i = 0;
    if (inc) {
      while (i < x.length - 1 && x[i + 1] < xg) i++;
    } else {
      while (i < x.length - 1 && x[i + 1] > xg) i++;
    }
    if (i >= x.length - 1) return y[y.length - 1] ?? outOfRangeValue;
    return lerp(xg, x[i], y[i], x[i + 1], y[i + 1]);
  });
}
