import { describe, expect, it } from 'vitest';
import { colorForHierPath } from './ratePerfAggregation';
import { assignColourMapPerceptual, HIGH_CONTRAST_PALETTE, type ColStats } from '@/lib/treeUtils';

// Minimal ColStats — assignColourMapPerceptual only reads `distinctVals`.
const col = (header: string, distinctVals: string[]): ColStats =>
  ({ header, distinctVals } as unknown as ColStats);

describe('colorForHierPath', () => {
  const cathode = col('Cathode', ['NMC811', 'NMC622']);
  const spacer = col('Spacer_mm', ['1.0', '1.5']);
  const hierCols = [cathode, spacer];
  const maps = assignColourMapPerceptual(hierCols);

  it('colors a child group by its value within its level (matching the tree)', () => {
    // Spacer is level 1; its distinctVals map to HIGH_CONTRAST_PALETTE[0], [1].
    expect(colorForHierPath('NMC811|1.0', maps)).toBe(HIGH_CONTRAST_PALETTE[0]);
    expect(colorForHierPath('NMC811|1.5', maps)).toBe(HIGH_CONTRAST_PALETTE[1]);
  });

  it('gives sibling groups DISTINCT colors', () => {
    expect(colorForHierPath('NMC811|1.0', maps)).not.toBe(colorForHierPath('NMC811|1.5', maps));
  });

  it('colors a top-level (parent / drilled) node by the parent level', () => {
    // detailDepth>0 collapses the pathKey to the parent; last segment = cathode.
    expect(colorForHierPath('NMC811', maps)).toBe(HIGH_CONTRAST_PALETTE[0]);
    expect(colorForHierPath('NMC622', maps)).toBe(HIGH_CONTRAST_PALETTE[1]);
  });

  it('follows hierarchy reorder deterministically', () => {
    // Reorder: Spacer first, Cathode second. The level-1 lookup is now keyed by
    // cathode values, so the same conceptual leaf gets the cathode palette slot.
    const reordered = assignColourMapPerceptual([spacer, cathode]);
    expect(colorForHierPath('1.0|NMC811', reordered)).toBe(HIGH_CONTRAST_PALETTE[0]);
    expect(colorForHierPath('1.0|NMC622', reordered)).toBe(HIGH_CONTRAST_PALETTE[1]);
    // Deterministic: same inputs => same output.
    expect(colorForHierPath('1.0|NMC811', reordered)).toBe(colorForHierPath('1.0|NMC811', reordered));
  });

  it('falls back to a stable hue-mean path color when the value is unknown', () => {
    // '9.9' is not a distinct spacer value -> perceptual miss -> hue-mean fallback.
    const c = colorForHierPath('NMC811|9.9', maps);
    expect(c).toMatch(/^#[0-9a-f]{6}$/i);
    // No pathToColorMap supplied, so it must come from the deterministic fallback,
    // never the perceptual map.
    expect(Object.values(maps[1])).not.toContain(c);
  });
});
