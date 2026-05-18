"""
Central configuration for cellseer backend.
Paths can be overridden via environment variables.
"""

import os
from pathlib import Path

# Base paths (override with CELLSEER_PROJECT_ROOT)
_BACKEND_DIR = Path(__file__).resolve().parent
_PROJECT_ROOT = os.environ.get("CELLSEER_PROJECT_ROOT")
PROJECT_ROOT = Path(_PROJECT_ROOT) if _PROJECT_ROOT else _BACKEND_DIR.parent

# Database
DB_PATH = Path(
    os.environ.get("CELLSEER_DB_PATH", str(PROJECT_ROOT / "backend" / "cellseer.db"))
)

# Data dirs
DATA_DIR = Path(
    os.environ.get("CELLSEER_DATA_DIR", str(PROJECT_ROOT / "data"))
)
METADATA_DIR = Path(
    os.environ.get("CELLSEER_METADATA_DIR", str(DATA_DIR / "metadata"))
)
NEWARE_DIR = Path(
    os.environ.get("CELLSEER_NEWARE_DIR", str(DATA_DIR / "neware"))
)

# Public / frontend output
PUBLIC_DIR = Path(
    os.environ.get("CELLSEER_PUBLIC_DIR", str(PROJECT_ROOT / "frontend" / "public"))
)
RECORD_PATH = Path(
    os.environ.get("CELLSEER_RECORD_PATH", str(PUBLIC_DIR / "cell-record.json"))
)
INDEX_PATH = Path(
    os.environ.get("CELLSEER_INDEX_PATH", str(PUBLIC_DIR / "cell-record-index.json"))
)
PER_CELL_DIR = Path(
    os.environ.get("CELLSEER_PER_CELL_DIR", str(PUBLIC_DIR / "cell-record"))
)
RATE_PERF_PATH = Path(
    os.environ.get("CELLSEER_RATE_PERF_PATH", str(PUBLIC_DIR / "rate-performance.json"))
)

