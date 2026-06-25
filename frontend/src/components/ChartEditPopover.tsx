/**
 * Modular chart edit popover - small icon on each chart that opens edit controls.
 * Use one instance per chart when a page has multiple charts.
 */

import { useId } from 'react';
import { Pencil } from 'lucide-react';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Label } from '@/components/ui/label';
import { Input } from '@/components/ui/input';
import { Checkbox } from '@/components/ui/checkbox';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';

const FONTS = ['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New'];
const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20];

export interface ChartAppearanceConfig {
  chartTitle: string;
  xAxisLabel: string;
  yAxisLabel: string;
  fontFamily: string;
  titleFontSize: number;
  labelFontSize: number;
  legendFontSize: number;
  showLegend: boolean;
  legendPosition: 'in' | 'right-bottom';
  /** Recolour the shown cells from a high-contrast CVD-safe palette so
   *  visually-similar cells become easy to tell apart. Identity hues unchanged. */
  maximizeContrast?: boolean;
}

export type ChartAppearanceKey = keyof ChartAppearanceConfig;

interface ChartEditPopoverProps {
  config: ChartAppearanceConfig;
  onConfigChange: <K extends ChartAppearanceKey>(key: K, value: ChartAppearanceConfig[K]) => void;
  /** Optional label to distinguish multiple charts */
  chartLabel?: string;
}

export function ChartEditPopover({
  config,
  onConfigChange,
  chartLabel,
}: ChartEditPopoverProps) {
  const is3DSurface = chartLabel?.toLowerCase().includes('3d');

  // Unique per-instance ids so multiple popovers on one page never collide
  // (a shared hardcoded id let a label click toggle the wrong plot's checkbox).
  const uid = useId();
  const legendId = `${uid}-show-legend`;
  const contrastId = `${uid}-maximize-contrast`;

  return (
    <Popover>
      <PopoverTrigger asChild>
        {/* Icon-only so it barely covers the plot; sits left of the Export icon
            (right-10) to avoid overlap. Tooltip carries the full label. */}
        <button
          type="button"
          title={chartLabel ? `Edit ${chartLabel} labels & style` : 'Edit chart labels & style'}
          aria-label={chartLabel ? `Edit ${chartLabel} labels & style` : 'Edit chart labels & style'}
          className="absolute top-2 right-10 z-20 flex items-center justify-center p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 bg-background/90 backdrop-blur-sm border border-border/60 shadow-sm transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[85vh] overflow-y-auto" align="end" side="bottom">
        <h3 className="font-semibold text-sm mb-3">
          {chartLabel ? `${chartLabel} — appearance` : 'Chart appearance'}
        </h3>
        <div className="grid gap-3">
          <div>
            <Label className="text-xs mb-1 block">Chart title</Label>
            <Input
              value={config.chartTitle}
              onChange={(e) => onConfigChange('chartTitle', e.target.value)}
              placeholder="e.g. Rate performance"
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">X-axis label</Label>
            <Input
              value={config.xAxisLabel}
              onChange={(e) => onConfigChange('xAxisLabel', e.target.value)}
              placeholder="e.g. Cycle number"
              className="h-9"
            />
          </div>
          <div>
            <Label className="text-xs mb-1 block">
              {is3DSurface ? 'Z-axis label (dV/dQ)' : 'Y-axis label'}
            </Label>
            <Input
              value={config.yAxisLabel}
              onChange={(e) => onConfigChange('yAxisLabel', e.target.value)}
              placeholder={is3DSurface ? 'e.g. dV/dQ (V mAh⁻¹)' : 'e.g. Capacity (mAh g⁻¹)'}
              className="h-9"
            />
          </div>
          {is3DSurface && (
            <div>
              <Label className="text-xs mb-1 block text-muted-foreground">Cycle axis label</Label>
              <p className="text-xs text-muted-foreground px-1">Fixed — always 'Cycle' for the 3D plot.</p>
            </div>
          )}
          <div>
            <Label className="text-xs mb-1 block">Font</Label>
            <Select value={config.fontFamily} onValueChange={(v) => onConfigChange('fontFamily', v)}>
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONTS.map((f) => (
                  <SelectItem key={f} value={f}>
                    {f}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Title font size</Label>
            <Select
              value={String(config.titleFontSize)}
              onValueChange={(v) => onConfigChange('titleFontSize', Number(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Axis label font size</Label>
            <Select
              value={String(config.labelFontSize)}
              onValueChange={(v) => onConfigChange('labelFontSize', Number(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Checkbox
              id={legendId}
              checked={config.showLegend}
              onCheckedChange={(c) => onConfigChange('showLegend', c === true)}
            />
            <Label htmlFor={legendId} className="text-xs cursor-pointer">
              Show legend
            </Label>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Legend position</Label>
            <Select
              value={config.legendPosition}
              onValueChange={(v) => onConfigChange('legendPosition', v as 'in' | 'right-bottom')}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="right-bottom">Right, bottom of figure</SelectItem>
                <SelectItem value="in">Inside figure</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <Label className="text-xs mb-1 block">Legend font size</Label>
            <Select
              value={String(config.legendFontSize)}
              onValueChange={(v) => onConfigChange('legendFontSize', Number(v))}
            >
              <SelectTrigger className="h-9">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {FONT_SIZES.map((s) => (
                  <SelectItem key={s} value={String(s)}>
                    {s} px
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          {config.maximizeContrast !== undefined && (
            <div className="flex items-start gap-2 border-t pt-3">
              <Checkbox
                id={contrastId}
                checked={config.maximizeContrast}
                onCheckedChange={(c) => onConfigChange('maximizeContrast', c === true)}
              />
              <div className="grid gap-0.5">
                <Label htmlFor={contrastId} className="text-xs cursor-pointer">
                  Maximise contrast
                </Label>
                <p className="text-[11px] leading-snug text-muted-foreground">
                  Colour-blind-safe palette; line styles &amp; markers unchanged.
                </p>
              </div>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
