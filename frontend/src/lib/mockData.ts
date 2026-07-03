/**
 * Mock data loader for CellSeer demo
 * Loads data from jsDelivr CDN instead of backend API
 */

// Per-cell data (differential, GCD cycling curves) is too large to embed in
// the bundle, so it is hosted on the `demo-data` branch and fetched on demand
// from jsDelivr. See fetchDifferential / fetchCellRecord in api/index.ts.
export const DEMO_DATA_CDN =
  'https://cdn.jsdelivr.net/gh/Shirleyyyxy1226/CellSeer@demo-data';

// Real data exported from the backend for project prj_90de31b6677b,
// embedded in the build so the core views work fully offline (no backend).
import cellIndexJson from '@/data/cell-index.json';
import ratePerformanceJson from '@/data/rate-performance.json';
import hierarchyJson from '@/data/hierarchy.json';
import masterPlotOverviewJson from '@/data/master-plot-overview.json';
import peakShiftJson from '@/data/peak-shift.json';

export interface MockDataConfig {
  isDemo: boolean;
  cdnUrl: string;
  projectId: string;
  projectName: string;
  datasetMetadata: {
    cellCount: number;
    datasetCount: number;
    exportDate: string;
  };
  credit: {
    title: string;
    doi: string;
    license: string;
    url: string;
    citation: string;
  };
}

export const DEMO_CONFIG: MockDataConfig = {
  isDemo: typeof window !== 'undefined' && window.location.hostname.toLowerCase().endsWith('github.io'),
  cdnUrl: DEMO_DATA_CDN,
  projectId: 'prj_90de31b6677b',
  projectName: 'Discovery Benchmark',
  datasetMetadata: {
    cellCount: 259,
    datasetCount: 1016,
    exportDate: new Date().toISOString().split('T')[0],
  },
  credit: {
    title: 'Discovery Benchmark',
    doi: '10.5281/zenodo.20532539',
    license: 'CC-BY-4.0',
    url: 'https://zenodo.org/records/20532539',
    citation: 'Hunter, R., Hartley, N., Evans, M., Garcia Verga, L., Mildner, F., Smith, B., Xiong, S., Feng, J., Cooper, S. J., Walsh, A., & Titirici, M. (2026). Discovery Benchmark. Zenodo.',
  },
};

export async function loadMockData() {
  if (!DEMO_CONFIG.isDemo) {
    return null;
  }

  return {
    // The cell index (metadata + datasets) for the record table / hierarchy.
    cells: (cellIndexJson as { cells: unknown[] }).cells,
    // Per-cycle capacity data that drives the rate-performance plots.
    ratePerformance: ratePerformanceJson as { cells: unknown[]; protocols?: string[] },
    // Pre-computed hierarchy tree + colour maps.
    hierarchy: hierarchyJson,
    // Master Plot aggregates (per-condition + per-cell scalars) and peak-shift.
    masterPlotOverview: masterPlotOverviewJson,
    peakShift: peakShiftJson,
    config: DEMO_CONFIG,
  };
}

/**
 * Fetch a per-cell demo artifact (differential / cell-record) from the CDN.
 * Returns null on any failure so callers can degrade gracefully.
 */
export async function fetchDemoArtifact<T>(path: string): Promise<T | null> {
  try {
    const res = await fetch(`${DEMO_DATA_CDN}/${path}`);
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}
