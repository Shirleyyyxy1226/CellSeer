"""
Project — top-level container for a collection of cells.

A Project represents one experimental campaign (e.g. "250-cell coin-cell
study Q1-2025"). It holds many Cell objects and provides batch operations.

Usage
-----
# Build from the existing metadata Excel
project = Project.from_metadata_file("data/metadata/CoinCellAssemble_250Plan.xlsx")

# Add cycling data to all cells that have a Neware file in the DB
for cell in project.cells.values():
    files = db.get_neware_files(cell.id_no)
    if files:
        cell.import_neware("cycling", files)

# Persist everything
project.save(db_backend)

# Load later
project = Project.load(db_backend, "Q1-2025")
"""
from __future__ import annotations

from pathlib import Path
from typing import TYPE_CHECKING, Dict, Iterator, List, Optional, Union

from pydantic import BaseModel, ConfigDict

from cellseer.cell import Cell
from cellseer.metadata import CellMetadata

if TYPE_CHECKING:
    from cellseer.db.base import DBBackend


class Project(BaseModel):
    """Collection of Cell objects for one experimental campaign."""

    name: str
    description: Optional[str] = None
    cells: Dict[str, Cell] = {}   # keyed by cell_id

    model_config = ConfigDict(arbitrary_types_allowed=True)

    # ------------------------------------------------------------------
    # Cell management
    # ------------------------------------------------------------------

    def add_cell(self, cell: Cell) -> "Project":
        """Add a cell. Returns self for chaining."""
        self.cells[cell.cell_id] = cell
        return self

    def get_cell(self, cell_id: str) -> Cell:
        if cell_id not in self.cells:
            raise KeyError(f"Cell {cell_id!r} not found in project {self.name!r}.")
        return self.cells[cell_id]

    def __iter__(self) -> Iterator[Cell]:
        return iter(self.cells.values())

    def __len__(self) -> int:
        return len(self.cells)

    def __getitem__(self, cell_id: str) -> Cell:
        return self.get_cell(cell_id)

    # ------------------------------------------------------------------
    # Factory: load from metadata file (Excel or CSV)
    # ------------------------------------------------------------------

    @classmethod
    def from_metadata_file(
        cls,
        path: Union[str, Path],
        project_name: Optional[str] = None,
        sheet_name: Optional[str] = None,
    ) -> "Project":
        """
        Build a Project (cells without datasets) from a metadata Excel or CSV.

        Each row becomes a Cell with a CellMetadata.
        The Cell_ID column is used as the key; rows without Cell_ID are skipped.

        Supports the existing CoinCellAssemble Excel format used in CellSeer.
        """
        path = Path(path)
        name = project_name or path.stem

        if path.suffix.lower() in (".xlsx", ".xls"):
            rows = _read_excel(path, sheet_name)
        elif path.suffix.lower() == ".csv":
            rows = _read_csv(path)
        else:
            raise ValueError(f"Unsupported metadata file format: {path.suffix}")

        project = cls(name=name)
        for row in rows:
            cell_id = str(row.get("Cell_ID") or "").strip()
            if not cell_id:
                continue
            try:
                meta = CellMetadata.from_dict(row)
                project.add_cell(Cell(metadata=meta))
            except Exception:
                # Skip rows that fail validation (e.g. header rows, empty rows)
                pass

        return project

    # ------------------------------------------------------------------
    # Batch dataset loading
    # ------------------------------------------------------------------

    def import_neware_from_db(
        self,
        backend: "DBBackend",
        dataset_name: str = "cycling",
        use_pyprobe: bool = True,
    ) -> "Project":
        """
        For every cell in this project that has Neware files registered in
        the DB, load those files as a cycling dataset.
        Cells without Neware files are silently skipped.
        """
        for cell in self:
            if cell.id_no is None:
                continue
            files = backend.get_neware_files(cell.id_no)
            if files:
                cell.import_neware(dataset_name, files, use_pyprobe=use_pyprobe)
        return self

    # ------------------------------------------------------------------
    # Persistence
    # ------------------------------------------------------------------

    def save(self, backend: "DBBackend") -> None:
        """Upsert all cells into the DB and write their Parquet sidecars."""
        for cell in self:
            cell.save(backend)

    @classmethod
    def load(cls, backend: "DBBackend", project_name: str) -> "Project":
        """Restore a Project and all its cells from the DB."""
        return backend.load_project(project_name)

    # ------------------------------------------------------------------
    # Filtering / selection helpers
    # ------------------------------------------------------------------

    def select(self, **kwargs) -> List[Cell]:
        """
        Filter cells by metadata fields.
        e.g. project.select(cathode="NMC811", batch=1)
        Returns a list (not a new Project) to keep it lightweight.
        """
        results = []
        for cell in self:
            match = all(
                getattr(cell.metadata, k, None) == v for k, v in kwargs.items()
            )
            if match:
                results.append(cell)
        return results

    def __repr__(self) -> str:
        return f"Project(name={self.name!r}, n_cells={len(self)})"


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _read_excel(path: Path, sheet_name: Optional[str]) -> List[Dict]:
    try:
        import polars as pl
        kwargs = {"sheet_name": sheet_name} if sheet_name else {}
        df = pl.read_excel(path, **kwargs)
        return df.to_dicts()
    except Exception:
        # Fall back to openpyxl via pandas
        import pandas as pd
        kwargs = {"sheet_name": sheet_name or 0}
        df = pd.read_excel(path, **kwargs)
        return df.where(df.notna(), None).to_dict(orient="records")


def _read_csv(path: Path) -> List[Dict]:
    try:
        import polars as pl
        return pl.read_csv(path).to_dicts()
    except Exception:
        import pandas as pd
        df = pd.read_csv(path)
        return df.where(df.notna(), None).to_dict(orient="records")
