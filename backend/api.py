#!/usr/bin/env python3
"""CellSeer FastAPI application entry point.

Endpoints are organised by domain in backend/routers/:
  routers/analysis.py    — GET /api/hierarchy, POST /api/hierarchy/analyse, GET /api/health
  routers/cells.py       — /api/cell-record-*, /api/rate-performance, /api/batch-cycle-summary
  routers/annotations.py — GET/PUT /api/cell-annotation/*, GET /api/cell-annotations
  routers/upload.py      — POST /api/upload, /api/upload/status/*, /api/upload/history, /api/upload/loaders
"""

import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.middleware.gzip import GZipMiddleware
from fastapi.responses import FileResponse, ORJSONResponse
from fastapi.staticfiles import StaticFiles

import auth
from db import get_db
from routers import (
    analysis,
    annotations,
    cells,
    digibat,
    projects,
    protocols,
    upload,
)

# orjson serialises the multi-MB list-heavy payloads (rate-performance,
# cell-record curves) ~10× faster than stdlib json — significant at 5k+ cells.
app = FastAPI(title="CellSeer API", default_response_class=ORJSONResponse)


@app.on_event("startup")
def _reap_orphan_digibat_sync_runs() -> None:
    """Mark any sync_run rows left in 'running' state as errored on startup.

    BackgroundTasks workers do not survive a uvicorn reload or crash, so their
    'finish_sync_run' update never lands and the UI polls forever. This cleans
    those stale rows once on every server boot.
    """
    try:
        with get_db() as conn:
            conn.execute(
                """
                UPDATE digibat_sync_run
                SET status = 'error',
                    completed_at = datetime('now'),
                    error_message = COALESCE(error_message,
                        'sync worker did not finish (orphaned by server restart)')
                WHERE status = 'running'
                """
            )
            conn.commit()
    except Exception:
        pass

def _allowed_origins() -> tuple[list[str], str]:
    """Parse CELLSEER_ALLOWED_ORIGINS into (exact_origins, fallback_regex).

    Empty / unset → dev defaults (localhost + 127.0.0.1 on any port).
    Comma-separated list of full origins → exact allow-list (production).
    """
    raw = (os.environ.get("CELLSEER_ALLOWED_ORIGINS") or "").strip()
    if not raw:
        return [], r"http://(localhost|127\.0\.0\.1)(:\d+)?"
    origins = [o.strip() for o in raw.split(",") if o.strip()]
    return origins, ""


_origins, _origin_regex = _allowed_origins()
app.add_middleware(
    CORSMiddleware,
    allow_origins=_origins,
    allow_origin_regex=_origin_regex or None,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Large JSON payloads (rate-performance, cell index — multi-MB at 5k cells)
# compress roughly 3–5×; added after CORS so compression wraps the innermost
# response. Level 5 compresses ~4× faster than the default 9 for only a few
# percent more bytes — the right trade at multi-MB payload sizes.
app.add_middleware(GZipMiddleware, minimum_size=1024, compresslevel=5)

auth.install(app)

app.include_router(analysis.router)
app.include_router(cells.router)
app.include_router(annotations.router)
app.include_router(upload.router)
app.include_router(projects.router)
app.include_router(digibat.router)
app.include_router(protocols.router)


# Serve the built SPA from the same origin when frontend/dist is present
# (production single-container layout). In local dev where the bundle does
# not exist, this block is a no-op and Vite serves the UI on a separate port.
_FRONTEND_DIST = Path(
    os.environ.get(
        "CELLSEER_FRONTEND_DIST",
        str(Path(__file__).resolve().parent.parent / "frontend" / "dist"),
    )
)
if _FRONTEND_DIST.is_dir():
    _index_file = _FRONTEND_DIST / "index.html"

    # Static asset files (JS/CSS/images) live under /assets in Vite's output.
    _assets_dir = _FRONTEND_DIST / "assets"
    if _assets_dir.is_dir():
        app.mount("/assets", StaticFiles(directory=str(_assets_dir)), name="assets")

    @app.get("/", include_in_schema=False)
    def _spa_index() -> FileResponse:
        return FileResponse(_index_file)

    @app.get("/{full_path:path}", include_in_schema=False)
    def _spa_catchall(full_path: str) -> FileResponse:
        # API routes are registered above and matched first; this only fires
        # for SPA paths (e.g. /projects, /dashboard) — return the SPA shell
        # so the client router can take over.
        candidate = _FRONTEND_DIST / full_path
        try:
            resolved = candidate.resolve()
            if not str(resolved).startswith(str(_FRONTEND_DIST.resolve())):
                return FileResponse(_index_file)
            candidate = resolved
        except Exception:
            return FileResponse(_index_file)
        if candidate.is_file():
            return FileResponse(candidate)
        return FileResponse(_index_file)
