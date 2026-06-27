"""Rate-performance endpoint (project-scoped, condition-cohort filterable)."""

from fastapi import APIRouter

from project_scope import normalize_project_id

from ._common import _load_rate_cells

router = APIRouter()


def _spacer_matches(cell_spacer: object, param: str) -> bool:
    """Match a cell's spacer against the filter string by float value, so "1"
    and "1.0" are equivalent (the frontend sends JS ``String(number)``)."""
    try:
        return cell_spacer is not None and abs(float(cell_spacer) - float(param)) < 1e-9
    except (TypeError, ValueError):
        return False


def _cell_in_scope(
    cell: dict,
    cathode: str | None,
    separator: str | None,
    spacer: str | None,
) -> bool:
    # Mirror the frontend's display fallbacks: the overview/summary pipeline
    # surfaces an empty cathode as "Unknown" and an empty separator as "—", and
    # the filter dropdowns are built from those values. The raw rate payload
    # stores "" for both, so match against the same fallbacks or selecting the
    # "Unknown"/"—" cohort would scope to an empty set.
    if cathode and (cell.get("cathode") or "Unknown") != cathode:
        return False
    if separator and (cell.get("separatorType") or "—") != separator:
        return False
    if spacer and not _spacer_matches(cell.get("spacerMm"), spacer):
        return False
    return True


@router.get("/api/rate-performance")
@router.get("/api/rate-performance.json")
def rate_performance(
    projectId: str | None = None,
    cathode: str | None = None,
    separator: str | None = None,
    spacer: str | None = None,
):
    """Rate-performance summary JSON from DB cycling datasets (project-scoped).

    The optional ``cathode`` / ``separator`` / ``spacer`` filters scope the
    response to the condition cohort a cell-level view actually draws,
    so the Master Plot can pull just that cohort's per-cycle arrays instead of
    the whole project's tens of MB. The expensive Parquet build is cached
    project-wide by ``_load_rate_cells``; this only narrows the (already-built)
    in-memory list, so scoping is near-free.
    """
    cells, protocols = _load_rate_cells(normalize_project_id(projectId))
    if cathode or separator or spacer:
        cells = [c for c in cells if _cell_in_scope(c, cathode, separator, spacer)]
        # Re-derive the protocol list from the scoped cohort, preserving order.
        seen: list[str] = []
        for c in cells:
            p = c.get("protocol")
            if isinstance(p, str) and p and p not in seen:
                seen.append(p)
        protocols = seen
    return {"cells": cells, "protocols": protocols}
