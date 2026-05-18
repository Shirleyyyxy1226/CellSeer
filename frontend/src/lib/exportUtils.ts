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
 * Bundle a PNG data URL, a Plotly JSON string, and a CSV string into a ZIP and download it.
 * Uses fflate for client-side ZIP creation (no server round-trip).
 */
export async function exportZip(
  pngDataUrl: string,
  jsonStr: string,
  csvStr: string,
  basename: string,
): Promise<void> {
  const { zip } = await import('fflate');
  const b64 = pngDataUrl.split(',')[1];
  const pngBytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
  const enc = new TextEncoder();
  zip(
    {
      [`${basename}.png`]: [pngBytes, { level: 0 }],
      [`${basename}_plotly.json`]: [enc.encode(jsonStr), { level: 6 }],
      [`${basename}_data.csv`]: [enc.encode(csvStr), { level: 6 }],
    },
    (err, data) => {
      if (err) throw err;
      downloadBlob(new Blob([data], { type: 'application/zip' }), `${basename}.zip`);
    },
  );
}
