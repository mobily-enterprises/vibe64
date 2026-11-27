import assert from "node:assert/strict";
import { access, chmod, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import * as genesisCompiler from "genesis-compiler";

import { createVibe64HostContextRegistry } from "../../packages/vibe64-genesis/src/server/hostContextRegistry.js";
import {
  VIBE64_OPTIONAL_SESSION_CAPABILITIES,
  VIBE64_SESSION_CAPABILITIES,
  vibe64Driver,
  vibe64DriverInputFromRegistry
} from "../../packages/vibe64-genesis/src/server/promptContext.js";

function context(conversationKind) {
  return { scope: "session", conversationKind, session: {
    managedDatabaseRefresh: true, managedEnvironment: true, managedGit: true, managedPreview: true
  } };
}

test("installed host guidance reaches native instructions and stays absent on other hosts", async (t) => {
  const registry = await createVibe64HostContextRegistry();
  t.after(() => registry.close());
  const guidance = "This host supports vibe64-local update; restore returns to the host's default version.";
  const hosted = { ...context("main"), hostGuidance: guidance };
  await registry.register("hosted", hosted);
  const resolved = await vibe64DriverInputFromRegistry({ data: { registryPath: registry.registryPath }, providerSessionId: "hosted", scope: "session" });
  assert.equal(vibe64Driver(resolved).includes(guidance), true);
  assert.equal(vibe64Driver(context("main")).includes("vibe64-local"), false);
  // A host keeps one guidance text, its own commands' lines among them, of at most 1280 bytes.
  assert.equal(vibe64Driver({ ...hosted, hostGuidance: "x".repeat(1280) }).includes("x".repeat(1280)), true);
  assert.throws(() => vibe64Driver({ ...hosted, hostGuidance: "x".repeat(1281) }), /bounded text/);
});

test("a chat agent answers a message sent while it works in visible text, not only in its thinking", () => {
  // Main chat incident, 2026-10-29: three questions sent mid-task were answered
  // only inside Claude's thinking, which the chat shows as progress, not a reply.
  for (const conversationKind of ["main", "temporary"]) {
    const output = vibe64Driver(context(conversationKind));
    assert.match(output, /never your thinking/u);
    assert.match(output, /When they write while you work, reply first with a short visible message \(answer a direct question directly\), then continue\./u);
  }
});

// Release 9's sessions with every capability on passed Genesis's 24 KiB bound, which then dropped all of Genesis's
// project guidance (2026-11-24): this test counted only the first four capabilities, never the Pages block
// (managedPages, 2026-11-06). It counts every capability the driver takes, optional ones included, with the largest
// host guidance, against the bound the installed Genesis exports, and keeps 2 KiB of it spare, so the next addition
// fails here rather than being cut in production. genesis-compiler 1.10.27 and before export no bound (theirs was
// 24 KiB, which this guidance passes): the platform release pins the Genesis that does, and its CI gate runs this.
// It also keeps 4 KiB of room for the next rules (27 Nov 2026: 278 bytes were left): a rule that takes it moves
// detail out of the always-loaded guidance into an on-demand `vibe64-helper spec` that the guidance names.
const GENESIS_SESSION_BOUND = genesisCompiler.HOST_CONTEXT_MAX_BYTES?.session;

test("every session capability combination stays 2 KiB under Genesis's host contribution bound, with 4 KiB of room for new rules", {
  skip: Number.isInteger(GENESIS_SESSION_BOUND) ? false
    : "the installed genesis-compiler exports no HOST_CONTEXT_MAX_BYTES; the platform release pins one that does"
}, () => {
  const bound = GENESIS_SESSION_BOUND;
  const SPARE = 2 * 1024;
  const ROOM = 4 * 1024;
  const hostGuidance = "é".repeat(640); // 1280 UTF-8 bytes, not characters.
  const capabilities = [...VIBE64_SESSION_CAPABILITIES, ...VIBE64_OPTIONAL_SESSION_CAPABILITIES];
  for (const conversationKind of ["main", "temporary"]) {
    for (let mask = 0; mask < 2 ** capabilities.length; mask++) {
      const session = Object.fromEntries(capabilities.map((name, bit) => [name, Boolean(mask & (1 << bit))]));
      const output = vibe64Driver({ scope: "session", conversationKind, session, hostGuidance });
      const bytes = Buffer.byteLength(output.trim(), "utf8");
      assert.ok(bytes + SPARE <= bound,
        `${conversationKind} with ${JSON.stringify(session)} is ${bytes} bytes, less than ${SPARE} under Genesis's ${bound}`);
      assert.ok(bytes + SPARE + ROOM <= bound, `${conversationKind} with ${JSON.stringify(session)} is ${bytes} bytes, ` +
        `leaving less than ${ROOM} bytes for new rules: move detail into an on-demand spec (vibe64-helper spec) the guidance names`);
      assert.ok(output.includes(hostGuidance), "host guidance is retained in full");
    }
  }
  // The combination with everything on has the Pages block, which the earlier loop never turned on.
  const everything = Object.fromEntries(capabilities.map((name) => [name, true]));
  assert.match(vibe64Driver({ scope: "session", conversationKind: "main", session: everything }), /vibe64-helper pages publish/u);
  assert.throws(() => vibe64Driver({ ...context("main"), hostGuidance: hostGuidance + "é" }), /bounded text/);
});

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

test("main chat preserves unchanged ownership and records changed capabilities", async (t) => {
  const registry = await createVibe64HostContextRegistry();
  t.after(() => registry.close());
  await registry.register("native-main", context("main"), "/workspace");
  const first = await stat(registry.registryPath);
  await registry.register("native-main", context("main"), "/workspace");
  assert.equal((await stat(registry.registryPath)).ino, first.ino, "ordinary resume does not rewrite the binding");
  const changed = context("main");
  changed.session.managedPreview = false;
  await registry.register("native-main", changed, "/workspace");
  assert.deepEqual(await vibe64DriverInputFromRegistry({
    data: { registryPath: registry.registryPath }, scope: "session", providerSessionId: "native-main"
  }), changed);
});

test("failed ownership writes retain the durable binding and can be retried", async (t) => {
  const registry = await createVibe64HostContextRegistry();
  t.after(() => registry.close());
  await registry.register("native-main", context("main"), "/workspace");
  const directory = path.dirname(registry.registryPath);
  await chmod(directory, 0o500);
  try {
    await assert.rejects(registry.register("native-main", context("temporary"), "/workspace"));
  } finally {
    await chmod(directory, 0o700);
  }
  assert.deepEqual(registry.get("native-main").promptContext, context("main"));
  assert.deepEqual(JSON.parse(await readFile(registry.registryPath, "utf8")).sessions[0].promptContext, context("main"));
  await registry.register("native-main", context("temporary"), "/workspace");
  assert.deepEqual(registry.get("native-main").promptContext, context("temporary"));
  assert.deepEqual(await readdir(directory), ["sessions.json"], "no temporary registry file outlives a write");
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
