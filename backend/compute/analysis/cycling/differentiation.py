"""
analysis/cycling/differentiation.py — Incremental capacity and differential voltage.

What are dQ/dV and dV/dQ?
--------------------------
dQ/dV  (Incremental Capacity Analysis) — dQ/dV vs V; peaks = electrode phase
       transitions; peak shift / area change → degradation mode (LLI, LAM).
dV/dQ  (Differential Voltage Analysis)  — dV/dQ vs Q; complementary view.

Both require numerically differentiating noisy experimental data, which amplifies
noise. We offer two methods (Savitzky–Golay was dropped):

  method="lean" (default)
      PyProBE's LEAN method (Feng et al. 2020, eTransportation 3:100051): bin one
      axis at a fixed level and *count* samples per level instead of dividing a
      noisy ΔQ by a noisy ΔV. Noise-robust by construction. We add **bin
      protection** — an adaptive bin-size multiple `k` targeting ~`lean_target_bins`
      voltage bins — so flat plateaus (tiny min voltage spacing) cannot explode the
      bin count / OOM.
  method="raw"
      Plain finite difference (numpy.gradient on a uniform grid), no smoothing —
      the unprocessed view.

Available functions
-------------------
dqdv(input_data, ..., method="lean") → Result    columns: voltage_col, "dQ/dV [Ah/V]"
dvdq(input_data, ..., method="lean") → Result    columns: capacity_col, "dV/dQ [V/Ah]"
"""
from __future__ import annotations

from typing import TYPE_CHECKING

import numpy as np

from compute.data.result import Result
from compute.analysis.utils import AnalysisValidator

if TYPE_CHECKING:
    from compute.data.cycling_data import CyclingData

# Default LEAN smoothing kernel (5-point, from Feng et al. 2020 / PyProBE examples).
# Paired with lean_target_bins=180 as a balance: sharper peaks than 120/7-point on
# clean cycles, without re-introducing baseline noise on sparse/noisy cycles.
_LEAN_KERNEL = [0.0668, 0.2417, 0.3830, 0.2417, 0.0668]


def _lean_diff(
    voltage: np.ndarray,
    capacity: np.ndarray,
    *,
    want: str,
    target_bins: int = 180,
    kernel: list[float] | None = None,
    resample_n: int = 400,
) -> tuple[np.ndarray, np.ndarray] | tuple[None, None]:
    """PyProBE LEAN differentiation with bin protection.

    ``want`` = "dqdv" (returns voltage, dQ/dV) or "dvdq" (returns capacity, dV/dQ).

    LEAN assumes the binned axis is uniformly sampled in capacity, so we first
    resample (V, Q) onto a uniform capacity grid. ``k`` is chosen so the number of
    voltage bins ≈ ``target_bins`` (bin protection: prevents the min-voltage-spacing
    → 0 blow-up that OOMs PyProBE's raw call). Sign follows PyProBE's natural output
    (empirically matches the previous np.gradient convention). Returns (None, None)
    if the segment is too short / degenerate.
    """
    from pyprobe.result import Result as PpResult
    from pyprobe.analysis.differentiation import differentiate_lean
    import polars as pl

    v = np.asarray(voltage, dtype=float)
    q = np.asarray(capacity, dtype=float)
    n = min(v.size, q.size)
    if n < 30:
        return None, None
    v, q = v[:n], q[:n]

    # Order by capacity ascending (uniform-in-time during CC ⇒ uniform x for LEAN).
    order = np.argsort(q)
    v, q = v[order], q[order]
    q_unique, idx = np.unique(q, return_index=True)
    v_unique = v[idx]
    if q_unique.size < 30:
        return None, None
    q_grid = np.linspace(q_unique[0], q_unique[-1], resample_n)
    v_grid = np.interp(q_grid, q_unique, v_unique)

    v_range = float(v_grid.max() - v_grid.min())
    spacing = np.diff(np.unique(np.sort(v_grid)))
    gap = float(np.min(spacing)) if spacing.size else 0.0
    if not (np.isfinite(gap) and gap > 0.0 and v_range > 0.0):
        return None, None
    k = max(1, int(round(v_range / (target_bins * gap))))  # bin protection

    res = PpResult(
        lf=pl.DataFrame({"Capacity [Ah]": q_grid, "Voltage [V]": v_grid}).lazy(),
        info={},
    )
    gradient = "dxdy" if want == "dqdv" else "dydx"
    try:
        out = differentiate_lean(
            res,
            x="Capacity [Ah]",
            y="Voltage [V]",
            k=k,
            gradient=gradient,
            smoothing_filter=list(kernel) if kernel else _LEAN_KERNEL,
            section="longest",
        ).data
    except Exception:
        return None, None

    deriv_cols = [c for c in out.columns if c.startswith("d(")]
    if not deriv_cols or out.height < 2:
        return None, None
    deriv_col = deriv_cols[0]
    axis_col = "Voltage [V]" if want == "dqdv" else "Capacity [Ah]"
    out = out.sort(axis_col)
    return out[axis_col].to_numpy(), out[deriv_col].to_numpy()


def dqdv(
    input_data: "CyclingData",
    voltage_col: str = "Voltage [V]",
    capacity_col: str = "Capacity [Ah]",
    *,
    method: str = "lean",
    n_bins: int = 1000,
    lean_target_bins: int = 180,
    lean_kernel: list[float] | None = None,
) -> Result:
    """Compute dQ/dV (Incremental Capacity) vs Voltage.

    ``method`` = "lean" (default, PyProBE LEAN + bin protection) or "raw"
    (numpy.gradient, no smoothing). Returns columns: ``voltage_col``, "dQ/dV [Ah/V]".
    """
    v = AnalysisValidator(input_data=input_data, required_columns=[voltage_col, capacity_col])
    voltage, capacity = v.variables

    if method == "lean":
        v_out, dqdv_arr = _lean_diff(
            voltage, capacity, want="dqdv",
            target_bins=lean_target_bins, kernel=lean_kernel,
        )
        if v_out is None:
            raise ValueError("LEAN dQ/dV produced no usable bins for this segment.")
    elif method == "raw":
        sort_idx = np.argsort(voltage)
        vs, qs = voltage[sort_idx], capacity[sort_idx]
        v_out = np.linspace(vs[0], vs[-1], n_bins)
        dqdv_arr = np.gradient(np.interp(v_out, vs, qs), v_out)
    else:
        raise ValueError(f"Unknown method {method!r}. Use 'lean' or 'raw'.")

    import polars as pl
    lf = pl.from_dict({
        voltage_col:    np.asarray(v_out).tolist(),
        "dQ/dV [Ah/V]": np.asarray(dqdv_arr).tolist(),
    }).lazy()
    return Result(
        lf=lf,
        info=input_data.info.copy(),
        column_definitions={
            voltage_col:     "Voltage [Volts]",
            "dQ/dV [Ah/V]":  "Incremental capacity (dQ/dV) [Ah/V]",
        },
    )


def dvdq(
    input_data: "CyclingData",
    voltage_col: str = "Voltage [V]",
    capacity_col: str = "Capacity [Ah]",
    *,
    method: str = "lean",
    n_bins: int = 1000,
    lean_target_bins: int = 180,
    lean_kernel: list[float] | None = None,
) -> Result:
    """Compute dV/dQ (Differential Voltage) vs Capacity.

    Same methods as :func:`dqdv` with voltage and capacity roles swapped.
    Returns columns: ``capacity_col``, "dV/dQ [V/Ah]".
    """
    v = AnalysisValidator(input_data=input_data, required_columns=[voltage_col, capacity_col])
    voltage, capacity = v.variables

    if method == "lean":
        q_out, dvdq_arr = _lean_diff(
            voltage, capacity, want="dvdq",
            target_bins=lean_target_bins, kernel=lean_kernel,
        )
        if q_out is None:
            raise ValueError("LEAN dV/dQ produced no usable bins for this segment.")
    elif method == "raw":
        sort_idx = np.argsort(capacity)
        qs, vs = capacity[sort_idx], voltage[sort_idx]
        q_out = np.linspace(qs[0], qs[-1], n_bins)
        dvdq_arr = np.gradient(np.interp(q_out, qs, vs), q_out)
    else:
        raise ValueError(f"Unknown method {method!r}. Use 'lean' or 'raw'.")

    import polars as pl
    lf = pl.from_dict({
        capacity_col:   np.asarray(q_out).tolist(),
        "dV/dQ [V/Ah]": np.asarray(dvdq_arr).tolist(),
    }).lazy()
    return Result(
        lf=lf,
        info=input_data.info.copy(),
        column_definitions={
            capacity_col:   "Capacity [Amp-hours]",
            "dV/dQ [V/Ah]": "Differential voltage (dV/dQ) [V/Ah]",
        },
    )
