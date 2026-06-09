#!/usr/bin/env bash
set -euo pipefail

script_dir="$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd -P)"
template_source="${VIBE64_SYSTEMD_TEMPLATE_SOURCE:-$script_dir/systemd/vibe64@.service}"
unit_path="${VIBE64_SYSTEMD_UNIT_PATH:-/etc/systemd/system/vibe64@.service}"
service_pattern="${VIBE64_SERVICE_PATTERN:-vibe64@*.service}"
gateway_group="${VIBE64_GATEWAY_GROUP:-vibe64}"
caddy_user="${VIBE64_CADDY_USER:-caddy}"

if [ "$(id -u)" -ne 0 ]; then
  echo "[vibe64] Run this script as root." >&2
  exit 1
fi

if [ ! -f "$template_source" ]; then
  echo "[vibe64] Systemd template not found: $template_source" >&2
  exit 1
fi

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[vibe64] systemctl not found." >&2
  exit 1
fi

validate_tenant() {
  local tenant="$1"
  if [[ ! "$tenant" =~ ^[a-z_][a-z0-9_-]*[$]?$ ]]; then
    echo "[vibe64] Invalid tenant name: $tenant" >&2
    exit 1
  fi
}

echo "[vibe64] Installing systemd template:"
echo "[vibe64]   $template_source -> $unit_path"
install -D -m 0644 "$template_source" "$unit_path"

if ! getent group "$gateway_group" >/dev/null 2>&1; then
  echo "[vibe64] Creating gateway group: $gateway_group"
  groupadd --system "$gateway_group"
fi

caddy_membership_changed=0
if id "$caddy_user" >/dev/null 2>&1 && ! id -nG "$caddy_user" | tr " " "\n" | grep -Fx "$gateway_group" >/dev/null; then
  echo "[vibe64] Adding $caddy_user to $gateway_group"
  usermod -aG "$gateway_group" "$caddy_user"
  caddy_membership_changed=1
fi

echo "[vibe64] Reloading systemd"
systemctl daemon-reload

for tenant in "$@"; do
  validate_tenant "$tenant"
  if ! id "$tenant" >/dev/null 2>&1; then
    echo "[vibe64] Tenant Unix user does not exist: $tenant" >&2
    exit 1
  fi
  echo "[vibe64] Enabling tenant service: vibe64@$tenant.service"
  systemctl enable --now "vibe64@$tenant.service"
done

if [ "$caddy_membership_changed" = "1" ] && systemctl is-active --quiet caddy.service; then
  echo "[vibe64] Restarting Caddy so group membership takes effect"
  systemctl restart caddy.service
fi

echo "[vibe64] Matching services:"
systemctl list-units --all "$service_pattern"
