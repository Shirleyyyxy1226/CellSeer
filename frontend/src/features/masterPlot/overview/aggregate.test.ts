/**
 * Unit tests for summariesFromOverview, the adapter that turns the server
 * overview aggregate (scalar-only) into the CellSummary[] the condition views
 * consume. Verifies scalar mapping, condition resolution (cathode / separator /
 * spacer, incl. integer + fractional + null spacers), pass-through of the
 * per-cell idNo / cellName / hasProtocol / protocolName, the empty capacitySeries
 * (grafted later from the per-cycle payload), and that the result re-groups into
 * the same conditions.
 */
import { describe, expect, it } from 'vitest';
import type { MasterPlotOverview, OverviewCell, OverviewCondition } from '@/lib/api';
import { summariesFromOverview } from './aggregate';
import { cellConditionKey, groupConditions } from './conditions';

function cond(over: Partial<OverviewCondition> & { key: string }): OverviewCondition {
  return {
    n: 0,
    cathode: 'Unknown',
    separatorType: '—',
    spacerMm: null,
    ...over,
  };
}

function cell(over: Partial<OverviewCell> & { cellId: string; condKey: string }): OverviewCell {
  return {
    idNo: 0,
    cellName: '',
    hasProtocol: false,
    protocolName: null,
    peakCapacitySpec: null,
    peakCapacityRaw: null,
    medianCE: null,
    retention: null,
    cycleCount: 0,
    capacityBasis: 'mAh',
    ...over,
  };
}

/**
 * Three conditions: an integer spacer (1), a fractional spacer (1.5), and a
 * null/'—' spacer; varied cathode + separator so resolution is non-trivial.
 */
function makeOverview(): MasterPlotOverview {
  const condA = cond({
    key: 'NMC811|Celgard 2325|1',
    cathode: 'NMC811',
    separatorType: 'Celgard 2325',
    spacerMm: 1,
    n: 2,
  });
  const condB = cond({
    key: 'LFP|GF/A|1.5',
    cathode: 'LFP',
    separatorType: 'GF/A',
    spacerMm: 1.5,
    n: 2,
  });
  const condC = cond({
    key: 'NMC622|Celgard 2400|—',
    cathode: 'NMC622',
    separatorType: 'Celgard 2400',
    spacerMm: null,
    n: 1,
  });

  return {
    projectId: 'TEST',
    cellCount: 5,
    conditionCount: 3,
    protocolCellCount: 3,
    conditions: {
      [condA.key]: condA,
      [condB.key]: condB,
      [condC.key]: condC,
    },
    cells: [
      cell({
        cellId: 'A-1',
        condKey: condA.key,
        idNo: 101,
        cellName: 'Alpha-1',
        hasProtocol: true,
        protocolName: 'C/20',
        peakCapacityRaw: 3.21,
        peakCapacitySpec: 150.5,
        medianCE: 99.4,
        retention: 92.1,
        cycleCount: 200,
        capacityBasis: 'mAh/g',
      }),
      cell({
        cellId: 'A-2',
        condKey: condA.key,
        idNo: 102,
        cellName: 'Alpha-2',
        hasProtocol: true,
        protocolName: 'C/20',
        peakCapacityRaw: 3.05,
        medianCE: 99.1,
        cycleCount: 198,
        capacityBasis: 'mAh',
      }),
      cell({
        cellId: 'B-1',
        condKey: condB.key,
        idNo: 103,
        cellName: 'Beta-1',
        peakCapacityRaw: 2.4,
        cycleCount: 50,
        capacityBasis: 'mAh',
      }),
      cell({
        cellId: 'B-2',
        condKey: condB.key,
        idNo: 104,
        cellName: 'Beta-2',
        peakCapacityRaw: 2.5,
        retention: null,
        cycleCount: 4,
        capacityBasis: 'mAh',
      }),
      cell({
        cellId: 'C-1',
        condKey: condC.key,
        idNo: 105,
        cellName: 'Gamma-1',
        hasProtocol: true,
        protocolName: 'C/10',
        peakCapacityRaw: 1.9,
        cycleCount: 10,
        capacityBasis: 'mAh',
      }),
    ],
  };
}

describe('summariesFromOverview', () => {
  it('maps every scalar straight through from the OverviewCell', () => {
    const ov = makeOverview();
    const summaries = summariesFromOverview(ov);
    expect(summaries).toHaveLength(5);

    const a1 = summaries[0];
    const src = ov.cells[0];
    expect(a1.cellId).toBe('A-1');
    expect(a1.peakCapacityRaw).toBe(src.peakCapacityRaw);
    expect(a1.peakCapacitySpec).toBe(src.peakCapacitySpec);
    expect(a1.medianCE).toBe(src.medianCE);
    expect(a1.retention).toBe(src.retention);
    expect(a1.cycleCount).toBe(src.cycleCount);
    expect(a1.capacityBasis).toBe('mAh/g');

    // null scalars survive as null, not coerced
    expect(summaries[2].peakCapacitySpec).toBeNull();
    expect(summaries[3].retention).toBeNull();
  });

  it('resolves cathode / separatorType / spacerMm from the matching condition', () => {
    const summaries = summariesFromOverview(makeOverview());

    // integer spacer
    expect(summaries[0].cathode).toBe('NMC811');
    expect(summaries[0].separatorType).toBe('Celgard 2325');
    expect(summaries[0].spacerMm).toBe(1);

    // fractional spacer
    expect(summaries[2].cathode).toBe('LFP');
    expect(summaries[2].separatorType).toBe('GF/A');
    expect(summaries[2].spacerMm).toBe(1.5);

    // null spacer stays null
    expect(summaries[4].cathode).toBe('NMC622');
    expect(summaries[4].separatorType).toBe('Celgard 2400');
    expect(summaries[4].spacerMm).toBeNull();
  });

  it('passes real idNo / cellName / hasProtocol / protocolName through', () => {
    const ov = makeOverview();
    const summaries = summariesFromOverview(ov);

    summaries.forEach((s, i) => {
      const src = ov.cells[i];
      expect(s.idNo).toBe(src.idNo);
      expect(s.cellName).toBe(src.cellName);
      expect(s.hasProtocol).toBe(src.hasProtocol);
      expect(s.protocolName).toBe(src.protocolName);
      // capacitySeries is grafted later from the per-cycle payload; flags are
      // derived client-side, so both start empty here.
      expect(s.capacitySeries).toEqual([]);
      expect(s.flags).toEqual([]);
    });

    expect(summaries[0].idNo).toBe(101);
    expect(summaries[0].protocolName).toBe('C/20');
    expect(summaries[2].hasProtocol).toBe(false);
    expect(summaries[2].protocolName).toBeNull();
  });

  it('falls back to Unknown / — / null when condKey has no matching condition', () => {
    const ov = makeOverview();
    ov.cells.push(cell({ cellId: 'orphan', condKey: 'does-not-exist', peakCapacityRaw: 1 }));
    const summaries = summariesFromOverview(ov);
    const orphan = summaries[summaries.length - 1];
    expect(orphan.cathode).toBe('Unknown');
    expect(orphan.separatorType).toBe('—');
    expect(orphan.spacerMm).toBeNull();
  });

  it('re-groups into the same condition rows the aggregate started with', () => {
    const ov = makeOverview();
    const summaries = summariesFromOverview(ov);
    const rows = groupConditions(summaries);

    // same number of conditions as the source aggregate
    expect(rows).toHaveLength(Object.keys(ov.conditions).length);

    // total cells preserved across the grouping
    const grouped = rows.reduce((n, r) => n + r.cells.length, 0);
    expect(grouped).toBe(ov.cells.length);
  });

  it("cellConditionKey of each summary equals its source cell's condKey", () => {
    const ov = makeOverview();
    const summaries = summariesFromOverview(ov);
    summaries.forEach((s, i) => {
      expect(cellConditionKey(s)).toBe(ov.cells[i].condKey);
    });
  });
});
