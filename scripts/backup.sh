#!/usr/bin/env bash
# Nightly logical backup: pg_dump custom format + retention. Works locally, in the compose sidecar, or in cron.
#   DATABASE_URL=postgres://... BACKUP_DIR=/backups RETENTION_DAYS=14 ./scripts/backup.sh
#   Optional off-site copy: BACKUP_S3_URI=s3://bucket/quiz (needs aws cli) or BACKUP_COPY_CMD='rclone copy {file} remote:quiz'
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
BACKUP_DIR="${BACKUP_DIR:-./backups}"
RETENTION_DAYS="${RETENTION_DAYS:-14}"
mkdir -p "$BACKUP_DIR"
stamp="$(date -u +%Y%m%dT%H%M%SZ)"
file="$BACKUP_DIR/quiz-$stamp.dump"
pg_dump --format=custom --compress=6 --no-owner --no-privileges --dbname="$DATABASE_URL" --file="$file"
# checksum names the bare file so restore.sh can verify it from inside BACKUP_DIR
(cd "$BACKUP_DIR" && sha256sum "$(basename "$file")" > "$(basename "$file").sha256")
echo "backup written: $file ($(du -h "$file" | cut -f1))"
if [ -n "${BACKUP_S3_URI:-}" ]; then aws s3 cp "$file" "$BACKUP_S3_URI/" && aws s3 cp "$file.sha256" "$BACKUP_S3_URI/"; fi
if [ -n "${BACKUP_COPY_CMD:-}" ]; then eval "${BACKUP_COPY_CMD//\{file\}/$file}"; fi
# retention: keep the last RETENTION_DAYS days locally
find "$BACKUP_DIR" -name 'quiz-*.dump*' -mtime +"$RETENTION_DAYS" -delete
echo "retention: kept $(ls "$BACKUP_DIR"/quiz-*.dump 2>/dev/null | wc -l) dump(s)"
