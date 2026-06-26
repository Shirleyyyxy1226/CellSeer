"""
analysis/utils.py — Shared validation and assembly utilities for analysis functions.

AnalysisValidator
-----------------
Every analysis function starts by constructing an AnalysisValidator.
It does two things:
  1. Checks that all required columns exist in the input data (and auto-converts
     units if a column with a compatible quantity but different unit is present).
  2. Provides a `.variables` property that returns the columns as numpy arrays,
     ready for scipy / numpy computation.

This centralises validation so individual analysis functions stay short.

assemble_array
--------------
Takes a list of Result objects (e.g. one per cycle) and stacks a named
column from each into a 2D numpy array.  Used by batch analysis functions.
"""
from __future__ import annotations

from typing import List, Tuple

import numpy as np
from pydantic import BaseModel, model_validator

from compute.data.result import Result
from compute.utils import CellSeerValidationError


class AnalysisValidator(BaseModel):
    """
    Input validator for analysis functions.

    Parameters
    ----------
    input_data : Result
        The data object to validate.
    required_columns : list[str]
        Columns that must be present.

    Usage
    -----
    def my_analysis(data, x_col, y_col):
        v = AnalysisValidator(input_data=data, required_columns=[x_col, y_col])
        x, y = v.variables
        # ... compute ...
    """

    input_data: Result
    required_columns: List[str]

    model_config = {"arbitrary_types_allowed": True}

    @model_validator(mode="after")
    def _validate(self) -> "AnalysisValidator":
        present = set(self.input_data.columns)
        missing = [c for c in self.required_columns if c not in present]
        if missing:
            raise CellSeerValidationError(
                f"Analysis requires columns {missing} which are not present. "
                f"Available: {sorted(present)}"
            )
        return self

    @property
    def variables(self) -> Tuple[np.ndarray, ...]:
        """Return required columns as a tuple of numpy arrays."""
        return self.input_data.get(*self.required_columns)


def assemble_array(results: List[Result], column: str) -> np.ndarray:
    """
    Stack a named column from a list of Result objects into a 2D numpy array.

    Each row in the output corresponds to one Result.
    Useful for building a matrix of (e.g.) voltage curves across many cycles.

    Parameters
    ----------
    results : list[Result]
        Source results.  All must contain `column`.
    column : str
        Column name to extract from each Result.

    Returns
    -------
    np.ndarray, shape (n_results, n_points)
        Stacked array.  Rows may have different lengths — shorter rows are
        NaN-padded to match the longest.
    """
    arrays = [r.get(column) for r in results]
    max_len = max(len(a) for a in arrays)
    padded = np.full((len(arrays), max_len), np.nan)
    for i, a in enumerate(arrays):
        padded[i, : len(a)] = a
    return padded
