"""Differential capacity/voltage endpoints: dQ/dV and dV/dQ."""

from typing import Dict

import polars as pl
from fastapi import APIRouter, HTTPException

from dataset_store import read_dataset_parquet
from db import get_db, get_or_404
from project_scope import normalize_project_id

from ._common import (
    _curve_cache_get,
    _curve_cache_put,
    _file_stamp,
    _prepare_cycling_df,
)

router = APIRouter()


@router.get("/api/differential-cells")
def differential_cells(projectId: str | None = None, direction: str = "discharge"):
    """List cell_id values that have both dQ/dV and dV/dQ datasets."""
    direction = (direction or "discharge").strip().lower()
    if direction not in {"discharge", "charge"}:
        raise HTTPException(status_code=400, detail="direction must be 'discharge' or 'charge'")

    project_id = normalize_project_id(projectId)
    dqdv_names = [f"{direction}_dqdv"]
    dvdq_names = [f"{direction}_dvdq"]
    if direction == "discharge":
        # Backward compatibility for legacy single-direction names.
        dqdv_names.append("dqdv")
        dvdq_names.append("dvdq")

    placeholders_dqdv = ",".join("?" for _ in dqdv_names)
    placeholders_dvdq = ",".join("?" for _ in dvdq_names)
    params: list[object] = [project_id, *dqdv_names, *dvdq_names]

    with get_db() as conn:
        rows = conn.execute(
            f"""
            SELECT c.cell_id
            FROM cell c
            JOIN dataset d
              ON d.project_id = c.project_id
             AND d.cell_id = c.cell_id
             AND d.deleted_at IS NULL
            WHERE c.project_id = ?
              AND c.deleted_at IS NULL
            GROUP BY c.cell_id
            HAVING SUM(CASE WHEN d.name IN ({placeholders_dqdv}) THEN 1 ELSE 0 END) > 0
               AND SUM(CASE WHEN d.name IN ({placeholders_dvdq}) THEN 1 ELSE 0 END) > 0
            ORDER BY c.cell_id
            """,
            params,
        ).fetchall()

    cell_ids = [r["cell_id"] for r in rows if r["cell_id"]]
    return {"cellIds": cell_ids}


# The stored dQ/dV parquet is precomputed at these defaults; any other combination
# from the "Adjust smoothing" panel is recomputed on the fly from raw cycling data.
_DEFAULT_DIFF = ("lean", 180, 5)
_LEAN_KERNELS = {
    3: [0.25, 0.5, 0.25],
    5: [0.0668, 0.2417, 0.3830, 0.2417, 0.0668],
    7: [0.1059, 0.121, 0.1745, 0.1972, 0.1745, 0.121, 0.1059],
}


def _differential_on_the_fly(
    project_id: str, cell_id: str, direction: str, method: str, target_bins: int, kernel_pts: int
) -> Dict[str, dict]:
    """Recompute dQ/dV & dV/dQ for one cell with custom method/params from raw cycling."""
    with get_db() as conn:
        row = conn.execute(
            "SELECT storage_uri FROM dataset WHERE project_id = ? AND cell_id = ? "
            "AND name = 'cycling' AND deleted_at IS NULL",
            (project_id, cell_id),
        ).fetchone()
    if not row or not row["storage_uri"]:
        return {}
    df = _prepare_cycling_df(row["storage_uri"])
    if not {"Cycle", "Current [A]", "Voltage [V]", "Capacity [Ah]"}.issubset(set(df.columns)):
        return {}
    from compute.data.cycling_data import CyclingData
    from compute.analysis.cycling.differentiation import dqdv as _dqdv, dvdq as _dvdq

    kernel = _LEAN_KERNELS.get(kernel_pts)
    cycles: Dict[str, dict] = {}
    for cyc_val in sorted(df["Cycle"].unique().to_list()):
        cd = CyclingData(lf=df.filter(pl.col("Cycle") == cyc_val).lazy(), info={})
        trace = cd.discharge() if direction == "discharge" else cd.charge()
        try:
            rq = _dqdv(trace, method=method, lean_target_bins=target_bins, lean_kernel=kernel).data
            rv = _dvdq(trace, method=method, lean_target_bins=target_bins, lean_kernel=kernel).data
        except Exception:
            continue
        cycles[str(int(cyc_val))] = {
            "dqdv": {"v": rq["Voltage [V]"].to_list(), "dqdv": rq["dQ/dV [Ah/V]"].to_list()},
            "dvdq": {"q": rv["Capacity [Ah]"].to_list(), "dvdq": rv["dV/dQ [V/Ah]"].to_list()},
        }
    return cycles


@router.get("/api/cell-record/{cell_id:path}/differential")
def differential(
    cell_id: str,
    projectId: str | None = None,
    direction: str = "discharge",
    method: str = "lean",
    targetBins: int = 180,
    kernel: int = 5,
):
    """dQ/dV and dV/dQ for one cell. Default smoothing reads the precomputed parquet;
    custom params (the "Adjust smoothing" panel) recompute on the fly."""
    direction = (direction or "discharge").strip().lower()
    if direction not in {"discharge", "charge"}:
        raise HTTPException(status_code=400, detail="direction must be 'discharge' or 'charge'")
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    method = (method or "lean").strip().lower()
    if method not in {"lean", "raw"}:
        raise HTTPException(status_code=400, detail="method must be 'lean' or 'raw'")

    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        get_or_404(
            conn,
            "SELECT 1 FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
            f"Cell {cell_id!r} not found",
        )

        if (method, targetBins, kernel) != _DEFAULT_DIFF:
            otf_key = ("differential-otf", project_id, cell_id, direction, method, targetBins, kernel)
            cached = _curve_cache_get(otf_key)
            if cached is None:
                cached = _differential_on_the_fly(project_id, cell_id, direction, method, targetBins, kernel)
                _curve_cache_put(otf_key, cached)
            return {"cellId": cell_id, "direction": direction, "cycles": cached}

        dqdv_name = f"{direction}_dqdv"
        dvdq_name = f"{direction}_dvdq"
        dqdv_row = conn.execute(
            "SELECT storage_uri FROM dataset WHERE project_id = ? AND cell_id = ? AND name = ? AND deleted_at IS NULL",
            (project_id, cell_id, dqdv_name),
        ).fetchone()
        dvdq_row = conn.execute(
            "SELECT storage_uri FROM dataset WHERE project_id = ? AND cell_id = ? AND name = ? AND deleted_at IS NULL",
            (project_id, cell_id, dvdq_name),
        ).fetchone()
        # Backward compatibility for legacy single-direction rows.
        if direction == "discharge" and (dqdv_row is None or dvdq_row is None):
            if dqdv_row is None:
                dqdv_row = conn.execute(
                    "SELECT storage_uri FROM dataset WHERE project_id = ? AND cell_id = ? AND name = 'dqdv' AND deleted_at IS NULL",
                    (project_id, cell_id),
                ).fetchone()
            if dvdq_row is None:
                dvdq_row = conn.execute(
                    "SELECT storage_uri FROM dataset WHERE project_id = ? AND cell_id = ? AND name = 'dvdq' AND deleted_at IS NULL",
                    (project_id, cell_id),
                ).fetchone()

    dqdv_uri = dqdv_row["storage_uri"] if dqdv_row else None
    dvdq_uri = dvdq_row["storage_uri"] if dvdq_row else None
    cache_key = (
        "differential",
        dqdv_uri,
        dvdq_uri,
        _file_stamp(dqdv_uri) if dqdv_uri else None,
        _file_stamp(dvdq_uri) if dvdq_uri else None,
    )
    cached = _curve_cache_get(cache_key)
    if cached is not None:
        return {"cellId": cell_id, "direction": direction, "cycles": cached}

    cycles: Dict[str, dict] = {}

    if dqdv_uri:
        df = read_dataset_parquet(dqdv_uri)
        if "Cycle" in df.columns:
            for (cyc_val,), group in df.group_by("Cycle"):
                cyc = str(int(cyc_val))
                cycles.setdefault(cyc, {})["dqdv"] = {
                    "v": group["Voltage [V]"].to_list(),
                    "dqdv": group["dQ/dV [Ah/V]"].to_list(),
                }

    if dvdq_uri:
        df = read_dataset_parquet(dvdq_uri)
        if "Cycle" in df.columns:
            for (cyc_val,), group in df.group_by("Cycle"):
                cyc = str(int(cyc_val))
                cycles.setdefault(cyc, {})["dvdq"] = {
                    "q": group["Capacity [Ah]"].to_list(),
                    "dvdq": group["dV/dQ [V/Ah]"].to_list(),
                }

    _curve_cache_put(cache_key, cycles)
    return {"cellId": cell_id, "direction": direction, "cycles": cycles}
