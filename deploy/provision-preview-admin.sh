#!/usr/bin/env bash
# ARCHIVED: one-evening administrator preview expired on 2026-11-13 21:00 UTC.
# Intentionally refuse before contacting Docker, reading configuration or opening a database.
set -Eeuo pipefail
printf '%s\n' 'ARCHIVED: temporary administrator preview expired on 2026-11-13 21:00 UTC.' 'Use your existing administrator password and the supported test center. For access recovery, see deploy/ADMIN-PREVIEW-ACCESS.md.' >&2
exit 1
