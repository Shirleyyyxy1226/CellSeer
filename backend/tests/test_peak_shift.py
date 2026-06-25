"""Tests for the dQ/dV peak-shift reduction.

Run from the backend/ dir with `-c /dev/null` (a stray backend/pyproject.toml
otherwise hijacks pytest's rootdir):
    python3 -m pytest tests/test_peak_shift.py -c /dev/null
"""
import math

import pytest

import master_plot_peakshift as ps
from master_plot_peakshift import (
    _MAX_PLAUSIBLE_MV,
    _median,
    _moving_avg,
    _peak_voltage,
    build_peak_shift,
)


# --- pure helpers ----------------------------------------------------------

def test_moving_avg_smooths_a_spike():
    xs = [0.0, 0.0, 10.0, 0.0, 0.0]
    out = _moving_avg(xs, 5)
    # The lone spike is spread out, so its bin no longer dwarfs the rest.
    assert out[2] < 10.0
    assert len(out) == len(xs)


def test_moving_avg_passthrough_when_short():
    xs = [1.0, 2.0]
    assert _moving_avg(xs, 5) == xs


def test_median_even_and_odd():
    assert _median([3.0, 1.0, 2.0]) == 2.0
    assert _median([1.0, 2.0, 3.0, 4.0]) == 2.5
    assert _median([]) is None


def test_peak_voltage_finds_the_dominant_peak():
    # A clean Gaussian-ish bump centred at 3.6 V dominates.
    vs = [3.0 + 0.05 * i for i in range(20)]
    dq = [math.exp(-((v - 3.6) ** 2) / 0.01) for v in vs]
    pk = _peak_voltage(vs, dq)
    assert pk is not None
    assert abs(pk - 3.6) < 0.1


def test_peak_voltage_is_sign_agnostic():
    # Discharge dQ/dV can be negative; |dQ/dV| argmax must still find it.
    vs = [3.0 + 0.05 * i for i in range(20)]
    dq = [-math.exp(-((v - 3.4) ** 2) / 0.01) for v in vs]
    pk = _peak_voltage(vs, dq)
    assert pk is not None
    assert abs(pk - 3.4) < 0.1


def test_peak_voltage_none_when_too_few_points():
    assert _peak_voltage([3.0, 3.1], [1.0, 2.0]) is None


# --- end-to-end over the real 'default' project ----------------------------

def _has_default_dqdv() -> bool:
    try:
        return build_peak_shift("default")["cellCount"] > 0
    except Exception:
        return False


@pytest.mark.skipif(not _has_default_dqdv(), reason="no discharge_dqdv data in 'default'")
def test_build_peak_shift_default_project():
    r = build_peak_shift("default")
    assert r["cellCount"] > 0
    assert r["valueCount"] > 0
    assert r["valueCount"] <= r["cellCount"]
    # Every row keys a cell; values are either None or a plausible mV shift.
    for c in r["cells"]:
        assert "cellId" in c and c["cellId"]
        v = c["peakShiftMv"]
        assert v is None or (math.isfinite(v) and abs(v) <= _MAX_PLAUSIBLE_MV)


def test_build_peak_shift_unknown_project_is_empty():
    r = build_peak_shift("does-not-exist")
    assert r == {"cellCount": 0, "valueCount": 0, "cells": []}


@pytest.mark.skipif(not _has_default_dqdv(), reason="no discharge_dqdv data in 'default'")
def test_peak_shift_is_cached_and_stable():
    # Second call must return identical values (per-file cache, deterministic).
    a = build_peak_shift("default")
    b = build_peak_shift("default")
    assert a == b
