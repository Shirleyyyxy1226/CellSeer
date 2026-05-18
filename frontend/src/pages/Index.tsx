import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link } from 'react-router-dom';
import IcaDashboard from '@/features/icaDvq/IcaDashboard';
import DvqDashboard from '@/features/icaDvq/DvqDashboard';
import RatePerformanceHierarchyDashboard from '@/features/ratePerformance/RatePerformanceHierarchyDashboard';
import GcdDashboard from '@/features/gcdPlot/GcdDashboard';
import MasterPlot1Panel from '@/features/masterPlot/MasterPlot1Dashboard';
import MasterPlot2Panel from '@/features/masterPlot/MasterPlot2Dashboard';
import { HierarchyDashboard } from '@/features/hierarchy/HierarchyDashboard';
import CellFilterSidebar from '@/components/CellFilterSidebar';
import { CellDetailPanel } from '@/components/CellDetailPanel';
import { PublicTreeFilterSidebar } from '@/components/tree/PublicTreeFilterSidebar';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProtocolFilter } from '@/contexts/ProtocolFilterContext';
import { fetchCellRecordIndex, fetchRatePerformance } from '@/lib/api';
import type { RatePerfCellRaw } from '@/lib/cellTypes';
import { House, Menu } from 'lucide-react';
import { type ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

type Tab =
  | 'ica'
  | 'dvq'
  | 'rateperf-hier'
  | 'voltagecap'
  | 'particle-master'
  | 'tree';

const TABS: { key: Tab; label: string }[] = [
  { key: 'tree', label: 'Hierarchy Tree' },
  { key: 'particle-master', label: 'Master Plot' },
  { key: 'rateperf-hier', label: 'Rate Performance' },
  { key: 'voltagecap', label: 'GCD Plot' },
  { key: 'dvq', label: 'dV/dQ 3D' },
  { key: 'ica', label: 'ICA 3D' },
];

interface TreeCell {
  idNo: number;
  cellId: string;
  cellName: string;
  cathode: string;
  separatorType: string;
  spacerMm: number | null;
}

const Index = () => {
  const { selectedCellIds, multiselectionMode } = useCellSelection();
  const { setTreeFilterPath } = useTreeFilter();
  const { protocolFilter, setProtocolFilter } = useProtocolFilter();
  const [activeTab, setActiveTab] = useState<Tab>('tree');
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const leftPanelRef = useRef<ImperativePanelHandle>(null);
  const rightPanelRef = useRef<ImperativePanelHandle>(null);
  const [treeCells, setTreeCells] = useState<TreeCell[]>([]);
  const [rateCells, setRateCells] = useState<RatePerfCellRaw[]>([]);
  const [rateProtocols, setRateProtocols] = useState<string[]>([]);

  // Cell visibility
  const [visibleCells, setVisibleCells] = useState<string[]>([]);

  // Filters
  const [cathodeFilter, setCathodeFilter] = useState('All');
  const [spacerFilter, setSpacerFilter] = useState('All');
  const [separatorFilter, setSeparatorFilter] = useState('All');

  useEffect(() => {
    fetchCellRecordIndex()
      .then((d) => {
        if (d.cells.length) {
          const nextCells = d.cells as TreeCell[];
          setTreeCells(nextCells);
          setVisibleCells((prev) => (prev.length ? prev : nextCells.map((cell) => cell.cellId)));
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    fetchRatePerformance()
      .then((d) => {
        setRateProtocols(d.protocols ?? []);
        setRateCells((d.cells ?? []) as RatePerfCellRaw[]);
      })
      .catch(() => {
        setRateProtocols([]);
        setRateCells([]);
      });
  }, []);

  useEffect(() => {
    if (!TABS.some((tab) => tab.key === activeTab)) {
      setActiveTab('tree');
    }
  }, [activeTab]);

  const handleToggleLeftSidebar = useCallback(() => {
    const panel = leftPanelRef.current;
    if (panel?.isCollapsed?.()) {
      panel.expand();
      setLeftSidebarOpen(true);
    } else {
      panel?.collapse();
      setLeftSidebarOpen(false);
    }
  }, []);

  const handleToggleCell = useCallback((cellId: string) => {
    setVisibleCells((prev) =>
      prev.includes(cellId)
        ? prev.filter((id) => id !== cellId)
        : [...prev, cellId]
    );
  }, []);

  const showRightPanel = selectedCellIds.length === 1 && !multiselectionMode;

  // Keep right panel mounted (collapsed when hidden) so PanelGroup panel count stays
  // stable and the left sidebar width does not reset on cell / tree node selection.
  useEffect(() => {
    const panel = rightPanelRef.current;
    if (!panel) return;
    if (showRightPanel) {
      if (panel.isCollapsed()) panel.expand(16);
    } else if (!panel.isCollapsed()) {
      panel.collapse();
    }
  }, [showRightPanel]);

  const filteredTreeCells = useMemo(() => {
    return treeCells.filter((c) => {
      if (cathodeFilter !== 'All' && c.cathode !== cathodeFilter) return false;
      if (spacerFilter !== 'All' && String(c.spacerMm ?? '') !== spacerFilter) return false;
      if (separatorFilter !== 'All' && c.separatorType !== separatorFilter) return false;
      return true;
    });
  }, [treeCells, cathodeFilter, spacerFilter, separatorFilter]);

  const tabsWithHierarchy =
    activeTab === 'ica' ||
    activeTab === 'dvq' ||
    activeTab === 'voltagecap' ||
    activeTab === 'rateperf-hier' ||
    activeTab === 'tree';
  const tabsWithCellFilter =
    activeTab !== 'ica' &&
    activeTab !== 'dvq' &&
    activeTab !== 'voltagecap' &&
    activeTab !== 'rateperf-hier' &&
    activeTab !== 'particle-master' &&
    activeTab !== 'tree';

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header with horizontal tabs */}
      <header className="shrink-0 border-b border-border bg-card">
        <div className="flex items-center gap-2 px-4 py-2">
          {activeTab !== 'tree' && activeTab !== 'particle-master' && (
            <button
              onClick={handleToggleLeftSidebar}
              className="p-1.5 rounded-md hover:bg-secondary transition-colors text-foreground"
              aria-label={leftSidebarOpen ? 'Collapse sidebar' : 'Expand sidebar'}
            >
              <Menu className="h-5 w-5" />
            </button>
          )}
          <Link
            to="/"
            aria-label="Go to Home"
            className="inline-flex items-center justify-center rounded-md border border-border p-1.5 text-foreground hover:bg-secondary transition-colors"
          >
            <House className="h-4 w-4" />
          </Link>
          <Link to="/" className="text-xl font-bold text-foreground tracking-tight hover:underline">CellSeer</Link>
        </div>
        <nav className="flex gap-1 px-4 pb-2">
          {TABS.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-4 py-2 text-sm font-medium rounded-t-md transition-colors ${
                activeTab === tab.key
                  ? 'bg-background text-foreground border border-border border-b-background -mb-px'
                  : 'text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </nav>
      </header>

      {/* Layout: tree & master plot full-bleed (no left sidebar); other tabs use resizable panels */}
      {activeTab === 'tree' ? (
        /* Hierarchy Tree — full screen, optional right panel */
        <div className="flex-1 min-h-0 flex min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <HierarchyDashboard />
          </div>
          {showRightPanel && (
            <>
              <div className="w-2 shrink-0 border-l border-border" />
              <div className="w-[192px] shrink-0 overflow-hidden flex flex-col border-l border-border bg-card">
                <CellDetailPanel />
              </div>
            </>
          )}
        </div>
      ) : activeTab === 'particle-master' ? (
        <div className="flex-1 min-h-0 flex min-w-0">
          <div className="flex-1 min-w-0 overflow-y-auto p-4">
            {/* Wide screens: side-by-side (overview left, parallel coords right); narrow: stack. */}
            <div className="grid grid-cols-1 xl:grid-cols-2 gap-6 xl:gap-8 xl:items-stretch min-w-0">
              <div className="min-w-0 order-1 flex flex-col xl:h-full xl:min-h-0">
                <MasterPlot1Panel
                  visibleCells={visibleCells}
                  cathodeFilter={cathodeFilter}
                  spacerFilter={spacerFilter}
                  separatorFilter={separatorFilter}
                  onCathodeFilter={setCathodeFilter}
                  onSeparatorFilter={setSeparatorFilter}
                  onSpacerFilter={setSpacerFilter}
                />
              </div>
              <div className="min-w-0 order-2 flex flex-col xl:h-full xl:min-h-0">
                <MasterPlot2Panel
                  visibleCells={visibleCells}
                  cathodeFilter={cathodeFilter}
                  spacerFilter={spacerFilter}
                  separatorFilter={separatorFilter}
                />
              </div>
            </div>
          </div>
          {showRightPanel && (
            <>
              <div className="w-2 shrink-0 border-l border-border" />
              <div className="w-[192px] shrink-0 overflow-hidden flex flex-col border-l border-border bg-card">
                <CellDetailPanel />
              </div>
            </>
          )}
        </div>
      ) : (
      <PanelGroup direction="horizontal" autoSaveId="cellseer-layout" className="flex-1 min-h-0 flex">
        {/* Left sidebar */}
        <>
            <Panel
              id="left-sidebar"
              order={1}
              defaultSize={30}
              minSize={15}
              maxSize={45}
              collapsible
              collapsedSize={0}
              ref={leftPanelRef}
              onCollapse={() => setLeftSidebarOpen(false)}
              onExpand={() => setLeftSidebarOpen(true)}
              className="shrink-0 border-r border-border bg-card overflow-hidden flex flex-col"
              style={{ minWidth: 0 }}
            >
              <div className="h-full flex flex-col overflow-hidden min-w-0">
                {tabsWithHierarchy && treeCells.length > 0 ? (
                  <div className="flex-1 min-h-0 flex flex-col p-3 overflow-hidden">
                    <div className="flex-1 min-h-0 flex flex-col overflow-hidden">
                      <PublicTreeFilterSidebar
                        cells={activeTab === 'rateperf-hier' ? treeCells : filteredTreeCells}
                        protocols={activeTab === 'rateperf-hier' ? rateProtocols : []}
                        protocolFilter={activeTab === 'rateperf-hier' ? protocolFilter : 'All'}
                        onProtocolFilter={activeTab === 'rateperf-hier' ? setProtocolFilter : () => {}}
                        rateCellsForProtocol={activeTab === 'rateperf-hier' ? rateCells : []}
                      />
                    </div>
                  </div>
                ) : leftSidebarOpen && tabsWithCellFilter ? (
                  <div className="flex-1 overflow-y-auto p-4">
                    <CellFilterSidebar
                      visibleCells={visibleCells}
                      onToggleCell={handleToggleCell}
                      cathodeFilter={cathodeFilter}
                      onCathodeFilter={setCathodeFilter}
                      spacerFilter={spacerFilter}
                      onSpacerFilter={setSpacerFilter}
                      separatorFilter={separatorFilter}
                      onSeparatorFilter={setSeparatorFilter}
                      activeTab={activeTab}
                      onNavigateToTab={setActiveTab}
                    />
                  </div>
                ) : (
                  <div className="flex-1 p-4 text-sm text-muted-foreground">
                    {treeCells.length === 0 && tabsWithHierarchy
                      ? 'Loading cell list…'
                      : 'Select a chart tab.'}
                  </div>
                )}
              </div>
            </Panel>

            <PanelResizeHandle
              className="w-2 shrink-0 transition-colors hover:bg-primary/20 data-[resize-handle-active]:bg-primary/30 flex items-center justify-center group"
              style={{ minWidth: 8 }}
            >
              <div className="w-1 h-8 rounded-full bg-border group-hover:bg-muted-foreground/40 transition-colors" />
            </PanelResizeHandle>
          </>

        {/* Main content */}
        <Panel order={2} minSize={25} className="flex flex-col min-w-0 overflow-hidden">
            <div className="flex-1 overflow-y-auto p-4">
              {activeTab === 'ica' && (
                <IcaDashboard
                  cathodeFilter={cathodeFilter}
                  spacerFilter={spacerFilter}
                  separatorFilter={separatorFilter}
                />
              )}
              {activeTab === 'dvq' && (
                <DvqDashboard
                  cathodeFilter={cathodeFilter}
                  spacerFilter={spacerFilter}
                  separatorFilter={separatorFilter}
                />
              )}
              {activeTab === 'rateperf-hier' && (
                <RatePerformanceHierarchyDashboard
                  visibleCells={visibleCells}
                  cathodeFilter={cathodeFilter}
                  spacerFilter={spacerFilter}
                  separatorFilter={separatorFilter}
                  onCathodeFilter={setCathodeFilter}
                  onSeparatorFilter={setSeparatorFilter}
                />
              )}
              {activeTab === 'voltagecap' && (
                <GcdDashboard
                  visibleCells={visibleCells}
                  cathodeFilter={cathodeFilter}
                  spacerFilter={spacerFilter}
                  separatorFilter={separatorFilter}
                  onCathodeFilter={setCathodeFilter}
                  onSeparatorFilter={setSeparatorFilter}
                />
              )}
            </div>
        </Panel>

        {/* Right panel — collapsed when hidden; always mounted so left sidebar width stays stable */}
        <PanelResizeHandle
          className="w-2 shrink-0 transition-colors hover:bg-primary/20 data-[resize-handle-active]:bg-primary/30 flex items-center justify-center group"
          style={{ minWidth: 8 }}
          disabled={!showRightPanel}
        >
          <div className="w-1 h-8 rounded-full bg-border group-hover:bg-muted-foreground/40 transition-colors" />
        </PanelResizeHandle>
        <Panel
          id="right-panel"
          order={3}
          ref={rightPanelRef}
          collapsible
          collapsedSize={0}
          defaultSize={0}
          minSize={10}
          maxSize={30}
          className="shrink-0 border-l border-border bg-card overflow-hidden flex flex-col"
          style={{ minWidth: 0 }}
        >
          {showRightPanel ? <CellDetailPanel /> : null}
        </Panel>
      </PanelGroup>
      )}
    </div>
  );
};

export default Index;
