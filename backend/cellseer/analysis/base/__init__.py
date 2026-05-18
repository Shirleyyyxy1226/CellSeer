"""
analysis/base/ — Pure numerical algorithms (no CellSeer type dependencies).

All functions here take and return plain numpy arrays / scalars.
They are the numerical core called by the user-facing analysis functions.

numerical.py  — general-purpose numerical utilities
"""
from cellseer.analysis.base.numerical import smooth, interpolate_uniform

__all__ = ["smooth", "interpolate_uniform"]
