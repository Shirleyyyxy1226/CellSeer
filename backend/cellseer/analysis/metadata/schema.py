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

from cellseer.analysis.metadata.fields import normalize_key


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

    @property
    def active_mass_g(self) -> Optional[float]:
        """Cathode mass used for specific capacity normalisation."""
        return self.cathode_mass_g

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
            "separator_type": {"separatortype"},
            "separator_diameter_mm": {"separatordiametermm"},
            "electrolyte": {"electrolyte"},
            "electrolyte_volume_ul": {"electrolytevolumeul"},
            "spacer_mm": {"spacermm"},
            "repeat": {"repeat"},
            "do_formation": {"doformation"},
            "do_ratetest": {"doratetest"},
            "do_eis": {"doeis"},
            "anode_mass_g": {"anodemass", "anodeweightmg"},
            "cathode_mass_g": {"cathodemass", "cathodeweightmg"},
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
            val = _find_value(data, by_norm, aliases)
            if val not in (None, ""):
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
