#!/usr/bin/env bash
# Archived one-evening owner preview: never issue a new code or access Docker/DB.
set -Eeuo pipefail
printf '%s\n' 'ARCHIVED: temporary administrator preview expired on 2026-11-13 at 21:00 UTC.' \
  'Use an existing administrator account via the normal login. This script cannot recover an account.' \
  'See deploy/ADMIN-PREVIEW-ACCESS.md for the current supported path.' >&2
exit 1
