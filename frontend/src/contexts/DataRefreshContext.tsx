import { createContext, useContext, useState, useCallback } from 'react';

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
  return (
    <DataRefreshContext.Provider value={{ dataVersion, triggerDataRefresh }}>
      {children}
    </DataRefreshContext.Provider>
  );
}

export const useDataRefresh = () => useContext(DataRefreshContext);
