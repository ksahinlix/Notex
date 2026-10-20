#!/bin/sh
# Runs in the `backup` service of compose.yaml (D28): a pg_dump every night at
# BACKUP_AT, kept for BACKUP_KEEP_DAYS days. Restore one with
#   docker compose exec -T db pg_restore -U notex -d notex --clean --if-exists < backups/notex-....dump
set -u

dump() {
  file="/backups/notex-$(date +%Y%m%dT%H%M%S).dump"
  if pg_dump -Fc -f "$file.part"; then
    mv "$file.part" "$file"
    echo "backup written: $file ($(du -h "$file" | cut -f1))"
  else
    rm -f "$file.part"
    echo "backup FAILED" >&2
  fi
  # Only files this script made, and only once a newer one exists.
  find /backups -name 'notex-*.dump' -mtime +"$BACKUP_KEEP_DAYS" -delete
}

# One right away, so a fresh install has a backup before its first night.
dump
while true; do
  now=$(date +%s)
  next=$(date -d "today $BACKUP_AT" +%s)
  [ "$next" -le "$now" ] && next=$(date -d "tomorrow $BACKUP_AT" +%s)
  sleep $((next - now))
  dump
done
