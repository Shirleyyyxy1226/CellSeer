"""
BiologicReader — reads BioLogic .mpt and .mpr files via PyProBE.

Extension → PyProBE cycler name mapping:
    .mpt  →  "biologic_mpt"  (EC-Lab ASCII export)
    .mpr  →  "biologic_mpr"  (EC-Lab binary)

Multiple files are concatenated with Cycle numbers re-indexed monotonically.
"""
from __future__ import annotations

from pathlib import Path

from cellseer.readers.cycling.cycler_reader import CyclerReader
from cellseer.utils import CellSeerReaderError

_EXT_MAP = {".mpr": "biologic_mpr", ".mpt": "biologic_mpt"}


class BiologicReader(CyclerReader):
    """Read one or more BioLogic .mpt/.mpr files for a single cell."""

    def _cycler_name_for(self, fp: Path) -> str:
        name = _EXT_MAP.get(fp.suffix.lower())
        if name is None:
            raise CellSeerReaderError(
                f"BiologicReader: unsupported extension '{fp.suffix}'. "
                "Use .mpt (EC-Lab ASCII export) or .mpr (binary) files."
            )
        return name
