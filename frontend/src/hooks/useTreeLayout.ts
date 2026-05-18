import { useMemo } from 'react';
import { TreeNode, treeNodeStableKey } from '@/lib/treeUtils';

export interface LayoutMetrics {
  ROW_H: number;
  COL_SP: number;
  PAD_T: number;
  PAD_L: number;
  PAD_B: number;
  fLeaf: number;
  fBranch: number;
  fHeader: number;
  charW: number;
}

export interface LayoutFrame {
  svgH: number;
  fullSvgW: number;
  viewMinX: number;
  viewW: number;
  viewH: number;
  verticalFitWidthPx: number;
  verticalFitHeightPx: number;
  verticalScaleRaw: number;
  verticalScaleApplied: number;
  readableGuardActive: boolean;
  displayW: number;
  displayH: number;
  stretchToWidth: boolean;
  stretchToFrame: boolean;
}

export interface TreeLayoutResult {
  tree: TreeNode;
  metrics: LayoutMetrics;
  frame: LayoutFrame;
  visibleLeaves: number;
}

interface UseTreeLayoutInput {
  tree: TreeNode | null | undefined;
  containerWidth: number;
  containerHeight: number;
  hierColCount: number;
  collapsedPreLeafNodeKeys?: Set<string>;
  compact?: boolean;
  fitContent?: boolean;
}

function cloneTree(node: TreeNode): TreeNode {
  return {
    ...node,
    children: node.children.map(cloneTree),
  };
}

function countVisibleLeaves(
  node: TreeNode,
  collapsed: Set<string>,
  pathSegments: string[] = [],
): number {
  if (node.isLeaf) return 1;

  const seg = `${node.colHeader ?? 'root'}=${node.rawVal ?? node.label ?? ''}`;
  const nextPath = [...pathSegments, seg];
  const nodeKey = treeNodeStableKey(nextPath);
  const isPreLeafNode = node.children.length > 0 && node.children.every((c) => c.isLeaf);
  if (isPreLeafNode && collapsed.has(nodeKey)) return 1;

  let total = 0;
  for (const child of node.children) total += countVisibleLeaves(child, collapsed, nextPath);
  return total;
}

function computeMetrics(
  containerW: number,
  containerH: number,
  visibleLeaves: number,
  hierColCount: number,
): LayoutMetrics {
  const PAD_L = -100;
  const PAD_B = 20;

  const safeW = Math.max(0, containerW);
  const safeH = Math.max(0, containerH);
  const stepCols = Math.max(1, hierColCount + 1);

  const targetFillPadding = 320;
  const availW = Math.max(240, safeW - targetFillPadding);
  const COL_SP = safeW > 0
    ? Math.max(90, Math.min(180, availW / stepCols))
    : 110;

  const PAD_T = safeH > 0
    ? Math.max(56, Math.min(90, Math.round(safeH * 0.11)))
    : 90;

  const availH = Math.max(120, safeH - PAD_T - PAD_B);
  const ROW_H = safeH > 0
    ? Math.max(16, Math.min(36, availH / Math.max(1, visibleLeaves)))
    : 30;

  const fLeaf = Math.max(9, Math.min(11, ROW_H * 0.38));
  const fBranch = Math.max(10, Math.min(12, ROW_H * 0.42));
  const fHeader = Math.max(9, Math.min(11, ROW_H * 0.38));
  const charW = fLeaf * 0.62;

  return { ROW_H, COL_SP, PAD_T, PAD_L, PAD_B, fLeaf, fBranch, fHeader, charW };
}

function assignPositions(
  root: TreeNode,
  metrics: LayoutMetrics,
  collapsed: Set<string>,
): number {
  let leafIndex = 0;

  function layout(node: TreeNode, pathSegments: string[]): void {
    node.x = node.depth === 0 ? metrics.PAD_L : metrics.PAD_L + node.depth * metrics.COL_SP;

    const seg = `${node.colHeader ?? 'root'}=${node.rawVal ?? node.label ?? ''}`;
    const nextPath = [...pathSegments, seg];
    const nodeKey = treeNodeStableKey(nextPath);
    const isPreLeafNode = !node.isLeaf && node.children.length > 0 && node.children.every((c) => c.isLeaf);
    const isCollapsed = isPreLeafNode && collapsed.has(nodeKey);

    if (node.isLeaf || isCollapsed) {
      node.y = metrics.PAD_T + leafIndex * metrics.ROW_H;
      leafIndex += 1;
      return;
    }

    for (const child of node.children) layout(child, nextPath);
    const ys = node.children.map((c) => c.y ?? metrics.PAD_T);
    node.y = (Math.min(...ys) + Math.max(...ys)) / 2;
  }

  layout(root, []);
  return leafIndex;
}

function computeHorizontalBounds(root: TreeNode, hierColCount: number, metrics: LayoutMetrics): { minX: number; maxX: number } {
  let minX = metrics.PAD_L;
  let maxX = metrics.PAD_L + (hierColCount + 1) * metrics.COL_SP + 50;

  function walk(node: TreeNode): void {
    if (node.x != null) {
      const pad = node.isLeaf ? Math.max(140, metrics.COL_SP * 1.5) : 14;
      minX = Math.min(minX, node.x - pad);
      maxX = Math.max(maxX, node.x + pad);
    }
    for (const child of node.children) walk(child);
  }

  walk(root);
  // Keep negative minX so left-side root/constants are never clipped.
  return { minX: minX - 8, maxX: maxX + 12 };
}

export function useTreeLayout(input: UseTreeLayoutInput): TreeLayoutResult | null {
  const {
    tree,
    containerWidth,
    containerHeight,
    hierColCount,
    collapsedPreLeafNodeKeys,
    compact = false,
    fitContent = false,
  } = input;

  return useMemo(() => {
    if (!tree) return null;

    const collapsed = collapsedPreLeafNodeKeys ?? new Set<string>();
    const workTree = cloneTree(tree);
    const visibleLeaves = countVisibleLeaves(workTree, collapsed);
    const metrics = computeMetrics(containerWidth, containerHeight, visibleLeaves, hierColCount);
    const placedLeaves = assignPositions(workTree, metrics, collapsed);

    const svgH = metrics.PAD_T + placedLeaves * metrics.ROW_H + 60;
    const fullSvgW = metrics.PAD_L + (hierColCount + 2) * metrics.COL_SP + 260;

    const crop = compact ? computeHorizontalBounds(workTree, hierColCount, metrics) : null;
    const viewMinX = crop ? crop.minX : 0;
    const viewW = crop ? crop.maxX - crop.minX : fullSvgW;
    const displayW = fullSvgW;
    const displayH = compact && fitContent ? svgH : svgH;
    const stretchToWidth = containerWidth > 0;
    const stretchToFrame = containerWidth > 0 && containerHeight > 0;
    const verticalScaleRaw = stretchToFrame ? (containerHeight / Math.max(1, svgH)) : 1;
    const MIN_READABLE_SCALE = 0.84;
    const readableGuardActive = compact && stretchToFrame && (
      verticalScaleRaw < MIN_READABLE_SCALE || metrics.fLeaf < 10 || metrics.ROW_H < 18
    );
    const verticalScaleApplied = readableGuardActive
      ? Math.max(verticalScaleRaw, MIN_READABLE_SCALE)
      : verticalScaleRaw;

    return {
      tree: workTree,
      metrics,
      frame: {
        svgH,
        fullSvgW,
        viewMinX,
        viewW,
        viewH: svgH,
        verticalFitWidthPx: viewW * verticalScaleApplied,
        verticalFitHeightPx: svgH * verticalScaleApplied,
        verticalScaleRaw,
        verticalScaleApplied,
        readableGuardActive,
        displayW,
        displayH,
        stretchToWidth,
        stretchToFrame,
      },
      visibleLeaves: placedLeaves,
    };
  }, [
    tree,
    containerWidth,
    containerHeight,
    hierColCount,
    collapsedPreLeafNodeKeys,
    compact,
    fitContent,
  ]);
}

