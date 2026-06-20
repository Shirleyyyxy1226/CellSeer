from __future__ import annotations

from typing import Any, Literal

from plotly.subplots import make_subplots

from ..io import CyclerName
from ..plots.dqdv import dqdv_plot


Direction = Literal["discharge", "charge"]


def _figure(
    data: Any,
    labels: list[str] | None,
    cycles: list[int] | None,
    direction: Direction,
    cycler: CyclerName,
):
    fig3d = dqdv_plot(data, labels=labels, cycles=cycles, mode="3d", direction=direction, cycler=cycler)
    fig2d = dqdv_plot(data, labels=labels, cycles=cycles, mode="2d", direction=direction, cycler=cycler)
    combined = make_subplots(
        rows=1,
        cols=2,
        specs=[[{"type": "scene"}, {"type": "xy"}]],
        subplot_titles=("dQ/dV 3D", "dQ/dV 2D"),
    )
    for tr in fig3d.data:
        combined.add_trace(tr, row=1, col=1)
    for tr in fig2d.data:
        combined.add_trace(tr, row=1, col=2)
    combined.update_layout(height=650, showlegend=True)
    return combined


def dqdv_dashboard(
    data: Any,
    *,
    serve: bool = False,
    port: int = 8050,
    labels: list[str] | None = None,
    cycles: list[int] | None = None,
    direction: Direction = "discharge",
    cycler: CyclerName = "auto",
    **kwargs: Any,
):
    """One-call interactive dQ/dV dashboard (Dash).

    serve=True starts a local server on `port`; serve=False returns the
    figure for embedding. Accepts anything load() accepts.
    """
    figure = _figure(data, labels, cycles, direction, cycler)
    if not serve:
        return figure

    try:
        from dash import Dash, Input, Output, dcc, html
    except Exception as exc:
        raise RuntimeError("Dash is required for serve=True. Install with `pip install 'cellseer[dash]'`.") from exc

    cycle_values = sorted(set(cycles or []))
    if not cycle_values:
        cycle_values = [0]

    app = Dash(__name__)
    app.layout = html.Div(
        [
            dcc.Slider(
                min=0,
                max=len(cycle_values) - 1,
                step=1,
                value=len(cycle_values) - 1,
                id="cycle-slider",
            ),
            dcc.Graph(id="dqdv-graph", figure=figure),
        ]
    )

    @app.callback(Output("dqdv-graph", "figure"), Input("cycle-slider", "value"))
    def _update(cycle_idx: int):
        selected = [cycle_values[int(cycle_idx)]]
        return _figure(data, labels, selected, direction, cycler)

    app.run(port=port, **kwargs)
    return app
