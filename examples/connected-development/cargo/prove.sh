#!/usr/bin/env bash
# Acceptance proof: a Cargo consumer builds against an unpublished change in a
# connected library checkout through an untracked .cargo/config.toml
# ([patch.crates-io] + resolver.lockfile-path), without touching its tracked
# Cargo.toml or Cargo.lock. Needs cargo/rustc >= 1.97, git, tar and sha256sum
# on PATH (rustup users also need RUSTUP_HOME). Offline: crates.io is replaced
# by a local directory source that stands in for the published crate.
set -euo pipefail

FIXTURE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
WORK=$(mktemp -d "${TMPDIR:-/tmp}/connected-cargo.XXXXXX")
trap 'rm -rf -- "$WORK"' EXIT

say() { printf '\n== %s\n' "$*"; }
fail() { printf 'FAIL: %s\n' "$*" >&2; exit 1; }

export CARGO_NET_OFFLINE=true CARGO_TERM_COLOR=never CARGO_TARGET_DIR=
unset CARGO_TARGET_DIR CARGO_RESOLVER_LOCKFILE_PATH
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

PUBLISHED='library 1.0.0 published'
MODIFIED='library 1.0.0 + unpublished connected change'

say "tools"
cargo --version
rustc --version
git --version

say "publish connected-library 1.0.0 to a local stand-in for crates.io"
cp -R "$FIXTURE/library" "$WORK/publish"
( cd "$WORK/publish" && cargo package --quiet --no-verify --allow-dirty )
CRATE="$WORK/publish/target/package/connected-library-1.0.0.crate"
mkdir -p "$WORK/registry"
tar -xzf "$CRATE" -C "$WORK/registry"
printf '{"files":{},"package":"%s"}\n' "$(sha256sum "$CRATE" | cut -d' ' -f1)" \
  > "$WORK/registry/connected-library-1.0.0/.cargo-checksum.json"
# Outside the consumer checkout, like a user-level mirror configuration.
mkdir -p "$WORK/.cargo"
cat > "$WORK/.cargo/config.toml" <<TOML
[source.crates-io]
replace-with = "published-fixture"

[source.published-fixture]
directory = "$WORK/registry"
TOML

say "consumer checkout: resolve the published dependency, commit Cargo.toml and Cargo.lock"
cp -R "$FIXTURE/app" "$WORK/app"
cd "$WORK/app"
cargo generate-lockfile --quiet
grep -A3 'name = "connected-library"' Cargo.lock
grep -q '^source = "registry+https://github.com/rust-lang/crates.io-index"' Cargo.lock || fail "Cargo.lock does not record the crates.io package"
out=$(cargo run --quiet --locked)
[ "$out" = "$PUBLISHED" ] || fail "baseline printed '$out'"
echo "baseline output: $out"
git init -q -b main
git add -A
git -c user.name=proof -c user.email=proof@example.invalid commit -qm "consumer at published connected-library 1.0.0"
git ls-files
cargo clean --quiet

say "forget the published crate"
rm -rf "$WORK/registry/connected-library-1.0.0"
if cargo build --quiet --locked >/dev/null 2>&1; then fail "build succeeded without the published crate or the connection"; fi
echo "without the connection the build cannot obtain connected-library (expected)"

say "connected library checkout with an unpublished change"
cp -R "$FIXTURE/library" "$WORK/library"
sed -i "s/$PUBLISHED/$MODIFIED/" "$WORK/library/src/lib.rs"
grep -q "$MODIFIED" "$WORK/library/src/lib.rs" || fail "marker edit did not apply"

mkdir -p .development
cat > .development/connected.json <<JSON
{"contract":"vibe64.connected-sources.v1","sessionId":"proof-session","projects":[
  {"name":"Library","repository":"https://github.com/acme/library","relationship":"dependency","type":"cargo","sourceRoot":"$WORK/library","contributionId":"proof-contribution"}
]}
JSON

say "prepare (first)"
sh tooling/connected.sh prepare .development/connected.json
cp .cargo/config.toml "$WORK/config.first"
cp .development/cargo/Cargo.lock "$WORK/lock.first"
say "prepare (second, must be idempotent)"
sh tooling/connected.sh prepare .development/connected.json
cmp -s .cargo/config.toml "$WORK/config.first" || fail "second prepare produced a different .cargo/config.toml"
cmp -s .development/cargo/Cargo.lock "$WORK/lock.first" || fail "second prepare produced a different derived lock"
cat .cargo/config.toml
echo "--- tracked Cargo.lock vs derived .development/cargo/Cargo.lock"
diff -u Cargo.lock .development/cargo/Cargo.lock || true

say "verify"
sh tooling/connected.sh verify .development/connected.json

say "run the consumer"
out=$(cargo run --quiet --locked)
echo "output: $out"
[ "$out" = "$MODIFIED" ] || fail "consumer printed '$out', want '$MODIFIED'"

say "edit the connected checkout again: the path patch rebuilds it"
sed -i "s/$MODIFIED/$MODIFIED, edited again/" "$WORK/library/src/lib.rs"
out=$(cargo run --quiet --locked)
[ "$out" = "$MODIFIED, edited again" ] || fail "rebuild printed '$out'"
echo "output: $out"
sed -i "s/$MODIFIED, edited again/$MODIFIED/" "$WORK/library/src/lib.rs"

say "tracked files untouched"
status=$(git status --porcelain --untracked-files=all)
[ -z "$status" ] || { echo "$status"; fail "checkout is not clean"; }
git diff --exit-code HEAD -- Cargo.toml Cargo.lock >/dev/null || fail "Cargo.toml or Cargo.lock changed"
echo "git status --porcelain --untracked-files=all: clean (.cargo/config.toml, .development/, target/ are ignored)"

say "verify must fail without the connection"
mv .cargo/config.toml "$WORK/config.saved"
if sh tooling/connected.sh verify .development/connected.json 2>"$WORK/neg.err"; then
  fail "verify passed without .cargo/config.toml"
fi
echo "verify refused: $(grep '^connected verify' "$WORK/neg.err" || tail -n1 "$WORK/neg.err")"
mv "$WORK/config.saved" .cargo/config.toml

say "verify must fail when the patch does not apply"
sed -i 's/^version = "1.0.0"/version = "2.0.0"/' "$WORK/library/Cargo.toml"
if sh tooling/connected.sh prepare .development/connected.json >/dev/null 2>&1 &&
   sh tooling/connected.sh verify .development/connected.json 2>"$WORK/neg2.err"; then
  fail "verify passed with an unusable patch"
fi
echo "verify refused: $(grep '^connected ' "$WORK/neg2.err" 2>/dev/null || echo 'prepare refused the mismatched version')"
git diff --exit-code HEAD -- Cargo.toml Cargo.lock >/dev/null || fail "Cargo.toml or Cargo.lock changed"

echo
echo "PASS cargo connected development"
