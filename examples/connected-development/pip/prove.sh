#!/usr/bin/env bash
# Proves Vibe64's pip treatment from scratch, offline: the connected checkout is installed editable in the
# session's .venv, in one resolution with the app's tracked requirements, and no tracked file changes.
set -euo pipefail
here="$(cd "$(dirname "$0")" && pwd)"
adapter="$here/../vibe64-adapter.mjs"
save="$here/../vibe64-adapter.mjs"
work="$(mktemp -d)"; trap 'rm -rf "$work"' EXIT
fail() { echo "FAIL: $*"; exit 1; }
# Caches stay in the throwaway directory; no package index may be used: the
# connected distribution must come from its local checkout only.
export PIP_CACHE_DIR="$work/pip-cache" PIP_NO_INDEX=1 PIP_DISABLE_PIP_VERSION_CHECK=1 PYTHONDONTWRITEBYTECODE=1
cp -R "$here/library" "$work/library"; cp -R "$here/app" "$work/app"
cd "$work/app"
git init -q && git add -A && git -c user.name=proof -c user.email=proof@example.com commit -qm baseline
echo "tools: $(python3 --version), $(git --version), node $(node --version)"
# Simulate an unpublished local change in the connected checkout.
sed -i 's/"library 1.0.0"/"library 1.0.0 + local change"/' "$work/library/src/acme_library/__init__.py"
mkdir -p .development
printf '{"schema":"vibe64.connected-sources.v2","sessionId":"proof","repositories":[{"name":"Library","repository":"https://github.com/example/library","relationship":"dependency","type":"pip","sourceRoot":"%s"}]}\n' "$work/library" > .development/connected.json
node "$adapter" apply .development/connected.json
node "$adapter" apply .development/connected.json
node "$adapter" proof .development/connected.json
echo "venv pip: $(.venv/bin/python -m pip --version | cut -d' ' -f1-2)"
out="$(.venv/bin/python app.py)"; echo "app prints: $out"
[ "$out" = "library 1.0.0 + local change" ] || fail "app did not use the connected source"
# An editable install is live: a further edit shows without preparing again.
sed -i 's/+ local change"/+ local change, edited again"/' "$work/library/src/acme_library/__init__.py"
out="$(.venv/bin/python app.py)"; echo "after another edit: $out"
[ "$out" = "library 1.0.0 + local change, edited again" ] || fail "the edit did not reach the app"
[ -z "$(git status --porcelain --untracked-files=all)" ] || { git status --porcelain; fail "working tree not clean"; }

echo "=== the checkout moves past the app's pin (acme-library==1.0.0)"
sed -i 's/^version = "1.0.0"/version = "1.1.0"/' "$work/library/pyproject.toml"
node "$adapter" apply .development/connected.json
node "$adapter" proof .development/connected.json
node "$save" locked .development/connected.json
echo "=== Save before 1.1.0 is published: nothing moves"
export PIP_FIND_LINKS="$work/wheels"; mkdir -p "$work/wheels"
node "$save" bump .development/connected.json
git diff --quiet -- requirements.txt || fail "Save moved the pin to an unpublished version"
echo "=== publish acme-library 1.1.0 (a wheel in the find-links folder), then Save"
cp -R "$work/library" "$work/release"
.venv/bin/python -m pip wheel --quiet --no-deps --wheel-dir "$work/wheels" "$work/release"
ls "$work/wheels"
node "$save" bump .development/connected.json
[ "$(cat requirements.txt)" = "acme-library==1.1.0" ] || fail "Save did not move the pin to the published 1.1.0: $(cat requirements.txt)"
git diff --stat
node "$adapter" proof .development/connected.json
out="$(.venv/bin/python app.py)"; echo "app prints: $out"
[ "$out" = "library 1.0.0 + local change, edited again" ] || fail "the checkout left the session after Save"
git -c user.name=proof -c user.email=proof@example.com commit -qam "Save: published acme-library 1.1.0"
[ -z "$(git status --porcelain --untracked-files=all)" ] || { git status --porcelain; fail "working tree not clean after Save"; }
unset PIP_FIND_LINKS
# Undo the connection: an ordinary (non-editable) install of the same distribution.
.venv/bin/python -m pip install --quiet --force-reinstall --no-deps "$work/library"
if node "$adapter" proof .development/connected.json 2>"$work/refused.log"; then fail "the proof passed with the connection undone"; fi
echo "proof refused: $(tail -n1 "$work/refused.log")"
echo "PASS pip"
