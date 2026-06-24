#!/usr/bin/env python3
"""Generate docs/reference.html — the complete CellSeer API reference.

The Python section is introspected live from the installed `cellseer` package
(signatures + docstrings), so it cannot drift from the code. Re-run after any
public-API change:

    python scripts/build_api_reference.py
"""
from __future__ import annotations

import html
import inspect
import pathlib

import cellseer

ROOT = pathlib.Path(__file__).resolve().parent.parent
OUT = ROOT / "docs" / "reference.html"

NAV = """<header class="topbar">
  <a class="logo" href="index.html"><span class="mark">&#11041;</span> CellSeer</a>
  <nav>
    <a href="first_steps.html">First steps</a>
    <a href="user_guide.html">User guide</a>
    <a href="gallery.html">Gallery</a>
    <a href="reference.html" class="active">Reference</a>
    <a href="developer.html">Developer guide</a>
  </nav>
  <span class="spacer"></span>
</header>"""

# Page-specific extras on top of the shared docs.css.
STYLE = """
  .sym { border:1px solid var(--line); border-radius:10px; margin:14px 0; overflow:hidden; }
  .sym > .sig { background:var(--code-bg); color:var(--code-ink); padding:10px 14px;
                font:12.5px/1.55 ui-monospace,SFMono-Regular,Menlo,monospace; overflow-x:auto; white-space:pre; }
  .sym > .sig .kind { color:var(--code-blue); }
  .sym > .doc { padding:10px 14px; font-size:14px; }
  .sym > .doc pre { background:var(--panel); border:1px solid var(--line); color:var(--ink); border-radius:8px;
                    padding:8px 10px; font-size:12.5px; overflow-x:auto; }
  .symlist { font-size:14px; line-height:2; }
"""


def fmt_doc(doc: str | None) -> str:
    if not doc:
        return "<p><em>No docstring.</em></p>"
    doc = inspect.cleandoc(doc)
    blocks: list[str] = []
    para: list[str] = []
    in_code = False
    code: list[str] = []
    for line in doc.splitlines():
        is_code = line.startswith("    ") or line.startswith(">>>")
        if is_code:
            if para:
                blocks.append("<p>" + html.escape(" ".join(para)) + "</p>")
                para = []
            in_code = True
            code.append(line)
        elif not line.strip():
            if in_code and code:
                blocks.append("<pre>" + html.escape("\n".join(code)) + "</pre>")
                code, in_code = [], False
            if para:
                blocks.append("<p>" + html.escape(" ".join(para)) + "</p>")
                para = []
        else:
            if in_code and code:
                blocks.append("<pre>" + html.escape("\n".join(code)) + "</pre>")
                code, in_code = [], False
            para.append(line.strip())
    if code:
        blocks.append("<pre>" + html.escape("\n".join(code)) + "</pre>")
    if para:
        blocks.append("<p>" + html.escape(" ".join(para)) + "</p>")
    return "\n".join(blocks)


def python_section() -> str:
    out = []
    for name in cellseer.__all__:
        obj = getattr(cellseer, name)
        kind = "class" if inspect.isclass(obj) else "def"
        try:
            sig = str(inspect.signature(obj))
        except (TypeError, ValueError):
            sig = "(…)"
        out.append(
            f'<div class="sym" id="py-{name}">'
            f'<div class="sig"><span class="kind">{kind}</span> cellseer.{html.escape(name)}{html.escape(sig)}</div>'
            f'<div class="doc">{fmt_doc(inspect.getdoc(obj))}</div></div>'
        )
    return "\n".join(out)


TS_EXPORTS = [
    ("buildGcdFigure(datasets, opts)", "GCD scatter/line figure; per-cycle traces with charge/discharge split, cycle filter, downsampling cap."),
    ("buildGcdCumulativeFigure(datasets, opts)", "All-cycles cumulative-capacity view with cycle highlighting."),
    ("buildDqDvFigure(datasets, opts)", "Incremental capacity (dQ/dV) — 3D surface or 2D peak-overlay modes."),
    ("buildDvDqFigure(datasets, opts)", "Differential voltage (dV/dQ) — 3D surface or 2D peak-overlay modes."),
    ("buildVoltageTimeFigure(datasets, opts)", "Voltage vs time for the first cycles (formation checks)."),
    ("buildRatePerformanceFigure(traceSpecs, opts)", "Capacity vs cycle with protocol-segment shading and C-rate annotations."),
    ("normalizeCyclerDatasets(input)", "Adapter: coerce external cell-record-like objects into RecordDataset[]."),
]

REST_ROWS = [
    ("Cycling data", "GET /api/rate-performance", "Per-cell per-cycle capacity summary + protocols (cached, gzip)"),
    ("Cycling data", "GET /api/cell-record-index", "Cell metadata index for the active project"),
    ("Cycling data", "GET /api/cell-record/{cellId}?maxPointsPerCycle=", "Full cycling curves; optional stride-downsampling"),
    ("Cycling data", "GET /api/cell-record/{cellId}/differential?direction=", "Pre-computed dQ/dV + dV/dQ per cycle"),
    ("Cycling data", "GET /api/cell-record/{cellId}/cycle-summary", "Sparse per-cycle metrics"),
    ("Cycling data", "GET /api/differential-cells", "Cells that have both dQ/dV and dV/dQ datasets"),
    ("Analysis", "GET /api/hierarchy · POST /api/hierarchy/analyse", "Hierarchy tree + factor analysis"),
    ("Annotations", "GET/PUT /api/cell-annotation/{cellId} · GET /api/cell-annotations", "Notes and tags per cell"),
    ("Metadata", "PATCH /api/cells/{cellId}", "Edit cell metadata (allow-listed fields)"),
    ("Protocols", "GET/POST /api/protocol-templates · PUT /api/cells/{cellId}/protocol · POST /api/cells/protocol/bulk", "Protocol authoring and attachment"),
    ("Projects", "GET/POST/PATCH/DELETE /api/projects[/{id}] · GET …/readiness", "Project lifecycle"),
    ("Ingest", "POST /api/upload · /api/upload/batch · GET /api/upload/status/{taskId} · /api/upload/history · /api/upload/loaders", "File ingest pipeline"),
    ("DIGIBAT", "POST /api/digibat/connect · GET /api/digibat/collections · POST /api/projects/{id}/digibat/sync · GET …/digibat/status", "Robot-lab integration with incremental file-level sync"),
    ("Misc", "GET /api/health", "Liveness check"),
]


def main() -> None:
    ts_rows = "\n".join(
        f"<tr><td><code>{html.escape(s)}</code></td><td>{html.escape(d)}</td></tr>" for s, d in TS_EXPORTS
    )
    rest_rows = "\n".join(
        f"<tr><td>{a}</td><td><code>{html.escape(e)}</code></td><td>{html.escape(d)}</td></tr>"
        for a, e, d in REST_ROWS
    )
    toc = " · ".join(f'<a href="#py-{html.escape(n)}">{html.escape(n)}</a>' for n in cellseer.__all__)
    page = f"""<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>API reference — CellSeer</title>
<link rel="stylesheet" href="assets/docs.css">
<style>{STYLE}</style>
</head>
<body>
{NAV}
<main>
<div class="content">
<h1>API reference</h1>
<p class="lede">Every public entry point, in three layers. The Python section is generated by
<code>scripts/build_api_reference.py</code> directly from the installed package — it cannot drift
from the code; re-run after changing the public API.</p>

<h2 id="python">Python — <code>cellseer</code> v{html.escape(cellseer.__version__)}</h2>
<p class="symlist">{toc}</p>
{python_section()}

<h2 id="ts">TypeScript — <code>@/cellseer-lib</code> (frontend figure builders)</h2>
<p>Framework-free Plotly trace/layout builders used by the web app; unit-tested in
<code>src/cellseer-lib/*.test.ts</code>. All accept <code>RecordDataset[]</code>
(see <code>types.ts</code>; adapt external shapes with <code>normalizeCyclerDatasets</code>).</p>
<table><tr><th>Export</th><th>Purpose</th></tr>{ts_rows}</table>

<h2 id="rest">REST API — backend endpoints</h2>
<p>All endpoints accept <code>?projectId=</code> (inferred from the URL path by the web app),
return JSON (orjson), and are gzip-compressed. Interactive docs at <code>/docs</code> (Swagger) on a
running backend.</p>
<table><tr><th>Area</th><th>Endpoint</th><th>Purpose</th></tr>{rest_rows}</table>

<div class="pager">
  <a class="prev" href="gallery.html"><div class="dir">&larr; Previous</div><div class="ttl">Gallery</div></a>
  <a class="next" href="developer.html"><div class="dir">Next &rarr;</div><div class="ttl">Developer guide</div></a>
</div>
</div>
</main>
</body>
</html>
"""
    OUT.write_text(page)
    print(f"wrote {OUT} ({len(cellseer.__all__)} Python symbols, {len(TS_EXPORTS)} TS exports, {len(REST_ROWS)} REST areas)")


if __name__ == "__main__":
    main()
