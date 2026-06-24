import { createContext, useCallback, useContext, useMemo, useRef, useState } from 'react';

export interface MasterPlotBridgeValue {
  /** Cross-plot hover (parallel coords ↔ scatter). */
  hoveredIdNo: number | null;
  setHoveredIdNo: (id: number | null, source?: 'plot1' | 'plot2') => void;
  clearHoverIfFrom: (source: 'plot1' | 'plot2') => void;
}

const MasterPlotBridgeContext = createContext<MasterPlotBridgeValue | null>(null);

export function MasterPlotBridgeProvider({ children }: { children: React.ReactNode }) {
  const [hoveredIdNo, setHoveredState] = useState<number | null>(null);
  const hoverSourceRef = useRef<'plot1' | 'plot2' | null>(null);

  const setHoveredIdNo = useCallback((id: number | null, source?: 'plot1' | 'plot2') => {
    setHoveredState(id);
    hoverSourceRef.current = id == null ? null : source ?? null;
  }, []);

  const clearHoverIfFrom = useCallback((source: 'plot1' | 'plot2') => {
    if (hoverSourceRef.current !== source) return;
    hoverSourceRef.current = null;
    setHoveredState(null);
  }, []);

  const value = useMemo<MasterPlotBridgeValue>(
    () => ({
      hoveredIdNo,
      setHoveredIdNo,
      clearHoverIfFrom,
    }),
    [hoveredIdNo, setHoveredIdNo, clearHoverIfFrom],
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
