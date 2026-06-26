import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  ArrowLeft,
  ArrowRight,
  ChevronDown,
  ChevronRight,
  CloudDownload,
  FileDown,
  LayoutDashboard,
  RefreshCw,
  Upload,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { SearchInput } from '@/components/SearchInput';
import { CellMetadataCard, FilePresence } from '@/components/CellMetadataCard';
import {
  fetchCellRecordIndex,
  fetchProjectReadiness,
  fetchUploadLoaders,
  type MetadataUploadOptions,
} from '@/lib/api';
import type { IndexCell } from '@/lib/cellTypes';
import { statusLine } from '@/lib/cellDisplay';
import { fetchMetadataUploadOptions } from '@/lib/api/uploadApi';
import { useFileUpload } from '@/hooks/useFileUpload';

type LoaderEntry = { fileType: string; extensions: string[] };

type CellRow = IndexCell;

function UploadDropTile(props: {
  title: string;
  subtitle: string;
  hint?: string;
  accept: string;
  multiple?: boolean;
  status: 'idle' | 'uploading' | 'processing' | 'done' | 'error';
  progress: number;
  message: string | null;
  onPick: (files: File[]) => void;
  disabled?: boolean;
}) {
  const {
    title,
    subtitle,
    hint,
    accept,
    multiple = false,
    status,
    progress,
    message,
    onPick,
    disabled,
  } = props;
  const note = statusLine(status, message, progress);
  const noteTone =
    status === 'error'
      ? 'text-destructive'
      : status === 'done'
      ? 'text-emerald-600 dark:text-emerald-400'
      : 'text-muted-foreground';
  return (
    <label
      className={`group flex items-center gap-3 rounded-lg border border-dashed bg-card px-3 py-2.5 transition-colors ${
        disabled ? 'opacity-60 cursor-not-allowed' : 'cursor-pointer hover:border-primary/60 hover:bg-muted/30'
      }`}
    >
      <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground group-hover:bg-primary/10 group-hover:text-primary transition-colors">
        <Upload className="h-4 w-4" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-semibold text-foreground leading-tight">{title}</span>
        <span className="block text-[10.5px] text-muted-foreground truncate">{subtitle}</span>
        {hint && !note && (
          <span className="block text-[10px] text-muted-foreground/70 italic truncate">{hint}</span>
        )}
        {note && (
          <span className={`mt-0.5 block text-[10px] ${noteTone}`}>{note}</span>
        )}
        {(status === 'uploading' || status === 'processing') && (
          <span className="mt-1 block h-1 w-full rounded bg-muted">
            <span
              className="block h-1 rounded bg-primary transition-all"
              style={{ width: `${Math.max(5, progress)}%` }}
            />
          </span>
        )}
      </span>
      <input
        type="file"
        className="hidden"
        accept={accept}
        multiple={multiple}
        disabled={disabled}
        onChange={(e) => {
          const files = e.target.files ? Array.from(e.target.files) : [];
          if (files.length) onPick(files);
          e.currentTarget.value = '';
        }}
      />
    </label>
  );
}


export default function ProjectDetailPage() {
  const { projectId = '' } = useParams<{ projectId: string }>();
  const navigate = useNavigate();

  const [readiness, setReadiness] = useState<{
    projectName: string;
    metadataColumnCount: number;
    cyclingFileCount: number;
    canEnterDashboard: boolean;
  } | null>(null);
  const [loaders, setLoaders] = useState<LoaderEntry[]>([]);
  const [loadingReadiness, setLoadingReadiness] = useState(true);
  const [metadataConfigError, setMetadataConfigError] = useState<string | null>(null);
  const [pendingMetadataChoice, setPendingMetadataChoice] = useState<{
    file: File;
    options: MetadataUploadOptions;
    selectedPrimaryKey: string;
    selectedIdNoHeader: string;
  } | null>(null);
  const metadataUpload = useFileUpload();
  const cyclingUpload = useFileUpload();

  const [cells, setCells] = useState<CellRow[]>([]);
  const [search, setSearch] = useState('');
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const prevCellCountRef = useRef(0);
  /* ─────────────── Data fetchers ─────────────── */

  const refreshReadiness = useCallback(
    async (opts?: { background?: boolean }) => {
      if (!projectId) return;
      const background = Boolean(opts?.background);
      if (!background) setLoadingReadiness(true);
      try {
        const r = await fetchProjectReadiness(projectId);
        setReadiness({
          projectName: r.projectName,
          metadataColumnCount: r.metadataColumnCount,
          cyclingFileCount: r.cyclingFileCount,
          canEnterDashboard: r.canEnterDashboard,
        });
      } finally {
        if (!background) setLoadingReadiness(false);
      }
    },
    [projectId],
  );

  const refreshCells = useCallback(async (): Promise<number> => {
    try {
      const d = await fetchCellRecordIndex();
      const rows = (d.cells ?? []) as CellRow[];
      setCells(rows);
      prevCellCountRef.current = rows.length;
      return rows.length;
    } catch {
      return -1;
    }
  }, []);

  useEffect(() => {
    void refreshReadiness();
    void refreshCells();
    fetchUploadLoaders().then((r) =>
      setLoaders(r.loaders.map((x) => ({ fileType: x.fileType, extensions: x.extensions }))),
    );
  }, [refreshReadiness, refreshCells]);

  /* ─────────────── Polling during upload ─────────────── */

  const isAnyUploadActive =
    metadataUpload.status === 'uploading' ||
    metadataUpload.status === 'processing' ||
    cyclingUpload.status === 'uploading' ||
    cyclingUpload.status === 'processing';

  useEffect(() => {
    if (!projectId || !isAnyUploadActive) return;
    let cancelled = false;
    const tick = async () => {
      if (cancelled) return;
      await Promise.all([refreshReadiness({ background: true }), refreshCells()]);
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAnyUploadActive, projectId, refreshReadiness, refreshCells]);

  // After an upload finishes, do one final refresh so the table reflects
  // freshly persisted rows / datasets.
  useEffect(() => {
    if (metadataUpload.status === 'done' || cyclingUpload.status === 'done') {
      void refreshCells();
    }
  }, [metadataUpload.status, cyclingUpload.status, refreshCells]);

  /* ─────────────── Upload handlers ─────────────── */

  const metadataAccept = useMemo(
    () =>
      loaders.find((l) => l.fileType === 'metadata')?.extensions.join(',') ??
      '.csv,.xlsx,.xls',
    [loaders],
  );
  const cyclingAccept = useMemo(
    () => loaders.find((l) => l.fileType === 'cycling')?.extensions.join(',') ?? '.mpr,.mpt',
    [loaders],
  );

  // Derived once per re-render: which cells have a cycling dataset attached.
  // This replaces the previous heavy /api/rate-performance fetch — the
  // /api/cell-record-index now returns each cell's datasets[], so presence
  // becomes a free O(n) scan.
  const cyclingCellIds = useMemo(
    () =>
      new Set(
        cells
          .filter((c) => (c.datasets ?? []).some((d) => d.name === 'cycling'))
          .map((c) => c.cellId),
      ),
    [cells],
  );

  const onMetadataFile = useCallback(
    async (file: File) => {
      setMetadataConfigError(null);
      setPendingMetadataChoice(null);
      try {
        const opts = await fetchMetadataUploadOptions(file);
        const primary = opts.defaultPrimaryKey || opts.keyCandidates[0] || '';
        const idNoCandidates = opts.idNoCandidates || [];
        const defaultIdNoHeader = opts.defaultIdNoHeader || idNoCandidates[0] || '';
        if (!primary) {
          setMetadataConfigError(
            'No valid primary key column found. Please select a metadata identity column.',
          );
          return;
        }
        if (!idNoCandidates.length) {
          setMetadataConfigError(
            'No numeric link-key column found. Please add/select an ID column for data linkage.',
          );
          return;
        }
        if (opts.requiresIdNoChoice && idNoCandidates.length > 1) {
          setPendingMetadataChoice({
            file,
            options: opts,
            selectedPrimaryKey: primary,
            selectedIdNoHeader: defaultIdNoHeader,
          });
          return;
        }
        if (!defaultIdNoHeader) {
          setMetadataConfigError(
            'No numeric link-key column found. Please add/select an ID column for data linkage.',
          );
          return;
        }
        await metadataUpload.uploadWithOptions(file, {
          projectId,
          fileType: 'metadata',
          primaryKeyHeader: primary,
          idNoHeader: defaultIdNoHeader,
          metadataSheet: opts.sheetName || undefined,
          displayNameTemplate: opts.displayNameTemplate,
        });
        await refreshReadiness({ background: true });
        await refreshCells();
      } catch (e) {
        setMetadataConfigError(
          e instanceof Error ? e.message : 'Failed to inspect metadata columns.',
        );
      }
    },
    [metadataUpload, projectId, refreshReadiness, refreshCells],
  );

  const continueMetadataUpload = useCallback(async () => {
    if (!pendingMetadataChoice) return;
    setMetadataConfigError(null);
    await metadataUpload.uploadWithOptions(pendingMetadataChoice.file, {
      projectId,
      fileType: 'metadata',
      primaryKeyHeader: pendingMetadataChoice.selectedPrimaryKey,
      idNoHeader: pendingMetadataChoice.selectedIdNoHeader,
      metadataSheet: pendingMetadataChoice.options.sheetName || undefined,
      displayNameTemplate: pendingMetadataChoice.options.displayNameTemplate,
    });
    setPendingMetadataChoice(null);
    await refreshReadiness({ background: true });
    await refreshCells();
  }, [metadataUpload, pendingMetadataChoice, projectId, refreshReadiness, refreshCells]);

  const onCyclingFile = useCallback(
    async (files: File[]) => {
      await cyclingUpload.uploadManyWithOptions(files, { projectId, fileType: 'cycling' });
      await refreshReadiness({ background: true });
      await refreshCells();
    },
    [cyclingUpload, projectId, refreshReadiness, refreshCells],
  );

  /* ─────────────── Table derived state ─────────────── */

  const filteredCells = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return cells;
    return cells.filter((c) => {
      const hay = [
        c.cellId,
        c.cellName,
        c.cathode,
        c.separatorType,
        c.electrolyte ?? '',
        c.spacerMm != null ? String(c.spacerMm) : '',
        String(c.idNo),
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [cells, search]);

  const toggleRow = (cellId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(cellId)) next.delete(cellId);
      else next.add(cellId);
      return next;
    });
  };

  const expandAll = () => setExpanded(new Set(filteredCells.map((c) => c.cellId)));
  const collapseAll = () => setExpanded(new Set());

  const counts = {
    total: cells.length,
    cycling: cells.filter((c) => cyclingCellIds.has(c.cellId)).length,
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl p-6">
        {/* Header */}
        <div className="mb-4 flex flex-wrap items-end justify-between gap-3">
          <div className="min-w-0">
            <Button variant="ghost" asChild className="mb-1 h-7 px-0 text-muted-foreground">
              <Link to="/">
                <ArrowLeft className="h-3.5 w-3.5" />
                Projects
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold leading-tight truncate">
              {readiness?.projectName || 'Project'}
            </h1>
            <p className="text-[12px] text-muted-foreground">
              {counts.total > 0
                ? `${counts.total} cells · ${counts.cycling} with cycling data`
                : 'Upload metadata to populate this project, then attach cycling files.'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button
              disabled={!readiness?.canEnterDashboard}
              onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}/dashboard`)}
            >
              <LayoutDashboard className="h-4 w-4" />
              Dashboard
            </Button>
          </div>
        </div>

        {loadingReadiness ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            <LoadingIndicator variant="stacked" size="md" label="Loading project details..." />
          </div>
        ) : (
          <div className="space-y-4">
            {/* Compact upload strip */}
            <div className="rounded-lg border border-border bg-card p-3">
              <div className="mb-2 flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <span className="text-[10px] uppercase tracking-[0.12em] text-muted-foreground">
                    Upload data
                  </span>
                  <a
                    href="/metadata_template.xlsx"
                    download
                    className="inline-flex items-center gap-1 text-[10px] text-primary hover:underline"
                  >
                    <FileDown className="h-3 w-3" />
                    Metadata template
                  </a>
                </div>
                <span className="text-[10.5px] text-muted-foreground">
                  Metadata cols {readiness?.metadataColumnCount ?? 0} · Cycling files{' '}
                  {readiness?.cyclingFileCount ?? 0}
                </span>
              </div>
              <div className="grid grid-cols-1 gap-2 md:grid-cols-2 lg:grid-cols-3">
                <UploadDropTile
                  title="Metadata"
                  subtitle={`Accepts ${metadataAccept}`}
                  accept={metadataAccept}
                  status={metadataUpload.status}
                  progress={metadataUpload.progress}
                  message={metadataUpload.message}
                  onPick={(files) => {
                    void onMetadataFile(files[0]);
                  }}
                  disabled={metadataUpload.status === 'uploading' || metadataUpload.status === 'processing'}
                />
                <UploadDropTile
                  title="Cycling data"
                  subtitle={`Accepts ${cyclingAccept} · multi-file`}
                  hint="e.g. 1073_cycling.xlsx · CEL-100_data.csv (filename must contain the cell's ID No)"
                  accept={cyclingAccept}
                  multiple
                  status={cyclingUpload.status}
                  progress={cyclingUpload.progress}
                  message={cyclingUpload.message}
                  onPick={(files) => {
                    void onCyclingFile(files);
                  }}
                  disabled={cyclingUpload.status === 'uploading' || cyclingUpload.status === 'processing'}
                />
                <button
                  type="button"
                  onClick={() =>
                    navigate(`/digibat?projectId=${encodeURIComponent(projectId)}`)
                  }
                  className="group flex items-center gap-3 rounded-lg border border-dashed bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/60 hover:bg-muted/30"
                >
                  <span className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-muted text-muted-foreground transition-colors group-hover:bg-primary/10 group-hover:text-primary">
                    <CloudDownload className="h-4 w-4" />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[12.5px] font-semibold leading-tight text-foreground">
                      Import from DIGIBAT
                    </span>
                    <span className="block truncate text-[10.5px] text-muted-foreground">
                      Sync collections from the shared datalab into this project
                    </span>
                  </span>
                  <ArrowRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-0.5" />
                </button>
              </div>

              {metadataConfigError && (
                <p className="mt-2 text-[11px] text-destructive">{metadataConfigError}</p>
              )}

              {pendingMetadataChoice && (
                <Card className="mt-2 border-amber-300/60 bg-amber-50 dark:bg-amber-950/30">
                  <CardHeader className="pb-2">
                    <CardTitle className="text-sm">Select Link key (id_no)</CardTitle>
                    <p className="text-[11px] text-muted-foreground">
                      Multiple numeric ID columns were found. Pick one canonical link key.
                    </p>
                  </CardHeader>
                  <CardContent className="space-y-2">
                    <div className="text-[11px]">
                      <span className="text-muted-foreground">Primary key: </span>
                      <span className="font-medium">{pendingMetadataChoice.selectedPrimaryKey}</span>
                    </div>
                    <label className="flex flex-col gap-1 text-[11px]">
                      <span className="text-muted-foreground">Link key</span>
                      <select
                        value={pendingMetadataChoice.selectedIdNoHeader}
                        onChange={(e) =>
                          setPendingMetadataChoice((prev) =>
                            prev ? { ...prev, selectedIdNoHeader: e.target.value } : prev,
                          )
                        }
                        className="rounded-md border bg-background px-2 py-1"
                      >
                        {pendingMetadataChoice.options.idNoCandidates.map((col) => (
                          <option key={col} value={col}>
                            {col}
                          </option>
                        ))}
                      </select>
                    </label>
                    <div className="flex items-center gap-2 pt-1">
                      <Button
                        size="sm"
                        onClick={() => {
                          void continueMetadataUpload();
                        }}
                        disabled={!pendingMetadataChoice.selectedIdNoHeader}
                      >
                        Continue upload
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => setPendingMetadataChoice(null)}
                      >
                        Cancel
                      </Button>
                    </div>
                  </CardContent>
                </Card>
              )}
            </div>

            {/* Cells table */}
            <div className="rounded-lg border border-border bg-card overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border px-3 py-2">
                <div className="flex items-center gap-2">
                  <h2 className="text-[13px] font-semibold text-foreground">
                    Cells
                    <span className="ml-1 text-muted-foreground font-normal">
                      ({filteredCells.length}
                      {filteredCells.length !== cells.length && ` of ${cells.length}`})
                    </span>
                  </h2>
                  {isAnyUploadActive && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-medium text-blue-700 dark:bg-blue-950/40 dark:text-blue-300">
                      <RefreshCw className="h-3 w-3 animate-spin" />
                      live
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-2">
                  <SearchInput
                    collapsible
                    value={search}
                    onChange={setSearch}
                    placeholder="Search cell, cathode, separator…"
                    widthClass="w-[220px]"
                  />
                  <button
                    type="button"
                    onClick={expandAll}
                    className="h-7 px-2 text-[10.5px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Expand all
                  </button>
                  <button
                    type="button"
                    onClick={collapseAll}
                    className="h-7 px-2 text-[10.5px] rounded-md border border-border text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
                  >
                    Collapse
                  </button>
                </div>
              </div>

              {cells.length === 0 ? (
                <div className="px-6 py-10 text-center text-[12.5px] text-muted-foreground">
                  No cells yet. Upload a metadata file to populate this project.
                </div>
              ) : filteredCells.length === 0 ? (
                <div className="px-6 py-10 text-center text-[12.5px] text-muted-foreground">
                  No cells match "{search}".
                </div>
              ) : (
                <div className="max-h-[60vh] overflow-auto">
                  <table className="w-full text-[12px]">
                    <thead className="sticky top-0 bg-card z-10">
                      <tr className="border-b border-border text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                        <th className="w-6 px-1 py-2 text-left"></th>
                        <th className="w-10 px-1 py-2 text-left">#</th>
                        <th className="px-2 py-2 text-left">Cell ID</th>
                        <th className="px-2 py-2 text-left">Cathode</th>
                        <th className="px-2 py-2 text-left">Anode</th>
                        <th className="px-2 py-2 text-left">Separator</th>
                        <th className="px-2 py-2 text-right">Spacer</th>
                        <th className="px-2 py-2 text-right">N/P</th>
                        <th className="px-2 py-2 text-left">Electrolyte</th>
                        <th className="px-2 py-2 text-left">Files</th>
                      </tr>
                    </thead>
                    <tbody>
                      {filteredCells.map((c) => {
                        const isOpen = expanded.has(c.cellId);
                        const hasCycling = cyclingCellIds.has(c.cellId);
                        return (
                          <FragmentRow
                            key={c.cellId || `row-${c.idNo}`}
                            cell={c}
                            isOpen={isOpen}
                            hasCycling={hasCycling}
                            onToggle={() => toggleRow(c.cellId)}
                            onTestFileUploaded={() => {
                              void refreshReadiness({ background: true });
                              void refreshCells();
                            }}
                            onCellMetadataUpdated={() => {
                              void refreshCells();
                            }}
                          />
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function FragmentRow({
  cell,
  isOpen,
  hasCycling,
  onToggle,
  onTestFileUploaded,
  onCellMetadataUpdated,
}: {
  cell: CellRow;
  isOpen: boolean;
  hasCycling: boolean;
  onToggle: () => void;
  onTestFileUploaded?: () => void;
  onCellMetadataUpdated?: () => void;
}) {
  return (
    <>
      <tr
        className={`border-b border-border/60 transition-colors cursor-pointer ${
          isOpen ? 'bg-muted/40' : 'hover:bg-muted/30'
        }`}
        onClick={onToggle}
      >
        <td className="px-1 py-1.5 text-muted-foreground">
          {isOpen ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        </td>
        <td className="px-1 py-1.5 tabular-nums text-muted-foreground">{cell.idNo}</td>
        <td className="px-2 py-1.5 font-medium text-foreground">
          {cell.cellId || cell.cellName || `Cell ${cell.idNo}`}
        </td>
        <td className="px-2 py-1.5 text-foreground">{cell.cathode || '—'}</td>
        <td className="px-2 py-1.5 text-foreground">{cell.anode || '—'}</td>
        <td className="px-2 py-1.5 text-foreground">{cell.separatorType || '—'}</td>
        <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
          {cell.spacerMm != null ? `${cell.spacerMm}` : '—'}
        </td>
        <td className="px-2 py-1.5 text-right tabular-nums text-foreground">
          {cell.npRatio != null ? cell.npRatio.toFixed(2) : '—'}
        </td>
        <td
          className="px-2 py-1.5 text-foreground truncate max-w-[180px]"
          title={cell.electrolyte ?? ''}
        >
          {cell.electrolyte || '—'}
        </td>
        <td className="px-2 py-1.5">
          <FilePresence has={hasCycling} label="Cycling" />
        </td>
      </tr>
      {isOpen && (
        <tr className="bg-muted/15 border-b border-border/60">
          <td colSpan={10} className="p-0">
            <CellMetadataCard
              cell={cell}
              layout="wide"
              onTestFileUploaded={onTestFileUploaded}
              onCellMetadataUpdated={onCellMetadataUpdated}
              onProtocolAttached={onCellMetadataUpdated}
            />
          </td>
        </tr>
      )}
    </>
  );
}
