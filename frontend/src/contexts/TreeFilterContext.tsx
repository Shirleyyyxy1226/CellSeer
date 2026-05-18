import { createContext, useCallback, useContext, useState } from 'react';
import type { TreeFilterPath } from '@/components/tree/HierarchyTreeSidebar';

interface TreeFilterContextValue {
  treeFilterPath: TreeFilterPath;
  setTreeFilterPath: (path: TreeFilterPath | ((prev: TreeFilterPath) => TreeFilterPath)) => void;
}

const TreeFilterContext = createContext<TreeFilterContextValue | null>(null);

export function TreeFilterProvider({ children }: { children: React.ReactNode }) {
  const [treeFilterPath, setTreeFilterPathState] = useState<TreeFilterPath>([]);
  const setTreeFilterPath = useCallback(
    (arg: TreeFilterPath | ((prev: TreeFilterPath) => TreeFilterPath)) => {
      setTreeFilterPathState((prev) => (typeof arg === 'function' ? arg(prev) : arg));
    },
    []
  );
  const value: TreeFilterContextValue = { treeFilterPath, setTreeFilterPath };
  return (
    <TreeFilterContext.Provider value={value}>
      {children}
    </TreeFilterContext.Provider>
  );
}

export function useTreeFilter() {
  const ctx = useContext(TreeFilterContext);
  if (!ctx) {
    throw new Error('useTreeFilter must be used within TreeFilterProvider');
  }
  return ctx;
}
