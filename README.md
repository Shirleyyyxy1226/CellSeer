# CellSeer

Simple battery-cell dashboard with a React frontend and FastAPI backend.

Licensed under the [BSD 3-Clause License](LICENSE).

## What it can do

- Show hierarchy tree and filter cells by metadata
- Plot ICA / dVdQ, rate performance, and GCD curves
- Read data from backend API (DB-backed)
- Support notes/tags (cell annotations)

## Project structure

```text
.
├── frontend/   # React + Vite UI
├── backend/    # FastAPI API + SQLite access
└── data/       # optional raw input files (for ingest pipeline)
```

## Quick start (local)

### 1) Install dependencies

```bash
# from repo root
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

cd frontend
npm install
```

### 2) Run backend

Open terminal A at repo root:

```bash
source .venv/bin/activate
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000 --reload
```

### 3) Run frontend

Open terminal B:

```bash
cd frontend
npm run dev
```

Then open: [http://localhost:8080](http://localhost:8080)

Frontend dev server proxies `/api` to `http://127.0.0.1:8000`.

## Essential API endpoints

| Area | Method | Endpoint | Description |
|---|---|---|---|
| Health | GET | `/api/health` | Verify backend is running |
| Hierarchy | GET | `/api/hierarchy` | Load hierarchy tree data from DB |
| Cells | GET | `/api/cell-record-index` | List available cells for dashboards |
| Cells | GET | `/api/cell-record/{id_no}` | Get cycling curve data for one cell |
| ICA / dVdQ | GET | `/api/cell-record/{id_no}/ica-dvq` | Get ICA and dV/dQ payload for one cell |
| Upload | POST | `/api/upload` | Upload and ingest one file |
| Upload | GET | `/api/upload/status/{task_id}` | Check upload task progress |
| Projects | GET | `/api/projects` | List projects |

## Connect to database

By default, backend reads:

- `backend/cellseer.db`
- `data_lake/` (dataset parquet files)

To use another DB file and storage location, set env vars before starting backend:

```bash
export CELLSEER_DB_PATH="/absolute/path/to/your.db"
export CELLSEER_DATA_LAKE_DIR="/absolute/path/to/data_lake"
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000 --reload
```


## If you already have your own DB

If you want to connect an existing SQLite DB to this website, the easiest way is to make your DB compatible with the backend schema used by CellSeer.

### Required tables (minimum)

- `project`
- `cell`
- `dataset`

These are enough for the main dashboard to load data.

### Required columns (minimum)

`project`:
- `id` (TEXT, primary key)
- `name` (TEXT)

`cell`:
- `project_id` (TEXT)
- `cell_id` (TEXT, unique id for each cell)
- `id_no` (INTEGER, numeric cell id used by API routes)
- optional but recommended for filters: `cathode`, `separator_type`, `spacer_mm`, `cathode_mass`, `electrolyte`

`dataset`:
- `project_id` (TEXT)
- `cell_id` (TEXT)
- `name` (TEXT)
- `storage_kind` (TEXT, e.g. `local`)
- `storage_uri` (TEXT, parquet path relative to `CELLSEER_DATA_LAKE_DIR` or absolute)
- `data_format` (TEXT, `parquet`)
- optional: `size_bytes` (INTEGER), `checksum_sha256` (TEXT)
- optional:  (TEXT JSON, used for protocol segments)

### Required dataset names

At minimum, insert rows in `dataset` with:

- `name = 'cycling'` (needed for rate performance + cell record APIs)

For ICA / dVdQ views, also include:

- `name = 'discharge_dqdv'`
- `name = 'discharge_dvdq'`

Legacy fallback names also work for discharge:

- `name = 'dqdv'`
- `name = 'dvdq'`

### How to point the app to your DB

```bash
export CELLSEER_DB_PATH="/absolute/path/to/your.db"
export CELLSEER_DATA_LAKE_DIR="/absolute/path/to/data_lake"
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000 --reload
```

### Quick DB compatibility check

Run this before starting backend:

```bash
sqlite3 "/absolute/path/to/your.db" "
.tables
SELECT 'project_rows', COUNT(*) FROM project;
SELECT 'cell_rows', COUNT(*) FROM cell;
SELECT 'cycling_rows', COUNT(*) FROM dataset WHERE name='cycling';
"
```

If these queries work and counts are non-zero, the website should be able to load core dashboards.

## Health check

After backend starts:

- [http://127.0.0.1:8000/api/health](http://127.0.0.1:8000/api/health)

If this endpoint returns OK, frontend should be able to load API data.

## License

CellSeer is distributed under the **BSD 3-Clause License**. You are free to use, copy, modify, and redistribute it (including in closed-source / commercial products), provided you keep the copyright notice and disclaimer, and do not use the CellSeer name to endorse derivative works without permission. See the [LICENSE](LICENSE) file for the full text.

Copyright (c) 2026 CellSeer.

## Useful frontend commands

```bash
cd frontend
npm run dev
npm run build
npm run test
npm run lint
```

## Import from datalab collections (session auth)

You can map datalab collections to CellSeer projects with:

```bash
export DIGIBAT_SESSION_COOKIE="your_session_cookie_value"
python backend/scripts/import_datalab_collections.py \
  --base-url "https://digibat.dept.ic.ac.uk" \
  --collections "Discovery-Benchmark-v0,Your-Second-Collection" \
  --db-path "backend/cellseer.db" \
  --data-lake-dir "data_lake"
```

Notes:
- One collection is imported as one CellSeer project.
- Metadata is imported for each child item.
- Cycling ingest is attempted from cycle block/file URLs when available.
- Use `--no-cycling` to import metadata only.
