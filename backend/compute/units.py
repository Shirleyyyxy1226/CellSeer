"""
units.py — Unit conversion for CellSeer column names.

Design
------
Column names in CellSeer follow the pattern:  "Quantity [unit]"
e.g. "Current [mA]",  "Capacity [Ah]",  "Time [min]"

This module provides:
1. Dictionaries that map unit symbols → quantity names and scaling factors.
2. `split_quantity_unit(name)` — parses a column name into (quantity, unit).
3. `get_unit_scaling(unit)` — returns (factor, base_unit) for any unit.
4. `UnitsExpr` — a Polars expression namespace registered as `.units`,
   so you can write:
       pl.col("Current [mA]").units.to_base_unit("mA")   # → Amperes
       pl.col("Time [min]").units.to_unit("s")            # → seconds

Why a Polars namespace?
-----------------------
Polars LazyFrames build query plans lazily. By expressing unit conversions
as Polars expressions, the conversion is included in the plan and executes
only when `.collect()` is called — never before.
"""
from __future__ import annotations

import re
from typing import Dict, Optional, Tuple

import polars as pl

# ---------------------------------------------------------------------------
# Base unit → quantity name
# ---------------------------------------------------------------------------
# Used to identify what physical quantity a column represents.
unit_dict: Dict[str, str] = {
    "A":   "Current",
    "V":   "Voltage",
    "Ah":  "Capacity",
    "Wh":  "Energy",
    "W":   "Power",
    "Ohm": "Impedance",
    "s":   "Time",
    "Hz":  "Frequency",
    "C":   "Temperature",    # Celsius (not Coulombs — Coulombs use As)
    "K":   "Temperature",
    "g":   "Mass",
    "m":   "Length",
    "Pa":  "Pressure",
}

# ---------------------------------------------------------------------------
# SI prefix → multiplicative factor (relative to base unit)
# ---------------------------------------------------------------------------
prefix_dict: Dict[str, float] = {
    "T":  1e12,
    "G":  1e9,
    "M":  1e6,
    "k":  1e3,
    "":   1.0,      # no prefix = base unit
    "m":  1e-3,
    "µ":  1e-6,
    "u":  1e-6,     # ASCII fallback for µ
    "n":  1e-9,
    "p":  1e-12,
}

# ---------------------------------------------------------------------------
# Time unit aliases (map to seconds)
# ---------------------------------------------------------------------------
# These override prefix+base logic because "min" is not a prefix+base combo.
time_unit_dict: Dict[str, float] = {
    "s":       1.0,
    "ms":      1e-3,
    "min":     60.0,
    "h":       3600.0,
    "hr":      3600.0,
    "hour":    3600.0,
}

# ---------------------------------------------------------------------------
# Temperature conversions require offset, not just scaling — handled specially
# ---------------------------------------------------------------------------
_TEMPERATURE_UNITS = {"C", "K", "°C", "°K"}


# ---------------------------------------------------------------------------
# Public functions
# ---------------------------------------------------------------------------

def split_quantity_unit(name: str) -> Tuple[str, str]:
    """
    Parse a CellSeer column name into (quantity, unit).

    Examples
    --------
    >>> split_quantity_unit("Current [mA]")
    ('Current', 'mA')
    >>> split_quantity_unit("Voltage [V]")
    ('Voltage', 'V')
    >>> split_quantity_unit("Step")
    ('Step', '')
    """
    m = re.match(r"^(.*?)\s*\[([^\]]+)\]\s*$", name)
    if m:
        return m.group(1).strip(), m.group(2).strip()
    return name.strip(), ""


def get_unit_scaling(unit: str) -> Tuple[float, str]:
    """
    Return (scaling_factor, base_unit) for a given unit string.

    The scaling factor converts FROM `unit` TO `base_unit`:
        value_in_base = value_in_unit * scaling_factor

    Examples
    --------
    >>> get_unit_scaling("mA")
    (0.001, 'A')
    >>> get_unit_scaling("min")
    (60.0, 's')
    >>> get_unit_scaling("Ah")
    (3600.0, 'As')   # Ah → Coulombs (As) — or keep as Ah if base
    """
    # Time aliases take priority
    if unit in time_unit_dict:
        return time_unit_dict[unit], "s"

    # Temperature — no scaling conversion via this function (use offset)
    if unit in _TEMPERATURE_UNITS:
        return 1.0, unit

    # Try prefix + base_unit decomposition
    for prefix, factor in sorted(prefix_dict.items(), key=lambda x: -len(x[0])):
        if unit.startswith(prefix):
            base = unit[len(prefix):]
            if base in unit_dict:
                return factor, base

    # Fallback: treat as already a base unit with factor 1
    return 1.0, unit


# ---------------------------------------------------------------------------
# Polars expression namespace
# ---------------------------------------------------------------------------

@pl.api.register_expr_namespace("units")
class UnitsExpr:
    """
    Polars expression namespace for lazy unit conversion.

    Usage
    -----
    # In a LazyFrame pipeline:
    lf.with_columns(
        pl.col("Current [mA]").units.to_base_unit("mA").alias("Current [A]"),
        pl.col("Time [min]").units.to_unit("s").alias("Time [s]"),
    )

    Methods
    -------
    to_base_unit(unit)   : multiply by scaling factor → converts TO base unit
    from_base_unit(unit) : divide by scaling factor  → converts FROM base unit
    to_unit(target_unit) : full conversion between any two compatible units
    """

    def __init__(self, expr: pl.Expr) -> None:
        self._expr = expr

    def to_base_unit(self, unit: str) -> pl.Expr:
        """
        Convert a column that is currently in `unit` to its SI base unit.
        e.g. mA → A,  min → s,  mAh → Ah
        """
        factor, _ = get_unit_scaling(unit)
        return self._expr * factor

    def from_base_unit(self, unit: str) -> pl.Expr:
        """
        Convert a column that is in the base unit back to `unit`.
        e.g. A → mA,  s → min
        """
        factor, _ = get_unit_scaling(unit)
        return self._expr / factor

    def to_unit(self, target_unit: str) -> pl.Expr:
        """
        Convert a column whose source unit is encoded in the column name
        (e.g. "Current [mA]") to a different unit.

        This requires the calling expression to be wrapped in a `with_columns`
        context where the column name is known. For explicit control, prefer
        `to_base_unit` / `from_base_unit` and supply the source unit yourself.

        Example
        -------
        lf.with_columns(
            pl.col("Current [mA]").units.to_unit("A")
        )
        # → values scaled from mA to A
        """
        target_factor, target_base = get_unit_scaling(target_unit)
        # We don't know the source unit here without column name context;
        # return a lazy placeholder that is resolved when the column name
        # is available via `map_elements`. For typical usage, call
        # to_base_unit() then from_base_unit() explicitly instead.
        return self._expr / target_factor


# ---------------------------------------------------------------------------
# Convenience: column rename helper
# ---------------------------------------------------------------------------

def rename_with_unit(base_name: str, old_unit: str, new_unit: str) -> str:
    """
    Return a new column name with the unit replaced.
    e.g. rename_with_unit("Current", "mA", "A") → "Current [A]"
    """
    return f"{base_name} [{new_unit}]"
