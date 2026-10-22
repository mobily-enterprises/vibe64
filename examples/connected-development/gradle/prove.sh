#!/usr/bin/env bash
# Acceptance proof: a Gradle consumer builds against a connected (modified) library checkout
# through a composite build wired by tooling/Connected.java, without modifying any tracked file.
#
# Requirements: a full JDK (javac; Gradle refuses a JRE), gradle (9.x tested) and git on PATH.
# PROOF_CACHE_DIR  persistent cache: GRADLE_USER_HOME and a Maven repository standing in for the
#                  "published" library. Nothing in this fixture downloads anything; Gradle runs
#                  with --offline throughout.
#                  Default: ${TMPDIR:-/tmp}/vibe64-connected-proof-cache/gradle
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${PROOF_CACHE_DIR:-${TMPDIR:-/tmp}/vibe64-connected-proof-cache/gradle}"
PUBLISHED_REPO="$CACHE/m2"
export GRADLE_USER_HOME="$CACHE/user-home"
mkdir -p "$GRADLE_USER_HOME" "$PUBLISHED_REPO"
# Isolated Gradle home: no daemon left behind, mavenLocal() points into the scratch cache.
cat > "$GRADLE_USER_HOME/gradle.properties" <<EOF
org.gradle.daemon=false
systemProp.maven.repo.local=$PUBLISHED_REPO
EOF
export CONNECTED_GRADLE_ARGS="--offline"
G=(gradle --offline -q --console=plain)

WORK="$(mktemp -d "${TMPDIR:-/tmp}/connected-gradle-proof.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'PROVE FAIL: %s\n' "$*" >&2; exit 1; }

java -version 2>&1 | head -1
gradle --version | grep -E '^(Gradle|Kotlin|Launcher JVM)'

step "publish the original library 1.0.0 (stands in for the released artifact)"
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
TRACKED_BEFORE="$(git ls-files -s | sha256sum)"

step "baseline: without connection the app uses the published library"
out="$("${G[@]}" run)"
echo "$out"
grep -qx 'APP USES LIBRARY-MARKER-ORIGINAL' <<<"$out" || fail "baseline did not use the published library"

step "modify the connected library checkout"
MARK1="LIBRARY-MARKER-CONNECTED-$RANDOM$RANDOM"
sed -i "s/LIBRARY-MARKER-ORIGINAL/$MARK1/" "$LIB/src/main/java/com/example/library/Library.java"
grep -q "$MARK1" "$LIB/src/main/java/com/example/library/Library.java"

step "write the sources map"
mkdir -p "$APP/.development"
cat > "$APP/.development/connected.json" <<EOF
{"contract":"vibe64.connected-sources.v1","sessionId":"proof-session","projects":[
  {"name":"Library","repository":"https://github.com/acme/library","relationship":"dependency","type":"gradle","sourceRoot":"$LIB","contributionId":"proof-contribution"}
]}
EOF

step "prepare (1st)"
java tooling/Connected.java prepare .development/connected.json
step "prepare (2nd, idempotent)"
cp .development/connected.init.gradle.kts "$WORK/init.first"
java tooling/Connected.java prepare .development/connected.json
cmp -s .development/connected.init.gradle.kts "$WORK/init.first" || fail "prepare is not idempotent"
cat .development/connected.init.gradle.kts
step "verify"
java tooling/Connected.java verify .development/connected.json

step "run the app with the connected init script"
out="$("${G[@]}" -I .development/connected.init.gradle.kts run)"
echo "$out"
grep -qx "APP USES $MARK1" <<<"$out" || fail "app did not use the connected library"

step "edit the connected source again: the composite rebuilds it without another prepare"
MARK2="LIBRARY-MARKER-CONNECTED-AGAIN-$RANDOM$RANDOM"
sed -i "s/$MARK1/$MARK2/" "$LIB/src/main/java/com/example/library/Library.java"
java tooling/Connected.java verify .development/connected.json
out="$("${G[@]}" -I .development/connected.init.gradle.kts run)"
echo "$out"
grep -qx "APP USES $MARK2" <<<"$out" || fail "app did not pick up the edited connected source"

step "negative: verify must fail when the wiring is removed"
mv .development/connected.init.gradle.kts "$WORK/init.saved"
if java tooling/Connected.java verify .development/connected.json; then fail "verify passed without wiring"; fi
mv "$WORK/init.saved" .development/connected.init.gradle.kts

step "negative: verify must fail when the included build does not provide the requested module"
sed -i 's/rootProject.name = "library"/rootProject.name = "library-renamed"/' "$LIB/settings.gradle.kts"
if java tooling/Connected.java verify .development/connected.json; then fail "verify passed although nothing was substituted"; fi
sed -i 's/rootProject.name = "library-renamed"/rootProject.name = "library"/' "$LIB/settings.gradle.kts"
java tooling/Connected.java verify .development/connected.json

step "tracked files untouched, published artifact untouched"
status="$(git status --porcelain --untracked-files=all)"
[[ -z "$status" ]] || { echo "$status"; fail "git status is not clean"; }
[[ "$(git ls-files -s | sha256sum)" == "$TRACKED_BEFORE" ]] || fail "tracked index changed"
git diff --quiet HEAD -- settings.gradle.kts build.gradle.kts || fail "Gradle build files changed"
[[ "$(sha256sum "$PUBLISHED_JAR" | cut -d' ' -f1)" == "$PUBLISHED_SHA" ]] || fail "published 1.0.0 was overwritten"

printf '\nPROVE PASS: gradle connected development\n'
