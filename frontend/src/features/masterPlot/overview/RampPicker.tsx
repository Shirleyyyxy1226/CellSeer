/**
 * Colour-ramp picker. A small select that switches the ramp used to
 * colour the metric-driven views. Options are the keys of the ramp registry
 * with friendly labels; default is viridis so there is no visual change until a
 * user picks another ramp.
 */
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import { RAMPS, type RampId } from './colours';

const RAMP_LABELS: Record<RampId, string> = {
  viridis: 'Viridis',
  cividis: 'Cividis',
  redYellowGreen: 'Red–Yellow–Green',
};

export default function RampPicker({
  value,
  onChange,
}: {
  value: RampId;
  onChange: (id: RampId) => void;
}) {
  return (
    <Select value={value} onValueChange={(v) => onChange(v as RampId)}>
      <SelectTrigger className="h-8 w-[150px] text-sm bg-muted border-input shadow-sm" aria-label="Colour ramp">
        <span className="mr-1 text-xs text-muted-foreground">Ramp:</span>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        {(Object.keys(RAMPS) as RampId[]).map((id) => (
          <SelectItem key={id} value={id}>
            {RAMP_LABELS[id]}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  );
}
