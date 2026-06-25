/* CircuitTreeMindmap.tsx — chip-card "mindmap" tree.

   Branch nodes are HTML chip-cards (coloured left bar + label +
   count badge + caret) instead of bare SVG dots. Edges are orthogonal
   "bus" routes (parent → mid-column bus → child) with thickness
   proportional to descendant count. Column gutters get numbered
   "01 · CATHODE" mono headers and a faint vertical rail tint to make
   depth columns scannable. */

import {
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
} from 'react';
import {
  AnalysisResult,
  HierVal,
  TreeNode,
  NONSTD_COLOUR,
  TBC_COLOUR,
  assignColourMap,
  assignColourMapPerceptual,
  countLeaves,
  hex2rgb,
  treeNodeStableKey,
} from '@/lib/treeUtils';
import { cellIdentityColor } from '@/lib/cellColorScheme';

/** Column-level palette for the "leftmost lineage" colour. Each branch
 *  chip and its outgoing edges share the same tint regardless of depth. */
const LINEAGE_PALETTE = [
  '#2864c8', // blue   — cathode-1
  '#ce6014', // amber  — cathode-2
  '#c43250', // raspberry
  '#3a8a4a', // green
  '#7444a8', // purple
  '#0f7a8c', // teal
  '#a05522', // ochre
  '#5e6d80', // slate
];

const HEADER_LABEL_OVERRIDES: Record<string, string> = {
  cathode: 'Cathode',
  anode: 'Anode',
  separator: 'Separator',
  spacer: 'Spacer',
  electrolyte: 'Electrolyte',
};

function displayHeader(header: string): string {
  const norm = header.trim().toLowerCase().replace(/[\s_]+/g, ' ');
  if (norm === 'repeat' || norm === 'cell' || norm === 'cell id' || norm === 'cell_id') return 'Cell';
  return HEADER_LABEL_OVERRIDES[norm] ?? header;
}

function hexToRgba(hex: string, alpha: number): string {
  return `rgba(${hex2rgb(hex)},${alpha})`;
}

interface NodeMeta {
  uid: string;
  nodeKey: string;
  depth: number;
  isLeaf: boolean;
  label: string;
  rawVal: string;
  colHeader: string;
  count: number;
  cellIds: number[];
  lineageBase: string;
  l1Index: number;
  parentUid: string | null;
  children: string[];
  hierVals: HierVal[];
  cellId?: string;
  isTBC?: boolean;
  isNonStd?: boolean;
  rowData?: string[];
  node: TreeNode;
}

interface LayoutNode extends NodeMeta {
  y: number;
}

interface CellLike {
  idNo: number;
  cellId?: string;
  cellName?: string;
  cathode?: string;
  separatorType?: string;
  spacerMm?: number | null;
}

interface CircuitTreeMindmapProps {
  analysis: AnalysisResult;
  rows: string[][];
  tree: TreeNode;
  onNodeClick?: (node: TreeNode) => void;
  /** Multi mode: toggle selection of every cell under a clicked group node. */
  onGroupToggle?: (cellIds: number[]) => void;
  selectedPath?: Array<{ header: string; val: string }>;
  multiselectionMode?: boolean;
  selectedCellIds?: number[];
  pathToColorMap?: Map<string, string>;
  cellColorMap?: Map<string, string>;
  usePerceptualColors?: boolean;
  cells?: CellLike[];
  annotationsByCell?: Record<number, { note?: string | null; tags?: string[] }>;
  onCellSelect?: (idNo: number, event?: MouseEvent) => void;
  protocolFilteredOutCellIds?: Set<number>;
  collapsedPreLeafNodeKeys?: Set<string>;
  onTogglePreLeafNode?: (nodeKey: string) => void;
  collapsedBranchNodeKeys?: Set<string>;
  onToggleBranchNode?: (nodeKey: string) => void;
  /** Free-text filter applied to node labels + cell serials. */
  searchQuery?: string;
  /** Compact tree for sidebar; influences row height + font. */
  compact?: boolean;
}

interface CellPath {
  idNo: number;
  rowTokens: Set<string>;
}

function extractIdNoFromText(text: string): number | null {
  const t = String(text ?? '').trim();
  if (!t) return null;
  const patterns = [
    /(?:^|[^a-z0-9])(?:cel|cell)[-_ ]*(\d+)(?:[^a-z0-9]|$)/i,
    /^(\d+)(?:[_-].*)?$/,
  ];
  for (const p of patterns) {
    const m = t.match(p);
    if (!m) continue;
    const id = parseInt(m[1], 10);
    if (!Number.isNaN(id)) return id;
  }
  return null;
}

function resolveLeafCell(node: TreeNode, cells: CellLike[]): CellLike | null {
  if (!cells.length) return null;
  const nodeCellIdNo = extractIdNoFromText(String(node.cellId ?? ''));
  const raw = String(node.rawVal ?? '').trim();
  const rawIdNo = extractIdNoFromText(raw);
  const explicit = nodeCellIdNo ?? rawIdNo;
  if (explicit != null) {
    const byId = cells.find((c) => c.idNo === explicit);
    if (byId) return byId;
  }
  const byName = cells.find((c) => (c.cellName || `Cell ${c.idNo}`).trim() === raw);
  if (byName) return byName;
  if (node.rowData?.length) {
    const tokens = new Set(node.rowData.map((v) => String(v ?? '').trim()).filter(Boolean));
    const byToken = cells.find((c) => {
      const fallback = `Cell ${c.idNo}`;
      return tokens.has(c.cellId ?? '') || tokens.has((c.cellName ?? '').trim()) || tokens.has(fallback);
    });
    if (byToken) return byToken;
  }
  if (node.cellId) {
    const byCellId = cells.find((c) => c.cellId === node.cellId || c.cellName === node.cellId);
    if (byCellId) return byCellId;
  }
  return null;
}

/** Build a flat meta map keyed by stable nodeKey, also returns root uid. */
function buildMeta(
  tree: TreeNode,
  cells: CellLike[],
): { metaByKey: Map<string, NodeMeta>; rootUid: string; childCountByKey: Map<string, number> } {
  const meta = new Map<string, NodeMeta>();
  const childCountByKey = new Map<string, number>();

  function walk(node: TreeNode, pathSegments: string[], l1Index: number, lineageBase: string): NodeMeta {
    const seg = `${node.colHeader ?? 'root'}=${node.rawVal ?? node.label ?? ''}`;
    const nextPath = [...pathSegments, seg];
    const nodeKey = treeNodeStableKey(nextPath);
    const isLeaf = node.isLeaf;
    const cellIds: number[] = [];

    let nextL1Index = l1Index;
    let nextLineage = lineageBase;
    if (node.depth === 1) {
      // Decide lineage colour for this depth-1 subtree using palette index by
      // first-seen sibling order in the parent.
      nextL1Index = l1Index;
      nextLineage = LINEAGE_PALETTE[nextL1Index % LINEAGE_PALETTE.length];
    }

    if (isLeaf) {
      const c = resolveLeafCell(node, cells);
      if (c) cellIds.push(c.idNo);
    }

    const children: string[] = [];
    if (!isLeaf) {
      node.children.forEach((child, idx) => {
        const childMeta = walk(
          child,
          nextPath,
          node.depth === 0 ? idx : nextL1Index,
          node.depth === 0 ? LINEAGE_PALETTE[idx % LINEAGE_PALETTE.length] : nextLineage,
        );
        children.push(childMeta.nodeKey);
        cellIds.push(...childMeta.cellIds);
      });
    }

    const entry: NodeMeta = {
      uid: nodeKey,
      nodeKey,
      depth: node.depth,
      isLeaf,
      label: node.label,
      rawVal: node.rawVal,
      colHeader: node.colHeader ?? '',
      count: isLeaf ? 1 : countLeaves(node),
      cellIds,
      lineageBase: nextLineage,
      l1Index: nextL1Index,
      parentUid: pathSegments.length === 0 ? null : treeNodeStableKey(pathSegments),
      children,
      hierVals: node.hierVals ?? [],
      cellId: node.cellId,
      isTBC: node.isTBC,
      isNonStd: node.isNonStd,
      rowData: node.rowData,
      node,
    };
    meta.set(nodeKey, entry);
    childCountByKey.set(nodeKey, children.length);
    return entry;
  }

  const root = walk(tree, [], 0, '#5e6d80');
  return { metaByKey: meta, rootUid: root.nodeKey, childCountByKey };
}

/* ───── Layout ───── */

interface LayoutResult {
  positions: Map<string, number>;
  visible: Set<string>;
  width: number;
  height: number;
  colX: Map<number, number>;
  colW: Map<number, number>;
  cellColX: number;
  cellColW: number;
  maxDepth: number;
  trunkBusX: number;
}

interface LayoutParams {
  metaByKey: Map<string, NodeMeta>;
  rootUid: string;
  isOpen: (uid: string) => boolean;
  isMatch: (uid: string) => boolean;
  hierColCount: number;
  rowGap: number;
  padT: number;
  padB: number;
  padL: number;
  chipMinW: number;
  colGap: number;
  cellChipW: number;
}

function measureText(text: string, fontPx: number): number {
  // Approximate width for monospace-ish chips. The render still uses CSS
  // text-overflow:ellipsis so this is only used for column width budgeting.
  return Math.ceil(text.length * fontPx * 0.55) + 24;
}

function computeLayout(p: LayoutParams): LayoutResult {
  const { metaByKey, rootUid, isOpen, isMatch, hierColCount, rowGap, padT, padB, padL, chipMinW, colGap, cellChipW } = p;

  const visible = new Set<string>();
  const positions = new Map<string, number>();
  const colW = new Map<number, number>();
  let cursor = 0;
  let maxDepth = 0;

  function place(uid: string): number | null {
    const m = metaByKey.get(uid);
    if (!m) return null;
    if (!isMatch(uid)) return null;

    visible.add(uid);
    maxDepth = Math.max(maxDepth, m.depth);

    // Budget column width for label.
    if (m.depth >= 1 && !m.isLeaf) {
      const textW = measureText(m.label, 12) + (m.count > 1 ? 36 : 16);
      colW.set(m.depth, Math.max(colW.get(m.depth) ?? chipMinW, Math.min(textW, 260)));
    }

    const openHere = !m.isLeaf && m.children.length > 0 && isOpen(uid);
    if (!openHere) {
      const y = padT + rowGap / 2 + cursor * rowGap;
      cursor += 1;
      positions.set(uid, y);
      return y;
    }

    const ys: number[] = [];
    for (const childUid of m.children) {
      const cy = place(childUid);
      if (cy != null) ys.push(cy);
    }
    if (ys.length === 0) {
      const y = padT + rowGap / 2 + cursor * rowGap;
      cursor += 1;
      positions.set(uid, y);
      return y;
    }
    const y = (ys[0] + ys[ys.length - 1]) / 2;
    positions.set(uid, y);
    return y;
  }

  // Render children of root left-to-right; root itself isn't drawn.
  const rootMeta = metaByKey.get(rootUid);
  if (rootMeta) rootMeta.children.forEach(place);

  // Column X positions
  const colX = new Map<number, number>();
  let x = padL;
  for (let d = 1; d <= hierColCount; d++) {
    colX.set(d, x);
    x += (colW.get(d) ?? chipMinW) + colGap;
  }
  const cellColX = x;
  const width = cellColX + cellChipW + padL;
  const height = padT + cursor * rowGap + padB;
  const trunkBusX = Math.max(8, padL - 20);

  return {
    positions,
    visible,
    width,
    height,
    colX,
    colW,
    cellColX,
    cellColW: cellChipW,
    maxDepth,
    trunkBusX,
  };
}

/* ───── Small UI atoms ───── */

function NodeCaret({
  open,
  hasChildren,
  color,
  onClick,
}: {
  open: boolean;
  hasChildren: boolean;
  color: string;
  onClick: (e: React.MouseEvent) => void;
}) {
  if (!hasChildren) return null;
  return (
    <button
      type="button"
      onClick={(e) => {
        e.stopPropagation();
        onClick(e);
      }}
      aria-label={open ? 'Collapse' : 'Expand'}
      style={{
        width: 18,
        height: 18,
        flex: 'none',
        borderRadius: 5,
        border: `1px solid ${open ? color : '#cbd5e1'}`,
        background: open ? color : '#fff',
        cursor: 'pointer',
        padding: 0,
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        transition: 'background .12s, border-color .12s',
      }}
    >
      <svg
        width="9"
        height="9"
        viewBox="0 0 9 9"
        style={{ transform: open ? 'rotate(90deg)' : 'none', transition: 'transform .15s' }}
      >
        <path
          d="M2.2 1L6 4.5 2.2 8"
          fill="none"
          stroke={open ? '#fff' : '#64748b'}
          strokeWidth="1.7"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </button>
  );
}


/* ───── Main component ───── */

export function CircuitTreeMindmap(props: CircuitTreeMindmapProps) {
  const {
    analysis,
    tree,
    onNodeClick,
    onGroupToggle,
    selectedPath,
    multiselectionMode = false,
    selectedCellIds = [],
    pathToColorMap,
    cellColorMap,
    usePerceptualColors,
    cells = [],
    annotationsByCell,
    onCellSelect,
    protocolFilteredOutCellIds,
    collapsedPreLeafNodeKeys,
    onTogglePreLeafNode,
    collapsedBranchNodeKeys,
    onToggleBranchNode,
    searchQuery,
    compact = false,
  } = props;

  const hierCols = analysis.hierCols;
  const hierColCount = hierCols.length;
  const colourMaps = useMemo(
    () => (usePerceptualColors ? assignColourMapPerceptual(hierCols) : assignColourMap(hierCols)),
    [hierCols, usePerceptualColors],
  );

  // Build flat node meta once per tree.
  const { metaByKey, rootUid } = useMemo(() => buildMeta(tree, cells), [tree, cells]);

  // Internal expanded state for non-pre-leaf branches. Pre-leaf state remains
  // controlled by parent via collapsedPreLeafNodeKeys (so single-source-of-
  // truth for "compact" mode survives).
  const [internalCollapsedBranches, setInternalCollapsedBranches] = useState<Set<string>>(new Set());
  const effectiveBranchCollapsed = collapsedBranchNodeKeys ?? internalCollapsedBranches;
  const toggleBranch = (uid: string) => {
    if (onToggleBranchNode) {
      onToggleBranchNode(uid);
      return;
    }
    setInternalCollapsedBranches((prev) => {
      const next = new Set(prev);
      if (next.has(uid)) next.delete(uid);
      else next.add(uid);
      return next;
    });
  };

  // Reset internal collapse state when the tree shape changes.
  useEffect(() => {
    setInternalCollapsedBranches(new Set());
  }, [rootUid]);

  // Search match set (visible + force-open ancestors).
  const search = useMemo(() => {
    const q = (searchQuery ?? '').trim().toLowerCase();
    if (!q) return null;
    const vis = new Set<string>();
    const forceOpen = new Set<string>();
    const hitSelf = (m: NodeMeta): boolean => {
      const label = (m.label ?? '').toLowerCase();
      if (label.includes(q)) return true;
      if (m.isLeaf && (m.rawVal ?? '').toLowerCase().includes(q)) return true;
      return false;
    };
    const walk = (uid: string): boolean => {
      const m = metaByKey.get(uid);
      if (!m) return false;
      let childHit = false;
      for (const c of m.children) {
        if (walk(c)) childHit = true;
      }
      const self = hitSelf(m);
      if (self || childHit) {
        vis.add(uid);
        if (childHit) forceOpen.add(uid);
      }
      return self || childHit;
    };
    const root = metaByKey.get(rootUid);
    root?.children.forEach(walk);
    return { vis, forceOpen };
  }, [searchQuery, metaByKey, rootUid]);

  const isPreLeafNode = (m: NodeMeta) => {
    if (m.isLeaf || m.children.length === 0) return false;
    return m.children.every((cuid) => metaByKey.get(cuid)?.isLeaf);
  };

  const isOpen = (uid: string): boolean => {
    const m = metaByKey.get(uid);
    if (!m) return false;
    if (search) return search.forceOpen.has(uid);
    if (isPreLeafNode(m)) {
      return !(collapsedPreLeafNodeKeys?.has(uid) ?? false);
    }
    return !effectiveBranchCollapsed.has(uid);
  };

  const isMatch = (uid: string): boolean => {
    if (!search) return true;
    return search.vis.has(uid);
  };

  // Container measurements for responsive widths.
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [containerW, setContainerW] = useState(0);
  useLayoutEffect(() => {
    if (!containerRef.current) return;
    const el = containerRef.current;
    const obs = new ResizeObserver(() => {
      setContainerW(el.clientWidth);
    });
    obs.observe(el);
    setContainerW(el.clientWidth);
    return () => obs.disconnect();
  }, []);

  // Manual zoom override. `null` ⇒ auto-fit to container width.
  const [userZoom, setUserZoom] = useState<number | null>(null);

  const rowGap = compact ? 30 : 34;
  const padT = compact ? 56 : 60;
  const padB = 18;
  const padL = 22;
  const colGap = compact ? 36 : 56;
  const cellChipW = compact ? 158 : 200;
  const chipMinW = compact ? 168 : 220;

  const layout = useMemo(
    () =>
      computeLayout({
        metaByKey,
        rootUid,
        isOpen,
        isMatch,
        hierColCount,
        rowGap,
        padT,
        padB,
        padL,
        chipMinW,
        colGap,
        cellChipW,
      }),
    // `isOpen`/`isMatch` capture `search`, `effectiveBranchCollapsed`, and
    // `collapsedPreLeafNodeKeys` which are listed below; including the
    // closures themselves would invalidate the memo on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [
      metaByKey,
      rootUid,
      hierColCount,
      rowGap,
      padT,
      padB,
      padL,
      chipMinW,
      colGap,
      cellChipW,
      effectiveBranchCollapsed,
      collapsedPreLeafNodeKeys,
      search,
    ],
  );

  // Visible nodes (with positions) flattened.
  const visibleNodes: LayoutNode[] = useMemo(() => {
    const out: LayoutNode[] = [];
    layout.visible.forEach((uid) => {
      const m = metaByKey.get(uid);
      const y = layout.positions.get(uid);
      if (!m || y == null) return;
      out.push({ ...m, y });
    });
    return out;
  }, [layout, metaByKey]);

  /* ── Hover lineage highlight ───────────────────────────────────────── */
  const [hoverUid, setHoverUid] = useState<string | null>(null);
  const active = useMemo(() => {
    if (!hoverUid) return null;
    const m = metaByKey.get(hoverUid);
    if (!m) return null;
    const set = new Set<string>();
    // ancestors
    let cur: NodeMeta | undefined = m;
    while (cur) {
      set.add(cur.uid);
      cur = cur.parentUid ? metaByKey.get(cur.parentUid) ?? undefined : undefined;
    }
    // descendants
    const stack = [m.uid];
    while (stack.length) {
      const top = stack.pop()!;
      set.add(top);
      const km = metaByKey.get(top);
      km?.children.forEach((c) => stack.push(c));
    }
    return set;
  }, [hoverUid, metaByKey]);

  // Soft dim only — hover/selection should highlight the lineage, NOT erase
  // the rest of the tree. Keep non-active nodes visible enough to read.
  const dimOpacity = (uid: string): number => (active && !active.has(uid) ? 0.6 : 1);

  /* ── Selected path & multi-select ──────────────────────────────────── */
  const selectedSet = useMemo(() => new Set(selectedCellIds), [selectedCellIds]);
  const selectionState = (m: NodeMeta): 'off' | 'partial' | 'on' => {
    if (!m.cellIds.length) return 'off';
    let ins = 0;
    for (const id of m.cellIds) if (selectedSet.has(id)) ins += 1;
    if (ins === 0) return 'off';
    if (ins === m.cellIds.length) return 'on';
    return 'partial';
  };

  const pathMatch = useMemo(() => {
    if (!selectedPath || selectedPath.length === 0) return null;
    return new Set(selectedPath.map((p) => `${p.header}=${p.val}`));
  }, [selectedPath]);

  // UIDs of every node (leaf + ancestors) that contains a currently-selected
  // cell. Used to highlight the connector edges and parent chips along the
  // path from the trunk down to the selected leaf so the selection is
  // immediately visible at a glance, even when the user is far-scrolled.
  const selectedLineageUids = useMemo(() => {
    const out = new Set<string>();
    if (selectedSet.size === 0) return out;
    for (const m of metaByKey.values()) {
      if (!m.cellIds || m.cellIds.length === 0) continue;
      for (const id of m.cellIds) {
        if (selectedSet.has(id)) {
          out.add(m.uid);
          break;
        }
      }
    }
    return out;
  }, [metaByKey, selectedSet]);

  const isInStream = (m: NodeMeta): boolean => {
    if (!pathMatch) return false;
    if (m.depth === 0) return true;
    let cur: NodeMeta | undefined = m;
    const ancestorKeys: string[] = [];
    while (cur && cur.depth > 0) {
      ancestorKeys.push(`${cur.colHeader}=${cur.rawVal}`);
      cur = cur.parentUid ? metaByKey.get(cur.parentUid) : undefined;
    }
    // Every level the selectedPath constrains must equal the corresponding
    // ancestor segment.
    return Array.from(pathMatch).every((seg) => ancestorKeys.includes(seg));
  };

  /* ── Lookup colour for a branch chip ───────────────────────────────── */
  const colourForNode = (m: NodeMeta): string => {
    if (m.depth === 0) return '#2a2016';
    if (m.isLeaf) {
      const c = cells.find((cc) => m.cellIds.includes(cc.idNo));
      const fromMap =
        (c?.cellName && cellColorMap?.get(c.cellName)) ??
        (m.rawVal ? cellColorMap?.get(m.rawVal) : undefined);
      if (fromMap) return fromMap;
      if (m.isNonStd) return NONSTD_COLOUR;
      if (m.isTBC) return TBC_COLOUR;
      if (c) return cellIdentityColor(c);
      return cellIdentityColor({ cellName: m.rawVal || `cell-${m.uid}` });
    }
    // Branch node: prefer the categorical perceptual palette (the same
    // assignColourMapPerceptual(hierCols) the Rate Performance chart bands use,
    // so tree and chart match exactly and deterministically); fall back to the
    // hue-mean path colour, then lineage. Keyed by level so it follows reorder.
    const pathKey = (function () {
      const segs: string[] = [];
      let cur: NodeMeta | undefined = m;
      while (cur && cur.depth > 0) {
        segs.unshift(cur.rawVal);
        cur = cur.parentUid ? metaByKey.get(cur.parentUid) : undefined;
      }
      return segs.join('|');
    })();
    const fromMap = (colourMaps[m.depth - 1] ?? {})[m.rawVal];
    if (fromMap) return fromMap;
    const fromPath = pathToColorMap?.get(pathKey);
    if (fromPath) return fromPath;
    return m.lineageBase;
  };

  /* ── Edges ─────────────────────────────────────────────────────────── */
  const edges = useMemo(() => {
    const out: Array<{
      key: string;
      uid: string;
      d: string;
      stroke: string;
      width: number;
      opacity: number;
    }> = [];
    const maxCount = Math.max(
      1,
      ...visibleNodes.filter((n) => !n.isLeaf && n.depth > 0).map((n) => n.count),
    );
    const edgeWidth = (cnt: number, leaf: boolean) =>
      leaf ? 1.3 : 1 + 3.5 * Math.sqrt(cnt / maxCount);
    for (const n of visibleNodes) {
      if (n.depth <= 0) continue;
      const parent = n.parentUid ? metaByKey.get(n.parentUid) : null;
      if (!parent) continue;
      const parentY = layout.positions.get(parent.uid);
      if (parentY == null) continue;
      // Parent column right edge → bus → child column left edge
      const parentColX = parent.depth === 0 ? layout.trunkBusX : layout.colX.get(parent.depth) ?? 0;
      const parentColW = parent.depth === 0 ? 0 : layout.colW.get(parent.depth) ?? chipMinW;
      const x1 = parent.depth === 0 ? layout.trunkBusX : parentColX + parentColW;
      const x2 = n.isLeaf ? layout.cellColX : layout.colX.get(n.depth) ?? 0;
      const busX = parent.depth === 0 ? layout.trunkBusX : (x1 + x2) / 2;
      const y1 = parentY;
      const y2 = layout.positions.get(n.uid) ?? parentY;
      const onSelectedPath = selectedLineageUids.size > 0
        ? selectedLineageUids.has(n.uid)
        : isInStream(n);
      const stroke = onSelectedPath || active?.has(n.uid) ? colourForNode(n) : '#aab7c4';
      const opacity = onSelectedPath
        ? 1
        : active && !active.has(n.uid)
        ? 0.55
        : 1;
      const baseWidth = edgeWidth(n.count, n.isLeaf);
      const width = onSelectedPath ? baseWidth + 1.6 : baseWidth;
      const d = parent.depth === 0
        ? `M${x1},${y2} L${x2},${y2}`
        : `M${x1},${y1} L${busX},${y1} L${busX},${y2} L${x2},${y2}`;
      out.push({
        key: n.uid,
        uid: n.uid,
        d,
        stroke,
        width,
        opacity,
      });
    }
    return out;
    // `colourForNode` and `chipMinW` are derived from props/state already in
    // the dep list; the helper closure is re-created each render by design.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleNodes, layout, metaByKey, active, cells, colourMaps, pathToColorMap, cellColorMap, selectedLineageUids, pathMatch]);

  /* ── Trunk (depth-1 vertical rail) ─────────────────────────────────── */
  const trunk = useMemo(() => {
    const l1 = visibleNodes.filter((n) => n.depth === 1);
    if (l1.length < 2) return null;
    const ys = l1.map((n) => n.y).sort((a, b) => a - b);
    return {
      x: layout.trunkBusX,
      y1: ys[0],
      y2: ys[ys.length - 1],
    };
  }, [visibleNodes, layout.trunkBusX]);

  const protoFilteredCells = protocolFilteredOutCellIds ?? new Set<number>();
  const showAnnotations = !!annotationsByCell;

  /* ── Render ─────────────────────────────────────────────────────── */
  const showStream = pathMatch && pathMatch.size > 0;

  // Auto-fit scale shrinks the natural tree to fit the available container
  // width. Users were observed pinch/zooming the page to see the overview;
  // this removes that need while still permitting manual zoom-in via the
  // tray controls (or Ctrl/Cmd + scroll).
  const MIN_ZOOM = 0.35;
  const MAX_ZOOM = 1.6;
  const fitScale = containerW > 0
    ? Math.max(
        MIN_ZOOM,
        Math.min(1, (containerW - 8) / Math.max(1, layout.width)),
      )
    : 1;
  const appliedScale = userZoom == null
    ? fitScale
    : Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, userZoom));
  const isFit = userZoom == null;

  // Ctrl/Cmd + wheel ⇒ zoom the tree (not the page). Bound via raw listener
  // so we can preventDefault on a non-passive event.
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const handler = (e: WheelEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return;
      e.preventDefault();
      const cur = userZoom ?? fitScale;
      const next = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, cur - e.deltaY * 0.0015));
      setUserZoom(next);
    };
    el.addEventListener('wheel', handler, { passive: false });
    return () => el.removeEventListener('wheel', handler);
  }, [userZoom, fitScale]);

  const zoomOut = () =>
    setUserZoom((z) => Math.max(MIN_ZOOM, (z ?? fitScale) - 0.1));
  const zoomIn = () =>
    setUserZoom((z) => Math.min(MAX_ZOOM, (z ?? fitScale) + 0.1));
  const resetZoom = () => setUserZoom(null);

  const scaledWidth = layout.width * appliedScale;
  const scaledHeight = layout.height * appliedScale;

  return (
    <div
      ref={containerRef}
      style={{
        position: 'relative',
        width: '100%',
        minHeight: scaledHeight,
      }}
      onMouseLeave={() => setHoverUid(null)}
    >
      {/* Floating zoom tray (top-right of the tree area). Auto-fit keeps the
          tree visible on narrow sidebars; the tray lets users opt into a
          larger or smaller scale and reset back to fit. */}
      <div
        role="group"
        aria-label="Zoom controls"
        title="Zoom controls — Ctrl/Cmd + scroll also zooms"
        style={{
          position: 'absolute',
          top: 4,
          right: 6,
          zIndex: 6,
          display: 'flex',
          alignItems: 'center',
          gap: 2,
          padding: 2,
          background: 'rgba(255,255,255,0.88)',
          backdropFilter: 'blur(4px)',
          border: '1px solid #d9dee5',
          borderRadius: 6,
          boxShadow: '0 1px 2px rgba(16,40,70,.06)',
          font: '500 10.5px DM Mono, ui-monospace, monospace',
          color: '#475569',
        }}
      >
        <span aria-hidden style={{ paddingLeft: 4, paddingRight: 2, fontSize: 9, letterSpacing: '0.08em', opacity: 0.55, textTransform: 'uppercase' }}>Zoom</span>
        <button
          type="button"
          onClick={zoomOut}
          title="Zoom out"
          aria-label="Zoom out"
          style={{
            width: 20,
            height: 20,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'inherit',
            borderRadius: 4,
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          −
        </button>
        <button
          type="button"
          onClick={resetZoom}
          title={isFit ? 'Auto-fit (Ctrl/Cmd+scroll to zoom)' : 'Reset to fit — click to auto-fit (Ctrl/Cmd+scroll to zoom)'}
          aria-label="Reset zoom to fit"
          style={{
            minWidth: 36,
            height: 20,
            padding: '0 4px',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: isFit ? 'transparent' : 'rgba(31,111,139,.10)',
            color: isFit ? '#64748b' : '#0f6f8b',
            cursor: 'pointer',
            borderRadius: 4,
            fontVariantNumeric: 'tabular-nums',
            fontSize: 10,
          }}
        >
          {isFit ? 'Fit' : `${Math.round(appliedScale * 100)}%`}
        </button>
        <button
          type="button"
          onClick={zoomIn}
          title="Zoom in"
          aria-label="Zoom in"
          style={{
            width: 20,
            height: 20,
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            border: 'none',
            background: 'transparent',
            cursor: 'pointer',
            color: 'inherit',
            borderRadius: 4,
            fontSize: 13,
            lineHeight: 1,
          }}
        >
          +
        </button>
      </div>

      {/* Outer wrapper sized to the scaled tree so the scroll container
          knows the effective content size. */}
      <div
        style={{
          position: 'relative',
          width: Math.max(containerW, scaledWidth),
          height: scaledHeight,
        }}
      >
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: layout.width,
          height: layout.height,
          transform: `scale(${appliedScale})`,
          transformOrigin: 'top left',
          fontFamily:
            'DM Mono, ui-monospace, SFMono-Regular, Menlo, Consolas, "Liberation Mono", monospace',
        }}
      >
        {/* Alternating column tint bands */}
        {Array.from({ length: hierColCount }, (_, i) => i + 1).map((d) => {
          const x = layout.colX.get(d) ?? 0;
          const w = (layout.colW.get(d) ?? chipMinW) + colGap;
          return (
            <div
              key={`band-${d}`}
              style={{
                position: 'absolute',
                left: x - 10,
                top: padT - 14,
                width: w,
                height: layout.height - padT - 4,
                background: d % 2 ? 'rgba(28,58,92,.025)' : 'transparent',
                borderRadius: 8,
                pointerEvents: 'none',
              }}
            />
          );
        })}
        {/* Cell column tint */}
        <div
          style={{
            position: 'absolute',
            left: layout.cellColX - 10,
            top: padT - 14,
            width: layout.cellColW + 20,
            height: layout.height - padT - 4,
            background: 'rgba(31,111,139,.045)',
            borderRadius: 8,
            pointerEvents: 'none',
          }}
        />

        {/* SVG edges + column headers + trunk */}
        <svg
          width={Math.max(layout.width, containerW)}
          height={layout.height}
          style={{ position: 'absolute', inset: 0, pointerEvents: 'none' }}
        >
          {/* Column headers */}
          {Array.from({ length: hierColCount }, (_, i) => i + 1).map((d) => {
            const col = hierCols[d - 1];
            if (!col) return null;
            const x = layout.colX.get(d) ?? 0;
            const w = layout.colW.get(d) ?? chipMinW;
            return (
              <g key={`hdr-${d}`}>
                <text
                  x={x}
                  y={26}
                  style={{
                    font: '700 9.5px DM Mono, monospace',
                    fill: '#7e8a99',
                    letterSpacing: '0.11em',
                  }}
                >
                  {`${('0' + d).slice(-2)} · ${displayHeader(col.header).toUpperCase()}`}
                </text>
                <line x1={x} x2={x + w} y1={36} y2={36} stroke="#d9dee5" />
              </g>
            );
          })}
          <g>
            <text
              x={layout.cellColX}
              y={26}
              style={{
                font: '700 9.5px DM Mono, monospace',
                fill: '#1f6f8b',
                letterSpacing: '0.11em',
              }}
            >
              {`${('0' + (hierColCount + 1)).slice(-2)} · CELL`}
            </text>
            <line
              x1={layout.cellColX}
              x2={layout.cellColX + layout.cellColW}
              y1={36}
              y2={36}
              stroke="#cfdce3"
            />
          </g>

          {/* Trunk vertical bus from root */}
          {trunk && (
            <line
              x1={trunk.x}
              y1={trunk.y1}
              x2={trunk.x}
              y2={trunk.y2}
              stroke="#aab7c4"
              strokeWidth={1.5}
              strokeOpacity={active ? 0.4 : 1}
            />
          )}

          {/* Edges */}
          {edges.map((e) => (
            <path
              key={e.key}
              d={e.d}
              fill="none"
              stroke={e.stroke}
              strokeWidth={e.width}
              strokeOpacity={e.opacity}
              strokeLinecap="round"
              strokeLinejoin="round"
            />
          ))}
        </svg>

        {/* HTML chip layer */}
        {visibleNodes.map((n) => {
          if (n.depth === 0) return null;
          const isHot = !!active && active.has(n.uid);
          const dim = dimOpacity(n.uid);
          const inStream = showStream ? isInStream(n) : true;
          const streamFaded = showStream && !inStream;
          const baseColor = colourForNode(n);
          const tint = hexToRgba(baseColor, 0.26);
          const stateOpacity = streamFaded ? 0.7 : dim;
          const onPointerEnter = () => setHoverUid(n.uid);
          if (n.isLeaf) {
            const cell = cells.find((c) => n.cellIds.includes(c.idNo)) ?? null;
            const cellSel = cell && selectedSet.has(cell.idNo);
            const ann = cell && annotationsByCell ? annotationsByCell[cell.idNo] : undefined;
            const hasNote = ann?.note != null && String(ann.note).trim() !== '';
            const hasTags = (ann?.tags?.length ?? 0) > 0;
            const filtered = cell && protoFilteredCells.has(cell.idNo);
            // Selected leaf always renders at full opacity so the highlight
            // can't be washed out by the surrounding stream-fade dimming.
            const finalOpacity = cellSel ? 1 : filtered ? 0.42 : stateOpacity;
            return (
              <div
                key={n.uid}
                onMouseEnter={onPointerEnter}
                onClick={(e) => {
                  e.stopPropagation();
                  if (onNodeClick) onNodeClick(n.node);
                  if (cell && onCellSelect) onCellSelect(cell.idNo, e.nativeEvent);
                }}
                title={`Open detail panel for ${n.label}`}
                aria-label={`Select cell ${n.label} — opens detail panel and drives charts`}
                style={{
                  position: 'absolute',
                  left: layout.cellColX,
                  top: n.y - 11,
                  width: layout.cellColW,
                  height: 22,
                  display: 'flex',
                  alignItems: 'center',
                  gap: 7,
                  cursor: 'cell',
                  padding: '0 9px',
                  borderRadius: 6,
                  background: cellSel ? hexToRgba(baseColor, 0.28) : '#fff',
                  border: `${cellSel ? 1.8 : 1}px solid ${cellSel ? baseColor : '#d9dee5'}`,
                  opacity: finalOpacity,
                  boxShadow: cellSel
                    ? `0 0 0 2px ${hexToRgba(baseColor, 0.28)}, 0 2px 6px rgba(16,40,70,.18)`
                    : 'none',
                  transition: 'opacity .14s, border-color .14s, background .14s, box-shadow .14s',
                  outline: isHot && !cellSel ? '1.5px dashed #3b82f6' : undefined,
                  outlineOffset: 1,
                  zIndex: cellSel ? 5 : isHot ? 3 : 1,
                  fontSize: 11,
                }}
              >
                {multiselectionMode ? (
                  <span
                    aria-hidden
                    style={{
                      width: 13,
                      height: 13,
                      borderRadius: 4,
                      flex: 'none',
                      border: `1.5px solid ${cellSel ? baseColor : '#94a3b8'}`,
                      background: cellSel ? baseColor : '#fff',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                    }}
                  >
                    {cellSel && (
                      <svg width="8" height="8" viewBox="0 0 12 12">
                        <path
                          d="M2.6 6.2l2 2 4.6-4.8"
                          fill="none"
                          stroke="#fff"
                          strokeWidth="2.2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                      </svg>
                    )}
                  </span>
                ) : (
                  <span
                    aria-hidden
                    style={{
                      width: 9,
                      height: 9,
                      borderRadius: 9,
                      flex: 'none',
                      background: cellSel ? baseColor : '#fff',
                      border: `1.4px solid ${baseColor}`,
                    }}
                  />
                )}
                <span
                  style={{
                    flex: 1,
                    minWidth: 0,
                    font: `${cellSel ? 600 : 500} 11px DM Mono, monospace`,
                    color: cellSel ? '#0f172a' : '#475569',
                    whiteSpace: 'nowrap',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                  }}
                  title={n.rawVal && n.rawVal !== n.label ? `${n.label} (${n.rawVal})` : n.label}
                >
                  {n.label}
                </span>
                {(hasNote || hasTags) && (
                  <span
                    role="img"
                    aria-label={hasTags ? 'Tagged' : 'Has note'}
                    title={hasTags ? 'Tagged' : 'Has note'}
                    style={{ color: '#94a3b8', flex: 'none', display: 'inline-flex', alignItems: 'center' }}
                  >
                    {hasTags ? (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M20.59 13.41l-7.17 7.17a2 2 0 0 1-2.83 0L2 12V2h10l8.59 8.59a2 2 0 0 1 0 2.82z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <line x1="7" y1="7" x2="7.01" y2="7" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" aria-hidden>
                        <path
                          d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"
                          stroke="currentColor"
                          strokeWidth="2"
                          strokeLinecap="round"
                          strokeLinejoin="round"
                        />
                        <polyline points="14 2 14 8 20 8" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                        <line x1="16" y1="13" x2="8" y2="13" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                        <line x1="16" y1="17" x2="8" y2="17" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      </svg>
                    )}
                  </span>
                )}
              </div>
            );
          }

          // Branch chip
          const sel = selectionState(n);
          const hasKids = n.children.length > 0;
          const open = isOpen(n.uid);
          const isPreLeaf = isPreLeafNode(n);
          const caretToggle = (e: React.MouseEvent) => {
            e.stopPropagation();
            if (isPreLeaf && onTogglePreLeafNode) {
              onTogglePreLeafNode(n.uid);
            } else {
              toggleBranch(n.uid);
            }
          };
          const chipX = layout.colX.get(n.depth) ?? 0;
          const chipW = layout.colW.get(n.depth) ?? chipMinW;
          const isSelectedBranch = sel !== 'off';
          const chipBg = isSelectedBranch
            ? hexToRgba(baseColor, 0.18)
            : isHot
            ? hexToRgba(baseColor, 0.06)
            : '#fff';
          const chipBorder = isSelectedBranch
            ? baseColor
            : isHot
            ? hexToRgba(baseColor, 0.55)
            : '#d9dee5';
          const chipStyle: CSSProperties = {
            position: 'absolute',
            left: chipX,
            top: n.y - 13,
            width: chipW,
            height: 26,
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            cursor: 'pointer',
            padding: '0 8px 0 0',
            borderRadius: 7,
            background: chipBg,
            border: `${isSelectedBranch ? 1.6 : 1}px solid ${chipBorder}`,
            boxShadow: isSelectedBranch
              ? `0 0 0 2px ${hexToRgba(baseColor, 0.22)}, 0 2px 8px rgba(16,40,70,.12)`
              : isHot
              ? '0 4px 12px rgba(16,40,70,.10)'
              : '0 1px 1px rgba(16,40,70,.04)',
            // Selected branches stay fully visible even when stream-faded so
            // the lineage from trunk → leaf reads as one continuous highlight.
            opacity: isSelectedBranch ? 1 : stateOpacity,
            transition: 'opacity .14s, border-color .14s, background .14s, box-shadow .14s',
            zIndex: isSelectedBranch ? 4 : isHot ? 4 : 2,
            overflow: 'hidden',
          };
          return (
            <div
              key={n.uid}
              onMouseEnter={onPointerEnter}
              onClick={(e) => {
                e.stopPropagation();
                // Multi mode: clicking a group toggles all its cells into the
                // selection (shows the group checkbox/selected effect). Single
                // mode keeps the drill/filter behaviour.
                if (multiselectionMode && onGroupToggle) onGroupToggle(n.cellIds);
                else if (onNodeClick) onNodeClick(n.node);
              }}
              title={
                multiselectionMode
                  ? `Select all ${n.count} cells under ${n.label}`
                  : `Filter charts to ${n.label} (${n.count} cells)`
              }
              aria-label={
                multiselectionMode
                  ? `Select all ${n.count} cells under ${n.label}`
                  : `Filter chart tabs to ${n.label} — ${n.count} cells`
              }
              style={chipStyle}
            >
              <span
                style={{
                  width: 5,
                  height: '100%',
                  background: baseColor,
                  flex: 'none',
                }}
              />
              {multiselectionMode && (
                <span
                  aria-hidden
                  style={{
                    width: 14,
                    height: 14,
                    borderRadius: 4,
                    flex: 'none',
                    border: `1.6px solid ${sel !== 'off' ? baseColor : '#94a3b8'}`,
                    background: sel !== 'off' ? baseColor : '#fff',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                  }}
                >
                  {sel === 'on' && (
                    <svg width="9" height="9" viewBox="0 0 12 12">
                      <path
                        d="M2.6 6.2l2 2 4.6-4.8"
                        fill="none"
                        stroke="#fff"
                        strokeWidth="2"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  )}
                  {sel === 'partial' && (
                    <span style={{ width: 7, height: 2, background: '#fff', borderRadius: 1 }} />
                  )}
                </span>
              )}
              <span
                style={{
                  flex: 1,
                  minWidth: 0,
                  font: '600 12.5px Syne, "Inter", system-ui, sans-serif',
                  color: '#0f172a',
                  whiteSpace: 'nowrap',
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                }}
                title={n.label}
              >
                {n.label}
              </span>
              <span
                style={{
                  flex: 'none',
                  font: '600 10.5px DM Mono, monospace',
                  color: baseColor,
                  textAlign: 'right',
                  minWidth: 26,
                }}
                aria-label={`${n.count} cells`}
                title={`Contains ${n.count} cells`}
              >
                {n.count}{' '}<span style={{ fontWeight: 400, opacity: 0.75, fontSize: 9.5 }}>cells</span>
              </span>
              {hasKids && (
                <NodeCaret
                  open={open}
                  hasChildren={hasKids}
                  color={baseColor}
                  onClick={caretToggle}
                />
              )}
            </div>
          );
        })}
      </div>
      </div>
    </div>
  );
}

export default CircuitTreeMindmap;
