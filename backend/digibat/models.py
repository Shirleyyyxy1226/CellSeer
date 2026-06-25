from __future__ import annotations

from dataclasses import dataclass
from typing import Any


@dataclass(frozen=True)
class DigibatSyncOptions:
    project_id: str
    collection_ids: list[str]
    selected_refcodes: list[str] | None = None
    include_cycling: bool = True
    max_items: int | None = None
    dry_run: bool = False
    full_resync: bool = False
    verbose: bool = False
    since: str | None = None


@dataclass(frozen=True)
class FileCandidate:
    url: str
    filename: str
    source_file_id: str
    source_version: str | None = None
    source_kind: str = "file"


@dataclass
class CollectionSyncReport:
    collection_id: str
    project_id: str
    child_items: int = 0
    metadata_imported: int = 0
    cycling_imported: int = 0
    cycling_skipped_unchanged: int = 0
    cycling_skipped_no_candidates: int = 0
    cycling_missing_or_failed: list[dict[str, str]] | None = None

    def to_dict(self) -> dict[str, Any]:
        return {
            "collectionId": self.collection_id,
            "projectId": self.project_id,
            "childItems": self.child_items,
            "metadataImported": self.metadata_imported,
            "cyclingImported": self.cycling_imported,
            "cyclingSkippedUnchanged": self.cycling_skipped_unchanged,
            "cyclingSkippedNoCandidates": self.cycling_skipped_no_candidates,
            "cyclingMissingOrFailed": self.cycling_missing_or_failed or [],
        }
