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
    # ICA requires meaningful variation in both voltage and capacity.
    if float(np.max(v) - np.min(v)) <= 1e-4:
        return None
    if float(np.max(q) - np.min(q)) <= 1e-8:
        return None
    return v, q


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
        v, q = extracted
        sort_idx = np.argsort(v)
        v = v[sort_idx]
        q = q[sort_idx]
        v, unique_idx = np.unique(v, return_index=True)
        q = q[unique_idx]
        if v.size < 3:
            continue
        span = float(v[-1] - v[0])
        if not np.isfinite(span) or span <= 0:
            continue

        step = sampling_interval_v if sampling_interval_v > 0 else max(span / 200.0, 1e-4)
        if not np.isfinite(step) or step <= 0:
            step = max(span / 200.0, 1e-4)

        if step >= span:
            # Ensure at least two points for np.gradient on very narrow spans.
            v_grid = np.array([v[0], v[-1]], dtype=float)
        else:
            v_grid = np.arange(v[0], v[-1] + step * 0.5, step, dtype=float)
            if v_grid.size < 2:
                v_grid = np.array([v[0], v[-1]], dtype=float)

        q_grid = np.interp(v_grid, v, q)
        if v_grid.size < 2 or q_grid.size < 2:
            continue
        dqdv = -np.gradient(q_grid, v_grid)
        dqdv = np.clip(dqdv, -100.0, 100.0)
        out[int(cycle)] = {
            "ica": {
                "v": v_grid.tolist(),
                "dqdv": dqdv.tolist(),
            },
            "dvq": None,
        }
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
        v, q = extracted
        sort_idx = np.argsort(v)
        v = v[sort_idx]
        q = q[sort_idx]
        v, unique_idx = np.unique(v, return_index=True)
        q = q[unique_idx]
        if v.size < 3:
            continue

        span = float(v[-1] - v[0])
        if not np.isfinite(span) or span <= 0:
            continue
        step = sampling_interval_v if sampling_interval_v > 0 else max(span / 200.0, 1e-4)
        if not np.isfinite(step) or step <= 0:
            step = max(span / 200.0, 1e-4)
        if step >= span:
            v_grid = np.array([v[0], v[-1]], dtype=float)
        else:
            v_grid = np.arange(v[0], v[-1] + step * 0.5, step, dtype=float)
            if v_grid.size < 2:
                v_grid = np.array([v[0], v[-1]], dtype=float)
        q_grid = np.interp(v_grid, v, q)
        if v_grid.size < 2 or q_grid.size < 2:
            continue

        result = Result(
            lf=pl.DataFrame({"Voltage [V]": v_grid, "Capacity [Ah]": q_grid}).lazy(),
            info={"cycle": int(cycle)},
        )
        diff = gradient(result, x="Voltage [V]", y="Capacity [Ah]")
        df = diff.data
        derivative_col = "d(Capacity [Ah])/d(Voltage [V])"
        if derivative_col not in df.columns:
            derivative_candidates = [c for c in df.columns if c.startswith("d(") and "Voltage" in c and "Capacity" in c]
            if not derivative_candidates:
                continue
            derivative_col = derivative_candidates[0]

        dqdv = -df[derivative_col].to_numpy()
        dqdv = np.clip(dqdv, -100.0, 100.0)
        out[int(cycle)] = {
            "ica": {
                "v": df["Voltage [V]"].to_list(),
                "dqdv": dqdv.tolist(),
            },
            "dvq": None,
        }
    return out


def compute_ica_dvq_per_cycle(
    curves: dict[int, dict[str, list[float]]],
    sampling_interval_v: float = 0.002,
    sampling_interval_q: float | None = None,
    direction: Direction = "discharge",
) -> dict[int, dict[str, Any]]:
    if _HAS_PYPROBE:
        return _compute_pyprobe(curves, sampling_interval_v, sampling_interval_q, direction)
    return _compute_numpy(curves, sampling_interval_v, sampling_interval_q, direction)
