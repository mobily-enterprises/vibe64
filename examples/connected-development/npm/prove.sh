#!/usr/bin/env bash
# Proves Vibe64's npm treatment from scratch: the connected checkout takes the place of the installed
# package, exactly as npm would publish it, and no tracked file changes.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
adapter="$here/../vibe64-adapter.mjs"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
export npm_config_cache="$work/npm-cache"
cp -R "$here/library" "$work/library"; cp -R "$here/app" "$work/app"
cd "$work/app"
git init -q && git add -A && git -c user.name=proof -c user.email=proof@example.com commit -qm baseline
# The published 1.0.0, installed as npm installs it from a registry: a copy, not a link.
( cd "$work/library" && npm pack --silent --offline --pack-destination "$work" >/dev/null )
mkdir -p node_modules/@example/library
tar -xzf "$work/example-library-1.0.0.tgz" -C node_modules/@example/library --strip-components=1
[ "$(node index.js)" = "library 1.0.0" ] || { echo "FAIL: the published copy is not installed"; exit 1; }
sed -i 's/library 1.0.0/library 1.0.0 + local change/' "$work/library/index.js"
echo "Not published." > "$work/library/notes.md"
mkdir -p .development
printf '{"schema":"vibe64.connected-sources.v2","sessionId":"proof","repositories":[{"name":"Library","repository":"https://github.com/example/library","relationship":"dependency","type":"npm","sourceRoot":"%s"}]}\n' "$work/library" > .development/connected.json
node "$adapter" apply .development/connected.json
node "$adapter" apply .development/connected.json
node "$adapter" proof .development/connected.json
out="$(node index.js)"; echo "app prints: $out"
[ "$out" = "library 1.0.0 + local change" ] || { echo "FAIL: app did not use the connected source"; exit 1; }
[ ! -L node_modules/@example/library ] || { echo "FAIL: the installed package is a link"; exit 1; }
[ ! -e node_modules/@example/library/notes.md ] || { echo "FAIL: a file npm does not publish was copied"; exit 1; }
[ -z "$(git status --porcelain)" ] || { echo "FAIL: tracked files changed:"; git status --porcelain; exit 1; }
echo "export const marker = 'published again';" > node_modules/@example/library/index.js
if node "$adapter" proof .development/connected.json 2>"$work/refused.log"; then echo "FAIL: the proof passed with the swap undone"; exit 1; fi
echo "proof refused: $(tail -n1 "$work/refused.log")"
echo "PASS npm"
