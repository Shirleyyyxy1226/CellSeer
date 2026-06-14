from __future__ import annotations

from typing import Any

import plotly.graph_objects as go

from ..io import CellData, CyclerName, load_many
from ..style import cell_color


def _cycle_voltage_time(cell: CellData, cycles: list[int] | None, max_cycles: int):
    out: list[tuple[int, list[float], list[float]]] = []
    allowed = set(cycles) if cycles else None
    cycle_keys = sorted(cell.curves.keys())[:max_cycles]
    for cyc in cycle_keys:
        if allowed is not None and cyc not in allowed:
            continue
        curve = cell.curves[cyc]
        v = curve.get("Voltage [V]") or curve.get("voltage")
        t = curve.get("Time [s]") or curve.get("time")
        if v is None:
            continue
        times: list[float] = []
        volts: list[float] = []
        for j, vv in enumerate(v):
            if vv is None:
                continue
            tt = t[j] if (t and j < len(t) and t[j] is not None) else j
            times.append(float(tt))
            volts.append(float(vv))
        if len(times) >= 2:
            out.append((cyc, times, volts))
    return out


def voltage_time_plot(
    data: Any,
    *,
    cycles: list[int] | None = None,
    max_cycles: int = 5,
    labels: list[str] | None = None,
    cycler: CyclerName = "auto",
) -> go.Figure:
    """Plot voltage vs time for the first few cycles per cell."""
    cells = load_many(data, labels=labels, cycler=cycler)
    multi = len(cells) > 1
    traces: list[go.Scatter] = []
    for i, cell in enumerate(cells):
        rows = _cycle_voltage_time(cell, cycles, max_cycles)
        if not rows:
            continue
        base = cell.color or cell_color(cell.cell_id or cell.label or f"dataset-{i+1}", i)
        prefix = f"{cell.label} — " if multi else ""
        for cyc, times, volts in rows:
            traces.append(
                go.Scatter(
                    x=times,
                    y=volts,
                    mode="lines",
                    name=f"{prefix}Cycle {cyc}",
                    line={"width": 1.5, "color": base},
                    hovertemplate=(
                        f"{cell.label} Cycle {cyc}<br>Time: %{{x:.1f}} s<br>"
                        "Voltage: %{y:.3f} V<extra></extra>"
                    ),
                )
            )

    fig = go.Figure(data=traces)
    fig.update_layout(
        xaxis={"title": {"text": "Time (s)"}},
        yaxis={"title": {"text": "Voltage (V)"}},
        showlegend=True,
    )
    return fig
