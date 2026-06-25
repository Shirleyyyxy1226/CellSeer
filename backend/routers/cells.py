"""Cell record endpoints: index, per-cell record, dQ/dV and dV/dQ, rate performance, cycle summaries."""

import json
import math
import re
import sqlite3
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import Dict, List, Optional

import polars as pl
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from dataset_store import read_dataset_parquet, resolve_dataset_path
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


def _safe_float(value: object) -> float | None:
    if value is None:
        return None
    try:
        return float(value)
    except Exception:
        return None


def _safe_str(value: object) -> str | None:
    if value is None:
        return None
    s = str(value).strip()
    return s or None


def _get_cell_record_index(project_id: str) -> dict:
    try:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT c.rowid AS _rowid, c.id_no, c.cell_id, c.batch, c.category, c.repeat,
                       c.cathode, c.cathode_diameter_mm, c.cathode_mass,
                       c.anode, c.anode_diameter_mm, c.anode_mass, c.np_ratio,
                       c.separator_type, c.separator_diameter_mm,
                       c.electrolyte, c.electrolyte_volume_ul, c.spacer_mm,
                       c.do_formation, c.do_ratetest, c.do_eis,
                       c.notes, c.source_system, c.source_refcode, c.source_item_id,
                       c.last_seen_at,
                       c.protocol_name, c.protocol_segments, c.protocol_updated_at
                FROM cell c
                WHERE c.project_id = ?
                  AND c.deleted_at IS NULL
                """,
                (project_id,),
            ).fetchall()
            # Per-cell dataset roll-up. A separate query keeps the cell row
            # dedupe logic above untouched while still letting the response
            # list every attached test file.
            ds_rows = conn.execute(
                """
                SELECT cell_id, name, size_bytes, created_at, source_file_id, source_version
                FROM dataset
                WHERE project_id = ?
                  AND deleted_at IS NULL
                ORDER BY name, created_at
                """,
                (project_id,),
            ).fetchall()
    except sqlite3.OperationalError:
        # DB-only mode: if DB schema isn't initialised, return empty index (no JSON fallback).
        return {"cells": []}
    rows = _dedupe_index_rows(rows)

    datasets_by_cell: dict[str, list[dict]] = {}
    for d in ds_rows:
        ds = {
            "name": d["name"],
            "sizeBytes": _safe_int(d["size_bytes"]),
            "createdAt": _safe_str(d["created_at"]),
            "sourceFileId": _safe_str(d["source_file_id"]),
            "sourceVersion": _safe_str(d["source_version"]),
        }
        datasets_by_cell.setdefault(d["cell_id"] or "", []).append(ds)

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
                "batch": _safe_int(r["batch"]),
                "category": _safe_str(r["category"]),
                "repeat": _safe_int(r["repeat"]),
                "cathode": r["cathode"] or "",
                "cathodeDiameterMm": _safe_float(r["cathode_diameter_mm"]),
                "cathodeMassG": cathode_mass_g,
                "anode": _safe_str(r["anode"]),
                "anodeDiameterMm": _safe_float(r["anode_diameter_mm"]),
                "anodeMassG": _safe_float(r["anode_mass"]),
                "npRatio": _safe_float(r["np_ratio"]),
                "separatorType": r["separator_type"] or "",
                "separatorDiameterMm": _safe_float(r["separator_diameter_mm"]),
                "electrolyte": (r["electrolyte"] or "").strip(),
                "electrolyteVolumeUl": _safe_float(r["electrolyte_volume_ul"]),
                "spacerMm": float(r["spacer_mm"]) if r["spacer_mm"] is not None else None,
                "doFormation": _safe_str(r["do_formation"]),
                "doRateTest": _safe_str(r["do_ratetest"]),
                "doEis": _safe_str(r["do_eis"]),
                "notes": _safe_str(r["notes"]),
                "sourceSystem": _safe_str(r["source_system"]),
                "sourceRefcode": _safe_str(r["source_refcode"]),
                "sourceItemId": _safe_str(r["source_item_id"]),
                "lastSeenAt": _safe_str(r["last_seen_at"]),
                "datasets": datasets_by_cell.get(r["cell_id"] or "", []),
                # Protocol stored directly on the cell row (set by
                # /api/cells/{id}/protocol). Falls back to dataset.meta on
                # the rate-performance path, but for the index we surface
                # whatever the user has explicitly attached so the UI can
                # show a chip even before cycling data lands.
                "protocolName": _safe_str(r["protocol_name"]),
                "protocolSegments": _parse_segments_column(r["protocol_segments"]),
                "protocolUpdatedAt": _safe_str(r["protocol_updated_at"]),
            }
        )
    return {"cells": index}


def _parse_segments_column(value: object) -> list[dict] | None:
    """Decode the ``cell.protocol_segments`` JSON blob into wire format.

    Returns None when no protocol is attached so the frontend can use a
    simple truthy check (``cell.protocolSegments`` → has protocol).
    """
    if not value:
        return None
    if isinstance(value, (list, tuple)):
        return [dict(s) for s in value if isinstance(s, dict)] or None
    if isinstance(value, (bytes, bytearray)):
        try:
            value = value.decode("utf-8")
        except Exception:
            return None
    if not isinstance(value, str):
        return None
    try:
        parsed = json.loads(value)
    except Exception:
        return None
    if not isinstance(parsed, list):
        return None
    out: list[dict] = []
    for seg in parsed:
        if not isinstance(seg, dict):
            continue
        try:
            start = int(seg.get("cycleStart"))
        except Exception:
            continue
        end_raw = seg.get("cycleEnd")
        end_val: int | None
        if end_raw is None:
            end_val = None
        else:
            try:
                end_val = int(end_raw)
            except Exception:
                continue
        rate = _parse_c_rate_value(seg.get("cRate"))
        if rate is None:
            continue
        entry: dict = {
            "cycleStart": start,
            "cycleEnd": end_val,
            "cRate": rate,
        }
        name = seg.get("name")
        if isinstance(name, str) and name.strip():
            entry["name"] = name.strip()
        out.append(entry)
    return out or None


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


def _prepare_cycling_df(storage_uri: str) -> pl.DataFrame:
    df = read_dataset_parquet(storage_uri)
    if "Cycle" not in df.columns:
        if "Event" in df.columns:
            df = df.rename({"Event": "Cycle"})
        elif "Step" in df.columns:
            df = df.rename({"Step": "Cycle"})
    return df


# Per-cycle capacity summaries depend only on the Parquet file, not the cell
# row, so cache them per (uri, file stamp). This makes rate-performance
# rebuilds incremental: ingesting 10 new cells re-reads 10 files, and metadata
# edits (cathode mass, protocol) recompute without touching Parquet at all.
# ~few KB per entry → thousands of cells fit comfortably in memory.
_CYCLE_SUMMARY_CACHE: "OrderedDict[tuple, tuple[list[int], list[float], list[float]] | None]" = OrderedDict()
_CYCLE_SUMMARY_CACHE_MAX = 8192
_CYCLE_SUMMARY_LOCK = threading.Lock()


def _cycle_capacity_summary(cycling_uri: str) -> tuple[list[int], list[float], list[float]] | None:
    """(cycles, charge mAh, discharge mAh) per cycle from one cycling Parquet file."""
    key = (cycling_uri, _file_stamp(cycling_uri))
    with _CYCLE_SUMMARY_LOCK:
        if key in _CYCLE_SUMMARY_CACHE:
            _CYCLE_SUMMARY_CACHE.move_to_end(key)
            return _CYCLE_SUMMARY_CACHE[key]

    result: tuple[list[int], list[float], list[float]] | None = None
    try:
        df = _prepare_cycling_df(cycling_uri)
        required = {"Cycle", "Current [A]", "Capacity [Ah]"}
        if required.issubset(set(df.columns)):
            thr = 1e-9
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
            if cycles:
                result = (cycles, charge_m_ah, discharge_m_ah)
    except Exception:
        result = None

    with _CYCLE_SUMMARY_LOCK:
        _CYCLE_SUMMARY_CACHE[key] = result
        _CYCLE_SUMMARY_CACHE.move_to_end(key)
        while len(_CYCLE_SUMMARY_CACHE) > _CYCLE_SUMMARY_CACHE_MAX:
            _CYCLE_SUMMARY_CACHE.popitem(last=False)
    return result


def _build_rate_payload_for_cell(row: sqlite3.Row) -> dict | None:
    id_no = _safe_int(row["id_no"])
    if id_no is None:
        return None

    cycling_uri = row["cycling_uri"]
    if not cycling_uri:
        return None
    summarised = _cycle_capacity_summary(cycling_uri)
    if summarised is None:
        return None
    cycles, charge_m_ah, discharge_m_ah = summarised

    protocol_name, protocol_segments, cycle_to_rate = _parse_protocol_meta(row["dataset_meta"])
    # Fall back to the cell-level protocol (set via /api/cells/{id}/protocol)
    # when no dataset.meta.protocol was attached at ingest time. This lets the
    # user assign a protocol after the cycling file is already in.
    if not protocol_segments:
        cell_name, cell_segments, cell_map = _parse_cell_level_protocol(row)
        if cell_segments:
            protocol_name = cell_name or protocol_name
            # Materialise open-ended trailing segments against the observed
            # max cycle so /api/rate-performance keeps its legacy contract
            # of strictly-finite cycleEnd (downstream plot/PC code uses
            # `seg.cycleEnd - seg.cycleStart + 1` arithmetic).
            max_cycle = max(cycles) if cycles else 1
            protocol_segments = []
            for seg in cell_segments:
                end_val = seg.get("cycleEnd")
                materialised: dict = {
                    "cycleStart": int(seg["cycleStart"]),
                    "cycleEnd": int(end_val) if end_val is not None else max_cycle,
                    "cRate": float(seg["cRate"]),
                }
                if seg.get("name"):
                    materialised["name"] = seg["name"]
                protocol_segments.append(materialised)
            cycle_to_rate = cell_map
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


def _parse_cell_level_protocol(
    row: sqlite3.Row,
) -> tuple[str | None, list[dict], dict[int, float]]:
    """Materialise the ``cell.protocol_segments`` blob into the same shape
    that :func:`_parse_protocol_meta` returns: a display label, the cleaned
    segment list, and a cycle→rate lookup. Returns empty values when the
    cell has no protocol attached or the JSON is invalid.

    When ``cycleEnd`` is ``None`` (open-ended segment), the cycle map is
    expanded only up to the *largest cycle actually observed* on this cell's
    cycling dataset; that's enforced by the caller, which filters ``c_rates``
    against the cycle list. For the static map we use a generous upper bound
    so contiguous cycles past the last segment still resolve to the trailing
    rate.
    """
    try:
        # Older `cell` table schemas may not have the column; defensive access.
        raw = row["protocol_segments"]
    except (IndexError, KeyError):
        return (None, [], {})
    segments = _parse_segments_column(raw) or []
    if not segments:
        return (None, [], {})

    labels: list[str] = []
    cycle_to_rate: dict[int, float] = {}
    # Open-ended segments need a finite upper bound for the lookup map; pick
    # something larger than any realistic cycling run but small enough that
    # the dict isn't pathological.
    OPEN_END_HORIZON = 100_000
    for seg in segments:
        start = int(seg["cycleStart"])
        end = seg.get("cycleEnd")
        end_val = int(end) if end is not None else OPEN_END_HORIZON
        rate = float(seg["cRate"])
        # Display label: prefer explicit `name`, else fall back to the rate.
        name = seg.get("name")
        labels.append(str(name) if name else f"{rate:g}C")
        for cyc in range(start, end_val + 1):
            cycle_to_rate[cyc] = rate

    # Prefer the user-set protocol_name when the caller has it; otherwise
    # join the segment labels (mirrors _parse_protocol_meta's behaviour).
    try:
        display_name = row["protocol_name"]
    except (IndexError, KeyError):
        display_name = None
    if not display_name:
        display_name = " | ".join(dict.fromkeys(labels))
    return (display_name, segments, cycle_to_rate)


def _load_rate_cells_uncached(project_id: str) -> tuple[list[dict], list[str]]:
    try:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT c.id_no, c.cell_id, c.cathode, c.separator_type, c.spacer_mm, c.cathode_mass,
                       c.protocol_name, c.protocol_segments,
                       d.storage_uri AS cycling_uri, d.meta AS dataset_meta
                FROM cell c
                JOIN dataset d
                  ON d.project_id = c.project_id
                 AND d.cell_id = c.cell_id
                 AND d.name = 'cycling'
                 AND d.deleted_at IS NULL
                WHERE c.project_id = ?
                  AND c.id_no IS NOT NULL
                  AND c.deleted_at IS NULL
                ORDER BY c.id_no
                """,
                (project_id,),
            ).fetchall()
    except sqlite3.OperationalError:
        return ([], [])

    # Parquet reads dominate the cold build and release the GIL inside polars —
    # a thread pool turns N sequential file reads into ~N/workers. Order is
    # preserved (rows are sorted by id_no).
    if len(rows) > 8:
        with ThreadPoolExecutor(max_workers=8) as pool:
            payloads = list(pool.map(_build_rate_payload_for_cell, rows))
    else:
        payloads = [_build_rate_payload_for_cell(row) for row in rows]

    cells: list[dict] = []
    protocols: list[str] = []
    for payload in payloads:
        if payload is None:
            continue
        cells.append(payload)
        protocol = payload.get("protocol")
        if isinstance(protocol, str) and protocol and protocol not in protocols:
            protocols.append(protocol)
    return (cells, protocols)


# Rebuilding rate-performance means re-reading every cycling Parquet file
# (~4 s for 244 cells), but the underlying data only changes on ingest or a
# metadata edit. Cache per project, keyed on a cheap DB fingerprint (~1 ms)
# that moves whenever cycling datasets or cell metadata change.
_RATE_CACHE: dict[str, tuple[tuple, tuple[list[dict], list[str]]]] = {}
_RATE_CACHE_LOCK = threading.Lock()


def _rate_cells_fingerprint(project_id: str) -> tuple | None:
    try:
        with get_db() as conn:
            ds = conn.execute(
                """
                SELECT COUNT(*), COALESCE(MAX(id), 0), COALESCE(MAX(created_at), ''),
                       COALESCE(SUM(LENGTH(COALESCE(meta, ''))), 0)
                FROM dataset
                WHERE project_id = ? AND name = 'cycling' AND deleted_at IS NULL
                """,
                (project_id,),
            ).fetchone()
            cell = conn.execute(
                """
                SELECT COUNT(*),
                       COALESCE(SUM(cathode_mass), 0.0),
                       COALESCE(MAX(last_seen_at), ''),
                       COALESCE(MAX(protocol_updated_at), ''),
                       COALESCE(SUM(LENGTH(COALESCE(protocol_segments, ''))), 0)
                FROM cell
                WHERE project_id = ? AND deleted_at IS NULL
                """,
                (project_id,),
            ).fetchone()
        return (tuple(ds), tuple(cell))
    except sqlite3.OperationalError:
        return None


def invalidate_rate_cache(project_id: str | None = None) -> None:
    """Drop cached rate-performance payloads (all projects when project_id is None)."""
    with _RATE_CACHE_LOCK:
        if project_id is None:
            _RATE_CACHE.clear()
        else:
            _RATE_CACHE.pop(project_id, None)


def _load_rate_cells(project_id: str) -> tuple[list[dict], list[str]]:
    fingerprint = _rate_cells_fingerprint(project_id)
    if fingerprint is not None:
        with _RATE_CACHE_LOCK:
            hit = _RATE_CACHE.get(project_id)
            if hit is not None and hit[0] == fingerprint:
                return hit[1]
    result = _load_rate_cells_uncached(project_id)
    if fingerprint is not None:
        with _RATE_CACHE_LOCK:
            _RATE_CACHE[project_id] = (fingerprint, result)
    return result


# Per-cell curve payloads are rebuilt from Parquet on every request (~0.5 s and
# up to ~9 MB JSON per cell for full-resolution cycling data). Cache the built
# dicts keyed on (uri, params, file mtime+size) so repeat loads are instant;
# the small LRU bound keeps memory in check since downsampled payloads dominate.
_CURVE_CACHE: "OrderedDict[tuple, dict]" = OrderedDict()
_CURVE_CACHE_MAX = 24
_CURVE_CACHE_LOCK = threading.Lock()


def _file_stamp(storage_uri: str) -> tuple:
    try:
        st = resolve_dataset_path(storage_uri).stat()
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return (0, 0)


def _curve_cache_get(key: tuple):
    with _CURVE_CACHE_LOCK:
        if key in _CURVE_CACHE:
            _CURVE_CACHE.move_to_end(key)
            return _CURVE_CACHE[key]
    return None


def _curve_cache_put(key: tuple, value: dict) -> None:
    with _CURVE_CACHE_LOCK:
        _CURVE_CACHE[key] = value
        _CURVE_CACHE.move_to_end(key)
        while len(_CURVE_CACHE) > _CURVE_CACHE_MAX:
            _CURVE_CACHE.popitem(last=False)


def _downsample_group(group: pl.DataFrame, max_points: int) -> pl.DataFrame:
    """Stride-sample a per-cycle group, always keeping the final row so curve
    endpoints (end-of-discharge capacity) stay exact."""
    if group.height <= max_points:
        return group
    stride = math.ceil(group.height / max_points)
    sampled = group.gather_every(stride)
    return pl.concat([sampled, group.tail(1)])


def _cycling_curves_from_storage(
    cycling_uri: str,
    max_points_per_cycle: int | None = None,
) -> dict[str, dict[str, list]]:
    key = ("curves", cycling_uri, max_points_per_cycle, _file_stamp(cycling_uri))
    hit = _curve_cache_get(key)
    if hit is not None:
        return hit
    df = _prepare_cycling_df(cycling_uri)
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
        if max_points_per_cycle and max_points_per_cycle > 0:
            group = _downsample_group(group, max_points_per_cycle)
        curves[cyc] = {col: group[col].to_list() for col in group.columns if col != "Cycle"}
    _curve_cache_put(key, curves)
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
    return {
        "cellId": str(cell.get("cellId") or ""),
        "idNo": int(cell.get("idNo", 0)),
        "cycles": out,
    }


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@router.get("/api/cell-record-index")
@router.get("/api/cell-record-index.json")
def cell_record_index_scoped(projectId: str | None = None):
    """Cell list scoped to selected project."""
    return _get_cell_record_index(normalize_project_id(projectId))


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


@router.get("/api/cell-record/{cell_id:path}/differential")
def differential(cell_id: str, projectId: str | None = None, direction: str = "discharge"):
    """Pre-computed dQ/dV and dV/dQ for one cell, read from dataset storage paths."""
    direction = (direction or "discharge").strip().lower()
    if direction not in {"discharge", "charge"}:
        raise HTTPException(status_code=400, detail="direction must be 'discharge' or 'charge'")
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")

    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        get_or_404(
            conn,
            "SELECT 1 FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
            f"Cell {cell_id!r} not found",
        )
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


@router.get("/api/cell-record/{cell_id:path}/cycle-summary")
def cycle_summary(cell_id: str, cycles: str = "10,20,50,80", projectId: str | None = None):
    """Sparse per-cycle metrics for parallel coordinates / dashboards."""
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    project_id = normalize_project_id(projectId)
    want = [int(x.strip()) for x in cycles.split(",") if x.strip().isdigit()]
    rate_cells, _ = _load_rate_cells(project_id)
    for cell in rate_cells:
        if str(cell.get("cellId") or "") == cell_id:
            return _cycle_summary_for_cell(cell, want)
    raise HTTPException(status_code=404, detail=f"Cell {cell_id!r} not found in rate-performance data")


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


def _spacer_matches(cell_spacer: object, param: str) -> bool:
    """Match a cell's spacer against the filter string by float value, so "1"
    and "1.0" are equivalent (the frontend sends JS ``String(number)``)."""
    try:
        return cell_spacer is not None and abs(float(cell_spacer) - float(param)) < 1e-9
    except (TypeError, ValueError):
        return False


def _cell_in_scope(
    cell: dict,
    cathode: str | None,
    separator: str | None,
    spacer: str | None,
) -> bool:
    # Mirror the frontend's display fallbacks: the overview/summary pipeline
    # surfaces an empty cathode as "Unknown" and an empty separator as "—", and
    # the filter dropdowns are built from those values. The raw rate payload
    # stores "" for both, so match against the same fallbacks or selecting the
    # "Unknown"/"—" cohort would scope to an empty set.
    if cathode and (cell.get("cathode") or "Unknown") != cathode:
        return False
    if separator and (cell.get("separatorType") or "—") != separator:
        return False
    if spacer and not _spacer_matches(cell.get("spacerMm"), spacer):
        return False
    return True


@router.get("/api/rate-performance")
@router.get("/api/rate-performance.json")
def rate_performance(
    projectId: str | None = None,
    cathode: str | None = None,
    separator: str | None = None,
    spacer: str | None = None,
):
    """Rate-performance summary JSON from DB cycling datasets (project-scoped).

    The optional ``cathode`` / ``separator`` / ``spacer`` filters scope the
    response to the condition cohort a cell-level view actually draws,
    so the Master Plot can pull just that cohort's per-cycle arrays instead of
    the whole project's tens of MB. The expensive Parquet build is cached
    project-wide by ``_load_rate_cells``; this only narrows the (already-built)
    in-memory list, so scoping is near-free.
    """
    cells, protocols = _load_rate_cells(normalize_project_id(projectId))
    if cathode or separator or spacer:
        cells = [c for c in cells if _cell_in_scope(c, cathode, separator, spacer)]
        # Re-derive the protocol list from the scoped cohort, preserving order.
        seen: list[str] = []
        for c in cells:
            p = c.get("protocol")
            if isinstance(p, str) and p and p not in seen:
                seen.append(p)
        protocols = seen
    return {"cells": cells, "protocols": protocols}


# ---------------------------------------------------------------------------
# PATCH /api/cells/{cell_id} — inline metadata editing
# ---------------------------------------------------------------------------

class CellMetadataPatch(BaseModel):
    """Allowlisted editable fields. Anything not listed here is ignored.

    `cell_id`, `id_no`, `project_id`, `source_*`, `last_seen_at` and
    `deleted_at` are deliberately omitted: the first two are primary / link
    keys and would invalidate cycling-data joins; the rest are audit columns
    populated by the ingest pipeline.
    """
    model_config = ConfigDict(extra="ignore")

    batch: Optional[int] = None
    category: Optional[str] = None
    repeat: Optional[int] = None
    cathode: Optional[str] = None
    cathodeDiameterMm: Optional[float] = None
    cathodeMassG: Optional[float] = None
    anode: Optional[str] = None
    anodeDiameterMm: Optional[float] = None
    anodeMassG: Optional[float] = None
    npRatio: Optional[float] = None
    separatorType: Optional[str] = None
    separatorDiameterMm: Optional[float] = None
    electrolyte: Optional[str] = None
    electrolyteVolumeUl: Optional[float] = None
    spacerMm: Optional[float] = None
    doFormation: Optional[str] = None
    doRateTest: Optional[str] = None
    doEis: Optional[str] = None
    notes: Optional[str] = None


# Map JSON camelCase → DB snake_case so the SQL writer only knows safe column
# names (defence against accidental column-name injection from API surface).
_PATCH_FIELD_TO_COLUMN: dict[str, str] = {
    "batch": "batch",
    "category": "category",
    "repeat": "repeat",
    "cathode": "cathode",
    "cathodeDiameterMm": "cathode_diameter_mm",
    "cathodeMassG": "cathode_mass",
    "anode": "anode",
    "anodeDiameterMm": "anode_diameter_mm",
    "anodeMassG": "anode_mass",
    "npRatio": "np_ratio",
    "separatorType": "separator_type",
    "separatorDiameterMm": "separator_diameter_mm",
    "electrolyte": "electrolyte",
    "electrolyteVolumeUl": "electrolyte_volume_ul",
    "spacerMm": "spacer_mm",
    "doFormation": "do_formation",
    "doRateTest": "do_ratetest",
    "doEis": "do_eis",
    "notes": "notes",
}


def _normalize_patch_value(field: str, value):
    """Coerce empty strings to NULL so clearing a field actually clears it,
    and normalise whitespace on free-text columns."""
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return None
        return s
    return value


@router.patch("/api/cells/{cell_id:path}")
def update_cell_metadata(cell_id: str, patch: CellMetadataPatch, projectId: str | None = None):
    """Update editable metadata fields on one cell.

    Only fields present in ``CellMetadataPatch`` (and serialised in the
    request body) are touched. Sending a JSON ``null`` clears that column.
    Fields the client omits from the body remain unchanged.
    """
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    project_id = normalize_project_id(projectId)

    # Use Pydantic's field_set semantics so the client controls what gets
    # touched. `model_dump(exclude_unset=True)` returns *only* the keys the
    # caller actually sent in the payload.
    incoming = patch.model_dump(exclude_unset=True)
    if not incoming:
        raise HTTPException(status_code=400, detail="No editable fields provided")

    set_clauses: list[str] = []
    params: list[object] = []
    applied: dict[str, object] = {}
    for field, raw_value in incoming.items():
        column = _PATCH_FIELD_TO_COLUMN.get(field)
        if column is None:
            continue
        normalised = _normalize_patch_value(field, raw_value)
        set_clauses.append(f"{column} = ?")
        params.append(normalised)
        applied[field] = normalised

    if not set_clauses:
        raise HTTPException(status_code=400, detail="No editable fields recognised")

    params.extend([project_id, cell_id])
    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=404,
                detail=f"Cell '{cell_id}' not found in project '{project_id}'",
            )
        conn.execute(
            f"UPDATE cell SET {', '.join(set_clauses)} WHERE project_id = ? AND cell_id = ?",
            params,
        )
        conn.commit()
    # Metadata edits (e.g. cathode mass) change derived rate-performance values.
    invalidate_rate_cache(project_id)

    # Echo the freshly-persisted cell back so the client can refresh without
    # a second round-trip to /api/cell-record-index.
    refreshed = _get_cell_record_index(project_id).get("cells", [])
    for c in refreshed:
        if str(c.get("cellId") or "") == cell_id:
            return {"cell": c, "updated": list(applied.keys())}
    return {"cell": None, "updated": list(applied.keys())}


# ---------------------------------------------------------------------------
# PUT /api/cells/{cell_id}/protocol  — attach a cycling protocol to one cell
# POST /api/cells/protocol/bulk      — apply the same protocol to many cells
# ---------------------------------------------------------------------------


class CellProtocolSegmentIn(BaseModel):
    """Wire-format segment.

    ``cycleEnd: None`` means "to end of test"; the wizard uses this to
    represent open-ended trailing segments. ``cRate`` is a positive C-rate
    in 1/hour (e.g. 0.1 = C/10, 1.0 = 1C).
    """

    name: Optional[str] = None
    cycleStart: int
    cycleEnd: Optional[int] = None
    cRate: float


class CellProtocolUpdate(BaseModel):
    """``protocolName`` is optional; if omitted we synthesise it from the
    segments so the rate-performance label stays in sync."""

    protocolName: Optional[str] = None
    segments: List[CellProtocolSegmentIn]


def _normalise_protocol_segments(segments: List[CellProtocolSegmentIn]) -> list[dict]:
    if not segments:
        raise HTTPException(status_code=400, detail="At least one segment is required")
    cleaned: list[dict] = []
    for idx, seg in enumerate(segments):
        if seg.cycleStart < 1:
            raise HTTPException(
                status_code=400,
                detail=f"Segment {idx + 1}: cycleStart must be >= 1",
            )
        if seg.cycleEnd is not None and seg.cycleEnd < seg.cycleStart:
            raise HTTPException(
                status_code=400,
                detail=f"Segment {idx + 1}: cycleEnd must be >= cycleStart",
            )
        if not (seg.cRate > 0):
            raise HTTPException(
                status_code=400,
                detail=f"Segment {idx + 1}: cRate must be > 0",
            )
        entry: dict = {
            "cycleStart": int(seg.cycleStart),
            "cycleEnd": int(seg.cycleEnd) if seg.cycleEnd is not None else None,
            "cRate": float(seg.cRate),
        }
        if seg.name and seg.name.strip():
            entry["name"] = seg.name.strip()[:80]
        cleaned.append(entry)
    cleaned.sort(key=lambda e: e["cycleStart"])
    return cleaned


def _synth_protocol_name(segments: list[dict]) -> str:
    """Compact one-line label like "FORM-3 | 1C" from segment names + rates.

    Uses the user-supplied ``name`` when present, otherwise just the C-rate.
    """
    tokens: list[str] = []
    for seg in segments:
        name = (seg.get("name") or "").strip()
        rate = float(seg["cRate"])
        rate_label = f"{rate:g}C"
        if name:
            tokens.append(f"{name.upper()}-{rate_label}")
        else:
            tokens.append(rate_label)
    # Preserve order but dedupe consecutive identical tokens.
    seen: list[str] = []
    for t in tokens:
        if not seen or seen[-1] != t:
            seen.append(t)
    return " | ".join(seen)


def _write_cell_protocol(
    conn: sqlite3.Connection,
    project_id: str,
    cell_id: str,
    segments_json: str,
    protocol_name: str,
) -> None:
    """Write protocol to ``cell.protocol_segments`` AND mirror it into the
    ``dataset.meta`` JSON of the cell's cycling row (if one exists).

    Mirroring lets older code paths that only consult ``dataset.meta`` keep
    working without further changes. The cell-level columns are the source
    of truth — they let us attach a protocol even *before* cycling data has
    arrived.
    """
    conn.execute(
        """
        UPDATE cell
        SET protocol_segments = ?,
            protocol_name = ?,
            protocol_updated_at = datetime('now')
        WHERE project_id = ? AND cell_id = ?
        """,
        (segments_json, protocol_name, project_id, cell_id),
    )

    # Mirror into dataset.meta.protocol on the cycling row, if one exists.
    cycling = conn.execute(
        """
        SELECT id, meta FROM dataset
        WHERE project_id = ? AND cell_id = ? AND name = 'cycling'
          AND deleted_at IS NULL
        """,
        (project_id, cell_id),
    ).fetchone()
    if cycling is None:
        return
    meta: dict
    if cycling["meta"]:
        try:
            parsed = json.loads(cycling["meta"])
            meta = parsed if isinstance(parsed, dict) else {}
        except Exception:
            meta = {}
    else:
        meta = {}
    try:
        meta["protocol"] = json.loads(segments_json)
    except Exception:
        meta["protocol"] = []
    conn.execute(
        "UPDATE dataset SET meta = ? WHERE id = ?",
        (json.dumps(meta), cycling["id"]),
    )


@router.put("/api/cells/{cell_id:path}/protocol")
def set_cell_protocol(
    cell_id: str,
    body: CellProtocolUpdate,
    projectId: str | None = None,
):
    """Attach a cycling protocol to one cell.

    The protocol is written to both ``cell.protocol_segments`` (so chips can
    show it even before cycling lands) and mirrored into ``dataset.meta``
    on the cycling row, when present, so rate-performance plotting picks it
    up immediately on the next reload.
    """
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    project_id = normalize_project_id(projectId)
    cleaned = _normalise_protocol_segments(body.segments)
    protocol_name = (body.protocolName or "").strip() or _synth_protocol_name(cleaned)
    segments_json = json.dumps(cleaned)

    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=404,
                detail=f"Cell '{cell_id}' not found in project '{project_id}'",
            )
        _write_cell_protocol(conn, project_id, cell_id, segments_json, protocol_name)
        conn.commit()
    invalidate_rate_cache(project_id)

    refreshed = _get_cell_record_index(project_id).get("cells", [])
    for c in refreshed:
        if str(c.get("cellId") or "") == cell_id:
            return {"cell": c, "protocolName": protocol_name}
    return {"cell": None, "protocolName": protocol_name}


class BulkCellProtocolUpdate(BaseModel):
    """Apply the same protocol to many cells in one transaction."""

    cellIds: List[str]
    protocolName: Optional[str] = None
    segments: List[CellProtocolSegmentIn]


@router.post("/api/cells/protocol/bulk")
def set_cell_protocol_bulk(body: BulkCellProtocolUpdate, projectId: str | None = None):
    """Bulk-apply one protocol to a list of cells.

    Cells that don't exist in the project are silently skipped — the
    response lists which IDs were written and which were missing so the
    wizard can show an inline "x of y attached" summary.
    """
    project_id = normalize_project_id(projectId)
    cell_ids = [str(cid).strip() for cid in body.cellIds if str(cid).strip()]
    if not cell_ids:
        raise HTTPException(status_code=400, detail="cellIds is required and must be non-empty")
    cleaned = _normalise_protocol_segments(body.segments)
    protocol_name = (body.protocolName or "").strip() or _synth_protocol_name(cleaned)
    segments_json = json.dumps(cleaned)

    applied: list[str] = []
    missing: list[str] = []
    with get_db() as conn:
        # Fetch known cells in one shot rather than N round-trips.
        placeholders = ",".join("?" for _ in cell_ids)
        known_rows = conn.execute(
            f"""
            SELECT cell_id FROM cell
            WHERE project_id = ? AND deleted_at IS NULL
              AND cell_id IN ({placeholders})
            """,
            [project_id, *cell_ids],
        ).fetchall()
        known: set[str] = {r["cell_id"] for r in known_rows}
        for cid in cell_ids:
            if cid not in known:
                missing.append(cid)
                continue
            _write_cell_protocol(conn, project_id, cid, segments_json, protocol_name)
            applied.append(cid)
        conn.commit()
    invalidate_rate_cache(project_id)
    return {
        "applied": applied,
        "missing": missing,
        "protocolName": protocol_name,
        "segments": cleaned,
    }


