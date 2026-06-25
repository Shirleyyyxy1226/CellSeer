import { Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';

type LoadingSize = 'sm' | 'md' | 'lg';

interface LoadingIndicatorProps {
  /** Optional caption shown next to / under the spinner. */
  label?: string;
  /** Size preset for the spinner icon + text. */
  size?: LoadingSize;
  /**
   * Layout:
   *  - 'inline'  : spinner + label on a single line (default)
   *  - 'stacked' : spinner above the label, centred
   *  - 'frame'   : 'stacked' inside a flex container that fills its parent —
   *                use this for chart placeholders so the spinner is centred
   *                in the chart frame while data is loading.
   */
  variant?: 'inline' | 'stacked' | 'frame';
  /** Minimum height when variant === 'frame'. Defaults to 100%. */
  minHeight?: number | string;
  /** Extra classes merged onto the wrapping element. */
  className?: string;
}

const SIZE_TOKENS: Record<LoadingSize, { icon: string; text: string; gap: string }> = {
  sm: { icon: 'h-3 w-3', text: 'text-xs', gap: 'gap-1.5' },
  md: { icon: 'h-4 w-4', text: 'text-sm', gap: 'gap-2' },
  lg: { icon: 'h-6 w-6', text: 'text-sm', gap: 'gap-3' },
};

/**
 * Reusable loading indicator with an animated spinner.
 *
 * Use `variant="frame"` inside chart placeholders to centre the spinner in
 * the chart's frame while the underlying data is still loading.
 */
export function LoadingIndicator({
  label = 'Loading…',
  size = 'md',
  variant = 'inline',
  minHeight,
  className,
}: LoadingIndicatorProps) {
  const tokens = SIZE_TOKENS[size];
  const spinner = (
    <Loader2 className={cn(tokens.icon, 'animate-spin text-muted-foreground')} aria-hidden />
  );
  const caption = label ? (
    <span className={cn(tokens.text, 'text-muted-foreground')}>{label}</span>
  ) : null;

  if (variant === 'frame') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn(
          'flex h-full w-full flex-col items-center justify-center',
          tokens.gap,
          className,
        )}
        style={minHeight != null ? { minHeight } : undefined}
      >
        {spinner}
        {caption}
        {label && <span className="sr-only">{label}</span>}
      </div>
    );
  }

  if (variant === 'stacked') {
    return (
      <div
        role="status"
        aria-live="polite"
        aria-busy="true"
        className={cn('flex flex-col items-center', tokens.gap, className)}
      >
        {spinner}
        {caption}
      </div>
    );
  }

  return (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className={cn('inline-flex items-center', tokens.gap, className)}
    >
      {spinner}
      {caption}
    </div>
  );
}

export default LoadingIndicator;
