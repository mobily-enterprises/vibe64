#!/usr/bin/env bash
# Acceptance proof: a Go consumer builds against an unpublished change in a
# connected library checkout through an untracked go.work, without touching
# its tracked go.mod or go.sum. Needs `go`, `git` and `zip` on PATH. Offline.
set -euo pipefail

FIXTURE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
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

PUBLISHED='library 1.0.0 published'
MODIFIED='library 1.0.0 + unpublished connected change'

say "tools"
go version
git --version

say "publish example.com/library v1.0.0 to a file:// module proxy"
STAGE="$WORK/stage/example.com/library@v1.0.0"
mkdir -p "$STAGE" "$WORK/proxy/example.com/library/@v"
cp -R "$FIXTURE/library/." "$STAGE/"
( cd "$WORK/stage" && zip -qrX "$WORK/proxy/example.com/library/@v/v1.0.0.zip" "example.com/library@v1.0.0" )
cp "$FIXTURE/library/go.mod" "$WORK/proxy/example.com/library/@v/v1.0.0.mod"
printf '{"Version":"v1.0.0","Time":"2026-01-01T00:00:00Z"}\n' > "$WORK/proxy/example.com/library/@v/v1.0.0.info"
printf 'v1.0.0\n' > "$WORK/proxy/example.com/library/@v/list"

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
git -c user.name=proof -c user.email=proof@example.invalid commit -qm "consumer at published library v1.0.0"
git ls-files

say "go offline and forget the published module"
export GOPROXY=off
go clean -modcache
if go build ./... >/dev/null 2>&1; then fail "build succeeded without the module cache or the connection"; fi
echo "without the connection the build cannot obtain example.com/library (expected)"

say "connected library checkout with an unpublished change"
cp -R "$FIXTURE/library" "$WORK/library"
sed -i "s/$PUBLISHED/$MODIFIED/" "$WORK/library/library.go"
grep -q "$MODIFIED" "$WORK/library/library.go" || fail "marker edit did not apply"

mkdir -p .development
cat > .development/connected.json <<JSON
{"contract":"vibe64.connected-sources.v1","sessionId":"proof-session","projects":[
  {"name":"Library","repository":"https://github.com/acme/library","relationship":"dependency","type":"gomod","sourceRoot":"$WORK/library","contributionId":"proof-contribution"}
]}
JSON

say "prepare (first)"
go run ./tooling/connected prepare .development/connected.json
cp go.work "$WORK/go.work.first"
say "prepare (second, must be idempotent)"
go run ./tooling/connected prepare .development/connected.json
cmp -s go.work "$WORK/go.work.first" || fail "second prepare produced a different go.work"
cat go.work

say "verify"
go run ./tooling/connected verify .development/connected.json

say "run the consumer"
out=$(go run .)
echo "output: $out"
[ "$out" = "$MODIFIED" ] || fail "consumer printed '$out', want '$MODIFIED'"

say "tracked files untouched"
status=$(git status --porcelain --untracked-files=all)
[ -z "$status" ] || { echo "$status"; fail "checkout is not clean"; }
git diff --exit-code HEAD -- go.mod go.sum >/dev/null || fail "go.mod or go.sum changed"
echo "git status --porcelain --untracked-files=all: clean (go.work, go.work.sum, .development/ are ignored)"

say "verify must fail without the connection"
mv go.work "$WORK/go.work.saved"
if go run ./tooling/connected verify .development/connected.json 2>"$WORK/neg.err"; then
  fail "verify passed without go.work"
fi
echo "verify refused: $(grep "^connected verify" "$WORK/neg.err" || tail -n1 "$WORK/neg.err")"
mv "$WORK/go.work.saved" go.work

echo
echo "PASS gomod connected development"
