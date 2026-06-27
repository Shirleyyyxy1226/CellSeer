"""Tests for build_overview (the Master Plot overview).

The overview is the single source of truth for the per-cell metric scalars; the
frontend derives condition statistics and flags from them client-side, so this
module deliberately does not compute those. These tests pin the per-cell scalar
contract and the condition category map.

Run from the backend/ dir with `-c /dev/null` (a stray backend/pyproject.toml
otherwise hijacks pytest's rootdir):
    python3 -m pytest tests/test_master_plot_overview.py -c /dev/null
"""

from masterplot.overview import build_overview, summarise_cell


def _raw(cell_id, id_no, cathode, sep, spacer, dch, *, spec=None, protocol=None, name=None):
    cycles = list(range(1, len(dch) + 1))
    return {
        "idNo": id_no,
        "cellId": cell_id,
        "cellName": name,
        "cathode": cathode,
        "separatorType": sep,
        "spacerMm": spacer,
        "protocol": protocol,
        "cycles": cycles,
        "dischargeCapacityMah": dch,
        "specificCapacityMahG": spec,
    }


def test_peak_capacity_is_95th_percentile_round_index():
    # 10 ascending values: round-index 95th pct → idx round(9*0.95)=round(8.55)=9 → 100.
    c = summarise_cell(_raw("A", 1, "LFP", "PP", 1.0, [10, 20, 30, 40, 50, 60, 70, 80, 90, 100]))
    assert c["peakCapacityRaw"] == 100
    # No specific capacity → spec peak is None, basis falls back to mAh.
    assert c["peakCapacitySpec"] is None
    assert c["capacityBasis"] == "mAh"


def test_specific_capacity_preferred_when_present():
    c = summarise_cell(_raw("A", 1, "LFP", "PP", 1.0, [100, 99, 98], spec=[150, 149, 148]))
    assert c["capacityBasis"] == "mAh/g"
    assert c["peakCapacitySpec"] == 150


def test_cell_output_carries_identity_and_protocol_fields():
    cells = [
        _raw("A-1", 11, "LFP", "PP", 1.0, [100, 99, 98], protocol="C/20", name="Alpha"),
        _raw("A-2", 12, "LFP", "PP", 1.0, [97, 96, 95]),
    ]
    out = build_overview(cells)
    by_id = {c["cellId"]: c for c in out["cells"]}

    a1 = by_id["A-1"]
    assert a1["idNo"] == 11
    assert a1["cellName"] == "Alpha"
    assert a1["hasProtocol"] is True
    assert a1["protocolName"] == "C/20"
    assert a1["condKey"] == "LFP|PP|1"  # integer-valued spacer loses the decimal

    a2 = by_id["A-2"]
    assert a2["hasProtocol"] is False
    assert a2["protocolName"] is None
    assert a2["cellName"] == "A-2"  # falls back to cellId when name is missing


def test_conditions_are_category_only_no_stats():
    cells = [
        _raw("A-1", 1, "LFP", "PP", 1.0, [100, 99]),
        _raw("A-2", 2, "LFP", "PP", 1.0, [98, 97]),
        _raw("B-1", 3, "NMC", "GF", None, [80, 79]),
    ]
    out = build_overview(cells)

    assert set(out["conditions"]) == {"LFP|PP|1", "NMC|GF|—"}
    lfp = out["conditions"]["LFP|PP|1"]
    assert lfp == {
        "key": "LFP|PP|1",
        "cathode": "LFP",
        "separatorType": "PP",
        "spacerMm": 1.0,
        "n": 2,
    }
    # Stats and flags are a frontend concern now — never emitted here.
    assert "metrics" not in lfp
    assert "flaggedCount" not in lfp
    assert all("flags" not in c for c in out["cells"])


def test_empty_input():
    out = build_overview([])
    assert out == {"conditions": {}, "cells": []}
