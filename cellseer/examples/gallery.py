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


def main() -> None:
    ap = argparse.ArgumentParser()
    ap.add_argument("--data-dir", default="data_lake/default", type=Path)
    ap.add_argument("--out", default="docs/assets/gallery", type=Path)
    args = ap.parse_args()
    args.out.mkdir(parents=True, exist_ok=True)

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
            "code": "import cellseer\ncell = cellseer.load(df, label=\"CEL-1\")\nfig = cellseer.gcd_plot(cell)",
            "fig": lambda: cellseer.gcd_plot(one),
        },
        {
            "name": "gcd_multi",
            "title": "GCD — multi-cell comparison",
            "desc": "Replicate cells overlaid; labels carry through to the legend.",
            "code": "cells = [cellseer.load(df, label=name)\n         for name, df in my_cells.items()]\nfig = cellseer.gcd_plot(cells, cycles=[2])",
            "fig": lambda: cellseer.gcd_plot(cells, cycles=[2]),
        },
        {
            "name": "dqdv",
            "title": "Incremental capacity (dQ/dV)",
            "desc": "Phase-transition peaks vs voltage, per cycle.",
            "code": "fig = cellseer.dqdv_plot(cell)",
            "fig": lambda: cellseer.dqdv_plot(one),
        },
        {
            "name": "dvdq",
            "title": "Differential voltage (dV/dQ)",
            "desc": "Electrode-balance features vs capacity, per cycle.",
            "code": "fig = cellseer.dvdq_plot(cell)",
            "fig": lambda: cellseer.dvdq_plot(one),
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
            "desc": "Per-cycle discharge capacity with C-rate segmentation.",
            "code": "fig = cellseer.rate_plot(cell)",
            "fig": lambda: cellseer.rate_plot(one),
        },
    ]

    manifest = []
    for e in entries:
        try:
            fig = e["fig"]()
        except Exception as exc:
            print(f"skip {e['name']}: {exc}")
            continue
        png = args.out / f"{e['name']}.png"
        fig.write_image(png, width=THUMB_W, height=THUMB_H, scale=THUMB_SCALE)
        manifest.append({k: e[k] for k in ("name", "title", "desc", "code")})
        print("wrote", png)

    (args.out / "manifest.json").write_text(json.dumps(manifest, indent=2))
    print(f"gallery: {len(manifest)} figures")


if __name__ == "__main__":
    main()
