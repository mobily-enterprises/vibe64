import assert from "node:assert/strict";
import test from "node:test";

import {
  STUDIO_MYSQL_CLIENT_CONFIG_DIR_ENV,
  studioMysqlClientConfigSetupLines,
  studioToolHomeSetupLines
} from "../../packages/studio-terminal-core/src/server/studioToolHome.js";
import {
  STUDIO_TOOL_HOME_ENV
} from "../../packages/studio-terminal-core/src/server/studioRuntimeIdentity.js";

test("studio tool home falls back to tenant runtime dir before global temp", () => {
  const script = studioToolHomeSetupLines().join("\n");

  assert.match(script, new RegExp(`\\$\\{${STUDIO_TOOL_HOME_ENV}:-\\}`, "u"));
  assert.match(script, /export HOME="\$XDG_RUNTIME_DIR\/vibe64\/studio-home"/u);
  assert.match(script, /export HOME="\$\{TMPDIR:-\/tmp\}\/vibe64-studio-home-\$\(id -u\)"/u);
  assert.match(script, /export PLAYWRIGHT_BROWSERS_PATH="\$\{PLAYWRIGHT_BROWSERS_PATH:-\$\{VIBE64_SHARED_CACHE_ROOT:-\/var\/cache\/vibe64\}\/playwright\}"/u);
  assert.doesNotMatch(script, /export HOME="\$\{HOME:-\/tmp\/studio-home\}"/u);
});

test("studio mysql client config falls back to tenant runtime dir before global temp", () => {
  const script = studioMysqlClientConfigSetupLines().join("\n");

  assert.match(script, new RegExp(`\\$\\{${STUDIO_MYSQL_CLIENT_CONFIG_DIR_ENV}:-\\}`, "u"));
  assert.match(script, /export MYSQL_HOME="\$XDG_RUNTIME_DIR\/vibe64\/mysql-client"/u);
  assert.match(script, /export MYSQL_HOME="\$\{TMPDIR:-\/tmp\}\/vibe64-mysql-client-\$\(id -u\)"/u);
  assert.doesNotMatch(script, /export MYSQL_HOME=\/tmp\/vibe64-mysql-client/u);
});
