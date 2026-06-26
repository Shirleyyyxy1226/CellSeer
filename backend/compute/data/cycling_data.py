"""
CyclingData — RawData subclass for galvanostatic cycling measurements.

Required columns (standard CellSeer naming):
    Time [s], Step, Event, Current [A], Voltage [V], Capacity [Ah]

Optional but expected for cycle-level filtering:
    Cycle   (integer, added by readers when available)

Navigation hierarchy
--------------------
CyclingData
  └── .annotate(Protocol([{"cycleStart":1,"cycleEnd":3,"cRate":0.1}]))  → CyclingData (+C-rate column)
        └── .cycle(*cycle_numbers)                    → Cycle
              └── .charge() / .discharge() / .rest()  → Step

All filter methods return a new lazy CyclingData slice — no data is
collected until .data or .collect() is called.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, ClassVar, List, Optional, Tuple

import polars as pl

from compute.data.rawdata import RawData

if TYPE_CHECKING:
    from compute.data.protocol import Protocol


class CyclingData(RawData):
    """Cycling time-series data with hierarchical slice filters."""

    protocol: Optional["Protocol"] = None

    REQUIRED_COLUMNS: ClassVar[List[str]] = [
        "Time [s]",
        "Step",
        "Event",
        "Current [A]",
        "Voltage [V]",
        "Capacity [Ah]",
    ]

    # ------------------------------------------------------------------
    # Properties
    # ------------------------------------------------------------------

    @property
    def capacity(self) -> float:
        """Net capacity passed in this slice: abs(max - min) of Capacity [Ah]."""
        stats = self.lf.select(
            pl.col("Capacity [Ah]").max().alias("mx"),
            pl.col("Capacity [Ah]").min().alias("mn"),
        ).collect()
        return abs(float(stats["mx"][0]) - float(stats["mn"][0]))

    @property
    def has_cycle_column(self) -> bool:
        return "Cycle" in self.lf.collect_schema().names()

    # ------------------------------------------------------------------
    # Core filter helpers
    # ------------------------------------------------------------------

    def _slice(self, mask: pl.Expr) -> "CyclingData":
        """Return a new CyclingData filtered by a boolean Polars expression."""
        return CyclingData(
            lf=self.lf.filter(mask),
            info=self.info.copy(),
            column_definitions=self.column_definitions.copy(),
            protocol=self.protocol,
        )

    def _current_threshold(self) -> float:
        """1/10 000 of |max current|, used to distinguish charge/discharge/rest."""
        max_i = self.lf.select(pl.col("Current [A]").abs().max()).collect().item()
        return float(max_i) / 1e4 if max_i else 1e-9

    def _filter_by_event(self, event_indices: Tuple[int, ...]) -> pl.Expr:
        """
        Converts 0-based Python indices to the 1-based dense Event ranks
        present in the data, then builds a filter expression.
        Negative indices count from the tail (Python convention).
        """
        distinct = (
            self.lf.select(pl.col("Event").unique().sort())
            .collect()["Event"]
            .to_list()
        )
        n = len(distinct)
        resolved = []
        for idx in event_indices:
            if idx < 0:
                idx = n + idx
            if 0 <= idx < n:
                resolved.append(distinct[idx])
        if not resolved:
            return pl.lit(False)
        return pl.col("Event").is_in(resolved)

    # ------------------------------------------------------------------
    # Public filter methods
    # ------------------------------------------------------------------

    def cycle(self, *cycle_numbers: int) -> "CyclingData":
        """
        Filter to specific cycle numbers.
        Requires a `Cycle` column (added by readers that support it).
        """
        if not self.has_cycle_column:
            raise ValueError(
                "No 'Cycle' column found. The reader must add cycle information "
                "or you can add it manually with .with_cycle_column()."
            )
        return self._slice(pl.col("Cycle").is_in(list(cycle_numbers)))

    def step(self, *step_indices: int) -> "CyclingData":
        """Filter to specific step events (0-based Python indexing)."""
        return self._slice(self._filter_by_event(step_indices))

    def charge(self, *step_indices: int) -> "CyclingData":
        """Filter to charge steps (Current > threshold). Optionally restrict to specific step events."""
        thr = self._current_threshold()
        mask = pl.col("Current [A]") > thr
        if step_indices:
            mask = mask & self._filter_by_event(step_indices)
        return self._slice(mask)

    def discharge(self, *step_indices: int) -> "CyclingData":
        """Filter to discharge steps (Current < -threshold)."""
        thr = self._current_threshold()
        mask = pl.col("Current [A]") < -thr
        if step_indices:
            mask = mask & self._filter_by_event(step_indices)
        return self._slice(mask)

    def rest(self, *step_indices: int) -> "CyclingData":
        """Filter to rest steps (|Current| <= threshold)."""
        thr = self._current_threshold()
        mask = pl.col("Current [A]").abs() <= thr
        if step_indices:
            mask = mask & self._filter_by_event(step_indices)
        return self._slice(mask)

    def constant_current(self, *step_indices: int) -> "CyclingData":
        """Filter to rows where current is within 0.1% of the modal current value."""
        modal_i = (
            self.lf.select(pl.col("Current [A]").mode().first())
            .collect()
            .item()
        )
        tol = abs(float(modal_i)) * 0.001
        mask = (pl.col("Current [A]") - modal_i).abs() <= tol
        if step_indices:
            mask = mask & self._filter_by_event(step_indices)
        return self._slice(mask)

    # ------------------------------------------------------------------
    # SOC helpers
    # ------------------------------------------------------------------

    def set_soc(
        self,
        reference_capacity: Optional[float] = None,
    ) -> "CyclingData":
        """
        Add an `SOC` column.
        If reference_capacity is None, uses the max-min span of this slice.
        SOC = (Capacity [Ah] - min) / reference_capacity
        """
        if reference_capacity is None:
            stats = self.lf.select(
                pl.col("Capacity [Ah]").max().alias("mx"),
                pl.col("Capacity [Ah]").min().alias("mn"),
            ).collect()
            reference_capacity = abs(float(stats["mx"][0]) - float(stats["mn"][0]))
        if reference_capacity == 0:
            raise ValueError("reference_capacity is 0; cannot compute SOC.")
        lf = self.lf.with_columns(
            (
                (pl.col("Capacity [Ah]") - pl.col("Capacity [Ah]").min())
                / reference_capacity
            ).alias("SOC")
        )
        return CyclingData(
            lf=lf,
            info=self.info.copy(),
            column_definitions={
                **self.column_definitions,
                "SOC": "State of charge [0–1], referenced to provided or local capacity span.",
            },
            protocol=self.protocol,
        )

    # ------------------------------------------------------------------
    # Cycle column injection
    # ------------------------------------------------------------------

    # ------------------------------------------------------------------
    # Protocol annotation
    # ------------------------------------------------------------------

    def annotate(self, protocol: "Protocol") -> "CyclingData":
        """
        Add a "C-rate" column using a Protocol schedule.

        Each cycle number is looked up in the protocol's cycle map and
        tagged with its C-rate label. Cycles not covered by the protocol
        are labelled as null.

        Parameters
        ----------
        protocol : Protocol
            A Protocol instance describing the cycling schedule.

        Returns
        -------
        CyclingData
            New lazy slice with an additional "C-rate" (Float) column.

        Example
        -------
        >>> from compute.data.protocol import Protocol
        >>> p = Protocol([
        ...     {"cycleStart": 1, "cycleEnd": 3,  "cRate": 0.1},
        ...     {"cycleStart": 4, "cycleEnd": 10, "cRate": 0.5},
        ... ])
        >>> annotated = cycling.annotate(p)
        >>> annotated.data[["Cycle", "C-rate"]]
        """
        from compute.data.protocol import Protocol as _Protocol
        cycle_map = protocol.cycle_map  # {cycle_int: c_rate_float}
        mapping_expr = (
            pl.col("Cycle")
            .replace(cycle_map, default=None)
            .alias("C-rate")
        )
        return CyclingData(
            lf=self.lf.with_columns(mapping_expr),
            info=self.info.copy(),
            column_definitions={
                **self.column_definitions,
                "C-rate": "C-rate label from Protocol schedule (e.g. 'C/10', '1C').",
            },
            protocol=self.protocol,
        )

    def zero_column(self, source_col: str, new_col_name: str) -> "CyclingData":
        import polars as pl
        lf = self.lf.with_columns(
            (pl.col(source_col) - pl.col(source_col).first()).alias(new_col_name)
        )
        return CyclingData(
            lf=lf,
            info=self.info.copy(),
            column_definitions=self.column_definitions.copy(),
            protocol=self.protocol,
        )

    def with_cycle_column(self) -> "CyclingData":
        """
        Infer and attach a `Cycle` column from step decrements.
        A new cycle starts whenever Step decreases (simple heuristic).
        Use this when the reader could not provide cycle information.
        """
        lf = self.lf.with_columns(
            (
                (pl.col("Step").diff().fill_null(0) < 0)
                .cast(pl.Int32)
                .cum_sum()
                + 1
            ).alias("Cycle")
        )
        return CyclingData(
            lf=lf,
            info=self.info.copy(),
            column_definitions=self.column_definitions.copy(),
            protocol=self.protocol,
        )


from compute.data.protocol import Protocol

CyclingData.model_rebuild(_types_namespace={"Protocol": Protocol})
