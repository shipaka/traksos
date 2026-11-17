#!/usr/bin/env bash
# One-time TrackSOS read-only monitor installation. Review before running.
# Run ONLY as root on the approved TrackSOS VPS after merging this change.
# Does not touch Docker containers, environments, databases or the running site.
set -Eeuo pipefail
umask 077
export PATH=/usr/sbin:/usr/bin:/sbin:/bin

[[ "$(id -u)" == 0 ]] || { echo "ERROR: run as root on the VPS" >&2; exit 1; }
src="/root/traksos/deploy/automation/health-report.sh"
dest="/usr/local/sbin/traksos-health-report"
monitor="traksos-monitor"
priv="/root/.ssh/traksos-monitor-actions"
authorized="/home/$monitor/.ssh/authorized_keys"
sudoers="/etc/sudoers.d/traksos-monitor"

for executable in useradd install ssh-keygen visudo; do
  command -v "$executable" >/dev/null || { echo "ERROR: $executable not installed" >&2; exit 1; }
done
[[ -f "$src" ]] || { echo "ERROR: missing reviewed script at $src; merge PR first" >&2; exit 1; }
[[ ! -L "$src" ]] || { echo "ERROR: source script is a symlink" >&2; exit 1; }
[[ -x /bin/bash ]] || { echo "ERROR: bash missing" >&2; exit 1; }

# Install the fixed command under root ownership outside writable repo.
install -o root -g root -m 0755 "$src" "$dest"
if ! id "$monitor" >/dev/null 2>&1; then
  useradd --create-home --user-group --shell /bin/sh "$monitor"
fi
# Lock password; use only an SSH key with a forced, restricted command.
passwd -l "$monitor" >/dev/null
install -d -o root -g root -m 0700 /root/.ssh
if [[ ! -f "$priv" && ! -f "$priv.pub" ]]; then
  ssh-keygen -q -t ed25519 -N '' -C 'traksos-monitor-github-actions' -f "$priv"
fi
[[ -s "$priv" && -s "$priv.pub" ]] || { echo "ERROR: incomplete SSH key pair; investigate manually" >&2; exit 1; }
chmod 0600 "$priv"
chmod 0644 "$priv.pub"

tmp="$(mktemp /etc/sudoers.d/.traksos-monitor.XXXXXX)"
trap 'rm -f "$tmp"' EXIT
printf '%s\n' "$monitor ALL=(root) NOPASSWD: $dest" > "$tmp"
chmod 0440 "$tmp"
visudo -cf "$tmp" >/dev/null
install -o root -g root -m 0440 "$tmp" "$sudoers"

install -d -o "$monitor" -g "$monitor" -m 0700 "/home/$monitor/.ssh"
touch "$authorized"
chown "$monitor:$monitor" "$authorized"
chmod 0600 "$authorized"
public="$(cat "$priv.pub")"
line="restrict,command=\"sudo -n $dest\" $public"
if ! grep -Fxq -- "$line" "$authorized"; then
  printf '%s\n' "$line" >> "$authorized"
fi
chown "$monitor:$monitor" "$authorized"
chmod 0600 "$authorized"

echo "OK: restricted SSH monitor installed; no Docker or site changes."
echo "NEXT: set these GitHub Actions secrets yourself (NEVER send to chat):"
echo "  TRAKSOS_MONITOR_HOST = VPS hostname or IP from Termius"
echo "  TRAKSOS_MONITOR_PORT = SSH port (usually 22)"
echo "  TRAKSOS_MONITOR_PRIVATE_KEY = contents of $priv (private key; copy only into GitHub secret)"
echo "  TRAKSOS_MONITOR_KNOWN_HOSTS = verified VPS public SSH host key (not the client key above)"
echo "Server SSH ED25519 host key fingerprint (compare from trusted console):"
if [[ -f /etc/ssh/ssh_host_ed25519_key.pub ]]; then
  ssh-keygen -lf /etc/ssh/ssh_host_ed25519_key.pub
else
  echo "WARNING: ED25519 host key unavailable; verify whichever server key SSH actually presents."
fi
echo "Remember: until GitHub secrets are added, remote checks are NOT enabled."
