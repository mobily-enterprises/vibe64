// Every editor state writer that replaces a file does it through Core's atomic
// file writer, so the file is durable once the write returns: its data reached
// the disk before the rename, and its folder after it. A power cut then leaves
// the old file or the new one, never an empty one the next start cannot read.
import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, stat } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { writeJsonFile as writeAccountJson } from "../../packages/vibe64-accounts/src/server/accountFiles.js";
import { createAiConnectionStore } from "../../packages/vibe64-accounts/src/server/aiConnectionStore.js";
import { createAgeStore } from "../../packages/vibe64-packaging/src/server/keys/index.js";
import { writeJsonFile as writePublishingJson } from "../../packages/vibe64-publishing/src/server/state/jsonFile.js";
import { fileIdentity, writeJsonFile as writeSessionJson, writeTextFile } from "../../packages/vibe64-runtime/src/server/sessionFiles.js";
import { mutateSourceEditorExplanationCleanupRecords } from "../../packages/vibe64-source-editor/src/server/explanationRecords.js";
import { manageWorkPlan } from "../../packages/vibe64-terminals/src/server/assistantWorkPlan.js";
import { createClaudeConversationStorage } from "../../packages/vibe64-terminals/src/server/claudeConversationStorage.js";
import { writeJsonFile as writeUsageJson } from "../../packages/vibe64-usage-recording/src/server/traceStore.js";
import { assertDurablyReplaced, traceDurableWrites } from "./durableWriteTrace.js";

async function temporaryRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-durable-writers-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  return root;
}

test("session files are durable, and the identity a write returns names the published file", async (t) => {
  const root = await temporaryRoot(t);
  const events = await traceDurableWrites(t);
  const text = path.join(root, "sessions", "one", "metadata", "title");
  const identity = await writeTextFile(text, "A title");
  assertDurablyReplaced(events, text);
  assert.equal(identity, fileIdentity(await stat(text, { bigint: true })));
  const json = path.join(root, "sessions", "one", "session.json");
  await writeSessionJson(json, { id: "one" });
  assertDurablyReplaced(events, json);
});

test("a GitHub account's status is durable and private", async (t) => {
  const root = await temporaryRoot(t);
  const events = await traceDurableWrites(t);
  const status = path.join(root, "auth", "github", "users", "owner", "status.json");
  await writeAccountJson(status, { ok: true });
  assertDurablyReplaced(events, status);
  assert.equal((await stat(status)).mode & 0o777, 0o600);
});

test("publishing state is durable, with its mode", async (t) => {
  const root = await temporaryRoot(t);
  const events = await traceDurableWrites(t);
  const targets = path.join(root, "publishing", "targets.json");
  await writePublishingJson(targets, { targets: [] }, { mode: 0o640 });
  assertDurablyReplaced(events, targets);
  assert.equal((await stat(targets)).mode & 0o777, 0o640);
});

test("a usage recording's records are durable, with their mode", async (t) => {
  const root = await temporaryRoot(t);
  const events = await traceDurableWrites(t);
  const recording = path.join(root, "recordings", "one", "recording.json");
  await mkdir(path.dirname(recording), { recursive: true });
  await writeUsageJson(recording, { state: "recording" });
  assertDurablyReplaced(events, recording);
  assert.equal((await stat(recording)).mode & 0o777, 0o660);
});

test("AI connections are durable", async (t) => {
  const root = await temporaryRoot(t);
  const events = await traceDurableWrites(t);
  const connections = path.join(root, "private", "connections.json");
  const revision = `sha256:${"a".repeat(64)}`;
  const store = createAiConnectionStore({
    filePath: connections,
    onConnectionChanged: () => null,
    readModelIds: async () => [],
    verifyConnection: async () => ({ ok: true })
  });
  await store.upsertConnection({ apiKey: "test-only-secret", modelProviderId: "opencode", providerRevision: revision }, {
    provider: {
      defaultModelId: "opencode-default",
      definitionRevision: revision,
      id: "opencode",
      label: "opencode",
      models: [{ id: "opencode-default", status: "available" }]
    }
  });
  assertDurablyReplaced(events, connections);
});

test("publishing keys and their index are durable", async (t) => {
  const root = await temporaryRoot(t);
  const events = await traceDurableWrites(t);
  const keys = createAgeStore({ directory: path.join(root, "keys"), workFactor: 10 });
  await keys.create({ passphrase: "correct horse battery staple", windowMs: 60_000 });
  await keys.put("account:npm-main", { value: "test-only-token", kind: "account", label: "npm", meta: {} });
  assertDurablyReplaced(events, path.join(root, "keys", "keys.age"));
  assertDurablyReplaced(events, path.join(root, "keys", "keys-index.json"));
});

test("a session's source explanation ledger is durable", async (t) => {
  const root = await temporaryRoot(t);
  const events = await traceDurableWrites(t);
  await mutateSourceEditorExplanationCleanupRecords({ sourceEditorTempRoot: root },
    () => [{ agentThreadId: "thread-1", id: "explanation-1" }]);
  assertDurablyReplaced(events, path.join(root, "source-editor-explanation-cleanup.json"));
});

test("a session's work plan is durable", async (t) => {
  const root = await temporaryRoot(t);
  const events = await traceDurableWrites(t);
  const sessionId = "test-session";
  const sessionRoot = path.join(root, sessionId);
  const context = { session: { sessionId }, runtime: { store: {
    paths: () => ({ sessionRoot, conversationsRoot: path.join(sessionRoot, "conversations") })
  } } };
  await manageWorkPlan(context, { operation: "new", expectedRevision: "", expectedProgressRevision: "",
    text: "# Plan\n\n- [ ] One step\n" }, "senior");
  const planWrites = events.filter((event) => event.op === "rename");
  assert.ok(planWrites.length > 0, "the plan was published by rename");
  for (const { to } of planWrites) assertDurablyReplaced(events, to);
});

test("a retained Claude conversation is durable", async (t) => {
  const root = await temporaryRoot(t);
  const events = await traceDurableWrites(t);
  const sessionId = "test-session";
  const storage = createClaudeConversationStorage({ createError: (message) => new Error(message) });
  const runtimeRoot = path.join(root, "helper-runtime");
  await storage.save({
    accountIdentity: "",
    id: "conversation-1",
    persistent: true,
    sent: 0,
    context: { assistantScope: { runtimeRoot }, sessionId, workdir: root }
  });
  const conversation = path.join(runtimeRoot, "claude-conversations", sessionId, "conversation-1.json");
  assertDurablyReplaced(events, conversation);
  assert.equal(JSON.parse(await readFile(conversation, "utf8")).schemaVersion, 1);
});
