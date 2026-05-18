"""Project-scoping helpers for API routers and ingest flow."""

from __future__ import annotations

import sqlite3
import uuid
from typing import Optional


DEFAULT_PROJECT_ID = "default"


def normalize_project_id(project_id: Optional[str]) -> str:
    value = (project_id or "").strip()
    if not value:
        return DEFAULT_PROJECT_ID
    return value[:80]


def _has_column(conn: sqlite3.Connection, table: str, column: str) -> bool:
    rows = conn.execute(f"PRAGMA table_info({table})").fetchall()
    return any(r["name"] == column for r in rows)


def ensure_project_schema(conn: sqlite3.Connection) -> None:
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

    table_column_defs = {
        "cell": "ALTER TABLE cell ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'",
        "dataset": "ALTER TABLE dataset ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'",
        "ingest_log": "ALTER TABLE ingest_log ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'",
        "cell_annotation": "ALTER TABLE cell_annotation ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'",
        "upload_task": "ALTER TABLE upload_task ADD COLUMN project_id TEXT NOT NULL DEFAULT 'default'",
    }

    for table, ddl in table_column_defs.items():
        try:
            if not _has_column(conn, table, "project_id"):
                conn.execute(ddl)
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
        if not _has_column(conn, "upload_task", "item_count"):
            conn.execute("ALTER TABLE upload_task ADD COLUMN item_count INTEGER NOT NULL DEFAULT 1")
    except sqlite3.OperationalError:
        pass

    conn.commit()

    ensure_project_exists(conn, DEFAULT_PROJECT_ID, "Default project")


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


def generate_project_id() -> str:
    return f"prj_{uuid.uuid4().hex[:12]}"

