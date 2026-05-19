"""
MetadataReader — reads cell metadata spreadsheets (Excel / CSV).

Mirrors the cycling reader pattern: construct with file path(s), then call
``.inspect()`` for upload UI diagnostics or ``.read_rows()`` / ``.read_cells()``
for parsed data.
"""
from __future__ import annotations

from pathlib import Path
from typing import Any, Dict, List, Optional, Union

from pydantic import BaseModel, ConfigDict, Field

from cellseer.analysis.metadata import CellMetadata
from cellseer.readers.metadata.inspect import DISPLAY_NAME_TEMPLATE, inspect_metadata_file

SUPPORTED_EXTENSIONS = (".csv", ".xlsx", ".xls")


class MetadataReader(BaseModel):
    """
    Read one metadata spreadsheet (.xlsx, .xls, or .csv).

    Parameters
    ----------
    input_paths : path or list of paths
        Typically a single metadata file.
    sheet_name : str, optional
        Excel sheet to prefer when inspecting workbooks.
    primary_key_header : str, optional
        Column used as the cell primary key (e.g. ``Cell name``).
    id_no_header : str, optional
        Numeric link-key column matched to cycling filenames.
    display_name_template : str
        Template for generated display names when ingesting rows.
    info : dict
        Provenance metadata (attached to nothing by default; for parity with cycling readers).
    """

    input_paths: List[Path]
    sheet_name: Optional[str] = None
    primary_key_header: Optional[str] = None
    id_no_header: Optional[str] = None
    display_name_template: str = DISPLAY_NAME_TEMPLATE
    info: dict = Field(default_factory=dict)

    model_config = ConfigDict(arbitrary_types_allowed=True)

    def __init__(
        self,
        input_paths: Union[Path, str, List[Union[Path, str]]],
        **kwargs,
    ):
        if not isinstance(input_paths, list):
            input_paths = [input_paths]
        super().__init__(input_paths=[Path(p) for p in input_paths], **kwargs)

    @property
    def filepath(self) -> Path:
        """Primary metadata file (first path)."""
        return self.input_paths[0]

    def _validate_paths(self) -> None:
        for p in self.input_paths:
            if not p.exists():
                raise FileNotFoundError(f"Input file not found: {p}")
        suffix = self.filepath.suffix.lower()
        if suffix not in SUPPORTED_EXTENSIONS:
            raise ValueError(
                f"Unsupported metadata file format: {suffix!r}. "
                f"Expected one of {', '.join(SUPPORTED_EXTENSIONS)}."
            )

    def inspect(self) -> Dict[str, Any]:
        """Return rows plus key-column candidates (for upload UI / ingest validation)."""
        self._validate_paths()
        return inspect_metadata_file(
            self.filepath,
            preferred_sheet=self.sheet_name,
            preferred_primary_key=self.primary_key_header,
            preferred_id_no=self.id_no_header,
        )

    def read_rows(self) -> List[Dict[str, Any]]:
        """Parse spreadsheet rows using header detection."""
        return self.inspect().get("rows", [])

    def read_cells(self) -> List[CellMetadata]:
        """Parse rows and normalize each to a :class:`CellMetadata` instance."""
        parsed = self.inspect()
        rows = parsed.get("rows", [])
        id_no_header = self.id_no_header or parsed.get("default_id_no_header")
        cells: List[CellMetadata] = []
        for row in rows:
            try:
                cells.append(
                    CellMetadata.from_dict(
                        row,
                        primary_key_header=self.primary_key_header,
                        id_no_header=id_no_header,
                        display_name_template=self.display_name_template,
                    )
                )
            except Exception:
                continue
        return cells
