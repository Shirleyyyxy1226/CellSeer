"""
DBBackend — abstract interface for all CellSeer persistence backends.

All backend implementations (SQLite, DuckDB, …) must implement this interface.
The rest of the library only depends on this ABC — concrete backends are
interchangeable.
"""
from __future__ import annotations

from abc import ABC, abstractmethod
from pathlib import Path
from typing import TYPE_CHECKING, List, Optional

if TYPE_CHECKING:
    from cellseer.cell import Cell
    from cellseer.project import Project


class DBBackend(ABC):
    """Abstract persistence backend."""

    # ------------------------------------------------------------------
    # Cell-level operations
    # ------------------------------------------------------------------

    @abstractmethod
    def upsert_cell(self, cell: "Cell") -> None:
        """Insert or update a cell's metadata and datasets in the DB."""
        ...

    @abstractmethod
    def load_cell(self, cell_id: str) -> "Cell":
        """Reconstruct a Cell (metadata + lazy dataset references) from the DB."""
        ...

    @abstractmethod
    def list_cells(self) -> List[str]:
        """Return all cell_id values stored in the DB."""
        ...

    # ------------------------------------------------------------------
    # Project-level operations
    # ------------------------------------------------------------------

    @abstractmethod
    def load_project(self, project_name: str) -> "Project":
        """
        Load all cells belonging to a project.
        Datasets are attached lazily (LazyFrame pointing at Parquet files).
        """
        ...

    # ------------------------------------------------------------------
    # Optional audit-trail hook (backends may override)
    # ------------------------------------------------------------------

    def log_ingest(
        self,
        cell_id: str,
        filepaths: "List[Path]",
        cycler: "Optional[str]" = None,
        confidence: "Optional[float]" = None,
    ) -> None:
        """Append an ingest audit entry. No-op by default; backends may override."""
