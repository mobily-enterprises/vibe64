#!/usr/bin/env bash
# Proves Vibe64's gradle treatment with real Gradle, offline: the init script Vibe64 writes into the
# session's own Gradle user home makes the consumer a composite that builds the connected checkout
# from source in every ordinary Gradle command of the session (Vibe64 gives each one that home as
# GRADLE_USER_HOME; no flag), the person's gradle.properties still applies there, the shared
# read-only dependency cache is a lock-free copy of the default home's, no tracked file changes, the
# proof fails when the wiring is removed or the checkout's module does not match, and on Save a
# version the build's repository publishes moves into the build script while an unpublished one does not.
#
# Requirements: a full JDK (javac; Gradle refuses a JRE), gradle (9.x tested), node and git on PATH.
# PROOF_CACHE_DIR  persistent cache: the default GRADLE_USER_HOME and the Maven repository mavenLocal()
#                  reads, standing in for the published library. Nothing is downloaded from the
#                  internet: a localhost repository stands in for a remote one.
#                  Default: ${TMPDIR:-/tmp}/vibe64-connected-proof-cache/gradle-adapter
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER="$HERE/../vibe64-adapter.mjs"
GRADLE_ENV="$HERE/../../../packages/vibe64-execution/src/server/env/connectedGradleEnv.js"
CACHE="${PROOF_CACHE_DIR:-${TMPDIR:-/tmp}/vibe64-connected-proof-cache/gradle-adapter}"
PUBLISHED_REPO="$CACHE/m2"
export GRADLE_USER_HOME="$CACHE/user-home"
mkdir -p "$GRADLE_USER_HOME" "$PUBLISHED_REPO"
# Isolated Gradle home: no daemon left behind, mavenLocal() points into the scratch cache.
cat > "$GRADLE_USER_HOME/gradle.properties" <<PROPS
org.gradle.daemon=false
systemProp.maven.repo.local=$PUBLISHED_REPO
PROPS
G=(gradle --offline -q --console=plain)
SESSION_HOME=.development/gradle-home
INIT=$SESSION_HOME/init.d/vibe64-connected.init.gradle.kts

WORK="$(mktemp -d "${TMPDIR:-/tmp}/connected-gradle-proof.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT
# The shared read-only dependency cache follows the login's cache folder: this proof's own.
export XDG_CACHE_HOME="$WORK/xdg-cache"

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'PROVE FAIL: %s\n' "$*" >&2; exit 1; }
connected() { node "$ADAPTER" "$@" .development/connected.json; }
# What Vibe64 adds to every command of the session (vibe64-execution's connectedGradleEnv), one NAME=value a line.
session_env() { node --input-type=module -e "const { connectedGradleEnv } = await import('$GRADLE_ENV'); for (const [k, v] of Object.entries(connectedGradleEnv(process.cwd()))) console.log(k + '=' + v);"; }
# An ordinary Gradle command of the session: no flag, only the environment Vibe64 gives it.
session_gradle() { local -a env_args; mapfile -t env_args < <(session_env); env "${env_args[@]}" "${G[@]}" "$@"; }

java -version 2>&1 | head -1
gradle --version | grep -E '^(Gradle|Kotlin|Launcher JVM)'

step "publish the original library 1.0.0 (stands in for the released artifact)"
rm -rf "$PUBLISHED_REPO/com/example/library"
cp -R "$HERE/library" "$WORK/published-library"
(cd "$WORK/published-library" && "${G[@]}" publishToMavenLocal)
PUBLISHED_JAR="$PUBLISHED_REPO/com/example/library/1.0.0/library-1.0.0.jar"
PUBLISHED_SHA="$(sha256sum "$PUBLISHED_JAR" | cut -d' ' -f1)"

step "fresh copies"
cp -R "$HERE/library" "$HERE/app" "$WORK/"
LIB="$WORK/library"; APP="$WORK/app"
cd "$APP"
git init -q
git add -A
git -c user.name=proof -c user.email=proof@example.invalid commit -q -m "consumer baseline"
# Vibe64 keeps its Sources file out of Git itself; everything else the adapter keeps out on its own.
echo "/.development/connected.json" >> .git/info/exclude
TRACKED_BEFORE="$(git ls-files -s | sha256sum)"

step "baseline: without connection the app uses the published library"
out="$("${G[@]}" run)"
echo "$out"
grep -qx 'APP USES LIBRARY-MARKER-ORIGINAL' <<<"$out" || fail "baseline did not use the published library"

step "modify the connected library checkout and write the sources map"
MARK1="LIBRARY-MARKER-CONNECTED-$RANDOM$RANDOM"
sed -i "s/LIBRARY-MARKER-ORIGINAL/$MARK1/" "$LIB/src/main/java/com/example/library/Library.java"
mkdir -p "$APP/.development"
cat > "$APP/.development/connected.json" <<JSON
{"schema":"vibe64.connected-sources.v2","sessionId":"proof-session","repositories":[
  {"name":"Library","repository":"https://github.com/acme/library","relationship":"dependency","type":"gradle","sourceRoot":"$LIB"}
]}
JSON

step "the default home downloads a module from a remote repository (localhost), which the shared read-only cache will hold"
# A tiny Maven repository served over HTTP stands in for a remote one: Gradle caches what it downloads
# from it in the default home's caches/modules-2, as from Maven Central.
REPO="$WORK/http-repo"; mkdir -p "$REPO/com/example/extra/1.0.0"
python3 - "$REPO/com/example/extra/1.0.0" <<'PY'
import sys, zipfile, os
d = sys.argv[1]
with zipfile.ZipFile(os.path.join(d, "extra-1.0.0.jar"), "w") as z: z.writestr("META-INF/MANIFEST.MF", "Manifest-Version: 1.0\n")
open(os.path.join(d, "extra-1.0.0.pom"), "w").write('<project xmlns="http://maven.apache.org/POM/4.0.0"><modelVersion>4.0.0</modelVersion>'
  '<groupId>com.example</groupId><artifactId>extra</artifactId><version>1.0.0</version></project>\n')
PY
python3 -c 'import http.server, functools, sys, socketserver
h = functools.partial(http.server.SimpleHTTPRequestHandler, directory=sys.argv[1])
s = socketserver.TCPServer(("127.0.0.1", 0), h); print(s.server_address[1], flush=True); s.serve_forever()' "$REPO" > "$WORK/http.port" 2>/dev/null &
HTTP_PID=$!
trap 'kill $HTTP_PID 2>/dev/null; cleanup' EXIT
for _ in $(seq 50); do [[ -s "$WORK/http.port" ]] && break; sleep 0.1; done
PORT="$(head -1 "$WORK/http.port")"
mkdir -p "$WORK/seeder"
echo 'rootProject.name = "seeder"' > "$WORK/seeder/settings.gradle.kts"
cat > "$WORK/seeder/build.gradle.kts" <<'KTS'
repositories { maven { url = uri(providers.gradleProperty("repo").get()); isAllowInsecureProtocol = true } }
val seed by configurations.creating
dependencies { seed("com.example:extra:1.0.0") }
tasks.register("resolveExtra") { val files: FileCollection = seed; doLast { println("EXTRA " + files.singleFile.name) } }
KTS
gradle -q --console=plain -p "$WORK/seeder" -Prepo="http://127.0.0.1:$PORT/" resolveExtra | grep -qx "EXTRA extra-1.0.0.jar" ||
  fail "the default home did not download the remote module"
kill $HTTP_PID; wait $HTTP_PID 2>/dev/null || true
trap cleanup EXIT

step "apply (1st)"
connected apply
step "apply (2nd, idempotent)"
cp "$INIT" "$WORK/init.first"
connected apply
cmp -s "$INIT" "$WORK/init.first" || fail "apply is not idempotent"
cat "$INIT"
step "proof"
connected proof

step "the session's commands get its Gradle home, with the person's settings and the shared read-only cache"
session_env | tee "$WORK/session.env"
grep -qx "GRADLE_USER_HOME=$APP/$SESSION_HOME" "$WORK/session.env" || fail "a session command does not get the session's Gradle home"
RO="$(sed -n 's/^GRADLE_RO_DEP_CACHE=//p' "$WORK/session.env")"
[[ -n "$RO" && -d "$RO/modules-2/files-2.1" ]] || fail "a session command does not get the shared read-only cache"
[[ -z "$(find -L "$RO/modules-2" \( -name '*.lock' -o -name gc.properties \) -print -quit)" ]] || fail "the read-only cache carries locks or cleanup state"
[[ "$(readlink "$SESSION_HOME/gradle.properties")" == "$GRADLE_USER_HOME/gradle.properties" ]] || fail "the default home's gradle.properties is not linked"
(cd "$WORK" && [[ -z "$(session_env)" ]]) || fail "a command outside the session got its Gradle home"
# The repository is gone and Gradle is offline: the session's Gradle finds the module only in the shared cache.
out="$(session_gradle -p "$WORK/seeder" -Prepo="http://127.0.0.1:$PORT/" resolveExtra)"
grep -qx "EXTRA extra-1.0.0.jar" <<<"$out" || fail "a session command did not read the module from the shared read-only cache"
[[ -z "$(find "$SESSION_HOME" -path '*files-2.1/com.example/extra*' -print -quit)" ]] || fail "the session downloaded the module again"

step "run the app with the ordinary gradle command, as a session command"
out="$(session_gradle run)"
echo "$out"
grep -qx "APP USES $MARK1" <<<"$out" || fail "app did not use the connected library"

step "edit the connected source again: the composite rebuilds it without another apply"
MARK2="LIBRARY-MARKER-CONNECTED-AGAIN-$RANDOM$RANDOM"
sed -i "s/$MARK1/$MARK2/" "$LIB/src/main/java/com/example/library/Library.java"
connected proof
out="$(session_gradle run)"
echo "$out"
grep -qx "APP USES $MARK2" <<<"$out" || fail "app did not pick up the edited connected source"

step "negative: the proof fails when the wiring is removed"
mv "$INIT" "$WORK/init.saved"
if connected proof; then fail "the proof passed without wiring"; fi
[[ -z "$(session_env)" ]] || fail "without the init script the session's commands still got its Gradle home"
mv "$WORK/init.saved" "$INIT"

step "negative: the proof fails when the included build does not provide the requested module"
sed -i 's/rootProject.name = "library"/rootProject.name = "library-renamed"/' "$LIB/settings.gradle.kts"
if connected proof; then fail "the proof passed although nothing was substituted"; fi
sed -i 's/rootProject.name = "library-renamed"/rootProject.name = "library"/' "$LIB/settings.gradle.kts"
connected proof

step "tracked files untouched, published artifact untouched"
status="$(git status --porcelain --untracked-files=all)"
[[ -z "$status" ]] || { echo "$status"; fail "git status is not clean"; }
[[ "$(git ls-files -s | sha256sum)" == "$TRACKED_BEFORE" ]] || fail "tracked index changed"
[[ "$(sha256sum "$PUBLISHED_JAR" | cut -d' ' -f1)" == "$PUBLISHED_SHA" ]] || fail "published 1.0.0 was overwritten"

step "Save: a version the build's repository publishes moves into the build script; an unpublished one does not"
cp -R "$HERE/library" "$WORK/released"
sed -i 's/version = "1.0.0"/version = "1.1.0"/' "$WORK/released/build.gradle.kts"
sed -i 's/LIBRARY-MARKER-ORIGINAL/LIBRARY-MARKER-RELEASED-1.1.0/' "$WORK/released/src/main/java/com/example/library/Library.java"
(cd "$WORK/released" && "${G[@]}" publishToMavenLocal)
sed -i 's/version = "1.0.0"/version = "1.1.0"/' "$LIB/build.gradle.kts"
[[ "$(connected locked)" == '{"name":"Library","published":[{"package":"com.example:library","connected":"1.1.0","locked":"1.0.0"}]}' ]] || fail "status does not show the published 1.0.0 beside the connected 1.1.0"
connected bump | tee "$WORK/bump.log"
grep -qx "\[Connected\] Library: Staging and Production now use the published com.example:library 1.1.0." "$WORK/bump.log" || fail "bump did not move to the published 1.1.0"
grep -qx "\[Connected\] Library: this session runs the connected com.example:library; Staging and Production use the published 1.1.0." "$WORK/bump.log" || fail "Save did not say what Staging and Production now use"
[[ "$(connected locked)" == '{"name":"Library","published":[{"package":"com.example:library","connected":"1.1.0","locked":"1.1.0"}]}' ]] || fail "status does not show the moved version"
[[ "$(git diff --unified=0 -- build.gradle.kts | grep '^[-+] ')" == "$(printf -- '-    implementation("com.example:library:1.0.0")\n+    implementation("com.example:library:1.1.0")')" ]] ||
  { git diff; fail "bump changed more than the dependency's version"; }
connected proof
out="$(session_gradle run)"
echo "$out"
grep -qx "APP USES $MARK2" <<<"$out" || fail "after the bump the app no longer used the connected checkout"
# Staging's view: the default home, which has no connection.
out="$("${G[@]}" run)"
echo "$out"
grep -qx "APP USES LIBRARY-MARKER-RELEASED-1.1.0" <<<"$out" || fail "without the init script the build did not use the published 1.1.0"
sed -i 's/version = "1.1.0"/version = "1.2.0"/' "$LIB/build.gradle.kts"
connected bump | tee "$WORK/bump-unpublished.log"
grep -qx "\[Connected\] Library: com.example:library 1.2.0 is not published; Staging and Production keep 1.1.0." "$WORK/bump-unpublished.log" &&
  grep -qx "\[Connected\] Library: this session runs the connected com.example:library; Staging and Production use the published 1.1.0 until 1.2.0 is published, which Save then moves this project to." "$WORK/bump-unpublished.log" ||
  fail "bump took a version nothing publishes"
[[ "$(git diff --unified=0 -- build.gradle.kts | grep -c '^+ ')" == 1 ]] || fail "an unpublished version moved the build script"
git checkout -q -- build.gradle.kts
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { git status --porcelain --untracked-files=all; fail "git status is not clean"; }

printf '\nPASS gradle\n'
