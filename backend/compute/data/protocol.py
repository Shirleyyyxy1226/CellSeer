"""
data/protocol.py — Protocol: a description of a full cycling test schedule.

A Protocol maps cycle ranges to C-rate labels.  The primary input format
mirrors the JSON produced by the frontend (numeric cRate is auto-converted
to a label):

    Protocol([
        {"cycleStart": 1,  "cycleEnd": 2,  "cRate": 0.05},   # → "C/20"
        {"cycleStart": 3,  "cycleEnd": 6,  "cRate": 0.1},    # → "C/10"
        {"cycleStart": 7,  "cycleEnd": 10, "cRate": 0.2},    # → "C/5"
        {"cycleStart": 11, "cycleEnd": 14, "cRate": 0.5},    # → "C/2"
        {"cycleStart": 15, "cycleEnd": 18, "cRate": 1.0},    # → "1C"
    ])

String labels are also accepted directly:

    Protocol([
        {"cycleStart": 1, "cycleEnd": 3,  "cRate": "C/10"},
        {"cycleStart": 4, "cycleEnd": 10, "cRate": "C/2"},
    ])

Legacy tuple-dict format still works for backward compatibility:

    Protocol({(1, 3): "C/10", (4, 10): "C/2"})
"""
from __future__ import annotations

from typing import Dict, List, Tuple, Union


class Protocol:
    """
    Describes the C-rate schedule for a full cycling test.

    Parameters
    ----------
    segments : list of dicts  or  dict with tuple keys
        List form: each dict must have cycleStart, cycleEnd, cRate.
        cRate may be a float (0.1 → "C/10") or a string label ("C/10").

    Example
    -------
    >>> p = Protocol([
    ...     {"cycleStart": 1,  "cycleEnd": 2,  "cRate": 0.05},
    ...     {"cycleStart": 3,  "cycleEnd": 6,  "cRate": 0.1},
    ...     {"cycleStart": 7,  "cycleEnd": 10, "cRate": 0.2},
    ...     {"cycleStart": 11, "cycleEnd": 14, "cRate": 0.5},
    ...     {"cycleStart": 15, "cycleEnd": 18, "cRate": 1.0},
    ... ])
    >>> p.rate(5)            # → "C/10"
    >>> p.cycles("C/10")    # → [3, 4, 5, 6]
    >>> p.c_rates            # → ["C/20", "C/10", "C/5", "C/2", "1C"]
    >>> cycling.annotate(p) # stamps "C-rate" string column onto every row
    """

    def __init__(
        self,
        segments: Union[
            List[Dict],
            Dict[Tuple[int, int], Union[str, float]],
        ],
    ) -> None:
        self._segments: List[Dict] = []
        self._cycle_map: Dict[int, str] = {}
        self._rate_map: Dict[str, Tuple[int, int]] = {}

        if isinstance(segments, list):
            self._init_from_segments(segments)
        elif isinstance(segments, dict):
            self._init_from_legacy(segments)
        else:
            raise TypeError(f"Expected list or dict, got {type(segments)}")

    # ------------------------------------------------------------------
    # Initialisation helpers
    # ------------------------------------------------------------------

    def _init_from_segments(self, segments: List[Dict]) -> None:
        for seg in segments:
            start = int(seg["cycleStart"])
            end   = int(seg["cycleEnd"])
            label = _to_label(seg["cRate"])
            self._segments.append({"cycleStart": start, "cycleEnd": end, "cRate": label})
            self._rate_map[label] = (start, end)
            for cycle in range(start, end + 1):
                self._cycle_map[cycle] = label

    def _init_from_legacy(self, schedule: Dict) -> None:
        for (start, end), c_rate in schedule.items():
            label = _to_label(c_rate)
            self._segments.append({"cycleStart": start, "cycleEnd": end, "cRate": label})
            self._rate_map[label] = (start, end)
            for cycle in range(start, end + 1):
                self._cycle_map[cycle] = label

    # ------------------------------------------------------------------
    # Access
    # ------------------------------------------------------------------

    def rate(self, cycle: int) -> str:
        """Return the C-rate label for a given cycle number."""
        if cycle not in self._cycle_map:
            raise KeyError(f"Cycle {cycle} not covered by this protocol.")
        return self._cycle_map[cycle]

    def cycles(self, c_rate: str) -> List[int]:
        """Return the list of cycle numbers for a given C-rate label."""
        if c_rate not in self._rate_map:
            raise KeyError(f"{c_rate!r} not in protocol. Available: {self.c_rates}")
        start, end = self._rate_map[c_rate]
        return list(range(start, end + 1))

    @property
    def c_rates(self) -> List[str]:
        """All C-rate labels in definition order."""
        return list(self._rate_map.keys())

    @property
    def cycle_map(self) -> Dict[int, str]:
        """Full cycle → C-rate label mapping."""
        return dict(self._cycle_map)

    @property
    def segments(self) -> List[Dict]:
        """Segment list with string labels (matches storage / JSON format)."""
        return list(self._segments)

    def items(self):
        """Iterate over (c_rate_label, cycle_list) pairs."""
        for c_rate in self._rate_map:
            yield c_rate, self.cycles(c_rate)

    def to_list(self) -> List[Dict]:
        """Serialise to a list of segment dicts (string cRate labels)."""
        return list(self._segments)

    @classmethod
    def from_dict_list(cls, data: List[Dict]) -> "Protocol":
        """Reconstruct a Protocol from a serialised segment list."""
        return cls(data)

    def __repr__(self) -> str:
        parts = ", ".join(
            f"cycles {s['cycleStart']}–{s['cycleEnd']}: {s['cRate']!r}"
            for s in self._segments
        )
        return f"Protocol([{parts}])"


# ---------------------------------------------------------------------------
# Private helpers
# ---------------------------------------------------------------------------

def _to_label(value: Union[str, float, int]) -> str:
    """Normalise a C-rate value to a string label.

    Floats  : 0.05 → "C/20", 0.1 → "C/10", 0.5 → "C/2", 1.0 → "1C", 2.0 → "2C"
    Strings : passed through unchanged ("C/10", "1C", "C/2")
    """
    if isinstance(value, str):
        return value.strip()
    rate = float(value)
    if rate >= 1.0:
        n = int(rate) if rate == int(rate) else rate
        return f"{n}C"
    divisor = round(1.0 / rate)
    return f"C/{divisor}"
