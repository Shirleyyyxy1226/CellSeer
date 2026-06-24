/**
 * Step 2 of the attach-protocol wizard — "Apply" (final step).
 *
 * Composes the (reused) ScopeStep cell picker with the (reused) VerifyStep
 * summary so the user always reviews *which* cells the protocol writes to,
 * and any overwrite, before saving — on every entry path.
 */

import * as React from 'react';

import { ScopeStep } from './ScopeStep';
import { VerifyStep } from './VerifyStep';
import type { EditableProtocolSegment } from '../types';
import type { IndexCell } from '@/lib/api';

export interface ApplyStepProps {
  cellIds: string[];
  onCellIdsChange: (next: string[]) => void;
  segments: EditableProtocolSegment[];
  protocolName: string;
  affectedCells: IndexCell[];
}

const MICRO = 'text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground';

export function ApplyStep({
  cellIds,
  onCellIdsChange,
  segments,
  protocolName,
  affectedCells,
}: ApplyStepProps) {
  return (
    <div className="space-y-5">
      <section className="space-y-2">
        <span className={MICRO}>Applies to</span>
        <ScopeStep cellIds={cellIds} onChange={onCellIdsChange} />
      </section>

      <section className="space-y-2">
        <span className={MICRO}>Review</span>
        <VerifyStep
          cellIds={cellIds}
          segments={segments}
          protocolName={protocolName}
          affectedCells={affectedCells}
        />
      </section>
    </div>
  );
}
