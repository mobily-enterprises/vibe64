import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261104-temporary-repair-chats-removed.js";
import { removeTemporaryRepairChats } from "../../packages/vibe64-terminals/src/server/temporaryRepairChatsUpgrade.js";

const exec = promisify(execFile);
const claudeId = (number) => `0b5b8c55-0000-4000-8000-00000000000${number}`;
const ids = { main: claudeId(1), live: claudeId(2), task: claudeId(3), closing: claudeId(4), prepared: claudeId(5), archived: claudeId(6),
  mine: claudeId(9) };
const attachments = { live: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa", task: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
  mine: "cccccccc-cccc-4ccc-8ccc-cccccccccccc" };
const selection = (engineId) => ({ engineId, modelId: `${engineId}-model` });
const claudeChat = (conversationId) => ({ providerConversationId: conversationId, assistantSelection: selection("claude") });
// The repair fields as the person's own chat saved them before AI tasks: present and empty.
const EMPTY_REPAIR_FIELDS = {
  displayMessage: "", completionMessage: "", dedupeKey: "", failureMessage: "", nextStepMessage: "", recoveryNotice: "",
  recoveryOperation: "", recoveryConflictId: "", recoveryContext: "", recoveryOutcome: "", recoveryOutcomeMessage: "",
  recoveryRequestId: "", runConflictId: "", recoveryAutoPaused: false, recoveryRetryKeys: []
};
// An Update repair since Fix it with AI saved its context, and an older workspace setup repair.
const updateRepair = { ...EMPTY_REPAIR_FIELDS, title: "Resolve Update", recoveryOperation: "update", recoveryContext: "Merge both sides." };
const setupRepair = { title: "Fix workspace preparation", dedupeKey: "workspace-setup:closing", completionMessage: "Workspace ready." };

async function snapshot(root) {
  const entries = {};
  async function walk(directory) {
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const filePath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        entries[path.relative(root, filePath)] = "directory";
        await walk(filePath);
      } else {
        entries[path.relative(root, filePath)] = createHash("sha256").update(await readFile(filePath)).digest("hex");
      }
    }
  }
  await walk(root);
  return entries;
}

async function exists(filePath) {
  return lstat(filePath).then(() => true, (error) => {
    if (error.code === "ENOENT") return false;
    throw error;
  });
}

async function fixture(t, { preparedCodex = false } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "vibe64-temporary-conversations-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state"), configRoot = path.join(root, "claude"), workdir = path.join(root, "source");
  await mkdir(workdir);
  const managedSource = (sessionId) => path.join(root, "managed", "sessions", "active", sessionId, "source");
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(systemRoot, "projects", "example") });
  const claudeHistory = {};
  async function writeClaudeHistory(directory, conversationId) {
    const filePath = path.join(configRoot, "projects", directory.replace(/[^a-zA-Z0-9]/gu, "-"), `${conversationId}.jsonl`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ type: "user", uuid: conversationId, message: { content: "Fix the build" } })}\n`);
    claudeHistory[conversationId] = filePath;
  }
  async function writeChat(sessionId, conversationId, record, transcript = true) {
    await store.writeSessionConversation(sessionId, conversationId, record);
    if (!transcript) return;
    const log = path.join(store.paths(sessionId).conversationsRoot, conversationId, "conversation-log");
    await mkdir(log, { recursive: true });
    await writeFile(path.join(log, "transcript.json"), JSON.stringify({ version: 1, turns: [] }));
  }
  async function writeAttachment(sessionId, attachmentId, conversationId) {
    const directory = path.join(store.paths(sessionId).artifactsRoot, "attachments", attachmentId);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, "attachment.json"), JSON.stringify({ attachmentId, fileName: "notes.txt", conversationId }));
    await writeFile(path.join(directory, "file"), "attached bytes");
  }
  async function createSession(sessionId) {
    await store.createSession({ sessionId, runtimeKind: "genesis" });
    for (const [name, value] of Object.entries({
      source_path: managedSource(sessionId),
      source_path_authority: "managed_session_source",
      source_kind: "session_clone"
    })) await store.writeMetadataValue(sessionId, name, value);
  }
  const savedClaude = (sessionId, conversationId) =>
    store.writeMetadataValue(sessionId, `claude_conversation_${conversationId}`, JSON.stringify({ nativeWorkdir: workdir }));

  // A live session: a Claude Update repair chat (with Codex retained), an OpenCode Fix it with AI chat
  // retried twice, the person's own Claude chat, Colleague's OpenCode chat and an AI task.
  await createSession("live");
  await store.writeMetadataValue("live", "claude_conversation_id", ids.main);
  await savedClaude("live", ids.main);
  await savedClaude("live", ids.live);
  await savedClaude("live", ids.mine);
  await writeChat("live", "repair", { ...updateRepair, ...claudeChat(ids.live),
    nativeBindings: { codex: { conversationId: "019a7c55-codex-thread", assistantSelection: selection("codex") } } });
  await writeChat("live", "retried", { ...EMPTY_REPAIR_FIELDS, title: "Fix preview", recoveryRetryKeys: ["preview:1", "preview:2"],
    providerConversationId: "ses_retried", assistantSelection: selection("opencode") });
  await writeChat("live", "mine", { ...EMPTY_REPAIR_FIELDS, title: "Temporary 1", draft: "Which index is missing?", ...claudeChat(ids.mine) });
  await writeChat("live", "review-1", { title: "Review the change", providerConversationId: "ses_review", assistantSelection: selection("opencode") });
  await writeChat("live", "task", { ...claudeChat(ids.task), task: { kind: "update" } });
  await writeAttachment("live", attachments.live, "repair");
  await writeAttachment("live", attachments.task, "task");
  await writeAttachment("live", attachments.mine, "mine");
  for (const id of [ids.main, ids.live, ids.task, ids.mine]) await writeClaudeHistory(workdir, id);

  // A closing session whose repair chat has no saved Claude folder, so its managed source names it.
  await createSession("closing");
  await writeChat("closing", "repair", { ...setupRepair, ...claudeChat(ids.closing) });
  await writeClaudeHistory(managedSource("closing"), ids.closing);
  const closingRoot = path.join(store.paths().closingSessionsRoot, "closing");
  await mkdir(path.dirname(closingRoot), { recursive: true });
  await rename(store.paths("closing").sessionRoot, closingRoot);

  // A renewal's prepared archive (whose repair chat may also hold a Codex thread) and an ordinary archive.
  for (const sessionId of ["renewed", "archived"]) {
    await createSession(sessionId);
    await savedClaude(sessionId, ids[sessionId === "renewed" ? "prepared" : "archived"]);
    const codex = sessionId === "renewed" && preparedCodex
      ? { nativeBindings: { codex: { conversationId: "019a7c55-prepared-thread", assistantSelection: selection("codex") } } } : {};
    await writeChat(sessionId, "repair", { ...updateRepair, ...claudeChat(ids[sessionId === "renewed" ? "prepared" : "archived"]), ...codex });
    await writeChat(sessionId, "task", { ...claudeChat(claudeId(sessionId === "renewed" ? 7 : 8)), task: { kind: "save" } }, false);
    await writeClaudeHistory(workdir, ids[sessionId === "renewed" ? "prepared" : "archived"]);
    await store.writeStatus(sessionId, "archived");
    await store.publishSessionArchive(sessionId);
  }
  const archivedRoot = store.paths().archivedSessionsRoot;
  const preparedRoot = path.join(archivedRoot, ".renewals", "renewed");
  await mkdir(preparedRoot, { recursive: true });
  for (const suffix of [".tar.gz", ".json"]) await rename(path.join(archivedRoot, `renewed${suffix}`), path.join(preparedRoot, `renewed${suffix}`));

  // Engine-owned native storage the upgrade must never touch.
  const codexRollout = path.join(root, "codex/sessions/2026/11/04/rollout-2026-11-04T00-00-00-019a7c55-codex-thread.jsonl");
  const opencodeDatabase = path.join(root, "opencode/opencode.db");
  for (const filePath of [codexRollout, opencodeDatabase]) {
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, "engine-owned");
  }

  const backupRoot = path.join(systemRoot, "upgrades/backups/20261104-temporary-repair-chats-removed");
  const reports = [];
  const report = (level, message) => reports.push(`${level}: ${message}`);
  return {
    root, systemRoot, store, backupRoot, reports, claudeHistory, codexRollout, opencodeDatabase,
    livePaths: store.paths("live"),
    closingRoot,
    preparedArchive: path.join(preparedRoot, "renewed.tar.gz"),
    ordinaryArchive: path.join(archivedRoot, "archived.tar.gz"),
    run: (apply, reporter = report) => removeTemporaryRepairChats({
      systemRoot, apply, backupRoot, report: reporter,
      env: { CLAUDE_CONFIG_DIR: configRoot }
    })
  };
}

async function archiveMembers(archive) {
  return (await exec("tar", ["-tzf", archive])).stdout.split("\n").filter(Boolean);
}

async function assertClosed(f, { ordinaryArchive, claudeBytes, kept, handed }) {
  const live = f.livePaths;
  // Live repair chats with Codex or OpenCode conversations wait for Close as interrupted Closes, with what they own.
  for (const chat of ["repair", "retried"]) {
    assert.deepEqual(JSON.parse(await readFile(path.join(live.conversationsRoot, chat, "conversation.json"), "utf8")), handed[chat]);
    assert.equal(await exists(path.join(live.conversationsRoot, chat, "conversation-log/transcript.json")), true);
  }
  // The person's chat and Colleague's are read back exactly as they were saved.
  for (const chat of ["mine", "review-1", "task"]) {
    assert.deepEqual(await readFile(path.join(live.conversationsRoot, chat, "conversation.json")), kept[chat]);
  }
  assert.deepEqual((await f.store.listSessionConversations("live")).map(record => record.conversationId).sort(),
    ["mine", "repair", "retried", "review-1", "task"]);
  assert.equal(await exists(path.join(live.artifactsRoot, "attachments", attachments.live, "file")), true);
  assert.equal(await exists(path.join(live.artifactsRoot, "attachments", attachments.task, "file")), true);
  assert.equal(await exists(path.join(live.artifactsRoot, "attachments", attachments.mine, "file")), true);
  assert.equal(await exists(path.join(live.metadataRoot, `claude_conversation_${ids.live}`)), false);
  assert.equal(await exists(path.join(live.metadataRoot, `claude_conversation_${ids.main}`)), true);
  assert.equal(await exists(path.join(live.metadataRoot, `claude_conversation_${ids.mine}`)), true);
  assert.equal(await exists(path.join(f.closingRoot, "conversations/repair")), false);
  const members = await archiveMembers(f.preparedArchive);
  assert.ok(members.some((name) => name.endsWith("/conversations/task/conversation.json")));
  assert.ok(!members.some((name) => name.includes("/conversations/repair")));
  assert.ok(!members.some((name) => name.endsWith(`/claude_conversation_${ids.prepared}`)));
  assert.deepEqual(await readFile(f.ordinaryArchive), ordinaryArchive);
  for (const id of [ids.live, ids.closing, ids.prepared]) {
    assert.equal(await exists(f.claudeHistory[id]), false);
    const backup = path.join(f.backupRoot, "claude", path.relative(path.join(f.root, "claude"), f.claudeHistory[id]));
    assert.deepEqual(await readFile(backup), claudeBytes[id]);
  }
  for (const id of [ids.main, ids.task, ids.archived, ids.mine]) assert.deepEqual(await readFile(f.claudeHistory[id]), claudeBytes[id]);
  assert.equal(await readFile(f.codexRollout, "utf8"), "engine-owned");
  assert.equal(await readFile(f.opencodeDatabase, "utf8"), "engine-owned");
}

async function originals(f) {
  const claudeBytes = {};
  for (const [id, filePath] of Object.entries(f.claudeHistory)) claudeBytes[id] = await readFile(filePath);
  const kept = {};
  for (const chat of ["mine", "review-1", "task"]) kept[chat] = await readFile(path.join(f.livePaths.conversationsRoot, chat, "conversation.json"));
  const record = async chat => JSON.parse(await readFile(path.join(f.livePaths.conversationsRoot, chat, "conversation.json"), "utf8"));
  const repair = await record("repair"), retried = await record("retried");
  const waiting = engine => `Vibe64 deletes this old repair chat and its ${engine} conversation after ${engine} next works in this session. ` +
    "Close deletes them now.";
  // The Claude conversation goes with the upgrade; the Codex one and OpenCode's current one stay bound for Close.
  const handed = {
    repair: { ...repair, state: "closing", error: waiting("Codex"), providerConversationId: "" },
    retried: { ...retried, state: "closing", error: waiting("OpenCode"), providerConversationId: "ses_retried", nativeBindings: {
      opencode: { conversationId: "ses_retried", assistantSelection: selection("opencode"), agentSettings: {}, runId: "", messageId: "" }
    } }
  };
  return {
    ordinaryArchive: await readFile(f.ordinaryArchive),
    claudeBytes,
    kept,
    handed,
    repairRecord: await readFile(path.join(f.livePaths.conversationsRoot, "repair/conversation.json"))
  };
}

test("old repair chats are found read-only, then deleted with their attachments and Claude history or handed to Close, " +
  "and the person's chats stay", async (t) => {
  const f = await fixture(t);
  const before = await originals(f);
  const tree = await snapshot(f.root);
  await f.run(false);
  assert.deepEqual(await snapshot(f.root), tree);
  assert.deepEqual(f.reports, [
    "info: example: 2 old repair chat(s) to delete (1 in live sessions, 1 in prepared renewal archives) with 0 attachment(s), " +
      "and 2 to hand to Close, which deletes each with its Codex or OpenCode conversation; 2 temporary chat(s) and 2 AI task " +
      "conversation(s) kept.",
    "info: Native conversations of these repair chats: 3 Claude to delete from Claude's own storage; 1 Codex and 1 OpenCode handed " +
      "to Close, which deletes each through its engine after that engine's next turn in its session; left in their engine's own " +
      "storage: 0 Claude without a saved folder, and 0 Codex and 0 OpenCode of prepared renewal archives, which no Close reaches.",
    "info: 6 state file(s) to change."
  ]);

  f.reports.length = 0;
  await f.run(true);
  await assertClosed(f, before);
  assert.deepEqual(
    await readFile(path.join(f.backupRoot, "sessions/before", path.relative(f.systemRoot, f.livePaths.conversationsRoot), "repair/conversation.json")),
    before.repairRecord
  );
  assert.ok(f.reports.includes("info: Deleted 3 Claude native conversation(s); their files are kept in this upgrade's claude/ backup."));
  assert.ok(f.reports.includes("info: Removed 1 emptied conversation and attachment folder(s)."));
  assert.ok(!f.reports.some((message) => message.startsWith("warning:")));

  const closed = await snapshot(f.root);
  await f.run(true);
  assert.deepEqual(await snapshot(f.root), closed);
});

for (const stage of ["state file(s) to change", "Published state:"]) {
  test(`an apply interrupted at "${stage}" finishes on its rerun`, async (t) => {
    const f = await fixture(t);
    const before = await originals(f);
    let interrupted = false;
    await assert.rejects(f.run(true, (_level, message) => {
      if (!interrupted && message.includes(stage)) {
        interrupted = true;
        throw new Error("interrupted");
      }
    }), /interrupted/);
    await f.run(true);
    await assertClosed(f, before);
    const closed = await snapshot(f.root);
    await f.run(true);
    assert.deepEqual(await snapshot(f.root), closed);
  });
}

for (const [label, change, expected] of [
  ["shares the main chat's Claude conversation", (f) => f.store.writeSessionConversation("live", "repair", claudeChat(ids.main)),
    /also the main chat's, an AI task's or a kept chat's/],
  ["shares an AI task's Claude conversation", (f) => f.store.writeSessionConversation("live", "repair", claudeChat(ids.task)),
    /also the main chat's, an AI task's or a kept chat's/],
  ["shares the person's own chat's Claude conversation", (f) => f.store.writeSessionConversation("live", "repair", claudeChat(ids.mine)),
    /also the main chat's, an AI task's or a kept chat's/],
  ["shares the main chat's Codex conversation", (f) => f.store.writeMetadataValue("live", "codex_conversation_id", "019a7c55-codex-thread"),
    /its Codex conversation is also the main chat's, an AI task's or a kept chat's/],
  ["shares an AI task's OpenCode conversation", (f) => f.store.writeSessionConversation("live", "task", {
    providerConversationId: "ses_retried", assistantSelection: selection("opencode") }), /its OpenCode conversation is also/],
  ["shares Colleague's chat's OpenCode conversation", (f) => f.store.writeSessionConversation("live", "review-1", {
    providerConversationId: "ses_retried" }), /its OpenCode conversation is also/],
  ["has unreadable native bindings", (f) => f.store.writeSessionConversation("live", "repair", { nativeBindings: "lost" }),
    /native bindings are unreadable/],
  ["names an unknown engine", (f) => f.store.writeSessionConversation("live", "repair", { assistantSelection: selection("other") }),
    /native conversation Vibe64 does not know/],
  ["has an unreadable AI task", (f) => f.store.writeSessionConversation("live", "task", { task: "update" }),
    /AI task is unreadable/]
]) {
  test(`a repair chat that ${label} stops the upgrade before any change`, async (t) => {
    const f = await fixture(t);
    await change(f);
    const tree = await snapshot(f.root);
    await assert.rejects(f.run(true), expected);
    assert.deepEqual(await snapshot(f.root), tree);
  });
}

test("a live repair chat with Codex and OpenCode waits for the person's Close, and a prepared archive's Codex thread is " +
  "reported left", async (t) => {
  const f = await fixture(t, { preparedCodex: true });
  await f.store.writeSessionConversation("live", "retried", {
    nativeBindings: { codex: { conversationId: "019a7c55-retried-thread", assistantSelection: selection("codex") } }
  });
  await f.run(false);
  assert.ok(f.reports.includes(
    "warning: example/live/retried: it holds Codex and OpenCode conversations, so it is deleted when the person closes it."));
  assert.ok(f.reports.includes("info: Native conversations of these repair chats: 3 Claude to delete from Claude's own storage; " +
    "2 Codex and 1 OpenCode handed to Close, which deletes each through its engine after that engine's next turn in its session; " +
    "left in their engine's own storage: 0 Claude without a saved folder, and 1 Codex and 0 OpenCode of prepared renewal " +
    "archives, which no Close reaches."));
  await f.run(true);
  const retried = JSON.parse(await readFile(path.join(f.livePaths.conversationsRoot, "retried/conversation.json"), "utf8"));
  assert.equal(retried.state, "closing");
  assert.equal(retried.error, "This old repair chat holds Codex and OpenCode conversations. Close deletes it with them.");
  assert.deepEqual(Object.keys(retried.nativeBindings).sort(), ["codex", "opencode"]);
  assert.ok(!(await archiveMembers(f.preparedArchive)).some((name) => name.includes("/conversations/repair")));
});

test("the numbered upgrade requires its Terminals owner and passes the runner's context through", async () => {
  await assert.rejects(upgrade.run({ systemRoot: "/state" }), /candidate upgrade-state command/);
  const calls = [];
  await upgrade.run({ systemRoot: "/state", apply: true, removeTemporaryRepairChats: async (context) => calls.push(context) });
  assert.deepEqual(calls, [{ systemRoot: "/state", apply: true }]);
  assert.equal(upgrade.id, "20261104-temporary-repair-chats-removed");
});
