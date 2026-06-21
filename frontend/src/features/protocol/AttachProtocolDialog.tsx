/**
 * Attach-protocol wizard root.
 *
 * Three-step modal: Scope → Sequence → Verify. The dialog owns wizard
 * state (segments, name, scope, current step) so the steps stay pure and
 * the state survives back-and-forth navigation.
 */

import * as React from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight } from 'lucide-react';

import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogContent,
  DialogFooter,
} from '@/components/ui/dialog';
import { cn } from '@/lib/utils';

import { ScopeStep } from './steps/ScopeStep';
import { SequenceStep } from './steps/SequenceStep';
import { VerifyStep } from './steps/VerifyStep';
import {
  toEditableList,
  toWireList,
  validateSequence,
  makeBlankSegment,
} from './segmentUtils';
import { synthesiseProtocolName } from './cRate';
import type {
  EditableProtocolSegment,
  OpenAttachProtocolOptions,
  OpenEndedProtocolSegment,
} from './types';
import {
  fetchCellRecordIndex,
  setCellProtocolBulk,
  type IndexCellRaw,
} from '@/lib/api';

type WizardStep = 'scope' | 'sequence' | 'verify';
const STEP_ORDER: WizardStep[] = ['scope', 'sequence', 'verify'];
const STEP_LABELS: Record<WizardStep, string> = {
  scope: 'Cells',
  sequence: 'Schedule',
  verify: 'Review',
};

export interface AttachProtocolDialogProps {
  options: OpenAttachProtocolOptions;
  onClose: () => void;
}

export function AttachProtocolDialog({ options, onClose }: AttachProtocolDialogProps) {
  const [step, setStep] = React.useState<WizardStep>(
    options.initialStep ?? (options.cellIds && options.cellIds.length > 0 ? 'sequence' : 'scope'),
  );
  const [cellIds, setCellIds] = React.useState<string[]>(() =>
    Array.from(new Set(options.cellIds ?? [])),
  );
  const [segments, setSegments] = React.useState<EditableProtocolSegment[]>(
    () => {
      const seed = options.seedSegments ?? [];
      if (Array.isArray(seed) && seed.length > 0) {
        return toEditableList(
          seed.map((s) => ({
            cycleStart: (s as OpenEndedProtocolSegment).cycleStart,
            cycleEnd: (s as OpenEndedProtocolSegment).cycleEnd ?? null,
            cRate: (s as OpenEndedProtocolSegment).cRate,
            name: (s as OpenEndedProtocolSegment).name,
          })),
        );
      }
      const formation = makeBlankSegment();
      formation.name = 'formation';
      formation.cycleStart = 1;
      formation.cycleEnd = 3;
      formation.cRate = 0.1;
      const main = makeBlankSegment(formation);
      main.name = 'main cycling';
      main.cRate = 1.0;
      return [formation, main];
    },
  );
  const [protocolName, setProtocolName] = React.useState<string>(
    () => options.seedName ?? '',
  );

  const [affectedCells, setAffectedCells] = React.useState<IndexCellRaw[]>([]);
  const [submitting, setSubmitting] = React.useState(false);
  const [submitError, setSubmitError] = React.useState<string | null>(null);
  const [doneSummary, setDoneSummary] = React.useState<{
    applied: string[];
    missing: string[];
    name: string;
  } | null>(null);

  React.useEffect(() => {
    if (cellIds.length === 0) {
      setAffectedCells([]);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetchCellRecordIndex();
        if (cancelled) return;
        const idx = new Map<string, IndexCellRaw>();
        for (const c of res.cells ?? []) idx.set(c.cellId, c);
        const out: IndexCellRaw[] = [];
        for (const id of cellIds) {
          const c = idx.get(id);
          if (c) out.push(c);
        }
        setAffectedCells(out);
      } catch {
        // Non-fatal
      }
    })();
    return () => { cancelled = true; };
  }, [cellIds]);

  const sequenceErrors = React.useMemo(
    () => validateSequence(segments),
    [segments],
  );
  const sequenceValid =
    segments.length > 0 && sequenceErrors.every((e) => e === '');

  const canAdvance: Record<WizardStep, boolean> = {
    scope: cellIds.length > 0,
    sequence: sequenceValid,
    verify: true,
  };

  const stepIndex = STEP_ORDER.indexOf(step);
  const goNext = () => { const next = STEP_ORDER[stepIndex + 1]; if (next) setStep(next); };
  const goPrev = () => { const prev = STEP_ORDER[stepIndex - 1]; if (prev) setStep(prev); };

  const handleSubmit = async () => {
    if (!sequenceValid || cellIds.length === 0) return;
    setSubmitting(true);
    setSubmitError(null);
    try {
      const wire = toWireList(segments);
      const name = (protocolName.trim() || synthesiseProtocolName(segments)).trim();
      const res = await setCellProtocolBulk({
        cellIds,
        protocolName: name || null,
        segments: wire,
      });
      setDoneSummary({ applied: res.applied, missing: res.missing, name: res.protocolName });
      options.onSaved?.({ applied: res.applied, protocolName: res.protocolName, segments: res.segments });
    } catch (err) {
      setSubmitError(err instanceof Error ? err.message : 'Failed to save protocol');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose(); }}>
      <DialogContent className="max-w-4xl gap-0 p-0 sm:rounded-xl overflow-hidden">
        {/* Header */}
        <div className="border-b bg-muted/30 px-7 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <h2 className="text-base font-semibold text-foreground">Attach protocol</h2>
              <p className="mt-0.5 text-[13px] text-muted-foreground">
                Define cycling stages for the selected cells.
              </p>
            </div>
            {!doneSummary && (
              <Stepper currentStep={step} onStepClick={(s, idx) => {
                // allow clicking back to visited steps
                if (idx < stepIndex) setStep(s);
              }} stepIndex={stepIndex} />
            )}
          </div>
        </div>

        {/* Body */}
        <div className="max-h-[62vh] min-h-[320px] overflow-y-auto px-7 py-5">
          {doneSummary ? (
            <SuccessPanel summary={doneSummary} />
          ) : step === 'scope' ? (
            <ScopeStep cellIds={cellIds} onChange={setCellIds} />
          ) : step === 'sequence' ? (
            <SequenceStep
              segments={segments}
              onSegmentsChange={setSegments}
              protocolName={protocolName}
              onProtocolNameChange={setProtocolName}
            />
          ) : (
            <VerifyStep
              cellIds={cellIds}
              segments={segments}
              protocolName={protocolName.trim() || synthesiseProtocolName(segments)}
              affectedCells={affectedCells}
            />
          )}
          {submitError && (
            <div className="mt-4 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-[12px] text-destructive">
              {submitError}
            </div>
          )}
        </div>

        {/* Footer */}
        <DialogFooter className="border-t bg-muted/20 px-7 py-3">
          {doneSummary ? (
            <Button onClick={onClose} className="bg-emerald-600 hover:bg-emerald-600/90">
              Done
            </Button>
          ) : (
            <div className="flex w-full items-center justify-between gap-3">
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={goPrev}
                disabled={stepIndex === 0 || submitting}
                className="gap-1 text-muted-foreground"
              >
                <ChevronLeft className="h-4 w-4" />
                Back
              </Button>
              <div className="flex items-center gap-2.5">
                {step === 'verify' && cellIds.length > 0 && (
                  <span className="hidden text-[12px] text-muted-foreground sm:inline">
                    {cellIds.length} cell{cellIds.length === 1 ? '' : 's'} selected
                  </span>
                )}
                <Button
                  type="button"
                  variant="outline"
                  size="sm"
                  onClick={onClose}
                  disabled={submitting}
                >
                  Cancel
                </Button>
                {step !== 'verify' ? (
                  <Button
                    type="button"
                    size="sm"
                    onClick={goNext}
                    disabled={!canAdvance[step]}
                    className="gap-1 bg-emerald-600 hover:bg-emerald-600/90"
                  >
                    Continue
                    <ChevronRight className="h-4 w-4" />
                  </Button>
                ) : (
                  <Button
                    type="button"
                    size="sm"
                    onClick={handleSubmit}
                    disabled={submitting || !sequenceValid || cellIds.length === 0}
                    className="min-w-[80px] bg-emerald-600 hover:bg-emerald-600/90"
                  >
                    {submitting ? 'Saving…' : 'Save protocol'}
                  </Button>
                )}
              </div>
            </div>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Stepper({
  currentStep,
  stepIndex,
  onStepClick,
}: {
  currentStep: WizardStep;
  stepIndex: number;
  onStepClick: (step: WizardStep, idx: number) => void;
}) {
  return (
    <ol className="flex items-center gap-0">
      {STEP_ORDER.map((s, idx) => {
        const isCurrent = s === currentStep;
        const isPast = idx < stepIndex;
        const isLast = idx === STEP_ORDER.length - 1;
        return (
          <li key={s} className="flex items-center">
            <button
              type="button"
              onClick={() => onStepClick(s, idx)}
              disabled={!isPast}
              className={cn(
                'flex items-center gap-2 rounded-md px-2 py-1 text-[12px] font-medium transition-colors',
                isCurrent && 'text-foreground',
                isPast && 'cursor-pointer text-emerald-700 dark:text-emerald-400 hover:bg-muted',
                !isCurrent && !isPast && 'cursor-default text-muted-foreground/60',
              )}
            >
              <span
                className={cn(
                  'flex h-5 w-5 shrink-0 items-center justify-center rounded-full text-[10px] font-semibold transition-colors',
                  isCurrent && 'bg-emerald-600 text-white ring-2 ring-emerald-600/20',
                  isPast && 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/50 dark:text-emerald-300',
                  !isCurrent && !isPast && 'border border-border bg-background text-muted-foreground',
                )}
              >
                {isPast ? '✓' : idx + 1}
              </span>
              {STEP_LABELS[s]}
            </button>
            {!isLast && (
              <span className={cn('mx-1 h-px w-6', idx < stepIndex ? 'bg-emerald-300 dark:bg-emerald-700' : 'bg-border')} />
            )}
          </li>
        );
      })}
    </ol>
  );
}

function SuccessPanel({
  summary,
}: {
  summary: { applied: string[]; missing: string[]; name: string };
}) {
  return (
    <div className="flex flex-col items-center gap-4 py-10 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-full bg-emerald-50 ring-8 ring-emerald-50/60 dark:bg-emerald-900/30 dark:ring-emerald-900/20">
        <CheckCircle2 className="h-8 w-8 text-emerald-600 dark:text-emerald-400" />
      </div>
      <div>
        <h4 className="text-[15px] font-semibold text-foreground">Protocol attached</h4>
        <p className="mt-1 text-[13px] text-muted-foreground">
          <span className="font-mono font-medium text-foreground">{summary.name}</span>
          {' '}saved to {summary.applied.length} cell{summary.applied.length === 1 ? '' : 's'}.
        </p>
      </div>
      {summary.missing.length > 0 && (
        <div className="max-w-sm rounded-lg border border-amber-200 bg-amber-50 px-4 py-2.5 text-[12px] text-amber-800 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-300">
          {summary.missing.length} cell{summary.missing.length === 1 ? ' was' : 's were'} not found in this project and were skipped.
        </div>
      )}
    </div>
  );
}
