/**
 * Reusable cell-metadata view used by:
 *   - the project-upload row drawer (`pages/ProjectDetailPage.tsx`)
 *   - the right-side cell-detail sidebar (`components/CellDetailPanel.tsx`)
 *
 * The component handles four interactions in one place so the two surfaces
 * stay in lock-step:
 *
 *   1. Read-only metadata grid (Cathode / Anode / Build / Electrolyte)
 *   2. Inline edit + save against `PATCH /api/cells/{id}` (via `cellPatch`)
 *   3. Per-cell cycling-file upload (`useCellTestFileAttach`)
 *   4. Per-cell protocol attach (`ProtocolStatusChip` → wizard)
 *
 * The `layout` prop chooses between the wide drawer's 2-column grid and
 * the sidebar's stacked single-column variant.
 */

import { useEffect, useRef, useState } from 'react';
import { Check, ChevronDown, ChevronUp, Clock, Paperclip, Pencil } from 'lucide-react';

import type { CellDatasetSummary, IndexCell } from '@/lib/cell/cellTypes';
import { updateCellMetadata } from '@/lib/api';
import {
  buildPatch,
  draftFromCell,
  PATCH_FIELD_KIND,
  type EditDraft,
  type EditFieldKind,
  type PatchField,
} from '@/lib/cell/cellPatch';
import {
  CYCLING_FILE_ACCEPT,
  flagIsOn,
  fmtBytes,
  fmtNum,
  fmtText,
  hasCyclingDataset,
  prettyDatasetName,
} from '@/lib/cell/cellDisplay';
import { useCellTestFileAttach } from '@/hooks/useCellTestFileAttach';
import { ProtocolStatusChip } from '@/features/protocol';

export type CellMetadataLayout = 'wide' | 'narrow';

const COMPONENT_GROUPS = ['cathode', 'anode', 'electrolyte'] as const;
type ComponentGroup = (typeof COMPONENT_GROUPS)[number];

// Route a source field to a component group by its header prefix.
function routeCustomField(header: unknown): { group: ComponentGroup; label: string } | null {
  const h = typeof header === 'string' ? header.trim() : '';
  if (!h) return null;
  const norm = h.toLowerCase();
  for (const g of COMPONENT_GROUPS) {
    if (norm.startsWith(g)) {
      const rest = h.slice(g.length).replace(/^[\s_:,()-]+/, '').trim();
      const label = rest ? rest.charAt(0).toUpperCase() + rest.slice(1) : h;
      return { group: g, label };
    }
  }
  return null;
}

// Trim noisy precision on numeric values (units live in the header).
function fmtCustomValue(value: unknown): string {
  const s = value == null ? '' : String(value);
  if (s.trim() === '') return s;
  const n = Number(s);
  return Number.isFinite(n) && /\d/.test(s) ? String(Math.round(n * 1000) / 1000) : s;
}

export interface CellMetadataCardProps {
  cell: IndexCell;
  /** `wide` = drawer (2-col), `narrow` = sidebar (1-col + smaller spacing). */
  layout?: CellMetadataLayout;
  /** Fires after a successful metadata PATCH. Parent should refetch index. */
  onCellMetadataUpdated?: () => void;
  /** Fires after a successful cycling-file ingest. */
  onTestFileUploaded?: () => void;
  /** Fires after a successful protocol attach. */
  onProtocolAttached?: () => void;
}

// ---------------------------------------------------------------------------
// Presentation atoms (KvRow, CrumbToken, etc.)
// ---------------------------------------------------------------------------

interface KvEntry {
  key: string;
  label: string;
  value: string;
  raw: unknown;
  title?: string;
  /** When present, this row becomes editable as that PATCH field. */
  field?: PatchField;
}

/**
 * Drop rows whose value is null/empty/"—" so the grid only shows actual
 * data; in edit mode keep editable rows so users can fill them.
 */
function presentRows(
  rows: Array<Omit<KvEntry, 'raw'> & { raw?: unknown }>,
  keepEmpty: boolean,
): KvEntry[] {
  return rows
    .map((r) => ({ raw: r.raw ?? r.value, ...r }))
    .filter((r) => {
      if (keepEmpty && r.field) return true;
      if (r.raw === null || r.raw === undefined) return false;
      const s = String(r.value).trim();
      return s.length > 0 && s !== '—';
    });
}

function KvRow({
  label,
  value,
  title,
  longThreshold = 48,
  editing = false,
  editValue,
  editKind = 'text',
  step,
  onEditChange,
  onEditActivate,
  labelWidth = 88,
}: {
  label: string;
  value: string;
  title?: string;
  longThreshold?: number;
  editing?: boolean;
  editValue?: string;
  editKind?: EditFieldKind;
  step?: number | string;
  onEditChange?: (next: string) => void;
  onEditActivate?: () => void;
  labelWidth?: number;
}) {
  const [expanded, setExpanded] = useState(false);
  const isLong = value.length > longThreshold;

  return (
    <div className="flex items-baseline gap-2 py-0.5 text-[12px] leading-tight">
      <span
        className="shrink-0 text-[10.5px] text-muted-foreground"
        style={{ width: labelWidth }}
      >
        {label}
      </span>
      {editing ? (
        <input
          type={editKind === 'number' ? 'number' : 'text'}
          inputMode={editKind === 'number' ? 'decimal' : undefined}
          step={editKind === 'number' ? step ?? 'any' : undefined}
          value={editValue ?? ''}
          onChange={(e) => onEditChange?.(e.target.value)}
          className="flex-1 min-w-0 rounded border border-border bg-background px-1.5 py-0.5 text-[12px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      ) : (
        <button
          type="button"
          onClick={onEditActivate}
          disabled={!onEditActivate}
          aria-label={onEditActivate ? `Edit ${label}` : undefined}
          title={onEditActivate ? `Edit ${label}` : title ?? value}
          className={`flex-1 min-w-0 rounded text-left text-foreground transition-colors ${
            expanded ? 'whitespace-pre-wrap break-words' : 'truncate'
          } ${onEditActivate ? 'hover:bg-muted/40 cursor-text px-1 -mx-1' : 'cursor-default'}`}
        >
          {value}
        </button>
      )}
      {!editing && isLong && (
        <button
          type="button"
          onClick={() => setExpanded((v) => !v)}
          aria-label={expanded ? 'Collapse value' : 'Expand value'}
          title={expanded ? 'Collapse' : 'Show full value'}
          className="ml-0.5 shrink-0 inline-flex items-center rounded p-0.5 text-muted-foreground hover:bg-muted/70 hover:text-foreground transition-colors"
        >
          {expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
        </button>
      )}
    </div>
  );
}

function CrumbToken({
  children,
  fieldLabel,
  editable = true,
  editing = false,
  editValue,
  editKind = 'text',
  onEditChange,
  onEditActivate,
}: {
  children: React.ReactNode;
  fieldLabel: string;
  editable?: boolean;
  editing?: boolean;
  editValue?: string;
  editKind?: EditFieldKind;
  onEditChange?: (next: string) => void;
  onEditActivate?: () => void;
}) {
  if (!editable) {
    return <span className="text-[11px] text-muted-foreground">{children}</span>;
  }
  if (editing) {
    return (
      <span className="inline-flex items-baseline gap-1">
        <span className="text-[10px] text-muted-foreground">{fieldLabel}</span>
        <input
          type={editKind === 'number' ? 'number' : 'text'}
          inputMode={editKind === 'number' ? 'decimal' : undefined}
          step={editKind === 'number' ? 'any' : undefined}
          value={editValue ?? ''}
          onChange={(e) => onEditChange?.(e.target.value)}
          aria-label={`Edit ${fieldLabel}`}
          className="w-[80px] rounded border border-border bg-background px-1 py-0 text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30"
        />
      </span>
    );
  }
  return (
    <button
      type="button"
      title={onEditActivate ? `Edit ${fieldLabel}` : undefined}
      onClick={onEditActivate}
      className="group inline-flex items-baseline gap-0.5 rounded px-1 py-0 text-[11px] text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
    >
      {children}
      <Pencil className="ml-0.5 h-2.5 w-2.5 opacity-0 transition-opacity group-hover:opacity-60" />
    </button>
  );
}

export function FilePresence({
  has,
  label,
  title,
}: {
  has: boolean;
  label: string;
  title?: string;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
        has
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'border border-dashed border-muted-foreground/30 bg-transparent text-muted-foreground'
      }`}
      title={title ?? (has ? `${label} uploaded` : `${label} pending`)}
    >
      {has ? (
        <Check className="h-3 w-3" aria-hidden />
      ) : (
        <Clock className="h-3 w-3 opacity-70" aria-hidden />
      )}
      {label}
    </span>
  );
}

function DatasetChip({ ds }: { ds: CellDatasetSummary }) {
  const size = fmtBytes(ds.sizeBytes);
  const titleParts = [
    `${ds.name} dataset`,
    ds.createdAt ? `Added ${ds.createdAt}` : null,
    size ? `Size ${size}` : null,
    ds.sourceFileId ? `Source ${ds.sourceFileId}` : null,
  ].filter(Boolean) as string[];
  return (
    <span
      className="inline-flex items-center gap-1 rounded-md bg-emerald-100 px-1.5 py-0.5 text-[10px] font-medium text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300"
      title={titleParts.join(' · ')}
    >
      <Check className="h-3 w-3" aria-hidden />
      {prettyDatasetName(ds.name)}
    </span>
  );
}

function TestFlag({ label, on }: { label: string; on: boolean }) {
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-medium ${
        on
          ? 'bg-emerald-100 text-emerald-700 dark:bg-emerald-900/40 dark:text-emerald-300'
          : 'bg-muted text-muted-foreground/80'
      }`}
      title={on ? `${label}: planned` : `${label}: not planned`}
    >
      <span
        aria-hidden
        className={`inline-block h-1.5 w-1.5 rounded-full ${
          on ? 'bg-emerald-500' : 'bg-muted-foreground/40'
        }`}
      />
      {label}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export function CellMetadataCard({
  cell,
  layout = 'wide',
  onCellMetadataUpdated,
  onTestFileUploaded,
  onProtocolAttached,
}: CellMetadataCardProps) {
  const narrow = layout === 'narrow';

  const planFormation = flagIsOn(cell.doFormation);
  const planRateTest = flagIsOn(cell.doRateTest);
  const planEis = flagIsOn(cell.doEis);
  const anyPlan = planFormation || planRateTest || planEis;
  const datasets = cell.datasets ?? [];
  const hasCycling = hasCyclingDataset(datasets);
  const cyclingAttach = useCellTestFileAttach(cell.cellId, 'cycling', onTestFileUploaded);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachBusy =
    cyclingAttach.status === 'uploading' || cyclingAttach.status === 'processing';

  // --- edit-mode state ----------------------------------------------------
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState<EditDraft>(() => draftFromCell(cell));
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [basisSaving, setBasisSaving] = useState(false);

  const saveCapacityBasis = async (value: string) => {
    setBasisSaving(true);
    try {
      await updateCellMetadata(cell.cellId, { capacityBasis: value === '' ? null : value });
      onCellMetadataUpdated?.();
    } catch {
      /* error surfaces on the next index refresh */
    } finally {
      setBasisSaving(false);
    }
  };

  // When the row's underlying cell changes (parent refresh), reset the
  // draft unless the user is mid-edit — preserves in-progress changes.
  useEffect(() => {
    if (!editing) setDraft(draftFromCell(cell));
  }, [cell, editing]);

  const setField = (f: PatchField, value: string) =>
    setDraft((prev) => ({ ...prev, [f]: value }));

  const enterEdit = () => {
    setDraft(draftFromCell(cell));
    setSaveError(null);
    setEditing(true);
  };
  const cancelEdit = () => {
    setEditing(false);
    setSaveError(null);
    setDraft(draftFromCell(cell));
  };
  const saveEdit = async () => {
    const patch = buildPatch(cell, draft);
    if (Object.keys(patch).length === 0) {
      setEditing(false);
      return;
    }
    setSaving(true);
    setSaveError(null);
    try {
      await updateCellMetadata(cell.cellId, patch);
      setEditing(false);
      onCellMetadataUpdated?.();
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save changes.');
    } finally {
      setSaving(false);
    }
  };

  const provenance = [cell.sourceSystem, cell.sourceRefcode, cell.sourceItemId]
    .filter((x) => x && String(x).trim().length > 0)
    .join(' · ');

  const groupedCustom: Record<ComponentGroup, { key: string; label: string; value: string }[]> = {
    cathode: [],
    anode: [],
    electrolyte: [],
  };
  const leftoverCustom: Array<[string, string]> = [];
  const customMeta = cell.customMeta && typeof cell.customMeta === 'object' ? cell.customMeta : {};
  for (const [k, v] of Object.entries(customMeta)) {
    if (v == null) continue;
    const sval = String(v);
    const routed = routeCustomField(k);
    if (routed) {
      // Empty values are allowed through here; presentRows hides them in view.
      groupedCustom[routed.group].push({ key: k, label: routed.label, value: fmtCustomValue(sval) });
    } else if (sval.trim() !== '') {
      leftoverCustom.push([k, sval]);
    }
  }
  const promotedRows = (g: ComponentGroup) =>
    groupedCustom[g].map((p) => ({ key: `x_${p.key}`, label: p.label, value: p.value, raw: p.value }));

  // -------------------------------------------------------------------------
  // Header crumbs (batch / repeat / category + idNo)
  // -------------------------------------------------------------------------
  type Crumb = {
    key: string;
    label: string;
    text: string;
    editable: boolean;
    field?: PatchField;
  };
  const crumbTokens: Crumb[] = [];
  if (editing || cell.batch != null) {
    crumbTokens.push({
      key: 'batch',
      label: 'Batch',
      text: cell.batch != null ? `Batch ${cell.batch}` : 'Batch —',
      editable: true,
      field: 'batch',
    });
  }
  if (editing || cell.repeat != null) {
    crumbTokens.push({
      key: 'repeat',
      label: 'Repeat',
      text: cell.repeat != null ? `Repeat ${cell.repeat}` : 'Repeat —',
      editable: true,
      field: 'repeat',
    });
  }
  if (editing || cell.category) {
    crumbTokens.push({
      key: 'category',
      label: 'Category',
      text: cell.category || 'Category —',
      editable: true,
      field: 'category',
    });
  }
  crumbTokens.push({ key: 'idno', label: 'ID No.', text: `#${cell.idNo}`, editable: false });

  // -------------------------------------------------------------------------
  // Group rows
  // -------------------------------------------------------------------------
  const cathodeRows = presentRows(
    [
      { key: 'cathode', label: 'Material', value: fmtText(cell.cathode), raw: cell.cathode, field: 'cathode' },
      { key: 'cathode_d', label: 'Diameter', value: fmtNum(cell.cathodeDiameterMm, 2, 'mm'), raw: cell.cathodeDiameterMm, field: 'cathodeDiameterMm' },
      { key: 'cathode_m', label: 'Mass', value: fmtNum(cell.cathodeMassG, 3, 'g'), raw: cell.cathodeMassG, field: 'cathodeMassG' },
      { key: 'np', label: 'N/P ratio', value: fmtNum(cell.npRatio, 3), raw: cell.npRatio, field: 'npRatio' },
      ...promotedRows('cathode'),
    ],
    editing,
  );

  const anodeRows = presentRows(
    [
      { key: 'anode', label: 'Material', value: fmtText(cell.anode), raw: cell.anode, field: 'anode' },
      { key: 'anode_d', label: 'Diameter', value: fmtNum(cell.anodeDiameterMm, 2, 'mm'), raw: cell.anodeDiameterMm, field: 'anodeDiameterMm' },
      { key: 'anode_m', label: 'Mass', value: fmtNum(cell.anodeMassG, 3, 'g'), raw: cell.anodeMassG, field: 'anodeMassG' },
      ...promotedRows('anode'),
    ],
    editing,
  );

  const buildRows = presentRows(
    [
      { key: 'sep', label: 'Separator', value: fmtText(cell.separatorType), raw: cell.separatorType, field: 'separatorType' },
      { key: 'sep_d', label: 'Sep. Ø', value: fmtNum(cell.separatorDiameterMm, 2, 'mm'), raw: cell.separatorDiameterMm, field: 'separatorDiameterMm' },
      { key: 'spacer', label: 'Spacer', value: fmtNum(cell.spacerMm, 2, 'mm'), raw: cell.spacerMm, field: 'spacerMm' },
    ],
    editing,
  );

  const electrolyteRows = presentRows(
    [
      { key: 'electrolyte', label: 'Chemistry', value: fmtText(cell.electrolyte), raw: cell.electrolyte, title: cell.electrolyte ?? '', field: 'electrolyte' },
      { key: 'electrolyte_v', label: 'Volume', value: fmtNum(cell.electrolyteVolumeUl, 1, 'µL'), raw: cell.electrolyteVolumeUl, field: 'electrolyteVolumeUl' },
      ...promotedRows('electrolyte'),
    ],
    editing,
  );

  // Narrow layout uses smaller label width and reduced padding to fit the
  // ~360px sidebar.
  const labelWidth = narrow ? 72 : 88;
  const Group = ({ title, rows }: { title: string; rows: KvEntry[] }) =>
    rows.length === 0 ? null : (
      <div className="flex h-full flex-col">
        <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          {title}
        </div>
        <div className="flex-1 rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
          {rows.map((r) => {
            const isEditableField = r.field != null;
            const kind = r.field ? PATCH_FIELD_KIND[r.field] : 'text';
            return (
              <KvRow
                key={r.key}
                label={r.label}
                value={r.value}
                title={r.title}
                editing={editing && isEditableField}
                editValue={r.field ? draft[r.field] : undefined}
                editKind={kind}
                onEditChange={r.field ? (v) => setField(r.field as PatchField, v) : undefined}
                onEditActivate={isEditableField && !editing ? enterEdit : undefined}
                labelWidth={labelWidth}
              />
            );
          })}
        </div>
      </div>
    );

  const gridClasses = narrow
    ? 'grid grid-cols-1 gap-y-2.5'
    : 'grid grid-cols-1 gap-x-6 gap-y-3 md:grid-cols-2 md:auto-rows-fr';

  return (
    <div className={narrow ? 'space-y-3' : 'px-6 py-4 space-y-3'}>
      {/* Header banner: name + editable crumbs + source chip */}
      <header className="flex flex-wrap items-baseline gap-x-2 gap-y-1 pb-2 border-b border-border/60">
        <h3 className="text-[14px] font-semibold text-foreground break-all">
          {cell.cellId || cell.cellName || `Cell ${cell.idNo}`}
        </h3>
        {crumbTokens.length > 0 && (
          <span className="flex flex-wrap items-baseline gap-x-0.5 text-[11px] text-muted-foreground">
            {crumbTokens.map((c, i) => {
              const isEditing = editing && c.editable && c.field != null;
              const kind = c.field ? PATCH_FIELD_KIND[c.field] : 'text';
              return (
                <span key={c.key} className="inline-flex items-baseline">
                  {i > 0 && <span className="px-1 text-muted-foreground/60">·</span>}
                  <CrumbToken
                    fieldLabel={c.label}
                    editable={c.editable}
                    editing={isEditing}
                    editValue={c.field ? draft[c.field] : undefined}
                    editKind={kind}
                    onEditChange={
                      c.field ? (v) => setField(c.field as PatchField, v) : undefined
                    }
                    onEditActivate={c.editable && !editing ? enterEdit : undefined}
                  >
                    {c.text}
                  </CrumbToken>
                </span>
              );
            })}
          </span>
        )}
        {provenance && !editing && !narrow && (
          <span
            className="ml-auto inline-flex items-center gap-1 rounded-md bg-secondary/70 px-2 py-0.5 text-[10px] text-foreground/80"
            title={`Source · ${provenance}`}
          >
            {provenance}
          </span>
        )}
      </header>

      {/* Protocol chip — clicking opens the attach wizard. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Protocol
        </span>
        <ProtocolStatusChip
          protocolName={cell.protocolName}
          segments={cell.protocolSegments}
          cellIds={cell.cellId ? [cell.cellId] : []}
          onSaved={onProtocolAttached}
        />
      </div>

      {/* Capacity basis — which electrode's active mass normalises specific
          capacity. Editable inline; "Auto" infers from a metal counter electrode. */}
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
          Capacity basis
        </span>
        <select
          value={cell.capacityBasis ?? ''}
          disabled={basisSaving}
          onChange={(e) => void saveCapacityBasis(e.target.value)}
          title="Which electrode's active mass normalises specific capacity (mAh/g)"
          className="rounded border border-border bg-background px-1.5 py-0.5 text-[11px] text-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 disabled:opacity-60"
        >
          <option value="">Auto · {cell.capacityBasisResolved ?? 'cathode'} mass</option>
          <option value="cathode">Cathode mass</option>
          <option value="anode">Anode mass</option>
        </select>
        <span className="text-[10px] text-muted-foreground">
          Specific capacity ÷ {cell.capacityBasisResolved === 'anode' ? 'anode' : 'cathode'} active mass
        </span>
      </div>

      {/* Metadata grid */}
      <div className={gridClasses}>
        <Group title="Cathode" rows={cathodeRows} />
        <Group title="Anode" rows={anodeRows} />
        <Group title="Build" rows={buildRows} />
        <Group title="Electrolyte" rows={electrolyteRows} />
      </div>

      {/* Additional metadata — remaining source fields with no schema column
          and not promoted above, kept read-only for reference. */}
      {leftoverCustom.length > 0 && (
        <div>
          <div className="mb-1 text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Additional metadata
          </div>
          <div className="rounded-md border border-border/60 bg-background/60 px-2.5 py-1.5">
            {leftoverCustom.map(([k, v]) => (
              <div key={k} className="py-0.5" title={`${k}: ${v}`}>
                <div className="text-[10px] text-muted-foreground break-words">{k}</div>
                <div className="text-[12px] text-foreground break-words">{v}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status row: real attached datasets + planned tests. */}
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 text-[11px]">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
            Files
          </span>
          {datasets.length === 0 ? (
            <FilePresence has={false} label="No data" title="No test files attached yet" />
          ) : (
            datasets.map((ds, i) => <DatasetChip key={`${ds.name}-${i}`} ds={ds} />)
          )}
        </div>
        {anyPlan && (
          <div className="flex items-center gap-1.5">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
              Plan
            </span>
            {planFormation && <TestFlag label="Formation" on />}
            {planRateTest && <TestFlag label="Rate test" on />}
            {planEis && <TestFlag label="EIS" on />}
          </div>
        )}
      </div>

      {/* Notes — editable while in edit mode, visible read-only otherwise. */}
      {editing ? (
        <div className="text-[11.5px]">
          <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mr-2">
            Notes
          </span>
          <textarea
            value={draft.notes}
            onChange={(e) => setField('notes', e.target.value)}
            placeholder="Free-form notes from metadata sheet…"
            className="mt-1 w-full min-h-[52px] rounded border border-border bg-background px-2 py-1 text-[12px] focus:outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
      ) : (
        cell.notes &&
        cell.notes.trim() && (
          <div className="text-[11.5px]">
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.14em] text-muted-foreground mr-2">
              Notes
            </span>
            <span className="text-foreground whitespace-pre-wrap">{cell.notes}</span>
          </div>
        )
      )}

      {/* Action row: attach cycling file + edit metadata. */}
      <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-border/40">
        <input
          ref={fileInputRef}
          type="file"
          accept={CYCLING_FILE_ACCEPT}
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.currentTarget.value = '';
            if (!f) return;
            void cyclingAttach.attach(f);
          }}
        />
        <button
          type="button"
          disabled={attachBusy || !cell.cellId}
          onClick={() => fileInputRef.current?.click()}
          title={
            hasCycling
              ? 'Replace this cell’s cycling file'
              : 'Attach a cycling file to this cell'
          }
          className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-foreground transition-colors enabled:hover:bg-muted disabled:opacity-60 disabled:cursor-progress"
        >
          <Paperclip className="h-3 w-3" />
          {attachBusy
            ? cyclingAttach.status === 'uploading'
              ? 'Uploading…'
              : 'Processing…'
            : hasCycling
              ? 'Replace cycling file'
              : 'Attach cycling file'}
          {!narrow && (
            <span className="ml-1 rounded bg-muted/80 px-1 text-[9px] uppercase tracking-wide">
              .mpr/.mpt/.csv/.xlsx
            </span>
          )}
        </button>
        {editing ? (
          <>
            <button
              type="button"
              onClick={() => void saveEdit()}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-primary bg-primary px-2 py-1 text-[11px] font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-60 disabled:cursor-progress"
            >
              <Check className="h-3 w-3" />
              {saving ? 'Saving…' : 'Save metadata'}
            </button>
            <button
              type="button"
              onClick={cancelEdit}
              disabled={saving}
              className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted disabled:opacity-60"
            >
              Cancel
            </button>
            {saveError && (
              <span className="text-[10.5px] text-destructive" title={saveError}>
                {saveError}
              </span>
            )}
          </>
        ) : (
          <button
            type="button"
            onClick={enterEdit}
            title="Edit this cell’s metadata"
            className="inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-1 text-[11px] text-foreground transition-colors hover:bg-muted"
          >
            <Pencil className="h-3 w-3" />
            Edit metadata
          </button>
        )}
        {cell.lastSeenAt && !editing && !narrow && (
          <span className="ml-auto text-[10px] text-muted-foreground">
            Last updated {cell.lastSeenAt}
          </span>
        )}
      </div>

      {/* Provenance shown inline (below) in narrow layout — there's no room
          on the header row at sidebar width. */}
      {provenance && !editing && narrow && (
        <div
          className="text-[10px] text-muted-foreground truncate"
          title={`Source · ${provenance}`}
        >
          Source · {provenance}
        </div>
      )}

      {/* Live progress / status feedback for the attach action. */}
      {cyclingAttach.status !== 'idle' && (
        <div className="rounded-md border border-border/40 bg-background/50 px-2 py-1.5">
          <div className="flex items-center justify-between gap-2 text-[11px]">
            <span className="font-medium text-foreground">
              {cyclingAttach.status === 'uploading' && 'Uploading cycling file…'}
              {cyclingAttach.status === 'processing' && 'Ingesting cycling data…'}
              {cyclingAttach.status === 'done' && (
                <span className="text-emerald-600 dark:text-emerald-400">
                  Cycling file attached
                </span>
              )}
              {cyclingAttach.status === 'error' && (
                <span className="text-destructive">Attach failed</span>
              )}
            </span>
            {(cyclingAttach.status === 'uploading' || cyclingAttach.status === 'processing') && (
              <span className="tabular-nums text-muted-foreground">
                {Math.max(5, cyclingAttach.progress)}%
              </span>
            )}
          </div>
          {(cyclingAttach.status === 'uploading' || cyclingAttach.status === 'processing') && (
            <div className="mt-1 h-1 w-full rounded bg-muted">
              <div
                className="h-1 rounded bg-primary transition-all"
                style={{ width: `${Math.max(5, cyclingAttach.progress)}%` }}
              />
            </div>
          )}
          {cyclingAttach.message && (
            <p className="mt-1 text-[10.5px] text-muted-foreground truncate" title={cyclingAttach.message}>
              {cyclingAttach.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
