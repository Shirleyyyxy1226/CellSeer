"""
filters/base.py — Low-level numerical filter primitives shared by all filter classes.

Why a separate base module?
---------------------------
Shared slicing helpers used by analysis (e.g. ``cycle_summary``) and available
for custom pipelines. :class:`CyclingData` implements the user-facing filter API.

Key design
----------
All filter functions accept a `CyclingData` and return a new `CyclingData`.
Nothing is collected (no .collect() call) until the user asks for `.data`.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, List, Tuple

import polars as pl

if TYPE_CHECKING:
    from cellseer.data.cycling_data import CyclingData


def filter_by_event_indices(
    data: "CyclingData",
    event_indices: Tuple[int, ...],
) -> "CyclingData":
    """
    Filter rows to those belonging to specific Event groups.

    Parameters
    ----------
    data : CyclingData
        The source data.  Must have an `Event` column.
    event_indices : tuple of int
        0-based indices into the sorted list of unique Event values.
        Negative indices count from the end (Python convention).

    How it works
    ------------
    The Event column is a dense integer that increments every time Step
    changes. Unique events are sorted and indexed 0, 1, 2, … so that
    Python-style indexing (-1 = last step, 0 = first step) works naturally.
    """
    from cellseer.data.cycling_data import CyclingData

    distinct_events: List[int] = (
        data.lf
        .select(pl.col("Event").unique().sort())
        .collect()["Event"]
        .to_list()
    )
    n = len(distinct_events)
    resolved = []
    for idx in event_indices:
        if idx < 0:
            idx = n + idx
        if 0 <= idx < n:
            resolved.append(distinct_events[idx])

    if not resolved:
        # Return empty frame with same schema
        return CyclingData(
            lf=data.lf.filter(pl.lit(False)),
            info=data.info.copy(),
            column_definitions=data.column_definitions.copy(),
        )

    return CyclingData(
        lf=data.lf.filter(pl.col("Event").is_in(resolved)),
        info=data.info.copy(),
        column_definitions=data.column_definitions.copy(),
    )


def add_cycle_column(data: "CyclingData") -> "CyclingData":
    """
    Infer and attach a `Cycle` column based on step number decrements.

    A new cycle is assumed to start whenever the Step number decreases.
    This is a simple heuristic that works for most standard test protocols.
    If the reader already provided a Cycle column, this function is a no-op.

    Returns a new CyclingData with the Cycle column added.
    """
    from cellseer.data.cycling_data import CyclingData

    if "Cycle" in data.lf.collect_schema().names():
        return data  # already present

    lf = data.lf.with_columns(
        (
            (pl.col("Step").diff().fill_null(0) < 0)
            .cast(pl.Int32)
            .cum_sum()
            + 1
        ).alias("Cycle")
    )
    return CyclingData(
        lf=lf,
        info=data.info.copy(),
        column_definitions=data.column_definitions.copy(),
    )


def filter_by_cycles(
    data: "CyclingData",
    cycle_numbers: Tuple[int, ...],
) -> "CyclingData":
    """
    Filter to specific cycle numbers.
    Adds the Cycle column first if it is absent.
    """
    from cellseer.data.cycling_data import CyclingData

    data = add_cycle_column(data)
    return CyclingData(
        lf=data.lf.filter(pl.col("Cycle").is_in(list(cycle_numbers))),
        info=data.info.copy(),
        column_definitions=data.column_definitions.copy(),
    )


def filter_by_step_range(
    data: "CyclingData",
    step_start: int,
    step_end: int,
) -> "CyclingData":
    """
    Filter to rows where Step is in [step_start, step_end] (inclusive).
    Used by Procedure.experiment() to slice named experiment sections.
    """
    from cellseer.data.cycling_data import CyclingData

    return CyclingData(
        lf=data.lf.filter(
            (pl.col("Step") >= step_start) & (pl.col("Step") <= step_end)
        ),
        info=data.info.copy(),
        column_definitions=data.column_definitions.copy(),
    )
