#!/usr/bin/env bash
# Proves Vibe64 custom connected development for a CMake FetchContent dependency.
# Offline: the "published" library is a local Git repository, and the connected
# checkout is consumed through FETCHCONTENT_SOURCE_DIR_EXAMPLE_LIBRARY.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
work="$(mktemp -d "${TMPDIR:-/tmp}/connected-cmake-proof.XXXXXX")"
trap 'rm -rf "$work"' EXIT
step() { printf '\n== %s\n' "$*"; }
fail() { echo "PROOF FAILED: $*" >&2; exit 1; }
git_q() { git -c user.name=proof -c user.email=proof@example.invalid -c init.defaultBranch=main -c advice.detachedHead=false "$@"; }

repository="https://github.com/acme/example-library"
original="example-library-marker:original"
modified="example-library-marker:connected-$$-$RANDOM"

step "copy fixtures to $work"
cp -R "$here/library" "$work/library-origin"   # stands in for the pinned remote
cp -R "$here/library" "$work/library"          # the connected checkout
cp -R "$here/app" "$work/app"
app="$work/app"

step "publish library v1.0.0 to a local Git remote"
git_q -C "$work/library-origin" init -q
git_q -C "$work/library-origin" add -A
git_q -C "$work/library-origin" commit -q -m "Example Library 1.0.0"
git_q -C "$work/library-origin" tag v1.0.0

step "commit the consuming app"
git_q -C "$app" init -q
git_q -C "$app" add -A
git_q -C "$app" commit -q -m "Example app"

step "baseline build uses the pinned tag"
cmake -S "$app" -B "$app/build/baseline" \
  "-DEXAMPLE_LIBRARY_GIT_REPOSITORY=file://$work/library-origin" >/dev/null
cmake --build "$app/build/baseline" >/dev/null
out="$("$app/build/baseline/app")"; echo "baseline prints: $out"
[[ "$out" == "$original" ]] || fail "baseline printed '$out'"

step "modify the connected checkout's marker"
sed -i "s/$original/$modified/" "$work/library/src/library.cpp"
grep -q "$modified" "$work/library/src/library.cpp" || fail "marker edit failed"

step "write the sources map"
mkdir -p "$app/.development"
sources="$app/.development/connected.json"
cat > "$sources" <<JSON
{"contract":"vibe64.connected-sources.v1","sessionId":"proof-session","projects":[
  {"name":"Example Library","repository":"$repository","relationship":"dependency","type":"custom","sourceRoot":"$work/library","contributionId":"proof-contribution"}
]}
JSON

# Exactly as Vibe64 runs a custom connection: <runner argv> <abs script> args...
run_phase() {
  (cd "$app" && bash "$app/tooling/connected-cmake.sh" --phase "$1" \
    --source-root "$2" --project-root "$app" --sources-file "$sources" \
    --repository "$repository")
}

step "prepare (1st)"; run_phase prepare "$work/library"
step "prepare (2nd, idempotent)"; run_phase prepare "$work/library"
step "verify"; run_phase verify "$work/library"

step "verify must reject a build tree that is not using the claimed checkout"
if run_phase verify "$work/library-origin" 2>"$work/refusal.log"; then fail "verify accepted the wrong source root"; fi
cat "$work/refusal.log"
echo "verify correctly refused the wrong source root"

step "connected build prints the modified marker"
cmake --build "$app/.development/connected/build" >/dev/null
out="$("$app/.development/connected/build/app")"; echo "connected prints: $out"
[[ "$out" == "$modified" ]] || fail "connected app printed '$out'"

step "live edit in the connected checkout is picked up without re-prepare"
live="$modified-live"
sed -i "s/$modified/$live/" "$work/library/src/library.cpp"
cmake --build "$app/.development/connected/build" >/dev/null
out="$("$app/.development/connected/build/app")"; echo "connected prints: $out"
[[ "$out" == "$live" ]] || fail "live edit not picked up: '$out'"

step "tracked files of the consuming app are untouched"
status="$(git -C "$app" status --porcelain)"
[[ -z "$status" ]] || fail "git status not clean:"$'\n'"$status"
git -C "$app" diff --quiet HEAD -- CMakeLists.txt || fail "CMakeLists.txt changed"
echo "git status --porcelain: clean"

printf '\nPROOF PASSED: custom-cmake connected development\n'
