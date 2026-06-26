"""
NewareReader — reads Neware .xlsx files via PyProBE.

Passes ``cycler="neware"`` to ``process_cycler_data`` and injects a
``CastAndRenameMap`` so "Cycle Index" is imported as the unsigned integer
"Cycle" column that CellSeer expects.

Multiple files are concatenated with Cycle numbers re-indexed monotonically.
"""
from __future__ import annotations

from pathlib import Path

import polars as pl

from compute.readers.cycling.cycler_reader import CyclerReader, _raise_pyprobe_import_error


class NewareReader(CyclerReader):
    """Read one or more Neware .xlsx files for a single cell."""

    def _cycler_name_for(self, fp: Path) -> str:  # noqa: ARG002
        return "neware"

    def _extra_kwargs(self, fp: Path) -> dict:  # noqa: ARG002
        try:
            from pyprobe.cyclers.column_maps import CastAndRenameMap
        except ImportError as exc:
            _raise_pyprobe_import_error(exc)
        return {
            "extra_column_importers": [
                CastAndRenameMap("Cycle", "Cycle Index", pl.UInt64),
            ]
        }
