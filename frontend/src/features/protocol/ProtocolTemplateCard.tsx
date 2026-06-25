/**
 * Single template tile in the wizard "Templates" rail.
 */

import * as React from 'react';
import { Check, Trash2 } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';

import { ProtocolBandPreview } from './ProtocolBandPreview';
import type { ProtocolTemplate } from '@/lib/api';

export interface ProtocolTemplateCardProps {
  template: ProtocolTemplate;
  selected: boolean;
  onSelect: () => void;
  onDelete?: () => void;
  deleting?: boolean;
}

export function ProtocolTemplateCard({
  template,
  selected,
  onSelect,
  onDelete,
  deleting = false,
}: ProtocolTemplateCardProps) {
  const segCount = template.segments.length;
  return (
    <div
      className={cn(
        'group relative cursor-pointer rounded-lg border transition-all',
        selected
          ? 'border-primary bg-primary/5 shadow-sm dark:bg-primary/10'
          : 'border-border bg-card hover:border-primary/40 hover:bg-muted/30',
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex w-full flex-col gap-2 p-2.5 text-left"
      >
        <div className="flex items-center justify-between gap-2">
          <span className={cn('text-[13px] font-medium', selected ? 'text-primary' : 'text-foreground')}>
            {template.name}
          </span>
          <div className="flex items-center gap-1">
            {template.isBuiltin && (
              <span className="rounded bg-muted px-1 py-0.5 text-[9px] font-semibold uppercase tracking-wider text-muted-foreground">
                builtin
              </span>
            )}
            {selected && (
              <span className="flex h-4 w-4 items-center justify-center rounded-full bg-primary">
                <Check className="h-2.5 w-2.5 text-primary-foreground" />
              </span>
            )}
          </div>
        </div>
        <ProtocolBandPreview segments={template.segments} height={16} showLabels={false} />
        <span className="text-[11px] text-muted-foreground">
          {segCount > 0 ? `${segCount} stage${segCount === 1 ? '' : 's'}` : 'No stages'}
        </span>
      </button>

      {!template.isBuiltin && onDelete && (
        <Button
          type="button"
          size="icon"
          variant="ghost"
          className={cn(
            'absolute right-1.5 top-1.5 h-5 w-5 text-muted-foreground/40 opacity-0 transition-opacity',
            'hover:bg-destructive/10 hover:text-destructive group-hover:opacity-100 focus:opacity-100',
          )}
          disabled={deleting}
          onClick={(e) => { e.stopPropagation(); onDelete(); }}
          title="Delete template"
        >
          <Trash2 className="h-3 w-3" />
        </Button>
      )}
    </div>
  );
}
