#!/usr/bin/env bash
# Acceptance proof of Vibe64's Cargo treatment: a Cargo consumer builds against an
# unpublished change in a connected library checkout through the untracked
# .cargo/config.toml Vibe64 writes ([patch.crates-io] + resolver.lockfile-path),
# without touching its tracked Cargo.toml or Cargo.lock. Needs cargo/rustc >= 1.97,
# node, git, tar and sha256sum on PATH (rustup users also need RUSTUP_HOME). Offline:
# crates.io is replaced by a local directory source that stands in for the published crate.
set -euo pipefail

FIXTURE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
ADAPTER="$FIXTURE/../vibe64-adapter.mjs"
SAVE="$FIXTURE/../vibe64-bump.mjs"
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
node --version

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
{"schema":"vibe64.connected-sources.v2","sessionId":"proof-session","repositories":[
  {"name":"Library","repository":"https://github.com/acme/library","relationship":"dependency","type":"cargo","sourceRoot":"$WORK/library"}
]}
JSON

say "apply (first)"
node "$ADAPTER" apply .development/connected.json
cp .cargo/config.toml "$WORK/config.first"
cp .development/cargo/Cargo.lock "$WORK/lock.first"
say "apply (second, must be idempotent)"
node "$ADAPTER" apply .development/connected.json
cmp -s .cargo/config.toml "$WORK/config.first" || fail "second apply produced a different .cargo/config.toml"
cmp -s .development/cargo/Cargo.lock "$WORK/lock.first" || fail "second apply produced a different derived lock"
cat .cargo/config.toml
echo "--- tracked Cargo.lock vs derived .development/cargo/Cargo.lock"
diff -u Cargo.lock .development/cargo/Cargo.lock || true

say "proof"
node "$ADAPTER" proof .development/connected.json

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

say "the checkout moves to 1.1.0: the session keeps building it"
sed -i 's/^version = "1.0.0"/version = "1.1.0"/' "$WORK/library/Cargo.toml"
node "$ADAPTER" apply .development/connected.json
node "$ADAPTER" proof .development/connected.json
node "$SAVE" locked .development/connected.json

say "Save before 1.1.0 is published: nothing moves"
node "$SAVE" bump .development/connected.json
git diff --exit-code HEAD -- Cargo.toml Cargo.lock >/dev/null || fail "Save moved to an unpublished version"

say "publish connected-library 1.1.0 to the stand-in registry, then Save"
cp -R "$FIXTURE/library" "$WORK/publish-1.1.0"
sed -i 's/^version = "1.0.0"/version = "1.1.0"/' "$WORK/publish-1.1.0/Cargo.toml"
( cd "$WORK/publish-1.1.0" && cargo package --quiet --no-verify --allow-dirty )
CRATE2="$WORK/publish-1.1.0/target/package/connected-library-1.1.0.crate"
tar -xzf "$CRATE2" -C "$WORK/registry"
printf '{"files":{},"package":"%s"}\n' "$(sha256sum "$CRATE2" | cut -d' ' -f1)" \
  > "$WORK/registry/connected-library-1.1.0/.cargo-checksum.json"
node "$SAVE" bump .development/connected.json
git diff HEAD -- Cargo.lock
git diff --exit-code HEAD -- Cargo.toml >/dev/null || fail "Save changed Cargo.toml although ^1.0.0 admits 1.1.0"
grep -A3 'name = "connected-library"' Cargo.lock | grep -q '^version = "1.1.0"' || fail "the tracked Cargo.lock is not at 1.1.0"
grep -A3 'name = "connected-library"' Cargo.lock | grep -q '^source = "registry+https://github.com/rust-lang/crates.io-index"' ||
  fail "the tracked Cargo.lock does not take 1.1.0 from the registry"
node "$ADAPTER" proof .development/connected.json
out=$(cargo run --quiet --locked)
[ "$out" = "$MODIFIED" ] || fail "after Save the consumer printed '$out'"
echo "after Save the session still builds the checkout: $out"
git -c user.name=proof -c user.email=proof@example.invalid commit -qam "Save: published connected-library 1.1.0"
status=$(git status --porcelain --untracked-files=all)
[ -z "$status" ] || { echo "$status"; fail "checkout is not clean after Save"; }

say "the proof must fail without the connection"
mv .cargo/config.toml "$WORK/config.saved"
if node "$ADAPTER" proof .development/connected.json 2>"$WORK/neg.err"; then
  fail "the proof passed without .cargo/config.toml"
fi
echo "proof refused: $(tail -n1 "$WORK/neg.err")"
mv "$WORK/config.saved" .cargo/config.toml

say "the proof must fail when the patch does not apply"
sed -i 's/^version = "1.1.0"/version = "2.0.0"/' "$WORK/library/Cargo.toml"
if node "$ADAPTER" apply .development/connected.json >"$WORK/neg2.out" 2>"$WORK/neg2.err" &&
   node "$ADAPTER" proof .development/connected.json 2>>"$WORK/neg2.err"; then
  fail "the proof passed with an unusable patch"
fi
echo "refused: $(grep '^connected ' "$WORK/neg2.err" | tail -n1)"
git diff --exit-code HEAD -- Cargo.toml Cargo.lock >/dev/null || fail "Cargo.toml or Cargo.lock changed"

echo
echo "PASS cargo connected development"
