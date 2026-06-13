"""File upload endpoints: POST /api/upload, status polling, history, loader manifest."""

import json
import sqlite3
import uuid
from pathlib import Path

from fastapi import APIRouter, BackgroundTasks, File, Form, HTTPException, UploadFile

from config import DB_PATH
from loaders.test_types import get_loader, test_type_manifest
from project_scope import ensure_project_exists, ensure_project_schema, normalize_project_id

router = APIRouter()


# ---------------------------------------------------------------------------
# Internal DB helper — WAL mode keeps the connection open for progress updates
# ---------------------------------------------------------------------------

def _upload_db() -> sqlite3.Connection:
    conn = sqlite3.connect(DB_PATH, check_same_thread=False)
    conn.row_factory = sqlite3.Row
    conn.execute("PRAGMA journal_mode=WAL")
    ensure_project_schema(conn)
    conn.execute(
        """
        CREATE TABLE IF NOT EXISTS upload_task (
          id         TEXT PRIMARY KEY,
          project_id TEXT NOT NULL DEFAULT 'default',
          filename   TEXT NOT NULL,
          file_type  TEXT,
          item_count INTEGER NOT NULL DEFAULT 1,
          status     TEXT NOT NULL DEFAULT 'queued',
          message    TEXT,
          progress   INTEGER DEFAULT 0,
          created_at TEXT DEFAULT (datetime('now')),
          updated_at TEXT DEFAULT (datetime('now'))
        )
        """
    )
    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_upload_task_created ON upload_task(created_at DESC)"
    )
    conn.commit()
    return conn


def _run_upload(task_id: str, file_bytes: bytes, filename: str, loader, ingest_options: dict) -> None:
    project_id = normalize_project_id(ingest_options.get("projectId"))

    def update_progress(progress: int, message: str) -> None:
        conn = _upload_db()
        conn.execute(
            "UPDATE upload_task SET status='processing', progress=?, message=?,"
            " updated_at=datetime('now') WHERE id=? AND project_id=?",
            (progress, message, task_id, project_id),
        )
        conn.commit()
        conn.close()

    try:
        result = loader.ingest(
            file_bytes,
            filename,
            None,
            update_progress,
            ingest_options=ingest_options,
        )
        conn = _upload_db()
        conn.execute(
            "UPDATE upload_task SET status='done', progress=100, message=?,"
            " updated_at=datetime('now') WHERE id=? AND project_id=?",
            (json.dumps(result), task_id, project_id),
        )
        conn.commit()
        conn.close()
    except Exception as exc:
        conn = _upload_db()
        conn.execute(
            "UPDATE upload_task SET status='error', message=?,"
            " updated_at=datetime('now') WHERE id=? AND project_id=?",
            (str(exc), task_id, project_id),
        )
        conn.commit()
        conn.close()


def _run_upload_batch(task_id: str, files_payload: list[tuple[bytes, str]], loader, ingest_options: dict) -> None:
    project_id = normalize_project_id(ingest_options.get("projectId"))
    total = max(len(files_payload), 1)
    results: list[dict] = []

    def write_status(status: str, progress: int, message: str) -> None:
        conn = _upload_db()
        conn.execute(
            "UPDATE upload_task SET status=?, progress=?, message=?,"
            " updated_at=datetime('now') WHERE id=? AND project_id=?",
            (status, progress, message, task_id, project_id),
        )
        conn.commit()
        conn.close()

    try:
        for i, (file_bytes, filename) in enumerate(files_payload):
            start = int((i / total) * 100)
            end = int(((i + 1) / total) * 100)

            def update_progress(local_progress: int, local_message: str) -> None:
                p = max(0, min(100, int(local_progress)))
                mapped = start + int((end - start) * (p / 100.0))
                write_status("processing", mapped, f"[{i + 1}/{total}] {filename}: {local_message}")

            result = loader.ingest(
                file_bytes,
                filename,
                None,
                update_progress,
                ingest_options=ingest_options,
            )
            results.append({"filename": filename, "result": result})

        write_status(
            "done",
            100,
            json.dumps({"fileCount": len(files_payload), "results": results[:20]}),
        )
    except Exception as exc:
        write_status("error", 100, str(exc))


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/api/upload/loaders")
def upload_loaders():
    """List all registered test types and the file extensions each accepts."""
    return {"loaders": test_type_manifest()}


@router.post("/api/upload")
async def upload_file(
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    projectId: str | None = Form(default=None),
    fileType: str | None = Form(default=None),
    primaryKeyHeader: str | None = Form(default=None),
    idNoHeader: str | None = Form(default=None),
    displayNameTemplate: str | None = Form(default=None),
    metadataSheet: str | None = Form(default=None),
):
    """Accept a file upload, queue a background ingest task, return task ID."""
    filename = file.filename or ""
    preferred_file_type = fileType.strip().lower() if fileType else None
    loader = get_loader(filename, preferred_file_type=preferred_file_type)
    if loader is None:
        suffix = Path(filename).suffix
        if preferred_file_type:
            raise HTTPException(
                status_code=415,
                detail=f"No loader for '{suffix}' under requested fileType '{preferred_file_type}'",
            )
        raise HTTPException(status_code=415, detail=f"No loader for '{suffix}'")

    MAX_UPLOAD_BYTES = 512 * 1024 * 1024  # 512 MB
    file_bytes = await file.read()
    if len(file_bytes) > MAX_UPLOAD_BYTES:
        raise HTTPException(status_code=413, detail="File too large (max 512 MB)")
    project_id = normalize_project_id(projectId)
    conn = _upload_db()
    ensure_project_exists(conn, project_id)

    # Deduplication: reuse an in-progress task for the same filename.
    existing = conn.execute(
        """
        SELECT id
        FROM upload_task
        WHERE project_id=?
          AND filename=?
          AND status IN ('queued','processing')
          AND updated_at >= datetime('now', '-20 minutes')
        """,
        (project_id, filename),
    ).fetchone()
    if existing:
        conn.close()
        return {
            "taskId": existing["id"],
            "filename": filename,
            "fileType": loader.FILE_TYPE,
            "status": "already_processing",
        }

    task_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO upload_task(id, project_id, filename, file_type, item_count, status) VALUES(?,?,?,?,?, 'queued')",
        (task_id, project_id, filename, loader.FILE_TYPE, 1),
    )
    conn.commit()
    conn.close()

    ingest_options = {
        "primaryKeyHeader": primaryKeyHeader,
        "idNoHeader": idNoHeader,
        "displayNameTemplate": displayNameTemplate,
        "metadataSheet": metadataSheet,
        "projectId": project_id,
    }
    background_tasks.add_task(_run_upload, task_id, file_bytes, filename, loader, ingest_options)
    return {
        "taskId": task_id,
        "filename": filename,
        "fileType": loader.FILE_TYPE,
        "status": "queued",
        "projectId": project_id,
    }


@router.post("/api/upload/batch")
async def upload_files_batch(
    background_tasks: BackgroundTasks,
    files: list[UploadFile] = File(...),
    projectId: str | None = Form(default=None),
    fileType: str | None = Form(default=None),
    primaryKeyHeader: str | None = Form(default=None),
    idNoHeader: str | None = Form(default=None),
    displayNameTemplate: str | None = Form(default=None),
    metadataSheet: str | None = Form(default=None),
):
    """Accept multiple files and process them in one backend task."""
    if not files:
        raise HTTPException(status_code=400, detail="No files provided")

    project_id = normalize_project_id(projectId)
    preferred_file_type = fileType.strip().lower() if fileType else None
    first_name = files[0].filename or ""
    loader = get_loader(first_name, preferred_file_type=preferred_file_type)
    if loader is None:
        suffix = Path(first_name).suffix
        raise HTTPException(
            status_code=415,
            detail=f"No loader for '{suffix}' under requested fileType '{preferred_file_type or 'auto'}'",
        )

    file_payload: list[tuple[bytes, str]] = []
    for f in files:
        filename = f.filename or ""
        each_loader = get_loader(filename, preferred_file_type=preferred_file_type)
        if each_loader is None or each_loader.FILE_TYPE != loader.FILE_TYPE:
            suffix = Path(filename).suffix
            raise HTTPException(
                status_code=415,
                detail=f"File '{filename}' with suffix '{suffix}' is not compatible with fileType '{loader.FILE_TYPE}'",
            )
        MAX_UPLOAD_BYTES = 512 * 1024 * 1024  # 512 MB
        file_bytes_data = await f.read()
        if len(file_bytes_data) > MAX_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail=f"File '{filename}' too large (max 512 MB)")
        file_payload.append((file_bytes_data, filename))

    conn = _upload_db()
    ensure_project_exists(conn, project_id)
    task_id = str(uuid.uuid4())
    pseudo_name = f"{len(file_payload)} files ({file_payload[0][1]})"
    conn.execute(
        "INSERT INTO upload_task(id, project_id, filename, file_type, item_count, status) VALUES(?,?,?,?,?, 'queued')",
        (task_id, project_id, pseudo_name, loader.FILE_TYPE, len(file_payload)),
    )
    conn.commit()
    conn.close()

    ingest_options = {
        "primaryKeyHeader": primaryKeyHeader,
        "idNoHeader": idNoHeader,
        "displayNameTemplate": displayNameTemplate,
        "metadataSheet": metadataSheet,
        "projectId": project_id,
    }
    background_tasks.add_task(_run_upload_batch, task_id, file_payload, loader, ingest_options)
    return {
        "taskId": task_id,
        "filename": pseudo_name,
        "fileType": loader.FILE_TYPE,
        "status": "queued",
        "projectId": project_id,
        "itemCount": len(file_payload),
    }


@router.post("/api/upload/metadata-options")
async def metadata_upload_options(file: UploadFile = File(...)):
    """Inspect metadata file and return candidate primary-key columns for user selection."""
    filename = file.filename or ""
    loader = get_loader(filename)
    if loader is None:
        suffix = Path(filename).suffix
        raise HTTPException(status_code=415, detail=f"No loader for '{suffix}'")
    if getattr(loader, "FILE_TYPE", None) != "metadata":
        raise HTTPException(status_code=400, detail="File type is not metadata")

    inspect = getattr(loader, "inspect", None)
    if not callable(inspect):
        raise HTTPException(status_code=500, detail="Metadata inspection is not available")

    file_bytes = await file.read()
    info = inspect(file_bytes, filename)
    return {
        "fileType": "metadata",
        "keyCandidates": info.get("key_candidates", []),
        "defaultPrimaryKey": info.get("default_primary_key"),
        "requiresChoice": info.get("requires_primary_key_choice", False),
        "idNoCandidates": info.get("id_no_candidates", []),
        "defaultIdNoHeader": info.get("default_id_no_header"),
        "requiresIdNoChoice": info.get("requires_id_no_choice", False),
        "sheetName": info.get("sheet_name"),
        "sheetNames": info.get("sheet_names", []),
        "headerColumns": info.get("headers", []),
        "displayNameTemplate": info.get(
            "display_name_template", "{cathode}_{anode}_R{repeat}_ID{id_no}"
        ),
    }


@router.post("/api/cells/{cell_id}/files/{test_type}")
async def upload_cell_test_file(
    cell_id: str,
    test_type: str,
    background_tasks: BackgroundTasks,
    file: UploadFile = File(...),
    projectId: str | None = Form(default=None),
):
    """Attach a test file (currently ``cycling``) to a specific cell.

    Unlike :func:`upload_file`, this route bypasses filename-based ``id_no``
    matching by forwarding the resolved ``cell_id`` / ``id_no`` to the loader.
    The path is shaped as ``/api/cells/{cell_id}/files/{test_type}`` so future
    test artifacts (e.g. ``formation``, ``eis``, ``dqdv``) can register their
    own loaders and reuse the same endpoint without a route migration.
    """
    project_id = normalize_project_id(projectId)
    test_type_key = (test_type or "").strip().lower()
    if not test_type_key:
        raise HTTPException(status_code=400, detail="test_type is required")

    # Today we only ingest cycling files per-cell; surface a clear 415 for
    # other test types so the frontend can fall back gracefully.
    SUPPORTED_PER_CELL_TEST_TYPES = {"cycling"}
    if test_type_key not in SUPPORTED_PER_CELL_TEST_TYPES:
        raise HTTPException(
            status_code=415,
            detail=(
                f"test_type '{test_type_key}' is not yet supported for per-cell upload. "
                f"Supported: {sorted(SUPPORTED_PER_CELL_TEST_TYPES)}"
            ),
        )

    filename = file.filename or ""
    loader = get_loader(filename, preferred_file_type=test_type_key)
    if loader is None:
        suffix = Path(filename).suffix
        raise HTTPException(
            status_code=415,
            detail=f"No loader for '{suffix}' under test_type '{test_type_key}'",
        )

    # Verify the cell exists in this project so the user gets a 404 up-front
    # instead of an opaque error inside the background task.
    conn = _upload_db()
    ensure_project_exists(conn, project_id)
    cell_row = conn.execute(
        "SELECT id_no FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
        (project_id, cell_id),
    ).fetchone()
    if cell_row is None:
        conn.close()
        raise HTTPException(
            status_code=404,
            detail=f"Cell '{cell_id}' not found in project '{project_id}'",
        )
    resolved_id_no = cell_row["id_no"]

    file_bytes = await file.read()

    task_id = str(uuid.uuid4())
    conn.execute(
        "INSERT INTO upload_task(id, project_id, filename, file_type, item_count, status) "
        "VALUES(?,?,?,?,?, 'queued')",
        (task_id, project_id, filename, loader.FILE_TYPE, 1),
    )
    conn.commit()
    conn.close()

    ingest_options = {
        "projectId": project_id,
        "cellId": cell_id,
        "idNo": resolved_id_no,
        # Forward in both casings so loaders that read snake_case still work.
        "cell_id": cell_id,
        "id_no": resolved_id_no,
    }
    background_tasks.add_task(_run_upload, task_id, file_bytes, filename, loader, ingest_options)
    return {
        "taskId": task_id,
        "filename": filename,
        "fileType": loader.FILE_TYPE,
        "cellId": cell_id,
        "testType": test_type_key,
        "status": "queued",
        "projectId": project_id,
    }


@router.get("/api/upload/status/{task_id}")
def upload_status(task_id: str, projectId: str | None = None):
    """Poll the status of an upload task by its ID."""
    project_id = normalize_project_id(projectId)
    conn = _upload_db()
    row = conn.execute(
        "SELECT * FROM upload_task WHERE id=? AND project_id=?",
        (task_id, project_id),
    ).fetchone()
    conn.close()
    if row is None:
        raise HTTPException(status_code=404, detail="Task not found")
    return dict(row)


@router.get("/api/upload/history")
def upload_history(projectId: str | None = None):
    """Return the 20 most recent upload tasks."""
    project_id = normalize_project_id(projectId)
    conn = _upload_db()
    rows = conn.execute(
        "SELECT * FROM upload_task WHERE project_id=? ORDER BY created_at DESC LIMIT 20",
        (project_id,),
    ).fetchall()
    conn.close()
    return {"tasks": [dict(r) for r in rows]}
