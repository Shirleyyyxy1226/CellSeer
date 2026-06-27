"""Shared helpers, caches, and data access for the cell-record routers.

Everything here is import-only (no FastAPI routes). The module-level caches
(_CYCLE_SUMMARY_CACHE / _RATE_CACHE / _CURVE_CACHE) are intentionally singletons
shared across the record / differential / rate routers, so they must live in
exactly one place.
"""

import json
import math
import re
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor
from typing import List

import polars as pl

from dataset_store import read_dataset_parquet, resolve_dataset_path
from db import get_db

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


def _dedupe_index_rows(rows: list[dict]) -> list[dict]:
    out: dict[object, dict] = {}

    def score(r: dict) -> tuple[int, int]:
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
                SELECT ROW_NUMBER() OVER (ORDER BY c.cell_id) AS _rowid,
                       c.id_no, c.cell_id, c.batch, c.category, c.repeat,
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
    except Exception:
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
            # Reuse the canonical per-cycle reduction so the rate plot and the
            # dQ/dV split agree — same adaptive |Imax|/1e4 threshold and the same
            # max-min charge/discharge capacity — instead of re-deriving it here.
            from compute.analysis.cycling.summary import cycle_summary
            from compute.data.cycling_data import CyclingData

            # CyclingData validates Time/Voltage columns the capacity reduction
            # doesn't use; fill placeholders so a (rare) source lacking them still
            # summarises, matching the previous direct computation's tolerance.
            fillers = [
                pl.lit(0.0).alias(c)
                for c in ("Time [s]", "Voltage [V]")
                if c not in df.columns
            ]
            if fillers:
                df = df.with_columns(fillers)
            summary = cycle_summary(CyclingData(lf=df.lazy(), info={})).data.sort("Cycle")
            cycles: list[int] = []
            charge_m_ah: list[float] = []
            discharge_m_ah: list[float] = []
            for r in summary.iter_rows(named=True):
                try:
                    cyc = int(r["Cycle"])
                except Exception:
                    continue
                chg = r["Charge Capacity [Ah]"]
                dch = r["Discharge Capacity [Ah]"]
                cycles.append(cyc)
                charge_m_ah.append((float(chg) if chg is not None else 0.0) * 1000.0)
                discharge_m_ah.append((float(dch) if dch is not None else 0.0) * 1000.0)
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


def _build_rate_payload_for_cell(row: dict) -> dict | None:
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
    row: dict,
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
    except Exception:
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
    except Exception:
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
