"""Cell mutation endpoints: metadata PATCH, protocol attach (single + bulk), and delete."""

import json
from typing import Any, List, Optional

from fastapi import APIRouter, HTTPException
from pydantic import BaseModel, ConfigDict

from db import get_db
from project_scope import normalize_project_id

from ._common import _get_cell_record_index, invalidate_rate_cache

router = APIRouter()


class CellMetadataPatch(BaseModel):
    """Allowlisted editable fields. Anything not listed here is ignored.

    `cell_id`, `id_no`, `project_id`, `source_*`, `last_seen_at` and
    `deleted_at` are deliberately omitted: the first two are primary / link
    keys and would invalidate cycling-data joins; the rest are audit columns
    populated by the ingest pipeline.
    """
    model_config = ConfigDict(extra="ignore")

    batch: Optional[int] = None
    category: Optional[str] = None
    repeat: Optional[int] = None
    cathode: Optional[str] = None
    cathodeDiameterMm: Optional[float] = None
    cathodeMassG: Optional[float] = None
    anode: Optional[str] = None
    anodeDiameterMm: Optional[float] = None
    anodeMassG: Optional[float] = None
    npRatio: Optional[float] = None
    separatorType: Optional[str] = None
    separatorDiameterMm: Optional[float] = None
    electrolyte: Optional[str] = None
    electrolyteVolumeUl: Optional[float] = None
    spacerMm: Optional[float] = None
    doFormation: Optional[str] = None
    doRateTest: Optional[str] = None
    doEis: Optional[str] = None
    capacityBasis: Optional[str] = None
    notes: Optional[str] = None


# Map JSON camelCase → DB snake_case so the SQL writer only knows safe column
# names (defence against accidental column-name injection from API surface).
_PATCH_FIELD_TO_COLUMN: dict[str, str] = {
    "batch": "batch",
    "category": "category",
    "repeat": "repeat",
    "cathode": "cathode",
    "cathodeDiameterMm": "cathode_diameter_mm",
    "cathodeMassG": "cathode_mass",
    "anode": "anode",
    "anodeDiameterMm": "anode_diameter_mm",
    "anodeMassG": "anode_mass",
    "npRatio": "np_ratio",
    "separatorType": "separator_type",
    "separatorDiameterMm": "separator_diameter_mm",
    "electrolyte": "electrolyte",
    "electrolyteVolumeUl": "electrolyte_volume_ul",
    "spacerMm": "spacer_mm",
    "doFormation": "do_formation",
    "doRateTest": "do_ratetest",
    "doEis": "do_eis",
    "capacityBasis": "capacity_basis",
    "notes": "notes",
}


def _normalize_patch_value(field: str, value):
    """Coerce empty strings to NULL so clearing a field actually clears it,
    and normalise whitespace on free-text columns."""
    if value is None:
        return None
    if isinstance(value, str):
        s = value.strip()
        if s == "":
            return None
        return s
    return value


@router.patch("/api/cells/{cell_id:path}")
def update_cell_metadata(cell_id: str, patch: CellMetadataPatch, projectId: str | None = None):
    """Update editable metadata fields on one cell.

    Only fields present in ``CellMetadataPatch`` (and serialised in the
    request body) are touched. Sending a JSON ``null`` clears that column.
    Fields the client omits from the body remain unchanged.
    """
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    project_id = normalize_project_id(projectId)

    # Use Pydantic's field_set semantics so the client controls what gets
    # touched. `model_dump(exclude_unset=True)` returns *only* the keys the
    # caller actually sent in the payload.
    incoming = patch.model_dump(exclude_unset=True)
    if not incoming:
        raise HTTPException(status_code=400, detail="No editable fields provided")

    set_clauses: list[str] = []
    params: list[object] = []
    applied: dict[str, object] = {}
    for field, raw_value in incoming.items():
        column = _PATCH_FIELD_TO_COLUMN.get(field)
        if column is None:
            continue
        normalised = _normalize_patch_value(field, raw_value)
        set_clauses.append(f"{column} = ?")
        params.append(normalised)
        applied[field] = normalised

    if not set_clauses:
        raise HTTPException(status_code=400, detail="No editable fields recognised")

    params.extend([project_id, cell_id])
    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=404,
                detail=f"Cell '{cell_id}' not found in project '{project_id}'",
            )
        conn.execute(
            f"UPDATE cell SET {', '.join(set_clauses)} WHERE project_id = ? AND cell_id = ?",
            params,
        )
        conn.commit()
    # Metadata edits (e.g. cathode mass) change derived rate-performance values.
    invalidate_rate_cache(project_id)

    # Echo the freshly-persisted cell back so the client can refresh without
    # a second round-trip to /api/cell-record-index.
    refreshed = _get_cell_record_index(project_id).get("cells", [])
    for c in refreshed:
        if str(c.get("cellId") or "") == cell_id:
            return {"cell": c, "updated": list(applied.keys())}
    return {"cell": None, "updated": list(applied.keys())}


class CellProtocolSegmentIn(BaseModel):
    """Wire-format segment.

    ``cycleEnd: None`` means "to end of test"; the wizard uses this to
    represent open-ended trailing segments. ``cRate`` is a positive C-rate
    in 1/hour (e.g. 0.1 = C/10, 1.0 = 1C).
    """

    name: Optional[str] = None
    cycleStart: int
    cycleEnd: Optional[int] = None
    cRate: float


class CellProtocolUpdate(BaseModel):
    """``protocolName`` is optional; if omitted we synthesise it from the
    segments so the rate-performance label stays in sync."""

    protocolName: Optional[str] = None
    segments: List[CellProtocolSegmentIn]


def _normalise_protocol_segments(segments: List[CellProtocolSegmentIn]) -> list[dict]:
    if not segments:
        raise HTTPException(status_code=400, detail="At least one segment is required")
    cleaned: list[dict] = []
    for idx, seg in enumerate(segments):
        if seg.cycleStart < 1:
            raise HTTPException(
                status_code=400,
                detail=f"Segment {idx + 1}: cycleStart must be >= 1",
            )
        if seg.cycleEnd is not None and seg.cycleEnd < seg.cycleStart:
            raise HTTPException(
                status_code=400,
                detail=f"Segment {idx + 1}: cycleEnd must be >= cycleStart",
            )
        if not (seg.cRate > 0):
            raise HTTPException(
                status_code=400,
                detail=f"Segment {idx + 1}: cRate must be > 0",
            )
        entry: dict = {
            "cycleStart": int(seg.cycleStart),
            "cycleEnd": int(seg.cycleEnd) if seg.cycleEnd is not None else None,
            "cRate": float(seg.cRate),
        }
        if seg.name and seg.name.strip():
            entry["name"] = seg.name.strip()[:80]
        cleaned.append(entry)
    cleaned.sort(key=lambda e: e["cycleStart"])
    return cleaned


def _synth_protocol_name(segments: list[dict]) -> str:
    """Compact one-line label like "FORM-3 | 1C" from segment names + rates.

    Uses the user-supplied ``name`` when present, otherwise just the C-rate.
    """
    tokens: list[str] = []
    for seg in segments:
        name = (seg.get("name") or "").strip()
        rate = float(seg["cRate"])
        rate_label = f"{rate:g}C"
        if name:
            tokens.append(f"{name.upper()}-{rate_label}")
        else:
            tokens.append(rate_label)
    # Preserve order but dedupe consecutive identical tokens.
    seen: list[str] = []
    for t in tokens:
        if not seen or seen[-1] != t:
            seen.append(t)
    return " | ".join(seen)


def _write_cell_protocol(
    conn: Any,
    project_id: str,
    cell_id: str,
    segments_json: str,
    protocol_name: str,
) -> None:
    """Write protocol to ``cell.protocol_segments`` AND mirror it into the
    ``dataset.meta`` JSON of the cell's cycling row (if one exists).

    Mirroring lets older code paths that only consult ``dataset.meta`` keep
    working without further changes. The cell-level columns are the source
    of truth — they let us attach a protocol even *before* cycling data has
    arrived.
    """
    conn.execute(
        """
        UPDATE cell
        SET protocol_segments = ?,
            protocol_name = ?,
            protocol_updated_at = datetime('now')
        WHERE project_id = ? AND cell_id = ?
        """,
        (segments_json, protocol_name, project_id, cell_id),
    )

    # Mirror into dataset.meta.protocol on the cycling row, if one exists.
    cycling = conn.execute(
        """
        SELECT id, meta FROM dataset
        WHERE project_id = ? AND cell_id = ? AND name = 'cycling'
          AND deleted_at IS NULL
        """,
        (project_id, cell_id),
    ).fetchone()
    if cycling is None:
        return
    meta: dict
    if cycling["meta"]:
        try:
            parsed = json.loads(cycling["meta"])
            meta = parsed if isinstance(parsed, dict) else {}
        except Exception:
            meta = {}
    else:
        meta = {}
    try:
        meta["protocol"] = json.loads(segments_json)
    except Exception:
        meta["protocol"] = []
    conn.execute(
        "UPDATE dataset SET meta = ? WHERE id = ?",
        (json.dumps(meta), cycling["id"]),
    )


@router.put("/api/cells/{cell_id:path}/protocol")
def set_cell_protocol(
    cell_id: str,
    body: CellProtocolUpdate,
    projectId: str | None = None,
):
    """Attach a cycling protocol to one cell.

    The protocol is written to both ``cell.protocol_segments`` (so chips can
    show it even before cycling lands) and mirrored into ``dataset.meta``
    on the cycling row, when present, so rate-performance plotting picks it
    up immediately on the next reload.
    """
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    project_id = normalize_project_id(projectId)
    cleaned = _normalise_protocol_segments(body.segments)
    protocol_name = (body.protocolName or "").strip() or _synth_protocol_name(cleaned)
    segments_json = json.dumps(cleaned)

    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=404,
                detail=f"Cell '{cell_id}' not found in project '{project_id}'",
            )
        _write_cell_protocol(conn, project_id, cell_id, segments_json, protocol_name)
        conn.commit()
    invalidate_rate_cache(project_id)

    refreshed = _get_cell_record_index(project_id).get("cells", [])
    for c in refreshed:
        if str(c.get("cellId") or "") == cell_id:
            return {"cell": c, "protocolName": protocol_name}
    return {"cell": None, "protocolName": protocol_name}


class BulkCellProtocolUpdate(BaseModel):
    """Apply the same protocol to many cells in one transaction."""

    cellIds: List[str]
    protocolName: Optional[str] = None
    segments: List[CellProtocolSegmentIn]


@router.post("/api/cells/protocol/bulk")
def set_cell_protocol_bulk(body: BulkCellProtocolUpdate, projectId: str | None = None):
    """Bulk-apply one protocol to a list of cells.

    Cells that don't exist in the project are silently skipped — the
    response lists which IDs were written and which were missing so the
    wizard can show an inline "x of y attached" summary.
    """
    project_id = normalize_project_id(projectId)
    cell_ids = [str(cid).strip() for cid in body.cellIds if str(cid).strip()]
    if not cell_ids:
        raise HTTPException(status_code=400, detail="cellIds is required and must be non-empty")
    cleaned = _normalise_protocol_segments(body.segments)
    protocol_name = (body.protocolName or "").strip() or _synth_protocol_name(cleaned)
    segments_json = json.dumps(cleaned)

    applied: list[str] = []
    missing: list[str] = []
    with get_db() as conn:
        # Fetch known cells in one shot rather than N round-trips.
        placeholders = ",".join("?" for _ in cell_ids)
        known_rows = conn.execute(
            f"""
            SELECT cell_id FROM cell
            WHERE project_id = ? AND deleted_at IS NULL
              AND cell_id IN ({placeholders})
            """,
            [project_id, *cell_ids],
        ).fetchall()
        known: set[str] = {r["cell_id"] for r in known_rows}
        for cid in cell_ids:
            if cid not in known:
                missing.append(cid)
                continue
            _write_cell_protocol(conn, project_id, cid, segments_json, protocol_name)
            applied.append(cid)
        conn.commit()
    invalidate_rate_cache(project_id)
    return {
        "applied": applied,
        "missing": missing,
        "protocolName": protocol_name,
        "segments": cleaned,
    }


# ---------------------------------------------------------------------------
# DELETE /api/cells/{cell_id} — soft-delete one cell
# ---------------------------------------------------------------------------


@router.delete("/api/cells/{cell_id:path}")
def delete_cell(cell_id: str, projectId: str | None = None):
    """Soft-delete one cell and its datasets.

    Sets ``deleted_at`` on the ``cell`` row and its ``dataset`` rows so every
    read path (index, rate-performance, differential, master-plot) drops it —
    matching the ``deleted_at IS NULL`` filter those queries already use. The
    Parquet files in the data lake are left in place; this is reversible at the
    DB level.
    """
    if not cell_id:
        raise HTTPException(status_code=400, detail="cell_id is required")
    project_id = normalize_project_id(projectId)
    with get_db() as conn:
        existing = conn.execute(
            "SELECT 1 FROM cell WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
        ).fetchone()
        if existing is None:
            raise HTTPException(
                status_code=404,
                detail=f"Cell '{cell_id}' not found in project '{project_id}'",
            )
        conn.execute(
            "UPDATE cell SET deleted_at = datetime('now') "
            "WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
        )
        conn.execute(
            "UPDATE dataset SET deleted_at = datetime('now') "
            "WHERE project_id = ? AND cell_id = ? AND deleted_at IS NULL",
            (project_id, cell_id),
        )
        conn.commit()
    # The cell left the project's rate-performance set; drop its cached payload.
    invalidate_rate_cache(project_id)
    return {"ok": True, "cellId": cell_id}
