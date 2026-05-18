/**
 * Modular chart edit popover - small icon on each chart that opens edit controls.
 * Use one instance per chart when a page has multiple charts.
 */

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

export const FONTS = ['Inter', 'Arial', 'Helvetica', 'Times New Roman', 'Georgia', 'Courier New'];
export const FONT_SIZES = [9, 10, 11, 12, 14, 16, 18, 20];

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
  showConnectedLine?: boolean;
}

export type ChartAppearanceKey = keyof ChartAppearanceConfig;

interface ChartEditPopoverProps {
  config: ChartAppearanceConfig;
  onConfigChange: <K extends ChartAppearanceKey>(key: K, value: ChartAppearanceConfig[K]) => void;
  /** Show the "Connect points with lines" option (for rate performance charts) */
  showConnectedLineOption?: boolean;
  /** Optional label to distinguish multiple charts */
  chartLabel?: string;
}

export function ChartEditPopover({
  config,
  onConfigChange,
  showConnectedLineOption = false,
  chartLabel,
}: ChartEditPopoverProps) {
  return (
    <Popover>
      <PopoverTrigger asChild>
        <button
          type="button"
          title={chartLabel ? `Edit ${chartLabel}` : 'Edit chart'}
          aria-label={chartLabel ? `Edit ${chartLabel}` : 'Edit chart'}
          className="absolute top-2 right-2 z-10 p-1.5 rounded-md text-muted-foreground hover:text-foreground hover:bg-muted/80 bg-background/80 backdrop-blur-sm border border-border/50 transition-colors"
        >
          <Pencil className="h-3.5 w-3.5" />
        </button>
      </PopoverTrigger>
      <PopoverContent className="w-80 max-h-[85vh] overflow-y-auto" align="end" side="left">
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
            <Label className="text-xs mb-1 block">Y-axis label</Label>
            <Input
              value={config.yAxisLabel}
              onChange={(e) => onConfigChange('yAxisLabel', e.target.value)}
              placeholder="e.g. Capacity (mAh g⁻¹)"
              className="h-9"
            />
          </div>
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
              id="chart-show-legend"
              checked={config.showLegend}
              onCheckedChange={(c) => onConfigChange('showLegend', c === true)}
            />
            <Label htmlFor="chart-show-legend" className="text-xs cursor-pointer">
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
          {showConnectedLineOption && config.showConnectedLine !== undefined && (
            <div className="flex items-center gap-2">
              <Checkbox
                id="chart-show-connected"
                checked={config.showConnectedLine}
                onCheckedChange={(c) => onConfigChange('showConnectedLine', c === true)}
              />
              <Label htmlFor="chart-show-connected" className="text-xs cursor-pointer">
                Connect points with lines
              </Label>
            </div>
          )}
        </div>
      </PopoverContent>
    </Popover>
  );
}
