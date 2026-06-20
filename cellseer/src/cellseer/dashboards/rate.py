from __future__ import annotations

from typing import Any, Literal

from plotly.subplots import make_subplots

from ..io import CyclerName
from ..plots.rate import _cell_data_for_voltage, rate_plot
from ..plots.voltage_time import voltage_time_plot


Direction = Literal["discharge", "charge"]


def _figure(
    data: Any,
    labels: list[str] | None,
    direction: Direction,
    cycler: CyclerName,
    use_specific_capacity: bool,
    show_connected_line: bool,
):
    rate_fig = rate_plot(
        data,
        labels=labels,
        direction=direction,
        cycler=cycler,
        use_specific_capacity=use_specific_capacity,
        show_connected_line=show_connected_line,
    )
    voltage_data = _cell_data_for_voltage(data)
    voltage_fig = None
    has_vt = False
    if voltage_data is not None:
        try:
            voltage_fig = voltage_time_plot(voltage_data, labels=labels, cycler=cycler, max_cycles=5)
            has_vt = len(voltage_fig.data) > 0
        except Exception:
            has_vt = False

    rows = 2 if has_vt else 1
    subplot_titles = ("Rate performance",) + (("Voltage vs time",) if has_vt else ())
    combined = make_subplots(rows=rows, cols=1, subplot_titles=subplot_titles, vertical_spacing=0.1)
    for tr in rate_fig.data:
        combined.add_trace(tr, row=1, col=1)
    if has_vt and voltage_fig is not None:
        for tr in voltage_fig.data:
            combined.add_trace(tr, row=2, col=1)
    layout_updates = {"height": 700 if has_vt else 500, "showlegend": True}
    shapes = list(rate_fig.layout.shapes or [])
    annotations = list(rate_fig.layout.annotations or [])
    if shapes:
        layout_updates["shapes"] = shapes
    if annotations:
        layout_updates["annotations"] = annotations
    combined.update_layout(**layout_updates)
    return combined


def rate_dashboard(
    data: Any,
    *,
    serve: bool = False,
    port: int = 8050,
    labels: list[str] | None = None,
    direction: Direction = "discharge",
    cycler: CyclerName = "auto",
    use_specific_capacity: bool = False,
    show_connected_line: bool = False,
    **kwargs: Any,
):
    """One-call interactive rate-performance dashboard (Dash).

    serve=True starts a local server on `port`; serve=False returns the
    figure for embedding. Accepts anything load() accepts.
    """
    figure = _figure(
        data,
        labels,
        direction,
        cycler,
        use_specific_capacity,
        show_connected_line,
    )
    if not serve:
        return figure

    try:
        from dash import Dash, dcc, html
    except Exception as exc:
        raise RuntimeError("Dash is required for serve=True. Install with `pip install 'cellseer[dash]'`.") from exc

    app = Dash(__name__)
    app.layout = html.Div([dcc.Graph(id="rate-graph", figure=figure)])
    app.run(port=port, **kwargs)
    return app
