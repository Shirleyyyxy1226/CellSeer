export type ChargeDirection = 'discharge' | 'charge';

interface DirectionToggleProps {
  value: ChargeDirection;
  onChange: (value: ChargeDirection) => void;
  /** Extra classes applied to the outer pill container. */
  className?: string;
  /** When true the toggle is rendered but non-interactive and visually dimmed. */
  disabled?: boolean;
  title?: string;
}

/**
 * Pill-style two-button switch between "Discharge" and "Charge". Used by
 * panels that render a single direction of capacity at a time (GCD,
 * rate performance, …) so the look-and-feel stays identical everywhere.
 */
export function DirectionToggle({ value, onChange, className, disabled, title }: DirectionToggleProps) {
  // Match Single/Multi toggle: border + overflow-hidden container, bg-primary active state.
  const baseOuter = 'inline-flex items-center rounded-md border border-border overflow-hidden';
  const disabledStyle = disabled ? 'opacity-40 pointer-events-none' : '';
  return (
    <div className={[baseOuter, disabledStyle, className ?? ''].filter(Boolean).join(' ')} title={title}>
      <button
        type="button"
        className={`px-3 h-7 text-[11px] inline-flex items-center transition-colors ${
          value === 'discharge'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
        onClick={() => !disabled && onChange('discharge')}
        disabled={disabled}
      >
        Discharge
      </button>
      <button
        type="button"
        className={`px-3 h-7 text-[11px] inline-flex items-center border-l border-border transition-colors ${
          value === 'charge'
            ? 'bg-primary text-primary-foreground'
            : 'text-muted-foreground hover:text-foreground hover:bg-muted'
        }`}
        onClick={() => !disabled && onChange('charge')}
        disabled={disabled}
      >
        Charge
      </button>
    </div>
  );
}
