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
  idNo: number;
  note: string | null;
  tags: string[];
  updatedAt: string | null;
}

interface CellSelectionContextValue {
  selectedCellIds: number[];
  setSelectedCellIds: (ids: number[]) => void;
  addToSelection: (id: number) => void;
  removeFromSelection: (id: number) => void;
  clearSelection: () => void;
  /** When true, each click adds/toggles; when false, click replaces (or Ctrl/Cmd+click adds) */
  multiselectionMode: boolean;
  setMultiselectionMode: (v: boolean) => void;
  handleCellSelect: (idNo: number, event?: MouseEvent) => void;
  annotationsByCell: Record<number, CellAnnotation>;
  refetchAnnotations: () => void;
}

const CellSelectionContext = createContext<CellSelectionContextValue | null>(
  null
);

export function CellSelectionProvider({ children }: { children: React.ReactNode }) {
  const [selectedCellIds, setSelectedCellIdsState] = useState<number[]>([]);
  const [multiselectionMode, setMultiselectionMode] = useState(false);
  const [annotationsByCell, setAnnotationsByCell] = useState<
    Record<number, CellAnnotation>
  >({});

  /** Wrapped setter that flushes synchronously so tree and chart update together */
  const setSelectedCellIds = useCallback(
    (arg: number[] | ((prev: number[]) => number[])) => {
      flushSync(() => {
        setSelectedCellIdsState(arg);
      });
    },
    []
  );

  const addToSelection = useCallback((id: number) => {
    flushSync(() => {
      setSelectedCellIdsState((prev) =>
        prev.includes(id) ? prev : [...prev, id]
      );
    });
  }, []);

  const removeFromSelection = useCallback((id: number) => {
    flushSync(() => {
      setSelectedCellIdsState((prev) => prev.filter((x) => x !== id));
    });
  }, []);

  const handleCellSelect = useCallback((idNo: number, event?: MouseEvent) => {
    const addOrToggle = event?.ctrlKey || event?.metaKey;
    flushSync(() => {
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
    flushSync(() => setSelectedCellIdsState([]));
  }, []);

  const refetchAnnotations = useCallback(async () => {
    try {
      const data = await fetchCellAnnotations();
      const out: Record<number, CellAnnotation> = {};
      for (const [k, v] of Object.entries(data.annotations || {})) {
        out[Number(k)] = v;
      }
      setAnnotationsByCell(out);
    } catch {
      setAnnotationsByCell({});
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
      annotationsByCell,
      refetchAnnotations,
    }),
    [
      selectedCellIds,
      addToSelection,
      removeFromSelection,
      clearSelection,
      multiselectionMode,
      handleCellSelect,
      annotationsByCell,
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
