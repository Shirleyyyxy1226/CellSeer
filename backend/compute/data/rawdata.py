"""
RawData — Result subclass that enforces a required column schema.

Every concrete data type (CyclingData, EISData, PulseData, ...) inherits
from RawData and declares its own `REQUIRED_COLUMNS` class variable.
The schema contract is validated at construction time.
"""
from __future__ import annotations

from typing import ClassVar, List

from pydantic import model_validator

from compute.data.result import Result
from compute.utils import CellSeerValidationError


class RawData(Result):
    """
    Result with mandatory column validation.

    Subclasses set `REQUIRED_COLUMNS` at the class level. The validator
    runs on every instantiation and raises `CellSeerValidationError` if any
    required column is absent from the LazyFrame schema.
    """

    REQUIRED_COLUMNS: ClassVar[List[str]] = []

    @model_validator(mode="after")
    def _check_required_columns(self) -> "RawData":
        if not self.REQUIRED_COLUMNS:
            return self
        present = set(self.lf.collect_schema().names())
        missing = [c for c in self.REQUIRED_COLUMNS if c not in present]
        if missing:
            raise CellSeerValidationError(
                f"{self.__class__.__name__} is missing required columns: {missing}. "
                f"Present columns: {sorted(present)}"
            )
        return self

    # ------------------------------------------------------------------
    # Utility shared by all data types
    # ------------------------------------------------------------------

    def zero_column(self, source_col: str, new_col_name: str) -> "RawData":
        """
        Add a new column equal to source_col - source_col.first().
        Resets a cumulative quantity (time, capacity) to zero at the start
        of the current slice.
        """
        import polars as pl
        lf = self.lf.with_columns(
            (pl.col(source_col) - pl.col(source_col).first()).alias(new_col_name)
        )
        return self.__class__(
            lf=lf,
            info=self.info.copy(),
            column_definitions=self.column_definitions.copy(),
        )

    def __repr__(self) -> str:
        schema = self.lf.collect_schema()
        return (
            f"{self.__class__.__name__}("
            f"columns={schema.names()}, "
            f"info_keys={list(self.info.keys())})"
        )
