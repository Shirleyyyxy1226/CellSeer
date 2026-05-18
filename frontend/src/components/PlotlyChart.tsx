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
import { tracesToCsv, downloadBlob, exportZip } from '@/lib/exportUtils';

const Plot = lazy(() => import('@/lib/plotlyStrict'));

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
}

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
}: PlotlyChartProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isDownloading, setIsDownloading] = useState(false);
  const [menuCell, setMenuCell] = useState<TraceIndexToCell | null>(null);
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
    await exportZip(pngUrl, JSON.stringify({ data, layout: defaultLayout }, null, 2), tracesToCsv(data), filename);
  }, [data, defaultLayout, filename]);

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
              style={{ width: '100%', height: '100%' }}
              useResizeHandler
            />
          </Suspense>
          {showDownloadButton && (
            <button
              type="button"
              onClick={handleDownload}
              disabled={isDownloading}
              title="Download as PNG"
              aria-label="Download chart as PNG"
              className="absolute top-2 right-10 z-10 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 bg-background/80 backdrop-blur-sm border border-border/50 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <Download className="h-3.5 w-3.5" />
            </button>
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
        <ContextMenuItem onClick={handleExportZip}>Export ZIP (PNG + JSON + CSV)</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenu>
  );
};

export default PlotlyChart;
