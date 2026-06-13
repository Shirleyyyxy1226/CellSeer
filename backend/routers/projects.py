"""Project management endpoints."""

from __future__ import annotations

import sqlite3
from typing import Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_db
from project_scope import generate_project_id, normalize_project_id

router = APIRouter()


class CreateProjectRequest(BaseModel):
    name: str


class RenameProjectRequest(BaseModel):
    name: str


def _project_summary(conn: sqlite3.Connection, project_id: str) -> dict:
    row = conn.execute(
        """
        SELECT
          COUNT(*) AS cell_count,
          GROUP_CONCAT(DISTINCT cathode) AS cathodes
        FROM cell
        WHERE project_id = ?
          AND deleted_at IS NULL
        """,
        (project_id,),
    ).fetchone()
    cell_count = int(row["cell_count"] or 0) if row else 0
    cathode_values = []
    if row and row["cathodes"]:
        cathode_values = [x.strip() for x in str(row["cathodes"]).split(",") if x.strip()]
    return {"cellCount": cell_count, "cathodeTypes": cathode_values[:6]}


@router.get("/api/projects")
def list_projects():
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, name, created_at, updated_at
            FROM project
            ORDER BY updated_at DESC, created_at DESC
            """
        ).fetchall()

        projects = []
        for r in rows:
            summary = _project_summary(conn, r["id"])
            projects.append(
                {
                    "id": r["id"],
                    "name": r["name"],
                    "createdAt": r["created_at"],
                    "updatedAt": r["updated_at"],
                    "cellCount": summary["cellCount"],
                    "cathodeTypes": summary["cathodeTypes"],
                }
            )
    return {"projects": projects}


@router.post("/api/projects")
def create_project(req: CreateProjectRequest):
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")
    project_id = generate_project_id()
    with get_db() as conn:
        conn.execute(
            """
            INSERT INTO project (id, name, updated_at)
            VALUES (?, ?, datetime('now'))
            """,
            (project_id, name[:120]),
        )
        conn.commit()
        row = conn.execute(
            "SELECT id, name, created_at, updated_at FROM project WHERE id = ?",
            (project_id,),
        ).fetchone()
    return {
        "id": row["id"],
        "name": row["name"],
        "createdAt": row["created_at"],
        "updatedAt": row["updated_at"],
        "cellCount": 0,
        "cathodeTypes": [],
    }


@router.patch("/api/projects/{project_id}")
def rename_project(project_id: str, req: RenameProjectRequest):
    pid = normalize_project_id(project_id)
    name = req.name.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")
    with get_db() as conn:
        cur = conn.execute(
            "UPDATE project SET name = ?, updated_at = datetime('now') WHERE id = ?",
            (name[:120], pid),
        )
        if cur.rowcount == 0:
            raise HTTPException(status_code=404, detail="Project not found")
        conn.commit()
    return {"ok": True}


@router.delete("/api/projects/{project_id}")
def delete_project(project_id: str):
    pid = normalize_project_id(project_id)
    with get_db() as conn:
        # Manual cleanup keeps behavior predictable when old DBs miss FK constraints.
        for table in ("dataset", "ingest_log", "cell_annotation", "upload_task", "cell"):
            try:
                conn.execute(f"DELETE FROM {table} WHERE project_id = ?", (pid,))
            except sqlite3.OperationalError:
                pass
        deleted = conn.execute("DELETE FROM project WHERE id = ?", (pid,))
        conn.commit()
    if deleted.rowcount == 0:
        raise HTTPException(status_code=404, detail="Project not found")
    return {"ok": True}


@router.get("/api/projects/{project_id}/readiness")
def project_readiness(project_id: str):
    pid = normalize_project_id(project_id)
    with get_db() as conn:
        project = conn.execute(
            "SELECT id, name, created_at, updated_at FROM project WHERE id = ?",
            (pid,),
        ).fetchone()
        if project is None:
            raise HTTPException(status_code=404, detail="Project not found")

        summary = _project_summary(conn, pid)

        cycling_row = conn.execute(
            """
            SELECT COUNT(DISTINCT cell_id) AS cnt
            FROM dataset
            WHERE project_id = ? AND name = 'cycling'
            """,
            (pid,),
        ).fetchone()
        cycling_file_count = int(cycling_row["cnt"] or 0) if cycling_row else 0

        column_count = 0
        if summary["cellCount"] > 0:
            columns = (
                "id_no",
                "cell_id",
                "batch",
                "category",
                "cathode",
                "anode",
                "separator_type",
                "spacer_mm",
                "repeat",
                "electrolyte",
                "notes",
            )
            checks = []
            for c in columns:
                checks.append(f"MAX(CASE WHEN {c} IS NOT NULL AND TRIM(CAST({c} AS TEXT)) <> '' THEN 1 ELSE 0 END) AS {c}_has")
            row = conn.execute(
                f"SELECT {', '.join(checks)} FROM cell WHERE project_id = ?",
                (pid,),
            ).fetchone()
            if row:
                column_count = sum(int(row[f"{c}_has"] or 0) for c in columns)

    has_metadata = summary["cellCount"] > 0
    can_enter_dashboard = has_metadata and cycling_file_count > 0
    return {
        "projectId": pid,
        "projectName": project["name"],
        "hasMetadata": has_metadata,
        "metadataColumnCount": column_count,
        "cyclingFileCount": cycling_file_count,
        "canEnterDashboard": can_enter_dashboard,
    }

