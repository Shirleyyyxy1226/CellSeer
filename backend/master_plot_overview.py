"""Server-side Master Plot overview.

Produces the per-cell scalar table and the condition category map served by
``GET /api/master-plot/overview``, the source of truth for the per-cell metric
columns.

Condition statistics (mean / SD / CV / CI) are computed on the frontend, over
the filtered cohort, so this module does not compute them.

``percentile`` is a round-index percentile (round-half-up) to match the client
formula for the same per-cycle input.
"""

from __future__ import annotations

import math
from typing import Optional


def _round_half_up(x: float) -> int:
    """JS ``Math.round`` semantics: .5 rounds toward +Inf (not banker's)."""
    return math.floor(x + 0.5)


def percentile(sorted_vals: list[float], p: float) -> float:
    """Round-index percentile (NOT interpolated). Used for the 95th-pct peak."""
    if not sorted_vals:
        return math.nan
    idx = min(len(sorted_vals) - 1, max(0, _round_half_up((len(sorted_vals) - 1) * p)))
    return sorted_vals[idx]


def _series_from(cycles: list[float], values: Optional[list]) -> list[tuple[float, float]]:
    out: list[tuple[float, float]] = []
    if not values:
        return out
    for i, c in enumerate(cycles):
        v = values[i] if i < len(values) else None
        if v is not None and math.isfinite(v) and v > 0:
            out.append((c, v))
    return out


def _peak_of(series: list[tuple[float, float]]) -> Optional[float]:
    if not series:
        return None
    return percentile(sorted(v for _, v in series), 0.95)


def summarise_cell(raw: dict) -> dict:
    """Per-cell scalars derived from the cell's per-cycle payload."""
    cycles = raw.get("cycles") or []
    spec = raw.get("specificCapacityMahG")
    dch = raw.get("dischargeCapacityMah") or []

    spec_series = _series_from(cycles, spec)
    raw_series = _series_from(cycles, dch)
    peak_capacity_spec = _peak_of(spec_series)
    peak_capacity_raw = _peak_of(raw_series)

    capacity_series = spec_series if spec_series else raw_series
    capacity_basis = "mAh/g" if spec_series else "mAh"

    has_protocol = bool(raw.get("protocolSegments") or raw.get("protocol"))

    # Median CE and capacity retention need the main-cycling phase isolated, which
    # needs protocol segmentation; over the full (phase-mixed) cycle series they
    # produce misleading values (a CE median can even exceed 100%). They stay None
    # until segment-aware computation lands — the UI shows "coming soon". Fade rate
    # / cycle-life / CE-drift were removed entirely for the same reason.
    median_ce: Optional[float] = None
    retention: Optional[float] = None

    return {
        "idNo": raw.get("idNo"),
        "cellId": raw.get("cellId") or "",
        "cellName": raw.get("cellName") or raw.get("cellId") or "",
        "cathode": raw.get("cathode") or "Unknown",
        "separatorType": raw.get("separatorType") or "—",
        "spacerMm": raw.get("spacerMm"),
        "hasProtocol": has_protocol,
        "protocolName": raw.get("protocol"),
        "cycleCount": len(capacity_series),
        "peakCapacitySpec": peak_capacity_spec,
        "peakCapacityRaw": peak_capacity_raw,
        "medianCE": median_ce,
        "retention": retention,
        "capacityBasis": capacity_basis,
    }


def _js_number_str(x: object) -> str:
    """Mirror JS ``String(Number)``: integer-valued floats lose the decimal
    (``1.0`` -> ``"1"``), so the condition key matches the TS ``cellConditionKey``
    template literal exactly."""
    if isinstance(x, float) and x.is_integer():
        return str(int(x))
    return str(x)


def condition_key(summary: dict) -> str:
    spacer = summary.get("spacerMm")
    spacer_str = "—" if spacer is None else _js_number_str(spacer)
    return f"{summary['cathode']}|{summary['separatorType']}|{spacer_str}"


def build_overview(raw_cells: list[dict]) -> dict:
    """Per-condition category map and per-cell scalar table.

    The shape returned by ``GET /api/master-plot/overview``. Condition statistics
    are computed on the frontend, not here.
    """
    summaries = [summarise_cell(c) for c in raw_cells]

    by_cond: dict[str, list[dict]] = {}
    for s in summaries:
        by_cond.setdefault(condition_key(s), []).append(s)

    conditions: dict[str, dict] = {}
    for key, cohort in by_cond.items():
        sample = cohort[0]
        conditions[key] = {
            "key": key,
            "cathode": sample["cathode"],
            "separatorType": sample["separatorType"],
            "spacerMm": sample["spacerMm"],
            "n": len(cohort),
        }

    cells = [
        {
            "cellId": s["cellId"],
            "condKey": condition_key(s),
            **{k: s[k] for k in (
                "idNo", "cellName", "hasProtocol", "protocolName",
                "peakCapacitySpec", "peakCapacityRaw", "medianCE", "retention",
                "cycleCount", "capacityBasis",
            )},
        }
        for s in summaries
    ]
    return {"conditions": conditions, "cells": cells}
