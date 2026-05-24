from __future__ import annotations

from typing import Any, Literal

from plotly.subplots import make_subplots

from ..io import CyclerName
from ..plots.gcd import gcd_plot
from ..plots.voltage_time import voltage_time_plot


Direction = Literal["discharge", "charge"]


def _figure(
    data: Any,
    labels: list[str] | None,
    cycles: list[int] | None,
    direction: Direction,
    cycler: CyclerName,
    cathode_mass_g: float | None,
):
    fig_scatter = gcd_plot(
        data,
        labels=labels,
        cycles=cycles,
        mode="scatter",
        direction=direction,
        cycler=cycler,
        cathode_mass_g=cathode_mass_g,
    )
    fig_cumulative = gcd_plot(
        data,
        labels=labels,
        cycles=cycles,
        mode="cumulative",
        direction=direction,
        cycler=cycler,
        cathode_mass_g=cathode_mass_g,
    )
    try:
        fig_vt = voltage_time_plot(data, labels=labels, cycler=cycler, max_cycles=5)
        has_vt = len(fig_vt.data) > 0
    except Exception:
        has_vt = False
        fig_vt = None  # type: ignore[assignment]

    rows = 3 if has_vt else 2
    titles = ("GCD (V vs Q)", "GCD cumulative")
    if has_vt:
        titles = (*titles, "Voltage vs time")
    combined = make_subplots(
        rows=rows,
        cols=1,
        subplot_titles=titles,
        vertical_spacing=0.08,
    )
    for tr in fig_scatter.data:
        combined.add_trace(tr, row=1, col=1)
    for tr in fig_cumulative.data:
        combined.add_trace(tr, row=2, col=1)
    if has_vt and fig_vt is not None:
        for tr in fig_vt.data:
            combined.add_trace(tr, row=3, col=1)
    combined.update_layout(height=900 if has_vt else 700, showlegend=True)
    return combined


def gcd_dashboard(
    data: Any,
    *,
    serve: bool = False,
    port: int = 8050,
    labels: list[str] | None = None,
    cycles: list[int] | None = None,
    direction: Direction = "discharge",
    cycler: CyclerName = "auto",
    cathode_mass_g: float | None = None,
    **kwargs: Any,
):
    figure = _figure(data, labels, cycles, direction, cycler, cathode_mass_g)
    if not serve:
        return figure

    try:
        from dash import Dash, Input, Output, dcc, html
    except Exception as exc:
        raise RuntimeError("Dash is required for serve=True. Install with `pip install 'cellviz[dash]'`.") from exc

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
            dcc.Graph(id="gcd-graph", figure=figure),
        ]
    )

    @app.callback(Output("gcd-graph", "figure"), Input("cycle-slider", "value"))
    def _update(cycle_idx: int):
        selected = [cycle_values[int(cycle_idx)]]
        return _figure(data, labels, selected, direction, cycler, cathode_mass_g)

    app.run(port=port, **kwargs)
    return app
