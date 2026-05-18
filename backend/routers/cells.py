"""Cell record endpoints: index, per-cell record, ICA/DVQ, rate performance, cycle summaries."""

import io
import json
import re
import sqlite3
from typing import Dict, List, Optional

import polars as pl
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel

from db import get_db, get_or_404
from project_scope import normalize_project_id

router = APIRouter()


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _cell_number_token(cell_id: str | None) -> int | None:
    if not cell_id:
        return None
    m = re.search(r"(?:^|[^a-z0-9])(?:cel|cell)[-_ ]*(\d+)(?:[^a-z0-9]|$)", cell_id, flags=re.IGNORECASE)
    if not m:
        return None
    try:
        return int(m.group(1))
    except Exception:
        return None


def _dedupe_index_rows(rows: list[sqlite3.Row]) -> list[sqlite3.Row]:
    out: dict[object, sqlite3.Row] = {}

    def score(r: sqlite3.Row) -> tuple[int, int]:
        has_id_no = 1 if r["id_no"] is not None else 0
        prefixed = 1 if (r["cell_id"] and str(r["cell_id"]).upper().startswith("P")) else 0
        return (has_id_no, prefixed)

    for r in rows:
        token = _cell_number_token(r["cell_id"])
        key: object = token if token is not None else f"cell_id::{r['cell_id']}"
        if key not in out or score(r) > score(out[key]):
            out[key] = r
    return list(out.values())


def _safe_int(value: object) -> int | None:
    if value is None:
        return None
    try:
        return int(value)
    except Exception:
        return None


def _get_cell_record_index(project_id: str) -> dict:
    try:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT c.rowid AS _rowid, c.id_no, c.cell_id, c.cathode, c.separator_type, c.spacer_mm,
                       c.cathode_mass, c.electrolyte
                FROM cell c
                WHERE c.project_id = ?
                """
                ,
                (project_id,),
            ).fetchall()
    except sqlite3.OperationalError:
        # DB-only mode: if DB schema isn't initialized, return empty index (no JSON fallback).
        return {"cells": []}
    rows = _dedupe_index_rows(rows)
    index = []
    for r in rows:
        id_no = _safe_int(r["id_no"])
        if id_no is None:
            rowid = _safe_int(r["_rowid"])
            # Keep the API responsive even if metadata rows miss id_no.
            if rowid is None:
                continue
            id_no = -rowid
        cathode_mass_g = (
            float(r["cathode_mass"])
            if r["cathode_mass"] is not None and r["cathode_mass"] > 0
            else None
        )
        index.append(
            {
                "idNo": id_no,
                "cellId": r["cell_id"] or "",
                "cellName": (r["cell_id"] or f"Cell {id_no}"),
                "cathode": r["cathode"] or "",
                "separatorType": r["separator_type"] or "",
                "spacerMm": float(r["spacer_mm"]) if r["spacer_mm"] is not None else None,
                "cathodeMassG": cathode_mass_g,
                "electrolyte": (r["electrolyte"] or "").strip(),
            }
        )
    return {"cells": index}


def _parse_c_rate_value(value: object) -> float | None:
    if value is None:
        return None
    if isinstance(value, (int, float)):
        try:
            return float(value)
        except Exception:
            return None
    s = str(value).strip().upper()
    if not s:
        return None
    if s.startswith("C/"):
        try:
            denom = float(s[2:])
            return (1.0 / denom) if denom > 0 else None
        except Exception:
            return None
    if s.endswith("C"):
        base = s[:-1].strip()
        if base.startswith("/"):
            try:
                denom = float(base[1:])
                return (1.0 / denom) if denom > 0 else None
            except Exception:
                return None
        try:
            return float(base)
        except Exception:
            return None
    try:
        return float(s)
    except Exception:
        return None


def _parse_protocol_meta(meta_json: str | None) -> tuple[str | None, list[dict], dict[int, float]]:
    if not meta_json:
        return (None, [], {})
    try:
        data = json.loads(meta_json)
    except Exception:
        return (None, [], {})
    segs = data.get("protocol")
    if not isinstance(segs, list):
        return (None, [], {})

    labels: list[str] = []
    out_segments: list[dict] = []
    cycle_to_rate: dict[int, float] = {}
    for seg in segs:
        if not isinstance(seg, dict):
            continue
        try:
            start = int(seg.get("cycleStart"))
            end = int(seg.get("cycleEnd"))
        except Exception:
            continue
        if end < start:
            continue
        raw_rate = seg.get("cRate")
        rate_val = _parse_c_rate_value(raw_rate)
        if rate_val is None:
            continue
        label = str(raw_rate)
        labels.append(label)
        out_segments.append({"cycleStart": start, "cycleEnd": end, "cRate": rate_val})
        for cyc in range(start, end + 1):
            cycle_to_rate[cyc] = rate_val

    if not out_segments:
        return (None, [], {})
    protocol_name = " | ".join(dict.fromkeys(labels))
    return (protocol_name, out_segments, cycle_to_rate)


def _prepare_cycling_df(cycling_blob: bytes) -> pl.DataFrame:
    df = pl.read_parquet(io.BytesIO(cycling_blob))
    if "Cycle" not in df.columns:
        if "Event" in df.columns:
            df = df.rename({"Event": "Cycle"})
        elif "Step" in df.columns:
            df = df.rename({"Step": "Cycle"})
    return df


def _build_rate_payload_for_cell(row: sqlite3.Row) -> dict | None:
    id_no = _safe_int(row["id_no"])
    if id_no is None:
        return None

    try:
        df = _prepare_cycling_df(row["cycling_blob"])
    except Exception:
        return None
    required = {"Cycle", "Current [A]", "Capacity [Ah]"}
    if not required.issubset(set(df.columns)):
        return None

    # Summarize per-cycle charge/discharge capacities in Ah.
    thr = 1e-9
    try:
        summary = (
            df.with_columns([
                pl.when(pl.col("Current [A]") > thr).then(pl.col("Capacity [Ah]")).otherwise(None).alias("_chg"),
                pl.when(pl.col("Current [A]") < -thr).then(pl.col("Capacity [Ah]")).otherwise(None).alias("_dch"),
            ])
            .group_by("Cycle")
            .agg([
                (pl.col("_chg").max() - pl.col("_chg").min()).alias("chg_ah"),
                (pl.col("_dch").max() - pl.col("_dch").min()).alias("dch_ah"),
            ])
            .sort("Cycle")
        )
    except Exception:
        return None

    cycles: list[int] = []
    charge_m_ah: list[float] = []
    discharge_m_ah: list[float] = []
    for r in summary.iter_rows(named=True):
        try:
            cyc = int(r["Cycle"])
        except Exception:
            continue
        chg = float(r["chg_ah"]) if r["chg_ah"] is not None else 0.0
        dch = float(r["dch_ah"]) if r["dch_ah"] is not None else 0.0
        cycles.append(cyc)
        charge_m_ah.append(chg * 1000.0)
        discharge_m_ah.append(dch * 1000.0)

    if not cycles:
        return None

    protocol_name, protocol_segments, cycle_to_rate = _parse_protocol_meta(row["dataset_meta"])
    c_rates: list[float] | None = None
    if cycle_to_rate and all(c in cycle_to_rate for c in cycles):
        c_rates = [cycle_to_rate[c] for c in cycles]

    cathode_mass = float(row["cathode_mass"]) if row["cathode_mass"] is not None else None
    specific_capacity: list[float] | None = None
    if cathode_mass is not None and cathode_mass > 0:
        specific_capacity = [x / cathode_mass for x in discharge_m_ah]

    payload: dict = {
        "idNo": id_no,
        "cellId": row["cell_id"] or "",
        "cellName": row["cell_id"] or f"Cell {id_no}",
        "cathode": row["cathode"] or "",
        "separatorType": row["separator_type"] or "",
        "spacerMm": float(row["spacer_mm"]) if row["spacer_mm"] is not None else None,
        "protocol": protocol_name,
        "cycles": cycles,
        "dischargeCapacityMah": discharge_m_ah,
        "chargeCapacityMah": charge_m_ah,
        "specificCapacityMahG": specific_capacity,
    }
    if c_rates is not None:
        payload["cRates"] = c_rates
    if protocol_segments:
        payload["protocolSegments"] = protocol_segments
    return payload


def _load_rate_cells(project_id: str) -> tuple[list[dict], list[str]]:
    try:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT c.id_no, c.cell_id, c.cathode, c.separator_type, c.spacer_mm, c.cathode_mass,
                       d.data AS cycling_blob, d.meta AS dataset_meta
                FROM cell c
                JOIN dataset d
                  ON d.project_id = c.project_id
                 AND d.cell_id = c.cell_id
                 AND d.name = 'cycling'
                WHERE c.project_id = ?
                  AND c.id_no IS NOT NULL
                ORDER BY c.id_no
                """,
                (project_id,),
            ).fetchall()
    except sqlite3.OperationalError:
        return ([], [])

    cells: list[dict] = []
    protocols: list[str] = []
    for row in rows:
        payload = _build_rate_payload_for_cell(row)
        if payload is None:
            continue
        cells.append(payload)
        protocol = payload.get("protocol")
        if isinstance(protocol, str) and protocol and protocol not in protocols:
            protocols.append(protocol)
    return (cells, protocols)


def _cycling_curves_from_blob(cycling_blob: bytes) -> dict[str, dict[str, list]]:
    df = _prepare_cycling_df(cycling_blob)
    if "Cycle" not in df.columns:
        return {}
    keep_cols = [c for c in ["Time [s]", "Voltage [V]", "Capacity [Ah]", "Current [A]", "Step", "Cycle"] if c in df.columns]
    if not keep_cols:
        return {}
    slim = df.select(keep_cols)
    curves: dict[str, dict[str, list]] = {}
    for (cyc_val,), group in slim.group_by("Cycle"):
        try:
            cyc = str(int(cyc_val))
        except Exception:
            continue
        curves[cyc] = {col: group[col].to_list() for col in group.columns if col != "Cycle"}
    return curves


def _cycle_summary_for_cell(cell: dict, cycles: List[int]) -> dict:
    cyc_list = cell.get("cycles") or []
    spec = cell.get("specificCapacityMahG") or []
    dch = cell.get("dischargeCapacityMah") or []
    chg = cell.get("chargeCapacityMah") or []
    out = []
    for c in cycles:
        row: dict = {"cycle": c, "retention": None, "ce": None, "capacity": None}
        try:
            idx = cyc_list.index(c)
        except ValueError:
            out.append(row)
            continue
        if idx < len(spec) and spec[idx] is not None:
            base = spec[0] if spec and spec[0] else 1
            if base and float(base) > 0:
                row["retention"] = round(100.0 * float(spec[idx]) / float(base), 4)
            row["capacity"] = float(spec[idx])
        if idx < len(dch) and idx < len(chg) and chg[idx] and float(chg[idx]) > 1e-9:
            row["ce"] = round(100.0 * float(dch[idx]) / float(chg[idx]), 4)
        out.append(row)
    return {"idNo": int(cell.get("idNo", 0)), "cycles": out}


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/api/cell-record-index")
@router.get("/api/cell-record-index.json")
def cell_record_index_scoped(projectId: str | None = None):
    """Cell list scoped to selected project."""
    return _get_cell_record_index(normalize_project_id(projectId))


@router.get("/api/ica-cells")
def ica_cells(projectId: str | None = None, direction: str = "discharge"):
    """List cell id_no values that have both dQ/dV and dV/dQ datasets."""
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
            SELECT c.id_no
            FROM cell c
            JOIN dataset d
              ON d.project_id = c.project_id
             AND d.cell_id = c.cell_id
            WHERE c.project_id = ?
              AND c.id_no IS NOT NULL
            GROUP BY c.id_no
            HAVING SUM(CASE WHEN d.name IN ({placeholders_dqdv}) THEN 1 ELSE 0 END) > 0
               AND SUM(CASE WHEN d.name IN ({placeholders_dvdq}) THEN 1 ELSE 0 END) > 0
            ORDER BY c.id_no
            """,
            params,
        ).fetchall()

    id_nos = []
    for r in rows:
        id_no = _safe_int(r["id_no"])
        if id_no is not None:
            id_nos.append(id_no)
    return {"idNos": id_nos}


@router.get("/api/cell-record/{id_no:int}/ica-dvq")
def ica_dvq(id_no: int, projectId: str | None = None, direction: str = "discharge"):
    """Pre-computed dQ/dV and dV/dQ for one cell, read from dataset table (Parquet BLOBs)."""
    import polars as pl

    direction = (direction or "discharge").strip().lower()
    if direction not in {"discharge", "charge"}:
        raise HTTPException(status_code=400, detail="direction must be 'discharge' or 'charge'")

    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        cell = get_or_404(
            conn,
            "SELECT cell_id FROM cell WHERE project_id = ? AND id_no = ?",
            (project_id, id_no),
            f"Cell id_no {id_no} not found",
        )
        cell_id = cell["cell_id"]
        dqdv_name = f"{direction}_dqdv"
        dvdq_name = f"{direction}_dvdq"
        dqdv_row = conn.execute(
            "SELECT data FROM dataset WHERE project_id = ? AND cell_id = ? AND name = ?",
            (project_id, cell_id, dqdv_name),
        ).fetchone()
        dvdq_row = conn.execute(
            "SELECT data FROM dataset WHERE project_id = ? AND cell_id = ? AND name = ?",
            (project_id, cell_id, dvdq_name),
        ).fetchone()
        # Backward compatibility for legacy single-direction rows.
        if direction == "discharge" and (dqdv_row is None or dvdq_row is None):
            if dqdv_row is None:
                dqdv_row = conn.execute(
                    "SELECT data FROM dataset WHERE project_id = ? AND cell_id = ? AND name = 'dqdv'",
                    (project_id, cell_id),
                ).fetchone()
            if dvdq_row is None:
                dvdq_row = conn.execute(
                    "SELECT data FROM dataset WHERE project_id = ? AND cell_id = ? AND name = 'dvdq'",
                    (project_id, cell_id),
                ).fetchone()

    cycles: Dict[str, dict] = {}

    if dqdv_row:
        df = pl.read_parquet(io.BytesIO(dqdv_row["data"]))
        if "Cycle" in df.columns:
            for (cyc_val,), group in df.group_by("Cycle"):
                cyc = str(int(cyc_val))
                cycles.setdefault(cyc, {})["ica"] = {
                    "v": group["Voltage [V]"].to_list(),
                    "dqdv": group["dQ/dV [Ah/V]"].to_list(),
                }

    if dvdq_row:
        df = pl.read_parquet(io.BytesIO(dvdq_row["data"]))
        if "Cycle" in df.columns:
            for (cyc_val,), group in df.group_by("Cycle"):
                cyc = str(int(cyc_val))
                cycles.setdefault(cyc, {})["dvq"] = {
                    "q": group["Capacity [Ah]"].to_list(),
                    "dvdq": group["dV/dQ [V/Ah]"].to_list(),
                }

    return {"idNo": id_no, "direction": direction, "cycles": cycles}


@router.get("/api/cell-record/{id_no:int}/cycle-summary")
def cycle_summary(id_no: int, cycles: str = "10,20,50,80"):
    """Sparse per-cycle metrics for parallel coordinates / dashboards."""
    project_id = normalize_project_id(None)
    want = [int(x.strip()) for x in cycles.split(",") if x.strip().isdigit()]
    rate_cells, _ = _load_rate_cells(project_id)
    for cell in rate_cells:
        if int(cell.get("idNo", -1)) == id_no:
            return _cycle_summary_for_cell(cell, want)
    raise HTTPException(status_code=404, detail="Cell not found in rate-performance data")


@router.get("/api/cell-record/{id_no:int}")
def cell_record(id_no: int, projectId: str | None = None):
    """Per-cell cycling curves from DB (project-scoped)."""
    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        row = conn.execute(
            """
            SELECT c.cell_id, d.data AS cycling_blob
            FROM cell c
            JOIN dataset d
              ON d.project_id = c.project_id
             AND d.cell_id = c.cell_id
             AND d.name = 'cycling'
            WHERE c.project_id = ?
              AND c.id_no = ?
            """,
            (project_id, id_no),
        ).fetchone()
    if row is None:
        raise HTTPException(status_code=404, detail=f"Cell record {id_no} not found")
    curves = _cycling_curves_from_blob(row["cycling_blob"])
    if not curves:
        raise HTTPException(status_code=404, detail=f"Cycling curves for cell {id_no} not found")
    return {"idNo": id_no, "cellName": row["cell_id"] or f"Cell {id_no}", "curves": curves}


@router.get("/api/cell-record/{id_with_ext}")
def cell_record_with_ext(id_with_ext: str, projectId: str | None = None):
    """Accept URLs with .json suffix (e.g. cell-record/1078.json)."""
    id_str = id_with_ext.removesuffix(".json") if id_with_ext.endswith(".json") else id_with_ext
    if id_str.isdigit():
        return cell_record(int(id_str), projectId=projectId)
    raise HTTPException(status_code=404, detail=f"Cell record {id_with_ext} not found")


@router.get("/api/rate-performance")
@router.get("/api/rate-performance.json")
def rate_performance(projectId: str | None = None):
    """Rate-performance summary JSON from DB cycling datasets (project-scoped)."""
    cells, protocols = _load_rate_cells(normalize_project_id(projectId))
    return {"cells": cells, "protocols": protocols}


class BatchCycleSummaryRequest(BaseModel):
    cellIds: List[int]
    cycles: List[int]
    metrics: Optional[List[str]] = None


@router.post("/api/batch-cycle-summary")
def batch_cycle_summary(req: BatchCycleSummaryRequest):
    """Batch sparse cycle metrics for many cells at once."""
    project_id = normalize_project_id(None)
    rate_cells, _ = _load_rate_cells(project_id)
    by_id = {
        int(c.get("idNo")): c for c in rate_cells if c.get("idNo") is not None
    }
    out = []
    for id_no in req.cellIds:
        cell = by_id.get(int(id_no))
        if not cell:
            continue
        summary = _cycle_summary_for_cell(cell, req.cycles)
        if req.metrics:
            slim: dict = {"idNo": summary["idNo"], "cycles": []}
            for block in summary["cycles"]:
                entry = {"cycle": block["cycle"]}
                for m in req.metrics:
                    if m in block:
                        entry[m] = block[m]
                slim["cycles"].append(entry)
            out.append(slim)
        else:
            out.append(summary)
    return {"cells": out}
