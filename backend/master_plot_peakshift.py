"""dQ/dV peak-shift reduction for the Master Plot.

Reduces each cell's stored discharge dQ/dV curve to a single scalar: the voltage
shift of the dominant redox peak between the start and end of cycling
(ΔV = V_peak(late) − V_peak(early)), in mV. A small ΔV means the redox plateau
is stable; a growing |ΔV| flags phase-change / impedance growth — a mechanism
signal the capacity/CE scalars can't surface.

This is a *separate, lazy* aggregate (not part of the overview twin / parity
harness): the differential Parquet is large and only the dQ/dV-shift metric needs
it, so it's fetched on demand and coverage-gated. Reads reuse the same per-file
cache pattern as backend/routers/cells.py, keyed on (uri, file stamp), so repeat
loads and incremental rebuilds are cheap.

Peak detection is deliberately robust-but-simple: light moving-average smoothing
to kill single-point spikes, the dominant peak = argmax|dQ/dV|, and the early/late
voltages are the median peak over the first/last few cycles (not a single noisy
cycle). No protocol segmentation is required — early/late are just the first/last
cycles present — so it works on differential data that has no attached protocol.
"""

from __future__ import annotations

import sqlite3
import threading
from collections import OrderedDict
from concurrent.futures import ThreadPoolExecutor

import polars as pl

from dataset_store import read_dataset_parquet, resolve_dataset_path
from db import get_db

# Cycles averaged at each end to make the early/late peak voltage robust.
_END_WINDOW = 3
# Moving-average half-not: window length for smoothing dQ/dV before argmax.
_SMOOTH_WINDOW = 5
# Minimum points in a cycle's curve to trust a peak.
_MIN_POINTS = 8
# A peak shift beyond this is almost certainly a mis-detection (the dominant
# peak jumped to a different redox feature rather than migrating), so we report
# it as "not reliably computable" (null) instead of a misleading huge value.
_MAX_PLAUSIBLE_MV = 800.0


def _file_stamp(storage_uri: str) -> tuple:
    try:
        st = resolve_dataset_path(storage_uri).stat()
        return (st.st_mtime_ns, st.st_size)
    except OSError:
        return (0, 0)


def _moving_avg(xs: list[float], window: int) -> list[float]:
    n = len(xs)
    if window <= 1 or n < window:
        return xs
    half = window // 2
    out: list[float] = []
    acc = 0.0
    # Simple centered moving average with edge clamping.
    for i in range(n):
        lo = max(0, i - half)
        hi = min(n, i + half + 1)
        acc = sum(xs[lo:hi])
        out.append(acc / (hi - lo))
    return out


def _peak_voltage(vs: list[float], dq: list[float]) -> float | None:
    """Voltage of the dominant dQ/dV peak (argmax of |smoothed dQ/dV|)."""
    pairs = [(v, d) for v, d in zip(vs, dq) if v is not None and d is not None]
    if len(pairs) < _MIN_POINTS:
        return None
    v_clean = [p[0] for p in pairs]
    d_clean = [abs(p[1]) for p in pairs]
    d_smooth = _moving_avg(d_clean, _SMOOTH_WINDOW)
    k = max(range(len(d_smooth)), key=lambda i: d_smooth[i])
    return v_clean[k]


def _median(xs: list[float]) -> float | None:
    s = sorted(xs)
    n = len(s)
    if not n:
        return None
    mid = n // 2
    return s[mid] if n % 2 else (s[mid - 1] + s[mid]) / 2


_CACHE: "OrderedDict[tuple, float | None]" = OrderedDict()
_CACHE_MAX = 8192
_CACHE_LOCK = threading.Lock()


def peak_shift_mv(storage_uri: str) -> float | None:
    """ΔV (mV) of the dominant dQ/dV peak between early and late cycling for one
    cell's discharge dQ/dV Parquet, or None when it can't be computed."""
    key = (storage_uri, _file_stamp(storage_uri))
    with _CACHE_LOCK:
        if key in _CACHE:
            _CACHE.move_to_end(key)
            return _CACHE[key]

    result: float | None = None
    try:
        df = read_dataset_parquet(storage_uri)
        cols = set(df.columns)
        if {"Voltage [V]", "dQ/dV [Ah/V]", "Cycle"}.issubset(cols):
            cycles = sorted(
                int(c) for c in df["Cycle"].unique().to_list() if c is not None
            )
            if len(cycles) >= 2:
                early = cycles[: min(_END_WINDOW, len(cycles))]
                # Late window must not overlap the early one.
                late = [c for c in cycles[-min(_END_WINDOW, len(cycles)) :] if c not in early]
                if not late:
                    late = [cycles[-1]]

                def peak_for(cycle_set: list[int]) -> float | None:
                    pv: list[float] = []
                    for cyc in cycle_set:
                        g = df.filter(pl.col("Cycle") == cyc)
                        v = _peak_voltage(
                            g["Voltage [V]"].to_list(), g["dQ/dV [Ah/V]"].to_list()
                        )
                        if v is not None:
                            pv.append(v)
                    return _median(pv)

                ev = peak_for(early)
                lv = peak_for(late)
                if ev is not None and lv is not None:
                    shift = (lv - ev) * 1000.0
                    # Reject implausible jumps (peak switched identity).
                    result = shift if abs(shift) <= _MAX_PLAUSIBLE_MV else None
    except Exception:
        result = None

    with _CACHE_LOCK:
        _CACHE[key] = result
        _CACHE.move_to_end(key)
        while len(_CACHE) > _CACHE_MAX:
            _CACHE.popitem(last=False)
    return result


def _load_peak_shift_rows(project_id: str) -> list[dict]:
    """One row per cell that has a discharge dQ/dV dataset, with its ΔV scalar."""
    try:
        with get_db() as conn:
            rows = conn.execute(
                """
                SELECT c.cell_id, d.storage_uri AS uri
                FROM cell c
                JOIN dataset d
                  ON d.project_id = c.project_id
                 AND d.cell_id = c.cell_id
                 AND d.name = 'discharge_dqdv'
                 AND d.deleted_at IS NULL
                WHERE c.project_id = ?
                  AND c.deleted_at IS NULL
                ORDER BY c.cell_id
                """,
                (project_id,),
            ).fetchall()
    except sqlite3.OperationalError:
        return []

    uris = [(r["cell_id"], r["uri"]) for r in rows if r["cell_id"] and r["uri"]]
    if len(uris) > 8:
        with ThreadPoolExecutor(max_workers=8) as pool:
            shifts = list(pool.map(lambda u: peak_shift_mv(u[1]), uris))
    else:
        shifts = [peak_shift_mv(u[1]) for u in uris]

    return [
        {"cellId": cell_id, "peakShiftMv": shift}
        for (cell_id, _uri), shift in zip(uris, shifts)
    ]


def build_peak_shift(project_id: str) -> dict:
    """`{cells: [{cellId, peakShiftMv}]}` for every cell with discharge dQ/dV."""
    cells = _load_peak_shift_rows(project_id)
    return {
        "cellCount": len(cells),
        "valueCount": sum(1 for c in cells if c["peakShiftMv"] is not None),
        "cells": cells,
    }
