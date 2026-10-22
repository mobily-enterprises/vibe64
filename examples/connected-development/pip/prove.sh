#!/usr/bin/env bash
# Proves the pip and uv connected-development recipes from scratch, offline.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# Caches stay in the throwaway directory; no package index may be used: the
# connected distribution must come from its local checkout only.
export PIP_CACHE_DIR="$work/pip-cache" PIP_NO_INDEX=1 PIP_DISABLE_PIP_VERSION_CHECK=1
export UV_CACHE_DIR="$work/uv-cache" UV_OFFLINE=1 UV_NO_CONFIG=1 PYTHONDONTWRITEBYTECODE=1
cp -R "$here/library" "$work/library"; cp -R "$here/app" "$work/app"
cd "$work/app"
git init -q && git add -A && git -c user.name=proof -c user.email=proof@example.com commit -qm baseline
# Simulate an unpublished local change in the connected checkout.
sed -i 's/"library 1.0.0"/"library 1.0.0 + local change"/' "$work/library/src/acme_library/__init__.py"
mkdir -p .development
printf '{"contract":"vibe64.connected-sources.v1","sessionId":"proof","projects":[{"name":"Library","repository":"https://github.com/example/library","relationship":"dependency","type":"pip","sourceRoot":"%s","contributionId":"proof"}]}\n' "$work/library" > .development/connected.json

installers=(pip)
if command -v uv >/dev/null; then installers+=(uv); else echo "uv not installed: skipping the uv variant"; fi
for installer in "${installers[@]}"; do
  echo "=== installer: $installer"
  rm -rf .venv
  export CONNECTED_PYTHON_INSTALLER="$installer"
  python3 tooling/connected.py prepare .development/connected.json
  python3 tooling/connected.py prepare .development/connected.json
  python3 tooling/connected.py verify .development/connected.json
  out="$(.venv/bin/python app.py)"; echo "app prints: $out"
  [ "$out" = "library 1.0.0 + local change" ] || { echo "FAIL ($installer): app did not use the connected source"; exit 1; }
  [ -z "$(git status --porcelain)" ] || { echo "FAIL ($installer): working tree not clean:"; git status --porcelain; exit 1; }
  echo "PASS $installer"
done
echo "PASS pip"
