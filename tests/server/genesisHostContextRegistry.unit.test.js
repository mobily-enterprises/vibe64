import assert from "node:assert/strict";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import test from "node:test";

import { createVibe64HostContextRegistry } from "../../packages/vibe64-genesis/src/server/hostContextRegistry.js";
import { vibe64DriverInputFromRegistry } from "../../packages/vibe64-genesis/src/server/promptContext.js";

function context(conversationKind) {
  return { scope: "session", conversationKind, session: {
    managedDatabaseRefresh: true, managedEnvironment: true, managedGit: true, managedPreview: true
  } };
}

test("Genesis hooks resolve concurrent native conversations without mixing their context", async (t) => {
  const registry = await createVibe64HostContextRegistry();
  t.after(() => registry.close());
  const main = context("main");
  const temporary = context("temporary");
  await Promise.all([registry.register("codex-main", main), registry.register("claude-temporary", temporary)]);
  main.conversationKind = "temporary";
  const resolve = (providerSessionId, scope = "session") => vibe64DriverInputFromRegistry({
    data: { registryPath: registry.registryPath }, providerSessionId, scope
  });
  assert.deepEqual(await resolve("codex-main"), context("main"));
  assert.deepEqual(await resolve("claude-temporary"), context("temporary"));
  assert.equal(await resolve("unknown-conversation"), null);
  assert.equal(await resolve("codex-main", "turn"), null);
  const saved = JSON.parse(await readFile(registry.registryPath, "utf8"));
  assert.deepEqual(saved.sessions.map(({ upstreamSessionId }) => upstreamSessionId), ["codex-main", "claude-temporary"]);
});

test("Genesis context registration validates inputs and releases its disposable file", async () => {
  const registry = await createVibe64HostContextRegistry();
  try {
    await assert.rejects(registry.register("", context("main")), /native conversation ID/u);
    await assert.rejects(registry.register("bad", context("invalid")), /unknown conversationKind/u);
    assert.deepEqual(JSON.parse(await readFile(registry.registryPath, "utf8")), { sessions: [] });
  } finally {
    await registry.close();
  }
  await assert.rejects(access(registry.registryPath), { code: "ENOENT" });
  await assert.rejects(registry.register("closed", context("main")), /registry is closed/u);
});

test("Genesis context survives a controller restart at the same native runtime path", async (t) => {
  const root = await mkdtemp("/tmp/vibe64-genesis-registry-restart-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const first = await createVibe64HostContextRegistry(root);
  await first.register("native-main", context("main"), "/workspace/source");
  await first.close();
  const next = await createVibe64HostContextRegistry(root);
  t.after(() => next.close());
  assert.equal(next.registryPath, first.registryPath);
  await next.register("native-temporary", context("temporary"), "/workspace/source");
  assert.deepEqual(await vibe64DriverInputFromRegistry({
    data: { registryPath: next.registryPath }, scope: "session", providerSessionId: "native-main"
  }), context("main"));
  assert.equal(JSON.parse(await readFile(next.registryPath, "utf8")).sessions[0].workdir, "/workspace/source");
});
