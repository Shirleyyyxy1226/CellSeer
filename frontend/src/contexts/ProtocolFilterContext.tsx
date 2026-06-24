import { createContext, useContext, useMemo, useState } from 'react';

const ProtocolFilterContext = createContext<{
  protocolFilter: string;
  setProtocolFilter: (v: string) => void;
} | null>(null);

export function ProtocolFilterProvider({ children }: { children: React.ReactNode }) {
  const [protocolFilter, setProtocolFilter] = useState<string>('All');
  const value = useMemo(() => ({ protocolFilter, setProtocolFilter }), [protocolFilter]);
  return (
    <ProtocolFilterContext.Provider value={value}>
      {children}
    </ProtocolFilterContext.Provider>
  );
}

export function useProtocolFilter() {
  const ctx = useContext(ProtocolFilterContext);
  if (!ctx) {
    throw new Error('useProtocolFilter must be used within ProtocolFilterProvider');
  }
  return ctx;
}
