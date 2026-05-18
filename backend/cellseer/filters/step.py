"""
filters/step.py — Step: one continuous operating segment within a Cycle.

What is a Step?
---------------
A step is a single continuous period where the cycler runs one mode:
  - Constant Current Charge  (CC-C) : fixed positive current
  - Constant Voltage Charge  (CV-C) : voltage held, current tapers
  - Constant Current Discharge (CC-D): fixed negative current
  - Rest                             : zero current, voltage relaxes

A typical cycle has 3-5 steps. Step numbers come from the cycler and
increment whenever the operating mode changes.

Zeroed columns added on construction
--------------------------------------
  - Step Time [s]      : elapsed seconds reset to 0 at step start
  - Step Capacity [Ah] : cumulative capacity reset to 0 at step start

Hierarchy
---------
CyclingData
  └── Protocol
        └── Cycle
              └── Step   ← you are here (leaf)

Example
-------
>>> step = cycle.discharge()
>>> t, v = step.get("Step Time [s]", "Voltage [V]")
"""
from __future__ import annotations

import polars as pl

from cellseer.data.cycling_data import CyclingData


class Step(CyclingData):
    """
    One operating step — the leaf of the filter hierarchy.
    Created by Cycle.charge(), .discharge(), .rest(), or .step().
    """

    def model_post_init(self, __context) -> None:
        schema = self.lf.collect_schema().names()
        lf = self.lf

        if "Step Time [s]" not in schema:
            lf = lf.with_columns(
                (pl.col("Time [s]") - pl.col("Time [s]").first())
                .alias("Step Time [s]")
            )
        if "Step Capacity [Ah]" not in schema and "Capacity [Ah]" in schema:
            lf = lf.with_columns(
                (pl.col("Capacity [Ah]") - pl.col("Capacity [Ah]").first())
                .alias("Step Capacity [Ah]")
            )

        object.__setattr__(self, "lf", lf)

    def __repr__(self) -> str:
        return f"Step(cell={self.info.get('cell_id', '?')})"
