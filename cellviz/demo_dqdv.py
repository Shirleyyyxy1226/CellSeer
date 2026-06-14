#!/usr/bin/env python3
"""Backward-compatible entry point - forwards to demo_plots.py.

Always runs the dQ/dV plot/dashboard. For other plot types, use demo_plots.py
directly with ``--plot {dqdv,dvdq,gcd,rate}``.
"""
from __future__ import annotations

import sys

from demo_plots import main as _main


def main() -> None:
    if "--plot" not in sys.argv:
        sys.argv = [sys.argv[0], "--plot", "dqdv", *sys.argv[1:]]
    _main()


if __name__ == "__main__":
    main()
