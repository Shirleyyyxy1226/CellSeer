from __future__ import annotations

import json
import uuid
from typing import Any
from urllib.parse import quote

from fastapi import APIRouter, BackgroundTasks, HTTPException
from pydantic import BaseModel, Field

from config import DATALAB_API_KEY, DATALAB_BASE_URL, DATALAB_TIMEOUT
from db import get_db
from digibat.client import DigibatClient
from digibat.config import DigibatConfig
from digibat.models import DigibatSyncOptions
from digibat.provenance import start_sync_run
from digibat.sync_service import sync_collections
from project_scope import ensure_project_exists, generate_project_id, normalize_project_id

router = APIRouter()


class DigibatConnectRequest(BaseModel):
    projectId: str
    apiKey: str | None = None
    useDefault: bool = False
    baseUrl: str | None = None


class ManualCellInput(BaseModel):
    cellName: str
    idNo: int | None = None


class ManualProjectRequest(BaseModel):
    projectName: str
    cells: list[ManualCellInput] = Field(default_factory=list)


class DigibatSyncRequest(BaseModel):
    collectionIds: list[str]
    selectedRefcodes: list[str] = Field(default_factory=list)
    maxItems: int | None = None
    dryRun: bool = False
    fullResync: bool = False
    includeCycling: bool = True
    verbose: bool = False


def _project_connection(conn: Any, project_id: str) -> dict[str, Any] | None:
    row = conn.execute(
        """
        SELECT project_id, base_url, api_key, key_source, updated_at
        FROM digibat_connection
        WHERE project_id = ?
        """,
        (project_id,),
    ).fetchone()
    return dict(row) if row else None


def _effective_config(conn: Any, project_id: str) -> DigibatConfig:
    connection = _project_connection(conn, project_id)
    if connection and connection.get("api_key"):
        return DigibatConfig(
            base_url=(connection.get("base_url") or DATALAB_BASE_URL).strip().rstrip("/"),
            api_key=connection["api_key"],
            timeout_seconds=DATALAB_TIMEOUT,
        )
    if not DATALAB_API_KEY:
        raise HTTPException(status_code=400, detail="No DIGIBAT key configured for this project.")
    return DigibatConfig(
        base_url=DATALAB_BASE_URL,
        api_key=DATALAB_API_KEY,
        timeout_seconds=DATALAB_TIMEOUT,
    )


def _run_sync_task(
    project_id: str,
    run_id: str,
    request: DigibatSyncRequest,
    config: DigibatConfig,
) -> None:
    options = DigibatSyncOptions(
        project_id=project_id,
        collection_ids=request.collectionIds,
        selected_refcodes=request.selectedRefcodes,
        include_cycling=request.includeCycling,
        max_items=request.maxItems,
        dry_run=request.dryRun,
        full_resync=request.fullResync,
        verbose=request.verbose,
    )
    sync_collections(config=config, db_path="", options=options, run_id=run_id)


@router.post("/api/digibat/connect")
def connect_digibat(req: DigibatConnectRequest):
    project_id = normalize_project_id(req.projectId)
    if not req.useDefault and not (req.apiKey or "").strip():
        raise HTTPException(status_code=400, detail="API key is required unless useDefault is enabled.")
    key_source = "env" if req.useDefault else "user"
    api_key = None if req.useDefault else (req.apiKey or "").strip()
    with get_db() as conn:
        ensure_project_exists(conn, project_id, project_id)
        conn.execute(
            """
            INSERT INTO digibat_connection (project_id, base_url, api_key, key_source, updated_at)
            VALUES (?, ?, ?, ?, datetime('now'))
            ON CONFLICT(project_id) DO UPDATE SET
              base_url = excluded.base_url,
              api_key = excluded.api_key,
              key_source = excluded.key_source,
              updated_at = datetime('now')
            """,
            (project_id, (req.baseUrl or DATALAB_BASE_URL).strip().rstrip("/"), api_key, key_source),
        )
        conn.commit()
    return {"ok": True, "projectId": project_id}


@router.post("/api/digibat/manual-project")
def create_manual_project(req: ManualProjectRequest):
    name = req.projectName.strip()
    if not name:
        raise HTTPException(status_code=400, detail="Project name is required")
    project_id = generate_project_id()
    with get_db() as conn:
        conn.execute(
            "INSERT INTO project (id, name, updated_at) VALUES (?, ?, datetime('now'))",
            (project_id, name[:120]),
        )
        for index, cell in enumerate(req.cells):
            cell_name = cell.cellName.strip()
            if not cell_name:
                continue
            cell_id = f"{project_id}_manual_{index}_{cell_name}"[:160]
            conn.execute(
                """
                INSERT INTO cell (project_id, cell_id, id_no, notes)
                VALUES (?, ?, ?, ?)
                ON CONFLICT(project_id, cell_id) DO UPDATE SET
                  id_no = excluded.id_no,
                  notes = excluded.notes
                """,
                (project_id, cell_id, cell.idNo, "created from /digibat manual entry"),
            )
        conn.commit()
    return {"ok": True, "projectId": project_id}


def _running_collection_ids(conn: Any, project_id: str) -> dict[str, list[str]]:
    """Return mapping {run_id: [collection_ids]} for every still-`running` row.

    Rows from older versions of the app may have NULL collection_ids_json; we
    treat those as wildcard (`["*"]`) so they conflict with anything — the
    intent of a same-source check is to be conservative when we genuinely
    don't know what source the legacy run is touching.
    """
    rows = conn.execute(
        """
        SELECT id, collection_ids_json
        FROM digibat_sync_run
        WHERE project_id = ? AND status = 'running'
        """,
        (project_id,),
    ).fetchall()
    out: dict[str, list[str]] = {}
    for row in rows:
        raw = row["collection_ids_json"]
        ids: list[str]
        if not raw:
            ids = ["*"]
        else:
            try:
                parsed = json.loads(raw)
                ids = [str(x) for x in parsed] if isinstance(parsed, list) else ["*"]
            except (TypeError, ValueError):
                ids = ["*"]
        out[row["id"]] = ids
    return out


@router.post("/api/projects/{project_id}/digibat/sync")
def start_project_sync(project_id: str, req: DigibatSyncRequest, background_tasks: BackgroundTasks):
    pid = normalize_project_id(project_id)
    if not req.collectionIds:
        raise HTTPException(status_code=400, detail="collectionIds is required")
    requested = {str(c) for c in req.collectionIds}
    with get_db() as conn:
        ensure_project_exists(conn, pid, pid)
        running = _running_collection_ids(conn, pid)
        conflicts: list[dict[str, Any]] = []
        for run_id, ids in running.items():
            if "*" in ids:
                conflicts.append({"runId": run_id, "collectionIds": ids})
                continue
            overlap = sorted(requested.intersection(ids))
            if overlap:
                conflicts.append({"runId": run_id, "collectionIds": overlap})
        if conflicts:
            raise HTTPException(
                status_code=409,
                detail={
                    "message": "A sync is already running for one or more of the requested collections.",
                    "conflicts": conflicts,
                },
            )
        config = _effective_config(conn, pid)
        # Insert the run row atomically inside the same transaction as the conflict check
        # to close the TOCTOU window between checking and starting.
        run_id = str(uuid.uuid4())
        start_sync_run(
            conn,
            run_id,
            pid,
            mode="dry-run" if req.dryRun else "sync",
            collection_ids=list(req.collectionIds),
        )
        conn.commit()
    background_tasks.add_task(_run_sync_task, pid, run_id, req, config)
    return {"ok": True, "projectId": pid, "status": "queued", "requestId": run_id}


@router.get("/api/digibat/collections")
def list_digibat_collections(projectId: str):
    pid = normalize_project_id(projectId)
    with get_db() as conn:
        ensure_project_exists(conn, pid, pid)
        try:
            config = _effective_config(conn, pid)
        except HTTPException as exc:
            if exc.status_code == 400:
                return {"projectId": pid, "configured": False, "collections": [], "detail": str(exc.detail)}
            raise
    client = DigibatClient(config.base_url, config.api_key, timeout_seconds=config.timeout_seconds)
    try:
        payload = client.get_json("/api/collections")
    except RuntimeError as exc:
        return {"projectId": pid, "configured": False, "collections": [], "detail": str(exc)}
    raw: list[dict[str, Any]] = []
    if isinstance(payload, list):
        raw = [x for x in payload if isinstance(x, dict)]
    elif isinstance(payload, dict):
        for key in ("data", "collections", "items", "results"):
            if isinstance(payload.get(key), list):
                raw = [x for x in payload[key] if isinstance(x, dict)]
                break
    collections = []
    for item in raw:
        cid = str(item.get("collection_id") or item.get("id") or item.get("refcode") or "").strip()
        if not cid:
            continue
        collections.append(
            {
                "id": cid,
                "name": str(item.get("name") or item.get("title") or cid),
                "description": item.get("description"),
            }
        )
    return {"projectId": pid, "configured": True, "collections": collections}


@router.get("/api/digibat/collections/{collection_id}/cells")
def list_digibat_collection_cells(collection_id: str, projectId: str):
    pid = normalize_project_id(projectId)
    with get_db() as conn:
        ensure_project_exists(conn, pid, pid)
        try:
            config = _effective_config(conn, pid)
        except HTTPException as exc:
            if exc.status_code == 400:
                return {"projectId": pid, "collectionId": collection_id, "configured": False, "cells": [], "detail": str(exc.detail)}
            raise
    client = DigibatClient(config.base_url, config.api_key, timeout_seconds=config.timeout_seconds)
    try:
        payload = client.get_json(f"/api/collections/{quote(collection_id, safe='._-')}")
    except RuntimeError as exc:
        return {
            "projectId": pid,
            "collectionId": collection_id,
            "configured": False,
            "cells": [],
            "detail": str(exc),
        }
    child_items = payload.get("child_items") if isinstance(payload, dict) else []
    cells = []
    for child in child_items or []:
        if not isinstance(child, dict):
            continue
        if str(child.get("type") or "cells").lower() != "cells":
            continue
        refcode = str(child.get("refcode") or "").strip()
        if not refcode:
            continue
        cells.append(
            {
                "refcode": refcode,
                "name": str(child.get("name") or child.get("title") or refcode),
            }
        )
    return {"projectId": pid, "collectionId": collection_id, "configured": True, "cells": cells}


@router.get("/api/projects/{project_id}/digibat/status")
def get_project_sync_status(project_id: str):
    pid = normalize_project_id(project_id)
    with get_db() as conn:
        latest = conn.execute(
            """
            SELECT id, mode, status, totals_json, error_message, started_at, completed_at
            FROM digibat_sync_run
            WHERE project_id = ?
            ORDER BY started_at DESC
            LIMIT 1
            """,
            (pid,),
        ).fetchone()
        source_count = conn.execute(
            """
            SELECT COUNT(*) AS cnt FROM dataset d
            JOIN cell c
              ON c.project_id = d.project_id AND c.cell_id = d.cell_id
            WHERE d.project_id = ?
              AND d.name = 'cycling'
              AND (
                d.source_system = 'digibat'
                OR c.source_system = 'digibat'
              )
            """,
            (pid,),
        ).fetchone()
    if latest is None:
        return {"projectId": pid, "status": "idle", "lastRun": None, "datasetCount": int(source_count["cnt"] or 0)}
    return {
        "projectId": pid,
        "status": latest["status"],
        "lastRun": {
            "id": latest["id"],
            "mode": latest["mode"],
            "totalsJson": latest["totals_json"],
            "errorMessage": latest["error_message"],
            "startedAt": latest["started_at"],
            "completedAt": latest["completed_at"],
        },
        "datasetCount": int(source_count["cnt"] or 0),
    }


@router.get("/api/projects/{project_id}/digibat/runs")
def get_project_sync_runs(project_id: str):
    pid = normalize_project_id(project_id)
    with get_db() as conn:
        rows = conn.execute(
            """
            SELECT id, mode, status, totals_json, error_message, started_at, completed_at
            FROM digibat_sync_run
            WHERE project_id = ?
            ORDER BY started_at DESC
            LIMIT 20
            """,
            (pid,),
        ).fetchall()
    return {
        "projectId": pid,
        "runs": [
            {
                "id": r["id"],
                "mode": r["mode"],
                "status": r["status"],
                "totalsJson": r["totals_json"],
                "errorMessage": r["error_message"],
                "startedAt": r["started_at"],
                "completedAt": r["completed_at"],
            }
            for r in rows
        ],
    }
