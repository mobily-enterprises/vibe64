#!/usr/bin/env bash
# Acceptance proof: a Maven consumer builds against a connected (modified) library checkout
# through tooling/Connected.java, without modifying any tracked file.
#
# Requirements: java (11+), mvn (3.9.3+) and git on PATH.
# PROOF_CACHE_DIR  persistent cache (Maven repository standing in for "published" artifacts and
#                  cached plugins). The first run populates it online; later runs are offline.
#                  Default: ${TMPDIR:-/tmp}/vibe64-connected-proof-cache/maven
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
CACHE="${PROOF_CACHE_DIR:-${TMPDIR:-/tmp}/vibe64-connected-proof-cache/maven}"
TAIL_REPO="$CACHE/repository"
mkdir -p "$TAIL_REPO"

WORK="$(mktemp -d "${TMPDIR:-/tmp}/connected-maven-proof.XXXXXX")"
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

step() { printf '\n== %s\n' "$*"; }
fail() { printf 'PROVE FAIL: %s\n' "$*" >&2; exit 1; }

java -version 2>&1 | head -1
mvn -v | head -1

# The connected install and the app build must never write to the developer's ~/.m2.
export CONNECTED_MAVEN_TAIL="$TAIL_REPO"
unset MAVEN_ARGS

if [[ ! -f "$CACHE/.warm" ]]; then
  step "warm cache (online, once): publish original library 1.0.0 and fetch build plugins"
  WARM="$WORK/warm"; mkdir -p "$WARM"; cp -R "$HERE/library" "$HERE/app" "$WARM/"
  mvn -B -q -Dmaven.repo.local="$TAIL_REPO" -f "$WARM/library/pom.xml" install
  mvn -B -q -Dmaven.repo.local="$TAIL_REPO" -f "$WARM/app/pom.xml" package exec:java \
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
TRACKED_BEFORE="$(git ls-files -s | sha256sum)"

step "baseline: without connection the app uses the published library"
out="$(mvn -q -Dmaven.repo.local="$TAIL_REPO" compile exec:java)"
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
  {"name":"Library","repository":"https://github.com/acme/library","relationship":"dependency","type":"maven","sourceRoot":"$LIB","contributionId":"proof-contribution"}
]}
EOF

step "prepare (1st)"
java tooling/Connected.java prepare .development/connected.json
step "prepare (2nd, idempotent)"
java tooling/Connected.java prepare .development/connected.json
step "verify"
java tooling/Connected.java verify .development/connected.json

step "run the app with the ordinary command (no repository flags)"
out="$(mvn -q compile exec:java)"
echo "$out"
grep -qx "APP USES $MARK1" <<<"$out" || fail "app did not use the connected library"

step "negative: verify must fail when the connected source changed after prepare"
sleep 1
MARK2="LIBRARY-MARKER-CONNECTED-AGAIN-$RANDOM$RANDOM"
sed -i "s/$MARK1/$MARK2/" "$LIB/src/main/java/com/example/library/Library.java"
if java tooling/Connected.java verify .development/connected.json; then fail "verify accepted a stale connected build"; fi
java tooling/Connected.java prepare .development/connected.json
java tooling/Connected.java verify .development/connected.json
out="$(mvn -q compile exec:java)"
echo "$out"
grep -qx "APP USES $MARK2" <<<"$out" || fail "app did not pick up the re-prepared connected library"

step "negative: verify must fail when the wiring is removed"
mv .mvn/maven.config "$WORK/maven.config.saved"
if java tooling/Connected.java verify .development/connected.json; then fail "verify passed without wiring"; fi
mv "$WORK/maven.config.saved" .mvn/maven.config

step "negative: verify must fail when the checkout builds a version the consumer does not request"
sed -i 's#<version>1.0.0</version>#<version>1.1.0-SNAPSHOT</version>#' "$LIB/pom.xml"
java tooling/Connected.java prepare .development/connected.json
if java tooling/Connected.java verify .development/connected.json; then fail "verify passed although the consumer resolves the published 1.0.0"; fi
sed -i 's#<version>1.1.0-SNAPSHOT</version>#<version>1.0.0</version>#' "$LIB/pom.xml"
java tooling/Connected.java prepare .development/connected.json
java tooling/Connected.java verify .development/connected.json

step "tracked files untouched, published artifact untouched"
status="$(git status --porcelain --untracked-files=all)"
[[ -z "$status" ]] || { echo "$status"; fail "git status is not clean"; }
[[ "$(git ls-files -s | sha256sum)" == "$TRACKED_BEFORE" ]] || fail "tracked index changed"
git diff --quiet HEAD -- pom.xml || fail "pom.xml changed"
[[ "$(sha256sum "$PUBLISHED_JAR" | cut -d' ' -f1)" == "$PUBLISHED_SHA" ]] || fail "published 1.0.0 in the shared repository was overwritten"
[[ ! -e "$HOME/.m2/repository/com/example/library" ]] || echo "note: ~/.m2 already contains com/example/library (not written by this proof run)"

printf '\nPROVE PASS: maven connected development\n'
