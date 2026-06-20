# syntax=docker/dockerfile:1.6
#
# CellSeer single-image build (Python runtime only).
#
# The React frontend is built on the *host* before `docker compose build`:
#
#   cd frontend && npm ci && npm run build       # produces frontend/dist/
#   docker compose build app                     # this Dockerfile copies it in
#
# Why not a Node build stage inside Docker? On small VMs (≤8 GB RAM) the
# combined apt + npm + pip workload caused BuildKit OOMs / EOF errors. Two
# stages means double the disk, twice the chance of failure. Building the
# frontend on the host once (the dev environment already has Node) is much
# simpler and ~10× faster.
#
# CI / fresh-clone deploys must run `npm run build` in frontend/ before
# `docker compose build`. DEPLOY.md spells this out in step A4.

FROM python:3.12-slim AS runtime

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    PIP_NO_CACHE_DIR=1 \
    # All runtime data lives under /data so a single volume mount covers
    # the SQLite DB, parquet cache, and any user-uploaded files.
    CELLSEER_DB_PATH=/data/cellseer.db \
    CELLSEER_DATA_DIR=/data/data \
    CELLSEER_DATA_LAKE_DIR=/data/data_lake \
    CELLSEER_FRONTEND_DIST=/app/frontend/dist

WORKDIR /app

# System packages: sqlite3 CLI for the backup script, curl for healthcheck,
# tini as PID 1 for clean signal handling under docker compose.
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       sqlite3 \
       curl \
       tini \
       ca-certificates \
    && rm -rf /var/lib/apt/lists/*

COPY backend/requirements.txt /app/backend/requirements.txt
RUN pip install -r /app/backend/requirements.txt

COPY backend/ /app/backend/
COPY cellviz/ /app/cellviz/
COPY scripts/ /app/scripts/

# Copy the host-built SPA bundle. CELLSEER_FRONTEND_DIST points the Python
# app at this directory so it serves the React UI from the same origin as
# the API. If frontend/dist is missing in the build context, this COPY
# fails fast — that's the signal to run `npm run build` on the host first.
COPY frontend/dist /app/frontend/dist

# Make backup script executable
RUN chmod +x /app/scripts/backup.sh

# Non-privileged runtime user; ensure it can write to /data when the host
# mounts an empty volume there (the entrypoint will chown on first boot).
RUN useradd --create-home --uid 1000 cellseer \
    && mkdir -p /data \
    && chown -R cellseer:cellseer /data /app

USER cellseer

EXPOSE 8000

HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
    CMD curl -fsS http://127.0.0.1:8000/api/health || exit 1

ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["python", "-m", "uvicorn", "backend.api:app", \
     "--host", "0.0.0.0", "--port", "8000", "--workers", "1"]
