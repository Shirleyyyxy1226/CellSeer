import { useMemo, useState, useEffect, useCallback } from 'react';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { TreeSvg } from '@/components/tree/TreeSvg';
import { HierarchyEditor } from '@/components/tree/HierarchyEditor';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { getPathFromRootToNode, collectPreLeafNodeKeys, type TreeNode } from '@/lib/treeUtils';
import { buildCanonicalCellColorMap, buildPathToColorMap } from '@/lib/ratePerfAggregation';
import type { IndexCellRaw, RatePerfCellRaw } from '@/lib/cellTypes';
import { useDimensions } from '@/hooks/useDimensions';
import { useTreeLayout } from '@/hooks/useTreeLayout';

interface PublicTreeFilterSidebarProps {
  cells: IndexCellRaw[];
  protocols?: string[];
  protocolFilter?: string;
  onProtocolFilter?: (v: string) => void;
  rateCellsForProtocol?: RatePerfCellRaw[];
}

export function PublicTreeFilterSidebar({
  cells,
  protocols = [],
  protocolFilter = 'All',
  onProtocolFilter,
  rateCellsForProtocol = [],
}: PublicTreeFilterSidebarProps) {
  const {
    handleCellSelect,
    clearSelection,
    multiselectionMode,
    setMultiselectionMode,
    selectedCellIds,
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
  const [collapsedPreLeafNodeKeys, setCollapsedPreLeafNodeKeys] = useState<Set<string>>(new Set());
  const [treeContainerRef, treeDims] = useDimensions<HTMLDivElement>();
  const activeAnalysis = apiData?.analysis ?? null;
  const tree = (apiData?.tree ?? null) as TreeNode | null;
  const treeLayout = useTreeLayout({
    tree,
    containerWidth: treeDims.width,
    containerHeight: treeDims.height,
    hierColCount: activeAnalysis?.hierCols?.length ?? 0,
    collapsedPreLeafNodeKeys,
    compact: true,
    fitContent: true,
  });

  useEffect(() => {
    if (!tree) {
      setCollapsedPreLeafNodeKeys(new Set());
      return;
    }
    // Default: collapse final cell layer parents so sidebar is compact.
    setCollapsedPreLeafNodeKeys(collectPreLeafNodeKeys(tree));
  }, [tree]);

  const pathToColorMap = useMemo(
    () =>
      cells.length
        ? buildPathToColorMap(cells as unknown as RatePerfCellRaw[], activeAnalysis?.hierCols ?? [])
        : new Map<string, string>(),
    [cells, activeAnalysis?.hierCols],
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

  const handleTogglePreLeafNode = useCallback((nodeKey: string) => {
    setCollapsedPreLeafNodeKeys((prev) => {
      const next = new Set(prev);
      if (next.has(nodeKey)) next.delete(nodeKey);
      else next.add(nodeKey);
      return next;
    });
  }, []);

  return (
    <div className="flex flex-col h-full gap-3 overflow-hidden">
      <div className="space-y-2 shrink-0">
        {activeAnalysis && (
          <HierarchyEditor
            allCandidates={activeAnalysis.allCandidates}
            activeJs={activeJs}
            onChangeOrder={(nextJs) => {
              void setHierarchyOrder(nextJs);
            }}
            onReset={() => {
              void resetHierarchyOrder();
            }}
          />
        )}
      </div>

      <div className="flex-1 min-h-0 flex flex-col rounded-md border border-border bg-card overflow-hidden">
        <div className="flex items-center gap-2 p-2 border-b border-border shrink-0">
          <Button
            variant={multiselectionMode ? 'default' : 'outline'}
            size="sm"
            onClick={() => setMultiselectionMode(!multiselectionMode)}
            title="When on, clicking cells adds them to the selection for comparison on the same chart"
          >
            Multiselection
          </Button>
        </div>
        <div ref={treeContainerRef} className="flex-1 min-h-0 overflow-auto p-2">
          {hierarchyError ? (
            <p className="text-sm text-destructive p-4">{hierarchyError}</p>
          ) : tree && activeAnalysis && treeLayout ? (
            <TreeSvg
              analysis={activeAnalysis}
              rows={apiData?.parsed?.rows ?? []}
              tree={tree}
              layout={treeLayout}
              onNodeClick={handleNodeClick}
              compact
              selectedPath={treeFilterPath}
              usePerceptualColors
              cellColorMap={cellColorMap}
              pathToColorMap={pathToColorMap}
              cells={cells as unknown as RatePerfCellRaw[]}
              annotationsByCell={annotationsByCell}
              onCellSelect={handleCellSelect}
              selectedCellIds={selectedCellIds}
              protocolFilteredOutCellIds={protocolFilteredOutCellIds}
              collapsedPreLeafNodeKeys={collapsedPreLeafNodeKeys}
              onTogglePreLeafNode={handleTogglePreLeafNode}
            />
          ) : hierarchyLoading || (tree && !treeLayout) ? (
            <LoadingIndicator
              variant="frame"
              size="md"
              label="Loading hierarchy…"
              className="p-4"
            />
          ) : (
            <p className="text-sm text-muted-foreground p-4">No data yet.</p>
          )}
        </div>
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
