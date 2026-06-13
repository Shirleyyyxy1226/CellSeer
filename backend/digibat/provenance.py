from __future__ import annotations

import json
import sqlite3
from typing import Any


def start_sync_run(
    conn: sqlite3.Connection,
    run_id: str,
    project_id: str,
    mode: str,
    *,
    collection_ids: list[str] | None = None,
) -> None:
    collection_ids_json = (
        json.dumps([str(c) for c in collection_ids]) if collection_ids else None
    )
    conn.execute(
        """
        INSERT INTO digibat_sync_run (
            id, project_id, mode, status, collection_ids_json, started_at
        )
        VALUES (?, ?, ?, 'running', ?, datetime('now'))
        """,
        (run_id, project_id, mode, collection_ids_json),
    )


def finish_sync_run(
    conn: sqlite3.Connection,
    run_id: str,
    status: str,
    *,
    totals: dict[str, Any] | None = None,
    error_message: str | None = None,
) -> None:
    payload = json.dumps(totals or {})
    conn.execute(
        """
        UPDATE digibat_sync_run
        SET status = ?,
            completed_at = datetime('now'),
            totals_json = ?,
            error_message = ?
        WHERE id = ?
        """,
        (status, payload, error_message, run_id),
    )


def lookup_cell_id_by_refcode(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    remote_refcode: str,
) -> str | None:
    """Return the local cell_id previously bound to this DIGIBAT refcode, if any.

    `remote_refcode` is the immutable upstream key (e.g. ``digibat:VAOGWT``),
    so this is the only safe way to recognise a cell across upstream renames.
    """
    row = conn.execute(
        """
        SELECT cell_id FROM digibat_cell_map
        WHERE project_id = ? AND remote_refcode = ?
        """,
        (project_id, remote_refcode),
    ).fetchone()
    if row is None:
        return None
    return row["cell_id"]


def id_no_owner(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    id_no: int,
    exclude_cell_id: str | None = None,
) -> tuple[str, str | None] | None:
    """Return (cell_id, source_refcode) of any cell already holding this id_no.

    Used to detect collisions like ``P024-CEL-100`` vs ``P025-CEL-100`` where two
    distinct upstream cells would both want id_no=100 in the same project.
    """
    if exclude_cell_id is None:
        row = conn.execute(
            "SELECT cell_id, source_refcode FROM cell WHERE project_id = ? AND id_no = ?",
            (project_id, id_no),
        ).fetchone()
    else:
        row = conn.execute(
            "SELECT cell_id, source_refcode FROM cell WHERE project_id = ? AND id_no = ? AND cell_id <> ?",
            (project_id, id_no, exclude_cell_id),
        ).fetchone()
    if row is None:
        return None
    return (row["cell_id"], row["source_refcode"])


def rename_cell_id(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    old_cell_id: str,
    new_cell_id: str,
) -> None:
    """Rename a cell_id and cascade through every table that references it.

    Used when DIGIBAT renames an item (e.g. "2210" -> "CEL-2210-LMFP-Graphite"):
    we keep the same physical row (identified by refcode) and update its display
    name + all foreign references.
    """
    if old_cell_id == new_cell_id:
        return
    conn.execute(
        "UPDATE cell SET cell_id = ? WHERE project_id = ? AND cell_id = ?",
        (new_cell_id, project_id, old_cell_id),
    )
    conn.execute(
        "UPDATE dataset SET cell_id = ? WHERE project_id = ? AND cell_id = ?",
        (new_cell_id, project_id, old_cell_id),
    )
    conn.execute(
        "UPDATE digibat_cell_map SET cell_id = ? WHERE project_id = ? AND cell_id = ?",
        (new_cell_id, project_id, old_cell_id),
    )
    conn.execute(
        "UPDATE digibat_file_map SET cell_id = ? WHERE project_id = ? AND cell_id = ?",
        (new_cell_id, project_id, old_cell_id),
    )


def upsert_cell_source(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    cell_id: str,
    remote_refcode: str,
    remote_item_id: str | None,
) -> None:
    conn.execute(
        """
        UPDATE cell
        SET source_system = 'digibat',
            source_refcode = ?,
            source_item_id = ?,
            last_seen_at = datetime('now'),
            deleted_at = NULL
        WHERE project_id = ? AND cell_id = ?
        """,
        (remote_refcode, remote_item_id, project_id, cell_id),
    )
    conn.execute(
        """
        INSERT INTO digibat_cell_map (project_id, remote_refcode, remote_item_id, cell_id, last_seen_at)
        VALUES (?, ?, ?, ?, datetime('now'))
        ON CONFLICT(project_id, remote_refcode) DO UPDATE SET
          remote_item_id = excluded.remote_item_id,
          cell_id = excluded.cell_id,
          last_seen_at = datetime('now')
        """,
        (project_id, remote_refcode, remote_item_id, cell_id),
    )


def get_previous_source_version(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    source_file_id: str,
) -> str | None:
    """Return the previously stored source_version only if the previous attempt
    actually succeeded (``last_status='done'``).

    Files whose last sync attempt errored (e.g. a PEIS .mpr the cycling parser
    rejects) should be retried on the next run rather than silently skipped.
    """
    row = conn.execute(
        """
        SELECT source_version
        FROM digibat_file_map
        WHERE project_id = ? AND source_file_id = ? AND last_status = 'done'
        """,
        (project_id, source_file_id),
    ).fetchone()
    if not row:
        return None
    return row["source_version"]


def upsert_file_map(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    remote_refcode: str,
    source_file_id: str,
    filename: str,
    source_version: str | None,
    cell_id: str | None,
    status: str,
    error_message: str | None = None,
) -> None:
    conn.execute(
        """
        INSERT INTO digibat_file_map (
          project_id, remote_refcode, source_file_id, filename, source_version,
          cell_id, last_status, last_error, last_synced_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))
        ON CONFLICT(project_id, source_file_id) DO UPDATE SET
          remote_refcode = excluded.remote_refcode,
          filename = excluded.filename,
          source_version = excluded.source_version,
          cell_id = excluded.cell_id,
          last_status = excluded.last_status,
          last_error = excluded.last_error,
          last_synced_at = datetime('now'),
          deleted_at = NULL
        """,
        (
            project_id,
            remote_refcode,
            source_file_id,
            filename,
            source_version,
            cell_id,
            status,
            error_message,
        ),
    )


def soft_delete_missing_files(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    remote_refcode: str,
    seen_source_file_ids: set[str],
) -> int:
    """Soft-delete file_map + dataset rows whose source_file_id is no longer
    present upstream for this (project, refcode).

    Returns the count of file_map rows tombstoned. The matching dataset rows
    (one per file_id) are cascaded in the same transaction so the listing
    endpoints stay consistent.
    """
    rows = conn.execute(
        """
        SELECT source_file_id FROM digibat_file_map
         WHERE project_id = ?
           AND remote_refcode = ?
           AND deleted_at IS NULL
        """,
        (project_id, remote_refcode),
    ).fetchall()
    stale = [r["source_file_id"] for r in rows if r["source_file_id"] not in seen_source_file_ids]
    if not stale:
        return 0
    placeholders = ",".join("?" for _ in stale)
    conn.execute(
        f"""
        UPDATE digibat_file_map
           SET deleted_at = datetime('now')
         WHERE project_id = ?
           AND remote_refcode = ?
           AND source_file_id IN ({placeholders})
           AND deleted_at IS NULL
        """,
        (project_id, remote_refcode, *stale),
    )
    conn.execute(
        f"""
        UPDATE dataset
           SET deleted_at = datetime('now')
         WHERE project_id = ?
           AND source_file_id IN ({placeholders})
           AND deleted_at IS NULL
        """,
        (project_id, *stale),
    )
    return len(stale)


def purge_soft_deleted(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    older_than_days: int,
    delete_files: bool = True,
) -> dict[str, int]:
    """Hard-delete every soft-deleted row whose ``deleted_at`` is older than
    ``older_than_days`` days, removing the corresponding parquet files first
    (best-effort) so disk doesn't bloat with orphan blobs.

    Order: dataset → digibat_file_map → cell. The cell table has
    ``ON DELETE CASCADE`` to dataset / digibat_cell_map / digibat_file_map,
    so deleting the cell row would orphan a dataset.deleted_at row's parquet
    file before we get a chance to unlink it. Doing dataset first lets us
    consult ``storage_uri`` for each row we are about to delete.

    Returns a dict with counts of deleted rows + files.
    """
    import os

    counts = {"datasets": 0, "files_removed": 0, "file_map_rows": 0, "cells": 0}
    cutoff_clause = f"datetime('now', '-{int(older_than_days)} days')"

    dataset_rows = conn.execute(
        f"""
        SELECT id, storage_kind, storage_uri FROM dataset
         WHERE project_id = ?
           AND deleted_at IS NOT NULL
           AND deleted_at < {cutoff_clause}
        """,
        (project_id,),
    ).fetchall()
    for row in dataset_rows:
        if delete_files and row["storage_kind"] == "local" and row["storage_uri"]:
            try:
                from dataset_store import resolve_dataset_path
                resolve_dataset_path(row["storage_uri"]).unlink(missing_ok=True)
                counts["files_removed"] += 1
            except OSError:
                pass
    if dataset_rows:
        ids = [r["id"] for r in dataset_rows]
        placeholders = ",".join("?" for _ in ids)
        conn.execute(
            f"DELETE FROM dataset WHERE id IN ({placeholders})",
            ids,
        )
        counts["datasets"] = len(ids)

    cur = conn.execute(
        f"""
        DELETE FROM digibat_file_map
         WHERE project_id = ?
           AND deleted_at IS NOT NULL
           AND deleted_at < {cutoff_clause}
        """,
        (project_id,),
    )
    counts["file_map_rows"] = cur.rowcount or 0

    cur = conn.execute(
        f"""
        DELETE FROM cell
         WHERE project_id = ?
           AND deleted_at IS NOT NULL
           AND deleted_at < {cutoff_clause}
        """,
        (project_id,),
    )
    counts["cells"] = cur.rowcount or 0

    return counts


def soft_delete_stale_cells(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    run_started_at: str,
) -> int:
    """Soft-delete every DIGIBAT cell in this project whose ``last_seen_at``
    predates ``run_started_at`` (i.e. the just-finished full sweep didn't
    refresh it), then cascade the tombstone to its datasets + file_map rows.

    Caller must guarantee this is only called after a full sweep (not a
    selective sync), otherwise unrelated cells would be wrongly tombstoned.
    Returns the number of cells tombstoned.
    """
    now_clause = "datetime('now')"

    stale_rows = conn.execute(
        """
        SELECT cell_id FROM cell
         WHERE project_id = ?
           AND source_system = 'digibat'
           AND (last_seen_at IS NULL OR last_seen_at < ?)
           AND deleted_at IS NULL
        """,
        (project_id, run_started_at),
    ).fetchall()
    if not stale_rows:
        return 0
    stale_cell_ids = [r["cell_id"] for r in stale_rows]
    placeholders = ",".join("?" for _ in stale_cell_ids)
    conn.execute(
        f"""
        UPDATE cell
           SET deleted_at = {now_clause}
         WHERE project_id = ?
           AND cell_id IN ({placeholders})
           AND deleted_at IS NULL
        """,
        (project_id, *stale_cell_ids),
    )
    conn.execute(
        f"""
        UPDATE dataset
           SET deleted_at = {now_clause}
         WHERE project_id = ?
           AND cell_id IN ({placeholders})
           AND deleted_at IS NULL
        """,
        (project_id, *stale_cell_ids),
    )
    conn.execute(
        f"""
        UPDATE digibat_file_map
           SET deleted_at = {now_clause}
         WHERE project_id = ?
           AND cell_id IN ({placeholders})
           AND deleted_at IS NULL
        """,
        (project_id, *stale_cell_ids),
    )
    return len(stale_cell_ids)


def upsert_dataset_source(
    conn: sqlite3.Connection,
    *,
    project_id: str,
    cell_id: str,
    source_refcode: str,
    source_file_id: str,
    source_version: str | None,
) -> None:
    conn.execute(
        """
        UPDATE dataset
        SET source_system = 'digibat',
            source_refcode = ?,
            source_file_id = ?,
            source_version = ?,
            last_synced_at = datetime('now'),
            deleted_at = NULL
        WHERE project_id = ? AND cell_id = ? AND name IN (
          'cycling', 'charge_dqdv', 'charge_dvdq', 'discharge_dqdv', 'discharge_dvdq', 'dqdv', 'dvdq'
        )
        """,
        (
            source_refcode,
            source_file_id,
            source_version,
            project_id,
            cell_id,
        ),
    )
