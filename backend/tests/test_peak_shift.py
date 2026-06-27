"""Tests for the dQ/dV peak-shift reduction (SHELVED — protocol-gated like CE).

Run from the backend/ dir with `-c /dev/null` (a stray backend/pyproject.toml
otherwise hijacks pytest's rootdir):
    python3 -m pytest tests/test_peak_shift.py -c /dev/null
"""
import pytest

from masterplot.peakshift import build_peak_shift


def _has_default_dqdv() -> bool:
    try:
        return build_peak_shift("default")["cellCount"] > 0
    except Exception:
        return False


@pytest.mark.skipif(not _has_default_dqdv(), reason="no discharge_dqdv data in 'default'")
def test_build_peak_shift_is_shelved_null_at_source():
    # Shelved: protocol-gated like CE. Cells are still listed (so the
    # frontend can show the lock), but peakShiftMv is null at source for every cell
    # because the old C-rate-blind computation was retired.
    r = build_peak_shift("default")
    assert r["cellCount"] > 0
    assert r["valueCount"] == 0
    for c in r["cells"]:
        assert "cellId" in c and c["cellId"]
        assert c["peakShiftMv"] is None


def test_build_peak_shift_unknown_project_is_empty():
    r = build_peak_shift("does-not-exist")
    assert r == {"cellCount": 0, "valueCount": 0, "cells": []}
