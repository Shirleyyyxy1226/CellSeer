/**
 * Tiny SWR-style hook for /api/protocol-templates. We don't reach for
 * react-query here because the wizard is the *only* consumer and we want
 * a hand-rolled cache that survives close/reopen without invalidation.
 */

import * as React from 'react';

import {
  createProtocolTemplate,
  deleteProtocolTemplate,
  fetchProtocolTemplates,
  type ProtocolTemplate,
  type ProtocolTemplateCreate,
} from '@/lib/api';

interface ProtocolTemplatesState {
  templates: ProtocolTemplate[] | null;
  loading: boolean;
  error: string | null;
}

const initialState: ProtocolTemplatesState = {
  templates: null,
  loading: false,
  error: null,
};

export interface UseProtocolTemplatesResult extends ProtocolTemplatesState {
  reload: () => Promise<void>;
  save: (body: ProtocolTemplateCreate) => Promise<ProtocolTemplate | null>;
  remove: (id: string) => Promise<boolean>;
  saving: boolean;
  deletingId: string | null;
}

export function useProtocolTemplates(): UseProtocolTemplatesResult {
  const [state, setState] = React.useState<ProtocolTemplatesState>(initialState);
  const [saving, setSaving] = React.useState(false);
  const [deletingId, setDeletingId] = React.useState<string | null>(null);

  const reload = React.useCallback(async () => {
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const res = await fetchProtocolTemplates();
      setState({ templates: res.templates ?? [], loading: false, error: null });
    } catch (err) {
      setState({
        templates: null,
        loading: false,
        error: err instanceof Error ? err.message : 'Failed to load templates',
      });
    }
  }, []);

  React.useEffect(() => {
    void reload();
  }, [reload]);

  const save = React.useCallback(
    async (body: ProtocolTemplateCreate): Promise<ProtocolTemplate | null> => {
      setSaving(true);
      try {
        const res = await createProtocolTemplate(body);
        setState((s) => ({
          ...s,
          templates: [...(s.templates ?? []), res.template],
        }));
        return res.template;
      } catch (err) {
        setState((s) => ({
          ...s,
          error: err instanceof Error ? err.message : 'Failed to save template',
        }));
        return null;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  const remove = React.useCallback(async (id: string): Promise<boolean> => {
    setDeletingId(id);
    try {
      await deleteProtocolTemplate(id);
      setState((s) => ({
        ...s,
        templates: (s.templates ?? []).filter((t) => t.id !== id),
      }));
      return true;
    } catch (err) {
      setState((s) => ({
        ...s,
        error: err instanceof Error ? err.message : 'Failed to delete template',
      }));
      return false;
    } finally {
      setDeletingId(null);
    }
  }, []);

  return {
    ...state,
    saving,
    deletingId,
    reload,
    save,
    remove,
  };
}
