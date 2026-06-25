import * as React from 'react';
import { Search } from 'lucide-react';

import { cn } from '@/lib/utils';

export interface SearchInputProps
  extends Omit<React.ComponentPropsWithoutRef<'input'>, 'onChange' | 'value'> {
  value: string;
  /** Called with the new string value (not the raw event). */
  onChange: (value: string) => void;
  /**
   * Render as a magnifier icon that expands into the field on click, and
   * collapses again on Escape or when blurred while empty.
   */
  collapsible?: boolean;
  /** Tailwind width class for the field / expanded state (defaults to `w-full`). */
  widthClass?: string;
  /** Classes for the outer wrapper. */
  containerClassName?: string;
}

/**
 * The single search field used across the app: a magnifier adornment over a
 * filled (`bg-muted`) input so search boxes read consistently everywhere
 * instead of each view rolling its own bare `<input>`.
 */
export function SearchInput({
  value,
  onChange,
  collapsible = false,
  widthClass,
  containerClassName,
  className,
  placeholder = 'Search…',
  autoFocus,
  ...props
}: SearchInputProps) {
  const inputRef = React.useRef<HTMLInputElement>(null);
  // For the collapsible variant the field is only shown once "open".
  const [open, setOpen] = React.useState(!collapsible);

  // Focus the field as it opens (collapsible only).
  React.useEffect(() => {
    if (collapsible && open) inputRef.current?.focus();
  }, [collapsible, open]);

  const label = typeof placeholder === 'string' ? placeholder : 'Search';

  if (collapsible && !open) {
    return (
      <button
        type="button"
        aria-label={label}
        title={label}
        onClick={() => setOpen(true)}
        className={cn(
          'inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border border-input bg-muted text-muted-foreground shadow-sm transition-colors hover:text-foreground',
          containerClassName,
        )}
      >
        <Search className="h-3.5 w-3.5" />
      </button>
    );
  }

  return (
    <div className={cn('relative', widthClass ?? 'w-full', containerClassName)}>
      <Search
        className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground"
        aria-hidden
      />
      <input
        ref={inputRef}
        type="text"
        value={value}
        placeholder={placeholder}
        autoFocus={autoFocus}
        onChange={(e) => onChange(e.target.value)}
        onKeyDown={(e) => {
          if (collapsible && e.key === 'Escape') {
            onChange('');
            setOpen(false);
            e.currentTarget.blur();
          }
        }}
        onBlur={() => {
          if (collapsible && value.trim() === '') setOpen(false);
        }}
        className={cn(
          'h-8 w-full rounded-md border border-input bg-muted pl-7 pr-2 text-xs text-foreground shadow-sm transition-colors',
          'placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring',
          className,
        )}
        {...props}
      />
    </div>
  );
}
