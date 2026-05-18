/**
 * Hook to fetch hierarchy analysis from the backend API.
 * Replaces client-side analyseColumns/buildTree/buildActiveAnalysis.
 */

import { useEffect, useState, useMemo } from 'react';
import { analyseCSV } from '@/lib/analyseApi';
import type { AnalysisResult, TreeNode } from '@/lib/treeUtils';
import { doLayout } from '@/lib/treeUtils';

export interface UseHierarchyFromApiResult {
  analysis: AnalysisResult | null;
  tree: TreeNode | null;
  colourMaps: Record<string, string>[];
  colourMapsPerceptual: Record<string, string>[];
  pathToColorMap: Record<string, string>;
  pathToColorMapPerceptual: Record<string, string>;
  loading: boolean;
  error: string | null;
}

/** Serialize headers + rows to CSV text. */
function toCsvText(headers: string[], rows: string[][]): string {
  if (!headers?.length) return '';
  const headerLine = headers.join(',');
  const rowLines = rows.map((r) => r.join(','));
  return [headerLine, ...rowLines].join('\n');
}

export function useHierarchyFromApi(
  csvData: { headers: string[]; rows: string[][] } | null,
  activeJs: number[]
): UseHierarchyFromApiResult {
  const [data, setData] = useState<Awaited<ReturnType<typeof analyseCSV>> | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!csvData?.headers?.length || !csvData?.rows?.length) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    const csvText = toCsvText(csvData.headers, csvData.rows);
    if (!csvText.trim()) {
      setData(null);
      setLoading(false);
      setError(null);
      return;
    }
    setLoading(true);
    setError(null);
    analyseCSV(csvText, {
      maxLevels: 4,
      userHierJs: activeJs.length > 0 ? activeJs : undefined,
    })
      .then((res) => {
        setData(res);
      })
      .catch((e) => {
        setError(e instanceof Error ? e.message : 'Analysis failed');
        setData(null);
      })
      .finally(() => setLoading(false));
  }, [csvData, activeJs]);

  return useMemo(() => {
    if (!data) {
      return {
        analysis: null,
        tree: null,
        colourMaps: [],
        colourMapsPerceptual: [],
        pathToColorMap: {},
        pathToColorMapPerceptual: {},
        loading,
        error,
      };
    }
    const tree = data.tree as TreeNode;
    doLayout(tree);
    return {
      analysis: data.analysis as AnalysisResult,
      tree,
      colourMaps: data.colourMaps ?? [],
      colourMapsPerceptual: data.colourMapsPerceptual ?? [],
      pathToColorMap: data.pathToColorMap ?? {},
      pathToColorMapPerceptual: data.pathToColorMapPerceptual ?? {},
      loading,
      error,
    };
  }, [data, loading, error]);
}
