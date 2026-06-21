import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Check,
  FlaskConical,
  LayoutDashboard,
  Pencil,
  Plus,
  Search,
  Trash2,
  X,
} from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog';
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select';
import {
  createProject,
  deleteProject,
  fetchProjects,
  fetchProjectReadiness,
  renameProject,
  type ProjectSummary,
} from '@/lib/api';
import { LoadingIndicator } from '@/components/LoadingIndicator';
import { useToast } from '@/hooks/use-toast';

/* ------------------------------------------------------------------ */
/* Library enrichment — per-project facts beyond the bare summary      */
/* ------------------------------------------------------------------ */

interface ProjectFacts {
  datasetCount: number | null;
  canEnterDashboard: boolean;
  digibatSynced: boolean;
}

async function fetchProjectFacts(projectId: string): Promise<ProjectFacts> {
  const facts: ProjectFacts = { datasetCount: null, canEnterDashboard: false, digibatSynced: false };
  try {
    const readiness = await fetchProjectReadiness(projectId);
    facts.datasetCount = readiness.cyclingFileCount ?? null;
    facts.canEnterDashboard = Boolean(readiness.canEnterDashboard);
  } catch {
    /* readiness is best-effort decoration */
  }
  try {
    const res = await fetch(`/api/projects/${encodeURIComponent(projectId)}/digibat/status`, {
      cache: 'no-store',
    });
    if (res.ok) {
      const status = (await res.json()) as { lastRun?: unknown };
      facts.digibatSynced = status.lastRun != null;
    }
  } catch {
    /* same — never block the library on provenance */
  }
  return facts;
}

/* Shared with the Master Plot overview: stable order-based chemistry hues. */
const CHEM_PALETTE = [
  '#2563eb', '#dc2626', '#0d9488', '#9333ea', '#ea580c', '#65a30d', '#0891b2', '#be185d',
];

function relativeTime(iso: string): string {
  const then = new Date(iso.includes('T') ? iso : iso.replace(' ', 'T'));
  if (Number.isNaN(then.getTime())) return iso;
  const days = Math.floor((Date.now() - then.getTime()) / 86_400_000);
  if (days <= 0) return 'today';
  if (days === 1) return 'yesterday';
  if (days < 30) return `${days} d ago`;
  return then.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' });
}

type SortKey = 'updated' | 'name' | 'cells';

export default function HomePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [facts, setFacts] = useState<Record<string, ProjectFacts>>({});
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [loading, setLoading] = useState(true);
  const [pendingDelete, setPendingDelete] = useState<ProjectSummary | null>(null);
  const [query, setQuery] = useState('');
  const [sortKey, setSortKey] = useState<SortKey>('updated');

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchProjects();
      setProjects(res.projects);
      // Decorate cards as facts arrive; the list itself never waits on these.
      res.projects.forEach((p) => {
        void fetchProjectFacts(p.id).then((f) =>
          setFacts((prev) => ({ ...prev, [p.id]: f })),
        );
      });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  /* Library-wide aggregates for the header strip. */
  const chemistries = useMemo(
    () => Array.from(new Set(projects.flatMap((p) => p.cathodeTypes))).sort(),
    [projects],
  );
  const totals = useMemo(
    () => ({
      cells: projects.reduce((a, p) => a + p.cellCount, 0),
      datasets: Object.values(facts).reduce((a, f) => a + (f.datasetCount ?? 0), 0),
    }),
    [projects, facts],
  );

  const visibleProjects = useMemo(() => {
    const q = query.trim().toLowerCase();
    const filtered = q
      ? projects.filter(
          (p) =>
            p.name.toLowerCase().includes(q) ||
            p.cathodeTypes.some((c) => c.toLowerCase().includes(q)),
        )
      : projects;
    return [...filtered].sort((a, b) => {
      if (sortKey === 'name') return a.name.localeCompare(b.name);
      if (sortKey === 'cells') return b.cellCount - a.cellCount;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
  }, [projects, query, sortKey]);

  const startRename = useCallback((p: ProjectSummary) => {
    setEditingId(p.id);
    setDraftName(p.name);
  }, []);

  const commitRename = useCallback(async () => {
    if (!editingId) return;
    const trimmed = draftName.trim();
    if (!trimmed) return;
    try {
      await renameProject(editingId, trimmed);
      setProjects((prev) =>
        prev.map((p) => (p.id === editingId ? { ...p, name: trimmed } : p)),
      );
      setEditingId(null);
      setDraftName('');
    } catch (e) {
      toast({
        title: 'Rename failed',
        description: e instanceof Error ? e.message : 'Could not rename project.',
        variant: 'destructive',
      });
    }
  }, [draftName, editingId, toast]);

  const createNewProject = useCallback(async () => {
    try {
      const created = await createProject('Untitled project');
      setProjects((prev) => [created, ...prev]);
      setEditingId(created.id);
      setDraftName(created.name);
    } catch (e) {
      toast({
        title: 'Create failed',
        description: e instanceof Error ? e.message : 'Could not create project.',
        variant: 'destructive',
      });
    }
  }, [toast]);

  const removeProject = useCallback(
    async (id: string) => {
      try {
        await deleteProject(id);
        setProjects((prev) => prev.filter((p) => p.id !== id));
      } catch (e) {
        toast({
          title: 'Delete failed',
          description: e instanceof Error ? e.message : 'Could not delete project.',
          variant: 'destructive',
        });
      } finally {
        setPendingDelete(null);
      }
    },
    [toast],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* ── Library masthead ─────────────────────────────────────── */}
      <header className="border-b border-border bg-card">
        <div className="mx-auto max-w-6xl px-6 pb-4 pt-5">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <div className="flex h-9 w-9 items-center justify-center rounded-md border border-border bg-background">
                <FlaskConical className="h-5 w-5 text-primary" />
              </div>
              <div>
                <h1 className="text-xl font-bold leading-tight tracking-tight">CellSeer</h1>
                <p className="text-xs text-muted-foreground">Battery cell library</p>
              </div>
            </div>
            <Button onClick={createNewProject}>
              <Plus className="h-4 w-4" />
              New project
            </Button>
          </div>

          {/* Library facts — one trusted corpus, summarised */}
          <p className="mt-4 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            <span className="text-foreground">{projects.length}</span> project{projects.length === 1 ? '' : 's'}
            <span className="mx-2 text-border">·</span>
            <span className="text-foreground">{totals.cells}</span> cells
            <span className="mx-2 text-border">·</span>
            <span className="text-foreground">{totals.datasets}</span> cycling datasets
            <span className="mx-2 text-border">·</span>
            <span className="text-foreground">{chemistries.length}</span> chemistries
          </p>
        </div>
      </header>

      <main className="mx-auto max-w-6xl px-6 py-5">
        {/* ── Browse toolbar ───────────────────────────────────────── */}
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <div className="relative">
            <Search className="pointer-events-none absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
            <Input
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search projects or chemistries…"
              className="h-8 w-72 pl-8 text-sm"
              aria-label="Search projects"
            />
          </div>
          <Select value={sortKey} onValueChange={(v) => setSortKey(v as SortKey)}>
            <SelectTrigger className="h-8 w-[210px] text-sm" aria-label="Sort projects">
              <span className="mr-1 text-xs text-muted-foreground">Sort:</span>
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="updated">Recently updated</SelectItem>
              <SelectItem value="name">Name</SelectItem>
              <SelectItem value="cells">Cell count</SelectItem>
            </SelectContent>
          </Select>
          <p className="ml-auto font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
            {visibleProjects.length} shown
          </p>
        </div>

        {/* ── Project records ──────────────────────────────────────── */}
        {loading ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            <LoadingIndicator variant="stacked" size="md" label="Loading library…" />
          </div>
        ) : visibleProjects.length === 0 ? (
          <div className="rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">
              {projects.length === 0 ? 'The library is empty' : 'No projects match your search'}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              {projects.length === 0
                ? 'Import from DIGIBAT or upload cycling files to start the library.'
                : 'Try a different name or chemistry.'}
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {visibleProjects.map((project) => {
              const isEditing = editingId === project.id;
              const f = facts[project.id];
              return (
                <article
                  key={project.id}
                  className="group flex cursor-pointer flex-col rounded-md border border-border bg-card p-4 transition-colors hover:border-primary/60"
                  onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}
                >
                  <div className="flex items-start justify-between gap-2">
                    {isEditing ? (
                      <input
                        autoFocus
                        className="h-7 w-full rounded border bg-background px-2 text-sm"
                        value={draftName}
                        onChange={(e) => setDraftName(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') {
                            e.preventDefault();
                            void commitRename();
                          } else if (e.key === 'Escape') {
                            setEditingId(null);
                          }
                        }}
                      />
                    ) : (
                      <h2 className="line-clamp-1 text-sm font-semibold leading-6">{project.name}</h2>
                    )}
                    <div className="flex items-center gap-0.5">
                      {isEditing ? (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            aria-label="Confirm rename"
                            onClick={(e) => {
                              e.stopPropagation();
                              void commitRename();
                            }}
                          >
                            <Check className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6"
                            aria-label="Cancel rename"
                            onClick={(e) => {
                              e.stopPropagation();
                              setEditingId(null);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 opacity-0 transition-opacity group-hover:opacity-100"
                            aria-label={`Rename project ${project.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              startRename(project);
                            }}
                          >
                            <Pencil className="h-3.5 w-3.5" />
                          </Button>
                          <Button
                            size="icon"
                            variant="ghost"
                            className="h-6 w-6 text-destructive opacity-0 transition-opacity group-hover:opacity-100"
                            aria-label={`Delete project ${project.name}`}
                            onClick={(e) => {
                              e.stopPropagation();
                              setPendingDelete(project);
                            }}
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </Button>
                        </>
                      )}
                    </div>
                  </div>

                  <p className="mt-1 font-mono text-[11px] uppercase tracking-wider text-muted-foreground">
                    <span className="text-foreground">{project.cellCount}</span> cell{project.cellCount === 1 ? '' : 's'}
                    {f?.datasetCount != null && (
                      <>
                        <span className="mx-1.5 text-border">·</span>
                        <span className="text-foreground">{f.datasetCount}</span> dataset{f.datasetCount === 1 ? '' : 's'}
                      </>
                    )}
                    {f?.digibatSynced && (
                      <>
                        <span className="mx-1.5 text-border">·</span>
                        <span className="rounded-sm border border-border px-1 py-px text-[10px] text-primary">
                          DIGIBAT
                        </span>
                      </>
                    )}
                  </p>

                  <div
                    className="mt-2.5 flex h-[3.25rem] flex-wrap content-start gap-1.5 overflow-hidden"
                    aria-label="Chemistries"
                  >
                    {project.cathodeTypes.slice(0, 4).map((c) => (
                      <span
                        key={c}
                        className="inline-flex h-5 max-w-full items-center gap-1.5 truncate rounded-full border border-border px-2 text-[11px] text-muted-foreground"
                      >
                        <span
                          className="h-2 w-2 shrink-0 rounded-full"
                          style={{
                            backgroundColor:
                              CHEM_PALETTE[Math.max(0, chemistries.indexOf(c)) % CHEM_PALETTE.length],
                          }}
                        />
                        <span className="truncate">{c}</span>
                      </span>
                    ))}
                    {project.cathodeTypes.length > 4 && (
                      <span className="inline-flex h-5 items-center rounded-full border border-dashed border-border px-2 text-[11px] text-muted-foreground">
                        +{project.cathodeTypes.length - 4} more
                      </span>
                    )}
                    {project.cathodeTypes.length === 0 && (
                      <span className="self-start text-[11px] text-muted-foreground">No metadata yet</span>
                    )}
                  </div>

                  <div className="mt-auto flex items-center justify-between border-t border-border pt-2.5">
                    <span className="text-xs text-muted-foreground">
                      Updated {relativeTime(project.updatedAt)}
                    </span>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-6 gap-1 px-2 text-xs text-primary disabled:cursor-not-allowed disabled:text-muted-foreground/60 disabled:opacity-100"
                      disabled={!f?.canEnterDashboard}
                      title={
                        f?.canEnterDashboard
                          ? 'Open dashboard'
                          : 'Add cycling data to enable the dashboard'
                      }
                      onClick={(e) => {
                        e.stopPropagation();
                        if (!f?.canEnterDashboard) return;
                        navigate(`/projects/${encodeURIComponent(project.id)}/dashboard`);
                      }}
                    >
                      <LayoutDashboard className="h-3 w-3" />
                      Dashboard
                    </Button>
                  </div>
                </article>
              );
            })}
          </div>
        )}
      </main>

      <Dialog open={pendingDelete !== null} onOpenChange={(open) => { if (!open) setPendingDelete(null); }}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Delete project?</DialogTitle>
            <DialogDescription>
              {pendingDelete
                ? `"${pendingDelete.name}" and its ${pendingDelete.cellCount} ${pendingDelete.cellCount === 1 ? 'cell' : 'cells'} will be removed. This cannot be undone.`
                : ''}
            </DialogDescription>
          </DialogHeader>
          <DialogFooter>
            <Button variant="outline" onClick={() => setPendingDelete(null)}>
              Cancel
            </Button>
            <Button
              variant="destructive"
              onClick={() => {
                if (pendingDelete) void removeProject(pendingDelete.id);
              }}
            >
              Delete project
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
