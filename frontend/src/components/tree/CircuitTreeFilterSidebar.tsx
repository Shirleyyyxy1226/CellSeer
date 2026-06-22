/* CircuitTreeFilterSidebar.tsx — sidebar chrome around the new
   CircuitTreeMindmap. Forked from PublicTreeFilterSidebar so that the
   original lives on disk for comparison.

   Visual reference: the "Cell hierarchy filter" card in B_Mini Board —
   header with title + sub-text + stats, GROUP BY chips, search box,
   Single / Multi toggle, expand/collapse, and a footer legend. */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { CircuitTreeMindmap } from '@/components/tree/CircuitTreeMindmap';
import { HierarchyEditor } from '@/components/tree/HierarchyEditor';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import {
  collectPreLeafNodeKeys,
  countLeaves,
  getPathFromRootToNode,
  treeNodeStableKey,
  type TreeNode,
} from '@/lib/treeUtils';
import { buildCanonicalCellColorMap, buildPathToColorMap } from '@/lib/ratePerfAggregation';
import type { IndexCellRaw, RatePerfCellRaw } from '@/lib/cellTypes';

interface CircuitTreeFilterSidebarProps {
  cells: IndexCellRaw[];
  protocols?: string[];
  protocolFilter?: string;
  onProtocolFilter?: (v: string) => void;
  rateCellsForProtocol?: RatePerfCellRaw[];
}

const LINEAGE_DOT = ['#2864c8', '#ce6014', '#c43250', '#3a8a4a'];

function collectAllBranchKeys(root: TreeNode): Set<string> {
  const keys = new Set<string>();
  const walk = (n: TreeNode, path: string[]) => {
    const seg = `${n.colHeader ?? 'root'}=${n.rawVal ?? n.label ?? ''}`;
    const next = [...path, seg];
    if (!n.isLeaf && n.children.length > 0) {
      keys.add(treeNodeStableKey(next));
    }
    n.children.forEach((c) => walk(c, next));
  };
  walk(root, []);
  return keys;
}

export function CircuitTreeFilterSidebar({
  cells,
  protocols = [],
  protocolFilter = 'All',
  onProtocolFilter,
  rateCellsForProtocol = [],
}: CircuitTreeFilterSidebarProps) {
  const {
    handleCellSelect,
    clearSelection,
    multiselectionMode,
    setMultiselectionMode,
    selectedCellIds,
    setSelectedCellIds,
    annotationsByCell,
  } = useCellSelection();
  const { treeFilterPath, setTreeFilterPath } = useTreeFilter();
  const {
    apiData,
    loading: hierarchyLoading,
    error: hierarchyError,
    activeJs,
    setHierarchyOrder,
    resetHierarchyOrder,
  } = useProjectHierarchy();

  const tree = (apiData?.tree ?? null) as TreeNode | null;
  const analysis = apiData?.analysis ?? null;

  const [collapsedPreLeafNodeKeys, setCollapsedPreLeafNodeKeys] = useState<Set<string>>(new Set());
  const [collapsedBranchKeys, setCollapsedBranchKeys] = useState<Set<string>>(new Set());
  const [searchQuery, setSearchQuery] = useState('');

  useEffect(() => {
    if (!tree) {
      setCollapsedPreLeafNodeKeys(new Set());
      setCollapsedBranchKeys(new Set());
      return;
    }
    setCollapsedPreLeafNodeKeys(collectPreLeafNodeKeys(tree));
    setCollapsedBranchKeys(new Set());
  }, [tree]);

  const pathToColorMap = useMemo(
    () =>
      cells.length
        ? buildPathToColorMap(cells as unknown as RatePerfCellRaw[], analysis?.hierCols ?? [])
        : new Map<string, string>(),
    [cells, analysis?.hierCols],
  );

  const cellColorMap = useMemo(
    () =>
      cells.length
        ? buildCanonicalCellColorMap(cells as unknown as RatePerfCellRaw[])
        : new Map<string, string>(),
    [cells],
  );

  const protocolFilteredOutCellIds = useMemo(() => {
    // Faded-leaf treatment for cells whose protocol doesn't match the
    // currently selected protocol filter — grey label + lower opacity.
    const out = new Set<number>();
    if (rateCellsForProtocol.length && protocolFilter !== 'All') {
      for (const c of rateCellsForProtocol) {
        if (c.protocol !== protocolFilter) out.add(c.idNo);
      }
    }
    return out;
  }, [rateCellsForProtocol, protocolFilter]);

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

  // Multi mode: clicking a group (non-leaf) node toggles selection of every
  // cell under it — add them all, or clear them all if already fully selected —
  // so the group checkbox reflects the selected state.
  const handleGroupToggle = useCallback(
    (cellIds: number[]) => {
      console.log('[groupToggle] cellIds:', cellIds.length, cellIds.slice(0, 5), 'prevSelected:', selectedCellIds.length);
      if (!cellIds.length) return;
      const next = new Set(selectedCellIds);
      const allSelected = cellIds.every((id) => next.has(id));
      if (allSelected) cellIds.forEach((id) => next.delete(id));
      else cellIds.forEach((id) => next.add(id));
      setSelectedCellIds([...next]);
    },
    [selectedCellIds, setSelectedCellIds],
  );

  const handleTogglePreLeafNode = useCallback((nodeKey: string) => {
    setCollapsedPreLeafNodeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  }, []);

  const handleToggleBranchNode = useCallback((nodeKey: string) => {
    setCollapsedBranchKeys((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  }, []);

  const expandAll = useCallback(() => {
    setCollapsedPreLeafNodeKeys(new Set());
    setCollapsedBranchKeys(new Set());
  }, []);

  const collapseAll = useCallback(() => {
    if (!tree) return;
    setCollapsedBranchKeys(collectAllBranchKeys(tree));
    setCollapsedPreLeafNodeKeys(collectPreLeafNodeKeys(tree));
  }, [tree]);

  const totalCells = tree ? countLeaves(tree) : 0;
  const selectedCount = selectedCellIds.length;

  return (
    <div className="flex flex-col h-full gap-2 overflow-hidden">
      {/* Compact stats strip — replaces the bigger title card */}
      <div className="shrink-0 flex items-center justify-end gap-3 px-1">
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] tracking-[0.12em] uppercase text-muted-foreground">
            Selected
          </span>
          <span className="text-[12px] font-semibold text-foreground tabular-nums">
            {selectedCount}
          </span>
        </div>
        <div className="w-px h-3.5 bg-border" />
        <div className="flex items-baseline gap-1.5">
          <span className="text-[11px] tracking-[0.12em] uppercase text-muted-foreground">
            Cells
          </span>
          <span className="text-[12px] font-semibold text-foreground tabular-nums">
            {totalCells}
          </span>
        </div>
      </div>

      {/* GROUP BY editor (existing component, slight chrome wrap) */}
      {analysis && (
        <div className="shrink-0">
          <HierarchyEditor
            allCandidates={analysis.allCandidates}
            activeJs={activeJs}
            onChangeOrder={(nextJs) => {
              void setHierarchyOrder(nextJs);
            }}
            onReset={() => {
              void resetHierarchyOrder();
            }}
          />
        </div>
      )}

      {/* Search + actions row */}
      <div className="shrink-0 flex items-center gap-2">
        <div className="relative flex-1 min-w-0">
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
          title="Expand all"
        >
          Expand all
        </button>
        <button
          type="button"
          onClick={collapseAll}
          className="h-8 px-2.5 text-[10.5px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
          title="Collapse all"
        >
          Collapse all
        </button>
      </div>

      {/* Single / Multi toggle row */}
      <div className="shrink-0 flex items-center gap-2">
        <span className="text-[11px] tracking-[0.12em] uppercase text-muted-foreground">
          Select
        </span>
        <div className="flex items-center rounded-md border border-border overflow-hidden">
          <button
            type="button"
            onClick={() => setMultiselectionMode(false)}
            className={`px-2.5 h-7 text-[11px] inline-flex items-center gap-1.5 transition-colors ${
              !multiselectionMode
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            aria-pressed={!multiselectionMode}
          >
            <span
              aria-hidden
              className={`inline-block w-2.5 h-2.5 rounded-full border ${
                !multiselectionMode
                  ? 'bg-primary-foreground border-primary-foreground'
                  : 'border-muted-foreground/60'
              }`}
            />
            Single
          </button>
          <button
            type="button"
            onClick={() => setMultiselectionMode(true)}
            className={`px-2.5 h-7 text-[11px] inline-flex items-center gap-1.5 border-l border-border transition-colors ${
              multiselectionMode
                ? 'bg-primary text-primary-foreground'
                : 'text-muted-foreground hover:text-foreground hover:bg-muted'
            }`}
            aria-pressed={multiselectionMode}
          >
            <span
              aria-hidden
              className={`inline-block w-2.5 h-2.5 rounded-sm border ${
                multiselectionMode
                  ? 'bg-primary-foreground border-primary-foreground'
                  : 'border-muted-foreground/60'
              }`}
            />
            Multi
          </button>
        </div>
      </div>

      {/* Tree body */}
      <div className="flex-1 min-h-0 flex flex-col rounded-md border border-border bg-card overflow-hidden">
        <div className="flex-1 min-h-0 overflow-auto px-2 pt-1 pb-3">
          {hierarchyError ? (
            <p className="text-sm text-destructive p-4">{hierarchyError}</p>
          ) : tree && analysis ? (
            <CircuitTreeMindmap
              analysis={analysis}
              rows={apiData?.parsed?.rows ?? []}
              tree={tree}
              onNodeClick={handleNodeClick}
              onGroupToggle={handleGroupToggle}
              selectedPath={treeFilterPath}
              multiselectionMode={multiselectionMode}
              selectedCellIds={selectedCellIds}
              pathToColorMap={pathToColorMap}
              cellColorMap={cellColorMap}
              usePerceptualColors
              cells={cells as unknown as RatePerfCellRaw[]}
              annotationsByCell={annotationsByCell}
              onCellSelect={handleCellSelect}
              protocolFilteredOutCellIds={protocolFilteredOutCellIds}
              collapsedPreLeafNodeKeys={collapsedPreLeafNodeKeys}
              onTogglePreLeafNode={handleTogglePreLeafNode}
              collapsedBranchNodeKeys={collapsedBranchKeys}
              onToggleBranchNode={handleToggleBranchNode}
              searchQuery={searchQuery}
              compact
            />
          ) : hierarchyLoading ? (
            <LoadingIndicator variant="frame" size="md" label="Loading hierarchy…" className="p-4" />
          ) : (
            <p className="text-sm text-muted-foreground p-4">No data yet.</p>
          )}
        </div>

        {/* Footer legend */}
        {analysis && analysis.hierCols.length > 0 && (
          <div className="shrink-0 flex items-center gap-2 px-3 py-1.5 border-t border-border bg-muted/30 text-[10px] text-muted-foreground">
            <div className="flex items-center gap-3 min-w-0 overflow-hidden">
              {analysis.hierCols.slice(0, 4).map((c, i) => (
                <span key={c.j} className="inline-flex items-center gap-1.5 whitespace-nowrap">
                  <span
                    aria-hidden
                    className="inline-block w-2 h-2 rounded-full"
                    style={{ background: LINEAGE_DOT[i % LINEAGE_DOT.length] }}
                  />
                  <span>{c.header}</span>
                </span>
              ))}
            </div>
          </div>
        )}
      </div>

      {protocols.length > 0 && !!onProtocolFilter && (
        <div className="space-y-2 shrink-0">
          <Label className="text-xs text-muted-foreground">Protocol</Label>
          <Select value={protocolFilter} onValueChange={onProtocolFilter}>
            <SelectTrigger className="h-9 w-full text-xs">
              <SelectValue placeholder="All protocols" />
            </SelectTrigger>
            <SelectContent className="min-w-[200px]">
              <SelectItem value="All">All protocols</SelectItem>
              {protocols.map((p) => (
                <SelectItem key={p} value={p}>
                  {p.length > 50 ? p.slice(0, 47) + '...' : p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}

export default CircuitTreeFilterSidebar;
