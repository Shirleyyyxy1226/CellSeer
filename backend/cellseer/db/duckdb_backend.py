"""
db/duckdb_backend.py — DuckDB implementation of DBBackend.

Storage model
-------------
Identical to SQLiteBackend:
- Cell metadata → `cell` table (one row per cell)
- Time-series data → `dataset` table as Parquet-encoded BLOBs
  (cell_id, name, data) — no files on disk, everything in one DB file

DuckDB advantage
----------------
The `query()` method exposes DuckDB's analytical SQL engine for cross-cell
queries.  DuckDB can also register Polars LazyFrames as virtual tables via
Arrow (zero-copy) for ad-hoc analysis without writing anything to disk.

    db = DuckDBBackend("cellseer.duckdb")
    db.query("SELECT cell_id, COUNT(*) FROM cell GROUP BY batch")
"""
from __future__ import annotations

import io
from pathlib import Path
from typing import TYPE_CHECKING, List, Optional

import polars as pl

from cellseer.db.base import DBBackend
from cellseer.db.schema import DUCKDB_DDL

if TYPE_CHECKING:
    from cellseer.cell import Cell
    from cellseer.project import Project


class DuckDBBackend(DBBackend):
    """
    DuckDB-backed persistence for CellSeer.

    Parameters
    ----------
    db_path : Path | str | None
        Path to a DuckDB file.  Pass None or ":memory:" for an in-memory DB.
        In-memory DBs are lost when the process exits.
    """

    def __init__(self, db_path: Optional[Path | str] = None) -> None:
        try:
            import duckdb
        except ImportError as exc:
            raise ImportError(
                "DuckDB is not installed. Run: pip install duckdb"
            ) from exc

        db_str = str(db_path) if db_path else ":memory:"
        self._conn = duckdb.connect(db_str)
        self._conn.execute(DUCKDB_DDL)

    # ------------------------------------------------------------------
    # DBBackend interface
    # ------------------------------------------------------------------

    def upsert_cell(self, cell: "Cell") -> None:
        """
        Write cell metadata and all datasets into DuckDB.

        Metadata goes to the `cell` table; each dataset is encoded as
        Parquet bytes and stored as a BLOB in the `dataset` table.
        No files are written to disk.
        """
        m = cell.metadata

        self._conn.execute(
            """
            INSERT OR REPLACE INTO cell (
                cell_id, id_no, batch, category, cathode, cathode_diameter_mm,
                anode, anode_diameter_mm, np_ratio, separator_type,
                separator_diameter_mm, electrolyte, electrolyte_volume_ul,
                spacer_mm, repeat, do_formation, do_ratetest, do_eis,
                anode_mass, cathode_mass, notes
            ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
            """,
            [
                m.cell_id, m.id_no, m.batch, m.category,
                m.cathode, m.cathode_diameter_mm,
                m.anode, m.anode_diameter_mm, m.np_ratio,
                m.separator_type, m.separator_diameter_mm,
                m.electrolyte, m.electrolyte_volume_ul,
                m.spacer_mm, m.repeat,
                m.do_formation, m.do_ratetest, m.do_eis,
                m.anode_mass_g, m.cathode_mass_g, m.notes,
            ],
        )

        import json as _json
        for name, raw in cell.datasets.items():
            buf = io.BytesIO()
            raw.collect().write_parquet(buf, compression="lz4")
            blob = buf.getvalue()
            from cellseer.data.cycling_data import CyclingData as _CD
            meta_json: Optional[str] = None
            if isinstance(raw, _CD) and raw.protocol is not None:
                meta_json = _json.dumps({"protocol": raw.protocol.to_list()})
            self._conn.execute(
                """
                INSERT OR REPLACE INTO dataset (cell_id, name, data, meta)
                VALUES (?, ?, ?, ?)
                """,
                [m.cell_id, name, blob, meta_json],
            )

    def load_cell(self, cell_id: str) -> "Cell":
        """
        Reconstruct a Cell from DuckDB.

        Metadata is read from `cell`; each dataset BLOB is decoded from
        Parquet bytes and wrapped in a LazyFrame.
        """
        from cellseer.cell import Cell
        from cellseer.data.cycling_data import CyclingData
        from cellseer.data.result import Result
        from cellseer.db.sqlite_backend import _row_to_metadata

        rows = self._conn.execute(
            "SELECT * FROM cell WHERE cell_id = ?", [cell_id]
        ).fetchdf()

        if rows.empty:
            raise KeyError(f"Cell {cell_id!r} not found in DuckDB.")

        meta = _row_to_metadata(rows.iloc[0].to_dict())
        cell = Cell(metadata=meta)

        ds_rows = self._conn.execute(
            "SELECT name, data, meta FROM dataset WHERE cell_id = ?", [cell_id]
        ).fetchall()

        from cellseer.db.sqlite_backend import _parse_protocol_meta
        for name, blob, meta_json in ds_rows:
            lf = pl.read_parquet(io.BytesIO(bytes(blob))).lazy()
            protocol = _parse_protocol_meta(meta_json)
            if name == "cycling":
                try:
                    cell.datasets[name] = CyclingData(lf=lf, info={"cell_id": cell_id}, protocol=protocol)
                except Exception:
                    cell.datasets[name] = Result(lf=lf, info={"cell_id": cell_id})
            else:
                cell.datasets[name] = Result(lf=lf, info={"cell_id": cell_id})

        return cell

    def list_cells(self) -> List[str]:
        return [
            r[0] for r in
            self._conn.execute("SELECT cell_id FROM cell ORDER BY cell_id").fetchall()
        ]

    def load_project(self, project_name: str) -> "Project":
        from cellseer.project import Project
        project = Project(name=project_name)
        for cell_id in self.list_cells():
            try:
                project.add_cell(self.load_cell(cell_id))
            except Exception:
                pass
        return project

    # ------------------------------------------------------------------
    # DuckDB-specific extras
    # ------------------------------------------------------------------

    def query(self, sql: str):
        """
        Run arbitrary SQL against the DuckDB database.

        Returns a pandas DataFrame.  Useful for cross-cell analytics:

            db.query("SELECT batch, AVG(np_ratio) FROM cell GROUP BY batch")
        """
        return self._conn.execute(sql).fetchdf()

    def register_frame(self, name: str, lf: "pl.LazyFrame") -> None:
        """
        Register a Polars LazyFrame as a virtual DuckDB table (zero-copy via Arrow).

            db.register_frame("my_cell", cell.datasets["cycling"].lf)
            db.query("SELECT * FROM my_cell WHERE Cycle = 3")
        """
        self._conn.register(name, lf.collect().to_arrow())

    def close(self) -> None:
        self._conn.close()

    def __enter__(self):
        return self

    def __exit__(self, *args):
        self.close()
