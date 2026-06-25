# CellSeer

Battery cell dashboard — React frontend + FastAPI backend.

Licensed under the [MIT License](LICENSE). Copyright (c) 2026 Shirley Xiong.

## Features

- Hierarchy tree with metadata filtering
- dQ/dV, dV/dQ, rate performance, and GCD plots
- Cell annotations (notes + tags)
- File upload and ingest
- DIGIBAT sync (mirror remote collections to local cache)

## Project structure

```
.
├── frontend/   # React + Vite UI
├── backend/    # FastAPI + PostgreSQL
└── data/       # raw input files (optional)
```

## Quick start

### 0. Start PostgreSQL

If you don't have PostgreSQL running locally, spin up just the database container:

```bash
POSTGRES_PASSWORD=dev docker compose up -d db
export CELLSEER_DATABASE_URL="postgresql://cellseer:dev@localhost/cellseer"
```

### 1. Install dependencies

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r backend/requirements.txt

cd frontend
npm install
```

### 2. Run backend

```bash
source .venv/bin/activate
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000 --reload
```

### 3. Run frontend

```bash
cd frontend
npm run dev
```

Open [http://localhost:8080](http://localhost:8080). The frontend proxies `/api` to `http://127.0.0.1:8000`.

## API endpoints

| Area | Method | Endpoint |
|---|---|---|
| Health | GET | `/api/health` |
| Hierarchy | GET | `/api/hierarchy` |
| Cells | GET | `/api/cell-record-index` |
| Cells | GET | `/api/cell-record/{cell_id}` |
| Annotations | GET / PUT | `/api/cell-annotation/{cell_id}` |
| Upload | POST | `/api/upload` |
| Upload status | GET | `/api/upload/status/{task_id}` |
| Projects | GET | `/api/projects` |
| DIGIBAT | GET | `/api/digibat/collections` |
| DIGIBAT sync | POST | `/api/projects/{project_id}/digibat/sync` |
| DIGIBAT status | GET | `/api/projects/{project_id}/digibat/status` |

## Database

The backend requires a PostgreSQL database. Set the connection URL via:

```bash
export CELLSEER_DATABASE_URL="postgresql://user@localhost/cellseer"
export CELLSEER_DATA_LAKE_DIR="/path/to/data_lake"
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000 --reload
```

The schema (11 tables) is created automatically on first startup — no migration needed. To start fresh, drop and recreate the database, then re-upload your data.

### Check your DB

```bash
psql cellseer -c "\dt"
psql cellseer -c "SELECT COUNT(*) FROM cell;"
psql cellseer -c "SELECT COUNT(*) FROM dataset WHERE name='cycling';"
```

## DIGIBAT sync

CellSeer can mirror DIGIBAT collections into local PostgreSQL + Parquet so dashboards work offline.

### Configuration

Add credentials to `backend/.env`:

```bash
DATALAB_BASE_URL=https://digibat.dept.ic.ac.uk
DATALAB_API_KEY=your_api_key
DATALAB_TIMEOUT=60
```

### CLI sync

```bash
python backend/scripts/sync_digibat.py \
  --project "your-project-name" \
  --collections "your-collection-name" \
  \
  --data-lake-dir "data_lake"
```

Useful flags:

- `--dry-run` — preview changes without writing anything
- `--full-resync` — re-download all files, ignoring version cache
- `--no-cycling` — import metadata only, skip cycling files
- `--max-items N` — limit cells processed (useful for testing)
- `--purge` — hard-delete rows soft-deleted more than `--purge-days` days ago (default 30)
- `--verbose` — show per-file progress

### Cron example (every 30 minutes)

```bash
*/30 * * * * cd /path/to/CellSeer && \
  . .venv/bin/activate && \
  python backend/scripts/sync_digibat.py \
    --project "your-project-name" \
    --collections "your-collection-name" \
    \
    --data-lake-dir "data_lake" \
  >> backend/logs/digibat-sync.log 2>&1
```

### Troubleshooting

| Problem | Fix |
|---|---|
| `DATALAB_API_KEY is not configured` | Add `DATALAB_API_KEY` to `backend/.env` |
| `Unauthorized` even though your key works elsewhere | Use `DATALAB-API-KEY: <key>` header, not `Authorization: Bearer` |
| Two collections with the same name in dropdown | DIGIBAT allows duplicate names — the dropdown shows the raw `collection_id` to tell them apart |
| Status stuck at `running` | Restart the server — stale sync jobs are reset on startup |
| `Cached datasets: 0` but parquets exist | Old datasets imported before provenance tracking. Re-sync to tag them correctly |
| Ghost cells in hierarchy (separator, spacer, etc.) | Run: `DELETE FROM cell WHERE source_system='digibat' AND cathode IS NULL AND anode IS NULL AND electrolyte IS NULL;` |
| `.mpr` file fails cycling import | BioLogic PEIS (impedance) files are not cycling files and are correctly rejected |
| Cell disappeared after re-sync | It was soft-deleted. Re-import its refcode to restore it, or wait for `--purge` |
| `/api/cell-record/CEL-245` returns 404 | URL-encode the cell ID if it contains special characters |

## Frontend commands

```bash
cd frontend
npm run dev      # start dev server
npm run build    # build for production
npm run test     # run tests
npm run lint     # lint
```

## License

MIT License — see [LICENSE](LICENSE).
