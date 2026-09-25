import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { EventEmitter } from "node:events";
import { nativeConversationBindings } from "@local/vibe64-terminals/server/nativeConversationBindings";
import { retireNativeConversation } from "../../packages/vibe64-terminals/src/server/nativeConversationRetirement.js";
import { listClaudeConversationStorage, retireClaudeConversationHistory } from "../../packages/vibe64-terminals/src/server/claudeConversationHistory.js";
import { CodexAppServerAgentProvider } from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import { controllerHarness } from "../fixtures/opencodeController.js";
import { createCodexTerminalController } from "../../packages/vibe64-terminals/src/server/codexTerminal.js";
import { exportCodexNativeHistory } from "../../packages/vibe64-runtime/src/server/codexNativeHistoryExport.js";

const binding = { engineId: "codex", conversationId: "parent", workdir: "/saved/source" };
const proof = async () => ({ preserved: true, exclusive: true });

function codexExportClient() {
  const calls = [];
  const thread = { id: "parent", historyMode: "paginated", status: { type: "notLoaded" }, updatedAt: 1 };
  const goal = { objective: "Finish the project", status: "paused" };
  return { calls, thread, goal, request: async (method, params) => {
    calls.push([method, params]);
    assert.equal(params.threadId, "parent");
    if (method === "thread/read") return { thread: structuredClone(thread) };
    if (method === "thread/goal/get") return { goal: structuredClone(goal) };
    if (method === "thread/turns/list") {
      assert.equal(params.itemsView, "notLoaded");
      return { data: [{ id: "turn", status: "completed", itemsView: "notLoaded", items: [] }] };
    }
    assert.equal(method, "thread/items/list");
    return params.cursor ? { data: [{ turnId: "turn", item: { id: "answer", type: "agentMessage", text: "Saved answer" } }] }
      : { data: [{ turnId: "turn", item: { id: "prompt", type: "userMessage", content: [
        { type: "text", text: "Saved question" }, { type: "image", url: "data:image/png;base64,payload" }
      ] } }], nextCursor: "next" };
  } };
}

function codexExportProvider(native = codexExportClient()) {
  const sockets = [];
  class ExportSocket extends EventEmitter {
    constructor(_endpoint, options) {
      super();
      this.options = options;
      this.readyState = 1;
      sockets.push(this);
      queueMicrotask(() => this.emit("open"));
    }
    send(raw) {
      const { id, method, params } = JSON.parse(raw);
      if (method === "initialized") return;
      void Promise.resolve(method === "initialize" ? {} : native.request(method, params))
        .then((result) => this.emit("message", JSON.stringify({ id, result })));
    }
    close() { this.readyState = 3; this.emit("close"); }
  }
  const provider = new CodexAppServerAgentProvider({ WebSocketImpl: ExportSocket });
  provider.activeClient = async () => ({ endpoint: "ws://native", request: () => assert.fail("shared observer used for export") });
  return { provider, sockets, native };
}

test("Codex modern export pages items independently and preserves goal and readable text without attachments", async () => {
  const client = codexExportClient();
  const records = [];
  const result = await exportCodexNativeHistory(client, "parent", async (record) => { records.push(record); });
  assert.equal(result.turnCount, 1);
  assert.equal(result.itemCount, 2);
  assert.match(result.revision, /^[a-f0-9]{64}$/u);
  assert.deepEqual(records.flatMap((record) => record.text).map(({ role, text }) => ({ role, text })), [
    { role: "goal", text: "Finish the project" }, { role: "user", text: "Saved question" }, { role: "assistant", text: "Saved answer" }
  ]);
  assert.equal(records[3].text[0].messageId, "prompt");
  assert.equal(records[3].text[0].branchId, "parent");
  assert.equal(records[3].item.content[1].url, "data:image/png;base64,payload");
  assert.equal((await exportCodexNativeHistory(client, "parent", async () => {})).revision, result.revision);
  client.goal.objective = "Changed goal";
  assert.notEqual((await exportCodexNativeHistory(client, "parent", async () => {})).revision, result.revision);
});

test("Codex export rejects unsupported modes, active goals, oversized exports, repeating cursors and cancellation", async () => {
  const client = codexExportClient();
  client.thread.historyMode = "legacy";
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}), /requires paginated/);
  client.thread.historyMode = "paginated";
  client.goal.status = "active";
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}), /Pause/);
  client.goal.status = "paused";
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}, { maxBytes: 1 }), /byte limit/);
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}, { maxPages: 1 }), /page limit/);
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}, { signal: AbortSignal.abort() }), { name: "AbortError" });
  const request = client.request;
  client.request = (method, params) => method === "thread/items/list" ? { data: [], nextCursor: "repeat" } : request(method, params);
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => {}), /cursor/);
});

test("Codex export awaits preservation and rejects changed metadata or a failed sink", async () => {
  const client = codexExportClient();
  await assert.rejects(exportCodexNativeHistory(client, "parent", async () => { throw new Error("disk full"); }), /disk full/);
  assert.deepEqual(client.calls.map(([method]) => method), ["thread/read", "thread/goal/get"]);
  await assert.rejects(exportCodexNativeHistory(client, "parent", async (record) => {
    if (record.type === "item") client.thread.updatedAt++;
  }), /changed during export/);
});

test("Codex native export uses a separate bounded JSKIT connection and closes it on sink failure", async () => {
  const { provider, sockets } = codexExportProvider();
  assert.equal((await provider.exportThreadHistory("parent", async () => {})).itemCount, 2);
  await assert.rejects(provider.exportThreadHistory("parent", async () => { throw new Error("disk full"); }), /disk full/);
  assert.equal(sockets.length, 2);
  for (const socket of sockets) {
    assert.equal(socket.options.maxPayload, 64 * 1024 ** 2);
    assert.equal(socket.readyState, 3);
  }
});

test("cancelled retirement waits for its admitted preservation callback before exiting", async () => {
  const { provider, sockets, native } = codexExportProvider();
  const controller = new AbortController();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let callbackFinished = false;
  let settled = false;
  let deleted = false;
  let records = 0;
  const retiring = retireNativeConversation({
    binding,
    inspect: async () => [{ conversationId: "parent" }],
    exportConversation: (id, onRecord) => provider.exportThreadHistory(id, onRecord, { signal: controller.signal }),
    beforeDelete: async ({ exportConversation }) => {
      await exportConversation("parent", async () => {
        records++;
        entered.resolve();
        await release.promise;
        callbackFinished = true;
      });
      return proof();
    },
    remove: async () => { deleted = true; }
  });
  void retiring.then(() => { settled = true; }, () => { settled = true; });
  await entered.promise;
  controller.abort(new Error("cancelled preservation"));
  try {
    await new Promise(setImmediate);
    assert.equal(sockets[0].readyState, 3, "cancellation closes the provider connection immediately");
    assert.equal(settled, false, "retirement still owns the admitted callback");
    assert.equal(callbackFinished, false);
    assert.equal(deleted, false);
    assert.equal(records, 1);
    assert.deepEqual(native.calls.map(([method]) => method), ["thread/read", "thread/goal/get"]);
  } finally { release.resolve(); }
  await assert.rejects(retiring, /cancelled preservation/);
  assert.equal(callbackFinished, true);
  assert.equal(deleted, false);
  assert.equal(records, 1);
});

test("native retirement requires every complete export and rechecks exact content even when metadata is unchanged", async () => {
  let revision = "a".repeat(64);
  let deleted = false;
  const input = { binding, inspect: async () => [{ conversationId: "parent" }],
    remove: async () => { deleted = true; }, exportConversation: async (_id, emit) => { await emit({ type: "item" }); return { revision }; } };
  await assert.rejects(retireNativeConversation({ ...input, beforeDelete: proof }), /complete native export/);
  await assert.rejects(retireNativeConversation({ ...input, beforeDelete: async ({ exportConversation }) => {
    await assert.rejects(exportConversation("foreign", async () => {}), /outside/);
    await exportConversation("parent", async () => {});
    revision = "b".repeat(64);
    return proof();
  } }), /changed during preservation/);
  assert.equal(deleted, false);
});

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
    rows.set(id, { id, historyMode: "paginated", cwd: "/saved/source", path: file, updatedAt: 1, status: { type: "idle" } });
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
      exportThreadHistory: async (id, emit) => { await emit({ type: "thread", thread: rows.get(id) }); return { revision: "a".repeat(64) }; },
      deleteThread: async () => { deleted++; for (const row of rows.values()) if (row.path) await rm(row.path); rows.clear(); }
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
  rows.get("child").historyMode = "legacy";
  await assert.rejects(controller.retireConversationHistory("archived", input, { runtime, session, beforeDelete: proof }), /requires paginated/);
  rows.get("child").historyMode = "paginated";
  await assert.rejects(controller.retireConversationHistory("archived", input, { runtime, session, beforeDelete: proof }), /complete native export/);
  await rm(rows.get("child").path);
  rows.get("child").path = null;
  const result = await controller.retireConversationHistory("archived", input, { runtime, session, beforeDelete: async ({ conversations, exportConversation }) => {
    assert.equal(conversations.length, 2);
    for (const row of conversations) {
      if (row.path) assert.equal(await readFile(row.path, "utf8"), "native history\n");
      else assert.deepEqual(row.files, []);
      await exportConversation(row.conversationId, async (record) => assert.equal(record.thread.id, row.conversationId));
    }
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
  await writeFile(targets[0], [
    { type: "user", uuid: "question", timestamp: "2026-09-25T00:00:00Z", message: { content: [
      { type: "text", text: "Keep the question" }, { type: "image", source: { data: "attachment payload" } }
    ] } },
    { type: "assistant", uuid: "answer", parentUuid: "question", message: { model: "claude-model", content: [{ type: "text", text: "Keep the answer" }] } }
  ].map(JSON.stringify).join("\n") + "\n");
  await writeFile(targets[1], JSON.stringify({ type: "assistant", uuid: "child-answer", isSidechain: true, parent_tool_use_id: "call",
    message: { content: [{ type: "text", text: "Keep the child answer" }] } }) + "\n");
  const originals = new Map(await Promise.all(targets.map(async (file) => [file, await readFile(file, "utf8")])));
  const protectedFiles = [path.join(configRoot, "settings.json"), path.join(project, "memory/MEMORY.md"), path.join(project, "another.jsonl")];
  for (const name of protectedFiles) await write(name);
  return { root, project, configRoot, targets, protectedFiles, originals, binding: { engineId: "claude", conversationId: id, workdir },
    requireIdle: async () => {}, beforeDelete: proof };
}

test("Claude retirement works after source removal, preserves shared files and is idempotent", async (t) => {
  const f = await claudeFixture(t);
  let preserved = 0;
  f.beforeDelete = async ({ conversations, exportConversation }) => {
    assert.equal(conversations.length, 1);
    assert.equal(conversations[0].files.filter((file) => !file.directory).length, 4);
    preserved++;
    for (const target of f.targets) assert.equal(await readFile(target, "utf8"), f.originals.get(target));
    const entries = [];
    await exportConversation(f.binding.conversationId, async (record) => entries.push(...record.text));
    assert.deepEqual(entries.map((entry) => entry.text).sort(), ["Keep the answer", "Keep the child answer", "Keep the question"]);
    assert.equal(new Set(entries.map((entry) => entry.branchId)).size, 2);
    assert.equal(entries.find((entry) => entry.messageId === "question").createdAt, "2026-09-25T00:00:00Z");
    assert.equal(entries.find((entry) => entry.messageId === "answer").modelId, "claude-model");
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
  await assert.rejects(retireClaudeConversationHistory({ ...f, beforeDelete: async ({ exportConversation }) => {
    await exportConversation(f.binding.conversationId, async () => {});
    await writeFile(f.targets[0], f.originals.get(f.targets[0]).replace("Keep the answer", "changed after inventory")); return proof();
  } }), /changed/);
  assert.match(await readFile(f.targets[0], "utf8"), /changed after inventory/);
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
    messages: async () => assert.fail("native preservation must use bounded pages"),
    deleteSession: async (id) => { deleted.push(id); rows.clear(); } };
  const pageCalls = [];
  const h = await controllerHarness({ serverClient: client, listConversationChildren: async (id) => id === "ses_parent" && rows.size
    ? [{ id: "ses_child", parentID: id, directory: rows.get(id).location.directory }] : [],
    readConversationStoragePage: async (id, { before, signal }) => {
      assert.equal(signal.aborted, false);
      pageCalls.push([id, before]);
      return before ? { data: [{ info: { id: "msg_question", sessionID: id, role: "user", time: { created: 123 } },
        parts: [{ type: "text", text: "Keep OpenCode question" }, { type: "file", url: "data:image/png;base64,payload" }] }], nextCursor: null }
        : { data: [{ info: { id: "msg_answer", sessionID: id, role: "assistant", time: { created: 124 }, modelID: "model", providerID: "provider" },
          parts: [{ type: "text", text: "Keep OpenCode answer" }] }], nextCursor: "opaque+/=" };
    } });
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
    runtime: h.runtime, session: { ...h.session, status: "archived" }, beforeDelete: async ({ conversations, exportConversation }) => {
      for (const conversation of conversations) {
        const entries = [];
        await exportConversation(conversation.conversationId, async (record) => entries.push(...record.text));
        assert.deepEqual(entries.map((entry) => entry.text), ["Keep OpenCode answer", "Keep OpenCode question"]);
        assert.equal(entries[0].branchId, conversation.conversationId);
        assert.equal(entries[1].createdAt, new Date(123).toISOString());
        assert.equal(entries[0].modelId, "model");
        assert.equal(entries[0].modelProviderId, "provider");
      }
      return proof();
    }
  });
  assert.deepEqual(result.conversationIds, ["ses_child", "ses_parent"]);
  assert.deepEqual(deleted, ["ses_parent"]);
  assert.deepEqual(inspectedDirectories, [workdir, workdir]);
  assert.deepEqual(pageCalls, ["ses_child", "ses_parent", "ses_child", "ses_parent"].flatMap((id) => [[id, ""], [id, "opaque+/="]]));
  assert.equal(h.promptCalls.length, 0);
  await assert.rejects(stat(workdir), { code: "ENOENT" });
});

test("OpenCode native export rejects incomplete pages, repeated history, caps and cancellation before deletion", async (t) => {
  let deleted = false;
  let nextPage;
  let pageCalls = 0;
  let native;
  const h = await controllerHarness({
    serverClient: { health: async () => ({ healthy: true }), readSession: async () => {
      if (deleted) throw Object.assign(new Error("missing"), { statusCode: 404 });
      return native;
    },
      sessionStatus: async () => ({ type: "idle" }), deleteSession: async () => { deleted = true; } },
    readConversationStoragePage: async (_id, { before, signal }) => {
      signal.throwIfAborted();
      pageCalls++;
      return nextPage(before);
    }
  });
  t.after(async () => { await h.controller.closeAllForProject(); await rm(h.root, { recursive: true, force: true }); });
  native = { id: "ses_parent", location: { directory: h.session.metadata.source_path } };
  const binding = { engineId: "opencode", conversationId: native.id, workdir: native.location.directory };
  const message = (id = "msg_one") => ({ info: { id, sessionID: native.id, role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "Keep text" }] });
  const preserve = async ({ exportConversation }) => { await exportConversation(native.id, async () => {}); return proof(); };
  const retire = (options = {}) => h.controller.retireConversationHistory("session-1", binding, {
    runtime: h.runtime, session: { ...h.session, status: "archived" }, beforeDelete: preserve, ...options
  });
  for (const response of [
    { data: [] }, null, { data: [message(), message("msg_two")], nextCursor: null },
    { data: [], nextCursor: "missing" }, { data: [message()], nextCursor: "x".repeat(8193) }
  ]) {
    nextPage = () => response;
    await assert.rejects(retire(), /incomplete or invalid native message page/);
  }
  for (const row of [message(`msg_${"x".repeat(257)}`), { ...message(), parts: null },
    { ...message(), info: { ...message().info, role: "future-role" } },
    { ...message(), info: { ...message().info, sessionID: "ses_foreign" } }]) {
    nextPage = () => ({ data: [row], nextCursor: null });
    await assert.rejects(retire(), /invalid or duplicate native message/);
  }
  nextPage = () => ({ data: [message()], nextCursor: "repeat" });
  await assert.rejects(retire(), /duplicate native message/);
  nextPage = (before) => ({ data: [message(before ? "msg_two" : "msg_one")], nextCursor: "repeat" });
  await assert.rejects(retire(), /repeated a native history cursor/);
  pageCalls = 0;
  nextPage = () => ({ data: [message(`msg_${pageCalls}`)], nextCursor: `page-${pageCalls}` });
  await assert.rejects(retire(), /page limit/);
  assert.equal(pageCalls, 20_000);
  const controller = new AbortController();
  pageCalls = 0;
  nextPage = () => ({ data: [message()], nextCursor: "unread" });
  await assert.rejects(retire({ signal: controller.signal, beforeDelete: async ({ exportConversation }) => {
    await exportConversation(native.id, async (record) => { if (record.type === "message") controller.abort(); });
    return proof();
  } }), { name: "AbortError" });
  assert.equal(pageCalls, 1);
  assert.equal(deleted, false);
  const emptyRecords = [];
  nextPage = () => ({ data: [], nextCursor: null });
  await retire({ beforeDelete: async ({ exportConversation }) => {
    await exportConversation(native.id, async (record) => emptyRecords.push(record.type));
    return proof();
  } });
  assert.deepEqual(emptyRecords, ["thread"]);
  assert.equal(deleted, true);
});
