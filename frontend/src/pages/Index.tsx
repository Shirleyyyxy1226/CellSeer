import { useState, useCallback, useEffect, useMemo, useRef } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import DqDvDashboard from '@/features/differential/DqDvDashboard';
import DvDqDashboard from '@/features/differential/DvDqDashboard';
import RatePerformanceDashboard from '@/features/ratePerformance/RatePerformanceDashboard';
import GcdDashboard from '@/features/gcdPlot/GcdDashboard';
import ProjectOverviewDashboard from '@/features/masterPlot/ProjectOverviewDashboard';
import { HierarchyDashboard } from '@/features/hierarchy/HierarchyDashboard';
import CellFilterSidebar from '@/components/CellFilterSidebar';
import { CellDetailPanel } from '@/components/CellDetailPanel';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { CircuitTreeFilterSidebar } from '@/components/tree/CircuitTreeFilterSidebar';
import { useCellSelection } from '@/contexts/CellSelectionContext';
import { useTreeFilter } from '@/contexts/TreeFilterContext';
import { useProtocolFilter } from '@/contexts/ProtocolFilterContext';
import { useCellRecordIndexQuery, useRatePerformanceQuery } from '@/hooks/useCellData';
import type { RatePerfCell } from '@/lib/cell/cellTypes';
import { House, PanelLeft } from 'lucide-react';
import { type ImperativePanelHandle, Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';

type Tab =
  | 'dqdv'
  | 'dvdq'
  | 'rateperf-hier'
  | 'voltagecap'
  | 'particle-master'
  | 'tree';

const TABS: { key: Tab; label: string }[] = [
  { key: 'tree', label: 'Hierarchy Tree' },
  { key: 'particle-master', label: 'Master Plot' },
  { key: 'rateperf-hier', label: 'Rate Performance' },
  { key: 'voltagecap', label: 'GCD Plot' },
  { key: 'dvdq', label: 'dV/dQ 3D' },
  { key: 'dqdv', label: 'dQ/dV 3D' },
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
  const { detailPanelOpen } = useCellSelection();
  const { setTreeFilterPath } = useTreeFilter();
  const { protocolFilter, setProtocolFilter } = useProtocolFilter();
  // Active tab lives in the URL (?tab=) so views are shareable and survive reloads.
  const [searchParams, setSearchParams] = useSearchParams();
  const tabParam = searchParams.get('tab');
  const activeTab: Tab = TABS.some((tab) => tab.key === tabParam) ? (tabParam as Tab) : 'tree';
  const setActiveTab = useCallback(
    (tab: Tab) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          next.set('tab', tab);
          return next;
        },
        { replace: false },
      );
    },
    [setSearchParams],
  );
  const [leftSidebarOpen, setLeftSidebarOpen] = useState(true);
  const leftPanelRef = useRef<ImperativePanelHandle>(null);

  const indexQuery = useCellRecordIndexQuery();
  // The bulk rate-performance payload is only consumed here for the
  // rateperf-hier tab; every other tab's component self-fetches it when it
  // needs it (and shares the React Query cache). Gating the fetch keeps the
  // Master Plot tab from pulling a tens-of-MB payload it can serve from the
  // lightweight overview aggregate at scale.
  const rateQuery = useRatePerformanceQuery({ enabled: activeTab === 'rateperf-hier' });
  const treeCells = useMemo(
    () => (indexQuery.data?.cells ?? []) as TreeCell[],
    [indexQuery.data],
  );
  const rateCells = useMemo(
    () => (rateQuery.data?.cells ?? []) as RatePerfCell[],
    [rateQuery.data],
  );
  const rateProtocols = rateQuery.data?.protocols ?? [];

  // Cell visibility
  const [visibleCells, setVisibleCells] = useState<string[]>([]);

  // Filters
  const [cathodeFilter, setCathodeFilter] = useState('All');
  const [spacerFilter, setSpacerFilter] = useState('All');
  const [separatorFilter, setSeparatorFilter] = useState('All');

  useEffect(() => {
    if (treeCells.length) {
      setVisibleCells((prev) => (prev.length ? prev : treeCells.map((cell) => cell.cellId)));
    }
  }, [treeCells]);

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

  // The Cell-details panel applies to the chart tabs. The Hierarchy Tree and
  // Master Plot views exclude it.
  const showRightPanel =
    detailPanelOpen && activeTab !== 'tree' && activeTab !== 'particle-master';

  const filteredTreeCells = useMemo(() => {
    return treeCells.filter((c) => {
      if (cathodeFilter !== 'All' && c.cathode !== cathodeFilter) return false;
      if (spacerFilter !== 'All' && String(c.spacerMm ?? '') !== spacerFilter) return false;
      if (separatorFilter !== 'All' && c.separatorType !== separatorFilter) return false;
      return true;
    });
  }, [treeCells, cathodeFilter, spacerFilter, separatorFilter]);

  const tabsWithHierarchy =
    activeTab === 'dqdv' ||
    activeTab === 'dvdq' ||
    activeTab === 'voltagecap' ||
    activeTab === 'rateperf-hier' ||
    activeTab === 'tree';
  const tabsWithCellFilter =
    activeTab !== 'dqdv' &&
    activeTab !== 'dvdq' &&
    activeTab !== 'voltagecap' &&
    activeTab !== 'rateperf-hier' &&
    activeTab !== 'particle-master' &&
    activeTab !== 'tree';

  return (
    <div className="h-screen bg-background flex flex-col overflow-hidden">
      {/* Header — brand + browser-style tabs on a single compact row */}
      <header className="shrink-0 border-b border-border bg-card">
        <div className="flex items-end gap-3 px-3 pt-1.5">
          {/* Left: home + brand */}
          <div className="flex items-center gap-1.5 pb-1.5 shrink-0">
            <Link
              to="/"
              aria-label="Go to Home"
              className="inline-flex items-center justify-center rounded-md border border-border p-1 text-foreground hover:bg-secondary transition-colors"
            >
              <House className="h-3.5 w-3.5" />
            </Link>
            <Link
              to="/"
              className="text-[15px] font-bold text-foreground tracking-tight hover:underline leading-none"
            >
              CellSeer
            </Link>
          </div>

          {/* Right: browser-style tab strip aligned to bottom edge */}
          <nav
            className="flex items-end gap-0.5 flex-1 min-w-0 overflow-x-auto -mb-px"
            role="tablist"
            aria-label="Dashboard views"
          >
            {TABS.map((tab) => {
              const active = activeTab === tab.key;
              return (
                <button
                  key={tab.key}
                  role="tab"
                  aria-selected={active}
                  onClick={() => setActiveTab(tab.key)}
                  className={`shrink-0 whitespace-nowrap px-3 py-1.5 text-[12px] font-medium rounded-t-md transition-colors border ${
                    active
                      ? 'bg-background text-foreground border-border border-b-background'
                      : 'bg-transparent text-muted-foreground border-transparent hover:text-foreground hover:bg-muted/50'
                  }`}
                >
                  {tab.label}
                </button>
              );
            })}
          </nav>
        </div>
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
              <div className="w-[360px] shrink-0 overflow-hidden flex flex-col border-l border-border bg-card">
                <CellDetailPanel />
              </div>
            </>
          )}
        </div>
      ) : activeTab === 'particle-master' ? (
        <div className="flex-1 min-h-0 flex min-w-0">
          <div className="flex-1 min-w-0 overflow-hidden flex flex-col">
            <ProjectOverviewDashboard
              visibleCells={visibleCells}
              cathodeFilter={cathodeFilter}
              spacerFilter={spacerFilter}
              separatorFilter={separatorFilter}
              onCathodeFilter={setCathodeFilter}
              onSeparatorFilter={setSeparatorFilter}
              onSpacerFilter={setSpacerFilter}
            />
          </div>
          {showRightPanel && (
            <>
              <div className="w-2 shrink-0 border-l border-border" />
              <div className="w-[360px] shrink-0 overflow-hidden flex flex-col border-l border-border bg-card">
                <CellDetailPanel />
              </div>
            </>
          )}
        </div>
      ) : (
      <div className={`relative flex-1 min-h-0 flex min-w-0 ${!leftSidebarOpen ? 'pl-10' : ''}`}>
        {/* Re-expand affordance — floats at the top-left of the content area
            (just below the header) only while the sidebar is collapsed. The
            pl-10 above reserves room so it never covers the chart title. */}
        {!leftSidebarOpen && (
          <button
            type="button"
            onClick={handleToggleLeftSidebar}
            aria-label="Expand sidebar"
            title="Expand sidebar"
            className="absolute top-2 left-2 z-20 inline-flex items-center justify-center rounded-md border border-border bg-card shadow-sm p-1 text-foreground hover:bg-secondary transition-colors"
          >
            <PanelLeft className="h-3.5 w-3.5" />
          </button>
        )}
        <PanelGroup direction="horizontal" autoSaveId="cellseer-layout" className="flex-1 min-h-0 flex min-w-0">
          {/* Left sidebar */}
          <>
            <Panel
              id="left-sidebar"
              order={1}
              defaultSize={36}
              minSize={15}
              maxSize={55}
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
                      <CircuitTreeFilterSidebar
                        cells={activeTab === 'rateperf-hier' ? treeCells : filteredTreeCells}
                        protocols={activeTab === 'rateperf-hier' ? rateProtocols : []}
                        protocolFilter={activeTab === 'rateperf-hier' ? protocolFilter : 'All'}
                        onProtocolFilter={activeTab === 'rateperf-hier' ? setProtocolFilter : () => {}}
                        rateCellsForProtocol={activeTab === 'rateperf-hier' ? rateCells : []}
                        onCollapse={handleToggleLeftSidebar}
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
                    {treeCells.length === 0 && tabsWithHierarchy ? (
                      <LoadingIndicator size="sm" label="Loading cell list…" />
                    ) : (
                      'Select a chart tab.'
                    )}
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
                {activeTab === 'dqdv' && (
                  <DqDvDashboard
                    cathodeFilter={cathodeFilter}
                    spacerFilter={spacerFilter}
                    separatorFilter={separatorFilter}
                  />
                )}
                {activeTab === 'dvdq' && (
                  <DvDqDashboard
                    cathodeFilter={cathodeFilter}
                    spacerFilter={spacerFilter}
                    separatorFilter={separatorFilter}
                  />
                )}
                {activeTab === 'rateperf-hier' && (
                  <RatePerformanceDashboard
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
        </PanelGroup>

        {/* Right detail sidebar — rendered OUTSIDE the PanelGroup so its width is
            never persisted by autoSaveId. With autoSaveId we hit a race where the
            restored right-panel size (e.g. 15%) was applied after the collapse
            useEffect ran, so the sidebar appeared toggled-on after a hard reload
            even with no cell selected. Keeping it outside the PanelGroup means
            the sidebar is fully absent (and the main area gets all the space)
            whenever showRightPanel is false. */}
        {showRightPanel && (
          <div className="w-[360px] shrink-0 border-l border-border bg-card overflow-hidden flex flex-col">
            <CellDetailPanel />
          </div>
        )}
      </div>
      )}

    </div>
  );
};

export default Index;
