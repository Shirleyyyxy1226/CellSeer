#!/usr/bin/env python3
from __future__ import annotations

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from digibat.sync_service import run_sync_cli


if __name__ == "__main__":
    raise SystemExit(run_sync_cli())
