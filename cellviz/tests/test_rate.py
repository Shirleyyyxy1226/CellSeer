from __future__ import annotations

import pandas as pd
import pytest

from cellviz import (
    ProtocolSegment,
    RatePerformanceCell,
    compute_rate_performance,
    rate_dashboard,
    rate_plot,
)


def _sample_df() -> pd.DataFrame:
    """Three cycles, alternating charge/discharge segments per cycle."""
    rows = []
    for cycle in (1, 2, 3):
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
                }
            )
    return pd.DataFrame(rows)


def test_compute_rate_performance_basic_capacity():
    curves = {}
    df = _sample_df()
    for cyc, chunk in df.groupby("Cycle"):
        curves[int(cyc)] = {
            "Voltage [V]": chunk["Voltage [V]"].tolist(),
            "Capacity [Ah]": chunk["Capacity [Ah]"].tolist(),
            "Current [A]": chunk["Current [A]"].tolist(),
        }
    rp = compute_rate_performance(curves, direction="discharge", label="Demo")
    assert rp.cycles == [1, 2, 3]
    assert len(rp.discharge_capacity_mah) == 3
    assert all(v > 0 for v in rp.discharge_capacity_mah)


def test_compute_rate_performance_derives_protocol_from_crates():
    curves = {c: {"Voltage [V]": [3.0, 4.0], "Capacity [Ah]": [0.0, 0.001], "Current [A]": [-0.1, -0.1]} for c in (1, 2, 3, 4, 5)}
    rp = compute_rate_performance(
        curves,
        direction="discharge",
        c_rate_map={1: 0.5, 2: 0.5, 3: 1, 4: 1, 5: 1},
    )
    assert [s.c_rate for s in rp.protocol_segments] == [0.5, 1]
    assert rp.protocol_segments[0].cycle_end == 2
    assert rp.protocol_segments[1].cycle_start == 3


def test_rate_plot_from_dataframe():
    fig = rate_plot(_sample_df(), direction="discharge")
    assert len(fig.data) == 1
    assert fig.layout.xaxis.title.text == "Cycle number"
    assert "Discharge capacity" in fig.layout.yaxis.title.text


def test_rate_plot_specific_capacity_label():
    cell = RatePerformanceCell(
        cell_id="c1",
        label="Cell 1",
        cycles=[1, 2, 3],
        discharge_capacity_mah=[100, 95, 90],
        specific_capacity_mah_g=[200, 190, 180],
    )
    fig = rate_plot(cell, direction="discharge", use_specific_capacity=True)
    assert "mAh g" in fig.layout.yaxis.title.text


def test_rate_plot_from_precomputed_dict():
    rec = {
        "cellId": "id-1",
        "cellName": "Demo",
        "cycles": [1, 2, 3, 4],
        "dischargeCapacityMah": [180, 175, 165, 160],
        "cRates": [0.5, 0.5, 1, 1],
        "protocolSegments": [
            {"cycleStart": 1, "cycleEnd": 2, "cRate": 0.5},
            {"cycleStart": 3, "cycleEnd": 4, "cRate": 1},
        ],
    }
    fig = rate_plot(rec, direction="discharge", show_connected_line=True)
    assert len(fig.data) == 1
    assert fig.layout.shapes is not None and len(fig.layout.shapes) == 1
    assert fig.layout.annotations is not None and len(fig.layout.annotations) == 2


def test_rate_plot_raises_for_empty():
    rp = RatePerformanceCell(
        cell_id="empty",
        label="Empty",
        cycles=[],
        discharge_capacity_mah=[],
    )
    with pytest.raises(ValueError):
        rate_plot(rp)


def test_rate_dashboard_returns_composed_figure():
    fig = rate_dashboard(_sample_df(), serve=False)
    assert len(fig.data) >= 1


def test_rate_dashboard_from_precomputed():
    rec = {
        "cellId": "id-1",
        "cellName": "Demo",
        "cycles": [1, 2, 3],
        "dischargeCapacityMah": [180, 175, 170],
    }
    fig = rate_dashboard(rec, serve=False)
    assert len(fig.data) >= 1


def test_protocol_segment_dataclass_basic():
    seg = ProtocolSegment(cycle_start=1, cycle_end=5, c_rate=0.5)
    assert seg.cycle_end == 5
