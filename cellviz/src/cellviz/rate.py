from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Literal

import numpy as np


Direction = Literal["discharge", "charge"]


@dataclass
class ProtocolSegment:
    cycle_start: int
    cycle_end: int
    c_rate: float


@dataclass
class RatePerformanceCell:
    cell_id: str
    label: str
    cycles: list[int]
    discharge_capacity_mah: list[float]
    charge_capacity_mah: list[float] | None = None
    specific_capacity_mah_g: list[float] | None = None
    c_rates: list[float] | None = None
    protocol_segments: list[ProtocolSegment] = field(default_factory=list)
    color: str | None = None


def _cycle_capacity(
    curve: dict[str, list[float]], direction: Direction
) -> tuple[float, float] | None:
    """Return (charge_capacity, discharge_capacity) in mAh for a single cycle.

    For each direction it computes max - min capacity over the masked portion.
    """
    v = np.asarray(curve.get("Voltage [V]", []), dtype=float)
    q = np.asarray(curve.get("Capacity [Ah]", []), dtype=float)
    i = np.asarray(curve.get("Current [A]", []), dtype=float) if curve.get("Current [A]") else None
    if q.size < 2:
        return None
    chg = 0.0
    dchg = 0.0
    if i is not None and i.size == v.size:
        chg_mask = i > 0
        dchg_mask = i < 0
        if chg_mask.any():
            seg = q[chg_mask]
            chg = float(seg.max() - seg.min()) * 1000.0
        if dchg_mask.any():
            seg = q[dchg_mask]
            dchg = float(seg.max() - seg.min()) * 1000.0
    else:
        total = float(q.max() - q.min()) * 1000.0
        chg = total if direction == "charge" else 0.0
        dchg = total if direction == "discharge" else 0.0
    return chg, dchg


def compute_rate_performance(
    curves: dict[int, dict[str, list[float]]],
    *,
    direction: Direction = "discharge",
    cathode_mass_g: float | None = None,
    c_rate_map: dict[int, float] | None = None,
    protocol_segments: list[ProtocolSegment] | None = None,
    cell_id: str = "",
    label: str = "Cell",
    color: str | None = None,
) -> RatePerformanceCell:
    """Compute per-cycle discharge / charge capacity (mAh) from raw curves.

    ``c_rate_map`` (optional) yields the protocol C-rate at each cycle.
    ``protocol_segments`` may be supplied directly; if omitted but
    ``c_rate_map`` is provided, segments are derived from consecutive runs.
    """
    cycles = sorted(curves.keys())
    dchg_caps: list[float] = []
    chg_caps: list[float] = []
    valid_cycles: list[int] = []
    c_rates: list[float] = []
    for cyc in cycles:
        result = _cycle_capacity(curves[cyc], direction)
        if result is None:
            continue
        chg, dchg = result
        valid_cycles.append(int(cyc))
        chg_caps.append(chg)
        dchg_caps.append(dchg)
        if c_rate_map is not None and cyc in c_rate_map:
            c_rates.append(float(c_rate_map[cyc]))
    specific = None
    if cathode_mass_g and cathode_mass_g > 0:
        primary = dchg_caps if direction == "discharge" else chg_caps
        specific = [v / cathode_mass_g for v in primary]

    derived_segments: list[ProtocolSegment] = []
    if protocol_segments is not None:
        derived_segments = list(protocol_segments)
    elif c_rates and len(c_rates) == len(valid_cycles):
        start = valid_cycles[0]
        last = c_rates[0]
        for idx in range(1, len(valid_cycles)):
            if c_rates[idx] != last:
                derived_segments.append(
                    ProtocolSegment(
                        cycle_start=start,
                        cycle_end=valid_cycles[idx - 1],
                        c_rate=last,
                    )
                )
                start = valid_cycles[idx]
                last = c_rates[idx]
        derived_segments.append(
            ProtocolSegment(
                cycle_start=start,
                cycle_end=valid_cycles[-1],
                c_rate=last,
            )
        )

    return RatePerformanceCell(
        cell_id=cell_id,
        label=label,
        cycles=valid_cycles,
        discharge_capacity_mah=dchg_caps,
        charge_capacity_mah=chg_caps,
        specific_capacity_mah_g=specific,
        c_rates=c_rates or None,
        protocol_segments=derived_segments,
        color=color,
    )


def from_cell_dict(d: dict[str, Any]) -> RatePerformanceCell:
    """Build a RatePerformanceCell from a precomputed dict (e.g. an existing API row)."""
    segments_raw = d.get("protocolSegments") or d.get("protocol_segments") or []
    segments = [
        ProtocolSegment(
            cycle_start=int(s.get("cycleStart", s.get("cycle_start", 0))),
            cycle_end=int(s.get("cycleEnd", s.get("cycle_end", 0))),
            c_rate=float(s.get("cRate", s.get("c_rate", 0))),
        )
        for s in segments_raw
    ]
    return RatePerformanceCell(
        cell_id=str(d.get("cellId") or d.get("cell_id") or ""),
        label=str(d.get("cellName") or d.get("label") or "Cell"),
        cycles=list(d.get("cycles", [])),
        discharge_capacity_mah=list(d.get("dischargeCapacityMah") or d.get("discharge_capacity_mah") or []),
        charge_capacity_mah=list(d.get("chargeCapacityMah") or d.get("charge_capacity_mah") or []) or None,
        specific_capacity_mah_g=list(d.get("specificCapacityMahG") or d.get("specific_capacity_mah_g") or []) or None,
        c_rates=list(d.get("cRates") or d.get("c_rates") or []) or None,
        protocol_segments=segments,
        color=d.get("color"),
    )
