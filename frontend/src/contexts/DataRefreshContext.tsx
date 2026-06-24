import { createContext, useContext, useState, useCallback, useMemo } from 'react';

interface DataRefreshContextValue {
  dataVersion: number;
  triggerDataRefresh: () => void;
}

const DataRefreshContext = createContext<DataRefreshContextValue>({
  dataVersion: 0,
  triggerDataRefresh: () => {},
});

export function DataRefreshProvider({ children }: { children: React.ReactNode }) {
  const [dataVersion, setDataVersion] = useState(0);
  const triggerDataRefresh = useCallback(() => setDataVersion(v => v + 1), []);
  const value = useMemo(() => ({ dataVersion, triggerDataRefresh }), [dataVersion, triggerDataRefresh]);
  return (
    <DataRefreshContext.Provider value={value}>
      {children}
    </DataRefreshContext.Provider>
  );
}

export const useDataRefresh = () => useContext(DataRefreshContext);
