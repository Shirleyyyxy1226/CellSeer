import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { ArrowLeft, LayoutDashboard, Loader2, Upload } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { fetchProjectReadiness, fetchUploadLoaders, type MetadataUploadOptions } from '@/lib/api';
import { fetchMetadataUploadOptions } from '@/lib/api/uploadApi';
import { useFileUpload } from '@/hooks/useFileUpload';

type LoaderEntry = { fileType: string; extensions: string[] };

function UploadEntryCard(props: {
  title: string;
  subtitle: string;
  accept: string;
  multiple?: boolean;
  status: 'idle' | 'uploading' | 'processing' | 'done' | 'error';
  progress: number;
  message: string | null;
  onPick: (files: File[]) => void;
}) {
  const { title, subtitle, accept, multiple = false, status, progress, message, onPick } = props;
  return (
    <Card className="h-full">
      <CardHeader>
        <CardTitle className="text-base">{title}</CardTitle>
        <p className="text-xs text-muted-foreground">{subtitle}</p>
      </CardHeader>
      <CardContent className="space-y-3">
        <label className="flex min-h-[132px] cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed p-4 text-sm text-muted-foreground hover:border-primary/50">
          <Upload className="h-5 w-5" />
          <span>Choose file</span>
          <input
            type="file"
            className="hidden"
            accept={accept}
            multiple={multiple}
            onChange={(e) => {
              const files = e.target.files ? Array.from(e.target.files) : [];
              if (files.length) onPick(files);
              e.currentTarget.value = '';
            }}
          />
        </label>
        {(status === 'uploading' || status === 'processing') && (
          <div className="space-y-1">
            <div className="h-2 w-full rounded bg-muted">
              <div className="h-2 rounded bg-primary transition-all" style={{ width: `${Math.max(5, progress)}%` }} />
            </div>
            <p className="text-xs text-muted-foreground">{message || `${progress}%`}</p>
          </div>
        )}
        {status === 'done' && <p className="text-xs text-green-600 dark:text-green-400">{message || 'Upload complete'}</p>}
        {status === 'error' && <p className="text-xs text-destructive">{message || 'Upload failed'}</p>}
      </CardContent>
    </Card>
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

  const refreshReadiness = useCallback(async (opts?: { background?: boolean }) => {
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
  }, [projectId]);

  useEffect(() => {
    void refreshReadiness();
    fetchUploadLoaders().then((r) =>
      setLoaders(r.loaders.map((x) => ({ fileType: x.fileType, extensions: x.extensions }))),
    );
  }, [refreshReadiness]);

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
      await refreshReadiness({ background: true });
    };
    void tick();
    const timer = setInterval(() => {
      void tick();
    }, 1500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [isAnyUploadActive, projectId, refreshReadiness]);

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
      } catch (e) {
        setMetadataConfigError(
          e instanceof Error ? e.message : 'Failed to inspect metadata columns.',
        );
      }
    },
    [metadataUpload, projectId, refreshReadiness],
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
  }, [metadataUpload, pendingMetadataChoice, projectId, refreshReadiness]);

  const onCyclingFile = useCallback(
    async (files: File[]) => {
      await cyclingUpload.uploadManyWithOptions(files, { projectId, fileType: 'cycling' });
      await refreshReadiness({ background: true });
    },
    [cyclingUpload, projectId, refreshReadiness],
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl p-6">
        <div className="mb-6 flex items-center justify-between gap-3">
          <div>
            <Button variant="ghost" asChild className="mb-2 px-0">
              <Link to="/">
                <ArrowLeft className="h-4 w-4" />
                Projects
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold">{readiness?.projectName || 'Project'}</h1>
            <p className="text-sm text-muted-foreground">
              Upload required data before opening dashboard views.
            </p>
          </div>
          <Button
            disabled={!readiness?.canEnterDashboard}
            onClick={() => navigate(`/projects/${encodeURIComponent(projectId)}/dashboard`)}
          >
            <LayoutDashboard className="h-4 w-4" />
            Dashboard
          </Button>
        </div>

        {loadingReadiness ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-muted-foreground">
            <Loader2 className="mx-auto mb-2 h-4 w-4 animate-spin" />
            Loading project details...
          </div>
        ) : (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
              <UploadEntryCard
                title="Metadata"
                subtitle={`Accepts ${metadataAccept} · Columns: ${readiness?.metadataColumnCount ?? 0}`}
                accept={metadataAccept}
                status={metadataUpload.status}
                progress={metadataUpload.progress}
                message={metadataUpload.message}
                onPick={(files) => {
                  void onMetadataFile(files[0]);
                }}
              />
              <UploadEntryCard
                title="Cycling data"
                subtitle={`Accepts ${cyclingAccept} · Uploaded files: ${readiness?.cyclingFileCount ?? 0}`}
                accept={cyclingAccept}
                multiple
                status={cyclingUpload.status}
                progress={cyclingUpload.progress}
                message={cyclingUpload.message}
                onPick={(files) => {
                  void onCyclingFile(files);
                }}
              />
            </div>

            {metadataConfigError && (
              <Card className="border-destructive/40">
                <CardHeader>
                  <CardTitle className="text-base text-destructive">Metadata setup needed</CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-sm text-destructive">{metadataConfigError}</p>
                </CardContent>
              </Card>
            )}

            {pendingMetadataChoice && (
              <Card>
                <CardHeader>
                  <CardTitle className="text-base">Select Link key (id_no)</CardTitle>
                  <p className="text-xs text-muted-foreground">
                    Multiple numeric ID columns were found in metadata. Select one canonical link key for data linkage.
                  </p>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div>
                    <p className="mb-1 text-xs text-muted-foreground">Primary key (cell identity)</p>
                    <p className="text-sm font-medium">{pendingMetadataChoice.selectedPrimaryKey}</p>
                  </div>
                  <label className="flex flex-col gap-1 text-sm">
                    <span className="text-xs text-muted-foreground">Link key (id_no)</span>
                    <select
                      value={pendingMetadataChoice.selectedIdNoHeader}
                      onChange={(e) =>
                        setPendingMetadataChoice((prev) =>
                          prev ? { ...prev, selectedIdNoHeader: e.target.value } : prev,
                        )
                      }
                      className="rounded-md border bg-background px-3 py-2"
                    >
                      {pendingMetadataChoice.options.idNoCandidates.map((col) => (
                        <option key={col} value={col}>
                          {col}
                        </option>
                      ))}
                    </select>
                  </label>
                  <div className="flex items-center gap-2">
                    <Button
                      onClick={() => {
                        void continueMetadataUpload();
                      }}
                      disabled={!pendingMetadataChoice.selectedIdNoHeader}
                    >
                      Continue upload
                    </Button>
                    <Button variant="outline" onClick={() => setPendingMetadataChoice(null)}>
                      Cancel
                    </Button>
                  </div>
                </CardContent>
              </Card>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

