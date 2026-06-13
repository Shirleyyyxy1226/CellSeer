"""Project-scoping helpers for API routers and ingest flow."""

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
                # Table may not exist yet; a later bootstrap will create it with project_id.
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
    # Seed read-only builtin templates so every project sees the same
    # "FORM-3 | 1C" / "FORM-5 | 0.5C" starter pair, even if the project
    # was created before the protocol-template feature existed.
    _seed_builtin_protocol_templates(conn, pid)


# A protocol "segment" stored on disk has shape:
#   {"name": "formation", "cycleStart": 1, "cycleEnd": 3, "cRate": 0.1}
# cycleEnd may be null to mean "to end of test".
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
    """Insert the read-only starter templates for ``project_id`` if missing.

    Idempotent: re-running on an existing project is a no-op. Existing
    builtins are NOT overwritten so user edits to a builtin's row (if we ever
    add such a flow) survive subsequent boots.
    """
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
        # protocol_template table not yet present (older partial schema);
        # ensure_project_schema will create it on the next boot.
        pass


def generate_project_id() -> str:
    return f"prj_{uuid.uuid4().hex[:12]}"

