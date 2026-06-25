import { useEffect, useRef, useState } from 'react';
import {
  AnalysisResult,
  TreeNode,
  HierVal,
  ConstantDisplay,
  NONSTD_COLOUR,
  TBC_COLOUR,
  treeNodeStableKey,
  assignColourMap,
  assignColourMapPerceptual,
  buildDisplayConstants,
  nodeRightEdge,
  nodeLeftEdge,
  hex2rgb,
} from '@/lib/treeUtils';
import { cellIdentityColor } from '@/lib/cellColorScheme';
import type { TreeLayoutResult } from '@/hooks/useTreeLayout';

interface TooltipData {
  label: string;
  hierVals: HierVal[];
  cellId?: string;
  isNonStd?: boolean;
  isTBC?: boolean;
}

interface TreeSvgProps {
  analysis: AnalysisResult;
  rows: string[][];
  /** When set, makes all nodes clickable for filtering */
  onNodeClick?: (node: TreeNode) => void;
  /** Smaller layout for sidebar embedding */
  compact?: boolean;
  /** Pre-built tree (from API) - when provided, use instead of building internally */
  tree?: TreeNode;
  /** Pre-built colour maps from API – when provided, skip client-side assignColourMap */
  colourMaps?: Record<string, string>[];
  /** When true, omit minHeight so container fits content exactly */
  fitContent?: boolean;
  /** Path from root to selected node – highlight this stream */
  selectedPath?: Array<{ header: string; val: string }>;
  /** Use perceptual uniform colors (for plot matching when selected) */
  usePerceptualColors?: boolean;
  /** Canonical cell→color map for leaf nodes – matches chart colors */
  cellColorMap?: Map<string, string>;
  /** Path→color map (cathode|separator|spacer|cell) – when provided, overrides others for exact chart/tree match */
  pathToColorMap?: Map<string, string>;
  /** Cells + annotations for showing tag/note indicators on leaf nodes */
  cells?: Array<{ idNo: number; cellId?: string; cellName?: string; cathode?: string; separatorType?: string; separatorMm?: number | null }>;
  annotationsByCell?: Record<number, { note?: string | null; tags?: string[] }>;
  /** When tag/note is clicked, select this cell (opens CellDetailPanel). Pass event for Ctrl/Cmd+click multi-select. */
  onCellSelect?: (idNo: number, event?: MouseEvent) => void;
  /** When multiselection mode: highlight leaf nodes whose cell idNo is in this set */
  selectedCellIds?: number[];
  /** Cell idNos filtered out by protocol – gray + reduced opacity (distinct from multiselect unselected) */
  protocolFilteredOutCellIds?: Set<number>;
  /** Controlled collapse state for pre-leaf nodes (parents of final cell layer). */
  collapsedPreLeafNodeKeys?: Set<string>;
  /** Toggle callback for pre-leaf node collapse/expand. */
  onTogglePreLeafNode?: (nodeKey: string) => void;
  /** Precomputed layout result (single source of truth for coordinates/metrics/frame). */
  layout: TreeLayoutResult;
}

const NS = 'http://www.w3.org/2000/svg';

function finiteOr(value: number, fallback: number): number {
  return Number.isFinite(value) ? value : fallback;
}

function svgEl(tag: string, attrs: Record<string, string | number> = {}, text = ''): SVGElement {
  const e = document.createElementNS(NS, tag) as SVGElement;
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  if (text) e.textContent = text;
  return e;
}

/** Append text with white 70% opacity background for legibility. */
function appendLabelWithBg(
  parent: SVGGElement,
  x: number,
  y: number,
  textContent: string,
  attrs: Record<string, string | number>,
  pad = 3,
  opacity?: number,
  wrap?: { maxWidthPx: number; charW?: number; lineHeight?: number },
  truncate?: { maxWidthPx: number },
): SVGTextElement {
  const g = document.createElementNS(NS, 'g') as SVGGElement;
  if (opacity != null) g.setAttribute('opacity', String(opacity));
  const txt = svgEl('text', { x, y, ...attrs });

  if (wrap && wrap.maxWidthPx > 0) {
    const charW = wrap.charW ?? 6.2;
    const lineHeight = wrap.lineHeight ?? 12;
    const maxChars = Math.max(6, Math.floor(wrap.maxWidthPx / charW));
    const words = String(textContent).split(/\s+/).filter(Boolean);
    const lines: string[] = [];

    if (words.length === 0) {
      lines.push('');
    } else {
      let cur = '';
      for (const word of words) {
        const candidate = cur ? `${cur} ${word}` : word;
        if (candidate.length <= maxChars) {
          cur = candidate;
          continue;
        }
        if (cur) lines.push(cur);
        if (word.length <= maxChars) {
          cur = word;
          continue;
        }
        // Hard break for very long tokens without spaces.
        for (let i = 0; i < word.length; i += maxChars) {
          const chunk = word.slice(i, i + maxChars);
          if (chunk.length === maxChars || i + maxChars < word.length) lines.push(chunk);
          else cur = chunk;
        }
      }
      if (cur) lines.push(cur);
    }

    const startY = y - ((lines.length - 1) * lineHeight) / 2;
    lines.forEach((line, idx) => {
      const tspan = svgEl(
        'tspan',
        {
          x,
          y: startY + idx * lineHeight,
        },
        line,
      );
      txt.appendChild(tspan);
    });
  } else {
    txt.textContent = textContent;
  }
  g.appendChild(txt);
  parent.appendChild(g);

  if (!wrap && truncate && truncate.maxWidthPx > 0) {
    truncateLabelToWidth(txt as SVGTextElement, textContent, truncate.maxWidthPx);
  }

  const bbox = (txt as SVGTextElement).getBBox();
  const r = svgEl('rect', {
    x: bbox.x - pad,
    y: bbox.y - pad,
    width: bbox.width + pad * 2,
    height: bbox.height + pad * 2,
    fill: '#fff',
    'fill-opacity': 0.7,
    rx: 2,
  });
  g.insertBefore(r, txt);
  return txt as SVGTextElement;
}

function truncateLabelToWidth(
  el: SVGTextElement,
  fullText: string,
  maxW: number,
): string {
  el.textContent = fullText;
  if (el.getBBox().width <= maxW) return fullText;

  let lo = 0;
  let hi = fullText.length;
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2);
    el.textContent = fullText.slice(0, mid) + '…';
    if (el.getBBox().width <= maxW) lo = mid;
    else hi = mid;
  }

  const nextText = lo <= 0 ? '…' : `${fullText.slice(0, lo)}…`;
  el.textContent = nextText;
  return nextText;
}

function truncateLabel(text: string, maxChars: number): string {
  if (maxChars <= 1) return text;
  if (text.length <= maxChars) return text;
  return text.slice(0, Math.max(1, maxChars - 1)) + '…';
}

function displayHeader(header: string): string {
  const h = header.trim().toLowerCase().replace(/[\s_]+/g, ' ');
  if (h === 'repeat' || h === 'cell' || h === 'cell id' || h === 'cell_id') return 'Cell';
  return header;
}

export function TreeSvg({ analysis, rows, onNodeClick, compact, tree: treeProp, colourMaps: colourMapsProp, fitContent, selectedPath, usePerceptualColors, cellColorMap, pathToColorMap, cells, annotationsByCell, onCellSelect, selectedCellIds, protocolFilteredOutCellIds, collapsedPreLeafNodeKeys, onTogglePreLeafNode, layout }: TreeSvgProps) {
  const svgRef     = useRef<SVGSVGElement>(null);
  const onNodeClickRef = useRef(onNodeClick);
  const onCellSelectRef = useRef(onCellSelect);
  onNodeClickRef.current = onNodeClick;
  onCellSelectRef.current = onCellSelect;
  const [tooltip, setTooltip] = useState<{
    visible: boolean;
    x: number;
    y: number;
    data: TooltipData | null;
  }>({ visible: false, x: 0, y: 0, data: null });

  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    // ── Check if node is in selected stream ─
    const path = selectedPath ?? [];
    const hasSelectedPath = path.length > 0;
    const isSingleCellSelection = path.length > 0 && path.some((p) => p.header === 'Cell');
    const cellMatchVal = isSingleCellSelection ? path.find((p) => p.header === 'Cell')?.val : null;

    function isInStream(node: TreeNode, parentInStream: boolean): boolean {
      if (path.length === 0) return false;
      if (node.depth === 0) return true;
      if (!parentInStream) return false;
      // Single-cell selection: only that leaf is in stream, not sibling cells
      if (node.isLeaf && cellMatchVal != null) {
        return node.rawVal === cellMatchVal;
      }
      // Branch selection: extend to all descendants
      if (node.isLeaf) return true;
      if (node.depth > path.length) return true;
      return path[node.depth - 1]?.val === node.rawVal;
    }

    // ── Derived data ─────────────────────────────────────────────────
    const { hierCols, leafCol, headers, rootLabelColIdx } = analysis;
    const colourMaps = colourMapsProp ?? (usePerceptualColors ? assignColourMapPerceptual(hierCols) : assignColourMap(hierCols));

    function getFirstLeafCellName(n: TreeNode): string | null {
      if (n.isLeaf) return n.rawVal;
      if (n.children.length) return getFirstLeafCellName(n.children[0]);
      return null;
    }
    const displayConstants = buildDisplayConstants(analysis, rows);
    const tree = layout.tree;
    if (!tree) return;
    const callbackTree = treeProp ?? tree;
    const m = layout.metrics;
    const frame = layout.frame;

    const nodeByStableKey = new Map<string, TreeNode>();
    const collectNodeMap = (n: TreeNode, pathSegments: string[] = []) => {
      const seg = `${n.colHeader ?? 'root'}=${n.rawVal ?? n.label ?? ''}`;
      const nextPath = [...pathSegments, seg];
      nodeByStableKey.set(treeNodeStableKey(nextPath), n);
      n.children.forEach((child) => collectNodeMap(child, nextPath));
    };
    collectNodeMap(callbackTree);

    const clickG = svgEl('g');
    if (onNodeClickRef.current) clickG.style.cursor = 'pointer';

    // ── Clear ────────────────────────────────────────────────────────
    while (svg.firstChild) svg.removeChild(svg.firstChild);
    const fitVerticalPriority = compact && !fitContent && frame.stretchToFrame;
    svg.setAttribute(
      'width',
      fitVerticalPriority
        ? String(Math.max(1, frame.verticalFitWidthPx))
        : (frame.stretchToWidth ? '100%' : String(frame.displayW)),
    );
    svg.setAttribute(
      'height',
      fitVerticalPriority
        ? (frame.readableGuardActive ? String(Math.max(1, frame.verticalFitHeightPx)) : '100%')
        : String(frame.displayH),
    );
    svg.setAttribute('viewBox', `${frame.viewMinX} 0 ${frame.viewW} ${frame.viewH}`);
    if (fitVerticalPriority) {
      // Height-first fit by default; readable guard keeps larger scale with scrolling.
      svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    } else if (frame.stretchToWidth) {
      // Use "meet" so wide hierarchies are never cropped; container can scroll.
      svg.setAttribute('preserveAspectRatio', 'xMinYMin meet');
    }

    // ── Guide lines ──────────────────────────────────────────────────
    const guideG = svgEl('g');
    svg.appendChild(guideG);
    function addGuide(x: number) {
      guideG.appendChild(svgEl('line', {
        x1: x, y1: 48, x2: x, y2: frame.svgH - 24,
        stroke: '#c8bfaf', 'stroke-width': 1,
        'stroke-dasharray': '2,8', opacity: 0.7,
      }));
    }
    addGuide(m.PAD_L);
    hierCols.forEach((_, i) => addGuide(m.PAD_L + (i + 1) * m.COL_SP));
    addGuide(m.PAD_L + (hierCols.length + 1) * m.COL_SP);

    // ── Column header labels ─────────────────────────────────────────
    const hdrG = svgEl('g');
    svg.appendChild(hdrG);
    const ACCENT_FILL = 'hsl(208, 100%, 28%)'; // primary blue, slightly lighter for visibility
    function addColHeader(x: number, label: string, accent = false) {
      hdrG.appendChild(svgEl('text', {
        x, y: 36, 'text-anchor': 'middle',
        fill: accent ? ACCENT_FILL : '#8a8070',
        'font-size': accent ? Math.max(m.fHeader, m.fHeader + 0.6) : m.fHeader,
        'font-weight': accent ? 600 : 400,
        'letter-spacing': '0.1em',
        'font-family': 'DM Mono, monospace',
      }, label.toUpperCase()));
    }
    addColHeader(m.PAD_L, `Constants (${displayConstants.length})`);
    hierCols.forEach((c, i) => addColHeader(m.PAD_L + (i + 1) * m.COL_SP, displayHeader(c.header), true));
    addColHeader(
      m.PAD_L + (hierCols.length + 1) * m.COL_SP,
      displayHeader(leafCol >= 0 ? headers[leafCol] : 'Cell'),
      true,
    );

    // ── Link + node/label groups ─────────────────────────────────────
    const linkG  = svgEl('g');
    const nodeG  = svgEl('g');
    const labelG = svgEl('g') as SVGGElement;
    svg.appendChild(linkG);
    svg.appendChild(nodeG);
    svg.appendChild(labelG);
    svg.appendChild(clickG);

    // ── Helpers ──────────────────────────────────────────────────────
    function drawLink(
      px: number, py: number,
      cx: number, cy: number,
      colour: string, opacity: number, sw: number,
      highlight?: boolean,
    ) {
      const mx = (px + cx) / 2;
      const stroke = highlight
        ? `rgba(${hex2rgb(colour)},${Math.min(1, opacity + 0.4)})`
        : `rgba(${hex2rgb(colour)},${opacity})`;
      const strokeW = highlight ? sw * 1.8 : sw;
      linkG.appendChild(svgEl('path', {
        d: `M${px},${py} C${mx},${py} ${mx},${cy} ${cx},${cy}`,
        fill: 'none',
        stroke,
        'stroke-width': strokeW,
      }));
    }

    function addClickableHitArea(
      node: TreeNode,
      clickNode: TreeNode,
      x: number,
      y: number,
      w: number,
      h: number,
      onLeafCellClick?: (n: TreeNode, e: MouseEvent) => void,
    ) {
      const rect = svgEl('rect', {
        x: x - w, y: y - h, width: w * 2, height: h * 2,
        fill: 'transparent', opacity: 0,
      });
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        onNodeClickRef.current?.(clickNode);
        if (clickNode.isLeaf && onLeafCellClick) {
          onLeafCellClick(clickNode, e as MouseEvent);
        }
      });
      clickG.appendChild(rect);
    }

    function addTagClickArea(idNo: number, x: number, y: number) {
      const rect = svgEl('rect', {
        x: x - 10, y: y - 12, width: 22, height: 18,
        fill: 'transparent',
      });
      (rect as SVGRectElement).style.pointerEvents = 'all';
      rect.style.cursor = 'pointer';
      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onCellSelectRef.current?.(idNo);
      });
      clickG.appendChild(rect);
    }

    function addTagHitArea(idNo: number, x: number, y: number) {
      const rect = svgEl('rect', {
        x: x - 10, y: y - 12, width: 22, height: 18,
        fill: 'transparent',
      });
      (rect as SVGRectElement).style.cursor = 'pointer';
      (rect as SVGRectElement).style.pointerEvents = 'all';
      rect.addEventListener('click', (e) => {
        e.stopPropagation();
        e.preventDefault();
        onCellSelectRef.current?.(idNo);
      });
      clickG.appendChild(rect);
    }

    function drawShape(
      depth: number, x: number, y: number,
      colour: string, isLeaf: boolean,
      isNonStd?: boolean, isTBC?: boolean,
      highlight?: boolean,
      nodeOpacity?: number,
    ) {
      const strokeW = highlight ? 2.5 : 1.6;
      const glow = highlight ? 1.5 : 0;
      function add(el: SVGElement) {
        if (nodeOpacity != null) el.setAttribute('opacity', String(nodeOpacity));
        nodeG.appendChild(el);
      }
      if (isLeaf) {
        const dash   = (isNonStd || isTBC) ? '3,2.5' : 'none';
        const stroke = isNonStd ? NONSTD_COLOUR : (isTBC ? TBC_COLOUR : colour);
        const fill = highlight ? stroke + '44' : stroke + '22';
        add(svgEl('circle', {
          cx: x, cy: y, r: 4.5 + glow,
          fill, stroke,
          'stroke-width': strokeW, 'stroke-dasharray': dash,
        }));
        return;
      }
      switch (depth) {
        case 0:
          add(svgEl('circle', {
            cx: x, cy: y, r: 6 + glow,
            fill: highlight ? '#3d3024' : '#2a2016',
            stroke: highlight ? '#5a4a38' : 'none',
            'stroke-width': highlight ? 2 : 0,
          }));
          break;
        case 1:
          add(svgEl('circle', {
            cx: x, cy: y, r: 10 + glow,
            fill: colour,
            stroke: highlight ? '#1a1a1a' : 'none',
            'stroke-width': highlight ? 2.5 : 0,
          }));
          break;
        case 2:
          add(svgEl('rect', {
            x: x - 6 - glow, y: y - 6 - glow,
            width: 12 + glow * 2, height: 12 + glow * 2,
            fill: colour, rx: 1.5,
            stroke: highlight ? '#1a1a1a' : 'none',
            'stroke-width': highlight ? 2.5 : 0,
          }));
          break;
        case 3: default: {
          const s = 7 + glow;
          add(svgEl('polygon', {
            points: `${x},${y - s} ${x + s},${y} ${x},${y + s} ${x - s},${y}`,
            fill: colour,
            stroke: highlight ? '#1a1a1a' : 'none',
            'stroke-width': highlight ? 2.5 : 0,
          }));
          break;
        }
        case 4: case 5: {
          const s = 6 + glow;
          add(svgEl('polygon', {
            points: `${x},${y - s} ${x + s * 0.87},${y + s * 0.5} ${x - s * 0.87},${y + s * 0.5}`,
            fill: colour,
            stroke: highlight ? '#1a1a1a' : 'none',
            'stroke-width': highlight ? 2.5 : 0,
          }));
          break;
        }
      }
    }

    // ── Root constants panel with collapsible toggle ─────────────────
    function drawRootPanel(node: TreeNode) {
      const ALWAYS_SHOW = 3;
      const LINE_H      = 15;
      const panelX      = node.x! - 14;
      const TRUNC       = 32;

      displayConstants.forEach((c, i) => {
        if (i >= ALWAYS_SHOW) return;
        const lineY    = node.y! + i * LINE_H;
        const valTxt   = c.val.length > TRUNC ? c.val.slice(0, TRUNC - 1) + '…' : c.val;
        const isPrimary = i === 0;
        labelG.appendChild(svgEl('text', {
          x: panelX, y: lineY + 4, 'text-anchor': 'end',
          fill:        isPrimary ? '#2a2016' : '#7a6e5e',
          'font-size': isPrimary ? 12 : 10,
          'font-weight': isPrimary ? 700 : 400,
          'font-family': isPrimary ? 'Syne, sans-serif' : 'DM Mono, monospace',
        }, `${c.header}  ·  ${valTxt}`));
      });

      const extraConsts = displayConstants.slice(ALWAYS_SHOW);
      const extraG = svgEl('g', { opacity: '0' });
      (extraG as SVGGElement).style.pointerEvents = 'none';

      extraConsts.forEach((c, i) => {
        const lineY  = node.y! + (ALWAYS_SHOW + 1 + i) * LINE_H;
        const valTxt = c.val.length > TRUNC ? c.val.slice(0, TRUNC - 1) + '…' : c.val;
        extraG.appendChild(svgEl('text', {
          x: panelX, y: lineY + 4, 'text-anchor': 'end',
          fill: '#7a6e5e', 'font-size': m.fLeaf,
          'font-family': 'DM Mono, monospace',
        }, `${c.header}  ·  ${valTxt}`));
      });

      if (extraConsts.length > 0) {
        const toggleY = node.y! + ALWAYS_SHOW * LINE_H;
        const toggleG = svgEl('g', { cursor: 'pointer' });

        const arrow = svgEl('text', {
          x: panelX, y: toggleY + 4, 'text-anchor': 'end',
          fill: '#b0a088', 'font-size': m.fLeaf,
          'font-family': 'DM Mono, monospace',
        }, `▶  ${extraConsts.length} more`);

        toggleG.appendChild(arrow);
        labelG.appendChild(toggleG);
        labelG.appendChild(extraG);

        let expanded = false;
        toggleG.addEventListener('click', () => {
          expanded = !expanded;
          if (expanded) {
            extraG.setAttribute('opacity', '1');
            (extraG as SVGGElement).style.pointerEvents = 'auto';
            arrow.textContent = '▼  less';
          } else {
            extraG.setAttribute('opacity', '0');
            (extraG as SVGGElement).style.pointerEvents = 'none';
            arrow.textContent = `▶  ${extraConsts.length} more`;
          }
        });
      }
    }

    // ── Path key from ancestors (matches chart lookup) ─────────────────
    function pathKeyFromAncestors(pathFromRoot: string[]): string {
      return pathFromRoot.filter(Boolean).join('|');
    }

    function stableLeafColour(node: TreeNode, cell: CellLike | null): string {
      const fromMap =
        (cell?.cellName && cellColorMap?.get(cell.cellName))
        ?? (node.rawVal ? cellColorMap?.get(node.rawVal) : undefined);
      if (fromMap) return fromMap;
      if (cell) return cellIdentityColor(cell);
      const identity = (node.rawVal ?? '').trim();
      return cellIdentityColor({ cellName: identity || 'cell' });
    }

    // ── Resolve leaf node to cell (for tag/note indicators) ────────────
    type CellLike = { idNo: number; cellId?: string; cellName?: string; cathode?: string; separatorType?: string; spacerMm?: number | null };
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
    function resolveByIdNo(idNo: number | null): CellLike | null {
      if (idNo == null) return null;
      return cells.find((c: CellLike) => c.idNo === idNo) ?? null;
    }
    function resolveCell(node: TreeNode): CellLike | null {
      if (!cells?.length) return null;

      // Strongest signals first: explicit node cell id / raw leaf value.
      // If a leaf clearly carries a numeric id token, use ONLY that id.
      // This avoids accidental fuzzy matches (e.g. node 53 resolved to id 2).
      const nodeCellIdNo = extractIdNoFromText(String(node.cellId ?? ''));
      const raw = String(node.rawVal ?? '').trim();
      const rawIdNo = extractIdNoFromText(raw);
      const explicitLeafIdNo = nodeCellIdNo ?? rawIdNo;
      if (node.isLeaf && explicitLeafIdNo != null) {
        return resolveByIdNo(explicitLeafIdNo);
      }

      let match = cells.find((c: CellLike) => (c.cellName || `Cell ${c.idNo}`).trim() === raw);
      if (!match) match = resolveByIdNo(rawIdNo);
      if (match) return match;

      if (node.rowData && node.rowData.length >= 4) {
        const rowTokens = new Set(
          node.rowData
            .map((v) => String(v ?? '').trim())
            .filter(Boolean),
        );
        const tokenMatch = cells.find((c: CellLike) => {
          const cellFallback = `Cell ${c.idNo}`;
          return (
            rowTokens.has(c.cellId ?? '') ||
            rowTokens.has((c.cellName || '').trim()) ||
            rowTokens.has(cellFallback)
          );
        });
        if (tokenMatch) return tokenMatch;
        const match = cells.find((c: CellLike) => {
          const expected = [
            c.cathode || '',
            c.separatorType || '',
            String(c.spacerMm ?? ''),
            c.cellName || `Cell ${c.idNo}`,
          ];
          return expected.every((v, j) => String(v).trim() === String(node.rowData?.[j] ?? '').trim());
        });
        if (match) return match;
        const cellVal = String(node.rowData[node.rowData.length - 1] ?? '').trim();
        if (cellVal) {
          const byLastCol = cells.find((c: CellLike) => (c.cellName || `Cell ${c.idNo}`).trim() === cellVal);
          if (byLastCol) return byLastCol;
        }
        const rowIdNo = node.rowData
          .map((v) => extractIdNoFromText(String(v ?? '')))
          .find((v): v is number => v != null);
        if (rowIdNo != null) {
          const byRowId = cells.find((c: CellLike) => c.idNo === rowIdNo);
          if (byRowId) return byRowId;
        }
      }
      if (node.cellId) {
        const byCellId = cells.find((c: CellLike) => c.cellId === node.cellId || c.cellName === node.cellId);
        if (byCellId) return byCellId;
      }
      if (!match && raw) {
        const idMatch = raw.match(/^Cell\s*(\d+)$/i) ?? raw.match(/^(\d+)$/);
        if (idMatch) {
          const idNo = parseInt(idMatch[1], 10);
          match = cells.find((c: CellLike) => c.idNo === idNo) ?? null;
        }
      }
      return match ?? null;
    }

    // ── Recursive DFS draw ───────────────────────────────────────────
    const selIds = selectedCellIds ?? [];
    const hasMultiselect = selIds.length > 0;
    const protoFiltered = protocolFilteredOutCellIds ?? new Set<number>();
    const PROTOCOL_FILTERED_OPACITY = 0.42;
    const preLeafToggleHitAreas: Array<{
      nodeKey: string;
      x: number;
      y: number;
      width: number;
      height: number;
    }> = [];
    function draw(
      node: TreeNode,
      l1Colour: string | null,
      parentInStream: boolean,
      pathFromRoot: string[] = [],
      keyPathFromRoot: string[] = [],
    ) {
      const path = node.depth > 0 ? [...pathFromRoot, node.rawVal] : pathFromRoot;
      const pathKey = pathKeyFromAncestors(path);
      const nodeSeg = `${node.colHeader ?? 'root'}=${node.rawVal ?? node.label ?? ''}`;
      const nodePathSegments = [...keyPathFromRoot, nodeSeg];
      const nodeKey = treeNodeStableKey(nodePathSegments);
      const isPreLeafNode = !node.isLeaf && node.children.length > 0 && node.children.every((c) => c.isLeaf);
      const isCollapsedPreLeaf = isPreLeafNode && (collapsedPreLeafNodeKeys?.has(nodeKey) ?? false);
      const preLeafCount = isPreLeafNode ? node.children.length : 0;
      let inStream = isInStream(node, parentInStream);
      if (!inStream && hasMultiselect && node.isLeaf) {
        const c = resolveCell(node);
        if (c && selIds.includes(c.idNo)) inStream = true;
      }
      const isUnselectedInMultiselect = hasMultiselect && node.isLeaf && !inStream;
      const c = node.isLeaf ? resolveCell(node) : null;
      const isProtocolFilteredOut = protoFiltered.size > 0 && node.isLeaf && c != null && protoFiltered.has(c.idNo);
      let colour = '#2a2016';
      if (node.isLeaf) {
        colour = isProtocolFilteredOut
          ? '#9ca3af'
          : isUnselectedInMultiselect
          ? '#4b5563'
          : node.isNonStd
            ? NONSTD_COLOUR
            : node.isTBC
              ? TBC_COLOUR
              : stableLeafColour(node, c);
      } else if (node.depth > 0) {
        colour = pathToColorMap?.get(pathKey)
          ?? (cellColorMap ? (() => {
            const firstCell = getFirstLeafCellName(node);
            return firstCell && cellColorMap.has(firstCell) ? cellColorMap.get(firstCell)! : undefined;
          })() : undefined)
          ?? (colourMaps[node.depth - 1] ?? {})[node.rawVal] ?? '#888';
      }

      // Draw edges before node so node shape paints over edge
      if (!node.isLeaf && !isCollapsedPreLeaf) {
        const edgeColour = node.depth === 0 ? '#c8bfaf' : (l1Colour ?? colour);
        const edgeOp     = node.depth === 0 ? 0.6 : 0.3;
        const edgeSW     = node.depth <= 1  ? 1.6 : 1.2;
        node.children.forEach(child => {
          const childInStream = isInStream(child, inStream);
          const px = nodeRightEdge(node.depth, node.x!, node.isLeaf);
          const cx = nodeLeftEdge(child.depth, child.x!, child.isLeaf);
          drawLink(px, node.y!, cx, child.y!, edgeColour, edgeOp, edgeSW, inStream && childInStream);
        });
      }

      const shapeHighlight = hasSelectedPath
        ? inStream
        : (inStream || !hasMultiselect);
      drawShape(node.depth, node.x!, node.y!, colour, node.isLeaf, node.isNonStd, node.isTBC, shapeHighlight, isProtocolFilteredOut ? PROTOCOL_FILTERED_OPACITY : undefined);

      if (onNodeClickRef.current && node.depth >= 0) {
        const clickNode = nodeByStableKey.get(nodeKey) ?? node;
        // Leaf: wide hit area to cover label + tag; branch: medium area for easy clicking.
        const w = node.isLeaf
          ? 120
          : (node.depth === 0 ? 28 : Math.max(28, Math.min(60, m.COL_SP * 0.42)));
        const h = node.isLeaf ? 12 : 12;
        const onLeafCellClick =
          node.isLeaf && onCellSelectRef.current && cells?.length
            ? (n: TreeNode, ev: MouseEvent) => {
                const c = resolveCell(n);
                if (c) onCellSelectRef.current?.(c.idNo, ev);
              }
            : undefined;
        addClickableHitArea(node, clickNode, node.x!, node.y!, w, h, onLeafCellClick);
      }

      // Labels
      if (node.depth === 0) {
        drawRootPanel(node);
      } else if (!node.isLeaf) {
        const xOff = node.depth === 1 ? node.x! + 14 : node.x! + 10;
        const maxLabelW = Math.max(24, m.COL_SP - 32); // Keep room for collapse arrow + xN badge.
        const labelEl = appendLabelWithBg(labelG, xOff, node.y! + 4, node.label, {
          fill: colour, 'font-size': m.fBranch, 'font-weight': 600,
          'font-family': 'Syne, sans-serif',
        }, 3, undefined, undefined, { maxWidthPx: maxLabelW });
        if (onNodeClickRef.current) {
          const clickNode = nodeByStableKey.get(nodeKey) ?? node;
          const labelGroup = labelEl.parentNode as SVGGElement | null;
          if (labelGroup) {
            labelGroup.style.cursor = 'pointer';
            labelGroup.addEventListener('click', (e) => {
              e.stopPropagation();
              onNodeClickRef.current?.(clickNode);
            });
          }
        }
        const labelBBox = labelEl.getBBox();

        if (isPreLeafNode) {
          const arrowText = isCollapsedPreLeaf ? '▶' : '▼';
          const countLabel = `x${preLeafCount}`;
          const childEdges = node.children
            .map((child) => nodeLeftEdge(child.depth, child.x!, child.isLeaf))
            .filter((v) => Number.isFinite(v));
          const childLeftEdge = childEdges.length ? Math.min(...childEdges) : labelBBox.x + labelBBox.width + 48;

          // Keep branch label from entering arrow/count zone.
          const countApproxW = Math.max(16, countLabel.length * 7);
          const controlsReserve = 6 + 14 + countApproxW + 8;
          const maxLabelRight = childLeftEdge - controlsReserve;
          if (labelBBox.x + labelBBox.width > maxLabelRight) {
            const allowedLabelW = Math.max(18, maxLabelRight - labelBBox.x);
            truncateLabelToWidth(labelEl, node.label, allowedLabelW);
          }
          const fittedLabelBBox = labelEl.getBBox();
          const arrowX = fittedLabelBBox.x + fittedLabelBBox.width + 6;
          const countX = arrowX + 14;

          const arrowEl = appendLabelWithBg(labelG, arrowX, node.y! + 4, arrowText, {
            fill: '#5f5342',
            'font-size': m.fLeaf,
            'font-family': 'DM Mono, monospace',
            'font-weight': 700,
          });
          const countEl = appendLabelWithBg(labelG, countX, node.y! + 4, countLabel, {
            fill: '#2f6f3e',
            'font-size': m.fLeaf,
            'font-family': 'DM Mono, monospace',
            'font-weight': 700,
          });
          const rawArrowBox = arrowEl.getBBox();
          const rawCountBox = countEl.getBBox();
          const maxControlsRight = childLeftEdge - 2;
          const controlsRight = Math.max(
            rawArrowBox.x + rawArrowBox.width,
            rawCountBox.x + rawCountBox.width,
          );
          const overlap = Math.max(0, controlsRight - maxControlsRight);
          if (overlap > 0) {
            const arrowGroup = arrowEl.parentNode as SVGGElement | null;
            const countGroup = countEl.parentNode as SVGGElement | null;
            if (arrowGroup) arrowGroup.setAttribute('transform', `translate(${-overlap},0)`);
            if (countGroup) countGroup.setAttribute('transform', `translate(${-overlap},0)`);
          }

          if (onTogglePreLeafNode) {
            const arrowBox = {
              ...rawArrowBox,
              x: rawArrowBox.x - overlap,
            };
            const countBox = {
              ...rawCountBox,
              x: rawCountBox.x - overlap,
            };
            const rawLeft = Math.min(arrowBox.x, countBox.x) - 2;
            const rawRight = Math.max(
              arrowBox.x + arrowBox.width,
              countBox.x + countBox.width,
            ) + 2;
            const rawTop = Math.min(arrowBox.y, countBox.y) - 2;
            const rawBottom = Math.max(
              arrowBox.y + arrowBox.height,
              countBox.y + countBox.height,
            ) + 2;
            const safeRight = finiteOr(Math.min(rawRight, childLeftEdge - 4), rawRight + 12);
            const safeWidth = finiteOr(Math.max(12, safeRight - rawLeft), 12);
            const safeX = finiteOr(rawLeft, finiteOr(node.x, 0));
            const safeY = finiteOr(rawTop, finiteOr(node.y, 0) - 8);
            const safeHeight = finiteOr(Math.max(12, rawBottom - rawTop), 16);
            preLeafToggleHitAreas.push({
              nodeKey,
              x: safeX,
              y: safeY,
              width: safeWidth,
              height: safeHeight,
            });
          }
        }
      } else {
        const isUnselectedLeaf = hasMultiselect && !inStream;
        const textColour = isProtocolFilteredOut
          ? '#9ca3af'
          : isUnselectedLeaf
          ? '#4b5563'
          : node.isNonStd
            ? NONSTD_COLOUR
            : node.isTBC ? TBC_COLOUR : '#3a3020';

        const leafLabel = compact ? truncateLabel(node.label, 24) : node.label;
        appendLabelWithBg(labelG, node.x! + 9, node.y! + 4, leafLabel, {
          fill: textColour, 'font-size': m.fLeaf,
          'font-family': 'DM Mono, monospace',
          ...(node.isNonStd || node.isTBC ? { 'font-style': 'italic' } : {}),
        }, 3, isProtocolFilteredOut ? PROTOCOL_FILTERED_OPACITY : undefined, compact ? undefined : {
          maxWidthPx: Math.max(140, m.COL_SP * 1.7),
          charW: m.charW,
          lineHeight: m.fLeaf + 2,
        });

        // Tag/note indicator for annotated cells (clickable to open cell details)
        if (cells?.length && annotationsByCell) {
          const cell = resolveCell(node);
          if (cell) {
            const ann = annotationsByCell[cell.idNo];
            const hasNote = ann?.note != null && String(ann.note).trim() !== '';
            const hasTags = (ann?.tags?.length ?? 0) > 0;
            if (hasNote || hasTags) {
              const indicatorX = node.x! + 10 + node.label.length * m.charW;
              const indicatorY = node.y! + 4;
              const tagG = svgEl('g') as SVGGElement;
              tagG.style.cursor = onCellSelectRef.current ? 'pointer' : 'default';
              const t = svgEl('text', {
                x: indicatorX,
                y: indicatorY,
                fill: '#8a8070',
                'font-size': m.fLeaf,
                'font-family': 'sans-serif',
              }, hasTags ? '🏷' : '📝');
              tagG.appendChild(t);
              labelG.appendChild(tagG as unknown as Node);
              // Put hit area in clickG so it's in the interactive layer (same as node clicks)
              if (onCellSelectRef.current) {
                const hit = svgEl('rect', {
                  x: indicatorX - 12,
                  y: indicatorY - 14,
                  width: 24,
                  height: 20,
                  fill: 'transparent',
                });
                hit.style.cursor = 'pointer';
                hit.addEventListener('click', (e: Event) => {
                  e.stopPropagation();
                  e.preventDefault();
                  onCellSelectRef.current?.(cell.idNo, e as MouseEvent);
                });
                clickG.appendChild(hit);
              }
            }
          }
        }

        // Tooltip on the leaf shape
        const leafShape = nodeG.lastElementChild as SVGElement;
        leafShape.style.cursor = 'pointer';
        leafShape.addEventListener('mouseenter', () => {
          // tooltip data update handled by React state
        });
        leafShape.addEventListener('mousemove', (e: Event) => {
          const me = e as MouseEvent;
          setTooltip({
            visible: true,
            x: me.clientX + 14,
            y: Math.max(8, me.clientY - 10),
            data: {
              label:    node.label,
              hierVals: node.hierVals ?? [],
              cellId:   node.cellId,
              isNonStd: node.isNonStd,
              isTBC:    node.isTBC,
            },
          });
        });
        leafShape.addEventListener('mouseleave', () => {
          setTooltip(prev => ({ ...prev, visible: false }));
        });
      }

      // Recurse
      if (!node.isLeaf && !isCollapsedPreLeaf) {
        const nextL1 = node.depth === 1 ? colour : l1Colour;
        node.children.forEach(c => draw(c, nextL1, inStream, path, nodePathSegments));
        // Add branch icon + label hit areas AFTER children so they're on top – clicking node or "sp1.0mm" filters to all cells under that node
        if (onNodeClickRef.current && node.depth > 0) {
          const clickNode = nodeByStableKey.get(nodeKey) ?? node;
          const iconSize = node.depth === 1 ? 24 : 20; // circle r=10 → 24; rect/polygon ~12–14 → 20
          const iconRect = svgEl('rect', {
            x: node.x! - iconSize / 2,
            y: node.y! - iconSize / 2,
            width: iconSize,
            height: iconSize,
            fill: 'transparent',
          });
          iconRect.style.cursor = 'pointer';
          iconRect.addEventListener('click', (e) => {
            e.stopPropagation();
            onNodeClickRef.current?.(clickNode);
          });
          clickG.appendChild(iconRect);

          // Avoid wide label hitboxes covering leaf nodes/arrow controls.
        }
      }
    }

    draw(tree, null, false);

    // Add pre-leaf collapse/expand hit areas last so they stay on top.
    if (onTogglePreLeafNode) {
      preLeafToggleHitAreas.forEach((hit) => {
        const rect = svgEl('rect', {
          x: hit.x,
          y: hit.y,
          width: hit.width,
          height: hit.height,
          fill: 'transparent',
        });
        rect.style.cursor = 'pointer';
        rect.addEventListener('click', (e) => {
          e.stopPropagation();
          e.preventDefault();
          onTogglePreLeafNode(hit.nodeKey);
        });
        clickG.appendChild(rect);
      });
    }
  }, [analysis, rows, onNodeClick, compact, treeProp, colourMapsProp, selectedPath, usePerceptualColors, cellColorMap, pathToColorMap, cells, annotationsByCell, selectedCellIds, protocolFilteredOutCellIds, collapsedPreLeafNodeKeys, onTogglePreLeafNode, layout]);

  const padding = compact ? '12px 8px 20px' : '24px 16px 60px';
  const frame = layout.frame;
  const fitVerticalPriority = compact && !fitContent && frame.stretchToFrame;
  const scrollOverflow = compact && !fitContent ? 'overflow-auto' : 'overflow-visible';

  return (
    <div
      className={`relative flex flex-col ${scrollOverflow} ${compact ? 'bg-card rounded-md border border-border' : ''}`}
      style={{ minHeight: fitContent ? undefined : (compact ? 200 : '100%'), padding }}
    >
      {/* Dot-grid background - subtle when compact */}
      {!compact && (
        <div
          className="pointer-events-none absolute inset-0 z-0"
          style={{
            backgroundImage: 'radial-gradient(circle, hsl(var(--border)) 1px, transparent 1px)',
            backgroundSize: '24px 24px',
            opacity: 0.4,
          }}
        />
      )}

      <div
        className="inline-block"
        style={{
          minWidth: compact ? 0 : 'max-content',
          width: compact
            ? (fitVerticalPriority
              ? `${Math.max(1, frame.verticalFitWidthPx)}px`
              : '100%')
            : undefined,
          height: compact
            ? (fitVerticalPriority
              ? (frame.readableGuardActive ? `${Math.max(1, frame.verticalFitHeightPx)}px` : '100%')
              : '100%')
            : undefined,
          position: 'relative',
          zIndex: 1,
        }}
      >
        <svg ref={svgRef} xmlns="http://www.w3.org/2000/svg" />
      </div>

      {/* Tooltip */}
      {tooltip.visible && tooltip.data && (
        <div
          className="fixed pointer-events-none z-[999] rounded-md border shadow-lg"
          style={{
            left: tooltip.x,
            top: tooltip.y,
            background: 'hsl(var(--card))',
            borderColor: 'hsl(var(--border))',
            padding: '10px 13px',
            minWidth: 200,
            maxWidth: 320,
            fontSize: 10,
            lineHeight: 1.9,
            color: 'hsl(var(--foreground))',
          }}
        >
          <div style={{ fontSize: 12.5, fontWeight: 500, marginBottom: 6 }}>
            {tooltip.data.label}
          </div>
          {tooltip.data.hierVals.map((hv, i) => (
            <div key={i}>
              <span className="text-muted-foreground">{hv.name}:</span>{' '}
              <span>{hv.disp || hv.val || '—'}</span>
            </div>
          ))}
          {tooltip.data.cellId && (
            <>
              <div className="border-t border-border my-2" />
              <div>
                <span className="text-muted-foreground">Cell ID:</span>{' '}
                <span className="text-[8.5px]">{tooltip.data.cellId}</span>
              </div>
            </>
          )}
          {tooltip.data.isNonStd && (
            <div className="text-amber-600 dark:text-amber-500 text-[9px] mt-1">
              ⚑ Extra / non-standard repeat
            </div>
          )}
          {tooltip.data.isTBC && (
            <div className="text-amber-600 dark:text-amber-500 text-[9px] mt-1">
              ⚑ ID not yet assigned (TBC)
            </div>
          )}
        </div>
      )}
    </div>
  );
}
