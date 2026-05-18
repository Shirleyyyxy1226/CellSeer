"""
filters/ — Hierarchical navigation layer for CyclingData.

Hierarchy
---------
CyclingData
  └── .cycle(*cycle_numbers)              → Cycle
        └── .charge() / .discharge() / .rest()  → Step

For C-rate annotation use Protocol (not a filter):
  >>> from cellseer import Protocol
  >>> p = Protocol({"C/10": (1, 3), "C/2": (4, 10)})
  >>> cycling.with_protocol(p)          # adds "C-rate" column
  >>> cycling.cycle(*p["C/10"]).discharge()
"""
from cellseer.filters.cycle import Cycle
from cellseer.filters.step import Step

__all__ = ["Cycle", "Step"]
