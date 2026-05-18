import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Upload } from 'lucide-react';
import { HierarchyEditor } from '@/components/tree/HierarchyEditor';
import { TreeSvg } from '@/components/tree/TreeSvg';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import {
  analyseCSV,
  clearHierarchyOrder,
  fetchDefaultHierarchyAnalyse,
  fetchHierarchyOrder,
  saveHierarchyOrder,
} from '@/lib/analyseApi';
import type { AnalyseResponse } from '@/lib/analyseApi';
import { useDimensions } from '@/hooks/useDimensions';
import { useTreeLayout } from '@/hooks/useTreeLayout';

/* ── Legend item ─────────────────────────────────────────────────────── */
function LegendItem({ colour, label }: { colour: string; label: string }) {
  return (
    <div className="flex items-center gap-[6px] text-[10px] text-muted-foreground">
      <span
        className="rounded-full shrink-0"
        style={{ width: 9, height: 9, background: colour }}
      />
      {label}
    </div>
  );
}

/* ── Main panel ─────────────────────────────────────────────────────── */
export function TreePanel() {
  const { handleCellSelect, annotationsByCell } = useCellSelection();
  const fileRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);

  const [apiData, setApiData] = useState<AnalyseResponse | null>(null);
  const [fileName, setFileName] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [dragOver, setDragOver] = useState(false);
  const [projectKey, setProjectKey] = useState<string>('db-default');
  const [containerRef, dims] = useDimensions<HTMLDivElement>();

  const loadFromCSV = useCallback(async (csvText: string, name: string, userHierJs?: number[]) => {
    abortRef.current?.abort();
    abortRef.current = new AbortController();
    setLoading(true);
    setError('');
    try {
      const res = await analyseCSV(csvText, {
        maxLevels: 4,
        userHierJs: userHierJs ?? undefined,
      });
      setApiData(res);
      setFileName(name);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Analysis failed');
      setApiData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadDefault = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const base = await fetchDefaultHierarchyAnalyse();
      const scopedProjectKey = base.projectKey || 'db-default';
      setProjectKey(scopedProjectKey);
      const savedOrder = await fetchHierarchyOrder(scopedProjectKey);
      if (savedOrder.length > 0) {
        try {
          const csvText = [base.parsed.headers.join(','), ...base.parsed.rows.map(r => r.join(','))].join('\n');
          const reordered = await analyseCSV(csvText, {
            maxLevels: 4,
            userHierJs: savedOrder,
          });
          setApiData(reordered);
        } catch {
          setApiData(base);
        }
      } else {
        setApiData(base);
      }
      setFileName('Metadata (DB)');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Backend unavailable — upload a CSV');
      setApiData(null);
      setFileName('');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDefault();
    return () => {
      abortRef.current?.abort();
    };
  }, [loadDefault]);

  const handleNewCSV = useCallback((raw: string, name: string) => {
    loadFromCSV(raw, name, undefined);
  }, [loadFromCSV]);

  const handleHierarchyReorder = useCallback((newJs: number[]) => {
    if (!apiData?.parsed) return;
    saveHierarchyOrder(newJs, projectKey).catch(() => {});
    const csvText = [apiData.parsed.headers.join(','), ...apiData.parsed.rows.map(r => r.join(','))].join('\n');
    loadFromCSV(csvText, fileName, newJs);
  }, [apiData, fileName, loadFromCSV, projectKey]);

  const cells = useMemo(() => {
    if (!apiData?.parsed?.headers?.length || !apiData.parsed.rows?.length) return [];
    const { headers, rows } = apiData.parsed;
    const analysis = apiData.analysis;
    const leafCol = analysis?.leafCol ?? headers.length - 1;
    const idNoCol = headers.findIndex((h) => /^id\s*no\.?$/i.test(h.trim()));
    const cathodeCol = analysis?.hierCols?.[0]?.j ?? headers.findIndex((h) => /cathode/i.test(h));
    const separatorCol = analysis?.hierCols?.[1]?.j ?? headers.findIndex((h) => /separator/i.test(h));
    const spacerCol = analysis?.hierCols?.[2]?.j ?? headers.findIndex((h) => /spacer/i.test(h));
    return rows.map((row, i) => {
      const cellVal = leafCol >= 0 ? (row[leafCol] ?? '').trim() : '';
      let idNo = i + 1;
      if (idNoCol >= 0 && row[idNoCol] != null) {
        const n = parseInt(String(row[idNoCol]).trim(), 10);
        if (!isNaN(n)) idNo = n;
      } else if (cellVal && /^\d+$/.test(cellVal)) {
        idNo = parseInt(cellVal, 10);
      }
      return {
        idNo,
        cellId: '',
        cellName: cellVal || `Cell ${idNo}`,
        cathode: cathodeCol >= 0 ? (row[cathodeCol] ?? '') : '',
        separatorType: separatorCol >= 0 ? (row[separatorCol] ?? '') : '',
        spacerMm: spacerCol >= 0 ? (parseFloat(row[spacerCol]) || null) : null,
      };
    });
  }, [apiData]);

  const activeJs = apiData?.analysis?.hierCols?.map((c: { j: number }) => c.j) ?? [];

  const hierPath = apiData?.analysis
    ? [
        apiData.analysis.headers?.[apiData.analysis.rootLabelColIdx] ?? 'ROOT',
        ...(apiData.analysis.hierCols ?? []).map(c => c.header),
        apiData.analysis.headers?.[apiData.analysis.leafCol] ?? 'ID',
      ].map(p => (p ?? '').toUpperCase())
    : [];

  function onFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleNewCSV(ev.target?.result as string, file.name);
    reader.readAsText(file);
  }

  function onDrop(e: React.DragEvent) {
    e.preventDefault();
    setDragOver(false);
    const file = e.dataTransfer.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = ev => handleNewCSV(ev.target?.result as string, file.name);
    reader.readAsText(file);
  }

  const treeLayout = useTreeLayout({
    tree: apiData?.tree,
    containerWidth: dims.width,
    containerHeight: dims.height,
    hierColCount: apiData?.analysis?.hierCols?.length ?? 0,
  });

  if (loading && !apiData) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 bg-background">
        <div className="text-[14px] text-muted-foreground">
          Loading hierarchy…
        </div>
      </div>
    );
  }

  const colourMaps = apiData?.colourMaps ?? [];
  const pathToColorMap = apiData?.pathToColorMap
    ? new Map(Object.entries(apiData.pathToColorMap))
    : undefined;

  return (
    <div className="flex flex-col h-full bg-background">
      {/* ── Top bar ───────────────────────────────────────────────────── */}
      <div className="flex items-center gap-6 flex-wrap px-6 py-3 border-b border-border bg-card">
        <div>
          <div className="text-[15px] font-extrabold uppercase tracking-[0.06em] whitespace-nowrap text-foreground">
            {fileName || 'Hierarchy'}
          </div>
          <div className="text-[10px] mt-[3px] whitespace-nowrap text-muted-foreground">
            {apiData?.parsed?.rows?.length ?? 0} rows · backend-driven
          </div>
        </div>

        <div className="text-[10px] tracking-[0.08em] whitespace-nowrap hidden sm:block text-muted-foreground">
          HIERARCHY&nbsp;·&nbsp;
          {hierPath.map((p, i) => (
            <span key={i}>
              {i > 0 && <span className="mx-1.5 text-muted-foreground/80">→</span>}
              {p}
            </span>
          ))}
        </div>

        <div className="ml-auto flex items-center gap-3">
          <button
            className="flex items-center gap-1.5 rounded px-3 py-1.5 text-[10px] tracking-[0.06em] cursor-pointer border border-input bg-background text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            onClick={() => fileRef.current?.click()}
          >
            <Upload className="w-3 h-3" />
            Upload CSV
          </button>
          <input
            ref={fileRef}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={onFileChange}
          />
        </div>

        {colourMaps.length > 0 && (
          <div className="flex gap-4 flex-wrap items-center">
            {Object.entries(colourMaps[0]).map(([val, col]) => (
              <LegendItem key={val} colour={col} label={val} />
            ))}
            <div className="flex items-center gap-[6px] text-[10px] ml-2 text-muted-foreground">
              <svg width="11" height="11" viewBox="0 0 11 11" className="shrink-0 text-amber-600 dark:text-amber-500">
                <circle
                  cx="5.5" cy="5.5" r="4"
                  stroke="currentColor"
                  strokeWidth="1.4"
                  strokeDasharray="2.8,2"
                  fill="currentColor"
                  className="opacity-20"
                />
              </svg>
              Extra / non-standard
            </div>
          </div>
        )}
      </div>

      {apiData && (
        <HierarchyEditor
          allCandidates={apiData.analysis?.allCandidates ?? []}
          activeJs={activeJs}
          onChangeOrder={handleHierarchyReorder}
          onReset={() => {
            if (!apiData?.parsed) return;
            clearHierarchyOrder(projectKey).catch(() => {});
            const csvText = [apiData.parsed.headers.join(','), ...apiData.parsed.rows.map(r => r.join(','))].join('\n');
            loadFromCSV(csvText, fileName, undefined);
          }}
        />
      )}

      {error && (
        <div className="px-6 py-2 text-[11px] bg-destructive/10 text-destructive border-b border-border">
          {error}
        </div>
      )}

      {dragOver && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-background/80 backdrop-blur-sm">
          <div className="text-[18px] font-bold text-foreground">
            Drop CSV here
          </div>
        </div>
      )}

      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative bg-muted/30"
        onDragOver={e => { e.preventDefault(); setDragOver(true); }}
        onDragLeave={() => setDragOver(false)}
        onDrop={onDrop}
      >
        {apiData && treeLayout && (
          <TreeSvg
            analysis={apiData.analysis}
            rows={apiData.parsed.rows}
            tree={apiData.tree}
            layout={treeLayout}
            colourMaps={apiData.colourMaps}
            pathToColorMap={pathToColorMap}
            cells={cells}
            annotationsByCell={annotationsByCell}
            onCellSelect={handleCellSelect}
          />
        )}
      </div>
    </div>
  );
}
