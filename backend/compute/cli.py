"""
cellseer/cli.py — Command-line interface for CellSeer.

Usage
-----
# After `pip install -e .` from backend/
cellseer ingest-metadata <metadata.xlsx> [--db <path>]
cellseer ingest-cycling  <datafile>      [--db <path>]
cellseer list-cells                      [--db <path>]

# Or without installing:
python -m compute <command> [args]
"""
from __future__ import annotations

import argparse
from pathlib import Path

DB_DEFAULT = "cellseer.db"


def _add_db_arg(p: argparse.ArgumentParser) -> None:
    p.add_argument(
        "--db",
        default=DB_DEFAULT,
        metavar="PATH",
        help=f"SQLite database file (default: {DB_DEFAULT})",
    )


# ---------------------------------------------------------------------------
# Entry point
# ---------------------------------------------------------------------------

def main(argv=None) -> None:
    parser = argparse.ArgumentParser(
        prog="compute",
        description="CellSeer data management CLI",
    )

    sub = parser.add_subparsers(dest="command", metavar="COMMAND")
    sub.required = True

    # ── ingest-metadata ──────────────────────────────────────────────
    p_meta = sub.add_parser(
        "ingest-metadata",
        help="Load cell metadata from an Excel or CSV file into the DB.",
    )
    p_meta.add_argument("file", metavar="FILE", help="Metadata spreadsheet (.xlsx or .csv)")
    _add_db_arg(p_meta)

    # ── ingest-cycling ────────────────────────────────────────────────
    p_cyc = sub.add_parser(
        "ingest-cycling",
        help="Load a cycling data file, auto-detect format, compute dQ/dV, store in DB.",
    )
    p_cyc.add_argument("file", metavar="FILE", nargs="+", help="Cycling data file(s) — pass multiple for continuation tests")
    p_cyc.add_argument(
        "--dataset", default="cycling", metavar="NAME",
        help="Dataset name to store under (default: cycling)",
    )
    p_cyc.add_argument(
        "--no-pyprobe", action="store_true",
        help="Skip PyProBE and use the native Neware reader directly",
    )
    _add_db_arg(p_cyc)

    # ── list-cells ────────────────────────────────────────────────────
    p_list = sub.add_parser("list-cells", help="Print all cell IDs stored in the DB.")
    _add_db_arg(p_list)

    # ── detect ────────────────────────────────────────────────────────
    p_det = sub.add_parser(
        "detect",
        help="Show detected headers and cycler confidence scores for a file.",
    )
    p_det.add_argument("file", metavar="FILE", help="Data file to inspect")

    args = parser.parse_args(argv)

    if args.command == "detect":
        _cmd_detect(args)
        return

    from compute.db.sqlite_backend import SQLiteBackend
    db = SQLiteBackend(args.db)

    if args.command == "ingest-metadata":
        _cmd_ingest_metadata(args, db)
    elif args.command == "ingest-cycling":
        _cmd_ingest_cycling(args, db)
    elif args.command == "list-cells":
        _cmd_list_cells(args, db)
    elif args.command == "detect":
        _cmd_detect(args)


# ---------------------------------------------------------------------------
# Command implementations
# ---------------------------------------------------------------------------

def _cmd_ingest_metadata(args, db) -> None:
    from compute.ingest import ingest_metadata
    filepath = Path(args.file)
    print(f"Reading metadata from {filepath} …")
    cell_ids = ingest_metadata(filepath, db)
    print(f"Upserted {len(cell_ids)} cell(s) into {args.db}:")
    for cid in cell_ids:
        print(f"  {cid}")


def _cmd_ingest_cycling(args, db) -> None:
    from compute.ingest import ingest_cycling_file
    filepath = [Path(f) for f in args.file]
    label = filepath[0].name if len(filepath) == 1 else f"{len(filepath)} files"
    print(f"Ingesting cycling file(s): {label} …")
    reader_kwargs = {}
    if args.no_pyprobe:
        reader_kwargs["use_pyprobe"] = False
    cell_id = ingest_cycling_file(
        filepath,
        db,
        dataset_name=args.dataset,
        **reader_kwargs,
    )
    print(f"Stored cycling + dqdv + dvdq for cell '{cell_id}' in {args.db}")


def _cmd_detect(args) -> None:
    from compute.readers.cycling.detect import (
        _read_headers, _normalize, CYCLER_SIGNATURES, detect_cycler
    )
    filepath = Path(args.file)
    headers = _read_headers(filepath)

    print(f"\nHeaders in {filepath.name}:")
    for h in headers:
        print(f"  {h!r:45s}  →  {_normalize(h)!r}")

    print("\nConfidence scores:")
    norm_headers = [_normalize(h) for h in headers]
    for cycler, concepts in CYCLER_SIGNATURES.items():
        matched = []
        for alternatives in concepts:
            hit = next(
                (alt for alt in alternatives for nh in norm_headers if alt in nh),
                None,
            )
            if hit:
                matched.append(hit)
        score = len(matched) / len(concepts)
        print(f"  {cycler:12s}  {score:.0%}  matched: {matched}")

    cycler, confidence = detect_cycler(filepath)
    print(f"\nBest match: {cycler or 'none'} ({confidence:.0%})")


def _cmd_list_cells(args, db) -> None:
    cell_ids = db.list_cells()
    if not cell_ids:
        print(f"No cells found in {args.db}")
        return
    print(f"{len(cell_ids)} cell(s) in {args.db}:")
    for cid in cell_ids:
        print(f"  {cid}")


if __name__ == "__main__":
    main()
