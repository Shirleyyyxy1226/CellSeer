"""
BaseReader — abstract base class for all CellSeer data readers.

A reader is responsible for:
1. Locating and reading one or more source files.
2. Normalising columns to the CellSeer standard naming / units.
3. Returning a RawData (or subclass) with a lazy Polars LazyFrame.

Concrete readers inherit BaseReader and implement `read()`.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import List, Union

from pydantic import BaseModel, ConfigDict

from cellseer.data.rawdata import RawData


class BaseReader(BaseModel, ABC):
    """
    Abstract reader. Pydantic BaseModel so constructor kwargs are validated.

    Parameters
    ----------
    input_paths : list of Path
        Source file(s). Passed as a list to support multi-file cells
        (e.g. continuation files for a single Neware test).
    info : dict
        Provenance metadata attached to the returned RawData.info.
    """

    input_paths: List[Path]
    info: dict = {}

    model_config = ConfigDict(arbitrary_types_allowed=True)

    # Allow a single path to be passed as a convenience
    def __init__(self, input_paths: Union[Path, str, List[Union[Path, str]]], **kwargs):
        if not isinstance(input_paths, list):
            input_paths = [input_paths]
        super().__init__(input_paths=[Path(p) for p in input_paths], **kwargs)

    @abstractmethod
    def read(self) -> RawData:
        """Parse source files and return a validated RawData object."""
        ...

    def _validate_paths(self) -> None:
        for p in self.input_paths:
            if not p.exists():
                raise FileNotFoundError(f"Input file not found: {p}")
