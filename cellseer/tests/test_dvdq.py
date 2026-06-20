from __future__ import annotations

from pathlib import Path

import pandas as pd

from cellseer import dvdq_dashboard, dvdq_plot
from cellseer.io import load, load_many


def _sample_df() -> pd.DataFrame:
    rows = []
    for cycle in (1, 2):
        for i in range(20):
            rows.append(
                {
                    "Cycle": cycle,
                    "Voltage [V]": 4.2 - i * 0.03,
                    "Capacity [Ah]": i * 0.001,
                    "Current [A]": -0.2,
                }
            )
    return pd.DataFrame(rows)


def test_dvdq_plot_3d_from_dataframe():
    fig = dvdq_plot(_sample_df(), mode="3d")
    assert len(fig.data) == 2
    assert all(t.type == "scatter3d" for t in fig.data)
    assert fig.layout.scene.xaxis.title.text == "Capacity (Ah)"
    assert fig.layout.scene.zaxis.title.text == "dV/dQ (V·h/Ah)"


def test_dvdq_plot_charge_direction():
    df = _sample_df().copy()
    df["Current [A]"] = 0.2
    fig = dvdq_plot(df, mode="3d", direction="charge")
    assert len(fig.data) == 2


def test_dvdq_plot_2d_mode():
    fig = dvdq_plot(_sample_df(), mode="2d")
    assert len(fig.data) >= 2
    assert fig.layout.xaxis.title.text == "Capacity (Ah)"
    assert fig.layout.yaxis.title.text == "dV/dQ (V·h/Ah)"


def test_dvdq_multi_input_map_labels():
    fig = dvdq_plot({"A": _sample_df(), "B": _sample_df()}, mode="3d")
    names = [t.name for t in fig.data if t.showlegend]
    assert any("A" in n for n in names)
    assert any("B" in n for n in names)


def test_dvdq_file_label_defaults_to_filename(tmp_path: Path):
    path = tmp_path / "cell_alpha.csv"
    _sample_df().to_csv(path, index=False)
    fig = dvdq_plot(path, mode="3d")
    legend_names = [t.name for t in fig.data if t.showlegend]
    assert any("cell_alpha" in n for n in legend_names)


def test_dvdq_dashboard_returns_composed_figure():
    fig = dvdq_dashboard(_sample_df(), serve=False)
    assert len(fig.data) >= 2


def test_dvdq_load_and_load_many(tmp_path: Path):
    path = tmp_path / "cell.csv"
    _sample_df().to_csv(path, index=False)
    cell = load(path)
    assert cell.curves
    loaded = load_many([_sample_df(), path])
    assert len(loaded) == 2
