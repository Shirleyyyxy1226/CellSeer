"""
PostgresBackend — PostgreSQL-backed DBBackend implementation.

Storage model
-------------
- Cell metadata → `cell` table (one row per cell, PK = (project_id, cell_id))
- Time-series data → Parquet files under data-lake storage, referenced by
  `dataset.storage_uri` and companion metadata columns.

Reading back is lazy: storage URI → pl.read_parquet(...).lazy()
"""
from __future__ import annotations

import json
import psycopg2
import psycopg2.extras
from pathlib import Path
from typing import TYPE_CHECKING, Dict, List, Optional

from compute.db.base import DBBackend
from compute.analysis.metadata import CellMetadata
from project_scope import DEFAULT_PROJECT_ID, ensure_project_exists, ensure_project_schema, normalize_project_id
from dataset_store import read_dataset_parquet, write_dataset_parquet

if TYPE_CHECKING:
    from compute.cell import Cell
    from compute.project import Project


def _adapt_sql(sql: str) -> str:
    return sql.replace("?", "%s").replace("datetime('now')", "NOW()")


class _PGConn:
    def __init__(self, pg_conn) -> None:
        self._conn = pg_conn

    def execute(self, sql: str, params=None):
        sql = _adapt_sql(sql)
        cur = self._conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
        cur.execute(sql, params if params is not None else ())
        return cur

    def commit(self) -> None:
        self._conn.commit()

    def rollback(self) -> None:
        self._conn.rollback()

    def close(self) -> None:
        self._conn.close()


class PostgresBackend(DBBackend):
    """
    DBBackend implementation backed by PostgreSQL (connection from DATABASE_URL).
    """

    def __init__(self, db_path: Path | str) -> None:
        # db_path is ignored — connection comes from DATABASE_URL in config
        self.db_path = Path(db_path)
        self.project_id = DEFAULT_PROJECT_ID
        self._ensure_schema()

    def set_project_scope(self, project_id: str) -> "PostgresBackend":
        self.project_id = normalize_project_id(project_id)
        conn = self._connect()
        ensure_project_exists(conn, self.project_id)
        conn.close()
        return self

    # ------------------------------------------------------------------
    # Schema management
    # ------------------------------------------------------------------

    def _connect(self) -> _PGConn:
        from config import DATABASE_URL
        return _PGConn(psycopg2.connect(DATABASE_URL))

    def _ensure_schema(self) -> None:
        conn = self._connect()
        ensure_project_schema(conn)
        ensure_project_exists(conn, self.project_id)
        conn.commit()
        conn.close()

    # ------------------------------------------------------------------
    # DBBackend interface
    # ------------------------------------------------------------------

    def upsert_cell(self, cell: "Cell") -> None:
        """
        Write cell metadata and all datasets into the DB.

        Metadata goes to the `cell` table; each dataset is written to Parquet
        in the configured data-lake storage and referenced in the `dataset` table.
        """
        m = cell.metadata
        pid = normalize_project_id(getattr(self, "project_id", DEFAULT_PROJECT_ID))
        # Source fields with no schema column (e.g. DIGIBAT supplier / testing
        # procedure) ride along in metadata.custom; persist them as JSON so they
        # survive and stay viewable. display_name is an internal derived key, not
        # source metadata, so it's excluded.
        extra_meta = {k: v for k, v in (m.custom or {}).items() if k != "display_name"}
        custom_meta_json = json.dumps(extra_meta, ensure_ascii=False) if extra_meta else None
        conn = self._connect()
        try:
            ensure_project_exists(conn, pid)

            # 1. Upsert metadata row
            conn.execute(
                """
                INSERT INTO cell (
                    project_id, cell_id, id_no, batch, category, cathode, cathode_diameter_mm,
                    anode, anode_diameter_mm, np_ratio, separator_type,
                    separator_diameter_mm, electrolyte, electrolyte_volume_ul,
                    spacer_mm, repeat, capacity_basis, do_formation, do_ratetest, do_eis,
                    anode_mass, cathode_mass, notes, custom_meta
                ) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
                ON CONFLICT(project_id, cell_id) DO UPDATE SET
                    id_no=excluded.id_no, batch=excluded.batch,
                    category=excluded.category, cathode=excluded.cathode,
                    cathode_diameter_mm=excluded.cathode_diameter_mm,
                    anode=excluded.anode,
                    anode_diameter_mm=excluded.anode_diameter_mm,
                    np_ratio=excluded.np_ratio,
                    separator_type=excluded.separator_type,
                    separator_diameter_mm=excluded.separator_diameter_mm,
                    electrolyte=excluded.electrolyte,
                    electrolyte_volume_ul=excluded.electrolyte_volume_ul,
                    spacer_mm=excluded.spacer_mm, repeat=excluded.repeat,
                    capacity_basis=COALESCE(excluded.capacity_basis, cell.capacity_basis),
                    do_formation=excluded.do_formation,
                    do_ratetest=excluded.do_ratetest, do_eis=excluded.do_eis,
                    anode_mass=excluded.anode_mass, cathode_mass=excluded.cathode_mass,
                    notes=excluded.notes,
                    custom_meta=excluded.custom_meta,
                    deleted_at=NULL
                """,
                (
                    pid, m.cell_id, m.id_no, m.batch, m.category,
                    m.cathode, m.cathode_diameter_mm,
                    m.anode, m.anode_diameter_mm, m.np_ratio,
                    m.separator_type, m.separator_diameter_mm,
                    m.electrolyte, m.electrolyte_volume_ul,
                    m.spacer_mm, m.repeat, m.capacity_basis,
                    m.do_formation, m.do_ratetest, m.do_eis,
                    m.anode_mass_g, m.cathode_mass_g, m.notes, custom_meta_json,
                ),
            )

            # 2. Write each dataset to data-lake storage and persist reference metadata.
            from compute.data.cycling_data import CyclingData as _CyclingData
            for name, raw in cell.datasets.items():
                dataset_ref = write_dataset_parquet(
                    raw,
                    project_id=pid,
                    cell_id=m.cell_id,
                    dataset_name=name,
                )
                meta_json: Optional[str] = None
                if isinstance(raw, _CyclingData) and raw.protocol is not None:
                    meta_json = json.dumps({"protocol": raw.protocol.to_list()})
                conn.execute(
                    """
                    INSERT INTO dataset (
                        project_id, cell_id, name,
                        storage_kind, storage_uri, data_format, size_bytes, checksum_sha256,
                        meta
                    )
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                    ON CONFLICT(project_id, cell_id, name) DO UPDATE SET
                        project_id=excluded.project_id,
                        storage_kind=excluded.storage_kind,
                        storage_uri=excluded.storage_uri,
                        data_format=excluded.data_format,
                        size_bytes=excluded.size_bytes,
                        checksum_sha256=excluded.checksum_sha256,
                        meta=excluded.meta,
                        created_at=datetime('now'),
                        deleted_at=NULL
                    """,
                    (
                        pid,
                        m.cell_id,
                        name,
                        dataset_ref["storage_kind"],
                        dataset_ref["storage_uri"],
                        dataset_ref["data_format"],
                        dataset_ref["size_bytes"],
                        dataset_ref["checksum_sha256"],
                        meta_json,
                    ),
                )

            conn.commit()
        finally:
            conn.close()

    def load_cell(self, cell_id: str) -> "Cell":
        """
        Reconstruct a Cell from the DB.

        Metadata is read from `cell`; each dataset path is resolved from
        `dataset.storage_uri` and loaded as a LazyFrame.
        """
        from compute.cell import Cell
        from compute.data.cycling_data import CyclingData
        from compute.data.result import Result as _Result

        conn = self._connect()

        pid = normalize_project_id(getattr(self, "project_id", DEFAULT_PROJECT_ID))
        row = conn.execute(
            "SELECT * FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (pid, cell_id),
        ).fetchone()
        if row is None:
            conn.close()
            raise KeyError(f"Cell {cell_id!r} not found in {self.db_path}")

        meta = _row_to_metadata(dict(row))
        cell = Cell(metadata=meta)

        ds_rows = conn.execute(
            """
            SELECT name, storage_uri, data_format, meta
            FROM dataset
            WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL
            """,
            (pid, cell_id),
        ).fetchall()
        conn.close()

        # cycling → CyclingData, everything else (dqdv, dvdq, future types) → Result
        for ds_row in ds_rows:
            name = ds_row["name"]
            storage_uri = ds_row["storage_uri"]
            if not storage_uri:
                continue
            if ds_row["data_format"] not in (None, "parquet"):
                continue
            lf = read_dataset_parquet(storage_uri).lazy()
            protocol = _parse_protocol_meta(ds_row["meta"] if "meta" in ds_row.keys() else None)
            if name == "cycling":
                try:
                    cell.datasets[name] = CyclingData(lf=lf, info={"cell_id": cell_id}, protocol=protocol)
                except Exception:
                    cell.datasets[name] = _Result(lf=lf, info={"cell_id": cell_id})
            else:
                cell.datasets[name] = _Result(lf=lf, info={"cell_id": cell_id})

        return cell

    def list_cells(self) -> List[str]:
        pid = normalize_project_id(getattr(self, "project_id", DEFAULT_PROJECT_ID))
        conn = self._connect()
        rows = conn.execute(
            "SELECT cell_id FROM cell WHERE project_id = ? AND deleted_at IS NULL ORDER BY cell_id",
            (pid,),
        ).fetchall()
        conn.close()
        return [r["cell_id"] for r in rows]

    def load_project(self, project_name: str) -> "Project":
        from compute.project import Project

        self.set_project_scope(project_name)
        project = Project(name=project_name)
        for cell_id in self.list_cells():
            try:
                project.add_cell(self.load_cell(cell_id))
            except Exception:
                pass
        return project

    def get_annotation(self, id_no: int) -> dict:
        pid = normalize_project_id(getattr(self, "project_id", DEFAULT_PROJECT_ID))
        conn = self._connect()
        row = conn.execute(
            """
            SELECT ca.note, ca.tags, ca.updated_at
            FROM cell_annotation ca
            JOIN cell c ON c.cell_id = ca.cell_id
            WHERE c.project_id = ? AND c.id_no = ? AND ca.project_id = ?
            """,
            (pid, id_no, pid),
        ).fetchone()
        conn.close()
        if row is None:
            return {"note": None, "tags": [], "updatedAt": None}
        return {
            "note": row["note"],
            "tags": json.loads(row["tags"]) if row["tags"] else [],
            "updatedAt": row["updated_at"],
        }

    def log_ingest(
        self,
        cell_id: str,
        filepaths: List[Path],
        cycler: Optional[str] = None,
        confidence: Optional[float] = None,
    ) -> None:
        """Append rows to ingest_log, one per file."""
        pid = normalize_project_id(getattr(self, "project_id", DEFAULT_PROJECT_ID))
        conn = self._connect()
        for order, fp in enumerate(filepaths, start=1):
            conn.execute(
                """
                INSERT INTO ingest_log (project_id, cell_id, filepath, file_order, cycler, confidence)
                VALUES (?, ?, ?, ?, ?, ?)
                """,
                (pid, cell_id, str(fp), order, cycler, confidence),
            )
        conn.commit()
        conn.close()


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _parse_protocol_meta(meta_json: Optional[str]):
    """Return a Protocol if meta_json contains one, else None."""
    if not meta_json:
        return None
    try:
        from compute.data.protocol import Protocol
        data = json.loads(meta_json)
        segments = data.get("protocol")
        if segments:
            return Protocol.from_dict_list(segments)
    except Exception:
        pass
    return None


def _row_to_metadata(row: dict) -> CellMetadata:
    return CellMetadata(
        cell_id=row["cell_id"],
        id_no=row.get("id_no"),
        batch=row.get("batch"),
        category=row.get("category"),
        cathode=row.get("cathode"),
        cathode_diameter_mm=row.get("cathode_diameter_mm"),
        anode=row.get("anode"),
        anode_diameter_mm=row.get("anode_diameter_mm"),
        np_ratio=row.get("np_ratio"),
        separator_type=row.get("separator_type"),
        separator_diameter_mm=row.get("separator_diameter_mm"),
        electrolyte=row.get("electrolyte"),
        electrolyte_volume_ul=row.get("electrolyte_volume_ul"),
        spacer_mm=row.get("spacer_mm"),
        repeat=row.get("repeat"),
        capacity_basis=row.get("capacity_basis"),
        do_formation=row.get("do_formation"),
        do_ratetest=row.get("do_ratetest"),
        do_eis=row.get("do_eis"),
        anode_mass_g=row.get("anode_mass"),
        cathode_mass_g=row.get("cathode_mass"),
        notes=row.get("notes"),
    )
