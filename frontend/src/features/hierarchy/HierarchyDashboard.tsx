import { useEffect, useMemo, useState } from 'react';
import { HierarchyEditor } from '@/components/tree/HierarchyEditor';
import { TreeSvg } from '@/components/tree/TreeSvg';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useProjectHierarchy } from '@/contexts/ProjectHierarchyContext';
import { useDimensions } from '@/hooks/useDimensions';
import { useTreeLayout } from '@/hooks/useTreeLayout';
import { collectPreLeafNodeKeys, type TreeNode } from '@/lib/treeUtils';

/* ── Main panel ─────────────────────────────────────────────────────── */
export function HierarchyDashboard() {
  const { handleCellSelect, annotationsByCell } = useCellSelection();
  const { apiData, loading, error, activeJs, setHierarchyOrder, resetHierarchyOrder } =
    useProjectHierarchy();
  const [containerRef, dims] = useDimensions<HTMLDivElement>();
  const [collapsedPreLeafNodeKeys, setCollapsedPreLeafNodeKeys] = useState<Set<string>>(new Set());
  const tree = (apiData?.tree ?? null) as TreeNode | null;
  const treeLayout = useTreeLayout({
    tree,
    containerWidth: dims.width,
    containerHeight: dims.height,
    hierColCount: apiData?.analysis?.hierCols?.length ?? 0,
    collapsedPreLeafNodeKeys,
  });

  useEffect(() => {
    if (!tree) {
      setCollapsedPreLeafNodeKeys(new Set());
      return;
    }
    // Keep full-page tree readable by collapsing pre-leaf groups by default.
    setCollapsedPreLeafNodeKeys(collectPreLeafNodeKeys(tree));
  }, [tree]);

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

  if (loading && !apiData) {
    return (
      <div className="flex flex-col h-full items-center justify-center gap-4 bg-background">
        <div className="text-[14px] text-muted-foreground">
          Loading hierarchy…
        </div>
      </div>
    );
  }

  const pathToColorMap = apiData?.pathToColorMap
    ? new Map(Object.entries(apiData.pathToColorMap))
    : undefined;

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

      <div
        ref={containerRef}
        className="flex-1 overflow-auto relative bg-muted/30"
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
            collapsedPreLeafNodeKeys={collapsedPreLeafNodeKeys}
            onTogglePreLeafNode={(nodeKey) => {
              setCollapsedPreLeafNodeKeys((prev) => {
                const next = new Set(prev);
                if (next.has(nodeKey)) next.delete(nodeKey);
                else next.add(nodeKey);
                return next;
              });
            }}
          />
        )}
      </div>
    </div>
  );
}
