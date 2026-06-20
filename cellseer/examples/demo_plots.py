#!/usr/bin/env python3
from __future__ import annotations

import argparse
from pathlib import Path

import pandas as pd

from cellseer import (
    dqdv_dashboard,
    dqdv_plot,
    dvdq_dashboard,
    dvdq_plot,
    gcd_dashboard,
    gcd_plot,
    rate_dashboard,
    rate_plot,
)


def synthetic_df() -> pd.DataFrame:
    """Synthetic three-cycle dataset with explicit charge then discharge segments.

    Same baseline data works for dQ/dV / dV/dQ / GCD / Rate demos since all
    callers need (cycle, V, Q, I) per row.
    """
    rows: list[dict[str, float | int]] = []
    for cycle in (1, 2, 3):
        for i in range(80):
            v = 3.0 + i * 0.015
            q = i * 0.0008 + cycle * 0.0001
            rows.append(
                {
                    "Cycle": cycle,
                    "Voltage [V]": v,
                    "Capacity [Ah]": q,
                    "Current [A]": 0.2,
                    "Time [s]": i,
                }
            )
        for i in range(80):
            v = 4.2 - i * 0.015
            q = i * 0.0008 + cycle * 0.0001
            rows.append(
                {
                    "Cycle": cycle,
                    "Voltage [V]": v,
                    "Capacity [Ah]": q,
                    "Current [A]": -0.2,
                    "Time [s]": 80 + i,
                }
            )
    return pd.DataFrame(rows)


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        description="Quick demo runner for cellseer plot / dashboard callables.",
    )
    parser.add_argument(
        "--plot",
        choices=["dqdv", "dvdq", "gcd", "rate"],
        default="dqdv",
        help="Which plot/dashboard to demonstrate.",
    )
    parser.add_argument(
        "--input",
        type=Path,
        default=None,
        help="Path to .csv/.xlsx input. If omitted, synthetic sample data is used.",
    )
    parser.add_argument(
        "--mode",
        choices=["3d", "2d", "scatter", "cumulative"],
        default=None,
        help=(
            "Figure mode (dQ/dV and dV/dQ use 3d|2d; GCD uses scatter|cumulative; "
            "Rate ignores this flag)."
        ),
    )
    parser.add_argument(
        "--dashboard",
        action="store_true",
        help="Use the *_dashboard composed figure instead of the single plot.",
    )
    parser.add_argument(
        "--direction",
        choices=["discharge", "charge"],
        default="discharge",
        help="Current direction for extraction.",
    )
    parser.add_argument(
        "--cycler",
        choices=[
            "auto",
            "neware",
            "biologic",
            "biologic_MB",
            "arbin",
            "basytec",
            "maccor",
            "novonix",
            "generic",
        ],
        default="auto",
        help="Cycler manufacturer format for file inputs.",
    )
    parser.add_argument(
        "--serve",
        action="store_true",
        help="When --dashboard is set, run a Dash app instead of returning a figure.",
    )
    parser.add_argument(
        "--port",
        type=int,
        default=8050,
        help="Dash server port (used with --dashboard --serve).",
    )
    parser.add_argument(
        "--show-lines",
        action="store_true",
        help="Connect points with lines (GCD / Rate).",
    )
    return parser.parse_args()


def _dqdv(args: argparse.Namespace, data) -> None:
    mode = args.mode or "3d"
    if args.dashboard:
        result = dqdv_dashboard(
            data, serve=args.serve, port=args.port,
            direction=args.direction, cycler=args.cycler,
        )
        if not args.serve:
            result.show()
        else:
            print(f"Dash app running on http://localhost:{args.port}")
        return
    fig = dqdv_plot(data, mode=mode, direction=args.direction, cycler=args.cycler)
    fig.show()


def _dvdq(args: argparse.Namespace, data) -> None:
    mode = args.mode or "3d"
    if args.dashboard:
        result = dvdq_dashboard(
            data, serve=args.serve, port=args.port,
            direction=args.direction, cycler=args.cycler,
        )
        if not args.serve:
            result.show()
        else:
            print(f"Dash app running on http://localhost:{args.port}")
        return
    fig = dvdq_plot(data, mode=mode, direction=args.direction, cycler=args.cycler)
    fig.show()


def _gcd(args: argparse.Namespace, data) -> None:
    mode = args.mode if args.mode in ("scatter", "cumulative") else "scatter"
    if args.dashboard:
        result = gcd_dashboard(
            data, serve=args.serve, port=args.port,
            direction=args.direction, cycler=args.cycler,
        )
        if not args.serve:
            result.show()
        else:
            print(f"Dash app running on http://localhost:{args.port}")
        return
    fig = gcd_plot(
        data, mode=mode, direction=args.direction, cycler=args.cycler,
        show_lines=args.show_lines,
    )
    fig.show()


def _rate(args: argparse.Namespace, data) -> None:
    if args.dashboard:
        result = rate_dashboard(
            data, serve=args.serve, port=args.port,
            direction=args.direction, cycler=args.cycler,
            show_connected_line=args.show_lines,
        )
        if not args.serve:
            result.show()
        else:
            print(f"Dash app running on http://localhost:{args.port}")
        return
    fig = rate_plot(
        data, direction=args.direction, cycler=args.cycler,
        show_connected_line=args.show_lines,
    )
    fig.show()


def main() -> None:
    args = parse_args()
    data = str(args.input) if args.input else synthetic_df()
    dispatch = {"dqdv": _dqdv, "dvdq": _dvdq, "gcd": _gcd, "rate": _rate}
    dispatch[args.plot](args, data)
    print(
        f"Displayed {args.plot} "
        f"{'dashboard' if args.dashboard else 'plot'} "
        f"({args.direction}, cycler={args.cycler})."
    )


if __name__ == "__main__":
    main()
