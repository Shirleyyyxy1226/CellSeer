#!/usr/bin/env python3
"""CellSeer FastAPI application entry point.

Endpoints are organised by domain in backend/routers/:
  routers/analysis.py    — GET /api/hierarchy, POST /api/hierarchy/analyse, GET /api/health
  routers/cells.py       — /api/cell-record-*, /api/rate-performance, /api/batch-cycle-summary
  routers/annotations.py — GET/PUT /api/cell-annotation/*, GET /api/cell-annotations
  routers/upload.py      — POST /api/upload, /api/upload/status/*, /api/upload/history, /api/upload/loaders
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent))

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from routers import analysis, annotations, cells, projects, upload

app = FastAPI(title="CellSeer API")

app.add_middleware(
    CORSMiddleware,
    allow_origins=[],
    allow_origin_regex=r"http://(localhost|127\.0\.0\.1)(:\d+)?",
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(analysis.router)
app.include_router(cells.router)
app.include_router(annotations.router)
app.include_router(upload.router)
app.include_router(projects.router)
