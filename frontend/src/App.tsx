import { Toaster } from "@/components/ui/toaster";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { TooltipProvider } from "@/components/ui/tooltip";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { BrowserRouter, Routes, Route } from "react-router-dom";
import { CellSelectionProvider } from "@/contexts/CellSelectionContext";
import { MasterPlotBridgeProvider } from "@/contexts/MasterPlotBridgeContext";
import { TreeFilterProvider } from "@/contexts/TreeFilterContext";
import { ProtocolFilterProvider } from "@/contexts/ProtocolFilterContext";
import { DataRefreshProvider } from "@/contexts/DataRefreshContext";
import { ProjectHierarchyProvider } from "@/contexts/ProjectHierarchyContext";
import { ProtocolDialogProvider } from "@/features/protocol";
import { DemoCredit } from "@/components/DemoCredit";
import Index from "./pages/Index";
import HomePage from "./pages/HomePage";
import ProjectDetailPage from "./pages/ProjectDetailPage";
import DigibatPage from "./digibat/pages/DigibatPage";
import NotFound from "./pages/NotFound";

const queryClient = new QueryClient();

const App = () => (
  <DataRefreshProvider>
  <QueryClientProvider client={queryClient}>
    <TooltipProvider>
      <Toaster />
      <Sonner />
      <CellSelectionProvider>
        <MasterPlotBridgeProvider>
          <TreeFilterProvider>
            <ProtocolFilterProvider>
              {/* Router wraps ProjectHierarchyProvider so the latter can watch the
                  URL (useLocation) and reload the hierarchy/tree when the project
                  in the path changes — otherwise switching projects shows the old
                  tree until a full refresh. */}
              <BrowserRouter basename={import.meta.env.BASE_URL}>
                <ProjectHierarchyProvider>
                  <ProtocolDialogProvider>
                    <Routes>
                      <Route path="/" element={<HomePage />} />
                      <Route path="/digibat" element={<DigibatPage />} />
                      <Route path="/projects/:projectId" element={<ProjectDetailPage />} />
                      <Route path="/projects/:projectId/dashboard" element={<Index />} />
                      <Route path="/dashboard" element={<Index />} />
                      {/* ADD ALL CUSTOM ROUTES ABOVE THE CATCH-ALL "*" ROUTE */}
                      <Route path="*" element={<NotFound />} />
                    </Routes>
                  </ProtocolDialogProvider>
                </ProjectHierarchyProvider>
              </BrowserRouter>
              <DemoCredit />
            </ProtocolFilterProvider>
          </TreeFilterProvider>
        </MasterPlotBridgeProvider>
      </CellSelectionProvider>
    </TooltipProvider>
  </QueryClientProvider>
  </DataRefreshProvider>
);

export default App;
