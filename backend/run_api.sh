#!/bin/bash
# Run the hierarchy analysis API (for Vite proxy at /api)
cd "$(dirname "$0")"
exec python -m uvicorn api:app --host 127.0.0.1 --port 8000 --reload
