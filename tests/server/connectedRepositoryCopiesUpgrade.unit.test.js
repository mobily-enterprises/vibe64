import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261106-connected-repository-copies.js";
import { removeConnectedSessionLinks } from "../../packages/vibe64-runtime/src/server/connectedRepositoryCopiesUpgrade.js";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";

const setup = JSON.stringify({ status: "succeeded", recipeHash: "a".repeat(64), transcript: "Prepared." });

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-connected-links-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state");
  const projectRuntimeRoot = path.join(systemRoot, "projects", "example");
  const store = createVibe64SessionStore({ projectContextRoot: projectRuntimeRoot, projectRuntimeRoot });
  const backupRoot = path.join(systemRoot, "upgrades", "backups", upgrade.id);
  async function session(sessionId, metadata) {
    await store.createSession({ runtimeKind: "genesis", sessionId });
    for (const [name, value] of Object.entries(metadata)) await store.writeMetadataValue(sessionId, name, value);
  }
  await session("consumer", {
    connected_sources: JSON.stringify({ sources: [{ projectSlug: "library" }] }),
    repository_update_check: JSON.stringify({ checkedAt: "2026-11-05T00:00:00.000Z" }),
    workspace_setup: setup,
    base_commit: "b".repeat(40)
  });
  await session("receiving", {
    connected_contribution: JSON.stringify({ contributionId: "123" }),
    connected_submissions: "[]",
    connected_session_name: "Library work",
    workspace_setup: setup
  });
  await session("plain", { repository_update_check: "{}", workspace_setup: setup });
  await session("renewing", { connected_sources: "{}" });
  await writeFile(store.paths("renewing").statusPath, "renewal_quiesced\n");
  const messages = [];
  const run = (apply) => upgrade.run({
    apply, backupRoot, removeConnectedSessionLinks, systemRoot, report: (level, message) => messages.push([level, message])
  });
  return { backupRoot, messages, run, store };
}

test("connected repository copies upgrade checks, backs up and removes session links while sessions keep their other records", async (t) => {
  const f = await fixture(t);
  const before = Object.fromEntries(await Promise.all(["consumer", "receiving", "plain", "renewing"]
    .map(async (id) => [id, await f.store.readMetadata(id)])));

  await f.run(false);
  for (const id of Object.keys(before)) assert.deepEqual(await f.store.readMetadata(id), before[id]);
  await assert.rejects(readFile(path.join(f.backupRoot, "example", "consumer.json")), { code: "ENOENT" });
  assert.ok(f.messages.some(([, message]) => message.includes("example/consumer: would remove connected_sources, repository_update_check and prepare its workspace again")));
  assert.ok(f.messages.some(([level, message]) => level === "warning" && message.includes("example/renewing: skipped")));

  await f.run(true);
  const consumer = await f.store.readMetadata("consumer");
  assert.equal(consumer.connected_sources, undefined);
  assert.equal(consumer.repository_update_check, undefined);
  assert.equal(consumer.base_commit, "b".repeat(40));
  assert.deepEqual(JSON.parse(consumer.workspace_setup), { ...JSON.parse(setup), recipeHash: "" });
  const receiving = await f.store.readMetadata("receiving");
  for (const name of ["connected_contribution", "connected_submissions", "connected_session_name"]) assert.equal(receiving[name], undefined);
  assert.equal(receiving.workspace_setup, setup);
  assert.deepEqual(await f.store.readMetadata("plain"), before.plain);
  assert.deepEqual(await f.store.readMetadata("renewing"), before.renewing);

  const backup = JSON.parse(await readFile(path.join(f.backupRoot, "example", "consumer.json"), "utf8"));
  assert.deepEqual(backup, { schemaVersion: 1, project: "example", sessionId: "consumer", metadata: {
    connected_sources: before.consumer.connected_sources,
    repository_update_check: before.consumer.repository_update_check,
    workspace_setup: setup
  } });

  // A repeated apply finds nothing left and keeps the first backup.
  f.messages.length = 0;
  await f.run(true);
  assert.deepEqual(JSON.parse(await readFile(path.join(f.backupRoot, "example", "consumer.json"), "utf8")), backup);
  assert.ok(f.messages.some(([, message]) => message.includes("0 session(s) upgraded; 1 skipped")));
});

test("connected repository copies upgrade refuses to replace a backup that differs from the session record", async (t) => {
  const f = await fixture(t);
  const backupPath = path.join(f.backupRoot, "example", "consumer.json");
  await f.run(false);
  await mkdir(path.dirname(backupPath), { recursive: true });
  await writeFile(backupPath, "{}\n");
  await assert.rejects(f.run(true), /backup for example\/consumer differs/u);
  assert.ok((await f.store.readMetadata("consumer")).connected_sources);
});

test("connected repository copies upgrade requires the candidate's session record owner", async () => {
  await assert.rejects(upgrade.run({ apply: false, report() {} }), /session record owner is required/u);
});
