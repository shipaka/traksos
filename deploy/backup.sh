#!/bin/sh
# Verified, atomic daily PostgreSQL backup; do not treat a failed dump as success.
set -eu
umask 077
mkdir -p /backups
while :; do
  stamp="$(date -u +%F)"
  destination="/backups/traksos-${stamp}.dump"
  temporary="$(mktemp /backups/.traksos-XXXXXX)"
  if pg_dump -h db -U traksos -Fc -f "$temporary" traksos &&
     pg_restore --list "$temporary" >/dev/null 2>&1; then
    mv -f "$temporary" "$destination"
    echo "[backup] verified $destination"
    find /backups -maxdepth 1 -name 'traksos-*.dump' -type f -mtime +14 -delete
  else
    echo "[backup] ERROR: dump or archive verification failed" >&2
    rm -f "$temporary"
  fi
  sleep "${BACKUP_INTERVAL_SECONDS:-86400}"
done
