#!/usr/bin/env bash
# Proves the npm connected-development recipe from scratch.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
export npm_config_cache="$work/npm-cache"
cp -R "$here/library" "$work/library"; cp -R "$here/app" "$work/app"
cd "$work/app"
git init -q && git add -A && git -c user.name=proof -c user.email=proof@example.com commit -qm baseline
sed -i 's/library 1.0.0/library 1.0.0 + local change/' "$work/library/index.js"
mkdir -p .development
printf '{"contract":"vibe64.connected-sources.v1","sessionId":"proof","projects":[{"name":"Library","repository":"https://github.com/example/library","relationship":"dependency","type":"npm","sourceRoot":"%s","contributionId":"proof"}]}\n' "$work/library" > .development/connected.json
node tooling/connected.mjs prepare .development/connected.json
node tooling/connected.mjs prepare .development/connected.json
node tooling/connected.mjs verify .development/connected.json
out="$(node index.js)"; echo "app prints: $out"
[ "$out" = "library 1.0.0 + local change" ] || { echo "FAIL: app did not use the connected source"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "FAIL: tracked files changed:"; git status --porcelain; exit 1; }
echo "PASS npm"
