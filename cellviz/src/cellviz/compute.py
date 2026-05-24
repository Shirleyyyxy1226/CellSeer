from __future__ import annotations

from typing import Any, Literal

import numpy as np

try:
    import polars as pl  # noqa: F401
    import pyprobe  # noqa: F401

    _HAS_PYPROBE = True
except Exception:
    _HAS_PYPROBE = False


Direction = Literal["discharge", "charge"]


def _extract_directional_vq(
    curve: dict[str, list[float]],
    direction: Direction,
) -> tuple[np.ndarray, np.ndarray] | None:
    v = np.asarray(curve.get("Voltage [V]", []), dtype=float)
    q = np.asarray(curve.get("Capacity [Ah]", []), dtype=float)
    i = np.asarray(curve.get("Current [A]", []), dtype=float) if curve.get("Current [A]") else None
    if v.size < 3 or q.size < 3:
        return None
    if i is not None and i.size == v.size:
        mask = i < 0 if direction == "discharge" else i > 0
        if np.count_nonzero(mask) < 3:
            return None
        v = v[mask]
        q = q[mask]
    if v.size < 3 or q.size < 3:
        return None
    if float(np.max(v) - np.min(v)) <= 1e-4:
        return None
    if float(np.max(q) - np.min(q)) <= 1e-8:
        return None
    return v, q


def _prepare_vq_sorted(
    v: np.ndarray, q: np.ndarray
) -> tuple[np.ndarray, np.ndarray] | None:
    sort_idx = np.argsort(v)
    v = v[sort_idx]
    q = q[sort_idx]
    v, unique_idx = np.unique(v, return_index=True)
    q = q[unique_idx]
    if v.size < 3:
        return None
    return v, q


def _prepare_qv_sorted(
    v: np.ndarray, q: np.ndarray
) -> tuple[np.ndarray, np.ndarray] | None:
    sort_idx = np.argsort(q)
    q = q[sort_idx]
    v = v[sort_idx]
    q, unique_idx = np.unique(q, return_index=True)
    v = v[unique_idx]
    if q.size < 3:
        return None
    return q, v


def _build_grid(start: float, end: float, sampling_interval: float | None) -> np.ndarray:
    span = float(end - start)
    if not np.isfinite(span) or span <= 0:
        return np.array([], dtype=float)
    step = sampling_interval if sampling_interval and sampling_interval > 0 else max(span / 200.0, 1e-4)
    if not np.isfinite(step) or step <= 0:
        step = max(span / 200.0, 1e-4)
    if step >= span:
        return np.array([start, end], dtype=float)
    grid = np.arange(start, end + step * 0.5, step, dtype=float)
    if grid.size < 2:
        return np.array([start, end], dtype=float)
    return grid


def _compute_numpy(
    curves: dict[int, dict[str, list[float]]],
    sampling_interval_v: float,
    sampling_interval_q: float | None,
    direction: Direction,
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for cycle, curve in sorted(curves.items()):
        extracted = _extract_directional_vq(curve, direction)
        if extracted is None:
            continue
        v_raw, q_raw = extracted

        payload: dict[str, Any] = {"dqdv": None, "dvdq": None}

        vq = _prepare_vq_sorted(v_raw, q_raw)
        if vq is not None:
            v, q = vq
            v_grid = _build_grid(float(v[0]), float(v[-1]), sampling_interval_v)
            if v_grid.size >= 2:
                q_grid = np.interp(v_grid, v, q)
                if q_grid.size >= 2:
                    dqdv = -np.gradient(q_grid, v_grid)
                    dqdv = np.clip(dqdv, -100.0, 100.0)
                    payload["dqdv"] = {"v": v_grid.tolist(), "dqdv": dqdv.tolist()}

        qv = _prepare_qv_sorted(v_raw, q_raw)
        if qv is not None:
            q, v = qv
            q_grid = _build_grid(float(q[0]), float(q[-1]), sampling_interval_q)
            if q_grid.size >= 2:
                v_grid = np.interp(q_grid, q, v)
                if v_grid.size >= 2:
                    dvdq = np.gradient(v_grid, q_grid)
                    dvdq = np.clip(dvdq, -1e4, 1e4)
                    payload["dvdq"] = {"q": q_grid.tolist(), "dvdq": dvdq.tolist()}

        if payload["dqdv"] is None and payload["dvdq"] is None:
            continue
        out[int(cycle)] = payload
    return out


def _compute_pyprobe(
    curves: dict[int, dict[str, list[float]]],
    sampling_interval_v: float,
    sampling_interval_q: float | None,
    direction: Direction,
) -> dict[int, dict[str, Any]]:
    import polars as pl
    from pyprobe.analysis.differentiation import gradient
    from pyprobe.result import Result

    out: dict[int, dict[str, Any]] = {}
    for cycle, curve in sorted(curves.items()):
        extracted = _extract_directional_vq(curve, direction)
        if extracted is None:
            continue
        v_raw, q_raw = extracted

        payload: dict[str, Any] = {"dqdv": None, "dvdq": None}

        vq = _prepare_vq_sorted(v_raw, q_raw)
        if vq is not None:
            v, q = vq
            v_grid = _build_grid(float(v[0]), float(v[-1]), sampling_interval_v)
            if v_grid.size >= 2:
                q_grid = np.interp(v_grid, v, q)
                if q_grid.size >= 2:
                    result = Result(
                        lf=pl.DataFrame({"Voltage [V]": v_grid, "Capacity [Ah]": q_grid}).lazy(),
                        info={"cycle": int(cycle)},
                    )
                    diff = gradient(result, x="Voltage [V]", y="Capacity [Ah]")
                    df = diff.data
                    derivative_col = "d(Capacity [Ah])/d(Voltage [V])"
                    if derivative_col not in df.columns:
                        candidates = [c for c in df.columns if c.startswith("d(") and "Voltage" in c and "Capacity" in c]
                        if candidates:
                            derivative_col = candidates[0]
                        else:
                            derivative_col = None  # type: ignore[assignment]
                    if derivative_col is not None:
                        dqdv = -df[derivative_col].to_numpy()
                        dqdv = np.clip(dqdv, -100.0, 100.0)
                        payload["dqdv"] = {
                            "v": df["Voltage [V]"].to_list(),
                            "dqdv": dqdv.tolist(),
                        }

        qv = _prepare_qv_sorted(v_raw, q_raw)
        if qv is not None:
            q, v = qv
            q_grid = _build_grid(float(q[0]), float(q[-1]), sampling_interval_q)
            if q_grid.size >= 2:
                v_grid = np.interp(q_grid, q, v)
                if v_grid.size >= 2:
                    result = Result(
                        lf=pl.DataFrame({"Capacity [Ah]": q_grid, "Voltage [V]": v_grid}).lazy(),
                        info={"cycle": int(cycle)},
                    )
                    diff = gradient(result, x="Capacity [Ah]", y="Voltage [V]")
                    df = diff.data
                    derivative_col = "d(Voltage [V])/d(Capacity [Ah])"
                    if derivative_col not in df.columns:
                        candidates = [c for c in df.columns if c.startswith("d(") and "Voltage" in c and "Capacity" in c]
                        if candidates:
                            derivative_col = candidates[0]
                        else:
                            derivative_col = None  # type: ignore[assignment]
                    if derivative_col is not None:
                        dvdq = df[derivative_col].to_numpy()
                        dvdq = np.clip(dvdq, -1e4, 1e4)
                        payload["dvdq"] = {
                            "q": df["Capacity [Ah]"].to_list(),
                            "dvdq": dvdq.tolist(),
                        }

        if payload["dqdv"] is None and payload["dvdq"] is None:
            continue
        out[int(cycle)] = payload
    return out


def compute_dqdv_dvdq_per_cycle(
    curves: dict[int, dict[str, list[float]]],
    sampling_interval_v: float = 0.002,
    sampling_interval_q: float | None = None,
    direction: Direction = "discharge",
) -> dict[int, dict[str, Any]]:
    if _HAS_PYPROBE:
        return _compute_pyprobe(curves, sampling_interval_v, sampling_interval_q, direction)
    return _compute_numpy(curves, sampling_interval_v, sampling_interval_q, direction)
