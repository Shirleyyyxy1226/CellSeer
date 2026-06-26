"""
analysis/cycling/summary.py — Per-cycle summary statistics.

`cycle_summary` is the primary cycling analysis function.
Given any CyclingData object (Procedure, Experiment, or plain CyclingData),
it returns a Result with one row per cycle containing:

  Cycle                   integer cycle index
  Charge Capacity [Ah]    max - min of Capacity during positive-current rows
  Discharge Capacity [Ah] max - min of Capacity during negative-current rows
  Coulombic Efficiency    Discharge / Charge capacity  (dimensionless, 0–1)
  Capacity Throughput [Ah] cumulative |ΔCapacity| (total Ah processed)
  SOH Charge [%]          Charge capacity / Cycle-1 Charge capacity × 100
  SOH Discharge [%]       Discharge capacity / Cycle-1 Discharge capacity × 100

All computations are done in Polars expressions so no data is collected
until the caller calls .data or .collect() on the returned Result.

Example
-------
>>> from compute.analysis.cycling import cycle_summary
>>> result = cycle_summary(my_cycling_data)
>>> df = result.data     # collects here
>>> df.head()
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import polars as pl

from compute.data.result import Result
from compute.filters.base import add_cycle_column

if TYPE_CHECKING:
    from compute.data.cycling_data import CyclingData


def cycle_summary(input_data: "CyclingData") -> Result:
    """
    Compute per-cycle summary statistics.

    Parameters
    ----------
    input_data : CyclingData
        Any CyclingData slice (Procedure, Experiment, Cycle, or raw CyclingData).
        Must have columns: Cycle (or Step for auto-inference), Current [A],
        Voltage [V], Capacity [Ah].

    Returns
    -------
    Result
        One row per cycle.  Columns described in module docstring.
    """
    # Ensure Cycle column exists
    data = add_cycle_column(input_data)
    thr = input_data._current_threshold()

    # Build the per-cycle aggregation as a single Polars expression group_by
    summary_lf = (
        data.lf
        # Tag each row as charge, discharge, or rest
        .with_columns([
            pl.when(pl.col("Current [A]") > thr)
              .then(pl.col("Capacity [Ah]"))
              .otherwise(None)
              .alias("_chg_cap"),
            pl.when(pl.col("Current [A]") < -thr)
              .then(pl.col("Capacity [Ah]"))
              .otherwise(None)
              .alias("_dch_cap"),
            pl.col("Capacity [Ah]").abs().diff().fill_null(0).alias("_abs_delta_q"),
        ])
        .group_by("Cycle")
        .agg([
            pl.col("Time [s]").first().alias("Time [s]"),
            (pl.col("_chg_cap").max() - pl.col("_chg_cap").min())
              .alias("Charge Capacity [Ah]"),
            (pl.col("_dch_cap").max() - pl.col("_dch_cap").min())
              .alias("Discharge Capacity [Ah]"),
            pl.col("_abs_delta_q").sum().alias("_throughput_increment"),
        ])
        .sort("Cycle")
        # Cumulative throughput across cycles
        .with_columns(
            pl.col("_throughput_increment").cum_sum().alias("Capacity Throughput [Ah]")
        )
        .drop("_throughput_increment")
        # Coulombic efficiency
        .with_columns(
            (pl.col("Discharge Capacity [Ah]") / pl.col("Charge Capacity [Ah]"))
            .alias("Coulombic Efficiency")
        )
        # SOH relative to cycle 1 (the first cycle)
        .with_columns([
            (pl.col("Charge Capacity [Ah]") / pl.col("Charge Capacity [Ah]").first() * 100)
              .alias("SOH Charge [%]"),
            (pl.col("Discharge Capacity [Ah]") / pl.col("Discharge Capacity [Ah]").first() * 100)
              .alias("SOH Discharge [%]"),
        ])
    )

    return Result(
        lf=summary_lf,
        info=input_data.info.copy(),
        column_definitions={
            "Cycle":                    "Cycle index (1-based)",
            "Charge Capacity [Ah]":     "Charge capacity per cycle [Amp-hours]",
            "Discharge Capacity [Ah]":  "Discharge capacity per cycle [Amp-hours]",
            "Coulombic Efficiency":     "Discharge / Charge capacity ratio [0–1]",
            "Capacity Throughput [Ah]": "Cumulative |ΔCapacity| since start [Amp-hours]",
            "SOH Charge [%]":           "Charge SOH relative to cycle 1 [%]",
            "SOH Discharge [%]":        "Discharge SOH relative to cycle 1 [%]",
        },
    )
