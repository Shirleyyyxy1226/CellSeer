import { useState } from 'react';
import * as SliderPrimitive from '@radix-ui/react-slider';
import { type DiffSmoothing } from '@/lib/api';
import { DEFAULT_SMOOTHING } from './useDifferentialData';

const KERNELS = [3, 5, 7]; // smoothing-kernel widths (point count)

interface VSliderProps {
  label: string;
  caption: string;
  min: number;
  max: number;
  step: number;
  value: number;
  display: string;
  onValueChange: (v: number) => void;
}

/** A single labelled vertical slider (Radix, styled for vertical orientation). */
function VSlider({ label, caption, min, max, step, value, display, onValueChange }: VSliderProps) {
  return (
    <div className="flex flex-col items-center gap-1.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      <SliderPrimitive.Root
        orientation="vertical"
        className="relative flex h-28 w-5 touch-none select-none flex-col items-center"
        min={min}
        max={max}
        step={step}
        value={[value]}
        onValueChange={([v]) => onValueChange(v)}
      >
        <SliderPrimitive.Track className="relative w-2 grow overflow-hidden rounded-full bg-secondary">
          <SliderPrimitive.Range className="absolute w-full bg-[#003f75]" />
        </SliderPrimitive.Track>
        <SliderPrimitive.Thumb className="block h-4 w-4 rounded-full border-2 border-[#003f75] bg-[#003f75] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" />
      </SliderPrimitive.Root>
      <span className="text-[11px] tabular-nums">{display}</span>
      <span className="text-[9px] text-muted-foreground">{caption}</span>
    </div>
  );
}

interface Props {
  value: DiffSmoothing;
  onChange: (s: DiffSmoothing) => void;
}

/**
 * "Adjust smoothing" panel for the differential dashboards: a method selector
 * (LEAN vs raw) plus two vertical sliders for the LEAN resolution (bin count)
 * and smoothing-kernel width. Default params hit the precomputed parquet; any
 * change triggers an on-the-fly recompute on the backend.
 */
export function SmoothingControls({ value, onChange }: Props) {
  const [open, setOpen] = useState(false);
  const isDefault =
    value.method === DEFAULT_SMOOTHING.method &&
    value.targetBins === DEFAULT_SMOOTHING.targetBins &&
    value.kernel === DEFAULT_SMOOTHING.kernel;
  const kernelIdx = KERNELS.indexOf(value.kernel) < 0 ? 1 : KERNELS.indexOf(value.kernel);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        title="Adjust dQ/dV smoothing (method, resolution, kernel)"
        className={`inline-flex h-7 items-center gap-1 rounded-md border border-border px-3 text-[11px] transition-colors ${
          open ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted hover:text-foreground'
        }`}
      >
        Adjust smoothing
        {!isDefault && <span className="ml-0.5 h-1.5 w-1.5 rounded-full bg-amber-400" />}
      </button>

      {open && (
        <div className="absolute right-0 z-20 mt-1 w-64 space-y-3 rounded-md border border-border bg-background p-3 shadow-lg">
          <div className="flex items-center justify-between">
            <span className="text-[11px] text-muted-foreground">Method</span>
            <div className="inline-flex items-center overflow-hidden rounded-md border border-border">
              {(['lean', 'raw'] as const).map((m) => (
                <button
                  key={m}
                  type="button"
                  className={`h-7 px-2.5 text-[11px] capitalize transition-colors ${
                    value.method === m
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted'
                  }`}
                  onClick={() => onChange({ ...value, method: m })}
                >
                  {m}
                </button>
              ))}
            </div>
          </div>

          {value.method === 'lean' ? (
            <>
              <div className="flex justify-around gap-4 pt-1">
                <VSlider
                  label="Resolution"
                  caption="bins"
                  min={80}
                  max={300}
                  step={10}
                  value={value.targetBins}
                  display={String(value.targetBins)}
                  onValueChange={(v) => onChange({ ...value, targetBins: v })}
                />
                <VSlider
                  label="Smoothing"
                  caption="kernel"
                  min={0}
                  max={2}
                  step={1}
                  value={kernelIdx}
                  display={`${value.kernel}-pt`}
                  onValueChange={(i) => onChange({ ...value, kernel: KERNELS[i] })}
                />
              </div>
            </>
          ) : (
            <p className="text-[10px] leading-snug text-muted-foreground">
              Raw finite difference — no smoothing, the unprocessed derivative.
            </p>
          )}

          <div className="flex justify-end border-t border-border pt-2">
            <button
              type="button"
              className="text-[11px] text-primary hover:underline disabled:opacity-40"
              onClick={() => onChange(DEFAULT_SMOOTHING)}
              disabled={isDefault}
            >
              Reset to default
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
