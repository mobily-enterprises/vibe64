#!/usr/bin/env bash
set -euo pipefail

install_root="${VIBE64_INSTALL_ROOT:-/opt/vibe64}"
repo_url="${VIBE64_REPO_URL:-https://github.com/mobily-enterprises/vibe64.git}"
repo_branch="${VIBE64_REPO_BRANCH:-main}"
service_pattern="${VIBE64_SERVICE_PATTERN:-vibe64@*.service}"
restart_services="${VIBE64_RESTART_SERVICES:-1}"

releases_dir="$install_root/releases"
current_link="$install_root/current"

mkdir -p "$releases_dir"

tmp="$(mktemp -d "$releases_dir/.new.XXXXXX")"
cleanup() {
  if [ -n "${tmp:-}" ] && [ -d "$tmp" ]; then
    rm -rf "$tmp"
  fi
}
trap cleanup EXIT

echo "[vibe64] Cloning $repo_url branch $repo_branch"
git clone --branch "$repo_branch" --single-branch "$repo_url" "$tmp"

cd "$tmp"
echo "[vibe64] Installing dependencies"
npm ci

echo "[vibe64] Building production assets"
npm run build

echo "[vibe64] Pulling managed toolchain images"
npm run host:pull-toolchain-images

short="$(git rev-parse --short HEAD)"
release="$releases_dir/$(date -u +%Y%m%d%H%M%S)-$short"

cd "$install_root"
mv "$tmp" "$release"
tmp=""
ln -sfn "$release" "$current_link"

echo "[vibe64] Current release:"
readlink -f "$current_link"

if ! command -v systemctl >/dev/null 2>&1; then
  echo "[vibe64] systemctl not found; skipping service restart."
  exit 0
fi

echo "[vibe64] Matching services:"
systemctl list-units --all "$service_pattern"

if [ "$restart_services" = "0" ]; then
  echo "[vibe64] VIBE64_RESTART_SERVICES=0; skipping service restart."
  exit 0
fi

mapfile -t services < <(
  systemctl list-units --all --plain --no-legend "$service_pattern" | awk '{print $1}'
)

if [ "${#services[@]}" -eq 0 ]; then
  echo "[vibe64] No services matched $service_pattern; nothing to restart."
  exit 0
fi

echo "[vibe64] Restarting services: ${services[*]}"
systemctl restart "${services[@]}"
