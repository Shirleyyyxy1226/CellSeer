import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Check, Pencil, Plus, Trash2, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { createProject, deleteProject, fetchProjects, renameProject, type ProjectSummary } from '@/lib/api';
import { useToast } from '@/hooks/use-toast';

export default function HomePage() {
  const navigate = useNavigate();
  const { toast } = useToast();
  const [projects, setProjects] = useState<ProjectSummary[]>([]);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draftName, setDraftName] = useState('');
  const [loading, setLoading] = useState(true);

  const refreshProjects = useCallback(async () => {
    setLoading(true);
    try {
      const res = await fetchProjects();
      setProjects(res.projects);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refreshProjects();
  }, [refreshProjects]);

  const projectCountLabel = useMemo(() => `${projects.length} project${projects.length === 1 ? '' : 's'}`, [projects.length]);

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
      }
    },
    [toast],
  );

  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-6xl p-6">
        <header className="mb-6 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold">CellSeer</h1>
            <p className="text-sm text-muted-foreground">{projectCountLabel}</p>
          </div>
          <Button onClick={createNewProject}>
            <Plus className="h-4 w-4" />
            New project
          </Button>
        </header>

        {loading ? (
          <div className="rounded-lg border border-dashed p-10 text-center text-sm text-muted-foreground">
            Loading projects...
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((project) => {
              const isEditing = editingId === project.id;
              return (
                <Card
                  key={project.id}
                  className="cursor-pointer transition-colors hover:border-primary/60"
                  onClick={() => navigate(`/projects/${encodeURIComponent(project.id)}`)}
                >
                  <CardHeader className="pb-3">
                    <div className="flex items-start justify-between gap-3">
                      {isEditing ? (
                        <input
                          autoFocus
                          className="h-8 w-full rounded border bg-background px-2 text-sm"
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
                        <CardTitle className="line-clamp-1 text-base">{project.name}</CardTitle>
                      )}
                      <div className="flex items-center gap-1">
                        {isEditing ? (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                void commitRename();
                              }}
                            >
                              <Check className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                setEditingId(null);
                              }}
                            >
                              <X className="h-4 w-4" />
                            </Button>
                          </>
                        ) : (
                          <>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7"
                              onClick={(e) => {
                                e.stopPropagation();
                                startRename(project);
                              }}
                            >
                              <Pencil className="h-4 w-4" />
                            </Button>
                            <Button
                              size="icon"
                              variant="ghost"
                              className="h-7 w-7 text-destructive"
                              onClick={(e) => {
                                e.stopPropagation();
                                void removeProject(project.id);
                              }}
                            >
                              <Trash2 className="h-4 w-4" />
                            </Button>
                          </>
                        )}
                      </div>
                    </div>
                    <p className="text-xs text-muted-foreground">
                      Updated {new Date(project.updatedAt).toLocaleString()}
                    </p>
                  </CardHeader>
                  <CardContent className="pt-0">
                    <div className="flex flex-wrap gap-2">
                      <span className="rounded-full bg-secondary px-2 py-1 text-xs">
                        {project.cellCount} cells
                      </span>
                      {project.cathodeTypes.map((c) => (
                        <span key={c} className="rounded-full bg-muted px-2 py-1 text-xs text-muted-foreground">
                          {c}
                        </span>
                      ))}
                    </div>
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
