"""Column detection and default key selection for metadata spreadsheets."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

from compute.analysis.metadata.fields import normalize_key

_KEY_HEADER_ALIASES = {
    "cellname",
    "cellid",
    "id",
    "sampleid",
    "barcode",
    "name",
}

_ID_NO_HEADER_ALIASES = {
    "idno",
    "idnumber",
    "cellno",
    "celno",
    "number",
}

_HEADER_HINTS = {
    "id",
    "name",
    "cellname",
    "cellid",
    "idno",
    "cellno",
    "cathode",
    "anode",
    "separatortype",
    "electrolyte",
    "repeat",
    "batch",
}


def candidate_key_headers(headers: List[str]) -> List[str]:
    out: List[str] = []
    seen: set[str] = set()
    for h in headers:
        nh = normalize_key(h)
        if nh in _KEY_HEADER_ALIASES and h not in seen:
            out.append(h)
            seen.add(h)
    return out


def choose_default_primary_key(candidates: List[str], headers: List[str]) -> Optional[str]:
    if not headers:
        return None
    by_norm = {normalize_key(h): h for h in headers if h}
    for preferred in ("cellname", "id", "cellid", "sampleid", "barcode"):
        if preferred in by_norm:
            return by_norm[preferred]
    return candidates[0] if candidates else None


def coerce_int(value: object) -> Optional[int]:
    if value is None:
        return None
    s = str(value).strip()
    if not s:
        return None
    try:
        if re.fullmatch(r"[+-]?\d+", s):
            return int(s)
        f = float(s)
        if f.is_integer():
            return int(f)
    except Exception:
        return None
    return None


def looks_like_id_no_column(norm_header: str) -> bool:
    if norm_header in _ID_NO_HEADER_ALIASES:
        return True
    return ("id" in norm_header) or ("no" in norm_header) or ("number" in norm_header)


def candidate_id_no_headers(headers: List[str], rows: List[Dict[str, Any]]) -> List[str]:
    candidates: List[str] = []
    for h in headers:
        if not h:
            continue
        nh = normalize_key(h)
        if not looks_like_id_no_column(nh):
            continue
        if nh in {"batch", "repeat", "cycle", "step"}:
            continue
        values = []
        for r in rows:
            v = r.get(h)
            if v is None or str(v).strip() == "":
                continue
            values.append(v)
            if len(values) >= 20:
                break
        if not values:
            continue
        parsed = [coerce_int(v) for v in values]
        valid = [x for x in parsed if x is not None]
        if len(valid) / len(values) >= 0.95 and sum(1 for x in valid if x >= 1) / max(len(valid), 1) >= 0.9:
            candidates.append(h)
    return candidates


def choose_default_id_no_header(
    candidates: List[str],
    headers: List[str],
    preferred_id_no: Optional[str] = None,
) -> Optional[str]:
    if preferred_id_no:
        for h in headers:
            if normalize_key(h) == normalize_key(preferred_id_no):
                return h
    if not candidates:
        return None
    by_norm = {normalize_key(h): h for h in candidates}
    for preferred in ("idno", "idnumber", "number", "celno", "cellno"):
        if preferred in by_norm:
            return by_norm[preferred]
    return candidates[0]


def detect_header_row_index(rows: List[tuple], scan_limit: int = 60) -> int:
    best_idx = 0
    best_score = -1
    for i, candidate in enumerate(rows[:scan_limit]):
        labels = [
            normalize_key(v) for v in candidate if v is not None and str(v).strip()
        ]
        if not labels:
            continue
        score = sum(1 for x in labels if x in _HEADER_HINTS) + len(set(labels)) * 0.1
        if score > best_score:
            best_score = score
            best_idx = i
    return best_idx
