"""
filters/ — Shared cycling slice helpers.

Use :class:`cellseer.data.cycling_data.CyclingData` for hierarchy navigation
(``.cycle()``, ``.charge()``, ``.discharge()``, ``.rest()``).

For C-rate annotation use :class:`cellseer.data.protocol.Protocol`:

>>> from cellseer import Protocol
>>> p = Protocol({"C/10": (1, 3), "C/2": (4, 10)})
>>> cycling.with_protocol(p)
>>> cycling.cycle(*p["C/10"]).discharge()
"""
from cellseer.filters.base import add_cycle_column

__all__ = ["add_cycle_column"]
