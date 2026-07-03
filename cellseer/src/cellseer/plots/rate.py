from __future__ import annotations

from typing import Any, Iterable, Literal

import plotly.graph_objects as go

from ..io import CellData, CyclerName, load_many
from ..rate import (
    ProtocolSegment,
    RatePerformanceCell,
    compute_rate_performance,
    from_cell_dict,
)
from ..style import base_layout, cell_color


Direction = Literal["discharge", "charge"]


def _segment_by_crate(x: list[float], y: list[float], c_rates: list[float] | None) -> tuple[list[float | None], list[float | None], list[float | None] | None]:
    if not c_rates or len(c_rates) != len(x):
        return list(x), list(y), list(c_rates) if c_rates else None
    xo: list[float | None] = []
    yo: list[float | None] = []
    co: list[float | None] = []
    for i in range(len(x)):
        if i > 0 and c_rates[i] != c_rates[i - 1]:
            xo.append(None)
            yo.append(None)
            co.append(None)
        xo.append(x[i])
        yo.append(y[i])
        co.append(c_rates[i])
    return xo, yo, co


def _to_rate_cells(data: Any, *, direction: Direction, labels: list[str] | None, cycler: CyclerName) -> list[RatePerformanceCell]:
    if isinstance(data, RatePerformanceCell):
        return [data]
    if isinstance(data, (list, tuple)) and data and all(isinstance(d, RatePerformanceCell) for d in data):
        return list(data)
    if isinstance(data, dict) and ("cycles" in data) and ("dischargeCapacityMah" in data or "discharge_capacity_mah" in data):
        return [from_cell_dict(data)]
    if isinstance(data, (list, tuple)) and data and isinstance(data[0], dict) and ("dischargeCapacityMah" in data[0] or "discharge_capacity_mah" in data[0]):
        return [from_cell_dict(d) for d in data]
    cells = load_many(data, labels=labels, cycler=cycler)
    return [
        compute_rate_performance(
            cell.curves,
            direction=direction,
            cathode_mass_g=cell.cathode_mass_g,
            cell_id=cell.cell_id,
            label=cell.label or cell.cell_id or f"Cell {i+1}",
            color=cell.color,
        )
        for i, cell in enumerate(cells)
    ]


def _build_traces(
    cells: list[RatePerformanceCell],
    *,
    direction: Direction,
    use_specific_capacity: bool,
    show_connected_line: bool,
) -> tuple[list[go.Scatter], float]:
    traces: list[go.Scatter] = []
    direction_label = "Charge" if direction == "charge" else "Discharge"
    capacity_unit = "mAh g⁻¹" if use_specific_capacity else "mAh"
    max_y = 0.0

    for i, cell in enumerate(cells):
        color = cell.color or cell_color(cell.cell_id or cell.label or f"cell-{i+1}", i)
        y_source: Iterable[float] | None = None
        if direction == "charge":
            y_source = cell.charge_capacity_mah
        elif use_specific_capacity and cell.specific_capacity_mah_g:
            y_source = cell.specific_capacity_mah_g
        else:
            y_source = cell.discharge_capacity_mah
        if not y_source:
            continue
        y = [float(v) for v in y_source]
        x = [float(c) for c in cell.cycles]
        has_crate = cell.c_rates is not None and len(cell.c_rates) == len(x)
        use_lines = show_connected_line and has_crate
        seg_x, seg_y, customdata = _segment_by_crate(x, y, cell.c_rates) if use_lines else (x, y, cell.c_rates if has_crate else None)
        traces.append(
            go.Scatter(
                x=seg_x,
                y=seg_y,
                mode="lines+markers" if use_lines else "markers",
                name=cell.label,
                line={"width": 2, "color": color} if use_lines else None,
                marker={"size": 6, "color": color},
                connectgaps=False,
                hovertemplate=(
                    f"{cell.label}<br>Cycle: %{{x}}<br>{direction_label} capacity: %{{y:.2f}} {capacity_unit}<br>C-rate: %{{customdata}}C<extra></extra>"
                    if has_crate
                    else f"{cell.label}<br>Cycle: %{{x}}<br>{direction_label} capacity: %{{y:.2f}} {capacity_unit}<extra></extra>"
                ),
                customdata=customdata,
            )
        )
        for v in y:
            if v > max_y:
                max_y = v
    return traces, max_y


def _protocol_shapes(segments: list[ProtocolSegment], max_y: float) -> list[dict[str, Any]]:
    if len(segments) <= 1:
        return []
    y_top = max_y * 1.02 or 1.0
    return [
        {
            "type": "line",
            "x0": seg.cycle_end + 0.5,
            "x1": seg.cycle_end + 0.5,
            "y0": 0,
            "y1": y_top,
            "xref": "x",
            "yref": "y",
            "line": {"dash": "dash", "width": 1.5, "color": "rgba(128,128,128,0.7)"},
            "layer": "below",
        }
        for seg in segments[:-1]
    ]


def _protocol_annotations(segments: list[ProtocolSegment]) -> list[dict[str, Any]]:
    if not segments:
        return []
    return [
        {
            "x": (seg.cycle_start + seg.cycle_end) / 2,
            "y": 1,
            "yref": "paper",
            "xanchor": "center",
            "yanchor": "top",
            "text": f"{seg.c_rate}C",
            "showarrow": False,
            "font": {"size": 10, "color": "#555"},
        }
        for seg in segments
    ]


def rate_plot(
    data: Any,
    *,
    direction: Direction = "discharge",
    use_specific_capacity: bool = False,
    show_connected_line: bool = False,
    labels: list[str] | None = None,
    cycler: CyclerName = "auto",
) -> go.Figure:
    """Plot per-cycle (dis)charge capacity for one or more cells.

    Accepts:
      - Raw curves (file path, DataFrame, CellData, dict-of-curves) — computes
        the rate-performance table on the fly.
      - A precomputed ``RatePerformanceCell`` (or list of them).
      - A precomputed dict / list-of-dicts matching the rate-performance API
        shape (``cycles``, ``dischargeCapacityMah`` etc.).
    """
    cells = _to_rate_cells(data, direction=direction, labels=labels, cycler=cycler)
    if not cells or all(not c.cycles for c in cells):
        raise ValueError("No rate-performance cycles available for the provided input.")
    traces, max_y = _build_traces(
        cells,
        direction=direction,
        use_specific_capacity=use_specific_capacity,
        show_connected_line=show_connected_line,
    )
    segments: list[ProtocolSegment] = []
    for c in cells:
        if c.protocol_segments:
            segments = c.protocol_segments
            break
    fig = go.Figure(data=traces)
    direction_label = "Charge" if direction == "charge" else "Discharge"
    y_label = (
        f"{direction_label} specific capacity (mAh g⁻¹)"
        if use_specific_capacity
        else f"{direction_label} capacity (mAh)"
    )
    layout = base_layout()
    layout["xaxis"]["title"] = {"text": "Cycle number"}
    layout["yaxis"]["title"] = {"text": y_label}
    layout["shapes"] = _protocol_shapes(segments, max_y)
    layout["annotations"] = _protocol_annotations(segments)
    layout["showlegend"] = True
    fig.update_layout(**layout)
    return fig


def _cell_data_for_voltage(data: Any) -> Any:
    """Return data suitable for voltage_time_plot if available."""
    if isinstance(data, RatePerformanceCell):
        return None
    if isinstance(data, (list, tuple)) and data and isinstance(data[0], RatePerformanceCell):
        return None
    if isinstance(data, CellData):
        return data
    return data
