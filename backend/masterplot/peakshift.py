"""dQ/dV peak-shift ("drift") metric for the Master Plot — SHELVED (2026-06-26).

Protocol-gated like ``medianCE`` / ``retention``: ``build_peak_shift`` lists every
cell that has a discharge dQ/dV dataset but returns ``peakShiftMv: None`` for all
of them, and the frontend metric (``overview/metrics.ts`` → ``dqdv-peak-shift``)
carries ``requiresProtocol: true`` so the UI shows the lock → "coming soon" flow.

Why the computation was removed: the previous metric was ``argmax(|dQ/dV|)`` over a
*doubly* smoothed curve (a second moving average on top of the stored Savitzky–Golay
result), taken over the first-3 vs last-3 cycles **blind to C-rate**. ICA peaks
shift with C-rate (polarization), not only with degradation, and many cells here
are rate tests (e.g. CEL-1's discharge current spans 1×→20×→2× across cycles), so
the reported shift mixed rate-dependence with ageing. A correct metric must lock
C-rate, which needs protocol segmentation we don't yet have.

When protocol segmentation lands, rebuild this with same-C-rate early/late windows,
a single upstream smoothing pass (no second smooth), ROI + prominence peak
detection, and a Gaussian/Pseudo-Voigt apex fit.
"""

from __future__ import annotations

from db import get_db


def _load_peak_shift_rows(project_id: str) -> list[dict]:
    """One row per cell that has a discharge dQ/dV dataset; value shelved → null."""
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
    except Exception:
        return []

    # peakShiftMv is null at source (metric shelved / protocol-gated).
    return [
        {"cellId": r["cell_id"], "peakShiftMv": None}
        for r in rows
        if r["cell_id"] and r["uri"]
    ]


def build_peak_shift(project_id: str) -> dict:
    """``{cells: [{cellId, peakShiftMv}]}`` for every cell with discharge dQ/dV.

    Shelved: ``peakShiftMv`` is always ``None`` (see module docstring).
    """
    cells = _load_peak_shift_rows(project_id)
    return {
        "cellCount": len(cells),
        "valueCount": sum(1 for c in cells if c["peakShiftMv"] is not None),
        "cells": cells,
    }
