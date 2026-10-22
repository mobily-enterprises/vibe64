#!/usr/bin/env bash
# Proves Vibe64 connected development for a NuGet PackageReference, offline.
# Requires `dotnet` (SDK 10) on PATH or DOTNET_ROOT. The NuGet global packages
# folder is isolated per run, so nothing reaches the caller's cache.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
if ! command -v dotnet >/dev/null && [[ -n "${DOTNET_ROOT:-}" ]]; then PATH="$DOTNET_ROOT:$PATH"; fi
command -v dotnet >/dev/null || { echo "dotnet SDK not found (set PATH or DOTNET_ROOT)" >&2; exit 1; }
work="$(mktemp -d "${TMPDIR:-/tmp}/connected-nuget-proof.XXXXXX")"
trap 'dotnet build-server shutdown >/dev/null 2>&1 || true; rm -rf "$work"' EXIT
export DOTNET_CLI_TELEMETRY_OPTOUT=1 DOTNET_NOLOGO=1 DOTNET_SKIP_FIRST_TIME_EXPERIENCE=1
export DOTNET_CLI_HOME="${DOTNET_CLI_HOME:-$work/dotnet-home}"
export NUGET_PACKAGES="$work/nuget-packages"
export MSBUILDDISABLENODEREUSE=1   # no lingering build servers after the proof
export DOTNET_CLI_USE_MSBUILD_SERVER=0
export UseSharedCompilation=false  # no lingering Roslyn compiler server

step() { printf '\n== %s\n' "$*"; }
fail() { echo "PROOF FAILED: $*" >&2; exit 1; }
git_q() { git -c user.name=proof -c user.email=proof@example.invalid -c init.defaultBranch=main "$@"; }
dotnet --version

original="example-library-marker:original"
modified="example-library-marker:connected-$$-$RANDOM"

step "copy fixtures to $work"
cp -R "$here/library" "$work/library-published"   # source of the published 1.0.0
cp -R "$here/library" "$work/library"             # the connected checkout
cp -R "$here/app" "$work/app"
app="$work/app"

step "publish Example.Library 1.0.0 to the fixture feed (stands in for nuget.org)"
dotnet pack "$work/library-published" -c Release -o "$work/published-feed" -nologo -v:q >/dev/null
ls "$work/published-feed"

step "baseline restore creates the tracked lock file; commit the app"
dotnet restore "$app/src/App" -nologo -v:q >/dev/null
[[ -f "$app/src/App/packages.lock.json" ]] || fail "no packages.lock.json"
git_q -C "$app" init -q
git_q -C "$app" add -A
git_q -C "$app" commit -q -m "Example app with lock file"
git -C "$app" ls-files

step "baseline (locked mode) prints the published marker"
dotnet restore "$app/src/App" --locked-mode -nologo -v:q >/dev/null
out="$(dotnet run --project "$app/src/App" --no-restore)"; echo "baseline prints: $out"
[[ "$out" == "$original" ]] || fail "baseline printed '$out'"
cache_nupkg="$NUGET_PACKAGES/example.library/1.0.0/example.library.1.0.0.nupkg"
cache_before="$(sha256sum "$cache_nupkg")"

step "modify the connected checkout's marker"
sed -i "s/$original/$modified/" "$work/library/Marker.cs"
grep -q "$modified" "$work/library/Marker.cs" || fail "marker edit failed"

step "write the sources map"
mkdir -p "$app/.development"
cat > "$app/.development/connected.json" <<JSON
{"contract":"vibe64.connected-sources.v1","sessionId":"proof-session","projects":[
  {"name":"Example Library","repository":"https://github.com/acme/example-library","relationship":"dependency","type":"nuget","sourceRoot":"$work/library","contributionId":"proof-contribution"}
]}
JSON

# The commands declared in app/genesis/stack.md, run from the consumer checkout.
connected() { (cd "$app" && dotnet run --project tooling/Connected -- "$1" .development/connected.json); }

step "prepare (1st)"; connected prepare
step "prepare (2nd, idempotent)"; connected prepare
step "verify"; connected verify

step "verify must reject a checkout that is not wired to the connected source"
# Deactivate the generated wiring but leave the file in place: a build now
# succeeds against the published package, and verify must still refuse it.
cp "$app/src/App/Directory.Build.targets" "$work/held.targets"
sed -i 's#<Vibe64ConnectedActive>true<#<Vibe64ConnectedActive>false<#' "$app/src/App/Directory.Build.targets"
if connected verify 2>"$work/refusal.log"; then fail "verify accepted an unwired checkout"; fi
grep "^connected:" "$work/refusal.log" || fail "verify failed without a connected: diagnosis"
echo "verify correctly refused the unwired checkout"
cp "$work/held.targets" "$app/src/App/Directory.Build.targets"

step "connected run prints the modified marker"
out="$(dotnet run --project "$app/src/App")"; echo "connected prints: $out"
[[ "$out" == "$modified" ]] || fail "connected app printed '$out'"

step "live edit in the connected checkout is picked up without re-prepare"
live="$modified-live"
sed -i "s/$modified/$live/" "$work/library/Marker.cs"
out="$(dotnet run --project "$app/src/App")"; echo "connected prints: $out"
[[ "$out" == "$live" ]] || fail "live edit not picked up: '$out'"

step "tracked files are untouched and the package cache did not change"
status="$(git -C "$app" status --porcelain)"
[[ -z "$status" ]] || fail "git status not clean:"$'\n'"$status"
git -C "$app" diff --quiet HEAD -- src/App/App.csproj src/App/packages.lock.json nuget.config || fail "tracked files changed"
[[ "$(sha256sum "$cache_nupkg")" == "$cache_before" ]] || fail "cached Example.Library 1.0.0 changed"
[[ "$(ls "$NUGET_PACKAGES/example.library")" == "1.0.0" ]] || fail "unexpected cached versions"
echo "git status --porcelain: clean; cache: only the published 1.0.0, unchanged"

step "disconnect: removing the sources file restores the published package"
rm "$app/.development/connected.json"
dotnet restore "$app/src/App" --locked-mode -nologo -v:q >/dev/null
out="$(dotnet run --project "$app/src/App" --no-restore)"; echo "disconnected prints: $out"
[[ "$out" == "$original" ]] || fail "disconnected app printed '$out'"
[[ -z "$(git -C "$app" status --porcelain)" ]] || fail "git status not clean after disconnect"

printf '\nPROOF PASSED: nuget connected development\n'
