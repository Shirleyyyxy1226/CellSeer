"""Master Plot overview aggregate endpoint (05 · FR-1).

Returns per-condition aggregates + a compact per-cell scalar table for the
overview, instead of the full per-cycle arrays that /api/rate-performance ships.
At 50k cells that is ~hundreds of KB of JSON vs ~60 MB — the difference between
an interactive overview and a frozen tab.

The reduction (master_plot_overview.build_overview) is the proven twin of the
client pipeline; see backend/tests/test_master_plot_parity.py. This router only
wires the existing cached cell loader to it, so it inherits the per-file
cycle-summary cache and parallel Parquet reads for free.
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
    # Project-level protocol presence. The aggregate ships per-cell scalars but
    # not the protocol fields, yet the frontend needs to know whether ANY cell
    # has a resolved protocol to gate the protocol-locked metrics (retention,
    # fade, cycle-life, CE-drift). Computed here in the router from the raw
    # cells so the parity-locked build_overview reduction stays untouched.
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
    """Per-cell dQ/dV peak-shift scalars (04 · FR-4).

    Lazy / on-demand: the differential Parquet is large and only the
    dQ/dV-shift metric needs it, so the frontend fetches this only when that
    metric is selected, and greys it out (from the cell index) when the project
    has no differential data. See master_plot_peakshift.build_peak_shift.
    """
    return build_peak_shift(normalize_project_id(projectId))
