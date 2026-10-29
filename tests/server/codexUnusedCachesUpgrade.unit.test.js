import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261029-codex-unused-caches.js";
import { removeUnusedCodexCaches } from "@local/vibe64-core/server/codexCacheUpgrade";
import { codexProviderPaths } from "@local/vibe64-core/server/codexProviderConnections";

const pluginCaches = [".tmp/plugins/README.md", ".tmp/plugins.sha", ".tmp/plugins.sync.lock", ".tmp/git-a1/HEAD",
  "cache/remote_plugin_catalog/catalog.json", "cache/codex_apps_tools/tools.json", "cache/codex_apps_server_info/info.json",
  "cache/bundled_plugin_exclusions/list.json"];
const runtimeOnly = ["logs_2.sqlite", "logs_2.sqlite-wal", "logs_2.sqlite-shm", "tmp/arg0/apply_patch"];
const state = ["auth.json", "config.toml", "models.json", "state_5.sqlite", "goals_1.sqlite", "sessions/2026/10/09/rollout.jsonl",
  "plugins/cache/installed/plugin.json", ".tmp/marketplaces/configured.json"];
const missing = (file) => stat(file).then(() => false, (error) => error.code === "ENOENT");

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-codex-caches-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const systemRoot = path.join(home, ".local/state/vibe64");
  const write = async (directory, entries) => {
    for (const entry of entries) {
      await mkdir(path.dirname(path.join(directory, entry)), { recursive: true });
      await writeFile(path.join(directory, entry), "native");
    }
  };
  const subscription = path.join(home, ".codex");
  const connected = codexProviderPaths(systemRoot, "zai", "codex");
  const removed = codexProviderPaths(systemRoot, "deepseek", "codex");
  await write(subscription, [...pluginCaches, ...runtimeOnly, ...state]);
  await write(connected.codexHome, [...pluginCaches, ...runtimeOnly, ...state]);
  await write(removed.codexHome, [...pluginCaches, ...runtimeOnly, ...state.filter((entry) => entry !== "config.toml")]);
  await writeFile(connected.connectionPath, JSON.stringify({ apiKey: "fixture-secret" }));
  const messages = [];
  const run = (apply) => upgrade.run({ systemRoot, apply, home, backupRoot: path.join(systemRoot, "upgrades/backups", upgrade.id),
    report: (level, message) => messages.push({ level, message }), removeUnusedCodexCaches });
  return { root, home, systemRoot, subscription, connected, removed, messages, run, write };
}

test("check reports and apply removes plugin and app caches everywhere and a removed connection's runtime data", async (t) => {
  const f = await fixture(t);
  await f.run(false);
  for (const home of [f.subscription, f.connected.codexHome, f.removed.codexHome]) {
    for (const entry of [...pluginCaches, ...runtimeOnly, ...state.filter((name) => home !== f.removed.codexHome || name !== "config.toml")]) {
      assert.equal(await missing(path.join(home, entry)), false, `check keeps ${home} ${entry}`);
    }
  }
  assert.ok(f.messages.some(({ message }) => /3 Codex home/u.test(message)), JSON.stringify(f.messages));
  assert.equal(JSON.stringify(f.messages).includes("fixture-secret"), false);
  await f.run(true);
  for (const home of [f.subscription, f.connected.codexHome]) {
    for (const entry of pluginCaches) assert.equal(await missing(path.join(home, entry)), true, `${home} ${entry}`);
    for (const entry of [...runtimeOnly, ...state]) assert.equal(await readFile(path.join(home, entry), "utf8"), "native", `${home} ${entry}`);
  }
  for (const entry of [".tmp", "cache", "tmp", "logs_2.sqlite", "logs_2.sqlite-wal", "logs_2.sqlite-shm"]) {
    assert.equal(await missing(path.join(f.removed.codexHome, entry)), true, `removed ${entry}`);
  }
  for (const entry of ["auth.json", "models.json", "state_5.sqlite", "goals_1.sqlite", "sessions/2026/10/09/rollout.jsonl", "plugins/cache/installed/plugin.json"]) {
    assert.equal(await readFile(path.join(f.removed.codexHome, entry), "utf8"), "native", `removed keeps ${entry}`);
  }
  assert.equal(await readFile(f.connected.connectionPath, "utf8"), JSON.stringify({ apiKey: "fixture-secret" }));
  f.messages.length = 0;
  await f.run(true);
  assert.ok(f.messages.some(({ message }) => /No unused Codex caches/u.test(message)), "a retry has nothing left to do");
});

test("installations without Codex homes pass, and linked parents or homes are never followed", async (t) => {
  const f = await fixture(t);
  await rm(f.home, { recursive: true });
  await f.run(true);
  assert.deepEqual(f.messages, [{ level: "info", message: "No unused Codex caches." }]);
  const outside = path.join(f.root, "outside");
  await f.write(path.join(outside, ".codex"), pluginCaches);
  await mkdir(f.home, { recursive: true });
  await symlink(path.join(outside, ".codex"), f.subscription);
  const providerParent = path.dirname(f.removed.toolHomeSource);
  await mkdir(path.dirname(providerParent), { recursive: true });
  await symlink(outside, providerParent);
  f.messages.length = 0;
  await f.run(true);
  for (const entry of pluginCaches) assert.equal(await missing(path.join(outside, ".codex", entry)), false, entry);
  assert.deepEqual(f.messages.filter(({ level }) => level === "warning").map(({ message }) => message.split(" ")[0]).sort(),
    ["ai-connections/codex/deepseek/home/.codex", "~/.codex"], JSON.stringify(f.messages));
  await assert.rejects(upgrade.run({ systemRoot: f.systemRoot, apply: false, report() {} }), /Codex cache owner is required/u);
});
