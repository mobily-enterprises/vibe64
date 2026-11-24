#!/usr/bin/env bash
# Mercbot Online's browser suite through its Stack's test-app target in a session (public Vibe64's real Preview
# controller and managed Playwright command), on its own browser test database. The Online tree is --also mirrored.
set -uo pipefail
cd "$(dirname "$0")/.."
ONLINE=/home/merc/Development/current/fixes-wt/mercbot-online-test-target-proof
~/v64-remote/bin/v64-postgres ensure >/dev/null 2>&1 || { echo "postgres ensure failed"; exit 1; }
[ -d node_modules ] || npm ci --no-audit --no-fund > .probe/npm-ci.log 2>&1 || { echo "public npm ci failed"; tail -20 .probe/npm-ci.log; exit 1; }
start=$(date +%s)
(cd "$ONLINE" && { [ -d node_modules ] || npm ci --no-audit --no-fund; } && npm run public:install) > .probe/online-install.log 2>&1 ||
  { echo "Online install failed"; tail -30 .probe/online-install.log; exit 1; }
echo "Online install $(( $(date +%s) - start )) s"
echo "Online $(git -C "$ONLINE" log --oneline -1 | cut -c1-60); $(grep -m1 "public Mercbot" .probe/online-install.log | cut -c1-200)"
export PROOF_ONLINE_TREE=$ONLINE PROOF_PG_SQL=$HOME/v64-remote/bin/v64-postgres
start=$(date +%s)
timeout 2700 npm test -- tests/server/mercbotOnlineTestTarget.proof.test.js > .probe/online-proof.log 2>&1
echo "proof exit $? in $(( $(date +%s) - start )) s"
grep -E '^\[proof|^ℹ (tests|pass|fail)|passed|failed|flaky|skipped|✘|Error' .probe/online-proof.log | cut -c1-400 | head -n 160
