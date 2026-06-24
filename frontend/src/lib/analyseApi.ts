/** Backend API wrappers for hierarchy analysis and table parsing. */

import type { AnalysisResult, TreeNode } from '@/lib/treeUtils';
import { withProjectQuery } from '@/lib/projectScope';

export interface AnalyseResponse {
  parsed: { headers: string[]; rows: string[][] };
  analysis: AnalysisResult;
  tree: TreeNode;
  colourMaps: Record<string, string>[];
  colourMapsPerceptual: Record<string, string>[];
  pathToColorMap: Record<string, string>;
  pathToColorMapPerceptual: Record<string, string>;
  projectKey?: string;
}

export interface AnalyseRequest {
  csvText: string;
  maxLevels?: number;
  columnOrder?: number[] | null;
}

export interface HierarchyOrderResponse {
  order: number[];
}

export async function analyseHierarchy(
  csvText: string,
  opts?: { maxLevels?: number; columnOrder?: number[] }
): Promise<AnalyseResponse> {
  const body: AnalyseRequest = {
    csvText,
    maxLevels: opts?.maxLevels ?? 4,
    columnOrder: opts?.columnOrder ?? null,
  };
  const res = await fetch(withProjectQuery("/api/hierarchy/analyse"), {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? "Analysis failed");
  }
  return res.json();
}

export async function fetchDefaultHierarchyAnalyse(): Promise<AnalyseResponse> {
  const res = await fetch(withProjectQuery('/api/hierarchy'));
  if (!res.ok) {
    const err = await res.json().catch(() => ({ detail: res.statusText }));
    throw new Error((err as { detail?: string }).detail ?? 'Failed to load hierarchy from DB');
  }
  return res.json();
}

function withProjectKey(path: string, projectKey?: string): string {
  if (!projectKey) return path;
  return `${path}?projectKey=${encodeURIComponent(projectKey)}`;
}

export async function fetchHierarchyOrder(projectKey?: string): Promise<number[]> {
  const res = await fetch(withProjectKey('/api/hierarchy-order', projectKey));
  if (!res.ok) return [];
  const d = (await res.json()) as HierarchyOrderResponse;
  return Array.isArray(d.order) ? d.order : [];
}

export async function saveHierarchyOrder(order: number[], projectKey?: string): Promise<void> {
  await fetch(withProjectKey('/api/hierarchy-order', projectKey), {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ order }),
  });
}

export async function clearHierarchyOrder(projectKey?: string): Promise<void> {
  await fetch(withProjectKey('/api/hierarchy-order', projectKey), { method: 'DELETE' });
}
