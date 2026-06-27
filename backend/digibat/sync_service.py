from __future__ import annotations

import argparse
import os
import re
import tempfile
import time
import uuid
from pathlib import Path
from typing import Any
from urllib.parse import quote, urlparse

from compute.analysis.metadata import CellMetadata
from compute.cell import Cell
from compute.db.pg_backend import PostgresBackend
from compute.ingest import ingest_cycling_file
from digibat.client import DigibatClient
from digibat.config import DigibatConfig
from digibat.models import CollectionSyncReport, DigibatSyncOptions, FileCandidate
from digibat.provenance import (
    finish_sync_run,
    get_previous_source_version,
    lookup_cell_id_by_refcode,
    purge_soft_deleted,
    rename_cell_id,
    soft_delete_missing_files,
    soft_delete_stale_cells,
    start_sync_run,
    upsert_cell_source,
    upsert_dataset_source,
    upsert_file_map,
)
from project_scope import ensure_project_exists, normalize_project_id


SUPPORTED_CYCLING_EXTS = {".xlsx", ".xls", ".csv", ".mpt", ".mpr"}

# Transient-failure retry for sync_collections. Total in-task attempts and the
# linear backoff base (sleep = base * attempt, i.e. 2s, 4s between the 3 tries).
_MAX_SYNC_ATTEMPTS = 3
_RETRY_BACKOFF_SECONDS = 2.0


def _strip_tags(text: str) -> str:
    return re.sub(r"<[^>]+>", "", text or "").strip()


def parse_plan_table(description_html: str) -> dict[str, str]:
    out: dict[str, str] = {}
    if not description_html:
        return out
    pattern = re.compile(
        r"<tr>\s*<th[^>]*>(.*?)</th>\s*<td[^>]*>(.*?)</td>\s*</tr>",
        flags=re.IGNORECASE | re.DOTALL,
    )
    for k, v in pattern.findall(description_html):
        out[_strip_tags(k)] = _strip_tags(v)
    return out


def to_int(value: Any) -> int | None:
    if value is None:
        return None
    try:
        return int(float(str(value).strip()))
    except Exception:
        return None


def _extract_id_no(*candidates: Any) -> int | None:
    """Extract a numeric cell id from a string like "CEL-245" or "2210". Returns None if not found."""
    for raw in candidates:
        if raw is None:
            continue
        s = str(raw).strip()
        if not s:
            continue
        direct = to_int(s)
        if direct is not None:
            return direct
        m = re.search(r"(?i)(?:^|[^a-z0-9])(?:cel|cell)[-_ ]*(\d+)(?:[^a-z0-9]|$)", s)
        if m:
            return int(m.group(1))
    return None


def to_float(value: Any) -> float | None:
    if value is None:
        return None
    try:
        return float(str(value).strip())
    except Exception:
        return None


def dig(obj: Any, path: str, default: Any = None) -> Any:
    cur = obj
    for token in path.split("."):
        if isinstance(cur, dict):
            if token in cur:
                cur = cur[token]
            else:
                return default
        elif isinstance(cur, list):
            if token.isdigit():
                idx = int(token)
                if 0 <= idx < len(cur):
                    cur = cur[idx]
                else:
                    return default
            else:
                return default
        else:
            return default
    return cur


def metadata_row_from_item(item_data: dict[str, Any], fallback_item_id: str | None) -> dict[str, Any]:
    plan = parse_plan_table(item_data.get("description", ""))
    item_id = item_data.get("item_id") or fallback_item_id
    row = {
        "Cell name": item_data.get("name") or plan.get("Cell ID") or str(item_id or ""),
        "Number": _extract_id_no(item_id, plan.get("ID no."), item_data.get("name")),
        "Batch": to_int(plan.get("Batch")),
        "Category": plan.get("Category"),
        "Cathode": dig(item_data, "positive_electrode.0.item.name") or plan.get("Cathode"),
        "Cathode diameter (mm)": to_float(plan.get("Cathode diameter (mm)")),
        "Cathode mass (mg)": to_float(dig(item_data, "positive_electrode.0.quantity"))
        or to_float(plan.get("Cathode mass (mg)")),
        "Anode": dig(item_data, "negative_electrode.0.item.name") or plan.get("Anode"),
        "Anode diameter (mm)": to_float(plan.get("Anode diameter (mm)")),
        "Anode mass (mg)": to_float(dig(item_data, "negative_electrode.0.quantity"))
        or to_float(plan.get("Anode mass (mg)")),
        "N/P ratio": to_float(plan.get("N/P ratio")),
        "Separator": plan.get("Separator"),
        "Separator diameter (mm)": to_float(plan.get("Separator diameter (mm)")),
        "Electrolyte": dig(item_data, "electrolyte.0.item.name") or plan.get("Electrolyte"),
        "Electrolyte volume (μL)": to_float(dig(item_data, "electrolyte.0.quantity"))
        or to_float(plan.get("Electrolyte volume (μL)")),
        "Spacer (mm)": to_float(plan.get("Spacer (mm)")),
        "Repeat": to_int(plan.get("Repeat")),
        "Notes": plan.get("Notes") or item_data.get("refcode"),
    }
    for k, v in plan.items():
        row.setdefault(k, v)
    return row


def _file_api_url(base_url: str, raw_url: str) -> str:
    if raw_url.startswith("http"):
        return raw_url
    if raw_url.startswith("/api/"):
        return f"{base_url}{raw_url}"
    if raw_url.startswith("/files/"):
        return f"{base_url}/api{raw_url}"
    return f"{base_url}{raw_url}"


def _source_version(file_info: dict[str, Any], fallback: str | None = None) -> str | None:
    for key in ("updated_at", "last_modified", "version", "modified_at"):
        val = file_info.get(key)
        if val:
            return str(val)
    size = file_info.get("size")
    if size is not None:
        return f"size:{size}"
    return fallback


_CONTINUATION_PATTERN = re.compile(r"^(?P<prefix>.+?)_C(?P<idx>\d+)$", re.IGNORECASE)


def group_continuation_files(
    candidates: list[FileCandidate],
) -> list[list[FileCandidate]]:
    """Group multi-part cycling files (e.g. _C01, _C02, _C03) so they are ingested together in order."""
    groups: dict[str, list[tuple[int, FileCandidate]]] = {}
    order: list[str] = []
    standalone: list[FileCandidate] = []
    for cand in candidates:
        stem = Path(cand.filename).stem
        ext = Path(cand.filename).suffix.lower()
        m = _CONTINUATION_PATTERN.match(stem)
        if not m or not ext:
            standalone.append(cand)
            continue
        key = f"{m.group('prefix')}|{ext}|{cand.source_kind}"
        if key not in groups:
            order.append(key)
            groups[key] = []
        groups[key].append((int(m.group("idx")), cand))

    out: list[list[FileCandidate]] = []
    for key in order:
        items = sorted(groups[key], key=lambda x: x[0])
        out.append([cand for _, cand in items])
    for cand in standalone:
        out.append([cand])
    return out


def item_file_candidates(base_url: str, item_data: dict[str, Any]) -> list[FileCandidate]:
    native_candidates: list[FileCandidate] = []
    bdf_candidates: list[FileCandidate] = []

    for f in item_data.get("files") or []:
        if not isinstance(f, dict):
            continue
        name = f.get("name") or f.get("original_name")
        immutable_id = f.get("immutable_id")
        if not name or not immutable_id:
            continue
        ext = Path(name).suffix.lower()
        if ext not in SUPPORTED_CYCLING_EXTS:
            continue
        safe_name = quote(name, safe="._-() ")
        url = f"{base_url}/api/files/{immutable_id}/{safe_name}"
        native_candidates.append(
            FileCandidate(
                url=url,
                filename=name,
                source_file_id=str(immutable_id),
                source_version=_source_version(f),
                source_kind="native",
            )
        )

    blocks_obj = item_data.get("blocks_obj") or {}
    for key, block in blocks_obj.items():
        if not isinstance(block, dict):
            continue
        if block.get("blocktype") != "cycle":
            continue
        bdf_url = block.get("bdf_url")
        if isinstance(bdf_url, str) and bdf_url:
            url = _file_api_url(base_url, bdf_url)
            filename = Path(urlparse(url).path).name or "cycling.bdf.csv"
            bdf_candidates.append(
                FileCandidate(
                    url=url,
                    filename=filename,
                    source_file_id=f"bdf:{key}",
                    source_version=_source_version(block, fallback=url),
                    source_kind="bdf",
                )
            )

    seen: set[str] = set()
    out: list[FileCandidate] = []
    for candidate in [*native_candidates, *bdf_candidates]:
        if candidate.url in seen:
            continue
        seen.add(candidate.url)
        out.append(candidate)
    return out


def looks_like_html(content: bytes, content_type: str | None) -> bool:
    if content_type and "text/html" in content_type.lower():
        return True
    prefix = content[:256].decode("utf-8", errors="ignore").lower()
    return "<!doctype html" in prefix or "<html" in prefix


def import_collection(
    *,
    client: DigibatClient,
    collection_id: str,
    db_path: str,
    options: DigibatSyncOptions,
) -> dict[str, Any]:
    db = PostgresBackend(db_path)
    project_id = normalize_project_id(options.project_id or collection_id)
    conn = db._connect()
    ensure_project_exists(conn, project_id, collection_id)
    # Record start time so we can detect cells that were removed from the upstream collection.
    run_started_at = conn.execute("SELECT NOW() AS ts").fetchone()["ts"]
    conn.close()
    db.set_project_scope(project_id)

    report = CollectionSyncReport(collection_id=collection_id, project_id=project_id, cycling_missing_or_failed=[])
    collection_payload = client.get_json(f"/api/collections/{quote(collection_id, safe='._-')}")
    child_items_raw_count = len(collection_payload.get("child_items") or [])
    child_items = collection_payload.get("child_items") or []
    # Only import actual cells — skip precursor materials (separators, spacers, etc.).
    child_items = [c for c in child_items if str(c.get("type") or "cells").lower() == "cells"]
    selected_refcodes = {x for x in (options.selected_refcodes or []) if x}
    if selected_refcodes:
        child_items = [c for c in child_items if str(c.get("refcode") or "") in selected_refcodes]
    if options.max_items is not None:
        child_items = child_items[: options.max_items]
    report.child_items = len(child_items)

    for idx, child in enumerate(child_items, start=1):
        refcode = child.get("refcode")
        if not refcode:
            continue
        item_payload = client.get_json(f"/api/items/{quote(refcode, safe=':._-')}")
        item_data = item_payload.get("item_data") or {}
        fallback_item_id = item_payload.get("item_id")

        row = metadata_row_from_item(item_data, fallback_item_id=fallback_item_id)
        if not row.get("Cell name"):
            continue
        meta = CellMetadata.from_dict(row, primary_key_header="Cell name", id_no_header="Number")
        desired_cell_id = meta.cell_id

        # If the cell was renamed upstream, update the local cell_id to match.
        source_conn = db._connect()
        try:
            existing_cell_id = lookup_cell_id_by_refcode(
                source_conn,
                project_id=project_id,
                remote_refcode=str(refcode),
            )
            if existing_cell_id is not None and existing_cell_id != desired_cell_id:
                rename_cell_id(
                    source_conn,
                    project_id=project_id,
                    old_cell_id=existing_cell_id,
                    new_cell_id=desired_cell_id,
                )
                source_conn.commit()
                if options.verbose:
                    print(f"  [{idx}/{report.child_items}] {refcode}: renamed '{existing_cell_id}' -> '{desired_cell_id}'")
        finally:
            source_conn.close()

        # Two cells can share the same id_no — routing always uses cell_id.
        db.upsert_cell(Cell(metadata=meta))
        report.metadata_imported += 1

        source_conn = db._connect()
        try:
            upsert_cell_source(
                source_conn,
                project_id=project_id,
                cell_id=meta.cell_id,
                remote_refcode=str(refcode),
                remote_item_id=str(fallback_item_id) if fallback_item_id is not None else None,
            )
            source_conn.commit()
        finally:
            source_conn.close()

        if not options.include_cycling:
            continue

        candidates = item_file_candidates(client.base_url, item_data)

        # Soft-delete any files that were removed from the upstream cell.
        seen_ids = {c.source_file_id for c in candidates}
        source_conn = db._connect()
        try:
            soft_delete_missing_files(
                source_conn,
                project_id=project_id,
                remote_refcode=str(refcode),
                seen_source_file_ids=seen_ids,
            )
            source_conn.commit()
        finally:
            source_conn.close()

        if not candidates:
            report.cycling_skipped_no_candidates += 1
            continue

        # Group multi-part files so they are ingested as one dataset.
        groups = group_continuation_files(candidates)

        ingested = False
        last_reason = "no_candidate_succeeded"
        for group in groups:
            group_label = (
                group[0].filename if len(group) == 1
                else f"{group[0].filename} (+{len(group) - 1} continuation)"
            )

            # Skip this group if all files are unchanged since last sync.
            source_conn = db._connect()
            try:
                all_unchanged = (
                    not options.full_resync
                    and all(
                        cand.source_version
                        and get_previous_source_version(
                            source_conn,
                            project_id=project_id,
                            source_file_id=cand.source_file_id,
                        ) == cand.source_version
                        for cand in group
                    )
                )
            finally:
                source_conn.close()
            if all_unchanged:
                report.cycling_skipped_unchanged += 1
                continue

            if options.dry_run:
                report.cycling_imported += 1
                ingested = True
                break

            downloaded_paths: list[Path] = []
            download_ok = True
            for cand in group:
                try:
                    if options.verbose:
                        print(f"  [{idx}/{report.child_items}] {refcode}: downloading {cand.filename}")
                    data, content_type = client.download(cand.url)
                    if looks_like_html(data, content_type):
                        last_reason = f"html_response ({cand.filename})"
                        download_ok = False
                        break
                    suffix = Path(cand.filename).suffix.lower() or ".dat"
                    with tempfile.NamedTemporaryFile(
                        suffix=suffix,
                        delete=False,
                        prefix=Path(cand.filename).stem + "_",
                    ) as tmp:
                        tmp.write(data)
                        tmp_path = Path(tmp.name)
                    target = tmp_path.with_name(cand.filename)
                    try:
                        tmp_path.rename(target)
                        tmp_path = target
                    except OSError:
                        pass
                    downloaded_paths.append(tmp_path)
                except Exception as exc:
                    last_reason = f"download_error ({cand.filename}): {exc!r}"
                    download_ok = False
                    break

            if not download_ok or not downloaded_paths:
                for p in downloaded_paths:
                    p.unlink(missing_ok=True)
                continue

            try:
                # ingest_cycling_file must remain synchronous: the finally block
                # below deletes downloaded_paths immediately after this returns.
                ingest_cycling_file(
                    downloaded_paths if len(downloaded_paths) > 1 else downloaded_paths[0],
                    db,
                    project_id=project_id,
                    cell_id=meta.cell_id,
                    id_no=meta.id_no,
                )
                report.cycling_imported += 1
                ingested = True
                source_conn = db._connect()
                local_cell_id = meta.cell_id
                try:
                    for cand in group:
                        upsert_file_map(
                            source_conn,
                            project_id=project_id,
                            remote_refcode=str(refcode),
                            source_file_id=cand.source_file_id,
                            filename=cand.filename,
                            source_version=cand.source_version,
                            cell_id=local_cell_id,
                            status="done",
                        )
                    primary = group[0]
                    upsert_dataset_source(
                        source_conn,
                        project_id=project_id,
                        cell_id=local_cell_id,
                        source_refcode=str(refcode),
                        source_file_id=primary.source_file_id,
                        source_version=primary.source_version,
                    )
                    source_conn.commit()
                finally:
                    source_conn.close()
                if options.verbose:
                    print(f"  [{idx}/{report.child_items}] {refcode}: cycling ingested from {group_label}")
                break
            except Exception as exc:
                last_reason = f"ingest_error ({group_label}): {exc!r}"
                source_conn = db._connect()
                try:
                    for cand in group:
                        upsert_file_map(
                            source_conn,
                            project_id=project_id,
                            remote_refcode=str(refcode),
                            source_file_id=cand.source_file_id,
                            filename=cand.filename,
                            source_version=cand.source_version,
                            cell_id=meta.cell_id,
                            status="error",
                            error_message=last_reason,
                        )
                    source_conn.commit()
                finally:
                    source_conn.close()
            finally:
                for p in downloaded_paths:
                    p.unlink(missing_ok=True)

        if not ingested:
            report.cycling_missing_or_failed.append({"refcode": str(refcode), "reason": last_reason})

    # Soft-delete cells no longer in the upstream collection, but only on full syncs.
    # Partial syncs (selected cells) should not mark unselected cells as deleted.
    selected_set = {x for x in (options.selected_refcodes or []) if x}
    is_full_sweep = not selected_set or len(selected_set) >= child_items_raw_count
    if is_full_sweep and not options.dry_run:
        source_conn = db._connect()
        try:
            soft_delete_stale_cells(
                source_conn,
                project_id=project_id,
                run_started_at=run_started_at,
            )
            source_conn.commit()
        finally:
            source_conn.close()

    return report.to_dict()


def sync_collections(
    *,
    config: DigibatConfig,
    db_path: str,
    options: DigibatSyncOptions,
    run_id: str | None = None,
) -> dict[str, Any]:
    if not options.collection_ids:
        raise RuntimeError("At least one collection must be specified.")

    os.environ.setdefault("CELLSEER_DATA_LAKE_DIR", str(Path("data_lake").resolve()))
    client = DigibatClient(config.base_url, config.api_key, timeout_seconds=config.timeout_seconds)
    db = PostgresBackend(db_path).set_project_scope(options.project_id)
    if run_id is None:
        # CLI / direct call path: create the run row here.
        run_id = str(uuid.uuid4())
        conn = db._connect()
        start_sync_run(
            conn,
            run_id,
            options.project_id,
            mode="dry-run" if options.dry_run else "sync",
            collection_ids=list(options.collection_ids),
        )
        conn.commit()
        conn.close()

    # Bounded transient-failure retry. A network blip or DIGIBAT timeout part-way
    # through a sync raises out of import_collection; re-running the whole loop is
    # safe because import is incremental (version cache skips unchanged files and
    # already-imported rows persist), so a retry resumes rather than re-downloading.
    # The run row stays 'running' across attempts — status only flips to done/error
    # once the outcome is final, so the UI never flickers to 'error' mid-retry.
    # Does NOT cover a server restart/crash (the process is gone); the startup
    # reaper marks those runs errored and the user re-triggers (also incremental).
    reports: list[dict[str, Any]] = []
    totals: dict[str, int] = {}
    last_exc: Exception | None = None
    for attempt in range(1, _MAX_SYNC_ATTEMPTS + 1):
        reports = []
        totals = {
            "metadataImported": 0,
            "cyclingImported": 0,
            "cyclingSkippedUnchanged": 0,
            "cyclingSkippedNoCandidates": 0,
            "failed": 0,
        }
        try:
            for cid in options.collection_ids:
                report = import_collection(
                    client=client,
                    collection_id=cid,
                    db_path=db_path,
                    options=options,
                )
                reports.append(report)
                totals["metadataImported"] += int(report.get("metadataImported", 0))
                totals["cyclingImported"] += int(report.get("cyclingImported", 0))
                totals["cyclingSkippedUnchanged"] += int(report.get("cyclingSkippedUnchanged", 0))
                totals["cyclingSkippedNoCandidates"] += int(report.get("cyclingSkippedNoCandidates", 0))
                totals["failed"] += len(report.get("cyclingMissingOrFailed", []))

            conn = db._connect()
            finish_sync_run(conn, run_id, "done", totals={"reports": reports, "totals": totals})
            conn.commit()
            conn.close()
            return {"runId": run_id, "reports": reports, "totals": totals}
        except Exception as exc:
            last_exc = exc
            if attempt < _MAX_SYNC_ATTEMPTS:
                if options.verbose:
                    print(
                        f"[digibat] sync attempt {attempt}/{_MAX_SYNC_ATTEMPTS} failed: {exc}. "
                        f"retrying in {_RETRY_BACKOFF_SECONDS * attempt}s",
                        flush=True,
                    )
                time.sleep(_RETRY_BACKOFF_SECONDS * attempt)
                continue
            conn = db._connect()
            finish_sync_run(
                conn,
                run_id,
                "error",
                totals={"reports": reports, "totals": totals},
                error_message=f"{exc} (failed after {attempt} attempts)",
            )
            conn.commit()
            conn.close()
            raise

    # Unreachable (loop either returns on success or raises on final failure), but
    # keeps type-checkers happy about last_exc.
    if last_exc is not None:
        raise last_exc
    return {"runId": run_id, "reports": reports, "totals": totals}


def run_sync_cli(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Sync DIGIBAT collections into CellSeer cache.")
    parser.add_argument("--project", required=True, help="CellSeer project ID")
    parser.add_argument(
        "--collections",
        required=True,
        help="Comma-separated collection IDs",
    )
    parser.add_argument("--db-path", default="", help="Ignored (PostgreSQL connection from CELLSEER_DATABASE_URL)")
    parser.add_argument("--data-lake-dir", default="data_lake", help="CellSeer data-lake directory")
    parser.add_argument("--max-items", type=int, default=None)
    parser.add_argument("--since", default=None, help="Reserved for future incremental filtering")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--full-resync", action="store_true")
    parser.add_argument("--no-cycling", action="store_true")
    parser.add_argument("--verbose", action="store_true")
    parser.add_argument(
        "--purge",
        action="store_true",
        help="After a successful sync, hard-delete soft-deleted rows older than --purge-days "
        "(remove parquet files, then drop dataset/file-map/cell rows).",
    )
    parser.add_argument(
        "--purge-days",
        type=int,
        default=30,
        help="Tombstone age cutoff for --purge, in days. Default: 30.",
    )
    args = parser.parse_args(argv)

    os.environ["CELLSEER_DATA_LAKE_DIR"] = str(Path(args.data_lake_dir).resolve())
    config = DigibatConfig(
        base_url=os.environ.get("DATALAB_BASE_URL", "https://digibat.dept.ic.ac.uk").strip().rstrip("/"),
        api_key=os.environ.get("DATALAB_API_KEY", "").strip(),
        timeout_seconds=int(os.environ.get("DATALAB_TIMEOUT", "60")),
    )
    if not config.api_key:
        raise SystemExit("Set DATALAB_API_KEY in environment first.")

    options = DigibatSyncOptions(
        project_id=normalize_project_id(args.project),
        collection_ids=[x.strip() for x in args.collections.split(",") if x.strip()],
        selected_refcodes=None,
        include_cycling=not args.no_cycling,
        max_items=args.max_items,
        dry_run=args.dry_run,
        full_resync=args.full_resync,
        verbose=args.verbose,
        since=args.since,
    )
    result = sync_collections(config=config, db_path=args.db_path, options=options)
    print(f"Sync run: {result['runId']}")
    for r in result["reports"]:
        print(
            f"- {r['collectionId']}: metadata={r['metadataImported']}/{r['childItems']}, "
            f"cycling={r['cyclingImported']}, skipped_unchanged={r.get('cyclingSkippedUnchanged', 0)}, "
            f"failed={len(r.get('cyclingMissingOrFailed', []))}"
        )

    if args.purge:
        from compute.db.pg_backend import PostgresBackend
        db = PostgresBackend(args.db_path).set_project_scope(options.project_id)
        conn = db._connect()
        try:
            counts = purge_soft_deleted(
                conn,
                project_id=options.project_id,
                older_than_days=args.purge_days,
            )
            conn.commit()
        finally:
            conn.close()
        print(
            f"Purge (>{args.purge_days}d): "
            f"datasets={counts['datasets']}, "
            f"files_removed={counts['files_removed']}, "
            f"file_map_rows={counts['file_map_rows']}, "
            f"cells={counts['cells']}"
        )
    return 0
