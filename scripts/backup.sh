#!/usr/bin/env bash
# Nightly PostgreSQL backup with rolling 14-day retention.
#
# Runs *inside the app container* (postgresql-client is installed by Dockerfile).
# Trigger from the host via cron, e.g.:
#
#   0 3 * * *  docker compose exec -T app /app/scripts/backup.sh
#
# Backups land in /data/backups/ on the cellseer-data volume.
# Sync the whole /data tree to off-host storage with one rsync command.

set -euo pipefail

DATABASE_URL="${CELLSEER_DATABASE_URL:-postgresql://cellseer@db/cellseer}"
BACKUP_DIR="${CELLSEER_BACKUP_DIR:-/data/backups}"
RETAIN_DAYS="${CELLSEER_BACKUP_RETAIN_DAYS:-14}"

mkdir -p "$BACKUP_DIR"

timestamp="$(date -u +%Y-%m-%dT%H%M%SZ)"
out="$BACKUP_DIR/cellseer.${timestamp}.sql.gz"

pg_dump "$DATABASE_URL" | gzip > "$out"

echo "[backup] wrote $out"

# Prune anything older than RETAIN_DAYS days.
find "$BACKUP_DIR" -type f -name 'cellseer.*.sql.gz' -mtime "+${RETAIN_DAYS}" -print -delete
