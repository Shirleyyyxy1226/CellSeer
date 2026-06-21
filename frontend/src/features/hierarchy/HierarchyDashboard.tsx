import { useEffect, useMemo, useRef, useState } from 'react';
import { HierarchyEditor } from '@/components/tree/HierarchyEditor';
import { CircuitTreeMindmap } from '@/components/tree/CircuitTreeMindmap';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { collectPreLeafNodeKeys, treeNodeStableKey, type TreeNode } from '@/lib/treeUtils';
import { buildCanonicalCellColorMap, buildPathToColorMap } from '@/lib/ratePerfAggregation';
import type { RatePerfCellRaw } from '@/lib/cellTypes';

/* ── Main panel ─────────────────────────────────────────────────────── */

function OnboardingCallout({ onDismiss }: { onDismiss: () => void }) {
  return (
    <div role="status" className="mx-4 mt-3 flex items-start gap-3 rounded-lg border border-blue-200 bg-blue-50 px-4 py-3 text-[12px] text-blue-900">
      <svg aria-hidden width="16" height="16" viewBox="0 0 24 24" fill="none" className="mt-0.5 shrink-0">
        <circle cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="1.8"/>
        <path d="M12 8v4m0 4h.01" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/>
      </svg>
      <span className="flex-1">
        <strong>Two ways to interact with the tree:</strong>{' '}
        Click a <em>branch</em> (e.g. NMC811) to pre-filter the chart tabs by that condition.{' '}
        Click a <em>leaf cell</em> (the rightmost column) to open its detail panel and drive the curves.
      </span>
      <button type="button" onClick={onDismiss} aria-label="Dismiss tip" className="shrink-0 ml-1 rounded p-0.5 hover:bg-blue-100 transition-colors text-blue-500 hover:text-blue-700">
        <svg aria-hidden width="14" height="14" viewBox="0 0 24 24" fill="none"><path d="M18 6L6 18M6 6l12 12" stroke="currentColor" strokeWidth="2" strokeLinecap="round"/></svg>
      </button>
    </div>
  );
}

export function HierarchyDashboard() {
  const { handleCellSelect, annotationsByCell, multiselectionMode, setMultiselectionMode, selectedCellIds } =
    useCellSelection();
  const { apiData, loading, error, activeJs, setHierarchyOrder, resetHierarchyOrder } =
    useProjectHierarchy();
  const [collapsedPreLeafNodeKeys, setCollapsedPreLeafNodeKeys] = useState<Set<string>>(new Set());
  const [collapsedBranchKeys, setCollapsedBranchKeys] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');
  const tree = (apiData?.tree ?? null) as TreeNode | null;
  const analysis = apiData?.analysis ?? null;
  const [calloutDismissed, setCalloutDismissed] = useState(false);
  const prevSelectedLen = useRef(selectedCellIds.length);
  useEffect(() => {
    if (selectedCellIds.length > 0 && prevSelectedLen.current === 0) {
      setCalloutDismissed(true);
    }
    prevSelectedLen.current = selectedCellIds.length;
  }, [selectedCellIds.length]);
  const [loadTimedOut, setLoadTimedOut] = useState(false);
  useEffect(() => {
    if (!loading || apiData) {
      setLoadTimedOut(false);
      return;
    }
    const t = setTimeout(() => setLoadTimedOut(true), 15_000);
    return () => clearTimeout(t);
  }, [loading, apiData]);

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
    ? buildPathToColorMap(cells as unknown as RatePerfCellRaw[], analysis?.hierCols ?? [])
    : undefined;
  const cellColorMap = cells.length
    ? buildCanonicalCellColorMap(cells as unknown as RatePerfCellRaw[])
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
      {!calloutDismissed && apiData && (
        <OnboardingCallout onDismiss={() => setCalloutDismissed(true)} />
      )}
      {calloutDismissed && apiData && (
        <div className="flex justify-end px-4 pt-1">
          <button type="button" onClick={() => setCalloutDismissed(false)} title="Show interaction tips" aria-label="Show interaction tips" className="rounded-full w-5 h-5 text-[10px] font-bold border border-blue-200 text-blue-500 hover:bg-blue-50 transition-colors flex items-center justify-center">?</button>
        </div>
      )}

      {analysis && (
        <div className="px-4 pt-3 flex items-center gap-2">
          <div className="relative flex-1 max-w-md">
            <span
              className="pointer-events-none absolute inset-y-0 left-2 flex items-center text-muted-foreground"
              aria-hidden
            >
              <svg width="13" height="13" viewBox="0 0 24 24" fill="none">
                <circle cx="11" cy="11" r="7" stroke="currentColor" strokeWidth="1.8" />
                <path d="M20 20l-3.5-3.5" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
              </svg>
            </span>
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              placeholder="Search nodes or cell names…"
              className="w-full h-8 pl-7 pr-2 text-[11px] rounded-md border border-border bg-background placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
            />
          </div>
          <button
            type="button"
            onClick={expandAll}
            className="h-8 px-2.5 text-[10.5px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Expand all
          </button>
          <button
            type="button"
            onClick={collapseAll}
            className="h-8 px-2.5 text-[10.5px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          >
            Collapse all
          </button>
          {/* Single / Multi toggle — mirrors the sidebar control */}
          <div className="flex items-center rounded-md border border-border overflow-hidden ml-1" role="group" aria-label="Selection mode">
            <button
              type="button"
              onClick={() => setMultiselectionMode(false)}
              className={`px-2.5 h-8 text-[10.5px] inline-flex items-center transition-colors ${
                !multiselectionMode
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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
                  : 'text-muted-foreground hover:text-foreground hover:bg-muted'
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
