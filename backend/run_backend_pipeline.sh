#!/usr/bin/env bash
# Run all backend scripts needed to read data/neware and data/metadata.
# Run from project root: bash backend/run_backend_pipeline.sh

set -e
cd "$(dirname "$0")/.."

echo "=== 1. Ingest (metadata CSV + neware xlsx → DB) ==="
python backend/ingest.py

echo ""
echo "=== 2. Write cell-record-index.json from DB ==="
python backend/write_cell_record_index_from_db.py

echo ""
echo "=== 3. Export record JSON (V-Q curves from Neware) ==="
python backend/export_record_json.py

echo ""
echo "=== 4. Export rate performance JSON ==="
python backend/export_rate_json.py

echo ""
echo "=== 5. Compute ICA/DVQ and store in DB ==="
python backend/compute_ica_dvq_db.py

echo ""
echo "=== Done. Start API with: cd frontend && npm run api ==="
