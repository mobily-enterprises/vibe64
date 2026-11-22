#!/usr/bin/env bash
# Proves Vibe64's Composer treatment from scratch, offline: the app's install takes the connected
# checkout in place of the published package, and no tracked file changes.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
adapter="$here/../vibe64-adapter.mjs"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
# Keep Composer's home and cache inside the throwaway directory, and forbid
# network access: the connected package must come from its local path only.
export COMPOSER_HOME="$work/composer-home" COMPOSER_CACHE_DIR="$work/composer-cache"
export COMPOSER_DISABLE_NETWORK=1 COMPOSER_NO_AUDIT=1 COMPOSER_NO_INTERACTION=1
cp -R "$here/library" "$work/library"; cp -R "$here/app" "$work/app"
# The registry Staging and Production install from: a Composer artifact repository (a folder of
# package zips) in place of Packagist, holding the published 1.0.0.
publish() { python3 -c 'import sys, zipfile, pathlib
root = pathlib.Path(sys.argv[1])
with zipfile.ZipFile(sys.argv[2], "w") as archive:
    for file in sorted(root.rglob("*")):
        if file.is_file(): archive.write(file, file.relative_to(root).as_posix())' "$1" "$2"; }
mkdir -p "$work/registry" && publish "$here/library" "$work/registry/acme-library-1.0.0.zip"
cd "$work/app"
node -e 'const fs = require("fs"); const manifest = JSON.parse(fs.readFileSync("composer.json", "utf8"));
manifest.repositories = [{ type: "artifact", url: process.argv[1] }, { "packagist.org": false }];
fs.writeFileSync("composer.json", JSON.stringify(manifest, null, 4) + "\n");' "$work/registry"
git init -q && git add -A && git -c user.name=proof -c user.email=proof@example.com commit -qm baseline
before="$(sha256sum composer.json composer.lock)"
# Simulate an unpublished local change in the connected checkout.
sed -i "s/'library 1.0.0'/'library 1.0.0 + local change'/" "$work/library/src/Marker.php"
mkdir -p .development
printf '{"schema":"vibe64.connected-sources.v2","sessionId":"proof","repositories":[{"name":"Library","repository":"https://github.com/example/library","relationship":"dependency","type":"composer","sourceRoot":"%s"}]}\n' "$work/library" > .development/connected.json
node "$adapter" apply .development/connected.json
node "$adapter" apply .development/connected.json
node "$adapter" proof .development/connected.json
out="$(php bin/app.php)"; echo "app prints: $out"
[ "$out" = "library 1.0.0 + local change" ] || { echo "FAIL: app did not use the connected source"; exit 1; }
[ -L vendor/acme/library ] || { echo "FAIL: vendor/acme/library is not a link to the connected checkout"; exit 1; }
[ "$before" = "$(sha256sum composer.json composer.lock)" ] || { echo "FAIL: tracked composer.json/composer.lock changed"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "FAIL: working tree not clean:"; git status --porcelain; exit 1; }
# Save: the connected copy now declares 1.1.0. Until the registry publishes it, Save moves nothing.
sed -i 's/"version": "1.0.0"/"version": "1.1.0"/' "$work/library/composer.json"
node "$here/../vibe64-adapter.mjs" bump .development/connected.json | tee "$work/bump-unpublished.log"
[ "$before" = "$(sha256sum composer.json composer.lock)" ] || { echo "FAIL: Save moved the project to an unpublished version"; exit 1; }
# Once 1.1.0 is published, Save moves the tracked manifest and lock to exactly it, and the swap holds.
publish "$work/library" "$work/registry/acme-library-1.1.0.zip"
node "$here/../vibe64-adapter.mjs" bump .development/connected.json | tee "$work/bump-published.log"
grep -qx '\[Connected\] Library: Staging and Production now use the published acme/library 1.1.0.' "$work/bump-published.log" || { echo "FAIL: no bump line"; exit 1; }
node -e 'const fs = require("fs"); const manifest = JSON.parse(fs.readFileSync("composer.json", "utf8"));
const locked = JSON.parse(fs.readFileSync("composer.lock", "utf8")).packages.find(entry => entry.name === "acme/library");
if (manifest.require["acme/library"] !== "1.1.0" || locked.version !== "1.1.0" || locked.dist.type !== "zip") process.exit(1);
console.log(`tracked: requires ${manifest.require["acme/library"]}, locks ${locked.version} from the ${locked.dist.type} registry`);' \
  || { echo "FAIL: composer.json/composer.lock do not name the published 1.1.0"; exit 1; }
[ "$(git status --porcelain)" = "$(printf ' M composer.json\n M composer.lock')" ] || { echo "FAIL: Save changed more than composer.json and composer.lock:"; git status --porcelain; exit 1; }
node "$adapter" proof .development/connected.json
[ "$(php bin/app.php)" = "library 1.0.0 + local change" ] || { echo "FAIL: the bump undid the connection"; exit 1; }
# Undo the connection as an ordinary `composer install` would: the published package in place of the link.
rm vendor/acme/library && cp -R "$here/library" vendor/acme/library
if node "$adapter" proof .development/connected.json 2>"$work/refused.log"; then echo "FAIL: the proof passed with the connection undone"; exit 1; fi
echo "proof refused: $(tail -n1 "$work/refused.log")"
echo "PASS composer"
