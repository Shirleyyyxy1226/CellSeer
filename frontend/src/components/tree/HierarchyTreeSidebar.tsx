import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronRight, ChevronDown, StickyNote, Tag } from 'lucide-react';
import { HierarchyEditor } from '@/components/tree/HierarchyEditor';
import { useHierarchyFromApi } from '@/hooks/useHierarchyFromApi';
import { getPathFromRootToNode, TreeNode, ParsedCSV } from '@/lib/treeUtils';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

/** Path from root to selected node: filters to apply */
export type TreeFilterPath = Array<{ header: string; val: string }>;

/** Map tree column header to NewareCell field name */
const HEADER_TO_FIELD: Record<string, string> = {
  'Cathode': 'cathode',
  'Separator Type': 'separatorType',
  'Separator_Type': 'separatorType',
  'Spacer (mm)': 'spacerMm',
  'Spacer_mm': 'spacerMm',
  'Spacer': 'spacerMm',
  'Cell': 'cellName',
};

/** Filter cells by tree path (exported for use in parent) */
export function filterCellsByTreePath<T extends { cathode: string; separatorType: string; spacerMm: number | null }>(
  cells: T[],
  path: TreeFilterPath
): T[] {
  if (path.length === 0) return cells;
  return cells.filter((c) => {
    for (const { header, val } of path) {
      const matchVal = val === '(unknown)' ? '' : String(val).trim();
      // For 'Cell' header, match cellName, cellId, or "Cell {idNo}" (cells may use different identifiers)
      if (header === 'Cell' || HEADER_TO_FIELD[header] === 'cellName') {
        const cRecord = c as Record<string, unknown>;
        const cellName = String(cRecord.cellName ?? '').trim();
        const cellId = String(cRecord.cellId ?? '').trim();
        const idNo = cRecord.idNo as number | undefined;
        const cellFallback = idNo != null ? `Cell ${idNo}`.trim() : '';
        const matches =
          cellName === matchVal ||
          cellId === matchVal ||
          cellFallback === matchVal;
        if (!matches) return false;
        continue;
      }
      const field = HEADER_TO_FIELD[header] ?? header.toLowerCase().replace(/\s+/g, '');
      let cellVal: string | number | null = (c as Record<string, unknown>)[field] as string | number | null;
      if (cellVal === undefined) return false;
      const cellValStr = cellVal === null ? '' : String(cellVal).trim();
      // For numeric fields (e.g. spacerMm), match "1.5", "1.50", or "sp1.0mm" (extract number)
      const numA = parseFloat(cellValStr);
      const numMatch = matchVal.match(/-?\d+(\.\d+)?/);
      const numB = numMatch ? parseFloat(numMatch[0]) : parseFloat(matchVal);
      if (!Number.isNaN(numA) && !Number.isNaN(numB) && Math.abs(numA - numB) < 1e-9) continue;
      if (cellValStr !== matchVal) return false;
    }
    return true;
  });
}

import type { IndexCellRaw as NewareCell } from '@/lib/cellTypes';

interface HierarchyTreeSidebarProps {
  cells: NewareCell[];
  protocols: string[];
  protocolFilter: string;
  onProtocolFilter: (v: string) => void;
  onTreeFilterChange: (path: TreeFilterPath) => void;
}

function cellMatchesPath(cell: NewareCell, path: TreeFilterPath): boolean {
  return filterCellsByTreePath([cell], path).length > 0;
}

/** Resolve leaf node to cell (same logic as TreeSidebarNode) */
function resolveCellFromNode(node: TreeNode, cells: NewareCell[]): NewareCell | null {
  if (!node.isLeaf || (!node.rawVal && !node.rowData)) return null;
  if (node.rowData && node.rowData.length >= 4) {
    const match = cells.find((c) => {
      const expected = [c.cathode || '', c.separatorType || '', String(c.spacerMm ?? ''), c.cellName || `Cell ${c.idNo}`];
      return expected.every((v, j) => String(v).trim() === String(node.rowData?.[j] ?? '').trim());
    });
    if (match) return match;
    const cellVal = String(node.rowData[node.rowData.length - 1] ?? '').trim();
    if (cellVal) return cells.find((c) => (c.cellName || `Cell ${c.idNo}`).trim() === cellVal) ?? null;
  }
  if (node.cellId) return cells.find((c) => c.cellId === node.cellId || c.cellName === node.cellId) ?? null;
  const raw = String(node.rawVal ?? '').trim();
  let match = cells.find((c) => (c.cellName || `Cell ${c.idNo}`).trim() === raw);
  if (!match && raw) {
    const idMatch = raw.match(/^Cell\s*(\d+)$/i) ?? raw.match(/^(\d+)$/);
    if (idMatch) {
      const idNo = parseInt(idMatch[1], 10);
      match = cells.find((c) => c.idNo === idNo) ?? null;
    }
  }
  return match ?? null;
}

function TreeSidebarNode({
  node,
  depth,
  colourMap,
  selectedPath,
  selectedCellIds,
  onSelect,
  expanded,
  onToggle,
  annotationsByCell,
  cells,
}: {
  node: TreeNode;
  depth: number;
  colourMap: Record<string, string>[];
  selectedPath: TreeFilterPath;
  selectedCellIds?: number[];
  onSelect: (n: TreeNode, event?: React.MouseEvent) => void;
  expanded: Set<string>;
  onToggle: (key: string) => void;
  annotationsByCell: Record<number, { note?: string | null; tags?: string[] }>;
  cells: NewareCell[];
}) {
  const key = depth + ':' + (node.rawVal ?? '') + ':' + (node.colHeader ?? '');
  const isExpanded = expanded.has(key);
  const colour = node.depth > 0 && !node.isLeaf && colourMap[node.depth - 1]
    ? colourMap[node.depth - 1][node.rawVal] ?? '#888'
    : '#6b7280';
  const childCount = node.children.length;
  const hasChildren = childCount > 0;

  const cell = node.isLeaf && (node.rawVal != null || node.rowData) ? (() => {
    if (node.rowData && node.rowData.length >= 4) {
      const match = cells.find((c) => {
        const expected = [c.cathode || '', c.separatorType || '', String(c.spacerMm ?? ''), c.cellName || `Cell ${c.idNo}`];
        return expected.every((v, j) => String(v).trim() === String(node.rowData?.[j] ?? '').trim());
      });
      if (match) return match;
      const cellVal = String(node.rowData[node.rowData.length - 1] ?? '').trim();
      if (cellVal) return cells.find((c) => (c.cellName || `Cell ${c.idNo}`).trim() === cellVal) ?? null;
    }
    if (node.cellId) return cells.find((c) => c.cellId === node.cellId || c.cellName === node.cellId) ?? null;
    const raw = String(node.rawVal ?? '').trim();
    let match = cells.find((c) => (c.cellName || `Cell ${c.idNo}`).trim() === raw);
    if (!match && raw) {
      const idMatch = raw.match(/^Cell\s*(\d+)$/i) ?? raw.match(/^(\d+)$/);
      if (idMatch) {
        const idNo = parseInt(idMatch[1], 10);
        match = cells.find((c) => c.idNo === idNo) ?? null;
      }
    }
    return match ?? null;
  })() : null;
  const isSelected = !!cell && selectedCellIds?.length && selectedCellIds.includes(cell.idNo);
  const isUnselectedInMultiselect = !!selectedCellIds?.length && node.isLeaf && !isSelected;

  const handleClick = useCallback(
    (e: React.MouseEvent) => {
      e.stopPropagation();
      if (node.isLeaf) {
        onSelect(node, e);
      } else {
        onToggle(key);
        onSelect(node, e);
      }
    },
    [node, key, onSelect, onToggle]
  );

  return (
    <div className="select-none">
      <button
        type="button"
        onClick={handleClick}
        className={`w-full flex items-center gap-1.5 py-1.5 pr-2 text-left hover:bg-muted/60 rounded text-sm ${isSelected ? 'bg-accent/30 ring-1 ring-primary/50' : ''} ${isUnselectedInMultiselect ? 'opacity-25 text-muted-foreground' : ''}`}
        style={{ paddingLeft: depth * 12 + 4 }}
      >
        {hasChildren && !node.isLeaf ? (
          <span
            className="shrink-0 w-4 h-4 flex items-center justify-center"
            onClick={(e) => { e.stopPropagation(); onToggle(key); }}
          >
            {isExpanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </span>
        ) : (
          <span className="w-4 shrink-0" />
        )}
        {!node.isLeaf && node.depth > 0 && (
          <span
            className="shrink-0 rounded-full w-2 h-2"
            style={{ background: colour }}
          />
        )}
        <span className={`truncate flex items-center gap-1 ${isUnselectedInMultiselect ? 'text-muted-foreground' : 'text-foreground'}`}>
          {node.label}
          {!node.isLeaf && childCount > 0 && (
            <span className="text-muted-foreground ml-1">({childCount})</span>
          )}
          {node.isLeaf && (node.rawVal != null || node.rowData) && (() => {
            const cell: NewareCell | undefined = (() => {
              // 1. Match by full rowData (most reliable - same CSV we sent)
              if (node.rowData && node.rowData.length >= 4) {
                const match = cells.find((c) => {
                  const expected = [
                    c.cathode || '',
                    c.separatorType || '',
                    String(c.spacerMm ?? ''),
                    c.cellName || `Cell ${c.idNo}`,
                  ];
                  return expected.every((v, j) => String(v).trim() === String(node.rowData?.[j] ?? '').trim());
                });
                if (match) return match;
                // Fallback: match by last column (Cell) only - backend may reorder columns
                const cellVal = String(node.rowData[node.rowData.length - 1] ?? '').trim();
                if (cellVal) {
                  const byLastCol = cells.find(
                    (c) => (c.cellName || `Cell ${c.idNo}`).trim() === cellVal
                  );
                  if (byLastCol) return byLastCol;
                }
              }
              // 2. Match by cellId from backend
              if (node.cellId) {
                const byCellId = cells.find((c) => c.cellId === node.cellId || c.cellName === node.cellId);
                if (byCellId) return byCellId;
              }
              // 3. Match by rawVal (leaf label)
              const raw = String(node.rawVal ?? '').trim();
              let match = cells.find((c) => (c.cellName || `Cell ${c.idNo}`).trim() === raw);
              if (!match && raw) {
                const idMatch = raw.match(/^Cell\s*(\d+)$/i) ?? raw.match(/^(\d+)$/);
                if (idMatch) {
                  const idNo = parseInt(idMatch[1], 10);
                  match = cells.find((c) => c.idNo === idNo);
                }
              }
              return match;
            })();
            const ann = cell ? annotationsByCell[cell.idNo] : null;
            const hasNote = ann?.note != null && String(ann.note).trim() !== '';
            const hasTags = (ann?.tags?.length ?? 0) > 0;
            if (!hasNote && !hasTags) return null;
            return (
              <span className="shrink-0 flex items-center gap-0.5 text-muted-foreground" title="Click to view details">
                {hasNote && <StickyNote className="w-3 h-3" />}
                {hasTags && <Tag className="w-3 h-3" />}
              </span>
            );
          })()}
        </span>
      </button>
      {hasChildren && isExpanded && (
        <div className="border-l border-border/50 ml-2">
          {node.children.map((child, i) => (
            <TreeSidebarNode
              key={i}
              node={child}
              depth={depth + 1}
              colourMap={colourMap}
              selectedPath={selectedPath}
              selectedCellIds={selectedCellIds}
              onSelect={onSelect}
              expanded={expanded}
              onToggle={onToggle}
              annotationsByCell={annotationsByCell}
              cells={cells}
            />
          ))}
        </div>
      )}
    </div>
  );
}

export function HierarchyTreeSidebar({
  cells,
  protocols,
  protocolFilter,
  onProtocolFilter,
  onTreeFilterChange,
}: HierarchyTreeSidebarProps) {
  const { handleCellSelect, clearSelection, multiselectionMode, setMultiselectionMode, selectedCellIds, annotationsByCell } = useCellSelection();
  const [expanded, setExpanded] = useState<Set<string>>(new Set(['0:Root:']));
  const [selectedPath, setSelectedPath] = useState<TreeFilterPath>([]);
  const [treeVersion, setTreeVersion] = useState(0);
  const selectionKey = selectedCellIds?.join(',') ?? '';
  // Force tree remount when selection changes so it updates immediately (fixes stale display on unselect)
  useEffect(() => {
    setTreeVersion((v) => v + 1);
  }, [selectionKey]);

  const csvData = useMemo<ParsedCSV>(() => {
    const headers = ['Cathode', 'Separator Type', 'Spacer (mm)', 'Cell'];
    const rows = cells.map((c) => [
      c.cathode || '',
      c.separatorType || '',
      String(c.spacerMm ?? ''),
      c.cellName || `Cell ${c.idNo}`,
    ]);
    return { headers, rows };
  }, [cells]);

  const [activeJs, setActiveJs] = useState<number[]>([]);

  const {
    analysis: activeAnalysis,
    tree,
    colourMaps,
    loading: hierarchyLoading,
    error: hierarchyError,
  } = useHierarchyFromApi(cells.length > 0 ? csvData : null, activeJs);

  const baseAnalysis = activeAnalysis;

  useEffect(() => {
    if (activeAnalysis?.hierCols?.length && activeJs.length === 0) {
      setActiveJs(activeAnalysis.hierCols.map((c) => c.j));
    }
  }, [activeAnalysis?.hierCols, activeJs.length]);

  const handleSelectNode = useCallback(
    (node: TreeNode, event?: React.MouseEvent) => {
      if (!tree) return;
      const path = getPathFromRootToNode(tree, node);
      const p = path ?? [];
      // When multiselection is on and clicking a leaf, only update selection (don't change tree path)
      // so the chart filters purely by selectedCellIds
      if (!multiselectionMode || !node.isLeaf) {
        setSelectedPath(p);
        onTreeFilterChange(p);
      }
      if (node.isLeaf) {
        const cell = resolveCellFromNode(node, cells);
        if (cell) handleCellSelect(cell.idNo, event?.nativeEvent);
      } else {
        // Clicking a branch: clear cell selection so CellDetailPanel doesn't show
        clearSelection();
      }
    },
    [tree, onTreeFilterChange, cells, handleCellSelect, clearSelection, multiselectionMode],
  );

  const handleToggle = useCallback((key: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const filteredByTree = useMemo(() => {
    return selectedPath.length === 0
      ? cells
      : cells.filter((c) => cellMatchesPath(c, selectedPath));
  }, [cells, selectedPath]);

  return (
    <div className="flex flex-col h-full gap-3">
      <h3 className="font-semibold text-sm text-foreground">Filters</h3>

      {/* Hierarchy order */}
      {baseAnalysis && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Hierarchy order</Label>
          <HierarchyEditor
            allCandidates={baseAnalysis.allCandidates}
            activeJs={activeJs}
            onChangeOrder={setActiveJs}
            onReset={() => setActiveJs(baseAnalysis.hierCols.map((c) => c.j))}
          />
        </div>
      )}

      {/* Tree */}
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
        <div className="flex-1 min-h-0 overflow-y-auto p-2">
        {hierarchyError ? (
          <p className="text-sm text-destructive p-4">{hierarchyError}</p>
        ) : hierarchyLoading && !tree ? (
          <p className="text-sm text-muted-foreground p-4">Loading hierarchy…</p>
        ) : tree ? (
        <div key={multiselectionMode ? `tree-v${treeVersion}-${selectedCellIds.join(',')}` : 'no-multiselect'}>
          <TreeSidebarNode
            node={tree}
            depth={0}
            colourMap={colourMaps}
            selectedPath={selectedPath}
            selectedCellIds={multiselectionMode ? selectedCellIds : undefined}
            onSelect={handleSelectNode}
            expanded={expanded}
            onToggle={handleToggle}
            annotationsByCell={annotationsByCell}
            cells={cells}
          />
        </div>
        ) : (
          <p className="text-sm text-muted-foreground p-4">No data yet.</p>
        )}
        </div>
      </div>

      {/* Selection summary */}
      {selectedPath.length > 0 && (
        <p className="text-xs text-muted-foreground">
          {filteredByTree.length} cell{filteredByTree.length !== 1 ? 's' : ''} selected
        </p>
      )}

      {/* Protocol filter (not in tree) */}
      {protocols.length > 0 && (
        <div className="space-y-2">
          <Label className="text-xs text-muted-foreground">Protocol</Label>
          <Select value={protocolFilter} onValueChange={onProtocolFilter}>
            <SelectTrigger className="h-9 w-full text-xs">
              <SelectValue placeholder="All protocols" />
            </SelectTrigger>
            <SelectContent className="min-w-[200px]">
              <SelectItem value="All">All protocols</SelectItem>
              {protocols.map((p) => (
                <SelectItem key={p} value={p}>
                  {p.length > 50 ? p.slice(0, 47) + '…' : p}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      )}
    </div>
  );
}
