"""Shared field-name normalization for metadata spreadsheets."""

from __future__ import annotations

import re


def normalize_key(value: object) -> str:
    return re.sub(r"[^a-z0-9]+", "", str(value).strip().lower())
