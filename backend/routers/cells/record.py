"""Cell-record endpoints: project-scoped index and per-cell cycling curves."""

from fastapi import APIRouter, HTTPException

from db import get_db
from project_scope import normalize_project_id

from ._common import _cycling_curves_from_storage, _get_cell_record_index, _safe_int

router = APIRouter()


@router.get("/api/cell-record-index")
@router.get("/api/cell-record-index.json")
def cell_record_index_scoped(projectId: str | None = None):
    """Cell list scoped to selected project."""
    return _get_cell_record_index(normalize_project_id(projectId))


@router.get("/api/cell-record/{cell_id:path}")
def cell_record(
    cell_id: str,
    projectId: str | None = None,
    maxPointsPerCycle: int | None = None,
):
    """Per-cell cycling curves from DB (project-scoped).

    `maxPointsPerCycle` stride-samples each cycle's trace (final point always
    kept) — full-resolution GCD curves are ~9 MB per cell, which dashboards
    don't need to draw a faithful line. Omit for the complete dataset.
    """
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    if maxPointsPerCycle is not None and maxPointsPerCycle < 50:
        raise HTTPException(status_code=400, detail="maxPointsPerCycle must be ≥ 50")
    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT c.cell_id, c.id_no, d.storage_uri AS cycling_uri
            FROM cell c
            JOIN dataset d
              ON d.project_id = c.project_id
             AND d.cell_id = c.cell_id
             AND d.name = 'cycling'
             AND d.deleted_at IS NULL
            WHERE c.project_id = ?
              AND c.cell_id = ?
              AND c.deleted_at IS NULL
            """,
            (project_id, cell_id),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Cell record {cell_id!r} not found")
    cycling_uri = row["cycling_uri"]
    if not cycling_uri:
        raise HTTPException(status_code=404, detail=f"Cycling curves for cell {cell_id!r} not found")
    curves = _cycling_curves_from_storage(cycling_uri, max_points_per_cycle=maxPointsPerCycle)
    if not curves:
        raise HTTPException(status_code=404, detail=f"Cycling curves for cell {cell_id!r} not found")
    id_no = _safe_int(row["id_no"])
    return {
        "cellId": row["cell_id"] or cell_id,
        "cellName": row["cell_id"] or cell_id,
        "idNo": id_no,
        "curves": curves,
    }
