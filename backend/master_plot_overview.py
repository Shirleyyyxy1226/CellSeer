"""Server-side Master Plot overview reduction.

This is the Python twin of the frontend per-cell metric pipeline
(``frontend/src/features/masterPlot/overview/{metrics,stats,conditions}.ts``).
At <=5k cells the client computes these from the full per-cycle payload; beyond
that we ship per-cell *scalars* and per-condition *aggregates* from here instead
of 60 MB of arrays.

The two implementations MUST stay numerically identical. They are pinned
together by a golden-fixture parity test:
  - ``frontend/.../overview/parity.golden.test.ts`` runs the TS reference over a
    shared fixture and writes ``backend/tests/fixtures/parity_golden.json``;
  - ``backend/tests/test_master_plot_parity.py`` runs THIS module over the same
    fixture and asserts equality within 1e-9.
If you change a formula on one side, change the other and re-run both.

Every helper is a deliberate mirror — same rounding (JS ``Math.round`` is
round-half-up, NOT Python banker's rounding), same population-vs-sample SD split,
same ``percentile`` (round-index, not interpolated) used for medianCE/peak.
"""

from __future__ import annotations

import math
from typing import Optional

# --- t critical (two-sided 95%), df = n-1 — identical table to stats.ts ------
_T95 = {
    1: 12.706, 2: 4.303, 3: 3.182, 4: 2.776, 5: 2.571, 6: 2.447, 7: 2.365,
    8: 2.306, 9: 2.262, 10: 2.228, 11: 2.201, 12: 2.179, 13: 2.16, 14: 2.145,
    15: 2.131, 16: 2.12, 17: 2.11, 18: 2.101, 19: 2.093, 20: 2.086, 21: 2.08,
    22: 2.074, 23: 2.069, 24: 2.064, 25: 2.06, 26: 2.056, 27: 2.052, 28: 2.048,
    29: 2.045, 30: 2.042,
}

OUTLIER_Z = 3.5
HIGH_CV_PCT = 15
LOW_N = 3

# metric id -> the per-cell summary key it reads (mirror of METRICS[].value)
_METRIC_KEY = {
    "capacity-raw": "peakCapacityRaw",
    "capacity-spec": "peakCapacitySpec",
    "ce": "medianCE",
    "cycles": "cycleCount",  # special-cased: 0 -> None
    "retention": "retention",
    "fade-rate": "fadeRatePctPer100",
    "cycle-life-80": "cycleLife80",
    "ce-trend": "ceTrendPctPer100",
}


def _round_half_up(x: float) -> int:
    """JS ``Math.round`` semantics: .5 rounds toward +Inf (not banker's)."""
    return math.floor(x + 0.5)


def t_critical_95(df: int) -> float:
    if df <= 0:
        return math.inf
    if df <= 30:
        return _T95[df]
    if df <= 60:
        return 2.0
    return 1.96


def percentile(sorted_vals: list[float], p: float) -> float:
    """Round-index percentile — identical to metrics.ts::percentile (NOT
    interpolated). Used for medianCE and the 95th-pct peak."""
    if not sorted_vals:
        return math.nan
    idx = min(len(sorted_vals) - 1, max(0, _round_half_up((len(sorted_vals) - 1) * p)))
    return sorted_vals[idx]


def median(sorted_vals: list[float]) -> float:
    n = len(sorted_vals)
    if not n:
        return math.nan
    mid = n // 2
    return sorted_vals[mid] if n % 2 else (sorted_vals[mid - 1] + sorted_vals[mid]) / 2


def sample_sd(values: list[float]) -> Optional[float]:
    n = len(values)
    if n < 2:
        return None
    mean = sum(values) / n
    ss = sum((v - mean) ** 2 for v in values)
    return math.sqrt(ss / (n - 1))


def mad(values: list[float]) -> float:
    if len(values) < 2:
        return 0.0
    med = median(sorted(values))
    devs = sorted(abs(v - med) for v in values)
    return median(devs)


def modified_z_scores(values: list[float]) -> list[float]:
    m = mad(values)
    if m == 0:
        return [0.0 for _ in values]
    med = median(sorted(values))
    return [(0.6745 * (v - med)) / m for v in values]


def linreg_slope(points: list[tuple[float, float]]) -> Optional[float]:
    n = len(points)
    if n < 2:
        return None
    sx = sum(p[0] for p in points)
    sy = sum(p[1] for p in points)
    mx = sx / n
    my = sy / n
    num = 0.0
    den = 0.0
    for x, y in points:
        dx = x - mx
        num += dx * (y - my)
        den += dx * dx
    if den == 0:
        return None
    return num / den


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
    """Mirror of metrics.ts::summariseCell — returns the per-cell scalars."""
    cycles = raw.get("cycles") or []
    spec = raw.get("specificCapacityMahG")
    dch = raw.get("dischargeCapacityMah") or []
    chg = raw.get("chargeCapacityMah") or []

    spec_series = _series_from(cycles, spec)
    raw_series = _series_from(cycles, dch)
    peak_capacity_spec = _peak_of(spec_series)
    peak_capacity_raw = _peak_of(raw_series)

    capacity_series = spec_series if spec_series else raw_series
    capacity_basis = "mAh/g" if spec_series else "mAh"

    # CE only over meaningful cycles (>=5% of peak discharge).
    ce_floor = (peak_capacity_raw or 0) * 0.05
    ce_vals: list[float] = []
    for i in range(len(cycles)):
        c = chg[i] if i < len(chg) else None
        d = dch[i] if i < len(dch) else None
        if c is not None and d is not None and c > ce_floor and d > ce_floor and ce_floor > 0:
            ce = (d / c) * 100
            if 0 < ce < 150:
                ce_vals.append(ce)
    ce_vals.sort()
    median_ce = percentile(ce_vals, 0.5) if ce_vals else None

    has_protocol = bool(raw.get("protocolSegments") or raw.get("protocol"))

    # Protocol-scoped retention / fade rate / cycle life / CE drift are not yet
    # implemented. Computed over the full cycle series they mix formation,
    # rate-test and main-cycling phases into a misleading number, so they are
    # left unset until segment-aware computation lands. The UI shows "coming
    # soon" for these metrics once a protocol is attached.
    retention: Optional[float] = None
    fade_rate: Optional[float] = None
    ce_trend: Optional[float] = None
    cycle_life_80: Optional[float] = None

    return {
        "idNo": raw.get("idNo"),
        "cellId": raw.get("cellId") or "",
        "cathode": raw.get("cathode") or "Unknown",
        "separatorType": raw.get("separatorType") or "—",
        "spacerMm": raw.get("spacerMm"),
        "hasProtocol": has_protocol,
        "cycleCount": len(capacity_series),
        "peakCapacitySpec": peak_capacity_spec,
        "peakCapacityRaw": peak_capacity_raw,
        "medianCE": median_ce,
        "retention": retention,
        "fadeRatePctPer100": fade_rate,
        "ceTrendPctPer100": ce_trend,
        "cycleLife80": cycle_life_80,
        "capacityBasis": capacity_basis,
    }


def _metric_value(summary: dict, metric_id: str) -> Optional[float]:
    if metric_id == "cycles":
        cc = summary.get("cycleCount") or 0
        return cc if cc > 0 else None
    key = _METRIC_KEY.get(metric_id)
    return summary.get(key) if key else None


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


def compute_cond_stat(values: list[float]) -> dict:
    """Mirror of conditions.ts::computeCondStats per-condition entry.

    NOTE the deliberate split: ``sd`` here is the POPULATION sd (/n) describing
    replicate spread, while the CI half-width comes from meanCI's SAMPLE sd
    (/(n-1)). They are different quantities on purpose."""
    n = len(values)
    if not n:
        return {"mean": None, "sd": None, "cv": None, "sem": None, "ciHalf": None, "n": 0}
    mean = sum(values) / n
    pop_sd = math.sqrt(sum((v - mean) ** 2 for v in values) / n)
    has_spread = n >= 2
    cv = (pop_sd / abs(mean)) * 100 if has_spread and mean != 0 else None
    sem = None
    ci_half = None
    if n >= 2:
        s_sd = sample_sd(values)
        sem = s_sd / math.sqrt(n)
        ci_half = t_critical_95(n - 1) * sem
    return {
        "mean": mean,
        "sd": pop_sd if has_spread else None,
        "cv": cv,
        "sem": sem,
        "ciHalf": ci_half,
        "n": n,
    }


def compute_flag_ids(summaries: list[dict]) -> dict[str, list[str]]:
    """Mirror of conditions.ts::computeFlaggedCells, returning flag-id lists."""
    by_cond: dict[str, list[dict]] = {}
    for s in summaries:
        by_cond.setdefault(condition_key(s), []).append(s)

    flags: dict[str, list[str]] = {}
    for cohort in by_cond.values():
        cap_cells = [c for c in cohort if c.get("peakCapacityRaw") is not None]
        caps = [c["peakCapacityRaw"] for c in cap_cells]
        cap_z = modified_z_scores(caps) if len(caps) >= 4 else None
        outlier_ids: dict[str, float] = {}
        if cap_z is not None:
            for c, z in zip(cap_cells, cap_z):
                if abs(z) > OUTLIER_Z:
                    outlier_ids[c["cellId"]] = z
        for c in cohort:
            ids: list[str] = []
            if c["cellId"] in outlier_ids and c.get("peakCapacityRaw") is not None:
                ids.append("cap-outlier")
            mce = c.get("medianCE")
            if mce is not None and (mce < 98 or mce > 102):
                ids.append("ce-anomaly")
            cc = c.get("cycleCount", 0)
            if 0 < cc < 5:
                ids.append("few-cycles")
            if ids:
                flags[c["cellId"]] = ids
    return flags


def build_overview(raw_cells: list[dict], metrics: Optional[list[str]] = None) -> dict:
    """Per-condition aggregates + a compact per-cell scalar table.

    The shape returned by ``GET /api/master-plot/overview`` — no per-cycle arrays.
    """
    if metrics is None:
        metrics = list(_METRIC_KEY.keys())
    summaries = [summarise_cell(c) for c in raw_cells]
    flags = compute_flag_ids(summaries)

    by_cond: dict[str, list[dict]] = {}
    for s in summaries:
        by_cond.setdefault(condition_key(s), []).append(s)

    conditions: dict[str, dict] = {}
    for key, cohort in by_cond.items():
        per_metric: dict[str, dict] = {}
        for mid in metrics:
            vals = [
                v for v in (_metric_value(s, mid) for s in cohort)
                if v is not None and math.isfinite(v)
            ]
            per_metric[mid] = compute_cond_stat(vals)
        sample = cohort[0]
        conditions[key] = {
            "key": key,
            "cathode": sample["cathode"],
            "separatorType": sample["separatorType"],
            "spacerMm": sample["spacerMm"],
            "n": len(cohort),
            "flaggedCount": sum(1 for c in cohort if c["cellId"] in flags),
            "metrics": per_metric,
        }

    cells = [
        {
            "cellId": s["cellId"],
            "condKey": condition_key(s),
            "flags": flags.get(s["cellId"], []),
            **{k: s[k] for k in (
                "peakCapacitySpec", "peakCapacityRaw", "medianCE", "retention",
                "fadeRatePctPer100", "ceTrendPctPer100", "cycleLife80",
                "cycleCount", "capacityBasis",
            )},
        }
        for s in summaries
    ]
    return {"conditions": conditions, "cells": cells}
