"""
Result — the base lazy data container for the entire CellSeer library.

Design principles
-----------------
- `lf` is always a Polars LazyFrame. Data is never collected until the user
  calls `.data` or `.collect()`. This keeps memory usage minimal even when
  holding references to many cells.
- `info` is a free-form dict for dataset-level provenance (cell_id, dataset
  name, source file, ...).
- `column_definitions` stores human-readable descriptions of each column so
  the schema is self-documenting.
"""
from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

import polars as pl
from pydantic import BaseModel, ConfigDict, field_validator


class Result(BaseModel):
    """Lazy, schema-aware data container built on a Polars LazyFrame."""

    lf: pl.LazyFrame
    info: Dict[str, Any] = {}
    column_definitions: Dict[str, str] = {}

    model_config = ConfigDict(arbitrary_types_allowed=True)

    # ------------------------------------------------------------------
    # Core access
    # ------------------------------------------------------------------

    def collect(self) -> pl.DataFrame:
        """Materialise the LazyFrame. Result is cached back into lf."""
        df = self.lf.collect()
        # Replace lf with already-collected frame so repeated calls are free.
        object.__setattr__(self, "lf", df.lazy())
        return df

    @property
    def data(self) -> pl.DataFrame:
        """Materialise and return the DataFrame. Raises if empty."""
        df = self.collect()
        if df.is_empty():
            raise ValueError("Result contains no rows.")
        return df

    @property
    def columns(self) -> List[str]:
        """Column names without collecting."""
        return self.lf.collect_schema().names()

    # ------------------------------------------------------------------
    # Column helpers
    # ------------------------------------------------------------------

    def get(self, *column_names: str) -> tuple:
        """
        Return one or more columns as NumPy arrays.
        Raises KeyError for missing columns.
        """
        df = self.collect()
        missing = [c for c in column_names if c not in df.columns]
        if missing:
            raise KeyError(f"Columns not found: {missing}")
        arrays = tuple(df[c].to_numpy() for c in column_names)
        return arrays[0] if len(arrays) == 1 else arrays

    def define_column(self, name: str, definition: str) -> None:
        self.column_definitions[name] = definition

    def print_definitions(self) -> None:
        for col, defn in self.column_definitions.items():
            print(f"  {col}: {defn}")

    # ------------------------------------------------------------------
    # Composition
    # ------------------------------------------------------------------

    def clean_copy(
        self,
        lf: pl.LazyFrame,
        column_definitions: Optional[Dict[str, str]] = None,
    ) -> "Result":
        """Return a new Result sharing info but with a different LazyFrame."""
        return Result(
            lf=lf,
            info=self.info.copy(),
            column_definitions=column_definitions or self.column_definitions.copy(),
        )

    def join(
        self,
        other: "Result",
        on: Union[str, List[str]],
        how: str = "inner",
    ) -> "Result":
        joined_lf = self.lf.join(other.lf, on=on, how=how)
        merged_defs = {**self.column_definitions, **other.column_definitions}
        return Result(lf=joined_lf, info=self.info.copy(), column_definitions=merged_defs)

    def extend(self, *others: "Result") -> "Result":
        """Vertical concatenation."""
        frames = [self.lf] + [o.lf for o in others]
        merged_defs = dict(self.column_definitions)
        for o in others:
            merged_defs.update(o.column_definitions)
        return Result(
            lf=pl.concat(frames, how="diagonal"),
            info=self.info.copy(),
            column_definitions=merged_defs,
        )

    # ------------------------------------------------------------------
    # Export
    # ------------------------------------------------------------------

    def to_pandas(self):
        import pandas as pd
        return self.collect().to_pandas()

    def to_parquet(self, path: str, compression: str = "lz4") -> None:
        self.collect().write_parquet(path, compression=compression)

    # ------------------------------------------------------------------
    # Dunder
    # ------------------------------------------------------------------

    def __getitem__(self, column_names: Union[str, List[str]]) -> "Result":
        cols = [column_names] if isinstance(column_names, str) else column_names
        return self.clean_copy(self.lf.select(cols))

    def __repr__(self) -> str:
        schema = self.lf.collect_schema()
        return (
            f"Result(columns={schema.names()}, "
            f"info_keys={list(self.info.keys())})"
        )
