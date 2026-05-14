import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import {
  APP_TEST_TESTRUN_COMMAND_CONFIG,
  resolveAppTestConfig
} from "../../packages/current-app/src/server/service.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(tmpdir(), "jskit-studio-config-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

test("app-test config defaults to a single build-and-server test run command", async () => {
  await withTemporaryRoot(async (root) => {
    const config = await resolveAppTestConfig(root);
    assert.equal(config.commandSource, "legacy_split_commands");
    assert.equal(config.testrunCommand, "npm run build;npm run server");
    assert.equal(config.preferredPort, 4100);
  });
});

test("app-test config reads testrun_command from .jskit config", async () => {
  await withTemporaryRoot(async (root) => {
    await mkdir(path.join(root, ".jskit", "config"), {
      recursive: true
    });
    await writeFile(
      path.join(root, APP_TEST_TESTRUN_COMMAND_CONFIG),
      "npm run build;npm run server -- --bypass-localhost-check\n",
      "utf8"
    );

    const config = await resolveAppTestConfig(root);
    assert.equal(config.commandSource, APP_TEST_TESTRUN_COMMAND_CONFIG);
    assert.equal(config.testrunCommand, "npm run build;npm run server -- --bypass-localhost-check");
    assert.equal(config.buildCommand, "");
    assert.equal(config.serverCommand, "");
  });
});

test("app-test config keeps legacy split command files as fallback", async () => {
  await withTemporaryRoot(async (root) => {
    await mkdir(path.join(root, "config"), {
      recursive: true
    });
    await writeFile(path.join(root, "config", "build_command"), "npm run compile\n", "utf8");
    await writeFile(path.join(root, "config", "server_command"), "npm run serve\n", "utf8");

    const config = await resolveAppTestConfig(root);
    assert.equal(config.commandSource, "legacy_split_commands");
    assert.equal(config.buildCommand, "npm run compile");
    assert.equal(config.serverCommand, "npm run serve");
    assert.equal(config.testrunCommand, "npm run compile;npm run serve");
  });
});
