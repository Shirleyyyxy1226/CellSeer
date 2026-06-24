import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface MasterPlotBridgeValue {
  /** Cross-plot hover (parallel coords ↔ scatter). */
  hoveredIdNo: number | null;
  setHoveredIdNo: (id: number | null, source?: 'plot1' | 'plot2') => void;
  clearHoverIfFrom: (source: 'plot1' | 'plot2') => void;
  /**
   * Shared cross-view brush. When non-null, every overview view
   * dims cells whose idNo is NOT in this set (cross-highlight). Any view can be
   * the producer; `brushSource` tags it so a producer can avoid reacting to its
   * own brush. null = no brush active.
   */
  brushPassingIds: Set<number> | null;
  brushSource: string | null;
  setBrushPassingIds: (ids: Set<number> | null, source?: string) => void;
}

const MasterPlotBridgeContext = createContext<MasterPlotBridgeValue | null>(null);

export function MasterPlotBridgeProvider({ children }: { children: React.ReactNode }) {
  const [hoveredIdNo, setHoveredState] = useState<number | null>(null);
  const hoverSourceRef = useRef<'plot1' | 'plot2' | null>(null);
  const [brushPassingIds, setBrushState] = useState<Set<number> | null>(null);
  const [brushSource, setBrushSource] = useState<string | null>(null);

  const setHoveredIdNo = useCallback((id: number | null, source?: 'plot1' | 'plot2') => {
    setHoveredState(id);
    hoverSourceRef.current = id == null ? null : source ?? null;
  }, []);

  const clearHoverIfFrom = useCallback((source: 'plot1' | 'plot2') => {
    if (hoverSourceRef.current !== source) return;
    hoverSourceRef.current = null;
    setHoveredState(null);
  }, []);

  const setBrushPassingIds = useCallback((ids: Set<number> | null, source?: string) => {
    setBrushState(ids);
    setBrushSource(ids == null ? null : source ?? null);
  }, []);

  const value = useMemo<MasterPlotBridgeValue>(
    () => ({
      hoveredIdNo,
      setHoveredIdNo,
      clearHoverIfFrom,
      brushPassingIds,
      brushSource,
      setBrushPassingIds,
    }),
    [hoveredIdNo, setHoveredIdNo, clearHoverIfFrom, brushPassingIds, brushSource, setBrushPassingIds],
  );

  return <MasterPlotBridgeContext.Provider value={value}>{children}</MasterPlotBridgeContext.Provider>;
}

export function useMasterPlotBridge(): MasterPlotBridgeValue {
  const ctx = useContext(MasterPlotBridgeContext);
  if (!ctx) {
    throw new Error('useMasterPlotBridge must be used within MasterPlotBridgeProvider');
  }
  return ctx;
}

export function useMasterPlotBridgeOptional(): MasterPlotBridgeValue | null {
  return useContext(MasterPlotBridgeContext);
}
