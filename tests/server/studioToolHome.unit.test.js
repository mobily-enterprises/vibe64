import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDIO_MYSQL_CLIENT_CONFIG_DIR_ENV,
  studioMysqlClientConfigSetupLines,
  studioToolHomeSetupLines
} from "../../packages/studio-terminal-core/src/server/studioToolHome.js";
import {
  NPM_CONFIG_PREFIX_ENV,
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV
} from "../../packages/vibe64-execution/src/server/index.js";

test("studio tool home startup validates gateway-provided tool env", () => {
  const script = studioToolHomeSetupLines().join("\n");

  assert.match(script, /HOME is required/u);
  assert.match(script, new RegExp(`${NPM_CONFIG_PREFIX_ENV} is required`, "u"));
  assert.match(script, new RegExp(`${VIBE64_SHARED_CACHE_ROOT_ENV} is required`, "u"));
  assert.match(script, new RegExp(`${PLAYWRIGHT_BROWSERS_PATH_ENV} is required`, "u"));
  assert.doesNotMatch(script, /export HOME=/u);
  assert.doesNotMatch(script, /export PATH=/u);
  assert.doesNotMatch(script, /export VIBE64_SHARED_CACHE_ROOT=/u);
  assert.doesNotMatch(script, /export PLAYWRIGHT_BROWSERS_PATH=/u);
});

test("studio mysql client config falls back to tenant runtime dir before global temp", () => {
  const script = studioMysqlClientConfigSetupLines().join("\n");

  assert.match(script, new RegExp(`\\$\\{${STUDIO_MYSQL_CLIENT_CONFIG_DIR_ENV}:-\\}`, "u"));
  assert.match(script, /export MYSQL_HOME="\$XDG_RUNTIME_DIR\/vibe64\/mysql-client"/u);
  assert.match(script, /export MYSQL_HOME="\$\{TMPDIR:-\/tmp\}\/vibe64-mysql-client-\$\(id -u\)"/u);
  assert.doesNotMatch(script, /export MYSQL_HOME=\/tmp\/vibe64-mysql-client/u);
});
