#!/usr/bin/env bash
# Proves Vibe64's nuget adapter for a NuGet PackageReference, offline: the connected checkout's
# project takes the package's place through an untracked Directory.Build.targets, no tracked file
# changes, and on Save the project and its lock file move to the checkout's new version only once
# the feed has it. Requires `dotnet` (SDK 10) on PATH or DOTNET_ROOT, `git` and `node` (with this
# repository's packages installed). The NuGet global packages folder is isolated per run.
set -euo pipefail

here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd -P)"
adapter="$here/../vibe64-adapter.mjs"
adapters="$here/../../../packages/vibe64-project/src/server/connectedAdapters"
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
export GIT_CONFIG_GLOBAL=/dev/null GIT_CONFIG_NOSYSTEM=1

step() { printf '\n== %s\n' "$*"; }
fail() { echo "PROOF FAILED: $*" >&2; exit 1; }
git_q() { git -c user.name=proof -c user.email=proof@example.invalid -c init.defaultBranch=main "$@"; }
dotnet --version
git --version
node --version

original="example-library-marker:original"
modified="example-library-marker:connected-$$-$RANDOM"
published_11="example-library-marker:published-1.1.0"

# Save's step and the disconnection, as Vibe64 runs them: the adapter's locked and bump for each
# connection, and the restore of connections that are gone.
cat > "$work/save.mjs" <<'JS'
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
const { nugetAdapter } = await import(path.join(adapters, "nuget.js"));
const { writeManagedGitExcludes } = await import(path.join(adapters, "../projectEnvironmentFiles.js"));
const { repositories } = JSON.parse(await readFile(sourcesFile, "utf8"));
const connections = repositories.filter(entry => entry.relationship === "dependency" && entry.type === "nuget");
const runCommand = ({ command, args, cwd, timeout, env }) => new Promise(resolve => execFile(command, args,
  { cwd, timeout, env: { ...process.env, ...env }, maxBuffer: 64 * 1024 * 1024 }, (error, stdout, stderr) => resolve(error
    ? { ok: false, stdout, stderr, exitCode: error.code }
    : { ok: true, stdout, stderr, exitCode: 0 })));
for (const connection of connections) {
  const context = {
    connection, connections, sessionSourceRoot, runCommand,
    trees: [sessionSourceRoot, ...connections.map(entry => entry.sourceRoot)],
    writeGitExcludes: (tree, paths) => writeManagedGitExcludes(tree, paths, { section: "connected nuget packages" })
  };
  console.log(`locked: ${JSON.stringify(await nugetAdapter.locked({ ...context, runCommand: null }))}`);
  const { bumped, lines } = await nugetAdapter.bump(context);
  for (const line of lines) console.log(line);
  console.log(`bumped: ${JSON.stringify(bumped)}`);
}
JS
save() { (cd "$app" && node "$work/save.mjs" "$adapters" "$@"); }

step "copy fixtures to $work"
cp -R "$here/library" "$work/library-published"   # source of the published 1.0.0
cp -R "$here/library" "$work/library"             # the connected checkout (the session's copy)
cp -R "$here/app" "$work/app"
app="$work/app"
git_q -C "$work/library" init -q
git_q -C "$work/library" add -A
git_q -C "$work/library" commit -q -m "Example.Library 1.0.0"

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
{"schema":"vibe64.connected-sources.v2","sessionId":"proof-session","repositories":[
  {"name":"Example Library","repository":"https://github.com/acme/example-library","relationship":"dependency","type":"nuget","sourceRoot":"$work/library"}
]}
JSON

# Vibe64's adapter steps, run from the consumer checkout as workspace preparation runs them.
connected() { (cd "$app" && node "$adapter" "$1" .development/connected.json); }

step "apply (1st)"; connected apply
step "apply (2nd, idempotent)"; cp "$app/src/App/Directory.Build.targets" "$work/first.targets"; connected apply
cmp -s "$app/src/App/Directory.Build.targets" "$work/first.targets" || fail "the second apply wrote a different import"
cat "$app/src/App/Directory.Build.targets"
step "proof"; connected proof

step "the proof must reject a checkout that is not wired to the connected source"
# Deactivate the generated wiring but leave the file in place: a build now
# succeeds against the published package, and the proof must still refuse it.
cp "$app/src/App/Directory.Build.targets" "$work/held.targets"
sed -i 's#<Vibe64ConnectedActive>true<#<Vibe64ConnectedActive>false<#' "$app/src/App/Directory.Build.targets"
if connected proof 2>"$work/refusal.log"; then fail "the proof accepted an unwired checkout"; fi
grep "^connected proof:" "$work/refusal.log" || fail "the proof failed without a diagnosis"
echo "the proof correctly refused the unwired checkout"
cp "$work/held.targets" "$app/src/App/Directory.Build.targets"
connected proof

step "connected run prints the modified marker"
out="$(dotnet run --project "$app/src/App")"; echo "connected prints: $out"
[[ "$out" == "$modified" ]] || fail "connected app printed '$out'"

step "live edit in the connected checkout is picked up without another apply"
live="$modified-live"
sed -i "s/$modified/$live/" "$work/library/Marker.cs"
out="$(dotnet run --project "$app/src/App")"; echo "connected prints: $out"
[[ "$out" == "$live" ]] || fail "live edit not picked up: '$out'"

step "tracked files are untouched, build output stays out of Git, and the package cache did not change"
status="$(git -C "$app" status --porcelain --untracked-files=all)"
[[ -z "$status" ]] || fail "git status not clean:"$'\n'"$status"
git -C "$app" diff --quiet HEAD -- src/App/App.csproj src/App/packages.lock.json nuget.config || fail "tracked files changed"
library_status="$(git -C "$work/library" status --porcelain --untracked-files=all)"
[[ "$library_status" == " M Marker.cs" ]] || fail "the connected checkout shows more than its edit:"$'\n'"$library_status"
[[ "$(sha256sum "$cache_nupkg")" == "$cache_before" ]] || fail "cached Example.Library 1.0.0 changed"
[[ "$(ls "$NUGET_PACKAGES/example.library")" == "1.0.0" ]] || fail "unexpected cached versions"
echo "git status --porcelain: clean; connected checkout: only Marker.cs; cache: only the published 1.0.0, unchanged"

step "Save: the checkout declares 1.1.0, which the feed does not have yet, so nothing moves"
sed -i 's#<Version>1.0.0</Version>#<Version>1.1.0</Version>#' "$work/library/Example.Library.csproj"
save bump .development/connected.json | tee "$work/save1.log"
grep -q "Example.Library 1.1.0 is not published" "$work/save1.log" || fail "an unpublished version was not reported"
[[ -z "$(git -C "$app" status --porcelain --untracked-files=all)" ]] || fail "an unpublished version moved tracked files"
connected proof

step "Save once 1.1.0 is published: the project and its lock move to it, and the connection stays in effect"
cp -R "$here/library" "$work/library-published-1.1.0"
sed -i "s/$original/$published_11/" "$work/library-published-1.1.0/Marker.cs"
sed -i 's#<Version>1.0.0</Version>#<Version>1.1.0</Version>#' "$work/library-published-1.1.0/Example.Library.csproj"
dotnet pack "$work/library-published-1.1.0" -c Release -o "$work/published-feed" -nologo -v:q >/dev/null
save bump .development/connected.json | tee "$work/save2.log"
grep -q "Staging and Production now use the published Example.Library 1.1.0" "$work/save2.log" || fail "no bump reported"
grep -q 'Include="Example.Library" Version="1.1.0"' "$app/src/App/App.csproj" || fail "App.csproj does not reference 1.1.0"
grep -q '"resolved": "1.1.0"' "$app/src/App/packages.lock.json" || fail "packages.lock.json does not resolve 1.1.0"
moved="$(git -C "$app" status --porcelain --untracked-files=all)"
[[ "$moved" == "$(printf ' M src/App/App.csproj\n M src/App/packages.lock.json')" ]] || fail "the bump changed more than the project and its lock:"$'\n'"$moved"
connected proof
out="$(dotnet run --project "$app/src/App")"; echo "connected prints: $out"
[[ "$out" == "$live" ]] || fail "after the bump the connected app printed '$out'"
save bump .development/connected.json > "$work/save3.log"
grep -q '^bumped: \[\]$' "$work/save3.log" || fail "a second Save bumped again"

step "disconnect: Vibe64's restore removes its import; a locked restore gives Staging's view"
save restore
[[ ! -e "$app/src/App/Directory.Build.targets" ]] || fail "the import is still there"
dotnet restore "$app/src/App" --locked-mode -nologo -v:q >/dev/null
out="$(dotnet run --project "$app/src/App" --no-restore)"; echo "disconnected prints: $out"
[[ "$out" == "$published_11" ]] || fail "disconnected app printed '$out'"
[[ "$(git -C "$app" status --porcelain --untracked-files=all)" == "$moved" ]] || fail "restore left files behind"

printf '\nPASS nuget connected development\n'
