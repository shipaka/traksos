#!/usr/bin/env bash
# TrackSOS: read-only release readiness diagnostics, safe to share as a screenshot.
# No passwords, access tokens, ADMIN_PHONES or SMS codes are printed.
# Usage: cd /root/traksos/deploy && bash ./doctor.sh
set -u
cd "$(dirname "$0")" || exit 1
warn=0
pass() { printf 'OK: %s\n' "$1"; }
flag() { printf 'ACTION: %s\n' "$1"; warn=$((warn + 1)); }
info() { printf 'INFO: %s\n' "$1"; }
command -v docker >/dev/null 2>&1 || { flag "Docker is missing"; exit 1; }
docker compose version >/dev/null 2>&1 || { flag "Docker Compose is missing"; exit 1; }
[[ -f .env ]] || { flag "deploy/.env is missing"; exit 1; }
[[ -f Caddyfile ]] || flag "Caddyfile is missing"
info "TrackSOS pre-launch health (no secrets shown)"
if docker compose config --quiet >/dev/null 2>&1; then pass "Compose configuration parses"; else flag "Compose configuration invalid"; fi
for service in app db caddy backup; do
  container="$(docker compose ps -q "$service" 2>/dev/null || true)"
  if [[ -z "$container" ]]; then flag "$service container not found"; continue; fi
  status="$(docker inspect --format '{{.State.Status}}' "$container" 2>/dev/null || true)"
  if [[ "$status" == running ]]; then pass "$service is running"; else flag "$service is not running"; fi
done

# Only fixed keys are read from the internal environment. Values are never printed.
app="$(docker compose ps -q app 2>/dev/null || true)"
if [[ -n "$app" ]]; then
  env_result="$(docker exec "$app" sh -c '
    if [ "$NODE_ENV" = production ]; then echo prod_ok; else echo prod_bad; fi
    if [ -n "$ADMIN_PHONES" ]; then echo admin_configured; else echo admin_missing; fi
    case "$SMS_PROVIDER" in smsru) echo sms_real ;; log) echo sms_demo ;; *) echo sms_unknown ;; esac
    case "$PAYMENT_PROVIDER" in mock) echo payments_demo ;; yookassa) echo payments_real ;; *) echo payments_unknown ;; esac
  ' 2>/dev/null || true)"
  [[ "$env_result" == *prod_ok* ]] && pass "Production mode" || flag "NODE_ENV is not production"
  [[ "$env_result" == *admin_configured* ]] && pass "Admin phone list configured (value hidden)" || flag "ADMIN_PHONES missing"
  [[ "$env_result" == *sms_real* ]] && pass "SMS provider selected: SMS.ru" || flag "SMS provider is not SMS.ru; registration and password recovery are not ready for public use"
  [[ "$env_result" == *payments_real* ]] && info "Real payments configured; verify legal/financial rollout approval" || info "Payments are not in live mode"
fi

# Database query returns counts only, not personal data. No DB password is read or printed.
db="$(docker compose ps -q db 2>/dev/null || true)"
if [[ -n "$db" ]]; then
  sql="select count(*)::text || ',' || count(*) filter (where 'admin'=any(roles))::text || ',' || count(*) filter (where 'admin'=any(roles) and password_hash is not null)::text from users;"
  totals="$(docker exec "$db" sh -c 'psql -XAtq -U "$POSTGRES_USER" -d "$POSTGRES_DB" -c "$1"' sh "$sql" 2>/dev/null || true)"
  if [[ "$totals" =~ ^[0-9]+,[0-9]+,[0-9]+$ ]]; then
    info "Registered accounts: ${totals%%,*}"
    admin_count="${totals#*,}"; admin_count="${admin_count%%,*}"
    password_count="${totals##*,}"
    if (( admin_count > 0 )); then pass "Admin account exists"; else flag "No admin account yet; first admin must be provisioned securely"; fi
    if (( password_count > 0 )); then pass "Admin password hash is present (login not attempted)"; else flag "No admin account with password; login is not ready"; fi
  else
    flag "Unable to read user/admin counts from database"
  fi
fi

# Backup dump check is metadata-only. Backups are never restored or modified.
if [[ -d backups ]] && find backups -maxdepth 1 -type f -name '*.dump' -size +0c -print -quit 2>/dev/null | grep -q .; then
  pass "At least one nonempty PostgreSQL .dump exists"
  if find backups -maxdepth 1 -type f -name '*.dump' -size +0c -mmin -2880 -print -quit 2>/dev/null | grep -q .; then
    pass "A nonempty .dump was created within the last 48 hours"
  else
    flag "Backups appear older than 48 hours"
  fi
  # Validate only the format/index of the latest dump; do not expose its contents.
  latest="$(find backups -maxdepth 1 -type f -name '*.dump' -size +0c -printf '%T@ %p\n' 2>/dev/null | sort -nr | head -n 1 | cut -d' ' -f2-)"
  if [[ -n "$(docker compose ps -q backup 2>/dev/null || true)" ]]; then
    if docker compose exec -T backup pg_restore --list "/backups/$(basename "$latest")" >/dev/null 2>&1; then
      pass "Latest .dump archive catalog can be read in backup container"
    else
      flag "Latest .dump catalog cannot be read by backup container"
    fi
  elif command -v pg_restore >/dev/null 2>&1; then
    if pg_restore --list "$latest" >/dev/null 2>&1; then
      pass "Latest .dump archive catalog can be read"
    else
      flag "Latest .dump catalog cannot be read"
    fi
  else
    flag "No pg_restore available to validate backup archive"
  fi
else
  flag "No nonempty local .dump backup found"
fi
# HTTPS check uses only a fixed domain from the public config.
domain="$(sed -n 's/^DOMAIN=//p' .env | tail -n 1 | tr -d '\r')"
if [[ "$domain" =~ ^[A-Za-z0-9.-]+$ ]] && command -v curl >/dev/null 2>&1; then
  code="$(curl -sS -o /dev/null --max-time 12 -w '%{http_code}' "https://$domain/api/health" 2>/dev/null || true)"
  if [[ "$code" == 200 ]]; then pass "HTTPS health endpoint responds 200"; else flag "HTTPS health endpoint not ready (HTTP ${code:-unavailable})"; fi
else
  flag "Domain not available for HTTPS check"
fi
info "Checks needing a real device/provider: SMS delivery, RuStore push, payment approval, backup restore."
info "Summary: $warn action item(s). This script made NO configuration or data changes."
# Diagnostic issues are reported but do not cause production mutations.
exit 0
