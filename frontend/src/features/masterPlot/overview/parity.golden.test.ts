/**
 * Parity harness (TS reference side).
 *
 * This is the SINGLE SOURCE OF TRUTH for the Master Plot overview reduction.
 * It runs the production TS pipeline (summariseCell + groupConditions +
 * computeCondStats + computeFlaggedCells) over a shared fixture and writes the
 * result to backend/tests/fixtures/parity_golden.json.
 *
 * The Python twin (backend/master_plot_overview.py) is then asserted equal to
 * this golden by backend/tests/test_master_plot_parity.py. If you change a
 * formula here, the Python test fails until both sides match — which is the
 * whole point: the 50k+ server path can never silently drift from the client.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import type { RatePerfCell } from '@/lib/cellTypes';
import { summariseCell, METRICS } from './metrics';
import { groupConditions, computeCondStats, computeFlaggedCells, cellConditionKey } from './conditions';

const HERE = dirname(fileURLToPath(import.meta.url));
const FIXTURE_DIR = resolve(HERE, '../../../../../backend/tests/fixtures');
const FIXTURE = resolve(FIXTURE_DIR, 'parity_cells.json');
const GOLDEN = resolve(FIXTURE_DIR, 'parity_golden.json');

const CELL_KEYS = [
  'peakCapacitySpec', 'peakCapacityRaw', 'medianCE', 'retention',
  'cycleCount', 'capacityBasis',
] as const;

// Metrics carried by the overview aggregate (and thus the Python twin). The
// dQ/dV peak-shift metric is a SEPARATE lazy endpoint (master_plot_peakshift),
// not part of build_overview, so it's excluded from the parity golden.
const AGG_METRICS = METRICS.filter((m) => m.id !== 'dqdv-peak-shift');

describe('parity golden (TS reference)', () => {
  const raw = JSON.parse(readFileSync(FIXTURE, 'utf-8')) as RatePerfCell[];
  const summaries = raw.map(summariseCell);
  const conds = groupConditions(summaries);
  const flagMap = computeFlaggedCells(conds);

  // Per-condition aggregates for every metric — mirrors build_overview().
  const statByMetric = new Map(AGG_METRICS.map((m) => [m.id, computeCondStats(conds, m)]));
  const conditions: Record<string, unknown> = {};
  for (const cond of conds) {
    const metrics: Record<string, unknown> = {};
    for (const m of AGG_METRICS) {
      const s = statByMetric.get(m.id)!.get(cond.key)!;
      metrics[m.id] = { mean: s.mean, sd: s.sd, cv: s.cv, sem: s.sem, ciHalf: s.ciHalf, n: s.n };
    }
    conditions[cond.key] = {
      key: cond.key,
      cathode: cond.cathode,
      separatorType: cond.separatorType,
      spacerMm: cond.spacerMm,
      n: cond.cells.length,
      flaggedCount: cond.cells.filter((c) => flagMap.has(c.cellId)).length,
      metrics,
    };
  }

  const cells = summaries.map((s) => {
    const out: Record<string, unknown> = {
      cellId: s.cellId,
      condKey: cellConditionKey(s),
      flags: (flagMap.get(s.cellId) ?? []).map((f) => f.id),
    };
    for (const k of CELL_KEYS) out[k] = s[k];
    return out;
  });

  const golden = { conditions, cells };

  it('writes the golden file the Python parity test consumes', () => {
    writeFileSync(GOLDEN, JSON.stringify(golden, null, 2) + '\n');
    expect(cells).toHaveLength(raw.length);
  });

  // Coverage sanity — the fixture must actually exercise every code path the
  // parity test claims to cover, else "they match" is vacuous.
  it('exercises cap-outlier, few-cycles and the null protocol metrics', () => {
    const flagsOf = (id: string) => cells.find((c) => c.cellId === id)!.flags as string[];
    expect(flagsOf('A-4')).toContain('cap-outlier');
    expect(flagsOf('C-1')).toContain('few-cycles');
    // CE and retention are not computed yet, so they are null for every cell.
    expect(cells.find((c) => c.cellId === 'C-1')!.retention).toBeNull();
    expect(cells.find((c) => c.cellId === 'B-2')!.medianCE).toBeNull();
    // B-1 has no specific capacity -> basis falls back to raw mAh.
    expect(cells.find((c) => c.cellId === 'B-1')!.capacityBasis).toBe('mAh');
  });
});
