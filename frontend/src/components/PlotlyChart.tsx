import { lazy, Suspense, useCallback, useRef, useState } from 'react';
import Plotly from 'plotly.js-strict-dist-min';
import { Download } from 'lucide-react';
import {
  ContextMenu,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuLabel,
  ContextMenuSeparator,
  ContextMenuTrigger,
} from '@/components/ui/context-menu';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/components/ui/dropdown-menu';
import { tracesToCsv, downloadBlob, exportZip, type ExportContext } from '@/lib/plot/exportUtils';

const Plot = lazy(() => import('@/lib/plot/plotlyStrict'));

export interface TraceIndexToCell {
  idNo: number;
  cellName: string;
}

interface PlotlyChartProps {
  data: Plotly.Data[];
  layout: Partial<Plotly.Layout>;
  config?: Partial<Plotly.Config>;
  onClick?: (event: Plotly.PlotMouseEvent) => void;
  onContextMenu?: (cell: TraceIndexToCell) => void;
  traceIndexToCell?: Map<number, TraceIndexToCell>;
  className?: string;
  style?: React.CSSProperties;
  /** Show download button (default true) */
  showDownloadButton?: boolean;
  /** Optional filename for download (defaults to chart title) */
  downloadFilename?: string;
  /** Provenance bundled into ZIP exports so the figure is reproducible from source data. */
  exportContext?: ExportContext;
  /**
   * When true, hovering a trace dims every trace of a *different* cell so the
   * hovered cell pops out of a dense overlay. Cell identity is keyed off trace
   * colour (the scheme assigns one colour per cell), so no per-trace mapping is
   * needed. Opt-in — off by default, so plots that don't pass it behave exactly
   * as before.
   */
  hoverFocus?: boolean;
}

/** Non-hovered traces fade to this fraction of their baseline opacity. */
const HOVER_DIM_FACTOR = 0.14;

/** A trace's cell-identity colour (line wins, then marker, then fill). */
const traceFocusColor = (t: unknown): string | undefined => {
  const tr = t as { line?: { color?: unknown }; marker?: { color?: unknown }; fillcolor?: unknown };
  if (typeof tr?.line?.color === 'string') return tr.line.color;
  if (typeof tr?.marker?.color === 'string') return tr.marker.color;
  if (typeof tr?.fillcolor === 'string') return tr.fillcolor;
  return undefined;
};

const PlotlyChart = ({
  data,
  layout,
  config,
  onClick,
  onContextMenu,
  traceIndexToCell,
  className,
  style,
  showDownloadButton = true,
  downloadFilename: downloadFilenameProp,
  exportContext,
  hoverFocus = false,
}: PlotlyChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [menuCell, setMenuCell] = useState<TraceIndexToCell | null>(null);
  // Hover-focus state: baseline opacities captured at hover-start, and the
  // colour currently focused (so repeated hover events on the same cell don't
  // re-restyle the whole figure on every mousemove).
  const baselineOpacityRef = useRef<number[] | null>(null);
  const focusedColorRef = useRef<string | null>(null);
  const titleText = typeof layout?.title === 'string' ? layout.title : layout?.title?.text;
  const filename = (downloadFilenameProp ?? titleText ?? 'chart')
    .replace(/[:/\\*?"<>|]/g, '')
    .replace(/\s+/g, '_')
    .slice(0, 100);

  const defaultConfig: Partial<Plotly.Config> = {
    responsive: true,
    displayModeBar: false,
    modeBarButtonsToRemove: ['lasso2d', 'select2d'],
    toImageButtonOptions: {
      format: 'png',
      filename,
      scale: 3,
    },
    ...config,
  };

  const defaultLayout: Partial<Plotly.Layout> = {
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: { family: 'Inter, sans-serif', color: '#3a3a3c' },
    margin: { t: 40, r: 40, b: 50, l: 60 },
    ...layout,
  };

  const getPlotlyEl = () =>
    containerRef.current?.querySelector('.js-plotly-plot') as HTMLElement | null;

  // Detect hovered trace when context menu opens so we can offer "Select cell"
  const handleMenuOpenChange = useCallback(
    (open: boolean) => {
      if (!open) return;
      if (!traceIndexToCell) { setMenuCell(null); return; }
      type HoverDiv = HTMLElement & { _hoverdata?: Array<{ curveNumber?: number }> };
      const plotlyDiv = getPlotlyEl() as HoverDiv | null;
      const pt = plotlyDiv?._hoverdata?.[0];
      const cell = pt?.curveNumber != null ? (traceIndexToCell.get(pt.curveNumber) ?? null) : null;
      setMenuCell(cell);
    },
    [traceIndexToCell],
  );

  // Dim every trace whose colour differs from the hovered trace's (i.e. every
  // *other* cell). No-op unless `hoverFocus` is set.
  const handleHover = useCallback(
    (ev: Readonly<Plotly.PlotMouseEvent>) => {
      type DataDiv = HTMLElement & { data?: Array<{ opacity?: number }> };
      const el = getPlotlyEl() as DataDiv | null;
      const traces = el?.data;
      if (!el || !traces?.length) return;
      const cn = ev.points?.[0]?.curveNumber;
      if (cn == null) return;
      const focusColor = traceFocusColor(traces[cn]);
      if (!focusColor) return;
      if (focusedColorRef.current === focusColor) return; // already focused — skip
      if (!baselineOpacityRef.current) {
        baselineOpacityRef.current = traces.map((t) => (typeof t.opacity === 'number' ? t.opacity : 1));
      }
      const base = baselineOpacityRef.current;
      const next = traces.map((t, i) =>
        traceFocusColor(t) === focusColor ? base[i] : base[i] * HOVER_DIM_FACTOR,
      );
      focusedColorRef.current = focusColor;
      Plotly.restyle(el, { opacity: next });
    },
    [],
  );

  const handleUnhover = useCallback(() => {
    const el = getPlotlyEl();
    const base = baselineOpacityRef.current;
    focusedColorRef.current = null;
    baselineOpacityRef.current = null;
    if (el && base) Plotly.restyle(el, { opacity: base });
  }, []);

  const handleExportPng = useCallback(async () => {
    const el = getPlotlyEl();
    if (!el || isDownloading) return;
    setIsDownloading(true);
    try {
      const url = await Plotly.toImage(el, { format: 'png', width: el.offsetWidth, height: el.offsetHeight, scale: 2 });
      const a = document.createElement('a');
      a.href = url; a.download = `${filename}.png`; a.click();
    } finally {
      setIsDownloading(false);
    }
  }, [filename, isDownloading]);

  const handleExportJson = useCallback(() => {
    const json = JSON.stringify({ data, layout: defaultLayout }, null, 2);
    downloadBlob(new Blob([json], { type: 'application/json' }), `${filename}_plotly.json`);
  }, [data, defaultLayout, filename]);

  const handleExportCsv = useCallback(() => {
    downloadBlob(new Blob([tracesToCsv(data)], { type: 'text/csv' }), `${filename}_data.csv`);
  }, [data, filename]);

  const handleExportZip = useCallback(async () => {
    const el = getPlotlyEl();
    if (!el) return;
    const pngUrl = await Plotly.toImage(el, { format: 'png', width: el.offsetWidth, height: el.offsetHeight, scale: 2 });
    await exportZip(
      pngUrl,
      JSON.stringify({ data, layout: defaultLayout }, null, 2),
      tracesToCsv(data),
      filename,
      exportContext,
    );
  }, [data, defaultLayout, filename, exportContext]);

  const handleDownload = handleExportPng;

  return (
    <ContextMenu onOpenChange={handleMenuOpenChange}>
      <ContextMenuTrigger asChild>
        <div
          ref={containerRef}
          className={`relative ${className ?? ''}`.trim()}
          style={style ?? { width: '100%', height: '100%' }}
        >
          <Suspense fallback={<div className="flex items-center justify-center h-64 text-muted-foreground">Loading chart...</div>}>
            <Plot
              data={data}
              layout={defaultLayout}
              config={defaultConfig}
              onClick={onClick}
              onHover={hoverFocus ? handleHover : undefined}
              onUnhover={hoverFocus ? handleUnhover : undefined}
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          </Suspense>
          {showDownloadButton && (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  type="button"
                  title="Export chart (PNG, CSV, JSON, ZIP)"
                  aria-label="Export chart"
                  className="absolute top-2 right-2 z-10 flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 bg-background/80 backdrop-blur-sm border border-border/50 transition-colors"
                >
                  <Download className="h-3.5 w-3.5" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-52">
                <DropdownMenuItem
                  onClick={handleExportPng}
                  disabled={isDownloading}
                >
                  Export PNG
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportCsv}>
                  Export CSV (source data)
                </DropdownMenuItem>
                <DropdownMenuItem onClick={handleExportJson}>
                  Export Plotly JSON
                </DropdownMenuItem>
                <DropdownMenuSeparator />
                <DropdownMenuItem onClick={handleExportZip}>
                  Export ZIP (figure + data + reproduce.py)
                </DropdownMenuItem>
              </DropdownMenuContent>
            </DropdownMenu>
          )}
        </div>
      </ContextMenuTrigger>

      <ContextMenuContent>
        {menuCell && onContextMenu && (
          <>
            <ContextMenuLabel>Cell</ContextMenuLabel>
            <ContextMenuItem onClick={() => onContextMenu(menuCell)}>
              Select &ldquo;{menuCell.cellName}&rdquo;
            </ContextMenuItem>
            <ContextMenuSeparator />
          </>
        )}
        <ContextMenuLabel>Export</ContextMenuLabel>
        <ContextMenuItem onClick={handleExportPng}>Export PNG</ContextMenuItem>
        <ContextMenuItem onClick={handleExportJson}>Export Plotly JSON</ContextMenuItem>
        <ContextMenuItem onClick={handleExportCsv}>Export CSV (source data)</ContextMenuItem>
        <ContextMenuSeparator />
        <ContextMenuItem onClick={handleExportZip}>
          Export ZIP (figure + data + reproduce.py)
        </ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export default PlotlyChart;
