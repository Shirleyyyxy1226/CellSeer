from __future__ import annotations

from typing import Any, Literal

import plotly.graph_objects as go

from ..compute import compute_dqdv_dvdq_per_cycle
from ..io import CellData, CyclerName, load_many
from ..style import (
    base_layout,
    build_shared_grid,
    cell_color,
    cycle_fade_color,
    hex_to_rgba,
    interpolate_onto_grid,
)


Direction = Literal["discharge", "charge"]


def _dqdv_points(cell: CellData, cycles: list[int] | None, direction: Direction) -> list[tuple[int, list[float], list[float]]]:
    computed = compute_dqdv_dvdq_per_cycle(cell.curves, direction=direction)
    out: list[tuple[int, list[float], list[float]]] = []
    allowed = set(cycles) if cycles else None
    for cycle, payload in sorted(computed.items()):
        if allowed is not None and cycle not in allowed:
            continue
        dqdv = payload.get("dqdv", {}) or {}
        v = list(dqdv.get("v", []))
        dqdv_vals = list(dqdv.get("dqdv", []))
        if len(v) >= 2 and len(dqdv_vals) >= 2:
            out.append((cycle, v, dqdv_vals))
    return out


def _voltage_range(per_cell: list[list[tuple[int, list[float], list[float]]]]) -> tuple[float, float] | None:
    all_v: list[float] = []
    for rows in per_cell:
        for _, v, _ in rows:
            all_v.extend(v)
    if not all_v:
        return None
    return max(all_v), min(all_v)


def _build_traces_3d(cells: list[CellData], per_cell: list[list[tuple[int, list[float], list[float]]]]) -> list[go.Scatter3d]:
    traces: list[go.Scatter3d] = []
    for i, (cell, rows) in enumerate(zip(cells, per_cell)):
        base = cell.color or cell_color(cell.cell_id or cell.label or f"dataset-{i+1}", i)
        total = len(rows)
        for j, (cycle, v, dqdv) in enumerate(rows):
            traces.append(
                go.Scatter3d(
                    x=v,
                    y=[cycle] * len(v),
                    z=dqdv,
                    mode="lines",
                    name=f"{cell.label} - Cycle {cycle}",
                    legendgroup=cell.cell_id or cell.label or f"group-{i}",
                    showlegend=j == total - 1,
                    line={"color": cycle_fade_color(base, 1 if total <= 1 else j / (total - 1)), "width": 3},
                    hovertemplate=f"{cell.label}<br>Voltage: %{{x:.2f}} V<br>Cycle: %{{y}}<br>dQ/dV: %{{z:.2f}} Ah/V<extra></extra>",
                )
            )
    return traces


def _find_peak(values: list[float]) -> tuple[int, float]:
    idx = max(range(len(values)), key=lambda i: values[i])
    return idx, values[idx]


def _build_traces_2d(cells: list[CellData], per_cell: list[list[tuple[int, list[float], list[float]]]]) -> list[go.Scatter]:
    """Range view matching the web app's dQ/dV 2D 'range' viewMode.

    Each cycle's dQ/dV (Ah/V) is converted to mAh/V (×1000) and resampled onto a
    shared voltage grid (out-of-range → 0). All cycles are drawn as one faint
    joined envelope; the last cycle is drawn bold with a peak diamond.
    """
    # Shared voltage grid across every cell/cycle (web app: buildSharedGrid).
    all_v = [v for rows in per_cell for (_, vs, _) in rows for v in vs]
    v_grid = build_shared_grid(all_v, 2.5, 4.3, 0.002)

    envelopes: list[go.Scatter] = []
    lines: list[go.Scatter] = []
    peaks: list[go.Scatter] = []
    for i, (cell, rows) in enumerate(zip(cells, per_cell)):
        if not rows:
            continue
        base = cell.color or cell_color(cell.cell_id or cell.label or f"dataset-{i+1}", i)
        faint = hex_to_rgba(base, 0.25)

        # Faint joined envelope of every cycle (nulls separate cycles).
        x_parts: list[float | None] = []
        y_parts: list[float | None] = []
        for idx, (cyc, vs, dqdv) in enumerate(rows):
            y_grid = interpolate_onto_grid(vs, [d * 1000.0 for d in dqdv], v_grid, 0.0)
            if idx > 0:
                x_parts.append(None)
                y_parts.append(None)
            x_parts.extend(v_grid)
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
                    hovertemplate=f"{cell.label}<br>Voltage: %{{x:.2f}} V<br>dQ/dV: %{{y:.2f}} mAh V⁻¹<extra></extra>",
                )
            )

        # Last cycle bold + peak diamond (both on the shared grid).
        last_cyc, last_v, last_dqdv = rows[-1]
        last_y = interpolate_onto_grid(last_v, [d * 1000.0 for d in last_dqdv], v_grid, 0.0)
        peak_idx, peak_val = _find_peak(last_y)
        peak_v = v_grid[peak_idx]
        lines.append(
            go.Scatter(
                x=v_grid,
                y=last_y,
                mode="lines",
                name=f"{cell.label} · Cycle {last_cyc}",
                legendgroup=cell.cell_id or cell.label or f"group-{i}",
                line={"color": base, "width": 2},
                hovertemplate=f"{cell.label}<br>Voltage: %{{x:.2f}} V<br>dQ/dV: %{{y:.2f}} mAh V⁻¹<extra></extra>",
            )
        )
        peaks.append(
            go.Scatter(
                x=[peak_v],
                y=[peak_val],
                mode="markers",
                name="Peak",
                legendgroup=cell.cell_id or cell.label or f"group-{i}",
                showlegend=False,
                marker={"size": 10, "color": base, "symbol": "diamond", "line": {"width": 1, "color": "#fff"}},
                hovertemplate=f"{cell.label} peak<br>Voltage: %{{x:.2f}} V<br>dQ/dV: %{{y:.2f}} mAh V⁻¹<extra></extra>",
            )
        )
    return envelopes + lines + peaks


def _layout_2d() -> dict[str, Any]:
    """2D layout matching the web app's dQ/dV figure (font 10, #e0e0e0 grid)."""
    font = {"family": "Inter, sans-serif", "size": 10, "color": "#3a3a3c"}
    return {
        "font": font,
        "paper_bgcolor": "white",
        "plot_bgcolor": "white",
        "xaxis": {"title": {"text": "Voltage (V)", "font": font}, "tickfont": font, "gridcolor": "#e0e0e0", "showgrid": True},
        "yaxis": {"title": {"text": "dQ/dV (mAh V⁻¹)", "font": font}, "tickfont": font, "gridcolor": "#e0e0e0", "showgrid": True},
        "legend": {"x": 1.02, "y": 1, "xanchor": "left", "yanchor": "top", "orientation": "v", "font": font},
        "margin": {"t": 36, "r": 8, "b": 48, "l": 40},
        "showlegend": True,
    }


def _scene(v_range: tuple[float, float] | None) -> dict[str, Any]:
    return {
        "xaxis": {"title": {"text": "Voltage (V)"}, "range": list(v_range) if v_range else None},
        "yaxis": {"title": {"text": "Cycle"}},
        "zaxis": {"title": {"text": "dQ/dV (Ah/V)"}},
        "camera": {"eye": {"x": 1.25, "y": 1.25, "z": 1.25}},
    }


def dqdv_plot(
    data: Any,
    *,
    cycles: list[int] | None = None,
    mode: str = "3d",
    labels: list[str] | None = None,
    direction: Direction = "discharge",
    cycler: CyclerName = "auto",
) -> go.Figure:
    """Incremental-capacity (dQ/dV vs V) figure.

    mode="3d" (default) stacks cycles along a third axis; mode="2d" overlays
    cycles with peak markers. Accepts anything load() accepts; pass a list
    for multi-cell comparison.
    """
    cells = load_many(data, labels=labels, cycler=cycler)
    per_cell = [_dqdv_points(cell, cycles, direction) for cell in cells]
    if all(len(rows) == 0 for rows in per_cell):
        raise ValueError(
            "No valid dQ/dV cycles found. Ensure input contains charge/discharge records "
            "with non-zero capacity change and voltage span."
        )

    if mode == "2d":
        fig = go.Figure(data=_build_traces_2d(cells, per_cell))
        fig.update_layout(**_layout_2d())
        return fig

    fig = go.Figure(data=_build_traces_3d(cells, per_cell))
    fig.update_layout(
        scene=_scene(_voltage_range(per_cell)),
        scene_aspectmode="manual",
        scene_aspectratio={"x": 1.4, "y": 1.0, "z": 0.7},
        margin={"l": 20, "r": 20, "t": 60, "b": 20},
        font={"family": "Inter, system-ui, sans-serif", "size": 12, "color": "#3a3a3c"},
        paper_bgcolor="white",
        showlegend=True,
    )
    return fig
