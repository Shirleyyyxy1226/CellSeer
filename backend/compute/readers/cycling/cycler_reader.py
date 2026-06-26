"""
CyclerReader — abstract base for all PyProBE-backed cycler readers.

Subclasses implement two small methods:
    _cycler_name_for(fp)  → the PyProBE cycler string (e.g. "neware", "arbin_res")
    _extra_kwargs(fp)     → optional extra kwargs forwarded to process_cycler_data

The read() loop is owned here: temp Parquet per file → scan lazily →
re-index Cycle numbers monotonically across files → concat → CyclingData.
"""
from __future__ import annotations

import tempfile
from pathlib import Path
from typing import List, Tuple

import polars as pl

from compute.data.cycling_data import CyclingData
from compute.readers.base import BaseReader


def _raise_pyprobe_import_error(exc: Exception) -> None:
    try:
        import pyprobe  # type: ignore  # noqa: F401
        extra = (
            "Detected a 'pyprobe' module, but it does not expose the required "
            "PyProBE APIs (for example 'pyprobe.cell')."
        )
    except Exception:
        extra = "No compatible PyProBE module was found."
    raise ImportError(
        "PyProBE is required to read cycling data files. "
        f"{extra} Install or upgrade the correct package with: "
        "pip install -U PyProBE-Data"
    ) from exc


class CyclerReader(BaseReader):
    """PyProBE-backed base reader. Subclasses only need to supply the cycler name."""

    def read(self) -> CyclingData:
        self._validate_paths()
        try:
            from pyprobe.cell import process_cycler_data
        except ImportError as exc:
            _raise_pyprobe_import_error(exc)

        frames: List[pl.LazyFrame] = []
        cycle_offset = 0

        for fp in self.input_paths:
            with tempfile.NamedTemporaryFile(suffix=".parquet", delete=False) as tmp:
                out_path = tmp.name
            try:
                process_cycler_data(
                    cycler=self._cycler_name_for(fp),
                    input_data_path=str(fp),
                    output_data_path=out_path,
                    overwrite_existing=True,
                    **self._extra_kwargs(fp),
                )
                lf = pl.read_parquet(out_path).lazy()
            finally:
                Path(out_path).unlink(missing_ok=True)
            lf, cycle_offset = _reindex_cycles(lf, cycle_offset)
            frames.append(lf)

        combined = pl.concat(frames, how="diagonal") if len(frames) > 1 else frames[0]
        return CyclingData(
            lf=combined,
            info={
                "source_files": [str(p) for p in self.input_paths],
                "reader": self.__class__.__name__,
                **self.info,
            },
        )

    def _cycler_name_for(self, fp: Path) -> str:  # noqa: ARG002
        raise NotImplementedError

    def _extra_kwargs(self, fp: Path) -> dict:  # noqa: ARG002
        return {}


def _reindex_cycles(lf: pl.LazyFrame, offset: int) -> Tuple[pl.LazyFrame, int]:
    """Offset Cycle column by `offset` and return the new max cycle value."""
    schema = lf.collect_schema().names()
    if "Cycle" not in schema:
        return lf, offset
    if offset > 0:
        lf = lf.with_columns((pl.col("Cycle") + offset).alias("Cycle"))
    new_max = lf.select(pl.col("Cycle").max()).collect().item()
    return lf, int(new_max or offset)
