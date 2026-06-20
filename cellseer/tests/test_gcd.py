from __future__ import annotations

import pandas as pd
import pytest

from cellseer import gcd_dashboard, gcd_plot, voltage_time_plot
from cellseer.gcd import compute_gcd_per_cycle


def _sample_df() -> pd.DataFrame:
    """Per cycle: charge first half (positive current), then discharge."""
    rows = []
    for cycle in (1, 2):
        n = 20
        for j in range(n):
            v = 3.0 + j * 0.05 if j < n / 2 else 4.0 - (j - n / 2) * 0.05
            q = (j if j < n / 2 else (n - j)) * 0.001
            i = 0.2 if j < n / 2 else -0.2
            rows.append(
                {
                    "Cycle": cycle,
                    "Voltage [V]": v,
                    "Capacity [Ah]": q,
                    "Current [A]": i,
                    "Time [s]": j,
                }
            )
    return pd.DataFrame(rows)


def test_compute_gcd_per_cycle_returns_both_directions_separately():
    df = _sample_df()
    curves = {}
    for cyc, chunk in df.groupby("Cycle"):
        curves[int(cyc)] = {
            "Voltage [V]": chunk["Voltage [V]"].tolist(),
            "Capacity [Ah]": chunk["Capacity [Ah]"].tolist(),
            "Current [A]": chunk["Current [A]"].tolist(),
        }
    chg = compute_gcd_per_cycle(curves, direction="charge")
    dchg = compute_gcd_per_cycle(curves, direction="discharge")
    assert set(chg.keys()) == {1, 2}
    assert set(dchg.keys()) == {1, 2}
    for cyc_payload in chg.values():
        assert len(cyc_payload["q"]) >= 2
        assert cyc_payload["q"][0] == 0  # charge starts at 0


def test_gcd_plot_scatter_discharge():
    fig = gcd_plot(_sample_df(), mode="scatter", direction="discharge")
    assert len(fig.data) == 2
    for tr in fig.data:
        assert "discharge" in tr.name
    assert fig.layout.xaxis.title.text == "Capacity (mAh)"


def test_gcd_plot_scatter_charge():
    fig = gcd_plot(_sample_df(), mode="scatter", direction="charge")
    assert len(fig.data) == 2
    for tr in fig.data:
        assert "charge" in tr.name


def test_gcd_plot_cumulative_chains_cycles():
    fig = gcd_plot(_sample_df(), mode="cumulative", direction="discharge")
    assert len(fig.data) == 2
    last_end = -float("inf")
    for tr in fig.data:
        xs = list(tr.x)
        assert xs[0] >= last_end - 1e-9
        last_end = xs[-1]
    assert fig.layout.xaxis.title.text == "Cumulative capacity (mAh)"


def test_gcd_plot_show_lines():
    fig = gcd_plot(_sample_df(), mode="scatter", show_lines=True)
    for tr in fig.data:
        assert tr.mode == "lines"


def test_gcd_plot_raises_when_no_cycles():
    df = pd.DataFrame(
        [{"Cycle": 1, "Voltage [V]": 3.5, "Capacity [Ah]": 0.0, "Current [A]": 0.1}]
    )
    with pytest.raises(ValueError):
        gcd_plot(df, mode="scatter", direction="discharge")


def test_gcd_dashboard_returns_composed_figure():
    fig = gcd_dashboard(_sample_df(), serve=False)
    assert len(fig.data) >= 4


def test_voltage_time_plot_one_trace_per_cycle():
    fig = voltage_time_plot(_sample_df(), max_cycles=5)
    assert len(fig.data) == 2
    for tr in fig.data:
        assert tr.mode == "lines"
    assert fig.layout.xaxis.title.text == "Time (s)"
