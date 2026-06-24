/**
 * Overview colour system for metric values (the bad→good ramps below). Cathode
 * identity colours are NOT defined here — they come from the canonical
 * `cathodeColor` in `@/lib/cellColorScheme`, so the same cathode is the same
 * colour across every view.
 */

/**
 * Metric "bad → good" ramps. The metric value is a monotonic 0→1 goodness
 * score (see metricScore), so a sequential ramp encodes it directly: ramp start
 * = bad, ramp end = good.
 *
 * Default is **red→yellow→green** — red = bad, green = good is the most
 * immediately legible "quality" encoding for non-expert users. It is NOT
 * colour-blind safe (~8% of men cannot read red/green reliably), so the
 * picker keeps viridis/cividis (perceptually-uniform, CVD-safe) available for
 * anyone who needs them. The per-metric legend (RampLegend) annotates direction
 * and, for on-target metrics, mirrors the ramp so green sits in the centre.
 */
export const RAMPS = {
  // Intuitive red → yellow → green (default): red = bad, green = good.
  redYellowGreen: ['#dc2626', '#ea580c', '#facc15', '#16a34a', '#15803d'],
  // Perceptually-uniform, colour-blind-safe alternative.
  viridis: ['#440154', '#3b528b', '#21918c', '#5ec962', '#fde725'],
  // Most CVD-robust of all; blue → grey → yellow.
  cividis: ['#00204d', '#31446b', '#7c7b78', '#b4a269', '#ffe945'],
} as const;

export type RampId = keyof typeof RAMPS;

export const DEFAULT_RAMP_ID: RampId = 'redYellowGreen';

/** Active ramp. Swap via RAMPS[id] when the picker lands; default is CVD-safe. */
export const RAMP: readonly string[] = RAMPS[DEFAULT_RAMP_ID];

export function rampColourFrom(ramp: readonly string[], t: number): string {
  const clamped = Math.min(1, Math.max(0, t));
  const seg = clamped * (ramp.length - 1);
  const i = Math.min(ramp.length - 2, Math.floor(seg));
  const f = seg - i;
  const a = ramp[i];
  const b = ramp[i + 1];
  const hex = (s: string, j: number) => parseInt(s.slice(1 + j * 2, 3 + j * 2), 16);
  const ch = (j: number) => Math.round(hex(a, j) + (hex(b, j) - hex(a, j)) * f);
  return `rgb(${ch(0)}, ${ch(1)}, ${ch(2)})`;
}

/**
 * Neutral fill for tiles whose value is missing / null. Visually distinct from
 * any point on a sequential ramp (which never produces a flat mid-grey), so a
 * deep-purple "low" tile is never confused with "no data". Uses the design
 * system's muted token so it follows light / dark mode.
 */
export const MISSING_TILE_BG = 'hsl(var(--muted))';
export const MISSING_TILE_FG = 'hsl(var(--muted-foreground))';

/**
 * Neutral chrome for treemap *group* panels (cathode / separator / spacer
 * branches). Group panels must NOT use the viridis ramp — otherwise the panel
 * fill reads as if it encodes a value and competes with the value-bearing leaf
 * cells. Instead they get a near-flat light/dark-mode-aware grey so colour in
 * the treemap always means "metric value", never "group identity". Plotly can't
 * resolve CSS variables, so we branch on the documented `dark` class the way the
 * other Plotly views in this app do.
 *
 * NOTE: consumed only by LibraryTreemap, which is in development and not
 * currently mounted — these helpers are dormant until that view is re-enabled.
 */
function isDarkMode(): boolean {
  return typeof document !== 'undefined' && document.documentElement.classList.contains('dark');
}

/** Flat neutral fill for treemap branch (group) panels. */
export function branchPanelColour(): string {
  return isDarkMode() ? 'rgba(255,255,255,0.04)' : 'rgba(15,23,42,0.035)';
}

/** Neutral text colour for treemap branch panel headers. */
export function branchPanelText(): string {
  return isDarkMode() ? 'rgba(226,232,240,0.92)' : 'rgba(30,41,59,0.92)';
}

/**
 * sRGB → relative luminance (WCAG / Rec. 709 with gamma linearisation). More
 * accurate than a raw luma sum for deciding text contrast, so labels stay
 * legible (≥4.5:1) across the *whole* ramp — including the mid-ramp green/teal
 * band where a naive threshold flips too early.
 */
function relLuminance(r: number, g: number, b: number): number {
  const lin = (c: number) => {
    const s = c / 255;
    return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(r) + 0.7152 * lin(g) + 0.0722 * lin(b);
}

/**
 * Readable text colour for a label sitting on `rampColourFrom(ramp, t)`.
 * Computes the swatch's relative luminance and picks near-black text on light
 * tiles (yellow/green) and white on dark (purple/blue) — so contrast follows
 * the active ramp rather than assuming the default's dark→bright shape. All
 * three registry ramps (viridis / cividis / red→yellow→green) clear 4.5:1.
 */
export function rampTextFrom(ramp: readonly string[], t: number): string {
  const m = rampColourFrom(ramp, t).match(/\d+/g);
  if (!m) return '#ffffff';
  const [r, g, b] = m.map(Number);
  // Threshold ~0.35 luminance: contrast against white drops below 4.5:1 above
  // this, so switch to dark ink. Tuned for the mid-ramp green of viridis.
  return relLuminance(r, g, b) > 0.35 ? '#111827' : '#ffffff';
}

