"""Cell-record endpoints: project-scoped index, per-cell cycling curves, and sparse cycle metrics."""

from fastapi import APIRouter, HTTPException

from db import get_db
from project_scope import normalize_project_id

from ._common import (
    _cycle_summary_for_cell,
    _cycling_curves_from_storage,
    _get_cell_record_index,
    _load_rate_cells,
    _safe_int,
)

router = APIRouter()


@router.get("/api/cell-record-index")
@router.get("/api/cell-record-index.json")
def cell_record_index_scoped(projectId: str | None = None):
    """Cell list scoped to selected project."""
    return _get_cell_record_index(normalize_project_id(projectId))


@router.get("/api/cell-record/{cell_id:path}/cycle-summary")
def cell_cycle_metrics(cell_id: str, cycles: str = "10,20,50,80", projectId: str | None = None):
    """Sparse per-cycle metrics (retention / CE / capacity) for the requested
    cycles — feeds parallel coordinates and dashboard sparklines. Unrelated to
    ``compute.cycle_summary`` despite the ``/cycle-summary`` route path.
    """
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    project_id = normalize_project_id(projectId)
    want = [int(x.strip()) for x in cycles.split(",") if x.strip().isdigit()]
    rate_cells, _ = _load_rate_cells(project_id)
    for cell in rate_cells:
        if str(cell.get("cellId") or "") == cell_id:
            return _cycle_summary_for_cell(cell, want)
    raise HTTPException(status_code=404, detail=f"Cell {cell_id!r} not found in rate-performance data")


# Catch-all — keep AFTER the more specific /cycle-summary route above.
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
