import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { nativeConversationBindings, retireNativeConversation } from "../../packages/vibe64-terminals/src/server/nativeConversationRetirement.js";
import { listClaudeConversationStorage, retireClaudeConversationHistory } from "../../packages/vibe64-terminals/src/server/claudeConversationHistory.js";
import { CodexAppServerAgentProvider } from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import { controllerHarness } from "../fixtures/opencodeController.js";
import { createCodexTerminalController } from "../../packages/vibe64-terminals/src/server/codexTerminal.js";

const binding = { engineId: "codex", conversationId: "parent", workdir: "/saved/source" };
const proof = async () => ({ preserved: true, exclusive: true });

test("native retirement preserves the complete scope before removal and verifies absence", async () => {
  let rows = [{ conversationId: "parent", modified: 1 }, { conversationId: "child", modified: 2 }];
  const calls = [];
  const input = { binding, inspect: async () => { calls.push("inspect"); return rows; },
    beforeDelete: async (inventory) => {
      calls.push("preserve");
      assert.deepEqual(inventory.conversations, rows);
      inventory.conversations.length = 0; // The host cannot change deletion's snapshot.
      return proof();
    }, remove: async (scope) => { calls.push("delete"); assert.equal(scope.length, 2); rows = []; } };
  assert.deepEqual(await retireNativeConversation(input), { ok: true, alreadyAbsent: false, conversationIds: ["parent", "child"] });
  assert.deepEqual(calls, ["inspect", "preserve", "inspect", "delete", "inspect"]);
  calls.length = 0;
  assert.equal((await retireNativeConversation(input)).alreadyAbsent, true);
  assert.deepEqual(calls, ["inspect"]);
});

test("native retirement refuses missing proofs, changing history and unconfirmed deletion", async () => {
  let deleted = 0;
  const input = { binding, inspect: async () => [{ conversationId: "parent", modified: 1 }], remove: async () => deleted++ };
  await assert.rejects(retireNativeConversation(input), /callback/);
  for (const result of [undefined, {}, { preserved: true }, { exclusive: true }]) {
    await assert.rejects(retireNativeConversation({ ...input, beforeDelete: async () => result }), /did not confirm/);
  }
  let revision = 0;
  await assert.rejects(retireNativeConversation({ ...input, beforeDelete: proof,
    inspect: async () => [{ conversationId: "parent", modified: ++revision }] }), /changed/);
  assert.equal(deleted, 0);
  await assert.rejects(retireNativeConversation({ ...input, beforeDelete: proof }), /not confirmed/);
  assert.equal(deleted, 1);
});

test("saved inventory separates main bindings from acknowledged predecessors and preserves physical Codex homes", () => {
  const session = { metadata: { codex_conversation_id: "routed", codex_conversation_workdir: "/one",
    codex_routing_home_provider: "openai", "codex_zai-coding-plan_conversation_id": "older",
    "codex_zai-coding-plan_conversation_workdir": "/two", assistant_changeover: JSON.stringify({
      retiredConversations: [{ conversationId: "retired", assistantSelection: { engineId: "codex", modelProviderId: "deepseek" },
        modelProviderId: "openai", workdir: "/three" }] }) } };
  const retired = nativeConversationBindings(session, { retiredOnly: true });
  assert.equal(retired.length, 1);
  assert.equal(retired[0].modelProviderId, "openai");
  assert.deepEqual(nativeConversationBindings(session).map((row) => [row.conversationId, row.modelProviderId]),
    [["retired", "openai"], ["routed", "openai"], ["older", "zai-coding-plan"]]);
});

test("Codex descendant discovery includes archived, CLI and spawned conversations with bounded pagination", async () => {
  const provider = new CodexAppServerAgentProvider();
  const calls = [];
  provider.activeClient = async () => ({ request: async (method, params) => {
    calls.push(params);
    assert.equal(method, "thread/list");
    assert.equal(params.ancestorThreadId, "parent");
    assert.equal(Object.hasOwn(params, "cwd"), false);
    assert.ok(params.sourceKinds.includes("cli") && params.sourceKinds.includes("subAgentThreadSpawn"));
    if (params.archived) return { data: [{ id: "archived-child" }], nextCursor: null };
    return params.cursor ? { data: [{ id: "second-child" }] } : { data: [{ id: "first-child" }], nextCursor: "next" };
  } });
  assert.deepEqual(await provider.listThreadDescendants("parent"), ["archived-child", "first-child", "second-child"]);
  assert.equal(calls.length, 3);
  provider.activeClient = async () => ({ request: async () => ({ data: [{ id: "child" }], nextCursor: "repeat" }) });
  await assert.rejects(provider.listThreadDescendants("parent"), /cursor/);
});

test("Codex native storage inventory discovers independent CLI roots as well as archived forks", async () => {
  const provider = new CodexAppServerAgentProvider();
  provider.activeClient = async () => ({ request: async (method, params) => {
    assert.equal(method, "thread/list");
    assert.equal(params.cwd, "/saved/source");
    assert.equal(Object.hasOwn(params, "ancestorThreadId"), false);
    assert.ok(params.sourceKinds.includes("cli"));
    return { data: [{ id: params.archived ? "fork" : "new", cwd: "/saved/source" }] };
  } });
  assert.deepEqual(await provider.listNativeThreadsForCwd("/saved/source"), ["fork", "new"]);
  provider.activeClient = async () => ({ request: async () => ({ data: [{ id: "foreign", cwd: "/elsewhere" }] }) });
  await assert.rejects(provider.listNativeThreadsForCwd("/saved/source"), /invalid entry/);
});

test("Codex retirement uses native deletion only after preserving idle descendants and verifying their rollout files", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-codex-retirement-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const home = path.join(root, "home");
  const rows = new Map();
  for (const id of ["parent", "child"]) {
    const file = path.join(home, ".codex/sessions", `${id}.jsonl`);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, "native history\n");
    rows.set(id, { id, cwd: "/saved/source", path: file, updatedAt: 1, status: { type: "idle" } });
  }
  const session = { sessionId: "archived", status: "archived", metadata: {} };
  const runtime = { projectContextRoot: root, stateRoot: path.join(root, "state"), getSession: async () => session };
  let deleted = 0;
  const controller = createCodexTerminalController({
    env: { VIBE64_SYSTEM_ROOT: path.join(root, "system"), VIBE64_RUNTIME_NAMESPACE: "test" },
    codexToolHomeSource: home, codexToolHomeRequired: false,
    projectService: { createRuntime: async () => runtime, currentTargetRoot: () => root, currentServiceDataRoot: () => path.join(root, "service") },
    codexAppServerProviderFactory: () => ({
      ensureAvailable: async () => ({ ok: true }),
      listThreadDescendants: async () => rows.has("child") ? ["child"] : [],
      readThreadStatus: async (id) => {
        if (!rows.has(id)) throw Object.assign(new Error(`thread ${id} not found`), { code: -32600, method: "thread/read" });
        return { raw: rows.get(id) };
      },
      deleteThread: async () => { deleted++; for (const row of rows.values()) await rm(row.path); rows.clear(); }
    })
  });
  const input = { ...binding, modelProviderId: "openai" };
  rows.get("child").status.type = "active";
  await assert.rejects(controller.retireConversationHistory("archived", input, { runtime, session, beforeDelete: proof }), /idle native family/);
  rows.get("child").status.type = "idle";
  rows.get("child").cwd = "/another/session";
  await assert.rejects(controller.retireConversationHistory("archived", input, { runtime, session, beforeDelete: proof }), /exact saved directory/);
  rows.get("child").cwd = binding.workdir;
  assert.equal(deleted, 0);
  const result = await controller.retireConversationHistory("archived", input, { runtime, session, beforeDelete: async ({ conversations }) => {
    assert.equal(conversations.length, 2);
    for (const row of conversations) assert.equal(await readFile(row.path, "utf8"), "native history\n");
    return proof();
  } });
  assert.deepEqual(result.conversationIds, ["child", "parent"]);
  assert.equal(deleted, 1);
});

async function claudeFixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-native-retirement-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const configRoot = path.join(root, "claude");
  const workdir = path.join(root, "removed-source");
  const id = "12345678-1234-4234-8234-123456789abc";
  const project = path.join(configRoot, "projects", workdir.replace(/[^a-zA-Z0-9]/gu, "-"));
  const write = async (name) => { await mkdir(path.dirname(name), { recursive: true }); await writeFile(name, "preserved native bytes"); };
  const targets = [path.join(project, `${id}.jsonl`), path.join(project, id, "subagents/agent.jsonl"),
    path.join(configRoot, "file-history", id, "checkpoint"), path.join(configRoot, "uploads", id, "image.png")];
  for (const name of targets) await write(name);
  const protectedFiles = [path.join(configRoot, "settings.json"), path.join(project, "memory/MEMORY.md"), path.join(project, "another.jsonl")];
  for (const name of protectedFiles) await write(name);
  return { root, project, configRoot, targets, protectedFiles, binding: { engineId: "claude", conversationId: id, workdir },
    requireIdle: async () => {}, beforeDelete: proof };
}

test("Claude retirement works after source removal, preserves shared files and is idempotent", async (t) => {
  const f = await claudeFixture(t);
  let preserved = 0;
  f.beforeDelete = async ({ conversations }) => {
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].files.filter((file) => !file.directory).length, 4);
    preserved++;
    for (const target of f.targets) assert.equal(await readFile(target, "utf8"), "preserved native bytes");
    return proof();
  };
  assert.equal((await retireClaudeConversationHistory(f)).ok, true);
  for (const target of f.targets) await assert.rejects(stat(target), { code: "ENOENT" });
  for (const file of f.protectedFiles) assert.equal(await readFile(file, "utf8"), "preserved native bytes");
  assert.equal((await retireClaudeConversationHistory(f)).alreadyAbsent, true);
  assert.equal(preserved, 1);
});

test("Claude inventory discovers additional native roots without silently claiming ownership", async (t) => {
  const f = await claudeFixture(t);
  const other = "23456789-1234-4234-8234-123456789abc";
  await writeFile(path.join(f.project, `${other}.jsonl`), "native fork");
  assert.deepEqual((await listClaudeConversationStorage(f)).map((row) => row.conversationId), [f.binding.conversationId, other]);
  assert.equal(await readFile(path.join(f.project, `${other}.jsonl`), "utf8"), "native fork");
});

test("Claude retirement rejects writers, symlinks and changed files without deleting history", async (t) => {
  const f = await claudeFixture(t);
  await assert.rejects(retireClaudeConversationHistory({ ...f, requireIdle: async () => { throw new Error("busy"); } }), /busy/);
  const link = path.join(f.project, f.binding.conversationId, "outside");
  await symlink(f.protectedFiles[0], link);
  await assert.rejects(retireClaudeConversationHistory(f), /unsafe paths/);
  await rm(link);
  await assert.rejects(retireClaudeConversationHistory({ ...f, beforeDelete: async () => {
    await writeFile(f.targets[0], "changed after inventory"); return proof();
  } }), /changed/);
  assert.equal(await readFile(f.targets[0], "utf8"), "changed after inventory");
});

test("OpenCode retirement does not recreate archived source or make inference and checks the complete child family", async (t) => {
  const rows = new Map();
  const deleted = [];
  const inspectedDirectories = [];
  let busyChild = true;
  const client = { health: async () => ({ healthy: true }),
    forDirectory(directory) { inspectedDirectories.push(directory); return this; },
    readSession: async (id) => { if (!rows.has(id)) throw Object.assign(new Error("missing"), { statusCode: 404 }); return rows.get(id); },
    sessionStatus: async (id) => ({ type: busyChild && id === "ses_child" ? "busy" : "idle" }),
    deleteSession: async (id) => { deleted.push(id); rows.clear(); } };
  const h = await controllerHarness({ serverClient: client, listConversationChildren: async (id) => id === "ses_parent" && rows.size
    ? [{ id: "ses_child", parentID: id, directory: rows.get(id).location.directory }] : [] });
  t.after(async () => { await h.controller.closeAllForProject(); await rm(h.root, { recursive: true, force: true }); });
  const workdir = h.session.metadata.source_path;
  for (const id of ["ses_parent", "ses_child"]) rows.set(id, { id, location: { directory: workdir }, time: { updated: 1 } });
  await rm(workdir, { recursive: true });
  const binding = { engineId: "opencode", conversationId: "ses_parent", workdir };
  await assert.rejects(h.controller.retireConversationHistory("session-1", binding, {
    runtime: h.runtime, session: { ...h.session, status: "archived" },
    beforeDelete: async () => assert.fail("A busy child must block preservation and deletion.")
  }), /idle native family/);
  assert.deepEqual(deleted, []);
  busyChild = false;
  const result = await h.controller.retireConversationHistory("session-1", binding, {
    runtime: h.runtime, session: { ...h.session, status: "archived" }, beforeDelete: proof
  });
  assert.deepEqual(result.conversationIds, ["ses_child", "ses_parent"]);
  assert.deepEqual(deleted, ["ses_parent"]);
  assert.deepEqual(inspectedDirectories, [workdir, workdir]);
  assert.equal(h.promptCalls.length, 0);
  await assert.rejects(stat(workdir), { code: "ENOENT" });
});
