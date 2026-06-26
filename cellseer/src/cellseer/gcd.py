from __future__ import annotations

from typing import Any, Literal

import numpy as np


Direction = Literal["discharge", "charge"]


def _split_by_current(
    v: np.ndarray, q: np.ndarray, i: np.ndarray | None, scale: float, mass_g: float | None
) -> tuple[list[tuple[float, float]], list[tuple[float, float]]]:
    """Split (V, Q) points into charge / discharge bins by current sign.

    Q is scaled (1000 for Ah->mAh) and optionally divided by cathode mass (g)
    to yield specific capacity.
    """
    charge: list[tuple[float, float]] = []
    discharge: list[tuple[float, float]] = []
    n = min(v.size, q.size)
    for j in range(n):
        vv = v[j]
        qq = q[j]
        if not (np.isfinite(vv) and np.isfinite(qq)):
            continue
        q_val = float(qq) * scale
        if mass_g is not None and mass_g > 0:
            q_val = q_val / mass_g
        if i is None or i.size != n or not np.isfinite(i[j]):
            charge.append((q_val, float(vv)))
        elif i[j] > 0:
            charge.append((q_val, float(vv)))
        elif i[j] < 0:
            discharge.append((q_val, float(vv)))
        # i[j] == 0: rest step — skip
    return charge, discharge


def compute_gcd_per_cycle(
    curves: dict[int, dict[str, list[float]]],
    *,
    direction: Direction = "discharge",
    max_points: int = 2500,
    cathode_mass_g: float | None = None,
) -> dict[int, dict[str, Any]]:
    """Compute per-cycle GCD curves split by current sign.

    Returns ``{cycle: {q, v}}`` where x is the normalized capacity along the
    requested direction (charge starts at 0, discharge runs from 0 outward
    toward q_max - q_dchg_min).
    """
    out: dict[int, dict[str, Any]] = {}
    for cycle, curve in sorted(curves.items()):
        v_raw = np.asarray(curve.get("Voltage [V]", []), dtype=float)
        q_raw = np.asarray(curve.get("Capacity [Ah]", []), dtype=float)
        current = curve.get("Current [A]")
        i_raw = np.asarray(current, dtype=float) if current is not None else None
        if v_raw.size < 2 or q_raw.size < 2:
            continue
        scale = 1000.0  # Ah -> mAh
        charge, discharge = _split_by_current(v_raw, q_raw, i_raw, scale, cathode_mass_g)

        if direction == "charge" and len(charge) >= 2:
            q_min = min(p[0] for p in charge)
            pts = charge[:max_points]
            qs = [p[0] - q_min for p in pts]
            vs = [p[1] for p in pts]
            out[int(cycle)] = {"q": qs, "v": vs}
        elif direction == "discharge" and len(discharge) >= 2:
            q_max = max(p[0] for p in discharge)
            pts = discharge[:max_points]
            qs = [q_max - p[0] for p in pts]
            vs = [p[1] for p in pts]
            out[int(cycle)] = {"q": qs, "v": vs}
    return out
