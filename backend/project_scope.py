"""Helpers for project scoping — used by routers and ingest."""

from __future__ import annotations

import json
import uuid
from typing import Optional

import psycopg2

DEFAULT_PROJECT_ID = "default"

_schema_initialized: set[str] = set()


def generate_project_id() -> str:
    return f"prj_{uuid.uuid4().hex[:12]}"


def normalize_project_id(project_id: Optional[str]) -> str:
    value = (project_id or "").strip()
    if not value:
        return DEFAULT_PROJECT_ID
    return value[:80]


def _has_column(conn, table: str, column: str) -> bool:
    row = conn.execute(
        "SELECT column_name FROM information_schema.columns WHERE table_name=%s AND column_name=%s",
        (table, column),
    ).fetchone()
    return row is not None


def ensure_project_schema(conn) -> None:
    from config import DATABASE_URL
    cache_key = DATABASE_URL
    if cache_key in _schema_initialized:
        return

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS project (
          id         TEXT PRIMARY KEY,
          name       TEXT NOT NULL,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
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
          created_at   TIMESTAMPTZ DEFAULT NOW(),
          updated_at   TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cell (
          project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          cell_id    TEXT NOT NULL,
          id_no      INTEGER,
          batch      INTEGER,
          category   TEXT,
          cathode    TEXT,
          cathode_diameter_mm REAL,
          anode      TEXT,
          anode_diameter_mm   REAL,
          np_ratio   REAL,
          separator_type      TEXT,
          separator_diameter_mm REAL,
          electrolyte         TEXT,
          electrolyte_volume_ul REAL,
          spacer_mm  REAL,
          repeat     INTEGER,
          capacity_basis TEXT,
          do_formation TEXT,
          do_ratetest  TEXT,
          do_eis       TEXT,
          anode_mass   REAL,
          cathode_mass REAL,
          notes        TEXT,
          custom_meta  TEXT,
          source_system    TEXT,
          source_refcode   TEXT,
          source_item_id   TEXT,
          last_seen_at     TEXT,
          protocol_name    TEXT,
          protocol_segments TEXT,
          protocol_updated_at TEXT,
          deleted_at       TEXT,
          PRIMARY KEY (project_id, cell_id)
        )
        """
    )

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cell_project_id ON cell(project_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_cell_deleted_at ON cell(project_id, deleted_at)"
    )

    # Backfill custom_meta on cell tables created before the dynamic-metadata
    # feature. CREATE TABLE IF NOT EXISTS won't add it to an existing table.
    if not _has_column(conn, "cell", "custom_meta"):
        conn.execute("ALTER TABLE cell ADD COLUMN custom_meta TEXT")
    if not _has_column(conn, "cell", "capacity_basis"):
        conn.execute("ALTER TABLE cell ADD COLUMN capacity_basis TEXT")

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS dataset (
          id           BIGSERIAL PRIMARY KEY,
          project_id   TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          cell_id      TEXT NOT NULL,
          name         TEXT NOT NULL,
          storage_kind TEXT NOT NULL DEFAULT 'local',
          storage_uri  TEXT NOT NULL,
          data_format  TEXT NOT NULL DEFAULT 'parquet',
          size_bytes   INTEGER,
          checksum_sha256 TEXT,
          source_system   TEXT,
          source_refcode  TEXT,
          source_file_id  TEXT,
          source_version  TEXT,
          last_synced_at  TEXT,
          meta            TEXT,
          created_at      TIMESTAMPTZ DEFAULT NOW(),
          deleted_at      TEXT,
          UNIQUE (project_id, cell_id, name),
          FOREIGN KEY (project_id, cell_id) REFERENCES cell(project_id, cell_id) ON DELETE CASCADE
        )
        """
    )

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_project_id ON dataset(project_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_cell_id ON dataset(cell_id)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_dataset_deleted_at ON dataset(project_id, deleted_at)"
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS ingest_log (
          id          BIGSERIAL PRIMARY KEY,
          project_id  TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          cell_id     TEXT NOT NULL,
          filepath    TEXT NOT NULL,
          file_order  INTEGER NOT NULL DEFAULT 1,
          cycler      TEXT,
          confidence  REAL,
          ingested_at TIMESTAMPTZ DEFAULT NOW(),
          FOREIGN KEY (project_id, cell_id) REFERENCES cell(project_id, cell_id) ON DELETE CASCADE
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS cell_annotation (
          project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          cell_id    TEXT NOT NULL,
          note       TEXT,
          tags       TEXT,
          updated_at TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (project_id, cell_id),
          FOREIGN KEY (project_id, cell_id) REFERENCES cell(project_id, cell_id) ON DELETE CASCADE
        )
        """
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS upload_task (
          id         TEXT PRIMARY KEY,
          project_id TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          filename   TEXT NOT NULL,
          file_type  TEXT,
          item_count INTEGER NOT NULL DEFAULT 1,
          status     TEXT NOT NULL DEFAULT 'queued',
          message    TEXT,
          progress   INTEGER DEFAULT 0,
          created_at TIMESTAMPTZ DEFAULT NOW(),
          updated_at TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_upload_task_project ON upload_task(project_id, created_at DESC)"
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_upload_task_created ON upload_task(created_at DESC)"
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS digibat_cell_map (
          project_id      TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          remote_refcode  TEXT NOT NULL,
          remote_item_id  TEXT,
          cell_id         TEXT NOT NULL,
          last_seen_at    TIMESTAMPTZ DEFAULT NOW(),
          PRIMARY KEY (project_id, remote_refcode),
          FOREIGN KEY (project_id, cell_id) REFERENCES cell(project_id, cell_id) ON DELETE CASCADE
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
          cell_id         TEXT,
          last_status     TEXT NOT NULL DEFAULT 'queued',
          last_error      TEXT,
          last_synced_at  TIMESTAMPTZ DEFAULT NOW(),
          deleted_at      TEXT,
          PRIMARY KEY (project_id, source_file_id)
        )
        """
    )

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_digibat_file_map_deleted_at ON digibat_file_map(project_id, deleted_at)"
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS digibat_sync_run (
          id            TEXT PRIMARY KEY,
          project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          mode          TEXT NOT NULL DEFAULT 'sync',
          status        TEXT NOT NULL DEFAULT 'running',
          totals_json   TEXT,
          collection_ids_json TEXT,
          error_message TEXT,
          started_at    TIMESTAMPTZ DEFAULT NOW(),
          completed_at  TIMESTAMPTZ
        )
        """
    )

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_digibat_sync_run_project ON digibat_sync_run(project_id, started_at DESC)"
    )

    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS protocol_template (
          id            TEXT PRIMARY KEY,
          project_id    TEXT NOT NULL REFERENCES project(id) ON DELETE CASCADE,
          name          TEXT NOT NULL,
          description   TEXT,
          segments_json TEXT NOT NULL,
          is_builtin    INTEGER NOT NULL DEFAULT 0,
          created_at    TIMESTAMPTZ DEFAULT NOW(),
          updated_at    TIMESTAMPTZ DEFAULT NOW()
        )
        """
    )

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_protocol_template_project "
        "ON protocol_template(project_id, is_builtin, name)"
    )

    _migrate_nullify_orphan_datasets(conn)

    conn.commit()

    ensure_project_exists(conn, DEFAULT_PROJECT_ID, "Default project")
    _seed_builtin_protocol_templates(conn, DEFAULT_PROJECT_ID)
    _schema_initialized.add(cache_key)


def ensure_project_exists(conn, project_id: str, name: Optional[str] = None) -> None:
    pid = normalize_project_id(project_id)
    pname = (name or pid or "Untitled Project").strip()[:120]
    conn.execute(
        """
        INSERT INTO project (id, name, updated_at)
        VALUES (%s, %s, NOW())
        ON CONFLICT(id) DO UPDATE SET updated_at=NOW()
        """,
        (pid, pname),
    )
    conn.commit()
    _seed_builtin_protocol_templates(conn, pid)


_BUILTIN_PROTOCOL_TEMPLATES: list[dict] = [
    {
        "id_suffix": "rate-test",
        "name": "RATE TEST | FORM-3 + C/2 + 1C/2C/5C",
        "description": (
            "3 formation cycles @ C/10, C/2 main cycling, a 1C/2C/5C rate test, "
            "then C/10 recovery."
        ),
        "segments": [
            {"name": "formation", "cycleStart": 1, "cycleEnd": 3, "cRate": 0.1},
            {"name": "main cycling", "cycleStart": 4, "cycleEnd": 8, "cRate": 0.5},
            {"name": "rate test (1C)", "cycleStart": 9, "cycleEnd": 13, "cRate": 1.0},
            {"name": "rate test (2C)", "cycleStart": 14, "cycleEnd": 18, "cRate": 2.0},
            {"name": "rate test (5C)", "cycleStart": 19, "cycleEnd": 23, "cRate": 5.0},
            {"name": "recovery", "cycleStart": 24, "cycleEnd": 28, "cRate": 0.1},
        ],
    },
]


def _seed_builtin_protocol_templates(conn, project_id: str) -> None:
    pid = normalize_project_id(project_id)
    try:
        # Reconcile: drop builtin templates no longer defined (e.g. retired
        # FORM-3 / FORM-5) so the picker matches _BUILTIN_PROTOCOL_TEMPLATES.
        desired_ids = {f"builtin:{pid}:{t['id_suffix']}" for t in _BUILTIN_PROTOCOL_TEMPLATES}
        stale = conn.execute(
            "SELECT id FROM protocol_template WHERE project_id = %s AND is_builtin = 1",
            (pid,),
        ).fetchall()
        for row in stale:
            if row["id"] not in desired_ids:
                conn.execute("DELETE FROM protocol_template WHERE id = %s", (row["id"],))
        for tmpl in _BUILTIN_PROTOCOL_TEMPLATES:
            tmpl_id = f"builtin:{pid}:{tmpl['id_suffix']}"
            existing = conn.execute(
                "SELECT 1 FROM protocol_template WHERE id = %s",
                (tmpl_id,),
            ).fetchone()
            if existing is not None:
                continue
            conn.execute(
                """
                INSERT INTO protocol_template
                  (id, project_id, name, description, segments_json, is_builtin)
                VALUES (%s, %s, %s, %s, %s, 1)
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
    except Exception:
        pass


def _migrate_nullify_orphan_datasets(conn) -> None:
    try:
        result = conn.execute(
            """
            UPDATE dataset
            SET deleted_at = NOW()::text
            WHERE storage_uri IS NULL AND deleted_at IS NULL
            """
        )
        if result.rowcount:
            print(
                f"Migration: soft-deleted {result.rowcount} dataset row(s) with no "
                "storage_uri. Re-ingest those cycling files to restore them."
            )
    except Exception:
        pass
