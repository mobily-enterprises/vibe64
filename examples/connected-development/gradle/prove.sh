#!/usr/bin/env bash
# Proves Vibe64's gradle treatment with real Gradle, offline: the init script Vibe64 writes makes the
# consumer a composite that builds the connected checkout from source in every command that passes
# it, no tracked file changes, the proof fails when the wiring is removed or the checkout's module
# does not match, and on Save a version the build's repository publishes moves into the build script
# while an unpublished one does not.
#
# Requirements: a full JDK (javac; Gradle refuses a JRE), gradle (9.x tested), node and git on PATH.
# PROOF_CACHE_DIR  persistent cache: GRADLE_USER_HOME and the Maven repository mavenLocal() reads,
#                  standing in for the published library. Nothing downloads anything.
#                  Default: ${TMPDIR:-/tmp}/vibe64-connected-proof-cache/gradle-adapter
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER="$HERE/../vibe64-adapter.mjs"
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
INIT=.development/connected.init.gradle.kts

WORK="$(mktemp -d "${TMPDIR:-/tmp}/connected-gradle-proof.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'PROVE FAIL: %s\n' "$*" >&2; exit 1; }
connected() { node "$ADAPTER" "$@" .development/connected.json; }

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

step "apply (1st)"
connected apply
step "apply (2nd, idempotent)"
cp "$INIT" "$WORK/init.first"
connected apply
cmp -s "$INIT" "$WORK/init.first" || fail "apply is not idempotent"
cat "$INIT"
step "proof"
connected proof

step "run the app with the connected init script"
out="$("${G[@]}" -I "$INIT" run)"
echo "$out"
grep -qx "APP USES $MARK1" <<<"$out" || fail "app did not use the connected library"

step "edit the connected source again: the composite rebuilds it without another apply"
MARK2="LIBRARY-MARKER-CONNECTED-AGAIN-$RANDOM$RANDOM"
sed -i "s/$MARK1/$MARK2/" "$LIB/src/main/java/com/example/library/Library.java"
connected proof
out="$("${G[@]}" -I "$INIT" run)"
echo "$out"
grep -qx "APP USES $MARK2" <<<"$out" || fail "app did not pick up the edited connected source"

step "negative: the proof fails when the wiring is removed"
mv "$INIT" "$WORK/init.saved"
if connected proof; then fail "the proof passed without wiring"; fi
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
out="$("${G[@]}" -I "$INIT" run)"
echo "$out"
grep -qx "APP USES $MARK2" <<<"$out" || fail "after the bump the app no longer used the connected checkout"
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
