# CellSeer

Battery cell cycling visualization dashboard for Neware test data. View ICA (dQ/dV), dV/dQ, rate performance, GCD curves, and hierarchy-based filtering.

## Features

- **ICA 3D** — Incremental capacity analysis across cycles and voltage
- **dV/dQ 3D** — Differential voltage vs capacity
- **Rate Performance** — Capacity vs C-rate
- **GCD plot** — Voltage vs capacity (galvanostatic charge/discharge)
- **Hierarchy Tree** — Cathode → Separator → Spacer → Cells filtering
- **Multi-Factor** — Coulombic efficiency by chemistry / separator / spacer

Data is loaded from the backend API and precomputed JSON in `public/`.

## Tech stack

- **Vite** — Build tool
- **React 18** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **Plotly.js** — 3D and 2D charts

## Quick start

### Prerequisites

- Node.js 18+ and npm
- Python 3.9+ (for backend)

### 1. Install dependencies

```bash
cd Untitled/plotly-storyteller
npm install
```

### 2. Run the frontend

```bash
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

### 3. Run the backend (optional)

For live ICA/dV/dQ and cell-record data from the database:

```bash
# From project root
cd ../..
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000 --reload
```

Or use the npm script:

```bash
npm run api
```

The dev server proxies `/api` to `http://127.0.0.1:8000`.

## Project structure

```
src/
├── components/       # UI components
│   ├── panels/       # Tab panels (ICA3DPanel, DVQ3DPanel, etc.)
│   ├── tree/         # HierarchyTreeSidebar, TreeViewFilterSidebar
│   └── ui/           # shadcn components
├── hooks/            # useIcaDvqData, etc.
├── lib/              # icaDvqUtils, ratePerfAggregation
├── data/             # sampleData (fallback), sampleData
└── pages/            # Index (main app)
```

## Scripts

| Command       | Description                            |
|---------------|----------------------------------------|
| `npm run dev` | Start Vite dev server                  |
| `npm run build` | Production build                     |
| `npm run api` | Start FastAPI backend (port 8000)      |
| `npm run lint`| Run ESLint                            |

## Configuration

- **`VITE_DATA_BASE_URL`** — Base URL for data (e.g. S3/R2). Leave empty to use `public/`.
- See `.env.example` and `S3_R2_SETUP.md` for production data hosting.

## Backend

The backend (`backend/`) provides:

- `GET /api/cell-record/{id_no}/ica-dvq` — Precomputed ICA and dV/dQ per cycle
- `GET /api/hierarchy` — DB-backed hierarchy payload (for Tree panel)
- `POST /api/hierarchy/analyse` — Ad-hoc hierarchy analysis from tabular metadata
- `GET /api/health` — Health check

See `backend/README.md` for ingest, PyProBE setup, and database usage.
