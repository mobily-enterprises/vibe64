#!/usr/bin/env bash
# Acceptance proof of Vibe64's gomod adapter: a Go consumer builds against an unpublished change in a
# connected library checkout through an untracked go.work, without touching its tracked go.mod or
# go.sum; on Save they move to the checkout's new version tag only once the module proxy has it.
# Needs `go`, `git`, `zip` and `node` (with this repository's packages installed) on PATH. Offline.
set -euo pipefail

FIXTURE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ADAPTER="$FIXTURE/../vibe64-adapter.mjs"
ADAPTERS="$FIXTURE/../../../packages/vibe64-project/src/server/connectedAdapters"
WORK=$(mktemp -d "${TMPDIR:-/tmp}/connected-gomod.XXXXXX")

cleanup() {
  # The module cache is read-only by design; let Go remove it.
  GOMODCACHE="$WORK/modcache" go clean -modcache >/dev/null 2>&1 || true
  rm -rf -- "$WORK"
}
trap cleanup EXIT

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

unset GOWORK GOFLAGS
export GOMODCACHE="$WORK/modcache" GOPATH="$WORK/gopath"
export GOCACHE="${GOCACHE:-$WORK/gocache}"
export GOTOOLCHAIN=local GOSUMDB=off GONOSUMDB= GOPRIVATE= GONOPROXY=
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1
git_q() { git -c user.name=proof -c user.email=proof@example.invalid "$@"; }

PUBLISHED='library 1.0.0 published'
MODIFIED='library 1.0.0 + unpublished connected change'
PUBLISHED_11='library 1.1.0 published'

# Save's step and the disconnection, as Vibe64 runs them: the adapter's locked and bump for each
# connection, and the restore of connections that are gone.
cat > "$WORK/save.mjs" <<'JS'
import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
const [adapters, action, sourcesFile] = process.argv.slice(2);
const sessionSourceRoot = process.cwd();
if (action === "restore") {
  const { restoreDisconnected } = await import(path.join(adapters, "index.js"));
  for (const line of await restoreDisconnected({ repositories: [], sessionSourceRoot })) console.log(line);
  process.exit(0);
}
const { gomodAdapter } = await import(path.join(adapters, "gomod.js"));
const { writeManagedGitExcludes } = await import(path.join(adapters, "../projectEnvironmentFiles.js"));
const { repositories } = JSON.parse(await readFile(sourcesFile, "utf8"));
const connections = repositories.filter(entry => entry.relationship === "dependency" && entry.type === "gomod");
const runCommand = ({ command, args, cwd, timeout, env }) => new Promise(resolve => execFile(command, args,
  { cwd, timeout, env: { ...process.env, ...env } }, (error, stdout, stderr) => resolve(error
    ? { ok: false, stdout, stderr, exitCode: error.code }
    : { ok: true, stdout, stderr, exitCode: 0 })));
for (const connection of connections) {
  const context = {
    connection, connections, sessionSourceRoot, runCommand,
    trees: [sessionSourceRoot, ...connections.map(entry => entry.sourceRoot)],
    writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: "connected gomod packages" })
  };
  console.log(`locked: ${JSON.stringify(await gomodAdapter.locked({ ...context, runCommand: null }))}`);
  const { bumped, lines } = await gomodAdapter.bump(context);
  for (const line of lines) console.log(line);
  console.log(`bumped: ${JSON.stringify(bumped)}`);
}
JS
save() { node "$WORK/save.mjs" "$ADAPTERS" "$@"; }

# publish VERSION DIR: puts DIR's module into the file:// module proxy as example.com/library@VERSION.
publish() {
  local stage="$WORK/stage/example.com/library@$1" at="$WORK/proxy/example.com/library/@v"
  mkdir -p "$stage" "$at"
  if [ -d "$2/.git" ]; then git -C "$2" archive HEAD | tar -x -C "$stage"; else cp -R "$2/." "$stage/"; fi
  ( cd "$WORK/stage" && zip -qrX "$at/$1.zip" "example.com/library@$1" )
  cp "$stage/go.mod" "$at/$1.mod"
  printf '{"Version":"%s","Time":"2026-01-01T00:00:00Z"}\n' "$1" > "$at/$1.info"
  printf '%s\n' "$1" >> "$at/list"
}

say "tools"
go version
git --version
node --version

say "publish example.com/library v1.0.0 to a file:// module proxy"
publish v1.0.0 "$FIXTURE/library"

say "consumer checkout: resolve the published dependency, commit go.mod and go.sum"
cp -R "$FIXTURE/app" "$WORK/app"
cd "$WORK/app"
GOPROXY="file://$WORK/proxy" GOFLAGS=-mod=mod go mod tidy
grep -q '^example.com/library v1.0.0 h1:' go.sum || fail "go.sum did not record the published module"
out=$(GOPROXY="file://$WORK/proxy" go run .)
[ "$out" = "$PUBLISHED" ] || fail "baseline printed '$out'"
echo "baseline output: $out"
git init -q -b main
git add -A
git_q commit -qm "consumer at published library v1.0.0"
git ls-files

say "go offline and forget the published module"
export GOPROXY=off
go clean -modcache
if go build ./... >/dev/null 2>&1; then fail "build succeeded without the module cache or the connection"; fi
echo "without the connection the build cannot obtain example.com/library (expected)"

say "connected library checkout (the session's copy, at its v1.0.0 tag) with an unpublished change"
cp -R "$FIXTURE/library" "$WORK/library"
git -C "$WORK/library" init -q -b main
git -C "$WORK/library" add -A
git_q -C "$WORK/library" commit -qm "library v1.0.0"
git -C "$WORK/library" tag v1.0.0
sed -i "s/$PUBLISHED/$MODIFIED/" "$WORK/library/library.go"
grep -q "$MODIFIED" "$WORK/library/library.go" || fail "marker edit did not apply"

mkdir -p .development
cat > .development/connected.json <<JSON
{"schema":"vibe64.connected-sources.v2","sessionId":"proof-session","repositories":[
  {"name":"Library","repository":"https://github.com/acme/library","relationship":"dependency","type":"gomod","sourceRoot":"$WORK/library"}
]}
JSON

say "apply (first)"
node "$ADAPTER" apply .development/connected.json
cp go.work "$WORK/go.work.first"
say "apply (second, must be idempotent)"
node "$ADAPTER" apply .development/connected.json
cmp -s go.work "$WORK/go.work.first" || fail "second apply produced a different go.work"
cat go.work

say "proof"
node "$ADAPTER" proof .development/connected.json

say "run the consumer"
out=$(go run .)
echo "output: $out"
[ "$out" = "$MODIFIED" ] || fail "consumer printed '$out', want '$MODIFIED'"

say "tracked files untouched (go.work and go.work.sum are kept out of Git by Vibe64, not by .gitignore)"
status=$(git status --porcelain --untracked-files=all)
[ -z "$status" ] || { echo "$status"; fail "checkout is not clean"; }
git diff --exit-code HEAD -- go.mod go.sum >/dev/null || fail "go.mod or go.sum changed"
grep -A4 'connected gomod packages' .git/info/exclude
echo "git status --porcelain --untracked-files=all: clean"

say "the proof must fail without the connection"
mv go.work "$WORK/go.work.saved"
if node "$ADAPTER" proof .development/connected.json 2>"$WORK/neg.err"; then
  fail "the proof passed without go.work"
fi
echo "proof refused: $(tail -n1 "$WORK/neg.err")"
mv "$WORK/go.work.saved" go.work

say "Save: the checkout's new tag v1.1.0 is not published yet, so go.mod stays"
sed -i "s/$MODIFIED/$PUBLISHED_11/" "$WORK/library/library.go"
git_q -C "$WORK/library" commit -qam "library v1.1.0"
git -C "$WORK/library" tag v1.1.0
GOPROXY="file://$WORK/proxy" save bump .development/connected.json | tee "$WORK/save1.log"
grep -q "example.com/library v1.1.0 is not published" "$WORK/save1.log" || fail "an unpublished tag was not reported"
git diff --exit-code HEAD -- go.mod go.sum >/dev/null || fail "go.mod or go.sum moved to an unpublished version"

say "Save once v1.1.0 is published: go.mod and go.sum move to it, and the connection stays in effect"
publish v1.1.0 "$WORK/library"
GOPROXY="file://$WORK/proxy" save bump .development/connected.json | tee "$WORK/save2.log"
grep -q "Staging and Production now use the published example.com/library v1.1.0" "$WORK/save2.log" || fail "no bump reported"
grep -q '^require example.com/library v1.1.0$' go.mod || fail "go.mod does not require v1.1.0"
grep -q '^example.com/library v1.1.0 h1:' go.sum || fail "go.sum has no checksum of v1.1.0"
[ "$(git status --porcelain --untracked-files=all)" = "$(printf ' M go.mod\n M go.sum')" ] || { git status --porcelain; fail "the bump changed more than go.mod and go.sum"; }
node "$ADAPTER" proof .development/connected.json
LIVE='library 1.1.0 + a change after the tag'
sed -i "s/$PUBLISHED_11/$LIVE/" "$WORK/library/library.go"
out=$(go run .)
[ "$out" = "$LIVE" ] || fail "connected consumer printed '$out', want '$LIVE'"
out=$(GOWORK=off GOPROXY="file://$WORK/proxy" go run .)
echo "Staging's view (GOWORK=off, published modules only): $out"
[ "$out" = "$PUBLISHED_11" ] || fail "the tracked go.mod built '$out', want '$PUBLISHED_11'"
GOPROXY="file://$WORK/proxy" save bump .development/connected.json > "$WORK/save3.log"
grep -q '^bumped: \[\]$' "$WORK/save3.log" || fail "a second Save bumped again"

say "disconnect: Vibe64's restore removes go.work"
save restore
[ ! -e go.work ] || fail "go.work is still there"
out=$(go run .)
echo "disconnected output: $out"
[ "$out" = "$PUBLISHED_11" ] || fail "the disconnected consumer printed '$out'"
[ "$(git status --porcelain --untracked-files=all)" = "$(printf ' M go.mod\n M go.sum')" ] || { git status --porcelain; fail "restore left files behind"; }

echo
echo "PASS gomod connected development"
