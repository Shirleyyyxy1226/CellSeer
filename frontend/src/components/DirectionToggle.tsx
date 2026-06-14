import { Button } from '@/components/ui/button';

export type ChargeDirection = 'discharge' | 'charge';

interface DirectionToggleProps {
  value: ChargeDirection;
  onChange: (value: ChargeDirection) => void;
  /** Extra classes applied to the outer pill container. */
  className?: string;
}

/**
 * Pill-style two-button switch between "Discharge" and "Charge". Used by
 * panels that render a single direction of capacity at a time (GCD,
 * rate performance, …) so the look-and-feel stays identical everywhere.
 */
export function DirectionToggle({ value, onChange, className }: DirectionToggleProps) {
  const baseOuter = 'inline-flex items-center rounded-full border border-border bg-muted/60 p-1';
  return (
    <div className={className ? `${baseOuter} ${className}` : baseOuter}>
      <Button
        variant="ghost"
        size="sm"
        className={`rounded-full px-4 ${value === 'discharge' ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'}`}
        onClick={() => onChange('discharge')}
      >
        Discharge
      </Button>
      <Button
        variant="ghost"
        size="sm"
        className={`rounded-full px-4 ${value === 'charge' ? 'bg-background shadow-sm hover:bg-background' : 'text-muted-foreground'}`}
        onClick={() => onChange('charge')}
      >
        Charge
      </Button>
    </div>
  );
}
