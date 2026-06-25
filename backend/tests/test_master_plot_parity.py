"""Master Plot parity test (Python twin side).

Asserts backend/master_plot_overview.py produces byte-for-numeric-equal output
to the TS reference (frontend/.../parity.golden.test.ts) over a shared fixture.
This is what lets the 50k+ server aggregate path replace the client computation
without changing a single number the user sees.

If this fails, the two implementations have drifted — fix the formula on
whichever side is wrong and regenerate the golden:
    cd frontend && npx vitest run src/features/masterPlot/overview/parity.golden.test.ts
"""

import json
import math
import sys
from pathlib import Path

import pytest

BACKEND = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(BACKEND))

from master_plot_overview import build_overview  # noqa: E402

FIXTURES = BACKEND / "tests" / "fixtures"
TOL = 1e-9


def _load():
    cells = json.loads((FIXTURES / "parity_cells.json").read_text())
    golden_path = FIXTURES / "parity_golden.json"
    if not golden_path.exists():
        pytest.skip(
            "parity_golden.json missing — generate it first with: "
            "cd frontend && npx vitest run "
            "src/features/masterPlot/overview/parity.golden.test.ts"
        )
    return cells, json.loads(golden_path.read_text())


def _assert_num_eq(a, b, where):
    if a is None or b is None:
        assert a is None and b is None, f"{where}: null mismatch {a!r} vs {b!r}"
        return
    if isinstance(a, str) or isinstance(b, str):
        assert a == b, f"{where}: {a!r} != {b!r}"
        return
    assert abs(a - b) <= TOL, f"{where}: {a} != {b} (|d|={abs(a - b)})"


def test_overview_matches_ts_golden():
    cells, golden = _load()
    got = build_overview(cells)

    # --- per-cell scalars ---
    got_cells = {c["cellId"]: c for c in got["cells"]}
    gold_cells = {c["cellId"]: c for c in golden["cells"]}
    assert set(got_cells) == set(gold_cells), "cell id set mismatch"
    for cid, gold in gold_cells.items():
        mine = got_cells[cid]
        assert mine["condKey"] == gold["condKey"], f"{cid}: condKey"
        assert mine["flags"] == gold["flags"], f"{cid}: flags"
        for k in (
            "peakCapacitySpec", "peakCapacityRaw", "medianCE", "retention",
            "fadeRatePctPer100", "ceTrendPctPer100", "cycleLife80",
            "cycleCount", "capacityBasis",
        ):
            _assert_num_eq(mine[k], gold[k], f"cell {cid}.{k}")

    # --- per-condition aggregates, every metric ---
    assert set(got["conditions"]) == set(golden["conditions"]), "condition key set mismatch"
    for key, gold in golden["conditions"].items():
        mine = got["conditions"][key]
        assert mine["n"] == gold["n"], f"{key}: n"
        assert mine["flaggedCount"] == gold["flaggedCount"], f"{key}: flaggedCount"
        _assert_num_eq(mine["spacerMm"], gold["spacerMm"], f"{key}.spacerMm")
        for mid, gstat in gold["metrics"].items():
            mstat = mine["metrics"][mid]
            for field in ("mean", "sd", "cv", "sem", "ciHalf", "n"):
                _assert_num_eq(mstat[field], gstat[field], f"{key}.{mid}.{field}")


def test_fixture_actually_covers_the_paths():
    """Guard against a vacuous pass: the fixture must hit every flag + a
    non-null cycle-life, or 'parity' proves nothing."""
    cells, _ = _load()
    got = build_overview(cells)
    by_id = {c["cellId"]: c for c in got["cells"]}
    assert "cap-outlier" in by_id["A-4"]["flags"]
    assert "ce-anomaly" in by_id["B-2"]["flags"]
    assert "few-cycles" in by_id["C-1"]["flags"]
    # Protocol-scoped metrics are not computed yet, so they are null for every cell.
    assert by_id["D-1"]["cycleLife80"] is None
    assert by_id["C-1"]["retention"] is None
    assert by_id["B-1"]["capacityBasis"] == "mAh"
    assert not math.isnan(by_id["A-1"]["peakCapacityRaw"])
