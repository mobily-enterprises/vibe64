#!/usr/bin/env bash
# The fresh-project proof (tests/server/freshProjectTestTarget.proof.test.js) on a test host: MariaDB on 3307, public's
# node_modules with the branch's jskit and jskit-postgresql pieces, then the proof through public's npm test.
set -uo pipefail
cd "$(dirname "$0")/.."
"$HOME/v64-remote/bin/v64-mariadb" ensure > .probe/mariadb.log 2>&1 || { echo "MariaDB did not start"; cat .probe/mariadb.log; exit 1; }
[ -d node_modules ] || npm ci --no-audit --no-fund > .probe/npm-ci.log 2>&1 || { echo "npm ci failed"; tail -20 .probe/npm-ci.log; exit 1; }
echo "genesis-stack $(node -p 'require("./node_modules/genesis-stack/package.json").version'), genesis-compiler $(node -p 'require("./node_modules/genesis-compiler/package.json").version')"
cp .probe/inputs/pieces/jskit.md .probe/inputs/pieces/jskit-postgresql.md node_modules/genesis-stack/stacks/pieces/
export PROOF_INPUTS="$PWD/.probe/inputs" PROOF_MARIADB_SQL="$HOME/v64-remote/bin/v64-mariadb"
start=$(date +%s)
timeout 1700 npm test -- tests/server/freshProjectTestTarget.proof.test.js > .probe/proof.log 2>&1; code=$?
echo "proof exit $code in $(( $(date +%s) - start )) s"
grep -E "^ℹ (tests|pass|fail|duration_ms) " .probe/proof.log | tr '\n' ' '; echo
grep -v -E "^\s+at " .probe/proof.log | tail -n 260 | cut -c1-400
