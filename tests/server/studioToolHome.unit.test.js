import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  STUDIO_MYSQL_CLIENT_CONFIG_DIR_ENV,
  studioMysqlClientConfigSetupLines,
  studioToolHomeSetupLines,
  studioUserStartupScript
} from "../../packages/studio-terminal-core/src/server/studioToolHome.js";
import {
  NPM_CONFIG_PREFIX_ENV,
  PLAYWRIGHT_BROWSERS_PATH_ENV,
  VIBE64_SHARED_CACHE_ROOT_ENV
} from "../../packages/vibe64-execution/src/server/index.js";

const execFileAsync = promisify(execFile);

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

test("database command startup reaches the requested command with workspace TMPDIR", async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-database-command-tmp-"));
  const workspaceTempDir = path.join(root, "workspace-tmp");
  const home = path.join(root, "home");
  const mysqlHome = path.join(workspaceTempDir, `vibe64-mysql-client-${process.getuid()}`);
  try {
    await mkdir(workspaceTempDir, {
      mode: 0o2770
    });
    const script = studioUserStartupScript([
      "bash",
      "-lc",
      "printf 'install-started\\n'"
    ]);
    const result = await execFileAsync("bash", ["-lc", script], {
      encoding: "utf8",
      env: {
        DB_HOST: "127.0.0.1",
        DB_NAME: "app_test",
        DB_PASSWORD: "test-password",
        DB_PORT: "3306",
        DB_USER: "app_test",
        HOME: home,
        NPM_CONFIG_PREFIX: path.join(home, ".local"),
        PATH: process.env.PATH,
        PLAYWRIGHT_BROWSERS_PATH: "/opt/vibe64/runtime-packs/playwright/browsers",
        TMPDIR: workspaceTempDir,
        VIBE64_SHARED_CACHE_ROOT: "/var/cache/vibe64"
      }
    });

    assert.equal(result.stdout, "install-started\n");
    assert.match(await readFile(path.join(mysqlHome, "my.cnf"), "utf8"), /database=app_test/u);
    assert.equal((await stat(mysqlHome)).mode & 0o777, 0o700);
    assert.equal((await stat(path.join(mysqlHome, "my.cnf"))).mode & 0o777, 0o600);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});
