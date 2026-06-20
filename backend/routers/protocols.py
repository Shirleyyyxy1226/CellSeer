"""Protocol-template endpoints.

A *protocol template* is a reusable, named C-rate schedule made of one or more
*segments*. Each segment maps a cycle range to a C-rate, e.g.::

    [
      {"name": "formation",   "cycleStart": 1, "cycleEnd": 3,    "cRate": 0.1},
      {"name": "main cycling","cycleStart": 4, "cycleEnd": null, "cRate": 1.0}
    ]

``cycleEnd: null`` means "to end of test" — useful when the operator has not
defined a stop cycle yet. The wire format intentionally mirrors what we store
in ``cell.protocol_segments`` and ``dataset.meta.protocol`` so a template can
be applied to a cell verbatim.

Builtin templates (``is_builtin = 1``) are seeded per-project by
``project_scope._seed_builtin_protocol_templates`` and are read-only from the
API surface. User-created templates live alongside them and can be deleted.
"""

from __future__ import annotations

import json
import sqlite3
import uuid
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, Field

from db import get_db
from project_scope import (
    ensure_project_exists,
    normalize_project_id,
)

router = APIRouter()


# ---------------------------------------------------------------------------
# Shared shape: ProtocolSegment + ProtocolTemplate (wire format)
# ---------------------------------------------------------------------------


class ProtocolSegmentIn(BaseModel):
    """Incoming segment from the wizard. ``cycleEnd`` may be null/omitted."""

    name: Optional[str] = None
    cycleStart: int
    cycleEnd: Optional[int] = None
    cRate: float


def _validate_segments(segments: List[ProtocolSegmentIn]) -> list[dict[str, Any]]:
    """Reject obviously broken protocols early.

    Rules:
      * at least one segment;
      * ``cycleStart >= 1``;
      * ``cycleEnd`` (when present) >= ``cycleStart``;
      * ``cRate > 0``;
      * segments listed in non-decreasing ``cycleStart`` order (we sort to
        normalise; we don't reject "out of order" inputs since the wizard
        already keeps them ordered).
    """
    if not segments:
        raise HTTPException(status_code=400, detail="At least one segment is required")
    cleaned: list[dict[str, Any]] = []
    for idx, seg in enumerate(segments):
        if seg.cycleStart < 1:
            raise HTTPException(
                status_code=400,
                detail=f"Segment {idx + 1}: cycleStart must be >= 1",
            )
        if seg.cycleEnd is not None and seg.cycleEnd < seg.cycleStart:
            raise HTTPException(
                status_code=400,
                detail=f"Segment {idx + 1}: cycleEnd must be >= cycleStart",
            )
        if not (seg.cRate > 0):
            raise HTTPException(
                status_code=400,
                detail=f"Segment {idx + 1}: cRate must be > 0",
            )
        entry: dict[str, Any] = {
            "cycleStart": int(seg.cycleStart),
            "cycleEnd": int(seg.cycleEnd) if seg.cycleEnd is not None else None,
            "cRate": float(seg.cRate),
        }
        if seg.name and seg.name.strip():
            entry["name"] = seg.name.strip()[:80]
        cleaned.append(entry)
    cleaned.sort(key=lambda e: e["cycleStart"])
    for i in range(len(cleaned) - 1):
        cur_end = cleaned[i]["cycleEnd"]
        next_start = cleaned[i + 1]["cycleStart"]
        if cur_end is not None and cur_end >= next_start:
            raise HTTPException(
                status_code=400,
                detail=f"Segments {i + 1} and {i + 2} overlap: segment {i + 1} ends at cycle {cur_end} but segment {i + 2} starts at cycle {next_start}.",
            )
    return cleaned


def _row_to_template(row: sqlite3.Row) -> dict[str, Any]:
    try:
        segments = json.loads(row["segments_json"]) if row["segments_json"] else []
    except Exception:
        segments = []
    return {
        "id": row["id"],
        "projectId": row["project_id"],
        "name": row["name"],
        "description": row["description"] or "",
        "segments": segments,
        "isBuiltin": bool(row["is_builtin"]),
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------


@router.get("/api/protocol-templates")
def list_protocol_templates(projectId: str | None = None):
    """Return all templates visible to a project: its own + every builtin.

    Builtins are scoped per-project (each project carries its own builtin
    rows so deleting a project doesn't strand the seed templates) but the UI
    presents the union; ordering is ``builtins first, then user templates,
    each block sorted by name``.
    """
    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        ensure_project_exists(conn, project_id)
        rows = conn.execute(
            """
            SELECT id, project_id, name, description, segments_json,
                   is_builtin, created_at, updated_at
            FROM protocol_template
            WHERE project_id = ?
            ORDER BY is_builtin DESC, name COLLATE NOCASE ASC, created_at ASC
            """,
            (project_id,),
        ).fetchall()
    return {"templates": [_row_to_template(r) for r in rows]}


class ProtocolTemplateCreate(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    description: Optional[str] = Field(default=None, max_length=500)
    segments: List[ProtocolSegmentIn]


@router.post("/api/protocol-templates")
def create_protocol_template(body: ProtocolTemplateCreate, projectId: str | None = None):
    """Save a user-authored template.

    The endpoint always creates a new row (no id collisions across saves);
    duplicate ``name`` is allowed because the wizard surfaces templates as
    cards, not as a primary-key dropdown, and a user might legitimately want
    to keep two "1C" variants.
    """
    project_id = normalize_project_id(projectId)
    cleaned = _validate_segments(body.segments)
    name = body.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")
    description = (body.description or "").strip() or None
    template_id = f"pt_{uuid.uuid4().hex[:14]}"
    with get_db() as conn:
        ensure_project_exists(conn, project_id)
        conn.execute(
            """
            INSERT INTO protocol_template
              (id, project_id, name, description, segments_json, is_builtin,
               created_at, updated_at)
            VALUES (?, ?, ?, ?, ?, 0, datetime('now'), datetime('now'))
            """,
            (template_id, project_id, name, description, json.dumps(cleaned)),
        )
        conn.commit()
        row = conn.execute(
            "SELECT * FROM protocol_template WHERE id = ?", (template_id,)
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=500, detail="Failed to persist template")
    return {"template": _row_to_template(row)}


@router.delete("/api/protocol-templates/{template_id}")
def delete_protocol_template(template_id: str, projectId: str | None = None):
    """Delete a user template. Builtins are read-only (return 403)."""
    project_id = normalize_project_id(projectId)
    if not template_id:
        raise HTTPException(status_code=400, detail="template_id is required")
    with get_db() as conn:
        row = conn.execute(
            "SELECT id, is_builtin FROM protocol_template WHERE id = ? AND project_id = ?",
            (template_id, project_id),
        ).fetchone()
        if row is None:
            raise HTTPException(status_code=404, detail=f"Template '{template_id}' not found")
        if int(row["is_builtin"] or 0) == 1:
            raise HTTPException(
                status_code=403,
                detail="Builtin templates cannot be deleted",
            )
        conn.execute(
            "DELETE FROM protocol_template WHERE id = ? AND project_id = ?",
            (template_id, project_id),
        )
        conn.commit()
    return {"deleted": template_id}
