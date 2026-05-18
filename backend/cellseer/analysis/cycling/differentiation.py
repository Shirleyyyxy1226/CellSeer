"""
analysis/cycling/differentiation.py — Incremental capacity and differential voltage.

What are dQ/dV and dV/dQ?
--------------------------
These are standard electrochemical analysis techniques for battery degradation:

dQ/dV  (Incremental Capacity Analysis, ICA)
  - Plot of dQ/dV vs V
  - Peaks correspond to phase transitions in the electrode materials
  - Peak shift / area change → mode of degradation (LLI, LAM_pe, LAM_ne)

dV/dQ  (Differential Voltage Analysis, DVA)
  - Plot of dV/dQ vs Q
  - Features correspond to the same phase transitions as ICA
  - Complementary view — often easier to interpret for full-cell data

Both require numerical differentiation of noisy experimental data.
Smoothing is applied before differentiation to suppress noise.

Available functions
-------------------
dqdv(input_data, voltage_col, capacity_col, n_bins)  → Result
dvdq(input_data, voltage_col, capacity_col, n_bins)  → Result

Status
------
Implementation is a working placeholder using numpy.gradient.
For production use, consider the LEAN method (see PyProBE's differentiation
module) which is more robust to non-uniform sampling.
"""
from __future__ import annotations

from typing import TYPE_CHECKING, Optional

import numpy as np

from cellseer.data.result import Result
from cellseer.analysis.utils import AnalysisValidator

if TYPE_CHECKING:
    from cellseer.data.cycling_data import CyclingData


def dqdv(
    input_data: "CyclingData",
    voltage_col: str = "Voltage [V]",
    capacity_col: str = "Capacity [Ah]",
    n_bins: int = 1000,
    smooth_window: int = 21,
) -> Result:
    """
    Compute dQ/dV (Incremental Capacity) vs Voltage.

    Parameters
    ----------
    input_data : CyclingData
        Typically a single discharge or charge step.
    voltage_col : str
        Column name for voltage data.
    capacity_col : str
        Column name for capacity data (in Ah).
    n_bins : int
        Number of uniform voltage bins for interpolation before differentiation.
    smooth_window : int
        Savitzky-Golay smoothing window size (must be odd).  Set to 1 to disable.

    Returns
    -------
    Result
        Columns: voltage_col, "dQ/dV [Ah/V]"
    """
    v = AnalysisValidator(
        input_data=input_data,
        required_columns=[voltage_col, capacity_col],
    )
    voltage, capacity = v.variables

    # Sort by voltage for interpolation
    sort_idx = np.argsort(voltage)
    voltage = voltage[sort_idx]
    capacity = capacity[sort_idx]

    # Interpolate onto uniform voltage grid
    v_uniform = np.linspace(voltage[0], voltage[-1], n_bins)
    q_uniform = np.interp(v_uniform, voltage, capacity)

    # Differentiate
    dqdv_arr = np.gradient(q_uniform, v_uniform)

    # Smooth
    if smooth_window > 1:
        dqdv_arr = _savgol(dqdv_arr, smooth_window)

    import polars as pl
    lf = pl.from_dict({
        voltage_col:    v_uniform.tolist(),
        "dQ/dV [Ah/V]": dqdv_arr.tolist(),
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
    n_bins: int = 1000,
    smooth_window: int = 21,
) -> Result:
    """
    Compute dV/dQ (Differential Voltage) vs Capacity.

    Same parameters as dqdv() but with voltage and capacity roles swapped.
    """
    v = AnalysisValidator(
        input_data=input_data,
        required_columns=[voltage_col, capacity_col],
    )
    voltage, capacity = v.variables

    sort_idx = np.argsort(capacity)
    voltage = voltage[sort_idx]
    capacity = capacity[sort_idx]

    q_uniform = np.linspace(capacity[0], capacity[-1], n_bins)
    v_uniform = np.interp(q_uniform, capacity, voltage)

    dvdq_arr = np.gradient(v_uniform, q_uniform)

    if smooth_window > 1:
        dvdq_arr = _savgol(dvdq_arr, smooth_window)

    import polars as pl
    lf = pl.from_dict({
        capacity_col:   q_uniform.tolist(),
        "dV/dQ [V/Ah]": dvdq_arr.tolist(),
    }).lazy()

    return Result(
        lf=lf,
        info=input_data.info.copy(),
        column_definitions={
            capacity_col:   "Capacity [Amp-hours]",
            "dV/dQ [V/Ah]": "Differential voltage (dV/dQ) [V/Ah]",
        },
    )


def _savgol(arr: np.ndarray, window: int, polyorder: int = 3) -> np.ndarray:
    """Apply Savitzky-Golay smoothing; falls back to uniform if scipy missing."""
    try:
        from scipy.signal import savgol_filter
        return savgol_filter(arr, window_length=window, polyorder=polyorder)
    except ImportError:
        # Simple moving-average fallback
        kernel = np.ones(window) / window
        return np.convolve(arr, kernel, mode="same")
