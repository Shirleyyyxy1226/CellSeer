from __future__ import annotations

from typing import Any, Literal

import plotly.graph_objects as go

from ..gcd import compute_gcd_per_cycle
from ..io import CellData, CyclerName, load_many
from ..style import base_layout, cell_color, cell_cycle_color


Direction = Literal["discharge", "charge"]
Mode = Literal["scatter", "cumulative"]


MIN_CAP_MAH = 0.01


def _filter_cycles(per_cycle: dict[int, dict[str, Any]], cycles: list[int] | None) -> list[tuple[int, list[float], list[float]]]:
    out: list[tuple[int, list[float], list[float]]] = []
    allowed = set(cycles) if cycles else None
    for cyc, payload in sorted(per_cycle.items()):
        if allowed is not None and cyc not in allowed:
            continue
        q = list(payload.get("q", []))
        v = list(payload.get("v", []))
        if len(q) < 2 or len(v) < 2:
            continue
        if max(q) - min(q) < MIN_CAP_MAH:
            continue
        out.append((cyc, q, v))
    return out


def _build_scatter(
    cells: list[CellData],
    per_cell: list[list[tuple[int, list[float], list[float]]]],
    direction: Direction,
    show_lines: bool,
) -> list[go.Scatter]:
    traces: list[go.Scatter] = []
    multi = len(cells) > 1
    # Open circle for discharge (matches TS: circle-open for single-cell discharge traces).
    dchg_symbol = "circle-open" if (not multi and direction in ("discharge", "both")) else "circle"
    for i, (cell, rows) in enumerate(zip(cells, per_cell)):
        base = cell.color or cell_color(cell.cell_id or cell.label or f"dataset-{i+1}", i)
        prefix = f"{cell.label} — " if multi else ""
        total = len(rows)
        cell_traces: list[go.Scatter] = []
        for j, (cyc, qs, vs) in enumerate(rows):
            # In multi-cell mode use flat per-cell colour; single-cell gets turbo below.
            color = base
            cell_traces.append(
                go.Scatter(
                    x=qs,
                    y=vs,
                    mode="lines" if show_lines else "markers",
                    name=f"{prefix}Cycle {cyc} ({direction})",
                    line={"width": 1.5, "color": color} if show_lines else None,
                    marker={"size": 3, "color": color, "symbol": dchg_symbol} if not show_lines else None,
                    legendgroup=f"{cell.cell_id or cell.label or i}",
                    showlegend=(j == 0 or j == total - 1),
                    hovertemplate=(
                        f"{cell.label}<br>Cycle: {cyc} ({direction})<br>"
                        "Capacity: %{x:.2f} mAh<br>Voltage: %{y:.3f} V<extra></extra>"
                    ),
                )
            )
        # Apply cellCycleColor fade for single-cell view (early=light tint, late=full colour).
        if not multi and len(cell_traces) > 1:
            n = len(cell_traces)
            for idx, tr in enumerate(cell_traces):
                c = cell_cycle_color(base, idx / (n - 1))
                if tr.line:
                    tr.line.color = c
                if tr.marker:
                    tr.marker.color = c
        traces.extend(cell_traces)
    return traces


def _build_cumulative(
    cells: list[CellData],
    per_cell: list[list[tuple[int, list[float], list[float]]]],
    direction: Direction,
) -> list[go.Scatter]:
    traces: list[go.Scatter] = []
    multi = len(cells) > 1
    for i, (cell, rows) in enumerate(zip(cells, per_cell)):
        base = cell.color or cell_color(cell.cell_id or cell.label or f"dataset-{i+1}", i)
        prefix = f"{cell.label} — " if multi else ""
        cum = 0.0
        for cyc, qs, vs in rows:
            shifted = [q + cum for q in qs]
            cum += max(qs) if qs else 0.0
            traces.append(
                go.Scatter(
                    x=shifted,
                    y=vs,
                    mode="lines",
                    name=f"{prefix}Cycle {cyc} ({direction})",
                    line={"width": 1.5, "color": base},
                    legendgroup=f"{cell.cell_id or cell.label or i}-{cyc}",
                    hovertemplate=(
                        f"{cell.label}<br>Cycle: {cyc} ({direction})<br>"
                        "Cumulative: %{x:.2f} mAh<br>Voltage: %{y:.3f} V<extra></extra>"
                    ),
                )
            )
    return traces


def gcd_plot(
    data: Any,
    *,
    mode: Mode = "scatter",
    direction: Direction = "discharge",
    cycles: list[int] | None = None,
    show_lines: bool = False,
    labels: list[str] | None = None,
    cycler: CyclerName = "auto",
    cathode_mass_g: float | None = None,
) -> go.Figure:
    """Build a GCD figure (V vs Q per cycle).

    ``mode='scatter'`` plots each cycle as a separate trace at relative
    capacity. ``mode='cumulative'`` chains cycles into a continuous line.
    """
    cells = load_many(data, labels=labels, cycler=cycler)
    per_cell = [
        _filter_cycles(
            compute_gcd_per_cycle(
                cell.curves, direction=direction, cathode_mass_g=cathode_mass_g
            ),
            cycles,
        )
        for cell in cells
    ]
    if all(len(rows) == 0 for rows in per_cell):
        raise ValueError(
            f"No valid {direction} GCD cycles found. Ensure input contains "
            "voltage/capacity/current records with the requested direction."
        )

    if mode == "cumulative":
        fig = go.Figure(data=_build_cumulative(cells, per_cell, direction))
        x_title = "Cumulative capacity (mAh)"
    else:
        fig = go.Figure(data=_build_scatter(cells, per_cell, direction, show_lines))
        x_title = "Capacity (mAh)"

    layout = base_layout()
    layout["xaxis"]["title"] = {"text": x_title}
    layout["yaxis"]["title"] = {"text": "Voltage (V)"}
    layout["showlegend"] = True
    fig.update_layout(**layout)
    return fig
