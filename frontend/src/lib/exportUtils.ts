import type Plotly from 'plotly.js-strict-dist-min';

/**
 * Convert Plotly traces to a CSV string.
 * Each trace contributes two columns ("[name] x", "[name] y"), or three for 3D traces.
 * Rows are aligned by index; missing values are left empty.
 */
export function tracesToCsv(data: Plotly.Data[]): string {
  type AnyTrace = { name?: string; x?: unknown; y?: unknown; z?: unknown };
  const traces = data as AnyTrace[];

  if (!traces.length) return '';

  const toArray = (v: unknown): (string | number)[] => {
    if (!Array.isArray(v)) return [];
    return (v as unknown[]).map((x) => (x == null ? '' : (x as string | number)));
  };

  // Build column definitions
  const cols: { header: string; values: (string | number)[] }[] = [];
  traces.forEach((t, i) => {
    const name = t.name ?? `Trace ${i + 1}`;
    const xs = toArray(t.x);
    const ys = toArray(t.y);
    const zs = toArray(t.z);
    if (xs.length || ys.length) {
      cols.push({ header: `${name} x`, values: xs });
      cols.push({ header: `${name} y`, values: ys });
    }
    if (zs.length) {
      cols.push({ header: `${name} z`, values: zs });
    }
  });

  if (!cols.length) return '';

  const nRows = Math.max(...cols.map((c) => c.values.length));
  const escape = (v: string | number): string => {
    const s = String(v);
    return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s;
  };

  const lines: string[] = [cols.map((c) => escape(c.header)).join(',')];
  for (let r = 0; r < nRows; r++) {
    lines.push(cols.map((c) => escape(c.values[r] ?? '')).join(','));
  }
  return lines.join('\n');
}

/** Trigger a browser file download for any Blob. */
export function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/**
 * Provenance attached to an export so the figure can be regenerated from the
 * original data, not just admired as pixels.
 */
export interface ExportContext {
  /** Cell IDs whose datasets feed this figure. */
  sourceCellIds?: string[];
  /** Absolute API URLs returning the ORIGINAL full-resolution source data. */
  sourceEndpoints?: string[];
  /** View settings that shaped the figure (direction, cycle filter, downsampling…). */
  settings?: Record<string, unknown>;
}

function buildManifest(basename: string, context?: ExportContext): string {
  return JSON.stringify(
    {
      app: 'CellSeer',
      exportedAt: new Date().toISOString(),
      page: typeof window !== 'undefined' ? window.location.href : null,
      figure: basename,
      files: {
        image: `${basename}.png`,
        plotlySpec: `${basename}_plotly.json`,
        traceData: `${basename}_data.csv`,
        reproduction: 'reproduce.py',
      },
      note:
        'The plotly JSON contains the exact data drawn (display traces may be ' +
        'stride-downsampled). sourceEndpoints return the original full-resolution ' +
        'datasets from the CellSeer backend.',
      sourceCellIds: context?.sourceCellIds ?? [],
      sourceEndpoints: context?.sourceEndpoints ?? [],
      settings: context?.settings ?? {},
    },
    null,
    2,
  );
}

function buildReproduceScript(basename: string): string {
  return `#!/usr/bin/env python3
"""Reproduce the exported CellSeer figure "${basename}".

  pip install plotly            # required
  pip install kaleido           # optional, for PNG output
  python reproduce.py                   # re-render from the bundled figure spec
  python reproduce.py --fetch-original  # also pull full-resolution source data
                                        # (CellSeer backend must be reachable)
"""
import json
import pathlib
import sys

BASE = pathlib.Path(__file__).parent
NAME = ${JSON.stringify(basename)}

spec = json.loads((BASE / f"{NAME}_plotly.json").read_text())

import plotly.graph_objects as go  # noqa: E402

fig = go.Figure(data=spec["data"], layout=spec.get("layout", {}))
out_html = BASE / f"{NAME}_reproduced.html"
fig.write_html(out_html)
print("wrote", out_html)
try:
    out_png = BASE / f"{NAME}_reproduced.png"
    fig.write_image(out_png, scale=2)
    print("wrote", out_png)
except Exception as exc:  # kaleido not installed, etc.
    print("PNG skipped:", exc)

if "--fetch-original" in sys.argv:
    import urllib.parse
    import urllib.request

    manifest = json.loads((BASE / "manifest.json").read_text())
    endpoints = manifest.get("sourceEndpoints", [])
    if not endpoints:
        print("manifest lists no source endpoints")
    for url in endpoints:
        stem = urllib.parse.quote(url.split("/api/")[-1], safe="")
        target = BASE / f"original_{stem}.json"
        print("fetching", url)
        try:
            urllib.request.urlretrieve(url, target)
            print("wrote", target)
        except Exception as exc:
            print("failed:", exc)
`;
}

/**
 * Bundle a PNG data URL, a Plotly JSON string, a CSV string — plus a provenance
 * manifest and a `reproduce.py` script — into a ZIP and download it.
 * Uses fflate for client-side ZIP creation (no server round-trip).
 */
export async function exportZip(
  pngDataUrl: string,
  jsonStr: string,
  csvStr: string,
  basename: string,
  context?: ExportContext,
): Promise<void> {
  const { zip } = await import('fflate');
  const b64 = pngDataUrl.split(',')[1];
  const pngBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const enc = new TextEncoder();
  await new Promise<void>((resolve, reject) => {
    zip(
      {
        [`${basename}.png`]: [pngBytes, { level: 0 }],
        [`${basename}_plotly.json`]: [enc.encode(jsonStr), { level: 6 }],
        [`${basename}_data.csv`]: [enc.encode(csvStr), { level: 6 }],
        ['manifest.json']: [enc.encode(buildManifest(basename, context)), { level: 6 }],
        ['reproduce.py']: [enc.encode(buildReproduceScript(basename)), { level: 6 }],
      },
      (err, data) => {
        if (err) { reject(err); return; }
        downloadBlob(new Blob([data], { type: 'application/zip' }), `${basename}.zip`);
        resolve();
      },
    );
  });
}
