#!/usr/bin/env bash
# Restore a pg_dump custom-format file into DATABASE_URL (the database must exist and be empty or disposable).
#   DATABASE_URL=postgres://... ./scripts/restore.sh backups/quiz-20260904T020000Z.dump
# Verifies the checksum when a .sha256 sidecar exists, then prints row counts of key tables.
set -euo pipefail
: "${DATABASE_URL:?DATABASE_URL is required}"
file="${1:?usage: restore.sh <dump-file>}"
[ -f "$file.sha256" ] && (cd "$(dirname "$file")" && sha256sum -c "$(basename "$file").sha256")
case "$file" in
  *.gpg) plain="${file%.gpg}"; gpg --batch --yes --decrypt --output "$plain" "$file"; file="$plain" ;;
esac
pg_restore --no-owner --no-privileges --clean --if-exists --dbname="$DATABASE_URL" "$file"
psql "$DATABASE_URL" -Atc "
  SELECT 'schema_migrations=' || count(*) FROM schema_migrations
  UNION ALL SELECT 'users=' || count(*) FROM users
  UNION ALL SELECT 'questions=' || count(*) FROM questions
  UNION ALL SELECT 'attempts=' || count(*) FROM attempts"
echo "restore complete"
