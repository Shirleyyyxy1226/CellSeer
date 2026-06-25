import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { ArrowLeft, Link2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import {
  connectDigibatAccount,
  fetchDigibatCollectionCells,
  fetchDigibatCollections,
  type DigibatCollection,
  type DigibatCollectionCell,
} from '@/digibat/api/digibatApi';
import { useDigibatSync } from '@/digibat/hooks/useDigibatSync';
import { createProject, fetchProjects, type ProjectSummary } from '@/lib/api';

export default function DigibatPage() {
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  // When the page is opened from a specific project, the URL carries
  // ?projectId=... so we can pre-select that project and route "Back" to
  // the project page instead of the library home.
  const fromProjectId = searchParams.get('projectId') ?? '';
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [selectedProjectId, setSelectedProjectId] = useState<string>(fromProjectId);
  const [apiKey, setApiKey] = useState('');
  const [useDefaultAccount, setUseDefaultAccount] = useState(true);
  const [baseUrl, setBaseUrl] = useState(
    import.meta.env.VITE_DIGIBAT_BASE_URL || 'https://digibat.dept.ic.ac.uk',
  );
  const [newProjectName, setNewProjectName] = useState('');
  const [collections, setCollections] = useState<DigibatCollection[]>([]);
  const [selectedCollectionId, setSelectedCollectionId] = useState('');
  const [collectionCells, setCollectionCells] = useState<DigibatCollectionCell[]>([]);
  const [selectedRefcodes, setSelectedRefcodes] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const { status, isLoading, error: syncError, triggerSync, refreshStatus } = useDigibatSync(selectedProjectId || null);
  const isSyncRunning = status?.status === 'running' || status?.status === 'queued';
  const isSyncBusy = isLoading || isSubmitting || isSyncRunning;

  const datasetHint = useMemo(() => {
    if (!status) {
      if (!selectedProjectId) return 'Select a project to see sync status.';
      if (isLoading) return 'Loading sync status…';
      return 'No sync status yet.';
    }
    return `Status: ${status.status} · Cached datasets: ${status.datasetCount}`;
  }, [status, selectedProjectId, isLoading]);

  useEffect(() => {
    fetchProjects()
      .then((res) => {
        setProjects(res.projects);
        if (!selectedProjectId && res.projects.length) {
          setSelectedProjectId(res.projects[0].id);
        }
      })
      .catch(() => {});
  }, [selectedProjectId]);

  const onConnectAccount = async () => {
    setError(null);
    setSuccess(null);
    if (!selectedProjectId) {
      setError('Select a project first.');
      return;
    }
    if (!useDefaultAccount && !apiKey.trim()) {
      setError('API key is required when default account is disabled.');
      return;
    }
    setIsSubmitting(true);
    try {
      await connectDigibatAccount({
        projectId: selectedProjectId,
        apiKey: apiKey.trim() || undefined,
        useDefault: useDefaultAccount,
        baseUrl: baseUrl.trim() || undefined,
      });
      setSuccess('DIGIBAT account connected.');
      await refreshStatus();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to connect DIGIBAT account.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const onLoadCollections = async () => {
    setError(null);
    if (!selectedProjectId) {
      setError('Select a project first.');
      return;
    }
    try {
      const data = await fetchDigibatCollections(selectedProjectId);
      if (data.configured === false) {
        setCollections([]);
        setSelectedCollectionId('');
        setCollectionCells([]);
        setSelectedRefcodes([]);
        setError(data.detail || 'DIGIBAT is not configured yet. Connect account first.');
        return;
      }
      setCollections(data.collections);
      if (data.collections.length) {
        setSelectedCollectionId((prev) => prev || data.collections[0].id);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load collections.');
    }
  };

  const onLoadCells = async () => {
    setError(null);
    if (!selectedProjectId || !selectedCollectionId) {
      setError('Select project and collection first.');
      return;
    }
    try {
      const data = await fetchDigibatCollectionCells(selectedProjectId, selectedCollectionId);
      if (data.configured === false) {
        setCollectionCells([]);
        setSelectedRefcodes([]);
        setError(data.detail || 'DIGIBAT is not configured yet. Connect account first.');
        return;
      }
      setCollectionCells(data.cells);
      setSelectedRefcodes(data.cells.map((c) => c.refcode));
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load collection cells.');
    }
  };

  const toggleRefcode = (refcode: string) => {
    setSelectedRefcodes((prev) =>
      prev.includes(refcode) ? prev.filter((x) => x !== refcode) : [...prev, refcode],
    );
  };

  const onStartSync = async () => {
    setError(null);
    setSuccess(null);
    let projectId = selectedProjectId;
    if (!projectId) {
      const name = newProjectName.trim() || `DIGIBAT ${selectedCollectionId || 'Project'}`;
      const created = await createProject(name);
      projectId = created.id;
      setSelectedProjectId(created.id);
      setProjects((prev) => [created, ...prev]);
    }
    if (!selectedCollectionId) {
      setError('Select a collection before importing.');
      return;
    }
    const started = await triggerSync({
      projectId,
      collectionIds: [selectedCollectionId],
      selectedRefcodes,
      includeCycling: true,
    });
    if (started) {
      setSuccess('DIGIBAT import queued.');
    }
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl p-6 space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <Button variant="ghost" asChild className="mb-2 px-0">
              <Link to={fromProjectId ? `/projects/${encodeURIComponent(fromProjectId)}` : '/'}>
                <ArrowLeft className="h-4 w-4" />
                {fromProjectId ? 'Project' : 'Home'}
              </Link>
            </Button>
            <h1 className="text-2xl font-semibold">DIGIBAT Workspace</h1>
            <p className="text-sm text-muted-foreground">
              Connect a DIGIBAT account to browse collections and import cells. Public upload flow is unchanged.
            </p>
          </div>
          {selectedProjectId && (
            <Button onClick={() => navigate(`/projects/${encodeURIComponent(selectedProjectId)}/dashboard`)}>
              Open Dashboard
            </Button>
          )}
        </div>

        <div className="grid gap-4">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2 text-base">
                <Link2 className="h-4 w-4" />
                Connect to DIGIBAT
              </CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <div className="space-y-1">
                <Label>Project</Label>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={selectedProjectId}
                  onChange={(e) => setSelectedProjectId(e.target.value)}
                >
                  <option value="">Select project</option>
                  {projects.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.name} ({p.id})
                    </option>
                  ))}
                </select>
              </div>
              <div className="space-y-1">
                <Label>Or create project name on first import</Label>
                <Input
                  placeholder="My DIGIBAT Project"
                  value={newProjectName}
                  onChange={(e) => setNewProjectName(e.target.value)}
                />
              </div>
              <div className="space-y-1">
                <Label>DIGIBAT base URL</Label>
                <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} />
              </div>
              <label className="flex items-center gap-2 text-sm">
                <input
                  type="checkbox"
                  checked={useDefaultAccount}
                  onChange={(e) => setUseDefaultAccount(e.target.checked)}
                />
                Use default test account
              </label>
              <div className="space-y-1">
                <Label>API key</Label>
                <Input
                  type="password"
                  disabled={useDefaultAccount}
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                />
              </div>
              <Button disabled={isSubmitting || !selectedProjectId} onClick={() => void onConnectAccount()}>
                Connect account
              </Button>
              <div className="space-y-1 pt-2">
                <Label>Browse collections</Label>
                <div className="flex gap-2">
                  <Button type="button" variant="outline" onClick={() => void onLoadCollections()}>
                    Load collections
                  </Button>
                  <Button
                    type="button"
                    variant="outline"
                    disabled={!selectedCollectionId}
                    onClick={() => void onLoadCells()}
                  >
                    Load cells
                  </Button>
                </div>
                <select
                  className="w-full rounded-md border bg-background px-3 py-2 text-sm"
                  value={selectedCollectionId}
                  onChange={(e) => setSelectedCollectionId(e.target.value)}
                >
                  <option value="">Select collection</option>
                  {collections.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.id}
                    </option>
                  ))}
                </select>
              </div>
              {collectionCells.length > 0 && (
                <div className="max-h-48 overflow-auto rounded-md border p-2 space-y-1">
                  {collectionCells.map((cell) => (
                    <label key={cell.refcode} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={selectedRefcodes.includes(cell.refcode)}
                        onChange={() => toggleRefcode(cell.refcode)}
                      />
                      <span>{cell.name}</span>
                    </label>
                  ))}
                </div>
              )}
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="ghost"
                  onClick={() => setSelectedRefcodes(collectionCells.map((c) => c.refcode))}
                >
                  Select all
                </Button>
                <Button type="button" variant="ghost" onClick={() => setSelectedRefcodes([])}>
                  Clear
                </Button>
              </div>
              <Button
                variant="secondary"
                disabled={isSyncBusy || !selectedCollectionId}
                onClick={() => void onStartSync()}
              >
                {isSyncRunning ? 'Sync in progress…' : 'Import selected cells'}
              </Button>
              <p className="text-xs text-muted-foreground">{datasetHint}</p>
              {(isLoading || isSubmitting) && (
                <LoadingIndicator size="sm" label="Processing..." />
              )}
              {syncError && (
                <p className="text-xs text-destructive">{syncError}</p>
              )}
            </CardContent>
          </Card>
        </div>

        {error && <p className="text-sm text-destructive">{error}</p>}
        {success && <p className="text-sm text-green-600 dark:text-green-400">{success}</p>}
      </div>
    </div>
  );
}
