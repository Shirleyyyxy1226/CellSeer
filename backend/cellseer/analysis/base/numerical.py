"""
analysis/base/numerical.py — General-purpose numerical utilities.

These functions are standalone numpy/scipy routines used by the higher-level
analysis functions.  They have no dependency on CellSeer types.

Functions
---------
smooth(arr, window, method)   — 1D signal smoothing
interpolate_uniform(x, y, n)  — resample onto a uniform grid
gradient(x, y)                — finite-difference derivative with edge handling
"""
from __future__ import annotations

import numpy as np


def smooth(
    arr: np.ndarray,
    window: int = 11,
    method: str = "savgol",
    polyorder: int = 3,
) -> np.ndarray:
    """
    Smooth a 1D array.

    Parameters
    ----------
    arr : np.ndarray
        Input signal.
    window : int
        Smoothing window length (must be odd for Savitzky-Golay).
    method : str
        "savgol"   — Savitzky-Golay filter (preserves peak shapes best)
        "moving"   — simple moving average (fast but distorts peaks)
    polyorder : int
        Polynomial order for Savitzky-Golay (ignored for moving average).

    Returns
    -------
    np.ndarray
        Smoothed signal, same length as input.
    """
    if window < 2:
        return arr.copy()

    if method == "savgol":
        try:
            from scipy.signal import savgol_filter
            if window % 2 == 0:
                window += 1  # must be odd
            return savgol_filter(arr, window_length=window, polyorder=polyorder)
        except ImportError:
            method = "moving"  # fall back

    if method == "moving":
        kernel = np.ones(window) / window
        return np.convolve(arr, kernel, mode="same")

    raise ValueError(f"Unknown smoothing method: {method!r}. Use 'savgol' or 'moving'.")


def interpolate_uniform(
    x: np.ndarray,
    y: np.ndarray,
    n: int = 1000,
) -> tuple[np.ndarray, np.ndarray]:
    """
    Resample (x, y) onto a uniform x-grid with n points.

    Uses linear interpolation (np.interp).  x must be monotonically
    increasing; call np.sort first if needed.

    Parameters
    ----------
    x, y : np.ndarray
        Source data.  x must be sorted ascending.
    n : int
        Number of output points.

    Returns
    -------
    (x_uniform, y_uniform) as numpy arrays of length n.
    """
    x_uniform = np.linspace(x[0], x[-1], n)
    y_uniform = np.interp(x_uniform, x, y)
    return x_uniform, y_uniform


def gradient(x: np.ndarray, y: np.ndarray) -> np.ndarray:
    """
    Finite-difference gradient dy/dx.

    Uses np.gradient which applies second-order accuracy at interior points
    and first-order at boundaries.  Handles non-uniform x spacing correctly.

    Parameters
    ----------
    x, y : np.ndarray
        Must be the same length.  x need not be uniform.

    Returns
    -------
    np.ndarray
        dy/dx at each point, same length as input.
    """
    return np.gradient(y, x)
