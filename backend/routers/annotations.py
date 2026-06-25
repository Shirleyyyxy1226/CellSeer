"""Cell annotation endpoints: GET/PUT per-cell notes and tags.

Annotations are keyed by cell_id (TEXT PK) — these routes accept the same
cell_id as path parameter (URL-encoded). The legacy id_no:int routes were
removed in the cleanup_deletion_routing rollout because cell_id is the only
collision-free identifier (two cells can share id_no across DIGIBAT projects).
"""

import json
from typing import List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_db, get_or_404
from project_scope import normalize_project_id

router = APIRouter()


def _safe_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        return None


class CellAnnotationUpdate(BaseModel):
    note: Optional[str] = None
    tags: Optional[List[str]] = None


@router.get("/api/cell-annotation/{cell_id:path}")
def get_cell_annotation(cell_id: str, projectId: str | None = None):
    """Get note + tags for one cell (looked up by cell_id)."""
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        cell = get_or_404(
            conn,
            "SELECT id_no FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
            f"Cell {cell_id!r} not found",
        )
        row = conn.execute(
            """
            SELECT note, tags, updated_at
            FROM cell_annotation
            WHERE project_id = ? AND cell_id = ?
            """,
            (project_id, cell_id),
        ).fetchone()
    tags = json.loads(row["tags"]) if row and row["tags"] else []
    return {
        "cellId": cell_id,
        "idNo": _safe_int(cell["id_no"]),
        "note": row["note"] if row else None,
        "tags": tags,
        "updatedAt": row["updated_at"] if row else None,
    }


@router.get("/api/cell-annotations")
def get_all_cell_annotations(projectId: str | None = None):
    """All annotations — used for bulk badge rendering. Keyed by cell_id."""
    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT c.cell_id, c.id_no, ca.note, ca.tags, ca.updated_at
            FROM cell_annotation ca
            JOIN cell c ON c.cell_id = ca.cell_id AND c.deleted_at IS NULL
            WHERE c.project_id = ? AND ca.project_id = ?
            """
            ,
            (project_id, project_id),
        ).fetchall()
    out: dict[str, dict] = {}
    for r in rows:
        cell_id = r["cell_id"]
        if not cell_id:
            continue
        tags = json.loads(r["tags"]) if r["tags"] else []
        out[cell_id] = {
            "cellId": cell_id,
            "idNo": _safe_int(r["id_no"]),
            "note": r["note"],
            "tags": tags,
            "updatedAt": r["updated_at"],
        }
    return {"annotations": out}


@router.put("/api/cell-annotation/{cell_id:path}")
def put_cell_annotation(cell_id: str, body: CellAnnotationUpdate, projectId: str | None = None):
    """Upsert note + tags. Partial update: only provided fields are written."""
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        cell = get_or_404(
            conn,
            "SELECT id_no FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
            f"Cell {cell_id!r} not found",
        )
        existing = conn.execute(
            "SELECT note, tags FROM cell_annotation WHERE project_id = ? AND cell_id = ?",
            (project_id, cell_id),
        ).fetchone()
        note = body.note if body.note is not None else (existing["note"] if existing else None)
        tags = (
            body.tags
            if body.tags is not None
            else (json.loads(existing["tags"]) if existing and existing["tags"] else [])
        )
        conn.execute(
            """
            INSERT INTO cell_annotation (project_id, cell_id, note, tags, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(cell_id) DO UPDATE SET
                note = excluded.note,
                tags = excluded.tags,
                updated_at = datetime('now')
            """,
            (project_id, cell_id, note, json.dumps(tags)),
        )
        conn.commit()
        row = conn.execute(
            "SELECT note, tags, updated_at FROM cell_annotation WHERE project_id = ? AND cell_id = ?",
            (project_id, cell_id),
        ).fetchone()
    return {
        "cellId": cell_id,
        "idNo": _safe_int(cell["id_no"]),
        "note": row["note"],
        "tags": json.loads(row["tags"]) if row["tags"] else [],
        "updatedAt": row["updated_at"],
    }
