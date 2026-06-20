"""Helpers for project scoping — used by routers and ingest."""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Optional


DEFAULT_PROJECT_ID = "default"

_schema_initialized: set[str] = set()


def normalize_project_id(project_id: Optional[str]) -> str:
    value = (project_id or "").strip()
    if not value:
        return DEFAULT_PROJECT_ID
    return value[:80]


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)


def ensure_project_schema(conn: sqlite3.Connection) -> None:
    db_path = conn.execute("PRAGMA database_list").fetchone()["file"]
    if db_path in _schema_initialized:
        return

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS project (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS digibat_connection (
          project_id   TEXT PRIMARY KEY REFERENCES project(id) ON DELETE CASCADE,
          base_url     TEXT NOT NULL,
          api_key      TEXT,
          key_source   TEXT NOT NULL DEFAULT 'env',
          created_at   TEXT DEFAULT (datetime('now')),
          updated_at   TEXT DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS digibat_cell_map (
          project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          remote_refcode  TEXT NOT NULL,
          remote_item_id  TEXT,
          cell_id         TEXT NOT NULL REFERENCES cell(cell_id) ON DELETE CASCADE,
          last_seen_at    TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (project_id, remote_refcode)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS digibat_file_map (
          project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          remote_refcode  TEXT NOT NULL,
          source_file_id  TEXT NOT NULL,
          filename        TEXT NOT NULL,
          source_version  TEXT,
          cell_id         TEXT REFERENCES cell(cell_id) ON DELETE SET NULL,
          last_status     TEXT NOT NULL DEFAULT 'queued',
          last_error      TEXT,
          last_synced_at  TEXT DEFAULT (datetime('now')),
          PRIMARY KEY (project_id, source_file_id)
        )
        """
    )
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS digibat_sync_run (
          id            TEXT PRIMARY KEY,
          project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          mode          TEXT NOT NULL DEFAULT 'sync',
          status        TEXT NOT NULL DEFAULT 'running',
          totals_json   TEXT,
          error_message TEXT,
          started_at    TEXT DEFAULT (datetime('now')),
          completed_at  TEXT
        )
        """
    )

    table_column_defs = {
        "cell": [
            ("project_id", "TEXT NOT NULL DEFAULT 'default'"),
            ("source_system", "TEXT"),
            ("source_refcode", "TEXT"),
            ("source_item_id", "TEXT"),
            ("last_seen_at", "TEXT"),
            ("protocol_name", "TEXT"),
            ("protocol_segments", "TEXT"),
            ("protocol_updated_at", "TEXT"),
            ("deleted_at", "TEXT"),
        ],
        "dataset": [
            ("project_id", "TEXT NOT NULL DEFAULT 'default'"),
            ("storage_kind", "TEXT NOT NULL DEFAULT 'local'"),
            ("storage_uri", "TEXT"),
            ("data_format", "TEXT NOT NULL DEFAULT 'parquet'"),
            ("size_bytes", "INTEGER"),
            ("checksum_sha256", "TEXT"),
            ("source_system", "TEXT"),
            ("source_refcode", "TEXT"),
            ("source_file_id", "TEXT"),
            ("source_version", "TEXT"),
            ("last_synced_at", "TEXT"),
            ("deleted_at", "TEXT"),
        ],
        "digibat_file_map": [
            ("deleted_at", "TEXT"),
        ],
        "ingest_log": [("project_id", "TEXT NOT NULL DEFAULT 'default'")],
        "cell_annotation": [("project_id", "TEXT NOT NULL DEFAULT 'default'")],
        "upload_task": [("project_id", "TEXT NOT NULL DEFAULT 'default'")],
        "digibat_sync_run": [
            ("collection_ids_json", "TEXT"),
        ],
    }

    for table, columns in table_column_defs.items():
        for column, ddl in columns:
            try:
                if not _has_column(conn, table, column):
                    conn.execute(f"ALTER TABLE {table} ADD COLUMN {column} {ddl}")
            except sqlite3.OperationalError:
                # Table may not exist yet; schema will be created on next boot.
                pass

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cell_project_id ON cell(project_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_project_id ON dataset(project_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_upload_task_project ON upload_task(project_id, created_at DESC)"
    )
    try:
        if _has_column(conn, "dataset", "source_file_id"):
            conn.execute(
                "CREATE INDEX IF NOT EXISTS idx_dataset_source_file ON dataset(project_id, source_file_id)"
            )
    except sqlite3.OperationalError:
        pass
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_digibat_sync_run_project ON digibat_sync_run(project_id, started_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cell_deleted_at ON cell(project_id, deleted_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_deleted_at ON dataset(project_id, deleted_at)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_digibat_file_map_deleted_at ON digibat_file_map(project_id, deleted_at)"
    )

    try:
        if not _has_column(conn, "upload_task", "item_count"):
            conn.execute("ALTER TABLE upload_task ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1")
    except sqlite3.OperationalError:
        pass

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS protocol_template (
          id            TEXT PRIMARY KEY,
          project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          name          TEXT NOT NULL,
          description   TEXT,
          segments_json TEXT NOT NULL,
          is_builtin    INTEGER NOT NULL DEFAULT 0,
          created_at    TEXT DEFAULT (datetime('now')),
          updated_at    TEXT DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_protocol_template_project "
        "ON protocol_template(project_id, is_builtin, name)"
    )

    # Remove the legacy UNIQUE(project_id, id_no) constraint from the cell table.
    # SQLite cannot DROP CONSTRAINT — requires table recreation. The constraint
    # was removed intentionally: DIGIBAT imports from multiple collections may
    # share the same display id_no across different cell_ids.
    _migrate_drop_cell_id_no_unique(conn)

    # Soft-delete any dataset rows with a null storage_uri — these are pre-migration
    # rows that stored binary data in-DB and have no Parquet path. They cannot be
    # read by the current loader and would silently return empty results if left alive.
    _migrate_nullify_orphan_datasets(conn)

    conn.commit()

    ensure_project_exists(conn, DEFAULT_PROJECT_ID, "Default project")
    _seed_builtin_protocol_templates(conn, DEFAULT_PROJECT_ID)
    _schema_initialized.add(db_path)


def ensure_project_exists(conn: sqlite3.Connection, project_id: str, name: Optional[str] = None) -> None:
    pid = normalize_project_id(project_id)
    pname = (name or pid or "Untitled Project").strip()[:120]
    conn.execute(
        """
        INSERT INTO project (id, name, updated_at)
        VALUES (?, ?, datetime('now'))
        ON CONFLICT(id) DO UPDATE SET updated_at=datetime('now')
        """,
        (pid, pname),
    )
    conn.commit()
    # Add default protocol templates if not already present.
    _seed_builtin_protocol_templates(conn, pid)


# Built-in protocol templates shown in every project by default.
_BUILTIN_PROTOCOL_TEMPLATES: list[dict] = [
    {
        "id_suffix": "form3-1c",
        "name": "FORM-3 | CYCLE-1C",
        "description": "3 formation cycles @ C/10 followed by 1C main cycling.",
        "segments": [
            {"name": "formation", "cycleStart": 1, "cycleEnd": 3, "cRate": 0.1},
            {"name": "main cycling", "cycleStart": 4, "cycleEnd": None, "cRate": 1.0},
        ],
    },
    {
        "id_suffix": "form5-05c",
        "name": "FORM-5 | CYCLE-0.5C",
        "description": "5 formation cycles @ C/10 followed by 0.5C main cycling.",
        "segments": [
            {"name": "formation", "cycleStart": 1, "cycleEnd": 5, "cRate": 0.1},
            {"name": "main cycling", "cycleStart": 6, "cycleEnd": None, "cRate": 0.5},
        ],
    },
]


def _seed_builtin_protocol_templates(conn: sqlite3.Connection, project_id: str) -> None:
    """Insert default protocol templates for a project if they don't exist yet."""
    pid = normalize_project_id(project_id)
    try:
        for tmpl in _BUILTIN_PROTOCOL_TEMPLATES:
            tmpl_id = f"builtin:{pid}:{tmpl['id_suffix']}"
            existing = conn.execute(
                "SELECT 1 FROM protocol_template WHERE id = ?",
                (tmpl_id,),
            ).fetchone()
            if existing is not None:
                continue
            conn.execute(
                """
                INSERT INTO protocol_template
                  (id, project_id, name, description, segments_json, is_builtin)
                VALUES (?, ?, ?, ?, ?, 1)
                """,
                (
                    tmpl_id,
                    pid,
                    tmpl["name"],
                    tmpl["description"],
                    json.dumps(tmpl["segments"]),
                ),
            )
        conn.commit()
    except sqlite3.OperationalError:
        # Table not yet created; will be set up on next boot.
        pass


def _migrate_drop_cell_id_no_unique(conn: sqlite3.Connection) -> None:
    """Remove the legacy UNIQUE(project_id, id_no) constraint from the cell table.

    SQLite cannot ALTER TABLE ... DROP CONSTRAINT, so this recreates the table
    without the constraint. Only runs when the old definition is detected.
    """
    row = conn.execute(
        "SELECT sql FROM sqlite_master WHERE type='table' AND name='cell'"
    ).fetchone()
    if row is None or "UNIQUE(project_id, id_no)" not in (row["sql"] or ""):
        return

    cols_info = conn.execute("PRAGMA table_info(cell)").fetchall()
    col_names = ", ".join(r["name"] for r in cols_info)

    conn.execute("PRAGMA foreign_keys = OFF")
    conn.execute(
        f"""
        CREATE TABLE cell_migration_new AS
        SELECT {col_names} FROM cell WHERE 0
        """
    )
    # Recreate with proper definition: no UNIQUE(project_id, id_no).
    conn.execute("DROP TABLE cell_migration_new")
    conn.execute(
        """
        CREATE TABLE cell_new (
          project_id TEXT NOT NULL DEFAULT 'default',
          cell_id TEXT PRIMARY KEY,
          id_no INTEGER,
          batch INTEGER,
          category TEXT,
          cathode TEXT,
          cathode_diameter_mm REAL,
          anode TEXT,
          anode_diameter_mm REAL,
          np_ratio REAL,
          separator_type TEXT,
          separator_diameter_mm REAL,
          electrolyte TEXT,
          electrolyte_volume_ul REAL,
          spacer_mm REAL,
          repeat INTEGER,
          do_formation TEXT,
          do_ratetest TEXT,
          do_eis TEXT,
          anode_mass REAL,
          cathode_mass REAL,
          notes TEXT,
          source_system TEXT,
          source_refcode TEXT,
          source_item_id TEXT,
          last_seen_at TEXT,
          protocol_name TEXT,
          protocol_segments TEXT,
          protocol_updated_at TEXT,
          deleted_at TEXT
        )
        """
    )
    conn.execute(f"INSERT INTO cell_new ({col_names}) SELECT {col_names} FROM cell")
    conn.execute("DROP TABLE cell")
    conn.execute("ALTER TABLE cell_new RENAME TO cell")
    conn.execute("PRAGMA foreign_keys = ON")
    print("Migration: removed UNIQUE(project_id, id_no) constraint from cell table.")


def _migrate_nullify_orphan_datasets(conn: sqlite3.Connection) -> None:
    """Soft-delete dataset rows that have no storage_uri (pre-Parquet-migration rows).

    These rows were created when datasets were stored as BLOBs in the DB.
    The current loader skips them silently; making them deleted_at makes the
    state explicit and prevents confusing empty-data results.
    """
    try:
        result = conn.execute(
            """
            UPDATE dataset
            SET deleted_at = datetime('now')
            WHERE storage_uri IS NULL AND deleted_at IS NULL
            """
        )
        if result.rowcount:
            print(
                f"Migration: soft-deleted {result.rowcount} dataset row(s) with no "
                "storage_uri (pre-Parquet data). Re-ingest those cycling files to restore them."
            )
    except sqlite3.OperationalError:
        pass


def generate_project_id() -> str:
    return f"prj_{uuid.uuid4().hex[:12]}"

