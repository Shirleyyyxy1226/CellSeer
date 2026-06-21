/**
 * Step 2 of the attach-protocol wizard.
 *
 * Two columns:
 *   - Left: templates rail (builtin + user-saved) + "Save as template"
 *   - Right: live band preview + segment editor
 */

import * as React from 'react';
import { BookMarked, Save } from 'lucide-react';

import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { cn } from '@/lib/utils';

import { ProtocolBandPreview } from '../ProtocolBandPreview';
import { ProtocolSegmentEditor } from '../ProtocolSegmentEditor';
import { ProtocolTemplateCard } from '../ProtocolTemplateCard';
import { useProtocolTemplates } from '../useProtocolTemplates';
import { toEditableList, toWireList } from '../segmentUtils';
import { synthesiseProtocolName } from '../cRate';
import type { EditableProtocolSegment } from '../types';
import type { ProtocolTemplate } from '@/lib/api';

export interface SequenceStepProps {
  segments: EditableProtocolSegment[];
  onSegmentsChange: (next: EditableProtocolSegment[]) => void;
  protocolName: string;
  onProtocolNameChange: (next: string) => void;
}

export function SequenceStep({
  segments,
  onSegmentsChange,
  protocolName,
  onProtocolNameChange,
}: SequenceStepProps) {
  const templates = useProtocolTemplates();
  const [selectedTemplateId, setSelectedTemplateId] = React.useState<string | null>(null);
  const [saveOpen, setSaveOpen] = React.useState(false);
  const [savedTemplateName, setSavedTemplateName] = React.useState('');

  const synthesised = React.useMemo(() => synthesiseProtocolName(segments), [segments]);

  const isSynthName = !protocolName || protocolName === synthesised;
  React.useEffect(() => {
    if (isSynthName) onProtocolNameChange(synthesised);
  }, [synthesised, isSynthName, onProtocolNameChange]);

  const handleSelectTemplate = (tmpl: ProtocolTemplate) => {
    setSelectedTemplateId(tmpl.id);
    onSegmentsChange(toEditableList(tmpl.segments));
    onProtocolNameChange(tmpl.name);
  };

  const handleEditSegments = (next: EditableProtocolSegment[]) => {
    setSelectedTemplateId(null);
    onSegmentsChange(next);
  };

  const handleSaveTemplate = async () => {
    if (!savedTemplateName.trim()) return;
    const saved = await templates.save({
      name: savedTemplateName.trim(),
      description: null,
      segments: toWireList(segments),
    });
    if (saved) {
      setSelectedTemplateId(saved.id);
      setSaveOpen(false);
      setSavedTemplateName('');
    }
  };

  return (
    <div className="grid gap-5 lg:grid-cols-[220px_1fr]">
      {/* ── Templates sidebar ── */}
      <aside className="flex flex-col gap-3">
        <div className="flex items-center gap-1.5">
          <BookMarked className="h-3.5 w-3.5 text-muted-foreground" />
          <span className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
            Templates
          </span>
        </div>

        <div className="flex flex-col gap-2">
          {templates.loading && (
            <div className="rounded-lg border border-dashed border-border p-4 text-center text-xs text-muted-foreground">
              Loading…
            </div>
          )}
          {templates.error && (
            <div className="rounded-lg border border-destructive/30 bg-destructive/10 p-2 text-[11px] text-destructive">
              {templates.error}
            </div>
          )}
          {(templates.templates ?? []).map((tmpl) => (
            <ProtocolTemplateCard
              key={tmpl.id}
              template={tmpl}
              selected={selectedTemplateId === tmpl.id}
              onSelect={() => handleSelectTemplate(tmpl)}
              onDelete={
                tmpl.isBuiltin ? undefined : () => { void templates.remove(tmpl.id); }
              }
              deleting={templates.deletingId === tmpl.id}
            />
          ))}
          {!templates.loading && (templates.templates ?? []).length === 0 && (
            <p className="text-center text-[11px] text-muted-foreground/60">No templates yet.</p>
          )}
        </div>

        {/* Save template */}
        <div className="mt-auto pt-2 border-t border-border">
          {saveOpen ? (
            <div className="space-y-2 rounded-lg border border-border bg-muted/20 p-2.5">
              <Input
                value={savedTemplateName}
                onChange={(e) => setSavedTemplateName(e.target.value)}
                placeholder="Template name"
                className="h-8 text-sm"
                autoFocus
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveTemplate(); }}
              />
              <div className="flex justify-end gap-1.5">
                <Button type="button" variant="ghost" size="sm" onClick={() => setSaveOpen(false)} disabled={templates.saving}>
                  Cancel
                </Button>
                <Button
                  type="button"
                  size="sm"
                  onClick={handleSaveTemplate}
                  disabled={templates.saving || !savedTemplateName.trim() || segments.length === 0}
                  className="bg-emerald-600 hover:bg-emerald-600/90"
                >
                  {templates.saving ? 'Saving…' : 'Save'}
                </Button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              onClick={() => setSaveOpen(true)}
              disabled={segments.length === 0}
              className="flex w-full items-center justify-center gap-1.5 rounded-md border border-dashed border-border py-2 text-[12px] font-medium text-muted-foreground transition-colors hover:border-emerald-300 hover:bg-emerald-50/50 hover:text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50 dark:hover:bg-emerald-950/20"
            >
              <Save className="h-3.5 w-3.5" />
              Save as template
            </button>
          )}
        </div>
      </aside>

      {/* ── Main editor ── */}
      <section className="flex flex-col gap-4 min-w-0">
        {/* Protocol name + live band */}
        <div className="rounded-lg border border-border bg-card p-3.5">
          <div className="mb-2 flex items-center justify-between gap-2">
            <label className="text-[12px] font-semibold text-foreground">Protocol name</label>
            {isSynthName ? (
              <span className="rounded-full bg-muted px-2 py-0.5 text-[10px] text-muted-foreground">
                Auto
              </span>
            ) : (
              <button
                type="button"
                onClick={() => onProtocolNameChange(synthesised)}
                className="rounded text-[11px] text-muted-foreground hover:text-foreground underline-offset-2 hover:underline"
              >
                Reset to auto
              </button>
            )}
          </div>
          <Input
            value={protocolName}
            onChange={(e) => onProtocolNameChange(e.target.value)}
            placeholder={synthesised || 'Protocol name'}
            className={cn('mb-3 h-9 text-sm', !isSynthName && 'font-medium')}
          />
          <ProtocolBandPreview segments={segments} height={36} />
        </div>

        {/* Segment editor */}
        <ProtocolSegmentEditor segments={segments} onChange={handleEditSegments} />
      </section>
    </div>
  );
}
