from __future__ import annotations

from typing import Any, Literal

import plotly.graph_objects as go

from ..compute import compute_dqdv_dvdq_per_cycle
from ..io import CellData, CyclerName, load_many
from ..style import (
    base_layout,
    build_shared_grid,
    cell_color,
    cell_cycle_color,
    cycle_fade_color,
    hex_to_rgba,
    interpolate_onto_grid,
)


Direction = Literal["discharge", "charge"]


def _dvdq_points(cell: CellData, cycles: list[int] | None, direction: Direction) -> list[tuple[int, list[float], list[float]]]:
    computed = compute_dqdv_dvdq_per_cycle(cell.curves, direction=direction)
    out: list[tuple[int, list[float], list[float]]] = []
    allowed = set(cycles) if cycles else None
    for cycle, payload in sorted(computed.items()):
        if allowed is not None and cycle not in allowed:
            continue
        dvdq_slot = payload.get("dvdq") or {}
        q = list(dvdq_slot.get("q", []))
        dvdq = list(dvdq_slot.get("dvdq", []))
        if len(q) >= 2 and len(dvdq) >= 2:
            out.append((cycle, q, dvdq))
    return out


def _build_traces_3d(cells: list[CellData], per_cell: list[list[tuple[int, list[float], list[float]]]]) -> list[go.Scatter3d]:
    traces: list[go.Scatter3d] = []
    for i, (cell, rows) in enumerate(zip(cells, per_cell)):
        base = cell.color or cell_color(cell.cell_id or cell.label or f"dataset-{i+1}", i)
        total = len(rows)
        for j, (cycle, q, dvdq) in enumerate(rows):
            traces.append(
                go.Scatter3d(
                    x=q,
                    y=[cycle] * len(q),
                    z=dvdq,
                    mode="lines",
                    name=f"{cell.label} - Cycle {cycle}",
                    legendgroup=cell.cell_id or cell.label or f"group-{i}",
                    showlegend=j == total - 1,
                    line={"color": cycle_fade_color(base, 1 if total <= 1 else j / (total - 1)), "width": 3},
                    hovertemplate=f"{cell.label}<br>Capacity: %{{x:.2f}} Ah<br>Cycle: %{{y}}<br>dV/dQ: %{{z:.2f}} V·h/Ah<extra></extra>",
                )
            )
    return traces


def _find_peak(values: list[float]) -> tuple[int, float]:
    idx = max(range(len(values)), key=lambda i: values[i])
    return idx, values[idx]


def _build_traces_2d(cells: list[CellData], per_cell: list[list[tuple[int, list[float], list[float]]]]) -> list[go.Scatter]:
    """Range view matching the web app's dV/dQ 2D 'range' viewMode.

    Capacity (Ah) is converted to mAh (×1000), dV/dQ (V/Ah) to V/mAh (÷1000), and
    each cycle is resampled onto a shared capacity grid (out-of-range → 0.0001).
    All cycles draw as one faint envelope; the last cycle is bold with a peak.
    """
    all_q = [q * 1000.0 for rows in per_cell for (_, qs, _) in rows for q in qs]
    q_grid = build_shared_grid(all_q, 0.0, 10.0, 0.1)

    envelopes: list[go.Scatter] = []
    lines: list[go.Scatter] = []
    peaks: list[go.Scatter] = []
    for i, (cell, rows) in enumerate(zip(cells, per_cell)):
        if not rows:
            continue
        base = cell.color or cell_color(cell.cell_id or cell.label or f"dataset-{i+1}", i)
        faint = hex_to_rgba(base, 0.25)

        x_parts: list[float | None] = []
        y_parts: list[float | None] = []
        for idx, (cyc, qs, dvdq) in enumerate(rows):
            q_mah = [q * 1000.0 for q in qs]
            y_grid = interpolate_onto_grid(q_mah, [d / 1000.0 for d in dvdq], q_grid, 0.0001)
            if idx > 0:
                x_parts.append(None)
                y_parts.append(None)
            x_parts.extend(q_grid)
            y_parts.extend(y_grid)
        if len(rows) > 1:
            envelopes.append(
                go.Scatter(
                    x=x_parts,
                    y=y_parts,
                    mode="lines",
                    name=cell.label,
                    legendgroup=cell.cell_id or cell.label or f"group-{i}",
                    line={"color": faint, "width": 1.5},
                    connectgaps=False,
                    hovertemplate=f"{cell.label}<br>Capacity: %{{x:.2f}} mAh<br>dV/dQ: %{{y:.4f}} V mAh⁻¹<extra></extra>",
                )
            )

        last_cyc, last_q, last_dvdq = rows[-1]
        last_q_mah = [q * 1000.0 for q in last_q]
        last_y = interpolate_onto_grid(last_q_mah, [d / 1000.0 for d in last_dvdq], q_grid, 0.0001)
        peak_idx, peak_val = _find_peak(last_y)
        peak_q = q_grid[peak_idx]
        lines.append(
            go.Scatter(
                x=q_grid,
                y=last_y,
                mode="lines",
                name=f"{cell.label} · Cycle {last_cyc}",
                legendgroup=cell.cell_id or cell.label or f"group-{i}",
                line={"color": base, "width": 2},
                hovertemplate=f"{cell.label}<br>Capacity: %{{x:.2f}} mAh<br>dV/dQ: %{{y:.4f}} V mAh⁻¹<extra></extra>",
            )
        )
        peaks.append(
            go.Scatter(
                x=[peak_q],
                y=[peak_val],
                mode="markers",
                name="Peak",
                legendgroup=cell.cell_id or cell.label or f"group-{i}",
                showlegend=False,
                marker={"size": 10, "color": base, "symbol": "diamond", "line": {"width": 1, "color": "#fff"}},
                hovertemplate=f"{cell.label} peak<br>Capacity: %{{x:.2f}} mAh<br>dV/dQ: %{{y:.4f}} V mAh⁻¹<extra></extra>",
            )
        )
    return envelopes + lines + peaks


def _robust_y_top(traces: list[go.Scatter]) -> float | None:
    """Robust y-axis upper bound for dV/dQ — the 99th percentile of all finite
    values plus headroom. dV/dQ has rare physical edge spikes that, left in
    auto-range, flatten the whole curve; clipping the axis (not the data) keeps
    the signal readable while the spikes simply run off the top.
    """
    import numpy as np

    vals: list[float] = []
    for tr in traces:
        ys = getattr(tr, "y", None)
        if not ys:
            continue
        for y in ys:
            if y is not None and np.isfinite(y) and y > 0:
                vals.append(float(y))
    if len(vals) < 5:
        return None
    p99 = float(np.percentile(vals, 99))
    return p99 * 1.15 if p99 > 0 else None


def _layout_2d() -> dict[str, Any]:
    """2D layout matching the web app's dV/dQ figure (font 10, #e0e0e0 grid)."""
    font = {"family": "Inter, sans-serif", "size": 10, "color": "#3a3a3c"}
    return {
        "font": font,
        "paper_bgcolor": "white",
        "plot_bgcolor": "white",
        "xaxis": {"title": {"text": "Capacity (mAh)", "font": font}, "tickfont": font, "gridcolor": "#e0e0e0", "showgrid": True},
        "yaxis": {"title": {"text": "dV/dQ (V mAh⁻¹)", "font": font}, "tickfont": font, "gridcolor": "#e0e0e0", "showgrid": True},
        "legend": {"x": 1.02, "y": 1, "xanchor": "left", "yanchor": "top", "orientation": "v", "font": font},
        "margin": {"t": 36, "r": 8, "b": 48, "l": 40},
        "showlegend": True,
    }


def _build_traces_2d_highlight(
    cells: list[CellData],
    per_cell: list[list[tuple[int, list[float], list[float]]]],
    baseline_cycles: list[int] | None = None,
    highlight_cycle: int | None = None,
) -> list[go.Scatter]:
    """Clean 'highlight' view: one bold highlighted cycle + one or more faint
    baseline cycles + a peak diamond. Avoids the all-cycle envelope, which for
    rate-capability protocols (cycles at different absolute capacities) reads as a
    spiky mess. Units match the web app: Capacity in mAh, dV/dQ in V mAh⁻¹.

    ``baseline_cycles`` selects which cycle numbers to draw as faint references
    (light → dark with cycle order); ``None`` defaults to the second available
    cycle. ``highlight_cycle`` is the bold one; ``None`` defaults to the last.
    """
    def _prep(q: list[float], dvdq: list[float]) -> tuple[list[float], list[float]]:
        # Normalise each cycle's discharge capacity to 0–1 (Q/Q_max) so cycles
        # overlay and are cross-comparable — the standard normalised-capacity DVA
        # axis. y is pyprobe's dV/dQ, only unit-converted (V/Ah → V/mAh).
        q_min, q_max = min(q), max(q)
        span = (q_max - q_min) or 1.0
        xs = [(v - q_min) / span for v in q]
        ys = [d / 1000.0 for d in dvdq]
        return xs, ys

    baselines: list[go.Scatter] = []
    lines: list[go.Scatter] = []
    peaks: list[go.Scatter] = []
    for i, (cell, rows) in enumerate(zip(cells, per_cell)):
        if not rows:
            continue
        base = cell.color or cell_color(cell.cell_id or cell.label or f"dataset-{i+1}", i)
        by_cyc = {cyc: (q, dvdq) for cyc, q, dvdq in rows}
        available = [cyc for cyc, _, _ in rows]
        legendgroup = cell.cell_id or cell.label or f"group-{i}"

        # Resolve the bold (highlighted) cycle and the faint baseline cycles.
        hi_cyc = highlight_cycle if (highlight_cycle in by_cyc) else available[-1]
        if baseline_cycles is not None:
            base_cycs = [c for c in baseline_cycles if c in by_cyc and c != hi_cyc]
        else:
            base_cycs = [available[1]] if len(available) > 1 and available[1] != hi_cyc else []

        # Faint baselines, lightest (earliest) → darkest (latest) so a multi-cycle
        # selection reads as an ageing progression, all clearly under the bold cycle.
        n_base = len(base_cycs)
        for j, cyc in enumerate(base_cycs):
            t = 0.18 + 0.42 * (j / max(1, n_base - 1)) if n_base > 1 else 0.3
            bx, by = _prep(*by_cyc[cyc])
            baselines.append(
                go.Scatter(
                    x=bx, y=by, mode="lines",
                    name=f"{cell.label} · Cycle {cyc}",
                    legendgroup=legendgroup,
                    line={"color": cell_cycle_color(base, t), "width": 1.5},
                    hovertemplate=f"{cell.label} Cycle {cyc}<br>Capacity: %{{x:.2f}} mAh<br>dV/dQ: %{{y:.4f}} V mAh⁻¹<extra></extra>",
                )
            )

        # Bold highlighted cycle + peak diamond.
        x, y = _prep(*by_cyc[hi_cyc])
        peak_idx, peak_val = _find_peak(y)
        lines.append(
            go.Scatter(
                x=x, y=y, mode="lines",
                name=f"{cell.label} · Cycle {hi_cyc}",
                legendgroup=legendgroup,
                line={"color": base, "width": 2.2},
                hovertemplate=f"{cell.label}<br>Capacity: %{{x:.2f}} mAh<br>dV/dQ: %{{y:.4f}} V mAh⁻¹<extra></extra>",
            )
        )
        peaks.append(
            go.Scatter(
                x=[x[peak_idx]], y=[peak_val], mode="markers",
                name="Peak",
                legendgroup=legendgroup,
                showlegend=False,
                marker={"size": 10, "color": base, "symbol": "diamond", "line": {"width": 1, "color": "#fff"}},
                hovertemplate=f"{cell.label} peak<br>Capacity: %{{x:.2f}} mAh<br>dV/dQ: %{{y:.4f}} V mAh⁻¹<extra></extra>",
            )
        )
    return baselines + lines + peaks


def _scene() -> dict[str, Any]:
    return {
        "xaxis": {"title": {"text": "Capacity (Ah)"}},
        "yaxis": {"title": {"text": "Cycle"}},
        "zaxis": {"title": {"text": "dV/dQ (V·h/Ah)"}},
        "camera": {"eye": {"x": 1.25, "y": 1.25, "z": 1.25}},
    }


def dvdq_plot(
    data: Any,
    *,
    cycles: list[int] | None = None,
    mode: str = "3d",
    view: str = "range",
    baseline_cycles: list[int] | None = None,
    highlight_cycle: int | None = None,
    labels: list[str] | None = None,
    direction: Direction = "discharge",
    cycler: CyclerName = "auto",
) -> go.Figure:
    """Differential-voltage (dV/dQ vs Q) figure.

    mode="3d" (default) stacks cycles along a third axis; mode="2d" overlays
    cycles. For mode="2d", view="range" (default) draws every cycle as a faint
    envelope with the last cycle highlighted (matches the web app); view="highlight"
    draws one bold highlighted cycle + faint baseline cycle(s) + peak — cleaner for
    rate-capability cells.

    In ``view="highlight"``, ``baseline_cycles`` is a list of cycle numbers to draw
    as faint references (light → dark by cycle order; defaults to the 2nd cycle) and
    ``highlight_cycle`` is the bold one (defaults to the last). Accepts anything
    load() accepts; pass a list for multi-cell comparison.
    """
    cells = load_many(data, labels=labels, cycler=cycler)
    per_cell = [_dvdq_points(cell, cycles, direction) for cell in cells]
    if all(len(rows) == 0 for rows in per_cell):
        raise ValueError(
            "No valid dV/dQ cycles found. Ensure input contains charge/discharge records "
            "with non-zero capacity change and voltage span."
        )

    if mode == "2d":
        traces = (
            _build_traces_2d_highlight(cells, per_cell, baseline_cycles, highlight_cycle)
            if view == "highlight"
            else _build_traces_2d(cells, per_cell)
        )
        fig = go.Figure(data=traces)
        layout = _layout_2d()
        if view == "highlight":
            # Highlight view uses a per-cycle normalised capacity axis (0–1).
            layout["xaxis"]["title"] = {"text": "Normalised capacity (Q/Q_max)", "font": layout["xaxis"]["title"]["font"]}
            layout["xaxis"]["range"] = [0, 1]
        y_top = _robust_y_top(traces)
        if y_top is not None:
            layout["yaxis"]["range"] = [0, y_top]
        fig.update_layout(**layout)
        return fig

    fig = go.Figure(data=_build_traces_3d(cells, per_cell))
    fig.update_layout(
        scene=_scene(),
        scene_aspectmode="manual",
        scene_aspectratio={"x": 1.4, "y": 1.0, "z": 0.7},
        margin={"l": 20, "r": 20, "t": 60, "b": 20},
        font={"family": "Inter, system-ui, sans-serif", "size": 12, "color": "#3a3a3c"},
        paper_bgcolor="white",
        showlegend=True,
    )
    return fig
