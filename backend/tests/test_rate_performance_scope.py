"""Scoped rate-performance payload.

Exercises the optional cathode/separator/spacer filtering on
``routers.cells.rate_performance`` against the synthetic "P5K" project
(5000 cells, 30 condition cohorts) baked into ``backend/cellseer.db``.

Run from the backend dir (note the stray pyproject.toml needs -c /dev/null):
    cd backend && python3 -m pytest tests/test_rate_performance_scope.py -c /dev/null

Cohorts are discovered from the live response at runtime, so the test does
not hard-code cell ids and stays robust if the synthetic data is regenerated.
"""

import sys
from collections import Counter
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from routers.cells import rate_performance  # noqa: E402

PROJECT = "P5K"
EXPECTED_TOTAL = 5000


def _unscoped():
    resp = rate_performance(projectId=PROJECT)
    cells = resp.get("cells", [])
    if not cells:
        pytest.skip(
            f"Project {PROJECT!r} has no rate-performance cells in cellseer.db "
            "— synthetic data absent; skipping scope tests."
        )
    return resp


def _cohort_key(cell: dict) -> tuple:
    return (
        cell.get("cathode") or "",
        cell.get("separatorType") or "",
        cell.get("spacerMm"),
    )


def test_unscoped_returns_all_cells():
    resp = _unscoped()
    assert len(resp["cells"]) == EXPECTED_TOTAL, (
        f"expected {EXPECTED_TOTAL} unscoped cells, got {len(resp['cells'])}"
    )


def test_scope_by_full_cohort_returns_only_that_cohort():
    resp = _unscoped()
    cells = resp["cells"]

    # Discover a real cohort that has >0 members from the live data.
    counts = Counter(_cohort_key(c) for c in cells)
    (cathode, separator, spacer), expected_n = counts.most_common(1)[0]
    assert expected_n > 0

    scoped = rate_performance(
        projectId=PROJECT,
        cathode=cathode,
        separator=separator,
        spacer=str(spacer),
    )
    scoped_cells = scoped["cells"]

    assert 0 < len(scoped_cells) < len(cells)
    assert len(scoped_cells) == expected_n
    for c in scoped_cells:
        assert (c.get("cathode") or "") == cathode
        assert (c.get("separatorType") or "") == separator
        assert c.get("spacerMm") == spacer


def test_cathode_only_scope_is_strict_subset():
    resp = _unscoped()
    cells = resp["cells"]
    cathode = Counter(c.get("cathode") or "" for c in cells).most_common(1)[0][0]

    scoped = rate_performance(projectId=PROJECT, cathode=cathode)
    scoped_cells = scoped["cells"]

    assert 0 < len(scoped_cells) < len(cells)
    assert all((c.get("cathode") or "") == cathode for c in scoped_cells)


def test_spacer_matches_by_float_value():
    """An integer-valued spacer (e.g. 1.0) must match the filter string "1"
    — the frontend sends JS ``String(number)`` which drops the ``.0``."""
    resp = _unscoped()
    cells = resp["cells"]

    # Find a cohort whose spacer is integer-valued.
    int_spacer = None
    for c in cells:
        s = c.get("spacerMm")
        if s is not None and float(s) == int(float(s)):
            int_spacer = float(s)
            break
    if int_spacer is None:
        pytest.skip("no integer-valued spacer cohort in P5K — cannot test '1'=='1.0'")

    spacer_str = str(int(int_spacer))  # e.g. "1", not "1.0"
    scoped = rate_performance(projectId=PROJECT, spacer=spacer_str)
    scoped_cells = scoped["cells"]

    expected = sum(
        1
        for c in cells
        if c.get("spacerMm") is not None and abs(float(c["spacerMm"]) - int_spacer) < 1e-9
    )
    assert len(scoped_cells) == expected
    assert len(scoped_cells) > 0
    for c in scoped_cells:
        assert abs(float(c["spacerMm"]) - int_spacer) < 1e-9


def test_scoped_protocols_are_subset_of_unscoped():
    resp = _unscoped()
    cells = resp["cells"]
    full_protocols = set(resp.get("protocols", []))

    cathode = Counter(c.get("cathode") or "" for c in cells).most_common(1)[0][0]
    scoped = rate_performance(projectId=PROJECT, cathode=cathode)
    scoped_protocols = set(scoped.get("protocols", []))

    assert scoped_protocols <= full_protocols
    # Every scoped protocol is actually present on a scoped cell.
    on_cells = {
        c["protocol"]
        for c in scoped["cells"]
        if isinstance(c.get("protocol"), str) and c.get("protocol")
    }
    assert scoped_protocols == on_cells
