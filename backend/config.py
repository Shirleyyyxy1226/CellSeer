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

# Load DIGIBAT and other secrets from backend/.env without overriding existing env vars.
try:
    from dotenv import load_dotenv as _load_dotenv

    _load_dotenv(_BACKEND_DIR / ".env", override=False)
except Exception:
    pass

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
DATA_LAKE_DIR = Path(
    os.environ.get("CELLSEER_DATA_LAKE_DIR", str(PROJECT_ROOT / "data_lake"))
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

# DIGIBAT integration defaults (specific parsing/validation lives in backend/digibat/config.py)
DATALAB_BASE_URL = os.environ.get("DATALAB_BASE_URL", "https://digibat.dept.ic.ac.uk").strip().rstrip("/")
DATALAB_API_KEY = os.environ.get("DATALAB_API_KEY", "").strip()
DATALAB_TIMEOUT = int(os.environ.get("DATALAB_TIMEOUT", "60"))

