import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import {
  analyseCSV,
  clearHierarchyOrder,
  fetchDefaultHierarchyAnalyse,
  fetchHierarchyOrder,
  saveHierarchyOrder,
  type AnalyseResponse,
} from '@/lib/analyseApi';
import type { TreeFilterPath } from '@/components/tree/treeTypes';
import type { ParsedCSV } from '@/lib/treeUtils';
import { useDataRefresh } from '@/contexts/DataRefreshContext';

interface ProjectHierarchyContextValue {
  loading: boolean;
  error: string | null;
  projectKey: string;
  parsed: ParsedCSV | null;
  apiData: AnalyseResponse | null;
  activeJs: number[];
  setHierarchyOrder: (nextJs: number[]) => Promise<void>;
  resetHierarchyOrder: () => Promise<void>;
  reloadHierarchy: () => Promise<void>;
  matchPathToIdNos: (path: TreeFilterPath) => Set<number> | null;
}

const ProjectHierarchyContext = createContext<ProjectHierarchyContextValue>({
  loading: false,
  error: null,
  projectKey: 'db-default',
  parsed: null,
  apiData: null,
  activeJs: [],
  setHierarchyOrder: async () => {},
  resetHierarchyOrder: async () => {},
  reloadHierarchy: async () => {},
  matchPathToIdNos: () => null,
});

function toCsvText(headers: string[], rows: string[][]): string {
  const headerLine = headers.join(',');
  const rowLines = rows.map((r) => r.join(','));
  return [headerLine, ...rowLines].join('\n');
}

function parseNumericLike(value: string): number | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  // Only treat as numeric when the whole token is numeric.
  // This avoids false matches like:
  // "1.0 M LiPF6 in EC/DEC..." vs "1.0 M LiPF6 in EC/DMC..."
  // where both strings start with "1.0" but represent different categories.
  if (!/^-?\d+(\.\d+)?$/.test(trimmed)) return null;
  const parsed = Number(trimmed);
  return Number.isFinite(parsed) ? parsed : null;
}

function valueMatchesPathValue(rowVal: string, pathVal: string): boolean {
  const a = String(rowVal ?? '').trim();
  const b = pathVal === '(unknown)' ? '' : String(pathVal ?? '').trim();
  const numA = parseNumericLike(a);
  const numB = parseNumericLike(b);
  if (numA != null && numB != null) {
    return Math.abs(numA - numB) < 1e-9;
  }
  return a === b;
}

function resolvePathColumnIndex(headers: string[], header: string): number {
  const exact = headers.findIndex((h) => h === header);
  if (exact >= 0) return exact;
  const lower = header.trim().toLowerCase();
  return headers.findIndex((h) => h.trim().toLowerCase() === lower);
}

function resolveIdNoColumnIndex(headers: string[]): number {
  const patterns = [
    /^id\s*no\.?$/i,
    /^id_no$/i,
    /^number$/i,
    /^cel\s*no\.?$/i,
    /^cell\s*no\.?$/i,
  ];
  for (let i = 0; i < headers.length; i += 1) {
    const h = String(headers[i] ?? '').trim();
    if (patterns.some((p) => p.test(h))) return i;
  }
  return -1;
}

function extractIdNoFromRow(
  row: string[],
  idNoCol: number,
  leafCol: number,
): number | null {
  if (idNoCol >= 0) {
    const n = parseInt(String(row[idNoCol] ?? '').trim(), 10);
    if (!Number.isNaN(n) && n > 0) return n;
  }
  const leafVal = String(row[leafCol] ?? '').trim();
  const m = leafVal.match(/^Cell\s*(\d+)$/i) ?? leafVal.match(/^(\d+)$/);
  if (!m) return null;
  const n = parseInt(m[1], 10);
  return Number.isNaN(n) ? null : n;
}

export function ProjectHierarchyProvider({ children }: { children: React.ReactNode }) {
  const { dataVersion } = useDataRefresh();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [projectKey, setProjectKey] = useState<string>('db-default');
  const [parsed, setParsed] = useState<ParsedCSV | null>(null);
  const [apiData, setApiData] = useState<AnalyseResponse | null>(null);
  const [activeJs, setActiveJs] = useState<number[]>([]);
  const parsedCsvRef = useRef<string>('');
  const loadSeqRef = useRef(0);

  const applyWithOrder = useCallback(
    async (csvText: string, order?: number[]) => {
      if (order && order.length > 0) {
        return analyseCSV(csvText, { maxLevels: 4, userHierJs: order });
      }
      return analyseCSV(csvText, { maxLevels: 4 });
    },
    [],
  );

  const reloadHierarchy = useCallback(async () => {
    const seq = loadSeqRef.current + 1;
    loadSeqRef.current = seq;
    setLoading(true);
    setError(null);
    try {
      const base = await fetchDefaultHierarchyAnalyse();
      const scopedKey = base.projectKey || 'db-default';
      const csvText = toCsvText(base.parsed.headers, base.parsed.rows);
      parsedCsvRef.current = csvText;
      let next = base;
      const savedOrder = await fetchHierarchyOrder(scopedKey);
      if (savedOrder.length > 0) {
        try {
          next = await applyWithOrder(csvText, savedOrder);
          next.projectKey = scopedKey;
        } catch {
          next = base;
        }
      }
      if (loadSeqRef.current !== seq) return;
      setProjectKey(scopedKey);
      setApiData(next);
      setParsed(next.parsed);
      setActiveJs(next.analysis?.hierCols?.map((c) => c.j) ?? []);
    } catch (e) {
      if (loadSeqRef.current !== seq) return;
      setApiData(null);
      setParsed(null);
      setActiveJs([]);
      setError(e instanceof Error ? e.message : 'Failed to load hierarchy');
    } finally {
      if (loadSeqRef.current === seq) setLoading(false);
    }
  }, [applyWithOrder]);

  useEffect(() => {
    reloadHierarchy();
  }, [reloadHierarchy, dataVersion]);

  const setHierarchyOrder = useCallback(
    async (nextJs: number[]) => {
      if (!parsed || !parsedCsvRef.current) return;
      setError(null);
      setLoading(true);
      try {
        const next = await applyWithOrder(parsedCsvRef.current, nextJs);
        next.projectKey = projectKey;
        setApiData(next);
        setParsed(next.parsed);
        setActiveJs(next.analysis?.hierCols?.map((c) => c.j) ?? nextJs);
        await saveHierarchyOrder(nextJs, projectKey);
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Failed to update hierarchy order');
      } finally {
        setLoading(false);
      }
    },
    [applyWithOrder, parsed, projectKey],
  );

  const resetHierarchyOrder = useCallback(async () => {
    if (!parsedCsvRef.current) return;
    setError(null);
    setLoading(true);
    try {
      await clearHierarchyOrder(projectKey);
      const next = await applyWithOrder(parsedCsvRef.current);
      next.projectKey = projectKey;
      setApiData(next);
      setParsed(next.parsed);
      setActiveJs(next.analysis?.hierCols?.map((c) => c.j) ?? []);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reset hierarchy order');
    } finally {
      setLoading(false);
    }
  }, [applyWithOrder, projectKey]);

  const matchPathToIdNos = useCallback(
    (path: TreeFilterPath): Set<number> | null => {
      if (!parsed || !apiData) return null;
      if (!path.length) return null;
      const headers = parsed.headers ?? [];
      const rows = parsed.rows ?? [];
      const leafCol = apiData.analysis?.leafCol ?? Math.max(0, headers.length - 1);
      const idNoCol = resolveIdNoColumnIndex(headers);
      const out = new Set<number>();
      rows.forEach((row) => {
        const ok = path.every(({ header, val }) => {
          let idx = resolvePathColumnIndex(headers, header);
          // Leaf clicks use pseudo-header "Cell" with id_no as val (e.g. "194"), not the Repeat leaf column.
          if (idx < 0 && header.trim().toLowerCase() === 'cell') {
            idx = idNoCol >= 0 ? idNoCol : leafCol;
          }
          if (idx < 0) return false;
          return valueMatchesPathValue(String(row[idx] ?? ''), val);
        });
        if (!ok) return;
        const idNo = extractIdNoFromRow(row, idNoCol, leafCol);
        if (idNo != null) out.add(idNo);
      });
      return out;
    },
    [apiData, parsed],
  );

  const value = useMemo<ProjectHierarchyContextValue>(
    () => ({
      loading,
      error,
      projectKey,
      parsed,
      apiData,
      activeJs,
      setHierarchyOrder,
      resetHierarchyOrder,
      reloadHierarchy,
      matchPathToIdNos,
    }),
    [
      loading,
      error,
      projectKey,
      parsed,
      apiData,
      activeJs,
      setHierarchyOrder,
      resetHierarchyOrder,
      reloadHierarchy,
      matchPathToIdNos,
    ],
  );

  return (
    <ProjectHierarchyContext.Provider value={value}>
      {children}
    </ProjectHierarchyContext.Provider>
  );
}

export function useProjectHierarchy() {
  return useContext(ProjectHierarchyContext);
}
