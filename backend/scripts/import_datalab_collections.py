#!/usr/bin/env python3
"""Compatibility wrapper for legacy datalab import command.

All DIGIBAT logic now lives in backend/digibat/. This script only translates
legacy flags to the new sync service.
"""

from __future__ import annotations

import argparse
import os
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from digibat.sync_service import run_sync_cli


def main() -> None:
    parser = argparse.ArgumentParser(description="Import datalab collections into CellSeer.")
    parser.add_argument("--base-url", default="https://digibat.dept.ic.ac.uk")
    parser.add_argument("--collections", required=True)
    parser.add_argument("--db-path", default="backend/cellseer.db")
    parser.add_argument("--data-lake-dir", default="data_lake")
    parser.add_argument("--no-cycling", action="store_true")
    parser.add_argument("--max-items", type=int, default=None)
    parser.add_argument("--verbose", action="store_true")
    args = parser.parse_args()

    os.environ["DATALAB_BASE_URL"] = args.base_url
    exit_code = 0
    for collection_id in [x.strip() for x in args.collections.split(",") if x.strip()]:
        argv = [
            "--project",
            collection_id,
            "--collections",
            collection_id,
            "--db-path",
            args.db_path,
            "--data-lake-dir",
            args.data_lake_dir,
        ]
        if args.no_cycling:
            argv.append("--no-cycling")
        if args.max_items is not None:
            argv.extend(["--max-items", str(args.max_items)])
        if args.verbose:
            argv.append("--verbose")
        exit_code = max(exit_code, run_sync_cli(argv))
    raise SystemExit(exit_code)


if __name__ == "__main__":
    main()
