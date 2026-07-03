from __future__ import annotations

from typing import Any, Literal

import numpy as np

try:
    import polars as pl  # noqa: F401
    import pyprobe  # noqa: F401

    _HAS_PYPROBE = True
except Exception:
    _HAS_PYPROBE = False

try:
    import navani.echem  # noqa: F401

    _HAS_NAVANI = True
except Exception:
    _HAS_NAVANI = False


Direction = Literal["discharge", "charge"]

# Default LEAN smoothing kernel (5-point, Feng et al. 2020 / PyProBE examples).
# Paired with lean_target_bins=180 (sharper peaks on clean cycles without
# re-introducing baseline noise on sparse cycles).
_LEAN_KERNEL = [0.0668, 0.2417, 0.3830, 0.2417, 0.0668]


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


def _lean_diff(
    v_raw: np.ndarray,
    q_raw: np.ndarray,
    *,
    want: str,
    target_bins: int = 180,
    kernel: list[float] | None = None,
    resample_n: int = 400,
) -> tuple[list[float], list[float]] | None:
    """PyProBE LEAN differentiation with bin protection (mirrors the backend).

    ``want`` = "dqdv" → returns (voltage, dQ/dV); "dvdq" → returns (capacity, dV/dQ).
    Resamples onto a uniform capacity grid (LEAN's assumption), and picks the bin
    multiple ``k`` so #voltage-bins ≈ ``target_bins`` — preventing the flat-plateau
    bin-count blow-up that OOMs PyProBE's raw call. Returns None if degenerate.
    """
    from pyprobe.result import Result
    from pyprobe.analysis.differentiation import differentiate_lean

    v = np.asarray(v_raw, dtype=float)
    q = np.asarray(q_raw, dtype=float)
    n = min(v.size, q.size)
    if n < 30:
        return None
    v, q = v[:n], q[:n]
    order = np.argsort(q)
    v, q = v[order], q[order]
    q_unique, idx = np.unique(q, return_index=True)
    v_unique = v[idx]
    if q_unique.size < 30:
        return None
    q_grid = np.linspace(q_unique[0], q_unique[-1], resample_n)
    v_grid = np.interp(q_grid, q_unique, v_unique)

    v_range = float(v_grid.max() - v_grid.min())
    spacing = np.diff(np.unique(np.sort(v_grid)))
    if spacing.size == 0 or not (np.isfinite(v_range) and v_range > 0.0):
        return None

    gradient = "dxdy" if want == "dqdv" else "dydx"
    smoothing = list(kernel) if kernel else _LEAN_KERNEL
    axis_col = "Voltage [V]" if want == "dqdv" else "Capacity [Ah]"
    blow_cap = 1.0 if want == "dqdv" else 1.0e5  # non-physical above this → blow-up

    def _attempt(gap: float):
        if not (np.isfinite(gap) and gap > 0.0):
            return None
        k = max(1, int(round(v_range / (target_bins * gap))))
        res = Result(
            lf=pl.DataFrame({"Capacity [Ah]": q_grid, "Voltage [V]": v_grid}).lazy(),
            info={},
        )
        try:
            out = differentiate_lean(
                res, x="Capacity [Ah]", y="Voltage [V]", k=k, gradient=gradient,
                smoothing_filter=smoothing, section="longest",
            ).data
        except Exception:
            return None
        deriv_cols = [c for c in out.columns if c.startswith("d(")]
        if not deriv_cols or out.height < 2:
            return None
        out = out.sort(axis_col)
        return out[axis_col].to_list(), out[deriv_cols[0]].to_list()

    def _blown(result) -> bool:
        if result is None:
            return True
        y = np.asarray(result[1], dtype=float)
        return (not np.all(np.isfinite(y))) or float(np.max(np.abs(y))) > blow_cap

    # min-spacing k first; if it blows up to non-physical values, self-repair by
    # recomputing this cycle with a robust 25th-percentile spacing (one near-flat
    # region can't then inflate k). Whole cycle recomputed — not a clamp.
    result = _attempt(float(np.min(spacing)))
    if _blown(result):
        repaired = _attempt(float(np.percentile(spacing, 25)))
        if not _blown(repaired):
            result = repaired
    if result is None:
        return None
    # Cap resolution: the robust-spacing retry can over-resolve (tiny k → many
    # bins). Decimate to ≤max_out points; preserves the curve and integral.
    ax, dy = result
    max_out = 1000
    if len(ax) > max_out:
        step = (len(ax) + max_out - 1) // max_out
        ax, dy = ax[::step], dy[::step]
    return ax, dy


def _raw_cycle(
    v_raw: np.ndarray,
    q_raw: np.ndarray,
    sampling_interval_v: float,
    sampling_interval_q: float | None,
) -> dict[str, Any]:
    """Plain finite-difference payload for one cycle — no smoothing, no clipping,
    no sign flip (matches the backend's raw convention)."""
    payload: dict[str, Any] = {"dqdv": None, "dvdq": None}

    vq = _prepare_vq_sorted(v_raw, q_raw)
    if vq is not None:
        v, q = vq
        v_grid = _build_grid(float(v[0]), float(v[-1]), sampling_interval_v)
        if v_grid.size >= 2:
            q_grid = np.interp(v_grid, v, q)
            if q_grid.size >= 2:
                payload["dqdv"] = {"v": v_grid.tolist(), "dqdv": np.gradient(q_grid, v_grid).tolist()}

    qv = _prepare_qv_sorted(v_raw, q_raw)
    if qv is not None:
        q, v = qv
        q_grid = _build_grid(float(q[0]), float(q[-1]), sampling_interval_q)
        if q_grid.size >= 2:
            v_grid = np.interp(q_grid, q, v)
            if v_grid.size >= 2:
                payload["dvdq"] = {"q": q_grid.tolist(), "dvdq": np.gradient(v_grid, q_grid).tolist()}
    return payload


def _navani_diff(
    v_raw: np.ndarray,
    q_raw: np.ndarray,
    *,
    want: str,
    max_points: int = 200,
) -> tuple[list[float], list[float]] | None:
    """navani Savitzky–Golay + spline differentiation (mirrors the backend).

    ``want`` = "dqdv" → (voltage, dQ/dV [Ah/V]); "dvdq" → (capacity, dV/dQ [V/Ah]).
    Differentiates a smoothed spline, so the derivative is bounded by construction
    (no bin-division blow-up, no capacity-range collapse). Needs ≳101 points;
    returns None for shorter segments. Output decimated to ~max_points.
    """
    import navani.echem as ne

    v = np.asarray(v_raw, dtype=float)
    q = np.asarray(q_raw, dtype=float)
    n = min(v.size, q.size)
    if n < 101:
        return None
    v, q = v[:n], q[:n]
    q_mah = q * 1000.0  # navani's smoothing defaults are tuned on mAh-scale capacity
    try:
        if want == "dqdv":
            x_axis, deriv, _ = ne.dqdv_single_cycle(q_mah, v)
            x_axis = np.asarray(x_axis, dtype=float)
            deriv = np.asarray(deriv, dtype=float) / 1000.0  # mAh/V → Ah/V
        else:
            x_axis, deriv, _ = ne.dqdv_single_cycle(v, q_mah)
            x_axis = np.asarray(x_axis, dtype=float) / 1000.0  # mAh → Ah
            deriv = np.asarray(deriv, dtype=float) * 1000.0   # V/mAh → V/Ah
    except Exception:
        return None
    mask = np.isfinite(x_axis) & np.isfinite(deriv)
    x_axis, deriv = x_axis[mask], deriv[mask]
    if x_axis.size < 2:
        return None
    if x_axis.size > max_points:
        idx = np.linspace(0, x_axis.size - 1, max_points).round().astype(int)
        x_axis, deriv = x_axis[idx], deriv[idx]
    order = np.argsort(x_axis)
    return x_axis[order].tolist(), deriv[order].tolist()


def _compute_navani(
    curves: dict[int, dict[str, list[float]]],
    direction: Direction,
    sampling_interval_v: float,
    sampling_interval_q: float | None,
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for cycle, curve in sorted(curves.items()):
        extracted = _extract_directional_vq(curve, direction)
        if extracted is None:
            continue
        v_raw, q_raw = extracted
        payload: dict[str, Any] = {"dqdv": None, "dvdq": None}

        dq = _navani_diff(v_raw, q_raw, want="dqdv")
        if dq is not None:
            payload["dqdv"] = {"v": dq[0], "dqdv": dq[1]}
        dv = _navani_diff(v_raw, q_raw, want="dvdq")
        if dv is not None:
            payload["dvdq"] = {"q": dv[0], "dvdq": dv[1]}

        # Short segments (< navani's SG window) fall back to raw so they still
        # produce a usable derivative rather than vanishing.
        if payload["dqdv"] is None and payload["dvdq"] is None:
            payload = _raw_cycle(v_raw, q_raw, sampling_interval_v, sampling_interval_q)
        if payload["dqdv"] is None and payload["dvdq"] is None:
            continue
        out[int(cycle)] = payload
    return out


def _compute_lean(
    curves: dict[int, dict[str, list[float]]],
    direction: Direction,
    target_bins: int,
    kernel: list[float] | None,
    sampling_interval_v: float,
    sampling_interval_q: float | None,
) -> dict[int, dict[str, Any]]:
    out: dict[int, dict[str, Any]] = {}
    for cycle, curve in sorted(curves.items()):
        extracted = _extract_directional_vq(curve, direction)
        if extracted is None:
            continue
        v_raw, q_raw = extracted
        payload: dict[str, Any] = {"dqdv": None, "dvdq": None}

        dq = _lean_diff(v_raw, q_raw, want="dqdv", target_bins=target_bins, kernel=kernel)
        if dq is not None:
            payload["dqdv"] = {"v": dq[0], "dqdv": dq[1]}
        dv = _lean_diff(v_raw, q_raw, want="dvdq", target_bins=target_bins, kernel=kernel)
        if dv is not None:
            payload["dvdq"] = {"q": dv[0], "dvdq": dv[1]}

        # LEAN needs enough points to bin; fall back to raw for short segments so
        # small/synthetic curves still produce a usable derivative.
        if payload["dqdv"] is None and payload["dvdq"] is None:
            payload = _raw_cycle(v_raw, q_raw, sampling_interval_v, sampling_interval_q)
        if payload["dqdv"] is None and payload["dvdq"] is None:
            continue
        out[int(cycle)] = payload
    return out


def _compute_raw(
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
        payload = _raw_cycle(extracted[0], extracted[1], sampling_interval_v, sampling_interval_q)
        if payload["dqdv"] is None and payload["dvdq"] is None:
            continue
        out[int(cycle)] = payload
    return out


def compute_dqdv_dvdq_per_cycle(
    curves: dict[int, dict[str, list[float]]],
    sampling_interval_v: float = 0.002,
    sampling_interval_q: float | None = None,
    direction: Direction = "discharge",
    method: str = "lean",
    lean_target_bins: int = 180,
    lean_kernel: list[float] | None = None,
) -> dict[int, dict[str, Any]]:
    """Per-cycle dQ/dV and dV/dQ.

    method="lean" (default) — PyProBE LEAN + bin protection, with self-repair:
    cycles whose min-spacing k produces non-physical blow-ups are recomputed with a
    robust 25th-percentile spacing. Conserves the physics (integral) far better than
    the spline alternative. Falls back to "raw" if PyProBE is unavailable.
    method="navani" — Savitzky–Golay + spline (bounded but under-integrates on
    non-monotonic discharge; kept as an option).
    method="raw" — plain numpy.gradient, no smoothing/clipping/sign-flip.
    """
    if method == "navani" and _HAS_NAVANI:
        return _compute_navani(curves, direction, sampling_interval_v, sampling_interval_q)
    if method == "lean" and _HAS_PYPROBE:
        return _compute_lean(
            curves, direction, lean_target_bins, lean_kernel,
            sampling_interval_v, sampling_interval_q,
        )
    return _compute_raw(curves, sampling_interval_v, sampling_interval_q, direction)
