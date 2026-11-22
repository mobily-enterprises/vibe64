#!/usr/bin/env bash
# Proves Vibe64's maven treatment with real Maven, offline after a one-time warm-up: the connected
# checkout is installed into a repository chained in front of the developer's, every ordinary `mvn`
# in the session source resolves it, no tracked file changes, the proof fails when the install is
# stale, unwired or of another version, and on Save a version the remote repositories publish moves
# into pom.xml while an unpublished one does not.
#
# Requirements: a full JDK (17+), mvn (3.9.3+), node and git on PATH.
# PROOF_CACHE_DIR  persistent cache: its home/.m2/repository is the developer's repository (the
#                  "published" library 1.0.0 and Maven's plugins). The first run fills it online;
#                  later runs are offline. Default: ${TMPDIR:-/tmp}/vibe64-connected-proof-cache/maven-adapter
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ADAPTER="$HERE/../vibe64-adapter.mjs"
CACHE="${PROOF_CACHE_DIR:-${TMPDIR:-/tmp}/vibe64-connected-proof-cache/maven-adapter}"
# Java's (and so Maven's) user.home: the developer's repository is the cache's, never the real ~/.m2.
export JAVA_TOOL_OPTIONS="-Duser.home=$CACHE/home"
TAIL_REPO="$CACHE/home/.m2/repository"
mkdir -p "$TAIL_REPO"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/connected-maven-proof.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'PROVE FAIL: %s\n' "$*" >&2; exit 1; }
connected() { node "$ADAPTER" "$@" .development/connected.json; }

java -version 2>&1 | grep -v JAVA_TOOL_OPTIONS | head -1
mvn -v 2>/dev/null | head -1
unset MAVEN_ARGS

if [[ ! -f "$CACHE/.warm" ]]; then
  step "warm cache (online, once): publish the original library 1.0.0 and fetch the build plugins"
  WARM="$WORK/warm"; mkdir -p "$WARM"; cp -R "$HERE/library" "$HERE/app" "$WARM/"
  mvn -B -q -f "$WARM/library/pom.xml" install
  mvn -B -q -f "$WARM/app/pom.xml" package exec:java \
    org.apache.maven.plugins:maven-dependency-plugin:3.11.0:build-classpath -Dmdep.outputFile="$WARM/cp.txt"
  touch "$CACHE/.warm"
fi
export MAVEN_ARGS="-B -o"   # from here on everything is offline

PUBLISHED_JAR="$TAIL_REPO/com/example/library/1.0.0/library-1.0.0.jar"
[[ -f "$PUBLISHED_JAR" ]] || fail "published library 1.0.0 missing from cache"
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
out="$(mvn -q compile exec:java)"
echo "$out"
grep -qx 'APP USES LIBRARY-MARKER-ORIGINAL' <<<"$out" || fail "baseline did not use the published library"

step "modify the connected library checkout and write the sources map"
MARK1="LIBRARY-MARKER-CONNECTED-$RANDOM$RANDOM"
sed -i "s/LIBRARY-MARKER-ORIGINAL/$MARK1/" "$LIB/src/main/java/com/example/library/Library.java"
mkdir -p "$APP/.development"
cat > "$APP/.development/connected.json" <<JSON
{"schema":"vibe64.connected-sources.v2","sessionId":"proof-session","repositories":[
  {"name":"Library","repository":"https://github.com/acme/library","relationship":"dependency","type":"maven","sourceRoot":"$LIB"}
]}
JSON

step "apply (1st)"
connected apply
step "apply (2nd, idempotent)"
connected apply | tee "$WORK/apply2.log"
grep -q "already resolves it" "$WORK/apply2.log" || fail "the second apply installed again"
step "proof"
connected proof

step "run the app with the ordinary command (no repository flags)"
out="$(mvn -q compile exec:java)"
echo "$out"
grep -qx "APP USES $MARK1" <<<"$out" || fail "app did not use the connected library"

step "negative: the proof fails once the connected source changed after the install"
MARK2="LIBRARY-MARKER-CONNECTED-AGAIN-$RANDOM$RANDOM"
sed -i "s/$MARK1/$MARK2/" "$LIB/src/main/java/com/example/library/Library.java"
if connected proof; then fail "the proof accepted a stale install"; fi
connected apply
connected proof
out="$(mvn -q compile exec:java)"
echo "$out"
grep -qx "APP USES $MARK2" <<<"$out" || fail "app did not pick up the installed again library"

step "negative: the proof fails when the wiring is removed"
mv .mvn/maven.config "$WORK/maven.config.saved"
if connected proof; then fail "the proof passed without wiring"; fi
mv "$WORK/maven.config.saved" .mvn/maven.config
connected proof

step "negative: the proof fails when the checkout builds a version pom.xml does not ask for"
sed -i 's#<version>1.0.0</version>#<version>1.1.0-SNAPSHOT</version>#' "$LIB/pom.xml"
connected apply
if connected proof; then fail "the proof passed although the consumer resolves the published 1.0.0"; fi
sed -i 's#<version>1.1.0-SNAPSHOT</version>#<version>1.0.0</version>#' "$LIB/pom.xml"
connected apply
connected proof

step "tracked files untouched, published artifact untouched"
status="$(git status --porcelain --untracked-files=all)"
[[ -z "$status" ]] || { echo "$status"; fail "git status is not clean"; }
[[ "$(git ls-files -s | sha256sum)" == "$TRACKED_BEFORE" ]] || fail "tracked index changed"
[[ "$(sha256sum "$PUBLISHED_JAR" | cut -d' ' -f1)" == "$PUBLISHED_SHA" ]] || fail "published 1.0.0 in the developer's repository was overwritten"

step "Save: a version the remote repository publishes moves into pom.xml; an unpublished one does not"
# The remote repository, served from file://: the developer's plugins plus a released library 1.1.0.
REMOTE="$WORK/remote"
cp -R "$TAIL_REPO" "$REMOTE"
cp -R "$HERE/library" "$WORK/released"
sed -i 's#<version>1.0.0</version>#<version>1.1.0</version>#' "$WORK/released/pom.xml"
sed -i 's/LIBRARY-MARKER-ORIGINAL/LIBRARY-MARKER-RELEASED-1.1.0/' "$WORK/released/src/main/java/com/example/library/Library.java"
mvn -B -q -o -f "$WORK/released/pom.xml" -Dmaven.repo.local="$REMOTE" -DskipTests install
cat > "$WORK/settings.xml" <<XML
<settings><mirrors><mirror><id>proof-remote</id><mirrorOf>*</mirrorOf><url>file://$REMOTE</url></mirror></mirrors></settings>
XML
export MAVEN_ARGS="-B -s $WORK/settings.xml"
sed -i 's#<version>1.0.0</version>#<version>1.1.0</version>#' "$LIB/pom.xml"
connected apply
if connected proof; then fail "the proof passed although pom.xml still asks for 1.0.0"; fi
[[ "$(connected locked)" == '{"name":"Library","published":[{"package":"com.example:library","connected":"1.1.0","locked":"1.0.0"}]}' ]] || fail "status does not show the published 1.0.0 beside the connected 1.1.0"
connected bump | tee "$WORK/bump.log"
grep -qx "\[Connected\] Library: Staging and Production now use the published com.example:library 1.1.0." "$WORK/bump.log" || fail "bump did not move to the published 1.1.0"
grep -qx "\[Connected\] Library: this session runs the connected com.example:library; Staging and Production use the published 1.1.0." "$WORK/bump.log" || fail "Save did not say what Staging and Production now use"
[[ "$(connected locked)" == '{"name":"Library","published":[{"package":"com.example:library","connected":"1.1.0","locked":"1.1.0"}]}' ]] || fail "status does not show the moved version"
[[ "$(git diff --unified=0 -- pom.xml | grep '^[-+] ')" == "$(printf -- '-      <version>1.0.0</version>\n+      <version>1.1.0</version>')" ]] || { git diff; fail "bump changed more than the dependency's version"; }
connected proof
out="$(mvn -q compile exec:java)"
echo "$out"
grep -qx "APP USES $MARK2" <<<"$out" || fail "after the bump the app no longer used the connected checkout"
sed -i 's#<version>1.1.0</version>#<version>1.2.0</version>#' "$LIB/pom.xml"
connected apply
connected bump | tee "$WORK/bump-unpublished.log"
grep -qx "\[Connected\] Library: com.example:library 1.2.0 is not published; Staging and Production keep 1.1.0." "$WORK/bump-unpublished.log" &&
  grep -qx "\[Connected\] Library: this session runs the connected com.example:library; Staging and Production use the published 1.1.0 until 1.2.0 is published, which Save then moves this project to." "$WORK/bump-unpublished.log" ||
  fail "bump took a version only the connected install holds"
[[ "$(git diff --unified=0 -- pom.xml | grep -c '^+ ')" == 1 ]] || fail "an unpublished version moved pom.xml"
git checkout -q -- pom.xml
[[ -z "$(git status --porcelain --untracked-files=all)" ]] || { git status --porcelain --untracked-files=all; fail "git status is not clean"; }

printf '\nPASS maven\n'
