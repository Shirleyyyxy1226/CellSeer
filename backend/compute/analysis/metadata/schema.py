"""
CellMetadata — strongly-typed Pydantic model for cell-level metadata.

Covers coin-cell assembly fields used in the existing project plus
common fields from any chemistry. All fields are optional except cell_id,
so partial metadata is always valid.
"""
from __future__ import annotations

import re
from pathlib import Path
from typing import Any, Dict, Optional

from pydantic import BaseModel, Field

from compute.analysis.metadata.fields import normalize_key

# Bare metals used as half-cell counter electrodes (Li-ion plus Na / K / Mg /
# Ca / Zn / Al chemistries). Matched as the whole value or "<metal> metal" /
# "<metal> foil" — never as a substring, so a metal-bearing compound like
# LiCoO2 or Na3V2(PO4)3 is not mistaken for a metal counter.
_METAL_COUNTER_NAMES = frozenset({
    "li", "lithium", "na", "sodium", "k", "potassium",
    "mg", "magnesium", "ca", "calcium", "zn", "zinc",
    "al", "aluminium", "aluminum",
})


class CellMetadata(BaseModel):
    """
    Schema-validated metadata for a single physical cell.

    Mandatory
    ---------
    cell_id : str
        Human-readable unique identifier, e.g. "B01_NMC811_Gr_R03".

    Chemistry / materials
    ---------------------
    cathode, anode, electrolyte : str | None
    chemistry : str | None
        Short label, e.g. "NMC811/Gr", "LFP/Gr", "NCA/Si-C".

    Geometry / mass
    ---------------
    cathode_diameter_mm, anode_diameter_mm : float | None
    cathode_mass_g, anode_mass_g : float | None  (always in grams)
    separator_type : str | None
    separator_diameter_mm : float | None
    electrolyte_volume_ul : float | None
    spacer_mm : float | None
    np_ratio : float | None

    Batch bookkeeping
    -----------------
    id_no : int | None      numeric key that matches Neware filename prefix
    batch : int | None
    category : str | None
    repeat : int | None

    Protocol flags
    --------------
    do_formation, do_ratetest, do_eis : str | None

    Free-form
    ---------
    notes : str | None
    custom : dict          catch-all for project-specific fields
    """

    cell_id: str
    id_no: Optional[int] = None

    # Chemistry
    chemistry: Optional[str] = None
    cathode: Optional[str] = None
    anode: Optional[str] = None
    electrolyte: Optional[str] = None

    # Geometry / mass (always SI: mm, g, µL)
    cathode_diameter_mm: Optional[float] = None
    anode_diameter_mm: Optional[float] = None
    cathode_mass_g: Optional[float] = None
    anode_mass_g: Optional[float] = None
    separator_type: Optional[str] = None
    separator_diameter_mm: Optional[float] = None
    electrolyte_volume_ul: Optional[float] = None
    spacer_mm: Optional[float] = None
    np_ratio: Optional[float] = None

    # Which electrode's active mass normalises specific capacity: "cathode" or
    # "anode". None = infer (a metal counter electrode means the other side is
    # the working electrode).
    capacity_basis: Optional[str] = None

    # Batch bookkeeping
    batch: Optional[int] = None
    category: Optional[str] = None
    repeat: Optional[int] = None

    # Protocol flags
    do_formation: Optional[str] = None
    do_ratetest: Optional[str] = None
    do_eis: Optional[str] = None

    # Free-form
    notes: Optional[str] = None
    custom: Dict[str, Any] = Field(default_factory=dict)

    model_config = {"extra": "ignore"}

    @staticmethod
    def _is_metal_counter(name: Optional[str]) -> bool:
        """True when an electrode name denotes a bare metal counter electrode
        (e.g. "Li", "Na metal", "Sodium foil") — not a metal-bearing compound
        like LiCoO2 or Na3V2(PO4)3."""
        if not name:
            return False
        n = re.sub(r"[\s\-_]+", " ", str(name).strip().lower())
        if n in _METAL_COUNTER_NAMES:
            return True
        m = re.match(r"^(\w+) (?:metal|foil)$", n)
        return bool(m and m.group(1) in _METAL_COUNTER_NAMES)

    @property
    def active_mass_basis(self) -> str:
        """Which electrode's active mass normalises specific capacity — the
        explicit capacity_basis if set, else inferred: a bare metal counter
        electrode (Li / Na / K / …) means the *other* electrode is the working
        one; two real electrodes default to cathode."""
        if self.capacity_basis in ("cathode", "anode"):
            return self.capacity_basis  # type: ignore[return-value]
        if self._is_metal_counter(self.anode):
            return "cathode"
        if self._is_metal_counter(self.cathode):
            return "anode"
        return "cathode"

    @property
    def active_mass_g(self) -> Optional[float]:
        """Active-material mass used for specific capacity normalisation —
        the working electrode's mass (cathode for full / cathode-half cells,
        anode for anode-half cells)."""
        return self.anode_mass_g if self.active_mass_basis == "anode" else self.cathode_mass_g

    @classmethod
    def from_dict(
        cls,
        data: Dict[str, Any],
        primary_key_header: Optional[str] = None,
        id_no_header: Optional[str] = None,
        display_name_template: str = "{cathode}_{anode}_R{repeat}_ID{id_no}",
    ) -> "CellMetadata":
        """Build from a flat dict (e.g. a row from the metadata Excel)."""
        field_aliases: Dict[str, set[str]] = {
            "cell_id": {"cell_id", "cellid", "id", "sampleid", "barcode", "cellname"},
            "id_no": {"idno", "idnumber", "cellno", "number"},
            "batch": {"batch"},
            "category": {"category"},
            "cathode": {"cathode"},
            "cathode_diameter_mm": {"cathodediametermm"},
            "anode": {"anode"},
            "anode_diameter_mm": {"anodediametermm"},
            "np_ratio": {"npratio"},
            "separator_type": {"separatortype", "separator"},
            "separator_diameter_mm": {"separatordiametermm"},
            "electrolyte": {"electrolyte"},
            # "electrolytevolumel": "(μL)" headers lose the µ under normalize_key.
            "electrolyte_volume_ul": {"electrolytevolumeul", "electrolytevolumel"},
            "spacer_mm": {"spacermm"},
            "repeat": {"repeat"},
            "do_formation": {"doformation"},
            "do_ratetest": {"doratetest"},
            "do_eis": {"doeis"},
            "anode_mass_g": {"anodemass", "anodeweightmg", "anodemassmg", "anodemassg"},
            "cathode_mass_g": {"cathodemass", "cathodeweightmg", "cathodemassmg", "cathodemassg"},
            "notes": {"notes"},
        }

        by_norm = {normalize_key(k): k for k in data.keys()}
        normalised: Dict[str, Any] = {}

        if primary_key_header:
            selected = _find_value(data, by_norm, {normalize_key(primary_key_header)})
            if selected not in (None, ""):
                normalised["cell_id"] = selected
        if id_no_header:
            selected_id_no = _find_value(data, by_norm, {normalize_key(id_no_header)})
            if selected_id_no not in (None, ""):
                normalised["id_no"] = selected_id_no

        for dst, aliases in field_aliases.items():
            if dst == "cell_id" and "cell_id" in normalised:
                continue
            if dst == "id_no" and id_no_header:
                continue
            # sorted() so a column matching multiple aliases resolves the same
            # way every run (sets have no stable iteration order).
            matched = next((by_norm[a] for a in sorted(aliases) if a in by_norm), None)
            val = data.get(matched) if matched is not None else None
            if val not in (None, ""):
                if dst in ("cathode_mass_g", "anode_mass_g"):
                    val = _mass_to_grams(val, matched)
                normalised[dst] = val

        display_name = _build_display_name(normalised, display_name_template)
        if display_name:
            normalised.setdefault("custom", {})["display_name"] = display_name

        consumed = {by_norm[a] for aliases in field_aliases.values() for a in aliases if a in by_norm}
        if primary_key_header:
            key_norm = normalize_key(primary_key_header)
            if key_norm in by_norm:
                consumed.add(by_norm[key_norm])
        extra = {k: v for k, v in data.items() if k not in consumed}
        if extra:
            normalised.setdefault("custom", {}).update(extra)
        return cls(**normalised)

    @classmethod
    def from_yaml(cls, path: Path | str) -> "CellMetadata":
        """Load from a YAML file. The file must contain a flat mapping."""
        import yaml

        with open(path, encoding="utf-8") as fh:
            data = yaml.safe_load(fh)
        return cls.from_dict(data or {})

    @classmethod
    def from_excel_row(cls, row: Dict[str, Any]) -> "CellMetadata":
        """Convenience alias for from_dict."""
        return cls.from_dict(row)


def _find_value(data: Dict[str, Any], by_norm: Dict[str, str], aliases: set[str]) -> Any:
    for alias in aliases:
        if alias in by_norm:
            return data.get(by_norm[alias])
    return None


def _mass_to_grams(value: Any, header: Optional[str]) -> Any:
    """Convert a metadata mass to grams based on the unit in its source header.

    Masses are stored in grams (``cathode_mass_g`` / ``anode_mass_g``), but
    source spreadsheets usually give milligrams ("Cathode weight (mg)"). We key
    off the unit named in the header: ``mg``/``µg`` are scaled down; ``g`` or an
    unspecified unit is assumed to already be grams. A non-numeric value is
    returned unchanged. Note: a bare header like "cathode mass" with no unit is
    treated as grams — if such a column is actually in mg, rename it to include
    "(mg)" so it converts correctly.
    """
    try:
        v = float(value)
    except (TypeError, ValueError):
        return value
    h = str(header or "").lower()
    if "mg" in h or "milligram" in h:
        return v / 1_000.0
    if "µg" in h or "ug" in h or "microgram" in h:
        return v / 1_000_000.0
    return v


def _build_display_name(normalised: Dict[str, Any], template: str) -> str:
    safe = {
        "cathode": normalised.get("cathode", ""),
        "anode": normalised.get("anode", ""),
        "repeat": normalised.get("repeat", ""),
        "id_no": normalised.get("id_no", ""),
        "batch": normalised.get("batch", ""),
        "category": normalised.get("category", ""),
        "cell_id": normalised.get("cell_id", ""),
    }
    candidate = template.format_map({k: ("" if v is None else str(v)) for k, v in safe.items()})
    candidate = re.sub(r"[_-]{2,}", "_", candidate).strip("_- ")
    if candidate and len([p for p in (safe["cathode"], safe["anode"], safe["id_no"], safe["repeat"]) if p not in ("", None)]) >= 2:
        return candidate
    return str(safe["cell_id"]).strip()
