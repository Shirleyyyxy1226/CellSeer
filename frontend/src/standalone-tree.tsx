import { createRoot } from 'react-dom/client';
import { TreePanel } from '@/components/panels/TreePanel';
import './index.css';

const rootEl = document.getElementById('root');

if (!rootEl) {
  throw new Error('Missing #root mount point for standalone tree page.');
}

createRoot(rootEl).render(<TreePanel />);
