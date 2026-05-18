"""
filters/cycle.py — Cycle: one charge–discharge cycle within a Protocol.

Hierarchy
---------
CyclingData
  └── Protocol
        └── Cycle   ← you are here
              └── .charge() / .discharge() / .rest()  → CyclingData

Zeroed columns added on construction
-------------------------------------
  - Cycle Time [s]      : elapsed seconds reset to 0 at cycle start
  - Cycle Capacity [Ah] : cumulative capacity reset to 0 at cycle start

Example
-------
>>> cycle     = rate_test.cycle(1)
>>> discharge = cycle.discharge()
>>> t, v = discharge.get("Cycle Time [s]", "Voltage [V]")
"""
from __future__ import annotations

import polars as pl

from cellseer.data.cycling_data import CyclingData


class Cycle(CyclingData):
    """
    One charge–discharge cycle.
    Created by Protocol.cycle() or CyclingData.cycle().
    """

    def model_post_init(self, __context) -> None:
        schema = self.lf.collect_schema().names()
        lf = self.lf

        if "Cycle Time [s]" not in schema:
            lf = lf.with_columns(
                (pl.col("Time [s]") - pl.col("Time [s]").first())
                .alias("Cycle Time [s]")
            )
        if "Cycle Capacity [Ah]" not in schema and "Capacity [Ah]" in schema:
            lf = lf.with_columns(
                (pl.col("Capacity [Ah]") - pl.col("Capacity [Ah]").first())
                .alias("Cycle Capacity [Ah]")
            )

        object.__setattr__(self, "lf", lf)

    # ------------------------------------------------------------------
    # Navigation — all return Step (leaf of the hierarchy)
    # ------------------------------------------------------------------

    def _to_step(self, mask: pl.Expr) -> "Step":
        from cellseer.filters.step import Step
        return Step(
            lf=self.lf.filter(mask),
            info=self.info.copy(),
            column_definitions=self.column_definitions.copy(),
        )

    def charge(self, *step_indices: int) -> "Step":
        """Rows where Current [A] > threshold (charging)."""
        thr = self._current_threshold()
        mask = pl.col("Current [A]") > thr
        if step_indices:
            mask = mask & self._filter_by_event(step_indices)
        return self._to_step(mask)

    def discharge(self, *step_indices: int) -> "Step":
        """Rows where Current [A] < -threshold (discharging)."""
        thr = self._current_threshold()
        mask = pl.col("Current [A]") < -thr
        if step_indices:
            mask = mask & self._filter_by_event(step_indices)
        return self._to_step(mask)

    def rest(self, *step_indices: int) -> "Step":
        """Rows where |Current [A]| <= threshold (rest / OCV)."""
        thr = self._current_threshold()
        mask = pl.col("Current [A]").abs() <= thr
        if step_indices:
            mask = mask & self._filter_by_event(step_indices)
        return self._to_step(mask)

    def step(self, *step_indices: int) -> "Step":
        """Filter to a specific step by 0-based index."""
        return self._to_step(self._filter_by_event(step_indices))

    def __repr__(self) -> str:
        return f"Cycle(cell={self.info.get('cell_id', '?')})"
