#!/usr/bin/env python3
"""Generate the cellseer gallery figures (docs/gallery.html thumbnails).

Run from the repo root:

    python cellseer/examples/gallery.py [--data-dir data_lake/default] [--out docs/assets/gallery]

Each gallery entry below is a self-contained recipe: the `code` string shown
in the docs is exactly what produces the figure. Cells are loaded from the
CellSeer data lake when present; otherwise a synthetic three-cycle dataset is
used so the script works in a bare checkout of the library.
"""
from __future__ import annotations

import argparse
import glob
import json
from pathlib import Path

import pandas as pd

import cellseer

THUMB_W, THUMB_H, THUMB_SCALE = 760, 460, 2


def load_cells(data_dir: Path, pattern: str, n: int) -> list[cellseer.CellData]:
    files = sorted(glob.glob(str(data_dir / pattern / "cycling.parquet")))[:n]
    return [
        cellseer.load(pd.read_parquet(f), label=Path(f).parent.name)
        for f in files
    ]


def synthetic_cell() -> cellseer.CellData:
    rows = []
    for cycle in (1, 2, 3):
        fade = 1 - 0.05 * (cycle - 1)
        for i in range(120):
            q = i / 120 * 0.004 * fade
            rows.append({"Cycle": cycle, "Voltage [V]": 4.2 - 1.2 * (i / 120) ** 1.6,
                         "Capacity [Ah]": q, "Current [A]": -0.001})
    return cellseer.load(pd.DataFrame(rows), label="synthetic cell")


def _apply_showcase_style(fig, title: str) -> None:
    """Professional, publication-style polish applied to every gallery figure:
    a left-aligned bold title, consistent Inter typography, light grid, and
    comfortable margins so axis labels never crowd the frame.
    """
    is_3d = any(getattr(t, "type", "") in ("scatter3d", "surface") for t in fig.data)
    fig.update_layout(
        title={
            "text": title,
            "x": 0.012,
            "xanchor": "left",
            "y": 0.965,
            "yanchor": "top",
            "font": {"family": "Inter, sans-serif", "size": 17, "color": "#1f2933"},
        },
        font={"family": "Inter, sans-serif", "size": 13, "color": "#3a3a3c"},
        paper_bgcolor="white",
        plot_bgcolor="white",
        legend={
            "font": {"family": "Inter, sans-serif", "size": 12, "color": "#52606d"},
            "bgcolor": "rgba(255,255,255,0)",
            "borderwidth": 0,
        },
    )
    if not is_3d:
        axis_title = {"font": {"family": "Inter, sans-serif", "size": 13, "color": "#52606d"}}
        fig.update_xaxes(
            title=axis_title, gridcolor="#eceff1", linecolor="#cfd8dc",
            ticks="outside", tickcolor="#cfd8dc", ticklen=4,
            tickfont={"family": "Inter, sans-serif", "size": 11, "color": "#7b8794"},
            zeroline=False,
        )
        fig.update_yaxes(
            title=axis_title, gridcolor="#eceff1", linecolor="#cfd8dc",
            ticks="outside", tickcolor="#cfd8dc", ticklen=4,
            tickfont={"family": "Inter, sans-serif", "size": 11, "color": "#7b8794"},
            zeroline=False,
        )
        fig.update_layout(margin={"t": 70, "r": 46, "b": 62, "l": 74})


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data_lake/default", type=Path)
    ap.add_argument("--out", default="docs/assets/gallery", type=Path)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

    # Curated showcase cells: clean NMC622 cells with smooth, monotonic rate-
    # capability fade (31 cycles each) — the classic sloping discharge curves and
    # multi-peak dQ/dV read clearly. CEL-258 is the primary single-cell showcase.
    FEATURED = ["CEL-258-NMC622-Graphite", "CEL-109-NMC622-Graphite",
                "CEL-111-NMC622-Graphite", "CEL-85-NMC622-Graphite"]
    # Cathode active-material mass (g), from the project metadata ("Active material"
    # column). Enables specific capacity (mAh/g) in the rate-performance plot.
    MASS_G = {
        "CEL-258-NMC622-Graphite": 0.037105,
        "CEL-109-NMC622-Graphite": 0.037105,
        "CEL-111-NMC622-Graphite": 0.037008,
        "CEL-85-NMC622-Graphite": 0.036912,
    }
    cells = [
        cellseer.load(
            pd.read_parquet(args.data_dir / name / "cycling.parquet"),
            label=name,
            cathode_mass_g=MASS_G.get(name),
        )
        for name in FEATURED
        if (args.data_dir / name / "cycling.parquet").exists()
    ]
    if not cells:
        cells = load_cells(args.data_dir, "CEL-*", 4)
    if not cells:
        print("no data lake found — using synthetic data")
        cells = [synthetic_cell()]
    one = cells[0]

    entries = [
        {
            "name": "gcd",
            "title": "GCD — voltage vs capacity",
            "desc": "Galvanostatic charge–discharge curves, one trace per cycle.",
            "code": "import cellseer\ncell = cellseer.load(df, label=\"CEL-1\")\nfig = cellseer.gcd_plot(cell, show_lines=True)",
            "fig": lambda: cellseer.gcd_plot(one, show_lines=True),
        },
        {
            "name": "gcd_multi",
            "title": "GCD — multi-cell comparison",
            "desc": "Replicate cells overlaid; labels carry through to the legend.",
            "code": "cells = [cellseer.load(df, label=name)\n         for name, df in my_cells.items()]\nfig = cellseer.gcd_plot(cells, cycles=[2], show_lines=True)",
            "fig": lambda: cellseer.gcd_plot(cells, cycles=[2], show_lines=True),
        },
        {
            "name": "dqdv",
            "title": "Incremental capacity (dQ/dV)",
            "desc": "Phase-transition peaks vs voltage, per cycle.",
            "code": "fig = cellseer.dqdv_plot(cell, mode=\"2d\")",
            "fig": lambda: cellseer.dqdv_plot(one, mode="2d"),
        },
        {
            "name": "dvdq",
            "title": "Differential voltage (dV/dQ)",
            "desc": "Electrode-balance features vs capacity, per cycle.",
            "code": "fig = cellseer.dvdq_plot(cell, mode=\"2d\", view=\"highlight\",\n                        baseline_cycles=[2, 9, 17])",
            "fig": lambda: cellseer.dvdq_plot(one, mode="2d", view="highlight", baseline_cycles=[2, 9, 17]),
        },
        {
            "name": "voltage_time",
            "title": "Voltage vs time",
            "desc": "Raw protocol trace for the first cycles — formation checks.",
            "code": "fig = cellseer.voltage_time_plot(cell)",
            "fig": lambda: cellseer.voltage_time_plot(one),
        },
        {
            "name": "rate",
            "title": "Rate performance",
            "desc": "Per-cycle specific discharge capacity (mAh g⁻¹) with C-rate segmentation.",
            "code": "cell = cellseer.load(df, label=\"CEL-1\", cathode_mass_g=0.0371)\nfig = cellseer.rate_plot(cell, use_specific_capacity=True)",
            "fig": lambda: cellseer.rate_plot(one, use_specific_capacity=True),
        },
    ]

    manifest = []
    for e in entries:
        try:
            fig = e["fig"]()
        except Exception as exc:
            print(f"skip {e['name']}: {exc}")
            continue
        _apply_showcase_style(fig, e["title"])
        png = args.out / f"{e['name']}.png"
        fig.write_image(png, width=THUMB_W, height=THUMB_H, scale=THUMB_SCALE)
        manifest.append({k: e[k] for k in ("name", "title", "desc", "code")})
        print("wrote", png)

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"gallery: {len(manifest)} figures")


if __name__ == "__main__":
    main()
