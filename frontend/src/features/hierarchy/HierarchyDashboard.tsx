import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { HierarchyEditor } from '@/components/tree/HierarchyEditor';
import { CircuitTreeMindmap } from '@/components/tree/CircuitTreeMindmap';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { SearchInput } from '@/components/SearchInput';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { collectPreLeafNodeKeys, getPathFromRootToNode, treeNodeStableKey, type TreeNode } from '@/lib/treeUtils';
import { buildCanonicalCellColorMap, buildPathToColorMap } from '@/lib/plot/ratePerfAggregation';
import type { RatePerfCell } from '@/lib/cell/cellTypes';

/* ── Main panel ─────────────────────────────────────────────────────── */

export function HierarchyDashboard() {
  const { handleCellSelect, clearSelection, annotationsByCell, multiselectionMode, setMultiselectionMode, selectedCellIds, setSelectedCellIds } =
    useCellSelection();
  const { treeFilterPath, setTreeFilterPath } = useTreeFilter();
  const { apiData, loading, error, activeJs, setHierarchyOrder, resetHierarchyOrder, reloadHierarchy } =
    useProjectHierarchy();
  const [collapsedPreLeafNodeKeys, setCollapsedPreLeafNodeKeys] = useState<Set<string>>(new Set());
  const [collapsedBranchKeys, setCollapsedBranchKeys] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const tree = (apiData?.tree ?? null) as TreeNode | null;
  const analysis = apiData?.analysis ?? null;

  const handleNodeClick = useCallback(
    (node: TreeNode) => {
      if (!tree) return;
      const path = getPathFromRootToNode(tree, node);
      if (multiselectionMode && node.isLeaf) return;
      setTreeFilterPath(path ?? []);
      if (!node.isLeaf) {
        clearSelection();
      }
    },
    [tree, multiselectionMode, setTreeFilterPath, clearSelection],
  );

  // Multi mode: clicking a group node toggles selection of every cell under it.
  const handleGroupToggle = useCallback(
    (cellIds: number[]) => {
      if (!cellIds.length) return;
      const next = new Set(selectedCellIds);
      const allSelected = cellIds.every((id) => next.has(id));
      if (allSelected) cellIds.forEach((id) => next.delete(id));
      else cellIds.forEach((id) => next.add(id));
      setSelectedCellIds([...next]);
    },
    [selectedCellIds, setSelectedCellIds],
  );
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  useEffect(() => {
    if (!loading || apiData) {
      setLoadTimedOut(false);
      return;
    }
    const t = setTimeout(() => setLoadTimedOut(true), 15_000);
    return () => clearTimeout(t);
  }, [loading, apiData]);

  const [refreshStatus, setRefreshStatus] = useState<{ ok: boolean; total: number; time: string } | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const manualRefreshPendingRef = useRef(false);

  const handleRefresh = useCallback(() => {
    manualRefreshPendingRef.current = true;
    setRefreshing(true);
    setRefreshStatus(null);
    void reloadHierarchy();
  }, [reloadHierarchy]);

  const rowCount = apiData?.parsed?.rows?.length ?? 0;
  const prevLoadingRef = useRef(loading);
  useEffect(() => {
    const wasLoading = prevLoadingRef.current;
    prevLoadingRef.current = loading;
    if (!manualRefreshPendingRef.current) return;
    if (wasLoading && !loading) {
      manualRefreshPendingRef.current = false;
      setRefreshing(false);
      const total = rowCount;
      const time = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setRefreshStatus({ ok: !error, total, time });
    }
  }, [loading, rowCount, error]);

  useEffect(() => {
    if (!tree) {
      setCollapsedPreLeafNodeKeys(new Set());
      setCollapsedBranchKeys(new Set());
      return;
    }
    // Keep full-page tree readable by collapsing pre-leaf groups by default.
    setCollapsedPreLeafNodeKeys(collectPreLeafNodeKeys(tree));
    setCollapsedBranchKeys(new Set());
  }, [tree]);

  const cells = useMemo(() => {
    if (!apiData?.parsed?.headers?.length || !apiData.parsed.rows?.length) return [];
    const { headers, rows } = apiData.parsed;
    const an = apiData.analysis;
    const leafCol = an?.leafCol ?? headers.length - 1;
    const idNoCol = headers.findIndex((h) => /^id\s*no\.?$/i.test(h.trim()));
    // Resolve attribute columns by header name first: hierCols order follows the
    // user's hierarchy arrangement, and cell colours must not change with it.
    const byHeader = (re: RegExp, hierIdx: number) => {
      const j = headers.findIndex((h) => re.test(h));
      return j >= 0 ? j : an?.hierCols?.[hierIdx]?.j ?? -1;
    };
    const cathodeCol = byHeader(/cathode/i, 0);
    const separatorCol = byHeader(/separator/i, 1);
    const spacerCol = byHeader(/spacer/i, 2);
    return rows.map((row, i) => {
      const cellVal = leafCol >= 0 ? (row[leafCol] ?? '').trim() : '';
      let idNo = i + 1;
      if (idNoCol >= 0 && row[idNoCol] != null) {
        const n = parseInt(String(row[idNoCol]).trim(), 10);
        if (!isNaN(n) && n > 0) idNo = n;
      } else if (cellVal && /^\d+$/.test(cellVal)) {
        idNo = parseInt(cellVal, 10);
      }
      // Include all hierCol values keyed by header so buildPathToColorMap
      // produces path keys that match the tree's rawVal-based lookup.
      const hierColVals: Record<string, string> = {};
      (an?.hierCols ?? []).forEach(col => {
        if (col.j >= 0 && col.j < row.length) {
          hierColVals[col.header] = String(row[col.j] ?? '').trim();
        }
      });
      return {
        idNo,
        cellId: '',
        cellName: cellVal || `Cell ${idNo}`,
        cathode: cathodeCol >= 0 ? (row[cathodeCol] ?? '') : '',
        separatorType: separatorCol >= 0 ? (row[separatorCol] ?? '') : '',
        spacerMm: spacerCol >= 0 ? (parseFloat(row[spacerCol]) || null) : null,
        ...hierColVals,
      };
    });
  }, [apiData]);

  if (loading && !apiData) {
    if (loadTimedOut || error) {
      return (
        <div className="flex flex-col h-full items-center justify-center gap-4 bg-background">
          <p className="text-[13px] text-destructive">
            {error ?? 'Hierarchy is taking too long to load.'}
          </p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            className="px-4 py-1.5 rounded-md border border-border text-[12px] text-foreground hover:bg-muted transition-colors"
          >
            Retry
          </button>
        </div>
      );
    }
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 bg-background">
        <LoadingIndicator variant="frame" size="md" label="Loading hierarchy…" />
      </div>
    );
  }

  const pathToColorMap = cells.length
    ? buildPathToColorMap(cells as unknown as RatePerfCell[], analysis?.hierCols ?? [])
    : undefined;
  const cellColorMap = cells.length
    ? buildCanonicalCellColorMap(cells as unknown as RatePerfCell[])
    : undefined;

  const collapseAll = () => {
    if (!tree) return;
    const keys = new Set<string>();
    const walk = (n: TreeNode, path: string[]) => {
      const seg = `${n.colHeader ?? 'root'}=${n.rawVal ?? n.label ?? ''}`;
      const next = [...path, seg];
      if (!n.isLeaf && n.children.length > 0) keys.add(treeNodeStableKey(next));
      n.children.forEach((c) => walk(c, next));
    };
    walk(tree, []);
    setCollapsedBranchKeys(keys);
    setCollapsedPreLeafNodeKeys(collectPreLeafNodeKeys(tree));
  };

  const expandAll = () => {
    setCollapsedBranchKeys(new Set());
    setCollapsedPreLeafNodeKeys(new Set());
  };

  return (
    <div className="flex flex-col h-full bg-background">
      {apiData && (
        <HierarchyEditor
          allCandidates={apiData.analysis?.allCandidates ?? []}
          activeJs={activeJs}
          onChangeOrder={(newJs) => {
            void setHierarchyOrder(newJs);
          }}
          onReset={() => {
            void resetHierarchyOrder();
          }}
        />
      )}

      {error && (
        <div className="px-6 py-2 text-[11px] bg-destructive/10 text-destructive border-b border-border">
          {error}
        </div>
      )}

      {/* Onboarding callout: show until dismissed or first selection */}
      {analysis && (
        <div className="px-4 pt-3 flex items-center gap-2">
          <SearchInput
            collapsible
            value={searchQuery}
            onChange={setSearchQuery}
            placeholder="Search nodes or cell names…"
            widthClass="w-64"
          />
          <button
            type="button"
            onClick={expandAll}
            className={`h-8 px-2.5 text-[10.5px] rounded-md border border-input shadow-sm transition-colors ${
              collapsedBranchKeys.size === 0 && collapsedPreLeafNodeKeys.size === 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className={`h-8 px-2.5 text-[10.5px] rounded-md border border-input shadow-sm transition-colors ${
              collapsedBranchKeys.size > 0 || collapsedPreLeafNodeKeys.size > 0
                ? 'bg-primary text-primary-foreground'
                : 'bg-muted text-muted-foreground hover:text-foreground'
            }`}
          >
            Collapse all
          </button>
          <button type="button" onClick={() => { void handleRefresh(); }} disabled={refreshing} title="Refresh hierarchy"
            className="h-8 px-2.5 text-[10.5px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors inline-flex items-center gap-1.5 disabled:opacity-50">
            <svg aria-hidden width="12" height="12" viewBox="0 0 24 24" fill="none" className={refreshing ? 'animate-spin' : ''}>
              <path d="M21 12a9 9 0 11-9-9c2.52 0 4.93 1 6.74 2.74L21 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
              <path d="M21 3v5h-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
            Refresh
          </button>
          {refreshStatus && !refreshStatus.ok && (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-destructive/10 text-destructive border border-destructive/20">Refresh failed</span>
          )}
          {refreshStatus && refreshStatus.ok && (
            <span className="inline-flex items-center rounded-md px-2 py-0.5 text-[11px] font-medium bg-emerald-50 text-emerald-700 border border-emerald-200 dark:bg-emerald-950/30 dark:text-emerald-400 dark:border-emerald-800">✓ {refreshStatus.total > 0 ? `${refreshStatus.total} cells · ` : ''}{refreshStatus.time}</span>
          )}
          {/* Single / Multi toggle — mirrors the sidebar control */}
          <div className="flex items-center rounded-md border border-input shadow-sm overflow-hidden ml-1" role="group" aria-label="Selection mode">
            <button
              type="button"
              onClick={() => setMultiselectionMode(false)}
              className={`px-2.5 h-8 text-[10.5px] inline-flex items-center transition-colors ${
                !multiselectionMode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={!multiselectionMode}
            >
              Single
            </button>
            <button
              type="button"
              onClick={() => setMultiselectionMode(true)}
              className={`px-2.5 h-8 text-[10.5px] inline-flex items-center border-l border-border transition-colors ${
                multiselectionMode
                  ? 'bg-primary text-primary-foreground'
                  : 'bg-muted text-muted-foreground hover:text-foreground'
              }`}
              aria-pressed={multiselectionMode}
            >
              Multi
            </button>
          </div>
        </div>
      )}

      <div className="flex-1 overflow-auto relative bg-muted/30 px-4 py-3">
        {apiData && tree && analysis && (
          <CircuitTreeMindmap
            analysis={analysis}
            rows={apiData.parsed.rows}
            tree={tree}
            cells={cells}
            annotationsByCell={annotationsByCell}
            onCellSelect={handleCellSelect}
            onNodeClick={handleNodeClick}
            onGroupToggle={handleGroupToggle}
            selectedPath={treeFilterPath}
            multiselectionMode={multiselectionMode}
            selectedCellIds={selectedCellIds}
            pathToColorMap={pathToColorMap}
            cellColorMap={cellColorMap}
            usePerceptualColors
            collapsedPreLeafNodeKeys={collapsedPreLeafNodeKeys}
            onTogglePreLeafNode={(nodeKey) => {
              setCollapsedPreLeafNodeKeys((prev) => {
                const next = new Set(prev);
                if (next.has(nodeKey)) next.delete(nodeKey);
                else next.add(nodeKey);
                return next;
              });
            }}
            collapsedBranchNodeKeys={collapsedBranchKeys}
            onToggleBranchNode={(nodeKey) => {
              setCollapsedBranchKeys((prev) => {
                const next = new Set(prev);
                if (next.has(nodeKey)) next.delete(nodeKey);
                else next.add(nodeKey);
                return next;
              });
            }}
            searchQuery={searchQuery}
          />
        )}
      </div>
    </div>
  );
}
