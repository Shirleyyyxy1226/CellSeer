"""Master Plot overview aggregate endpoint.

Returns a per-condition category map and a per-cell scalar table for the overview.
The per-cell scalars are the source of truth for the metric columns; the frontend
derives condition statistics and flags from them. Wires the cached cell loader to
build_overview, inheriting the per-file cycle-summary cache and parallel Parquet
reads.
"""

from fastapi import APIRouter, Query

from master_plot_overview import build_overview
from master_plot_peakshift import build_peak_shift
from project_scope import normalize_project_id
from routers.cells import _load_rate_cells

router = APIRouter()


@router.get("/api/master-plot/overview")
def master_plot_overview(projectId: str | None = Query(default=None)) -> dict:
    cells, _cathodes = _load_rate_cells(projectId)
    result = build_overview(cells)
    # How many cells have a resolved protocol — lets the frontend gate the
    # protocol-locked metrics (retention, fade, cycle-life, CE-drift).
    protocol_cell_count = sum(
        1 for c in cells if c.get("protocolSegments") or c.get("protocol")
    )
    return {
        "projectId": projectId,
        "cellCount": len(result["cells"]),
        "conditionCount": len(result["conditions"]),
        "protocolCellCount": protocol_cell_count,
        **result,
    }


@router.get("/api/master-plot/peak-shift")
def master_plot_peak_shift(projectId: str | None = Query(default=None)) -> dict:
    """Per-cell dQ/dV peak-shift scalars.

    Lazy / on-demand: the differential Parquet is large and only the
    dQ/dV-shift metric needs it, so the frontend fetches this only when that
    metric is selected, and greys it out when the project has no differential data.
    """
    return build_peak_shift(normalize_project_id(projectId))
