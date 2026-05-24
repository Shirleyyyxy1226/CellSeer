from __future__ import annotations

from typing import Any, Literal

import plotly.graph_objects as go

from ..compute import compute_ica_dvq_per_cycle
from ..io import CellData, CyclerName, load_many
from ..style import cell_color, cycle_fade_color


Direction = Literal["discharge", "charge"]


def _ica_points(cell: CellData, cycles: list[int] | None, direction: Direction) -> list[tuple[int, list[float], list[float]]]:
    computed = compute_ica_dvq_per_cycle(cell.curves, direction=direction)
    out: list[tuple[int, list[float], list[float]]] = []
    allowed = set(cycles) if cycles else None
    for cycle, payload in sorted(computed.items()):
        if allowed is not None and cycle not in allowed:
            continue
        ica = payload.get("ica", {})
        v = list(ica.get("v", []))
        dqdv = list(ica.get("dqdv", []))
        if len(v) >= 2 and len(dqdv) >= 2:
            out.append((cycle, v, dqdv))
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
                    hovertemplate=f"{cell.label}<br>Voltage: %{{x:.2f}} V<br>Cycle: %{{y}}<br>IC: %{{z:.2f}} Ah/V<extra></extra>",
                )
            )
    return traces


def _find_peak(values: list[float]) -> tuple[int, float]:
    idx = max(range(len(values)), key=lambda i: values[i])
    return idx, values[idx]


def _build_traces_2d(cells: list[CellData], per_cell: list[list[tuple[int, list[float], list[float]]]]) -> list[go.Scatter]:
    traces: list[go.Scatter] = []
    for i, (cell, rows) in enumerate(zip(cells, per_cell)):
        if not rows:
            continue
        base = cell.color or cell_color(cell.cell_id or cell.label or f"dataset-{i+1}", i)
        baseline = rows[1] if len(rows) > 1 else None
        selected = rows[-1]
        if baseline:
            traces.append(
                go.Scatter(
                    x=baseline[1],
                    y=baseline[2],
                    mode="lines",
                    name=f"{cell.label} Cycle {baseline[0]}",
                    line={"color": "rgba(31,119,180,0.4)" if base == "#1f77b4" else base, "width": 1.5},
                    hovertemplate=f"{cell.label} Cycle {baseline[0]}<br>Voltage: %{{x:.2f}} V<br>IC: %{{y:.2f}} Ah/V<extra></extra>",
                )
            )
        peak_idx, peak_val = _find_peak(selected[2])
        peak_v = selected[1][peak_idx]
        traces.append(
            go.Scatter(
                x=selected[1],
                y=selected[2],
                mode="lines",
                name=cell.label,
                line={"color": base, "width": 2},
                hovertemplate=f"{cell.label}<br>Voltage: %{{x:.2f}} V<br>IC: %{{y:.2f}} Ah/V<br>Peak: {peak_v:.2f} V, {peak_val:.2f} Ah/V<extra></extra>",
            )
        )
        traces.append(
            go.Scatter(
                x=[peak_v],
                y=[peak_val],
                mode="markers",
                name=f"{cell.label} peak",
                marker={"size": 10, "color": base, "symbol": "diamond", "line": {"width": 1, "color": "#fff"}},
                hovertemplate=f"{cell.label} peak<br>Voltage: %{{x:.2f}} V<br>IC: %{{y:.2f}} Ah/V<extra></extra>",
            )
        )
    return traces


def _scene(v_range: tuple[float, float] | None) -> dict[str, Any]:
    return {
        "xaxis": {"title": {"text": "Voltage (V)"}, "range": list(v_range) if v_range else None},
        "yaxis": {"title": {"text": "Cycle"}},
        "zaxis": {"title": {"text": "dQ/dV (Ah/V)"}},
        "camera": {"eye": {"x": 1.25, "y": 1.25, "z": 1.25}},
    }


def ica_plot(
    data: Any,
    *,
    cycles: list[int] | None = None,
    mode: str = "3d",
    labels: list[str] | None = None,
    direction: Direction = "discharge",
    cycler: CyclerName = "auto",
) -> go.Figure:
    cells = load_many(data, labels=labels, cycler=cycler)
    per_cell = [_ica_points(cell, cycles, direction) for cell in cells]
    if all(len(rows) == 0 for rows in per_cell):
        raise ValueError(
            "No valid ICA cycles found. Ensure input contains charge/discharge records "
            "with non-zero capacity change and voltage span."
        )

    if mode == "2d":
        fig = go.Figure(data=_build_traces_2d(cells, per_cell))
        fig.update_layout(
            xaxis={"title": {"text": "Voltage (V)"}},
            yaxis={"title": {"text": "Incremental Capacity (Ah/V)"}},
            showlegend=True,
        )
        return fig

    fig = go.Figure(data=_build_traces_3d(cells, per_cell))
    fig.update_layout(scene=_scene(_voltage_range(per_cell)), showlegend=True)
    return fig
