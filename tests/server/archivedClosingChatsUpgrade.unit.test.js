import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { lstat, mkdir, mkdtemp, readdir, readFile, realpath, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import upgrade from "../../packages/vibe64-core/src/server/stateUpgrades/20261110-archived-closing-chats.js";
import { retireArchivedClosingChats } from "../../packages/vibe64-terminals/src/server/archivedClosingChatsUpgrade.js";
import { nativeConversationBindings } from "../../packages/vibe64-terminals/src/server/nativeConversationRetirement.js";
import { removeTemporaryRepairChats } from "../../packages/vibe64-terminals/src/server/temporaryRepairChatsUpgrade.js";

const exec = promisify(execFile);
const claudeId = (number) => `0b5b8c55-0000-4000-8000-00000000000${number}`;
const selection = (engineId) => ({ engineId, modelId: `${engineId}-model` });
const attachmentId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const updateRepair = { title: "Resolve Update", recoveryOperation: "update", recoveryContext: "Merge both sides." };
const closingError = "This conversation could not be closed. Try Close again.";

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

/**
 * A project with: a published archive holding a closing chat (Claude and Codex, with an attachment),
 * a kept chat and an AI task; a renewal's prepared archive holding a closing chat (OpenCode and
 * Claude) and a repair chat with a Codex thread; a second renewal, published since, whose repair chat
 * had an OpenCode session; and a live session with a closing chat. The 20261104 upgrade has run, so
 * its backups name the two repair chats it removed from the prepared archives.
 */
async function fixture(t, { change, afterRepairUpgrade } = {}) {
  const root = await realpath(await mkdtemp(path.join(os.tmpdir(), "vibe64-archived-closing-chats-")));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "state"), configRoot = path.join(root, "claude"), workdir = path.join(root, "source");
  await mkdir(workdir);
  const managedSource = (sessionId) => path.join(root, "managed", "sessions", "active", sessionId, "source");
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(systemRoot, "projects", "example") });
  const env = { CLAUDE_CONFIG_DIR: configRoot };
  const claudeHistory = {};
  async function writeClaudeHistory(conversationId) {
    const filePath = path.join(configRoot, "projects", workdir.replace(/[^a-zA-Z0-9]/gu, "-"), `${conversationId}.jsonl`);
    await mkdir(path.dirname(filePath), { recursive: true });
    await writeFile(filePath, `${JSON.stringify({ type: "user", uuid: conversationId, message: { content: "Close this" } })}\n`);
    claudeHistory[conversationId] = filePath;
  }
  async function writeChat(sessionId, conversationId, record) {
    await store.writeSessionConversation(sessionId, conversationId, record);
    const log = path.join(store.paths(sessionId).conversationsRoot, conversationId, "conversation-log");
    await mkdir(log, { recursive: true });
    await writeFile(path.join(log, "transcript.json"), JSON.stringify({ version: 1, turns: [] }));
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
  const archivedRoot = store.paths().archivedSessionsRoot;
  const prepare = async (sessionId) => {
    await store.writeStatus(sessionId, "archived");
    await store.publishSessionArchive(sessionId);
    const preparedRoot = path.join(archivedRoot, ".renewals", sessionId);
    await mkdir(preparedRoot, { recursive: true });
    for (const suffix of [".tar.gz", ".json"]) await rename(path.join(archivedRoot, `${sessionId}${suffix}`), path.join(preparedRoot, `${sessionId}${suffix}`));
  };

  await createSession("published");
  await store.writeMetadataValue("published", "codex_conversation_id", "019a7c55-main-thread");
  await savedClaude("published", claudeId(1));
  await writeChat("published", "closed", { title: "Temporary 1", state: "closing", error: closingError,
    providerConversationId: claudeId(1), assistantSelection: selection("claude"),
    nativeBindings: { codex: { conversationId: "019a7c55-closed-thread", assistantSelection: selection("codex") } } });
  await writeChat("published", "kept", { title: "Temporary 2", providerConversationId: "ses_kept", assistantSelection: selection("opencode") });
  await writeChat("published", "task", { providerConversationId: "019a7c55-task-thread", assistantSelection: selection("codex"),
    task: { kind: "update" } });
  const attachment = path.join(store.paths("published").artifactsRoot, "attachments", attachmentId);
  await mkdir(attachment, { recursive: true });
  await writeFile(path.join(attachment, "attachment.json"), JSON.stringify({ attachmentId, fileName: "notes.txt", conversationId: "closed" }));
  await writeFile(path.join(attachment, "file"), "attached bytes");
  await writeClaudeHistory(claudeId(1));

  await createSession("renewed");
  await savedClaude("renewed", claudeId(2));
  await writeChat("renewed", "own", { title: "Temporary 1", state: "closing", error: closingError,
    providerConversationId: "ses_closing", assistantSelection: selection("opencode"),
    nativeBindings: { claude: { conversationId: claudeId(2), assistantSelection: selection("claude") } } });
  await writeChat("renewed", "repair", { ...updateRepair, providerConversationId: "019a7c55-repair-thread",
    assistantSelection: selection("codex") });
  await writeClaudeHistory(claudeId(2));

  await createSession("renewed-later");
  await writeChat("renewed-later", "repair", { ...updateRepair, providerConversationId: "ses_repair", assistantSelection: selection("opencode") });

  await createSession("live");
  await writeChat("live", "own", { title: "Temporary 1", state: "closing", error: closingError,
    providerConversationId: "ses_live", assistantSelection: selection("opencode") });

  await change?.({ store, writeChat });
  await store.writeStatus("published", "archived");
  await store.publishSessionArchive("published");
  await prepare("renewed");
  await prepare("renewed-later");
  await removeTemporaryRepairChats({ systemRoot, apply: true, env, report: () => {},
    backupRoot: path.join(systemRoot, "upgrades/backups/20261104-temporary-repair-chats-removed") });
  // That renewal finished since: its prepared archive is published.
  for (const suffix of [".tar.gz", ".json"]) {
    await rename(path.join(archivedRoot, ".renewals", "renewed-later", `renewed-later${suffix}`), path.join(archivedRoot, `renewed-later${suffix}`));
  }
  await afterRepairUpgrade?.({ store, createSession, writeChat, archivedRoot });

  // Engine-owned native storage the upgrade must never touch.
  const codexRollout = path.join(root, "codex/sessions/2026/11/04/rollout-2026-11-04T00-00-00-019a7c55-closed-thread.jsonl");
  await mkdir(path.dirname(codexRollout), { recursive: true });
  await writeFile(codexRollout, "engine-owned");

  const backupRoot = path.join(systemRoot, "upgrades/backups/20261110-archived-closing-chats");
  const reports = [];
  const report = (level, message) => reports.push(`${level}: ${message}`);
  const archives = {
    published: path.join(archivedRoot, "published.tar.gz"),
    renewed: path.join(archivedRoot, ".renewals", "renewed", "renewed.tar.gz"),
    "renewed-later": path.join(archivedRoot, "renewed-later.tar.gz")
  };
  return {
    root, systemRoot, store, backupRoot, reports, claudeHistory, codexRollout, archives,
    livePaths: store.paths("live"),
    sourcePath: managedSource,
    read: async (sessionId) => {
      const scratch = await mkdtemp(path.join(os.tmpdir(), "vibe64-archive-read-"));
      try {
        return await store.readArchivedConversations({ archivePath: archives[sessionId], temporaryRoot: scratch });
      } finally {
        await rm(scratch, { recursive: true, force: true });
      }
    },
    run: (apply, reporter = report) => retireArchivedClosingChats({ systemRoot, apply, backupRoot, report: reporter, env })
  };
}

async function archiveMembers(archive) {
  return (await exec("tar", ["-tzf", archive])).stdout.split("\n").filter(Boolean);
}

const retired = (archive) => JSON.parse(archive.metadata.assistant_changeover || "{}").retiredConversations;

async function assertCleaned(f, claudeBytes) {
  const published = await f.read("published");
  assert.deepEqual(published.conversations.map(record => record.conversationId).sort(), ["kept", "task"]);
  assert.deepEqual(retired(published), [{ conversationId: "019a7c55-closed-thread", assistantSelection: selection("codex"),
    workdir: f.sourcePath("published"), modelProviderId: "openai" }]);
  assert.equal(published.metadata[`claude_conversation_${claudeId(1)}`], undefined);
  const members = await archiveMembers(f.archives.published);
  assert.ok(!members.some(name => name.includes("/conversations/closed")));
  assert.ok(!members.some(name => name.includes(`/attachments/${attachmentId}`)));

  const renewed = await f.read("renewed");
  assert.deepEqual(renewed.conversations, []);
  assert.deepEqual(retired(renewed), [
    { conversationId: "ses_closing", assistantSelection: selection("opencode"), workdir: f.sourcePath("renewed"), modelProviderId: "" },
    { conversationId: "019a7c55-repair-thread", assistantSelection: selection("codex"), workdir: f.sourcePath("renewed"),
      modelProviderId: "openai" }
  ]);
  assert.deepEqual(retired(await f.read("renewed-later")), [{ conversationId: "ses_repair", assistantSelection: selection("opencode"),
    workdir: f.sourcePath("renewed-later"), modelProviderId: "" }]);

  // Claude's history goes, kept in the upgrade's own backup; the engines' own storage and live sessions stay.
  for (const id of [claudeId(1), claudeId(2)]) {
    assert.equal(await exists(f.claudeHistory[id]), false);
    const backup = path.join(f.backupRoot, "claude", path.relative(path.join(f.root, "claude"), f.claudeHistory[id]));
    assert.deepEqual(await readFile(backup), claudeBytes[id]);
  }
  assert.equal(await readFile(f.codexRollout, "utf8"), "engine-owned");
  assert.equal((await f.store.listSessionConversations("live"))[0].state, "closing");

  // The archive's native-history retirement now names each of them, beside its kept chats and AI tasks.
  const bindings = await f.store.withArchivedSession("published", session => nativeConversationBindings(session));
  assert.deepEqual(bindings.map(binding => `${binding.engineId}:${binding.conversationId}:${binding.retired}`).sort(), [
    "codex:019a7c55-closed-thread:true",
    "codex:019a7c55-main-thread:false",
    "codex:019a7c55-task-thread:false",
    "opencode:ses_kept:false"
  ]);
}

test("closing chats in published and prepared archives are found read-only, then deleted with Claude's history, and their " +
  "Codex and OpenCode conversations, with those 20261104 left, are recorded for the archive's retirement", async (t) => {
  const f = await fixture(t);
  const claudeBytes = {};
  for (const [id, filePath] of Object.entries(f.claudeHistory)) claudeBytes[id] = await readFile(filePath);
  const tree = await snapshot(f.root);
  await f.run(false);
  assert.deepEqual(await snapshot(f.root), tree);
  assert.deepEqual(f.reports, [
    "info: example: 2 closing chat(s) or AI task(s) to delete from archives (1 in published archives, 1 in prepared renewal " +
      "archives) with 1 attachment(s).",
    "info: Native conversations: 2 Claude to delete from Claude's own storage; recorded as retired on their archived session, " +
      "for its native-history retirement to delete through the engine: 1 Codex and 1 OpenCode of these chats, and 1 Codex and " +
      "1 OpenCode that 20261104-temporary-repair-chats-removed left; left in the engine's own storage: 0 without a saved folder.",
    "info: 3 state file(s) to change."
  ]);

  f.reports.length = 0;
  await f.run(true);
  await assertCleaned(f, claudeBytes);
  assert.ok(f.reports.includes("info: Deleted 2 Claude native conversation(s); their files are kept in this upgrade's claude/ backup."));
  assert.ok(!f.reports.some(message => message.startsWith("warning:")));
  // Each repacked archive keeps its before and after copies.
  const published = path.relative(f.systemRoot, f.archives.published);
  assert.ok((await archiveMembers(path.join(f.backupRoot, "sessions/before", published))).some(name => name.includes("/conversations/closed/")));
  assert.deepEqual(await readFile(path.join(f.backupRoot, "sessions/after", published)), await readFile(f.archives.published));

  // A rerun does nothing.
  const cleaned = await snapshot(f.root);
  await f.run(true);
  assert.deepEqual(await snapshot(f.root), cleaned);
});

test("an apply interrupted while publishing finishes on its rerun, and a later run changes nothing", async (t) => {
  const f = await fixture(t);
  const claudeBytes = {};
  for (const [id, filePath] of Object.entries(f.claudeHistory)) claudeBytes[id] = await readFile(filePath);
  let interrupted = false;
  await assert.rejects(f.run(true, (_level, message) => {
    if (!interrupted && message.includes("Published state:")) {
      interrupted = true;
      throw new Error("interrupted");
    }
  }), /interrupted/);
  await f.run(true);
  await assertCleaned(f, claudeBytes);
  const cleaned = await snapshot(f.root);
  await f.run(true);
  assert.deepEqual(await snapshot(f.root), cleaned);
});

for (const [label, change, expected, afterRepairUpgrade] of [
  ["a closing chat shares the main chat's Codex conversation", ({ store }) =>
    store.writeMetadataValue("published", "codex_conversation_id", "019a7c55-closed-thread"),
  /published \(archive\)\/closed: its Codex conversation is also the main chat's, an AI task's or a kept chat's/],
  ["a closing chat shares an AI task's Codex conversation", ({ store }) =>
    store.writeSessionConversation("published", "task", { providerConversationId: "019a7c55-closed-thread" }),
  /its Codex conversation is also/],
  ["a closing chat shares a kept chat's Claude conversation", ({ store }) =>
    store.writeSessionConversation("published", "kept", { providerConversationId: claudeId(1), assistantSelection: selection("claude") }),
  /its Claude conversation is also/],
  ["a repair chat 20261104 left shares a kept chat", null,
    /example\/renewed-later \(20261104-temporary-repair-chats-removed\): its OpenCode conversation is also/,
    // The session that archive now holds has a chat with that OpenCode session.
    async ({ store, createSession, writeChat, archivedRoot }) => {
      for (const suffix of [".tar.gz", ".json"]) await rm(path.join(archivedRoot, `renewed-later${suffix}`));
      await createSession("renewed-later");
      await writeChat("renewed-later", "kept", { title: "Temporary 1", providerConversationId: "ses_repair", assistantSelection: selection("opencode") });
      await store.writeStatus("renewed-later", "archived");
      await store.publishSessionArchive("renewed-later");
    }],
  ["a closing chat's native bindings are unreadable", ({ store }) =>
    store.writeSessionConversation("published", "closed", { nativeBindings: "lost" }),
  /closed: its native bindings are unreadable/],
  ["a kept chat names an engine Vibe64 does not know", ({ store }) =>
    store.writeSessionConversation("published", "kept", { assistantSelection: selection("other") }),
  /kept: it names a native conversation Vibe64 does not know/],
  ["an archived chat record cannot be read", ({ store }) =>
    writeFile(path.join(store.paths("published").conversationsRoot, "kept", "conversation.json"), "{ not json"),
  /Invalid temporary conversation record/]
]) {
  test(`an archive where ${label} stops the upgrade before any change`, async (t) => {
    const f = await fixture(t, { change, afterRepairUpgrade });
    const tree = await snapshot(f.root);
    await assert.rejects(f.run(true), expected);
    assert.deepEqual(await snapshot(f.root), tree);
  });
}

test("the numbered upgrade requires its Terminals owner and passes the runner's context through", async () => {
  await assert.rejects(upgrade.run({ systemRoot: "/state" }), /candidate upgrade-state command/);
  const calls = [];
  await upgrade.run({ systemRoot: "/state", apply: true, retireArchivedClosingChats: async (context) => calls.push(context) });
  assert.deepEqual(calls, [{ systemRoot: "/state", apply: true }]);
  assert.equal(upgrade.id, "20261110-archived-closing-chats");
});
