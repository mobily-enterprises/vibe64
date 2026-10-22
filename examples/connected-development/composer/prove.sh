#!/usr/bin/env bash
# Proves the Composer connected-development recipe from scratch, offline.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# Keep Composer's home and cache inside the throwaway directory, and forbid
# network access: the connected package must come from its local path only.
export COMPOSER_HOME="$work/composer-home" COMPOSER_CACHE_DIR="$work/composer-cache"
export COMPOSER_DISABLE_NETWORK=1 COMPOSER_NO_AUDIT=1 COMPOSER_NO_INTERACTION=1
cp -R "$here/library" "$work/library"; cp -R "$here/app" "$work/app"
cd "$work/app"
git init -q && git add -A && git -c user.name=proof -c user.email=proof@example.com commit -qm baseline
before="$(sha256sum composer.json composer.lock)"
# Simulate an unpublished local change in the connected checkout.
sed -i "s/'library 1.0.0'/'library 1.0.0 + local change'/" "$work/library/src/Marker.php"
mkdir -p .development
printf '{"contract":"vibe64.connected-sources.v1","sessionId":"proof","projects":[{"name":"Library","repository":"https://github.com/example/library","relationship":"dependency","type":"composer","sourceRoot":"%s","contributionId":"proof"}]}\n' "$work/library" > .development/connected.json
php tooling/connected.php prepare .development/connected.json
php tooling/connected.php prepare .development/connected.json
php tooling/connected.php verify .development/connected.json
out="$(php bin/app.php)"; echo "app prints: $out"
[ "$out" = "library 1.0.0 + local change" ] || { echo "FAIL: app did not use the connected source"; exit 1; }
[ "$before" = "$(sha256sum composer.json composer.lock)" ] || { echo "FAIL: tracked composer.json/composer.lock changed"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "FAIL: working tree not clean:"; git status --porcelain; exit 1; }
echo "PASS composer"
