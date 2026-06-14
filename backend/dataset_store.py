"""Filesystem-backed dataset storage utilities."""

from __future__ import annotations

import hashlib
import re
from pathlib import Path

import polars as pl

from config import DATA_LAKE_DIR


def _safe_segment(value: str) -> str:
    cleaned = re.sub(r"[^A-Za-z0-9._-]+", "_", (value or "").strip())
    return cleaned or "unknown"


def dataset_relpath(project_id: str, cell_id: str, dataset_name: str) -> str:
    project_seg = _safe_segment(project_id)
    cell_seg = _safe_segment(cell_id)
    dataset_seg = _safe_segment(dataset_name)
    return f"{project_seg}/{cell_seg}/{dataset_seg}.parquet"


def resolve_dataset_path(storage_uri: str) -> Path:
    path = Path(storage_uri)
    if path.is_absolute():
        return path
    return DATA_LAKE_DIR / path


def write_dataset_parquet(
    dataset_obj,
    project_id: str,
    cell_id: str,
    dataset_name: str,
) -> dict:
    relpath = dataset_relpath(project_id, cell_id, dataset_name)
    target = resolve_dataset_path(relpath)
    target.parent.mkdir(parents=True, exist_ok=True)
    tmp = target.with_suffix(".tmp")
    collected = dataset_obj.collect()
    collected.write_parquet(tmp, compression="lz4")
    payload = tmp.read_bytes()
    checksum = hashlib.sha256(payload).hexdigest()
    tmp.replace(target)
    return {
        "storage_kind": "local",
        "storage_uri": relpath,
        "data_format": "parquet",
        "size_bytes": len(payload),
        "checksum_sha256": checksum,
    }


def read_dataset_parquet(storage_uri: str) -> pl.DataFrame:
    return pl.read_parquet(resolve_dataset_path(storage_uri))
