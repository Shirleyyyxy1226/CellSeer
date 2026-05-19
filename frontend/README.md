# CellSeer Frontend

Battery cell cycling visualization dashboard. View ICA (dQ/dV), dV/dQ, rate performance, GCD curves, and hierarchy-based filtering.

## Features

- **ICA / dV/dQ** — Incremental capacity and differential voltage analysis
- **Rate Performance** — Capacity vs C-rate
- **GCD plot** — Voltage vs capacity (galvanostatic charge/discharge)
- **Hierarchy Tree** — Filter cells by metadata hierarchy
- **Particle Master** — Overview plots with parallel coordinates

Data is loaded from the FastAPI backend (`/api/*`).

## Tech stack

- **Vite** + **React 18** + **TypeScript**
- **Tailwind CSS** + **shadcn/ui**
- **Plotly.js** — 2D and 3D charts

## Quick start

### Prerequisites

- Node.js 18+ and npm
- Python 3.10+ (for backend; see repo root `README.md`)

### 1. Install dependencies

From this directory:

```bash
npm install
```

### 2. Run the frontend

```bash
npm run dev
```

Open [http://localhost:8080](http://localhost:8080).

### 3. Run the backend

From the **repository root** (in another terminal):

```bash
source .venv/bin/activate
python -m uvicorn backend.api:app --host 127.0.0.1 --port 8000 --reload
```

Or from `frontend/`:

```bash
npm run api
```

The dev server proxies `/api` to `http://127.0.0.1:8000`.

## Project structure

```
src/
├── components/
│   ├── tree/         # HierarchyEditor, TreeSvg, PublicTreeFilterSidebar
│   └── ui/           # shadcn components
├── contexts/         # ProjectHierarchy, TreeFilter, CellSelection
├── features/         # Dashboards per tab (icaDvq, gcdPlot, ratePerformance, …)
├── hooks/
├── lib/              # analyseApi, treeUtils, plot helpers
└── pages/            # Index (main app)
```

## Scripts

| Command | Description |
|---------|-------------|
| `npm run dev` | Start Vite dev server |
| `npm run build` | Production build |
| `npm run api` | Start FastAPI backend (port 8000) |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest |

## Configuration

Copy `.env.example` to `.env.local` if needed:

- **`VITE_DATA_BASE_URL`** — Optional base URL for static JSON assets (CDN). Leave unset to use the API only.

## Backend API

The backend (`../backend/`) provides hierarchy, cell records, uploads, and annotations. See the [root README](../README.md) for setup, database path, and optional PyProBE ingest.
