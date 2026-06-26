"""
ArbinReader — reads Arbin export files via PyProBE.

Passes ``cycler="arbin_res"`` to ``process_cycler_data``.

Multiple files are concatenated with Cycle numbers re-indexed monotonically.
"""
from __future__ import annotations

from pathlib import Path

from compute.readers.cycling.cycler_reader import CyclerReader


class ArbinReader(CyclerReader):
    """Read one or more Arbin export files for a single cell."""

    def _cycler_name_for(self, fp: Path) -> str:  # noqa: ARG002
        return "arbin_res"
