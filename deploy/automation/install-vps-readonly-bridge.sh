#!/usr/bin/env bash
# One-time, idempotent setup run manually in an existing root SSH session.
# Does not restart services, modify the TrakSOS checkout, or change databases.
# REVIEW before use; no secrets are ever printed by this script.
set -Eeuo pipefail
umask 077
[[ "$(id -u)" == "0" ]] || { echo "Use the existing root session." >&2; exit 1; }
command -v curl >/dev/null && command -v ssh-keygen >/dev/null ||
  { echo "curl and ssh-keygen are required." >&2; exit 1; }
key="/root/.ssh/traksos-gh-readonly"
gate="/usr/local/sbin/traksos-github-status"
key_comment="traksos-gh-readonly-20261120"
mkdir -p /root/.ssh /usr/local/sbin
chmod 700 /root/.ssh
temp="$(mktemp)"
trap 'rm -f "$temp"' EXIT
# Exact immutable source commit that contains the reviewed read-only gate.
curl --fail --silent --show-error --location --proto '=https' --tlsv1.2 \
  'https://raw.githubusercontent.com/shipaka/traksos/0e495700966b594fcdddb9e0360653df89a1c49d/deploy/automation/github-vps-readonly-gate.sh' \
  > "$temp"
[[ -s "$temp" ]] || { echo "Bridge download failed." >&2; exit 1; }
install -m 0700 -o root -g root "$temp" "$gate"
if [[ ! -f "$key" ]]; then
  if [[ -e "$key.pub" ]]; then
    echo "Existing public key without private key; manual recovery required." >&2
    exit 1
  fi
  ssh-keygen -q -t ed25519 -N '' -f "$key" -C "$key_comment"
fi
[[ -f "$key.pub" ]] || { echo "Missing SSH public key." >&2; exit 1; }
chmod 600 "$key"
chmod 644 "$key.pub"
authorized="/root/.ssh/authorized_keys"
touch "$authorized"
chmod 600 "$authorized"
line="restrict,command=\"$gate\" $(cat "$key.pub")"
grep -Fqx -- "$line" "$authorized" || printf '%s\n' "$line" >> "$authorized"
echo "VPS_READONLY_BRIDGE=INSTALLED"
echo "VPS_FORCED_KEY=INSTALLED"
echo "NO_PASSWORD_OR_PRIVATE_KEY_PRINTED=true"
echo "NEXT: copy the PRIVATE KEY directly into the GitHub Action secret TRAKSOS_VPS_READONLY_KEY."
echo "Do not post or screenshot the key. Only the owner should copy it."
