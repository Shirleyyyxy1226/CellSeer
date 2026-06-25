import { ArrowLeft, MousePointerClick } from 'lucide-react';

/**
 * Shared empty state for chart views, shown when nothing is selected yet.
 * Per-cell views (GCD / dV/dQ / dQ/dV) prompt for a cell; aggregate views
 * (Rate Performance) prompt for a hierarchy node. Pass the appropriate `title`.
 */
export function SelectionPrompt({ title, className = '' }: { title: string; className?: string }) {
  return (
    <div
      className={`flex flex-col items-center justify-center gap-3 text-muted-foreground select-none ${className}`}
    >
      <div className="flex items-center gap-2 text-primary/70">
        <ArrowLeft className="h-5 w-5" />
        <MousePointerClick className="h-6 w-6" />
      </div>
      <p className="text-base font-semibold text-foreground">{title}</p>
    </div>
  );
}
