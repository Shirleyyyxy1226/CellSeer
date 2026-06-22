import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react';
import { flushSync } from 'react-dom';
import { fetchCellAnnotations } from '@/lib/api';

export interface CellAnnotation {
  /** String cell_id is now the canonical key returned by the backend. */
  cellId: string;
  /** Display number; may collide across DIGIBAT projects so DO NOT use for routing. */
  idNo: number | null;
  note: string | null;
  tags: string[];
  updatedAt: string | null;
}

interface CellSelectionContextValue {
  /** In-memory selection still keyed by id_no for backwards compat with hierarchy / chart filters. */
  selectedCellIds: number[];
  setSelectedCellIds: (ids: number[]) => void;
  addToSelection: (id: number) => void;
  removeFromSelection: (id: number) => void;
  clearSelection: () => void;
  /** When true, each click adds/toggles; when false, click replaces (or Ctrl/Cmd+click adds) */
  multiselectionMode: boolean;
  setMultiselectionMode: (v: boolean) => void;
  handleCellSelect: (idNo: number, event?: MouseEvent) => void;
  /**
   * True when the user has explicitly dismissed the Cell Details panel for the
   * current selection. Resets automatically when the selection changes so a new
   * pick re-opens the panel. Use `dismissDetailPanel()` from Save/X handlers
   * and `isDetailPanelDismissed` (or the convenience `detailPanelOpen` flag)
   * to gate rendering of the panel and its surrounding chrome.
   */
  isDetailPanelDismissed: boolean;
  detailPanelOpen: boolean;
  dismissDetailPanel: () => void;
  /** Annotations keyed by id_no (synthesised from the backend's cell_id-keyed response). */
  annotationsByCell: Record<number, CellAnnotation>;
  /** Annotations keyed by cell_id — the authoritative shape from the backend. */
  annotationsByCellId: Record<string, CellAnnotation>;
  refetchAnnotations: () => void;
}

const CellSelectionContext = createContext<CellSelectionContextValue | null>(
  null
);

export function CellSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedCellIds, setSelectedCellIdsState] = useState<number[]>([]);
  const [multiselectionMode, setMultiselectionModeState] = useState(false);
  // Detail-panel dismissal is keyed on the exact selection so that any change
  // to the selection (different cell, more cells, fewer cells) auto-reopens it.
  const [dismissedSelectionKey, setDismissedSelectionKey] = useState<string | null>(null);
  const [annotationsByCell, setAnnotationsByCell] = useState<
    Record<number, CellAnnotation>
  >({});
  const [annotationsByCellId, setAnnotationsByCellId] = useState<
    Record<string, CellAnnotation>
  >({});

  const selectionKey = useMemo(
    () => [...selectedCellIds].sort((a, b) => a - b).join(','),
    [selectedCellIds],
  );
  const isDetailPanelDismissed = dismissedSelectionKey === selectionKey;
  const detailPanelOpen =
    selectedCellIds.length === 1 && !multiselectionMode && !isDetailPanelDismissed;
  const dismissDetailPanel = useCallback(() => {
    setDismissedSelectionKey(selectionKey);
  }, [selectionKey]);

  /**
   * Wrapped setter that flushes synchronously so tree and chart update together.
   * Every user-driven selection mutation also drops any prior detail-panel
   * dismissal so the panel re-opens for the new (or repeated) pick, even when
   * the resulting array is content-identical to the previous one.
   */
  const setSelectedCellIds = useCallback(
    (ids: number[]) => {
      flushSync(() => {
        setDismissedSelectionKey(null);
        setSelectedCellIdsState(ids);
      });
    },
    []
  );

  const addToSelection = useCallback((id: number) => {
    flushSync(() => {
      setDismissedSelectionKey(null);
      setSelectedCellIdsState((prev) =>
        prev.includes(id) ? prev : [...prev, id]
      );
    });
  }, []);

  const removeFromSelection = useCallback((id: number) => {
    flushSync(() => {
      setDismissedSelectionKey(null);
      setSelectedCellIdsState((prev) => prev.filter((x) => x !== id));
    });
  }, []);

  const handleCellSelect = useCallback((idNo: number, event?: MouseEvent) => {
    const addOrToggle = event?.ctrlKey || event?.metaKey;
    flushSync(() => {
      setDismissedSelectionKey(null);
      if (multiselectionMode || addOrToggle) {
        setSelectedCellIdsState((prev) =>
          prev.includes(idNo) ? prev.filter((x) => x !== idNo) : [...prev, idNo]
        );
      } else {
        setSelectedCellIdsState([idNo]);
      }
    });
  }, [multiselectionMode]);

  const clearSelection = useCallback(() => {
    flushSync(() => {
      setDismissedSelectionKey(null);
      setSelectedCellIdsState([]);
    });
  }, []);

  /**
   * Toggle multi-select. Leaving multi-select collapses the selection to the
   * most recently selected cell (selections are appended, so it's the last
   * element) — otherwise single-select would keep showing the whole
   * multi-selection. Entering multi-select leaves the current selection as-is.
   */
  const setMultiselectionMode = useCallback((v: boolean) => {
    flushSync(() => {
      setMultiselectionModeState(v);
      if (!v) {
        setDismissedSelectionKey(null);
        setSelectedCellIdsState((prev) =>
          prev.length > 1 ? [prev[prev.length - 1]] : prev,
        );
      }
    });
  }, []);

  const refetchAnnotations = useCallback(async () => {
    try {
      const data = await fetchCellAnnotations();
      const byId: Record<number, CellAnnotation> = {};
      const byCellId: Record<string, CellAnnotation> = {};
      for (const [cellId, v] of Object.entries(data.annotations || {})) {
        byCellId[cellId] = v;
        if (v.idNo != null && Number.isFinite(v.idNo)) {
          byId[Number(v.idNo)] = v;
        }
      }
      setAnnotationsByCell(byId);
      setAnnotationsByCellId(byCellId);
    } catch {
      setAnnotationsByCell({});
      setAnnotationsByCellId({});
    }
  }, []);

  useEffect(() => {
    refetchAnnotations();
  }, [refetchAnnotations]);

  const value = useMemo<CellSelectionContextValue>(
    () => ({
      selectedCellIds,
      setSelectedCellIds,
      addToSelection,
      removeFromSelection,
      clearSelection,
      multiselectionMode,
      setMultiselectionMode,
      handleCellSelect,
      isDetailPanelDismissed,
      detailPanelOpen,
      dismissDetailPanel,
      annotationsByCell,
      annotationsByCellId,
      refetchAnnotations,
    }),
    [
      selectedCellIds,
      setSelectedCellIds,
      addToSelection,
      removeFromSelection,
      clearSelection,
      multiselectionMode,
      setMultiselectionMode,
      handleCellSelect,
      isDetailPanelDismissed,
      detailPanelOpen,
      dismissDetailPanel,
      annotationsByCell,
      annotationsByCellId,
      refetchAnnotations,
    ]
  );

  return (
    <CellSelectionContext.Provider value={value}>
      {children}
    </CellSelectionContext.Provider>
  );
}

export function useCellSelection() {
  const ctx = useContext(CellSelectionContext);
  if (!ctx) {
    throw new Error('useCellSelection must be used within CellSelectionProvider');
  }
  return ctx;
}
