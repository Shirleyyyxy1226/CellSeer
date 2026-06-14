import { useCallback, useState } from 'react';
import type {
  ChartAppearanceConfig,
  ChartAppearanceKey,
} from '@/components/ChartEditPopover';

export type { ChartAppearanceConfig, ChartAppearanceKey };

export interface UseChartAppearanceReturn {
  config: ChartAppearanceConfig;
  /** Setter that matches `<ChartEditPopover onConfigChange>` exactly. */
  onConfigChange: <K extends ChartAppearanceKey>(
    key: K,
    value: ChartAppearanceConfig[K],
  ) => void;
  /** Imperatively set the title (handy when a parent computes a default). */
  setChartTitle: (s: string) => void;
}

// Shared hook so panels don't each duplicate ~50 lines of useState + switch.
export function useChartAppearance(
  initial: Partial<ChartAppearanceConfig> = {},
): UseChartAppearanceReturn {
  const [chartTitle, setChartTitle] = useState(initial.chartTitle ?? '');
  const [xAxisLabel, setXAxisLabel] = useState(initial.xAxisLabel ?? '');
  const [yAxisLabel, setYAxisLabel] = useState(initial.yAxisLabel ?? '');
  const [fontFamily, setFontFamily] = useState(initial.fontFamily ?? 'Inter');
  const [titleFontSize, setTitleFontSize] = useState(initial.titleFontSize ?? 14);
  const [labelFontSize, setLabelFontSize] = useState(initial.labelFontSize ?? 12);
  const [legendFontSize, setLegendFontSize] = useState(initial.legendFontSize ?? 11);
  const [showLegend, setShowLegend] = useState(initial.showLegend ?? true);
  const [legendPosition, setLegendPosition] = useState<'in' | 'right-bottom'>(
    initial.legendPosition ?? 'right-bottom',
  );
  const [showConnectedLine, setShowConnectedLine] = useState<boolean | undefined>(
    initial.showConnectedLine,
  );

  const onConfigChange = useCallback(
    <K extends ChartAppearanceKey>(key: K, value: ChartAppearanceConfig[K]) => {
      switch (key) {
        case 'chartTitle':
          setChartTitle(value as string);
          break;
        case 'xAxisLabel':
          setXAxisLabel(value as string);
          break;
        case 'yAxisLabel':
          setYAxisLabel(value as string);
          break;
        case 'fontFamily':
          setFontFamily(value as string);
          break;
        case 'titleFontSize':
          setTitleFontSize(value as number);
          break;
        case 'labelFontSize':
          setLabelFontSize(value as number);
          break;
        case 'legendFontSize':
          setLegendFontSize(value as number);
          break;
        case 'showLegend':
          setShowLegend(value as boolean);
          break;
        case 'legendPosition':
          setLegendPosition(value as 'in' | 'right-bottom');
          break;
        case 'showConnectedLine':
          setShowConnectedLine((value as boolean | undefined) ?? false);
          break;
      }
    },
    [],
  );

  const config: ChartAppearanceConfig = {
    chartTitle,
    xAxisLabel,
    yAxisLabel,
    fontFamily,
    titleFontSize,
    labelFontSize,
    legendFontSize,
    showLegend,
    legendPosition,
    showConnectedLine,
  };

  return { config, onConfigChange, setChartTitle };
}
