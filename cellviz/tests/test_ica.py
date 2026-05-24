from __future__ import annotations

from pathlib import Path

import pandas as pd

from cellviz import ica_dashboard, ica_plot
from cellviz.io import CellData, load, load_many
from cellviz.style import cell_color, cycle_fade_color


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


def test_ica_plot_3d_from_dataframe():
    fig = ica_plot(_sample_df(), mode="3d")
    assert len(fig.data) == 2
    assert all(t.type == "scatter3d" for t in fig.data)
    assert fig.layout.scene.xaxis.range[0] > fig.layout.scene.xaxis.range[1]


def test_ica_plot_charge_direction():
    df = _sample_df().copy()
    df["Current [A]"] = 0.2
    fig = ica_plot(df, mode="3d", direction="charge")
    assert len(fig.data) == 2


def test_multi_input_map_labels():
    fig = ica_plot({"A": _sample_df(), "B": _sample_df()}, mode="3d")
    names = [t.name for t in fig.data if t.showlegend]
    assert any("A" in n for n in names)
    assert any("B" in n for n in names)


def test_file_label_defaults_to_filename(tmp_path: Path):
    path = tmp_path / "cell_alpha.csv"
    _sample_df().to_csv(path, index=False)
    fig = ica_plot(path, mode="3d")
    legend_names = [t.name for t in fig.data if t.showlegend]
    assert any("cell_alpha" in n for n in legend_names)


def test_load_cell_record_dict():
    rec = {
        "cell_id": "id-1",
        "label": "Record",
        "curves": {1: {"Voltage [V]": [4.2, 4.1, 4.0], "Capacity [Ah]": [0.0, 0.001, 0.002], "Current [A]": [-0.1, -0.1, -0.1]}},
    }
    loaded = load(rec)
    assert isinstance(loaded, CellData)
    assert loaded.label == "Record"


def test_ica_plot_2d_mode():
    fig = ica_plot(_sample_df(), mode="2d")
    assert len(fig.data) >= 2
    assert fig.layout.xaxis.title.text == "Voltage (V)"


def test_dashboard_returns_composed_figure():
    fig = ica_dashboard(_sample_df(), serve=False)
    assert len(fig.data) >= 2


def test_style_ports_deterministic():
    assert cell_color("cell-a", 0) == cell_color("cell-a", 0)
    assert cycle_fade_color("#1f77b4", 0.5).startswith("#")


def test_load_many_mixed_inputs(tmp_path: Path):
    path = tmp_path / "mix.csv"
    _sample_df().to_csv(path, index=False)
    out = load_many([_sample_df(), path, {"label": "R", "curves": {1: {"Voltage [V]": [4.2, 4.1], "Capacity [Ah]": [0.0, 0.001], "Current [A]": [-0.1, -0.1]}}}])
    assert len(out) == 3
