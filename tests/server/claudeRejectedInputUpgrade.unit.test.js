import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { claudeNativeMessageId } from "@jskit-ai/assistant-core/server/claude-turn";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { rejectedClaudeInputChanges, upgradeClaudeRejectedInput } from "../../packages/vibe64-terminals/src/server/assistantClaudeDeliveryUpgrade.js";

const threadId = "c117ec52-748a-4b8a-8a1b-d70653ab3732";
const messageId = "records-catchup-1";
const uuid = claudeNativeMessageId(messageId);
const guard = "Claude has no active turn for this message.";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-rejected-input-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const workdir = path.join(root, "source");
  const configRoot = path.join(root, "claude");
  await mkdir(workdir);
  const nativePath = path.join(configRoot, "projects", workdir.replace(/[^a-zA-Z0-9]/gu, "-"), `${threadId}.jsonl`);
  await mkdir(path.dirname(nativePath), { recursive: true });
  const history = JSON.stringify({ type: "user", uuid: "previous-message", message: { content: "original message" } }) + "\n";
  await writeFile(nativePath, history);
  const request = { schemaVersion: 5, messageId, attemptedMessageId: messageId, threadId,
    status: "waiting", delivery: "uncertain", error: "Delivery uncertain", submittedBy: { username: "owner" },
    input: { messageId, message: "Keep the original words", attachments: [{ id: "original" }] } };
  const native = { executionId: "", main: true, state: "interrupted", lastMessageId: uuid, turnId: uuid,
    nativeWorkdir: workdir, accountIdentity: "preserved-account" };
  const run = { id: "claude_stream_json", engineId: "claude", active: false, state: "interrupted",
    threadId, turnId: uuid, error: guard };
  const metadata = { assistant_routing_request: JSON.stringify(request), [`claude_conversation_${threadId}`]: JSON.stringify(native) };
  return { root, workdir, configRoot, nativePath, history, request, native, run, metadata,
    changes: () => rejectedClaudeInputChanges({ metadata, runs: [run], configRoot }) };
}

test("exact pre-write rejection becomes an explicit retry without changing input or native state", async t => {
  const f = await fixture(t);
  const original = structuredClone(f.metadata);
  const changed = await f.changes();
  const next = JSON.parse(changed.assistant_routing_request);
  const { attemptedMessageId, ...retained } = f.request;
  assert.deepEqual(next, { ...retained, status: "waiting", delivery: "failed", error: guard });
  assert.deepEqual(f.metadata, original);
  assert.equal(await readFile(f.nativePath, "utf8"), f.history);
  delete f.request.input.messageId; // Main routing retains message identity on the outer request.
  f.metadata.assistant_routing_request = JSON.stringify(f.request);
  assert.equal(JSON.parse((await f.changes()).assistant_routing_request).delivery, "failed");
});

test("timeouts and unrelated interrupted runs never establish nondelivery", async t => {
  const f = await fixture(t);
  for (const error of ["Claude initialize timed out.", "Delivery uncertain", "Interrupted", ""]) {
    f.run.error = error;
    assert.deepEqual(await f.changes(), {});
  }
});

test("conflicting request, native binding or run evidence refuses repair", async t => {
  for (const patch of [
    f => { f.request.attemptedMessageId = "another"; },
    f => { f.request.input.messageId = "another"; },
    f => { f.request.followup = { messageId: "followup" }; },
    f => { f.run.threadId = "another"; },
    f => { f.run.turnId = "another"; },
    f => { f.run.active = true; },
    f => { f.native.executionId = "running"; },
    f => { f.native.lastMessageId = "another"; },
    f => { f.native.turnId = "another"; }
  ]) {
    const f = await fixture(t);
    patch(f);
    f.metadata.assistant_routing_request = JSON.stringify(f.request);
    f.metadata[`claude_conversation_${threadId}`] = JSON.stringify(f.native);
    await assert.rejects(f.changes(), /conflicting delivery evidence/u);
  }
});

test("native receipt, missing history and an incomplete native tail refuse repair", async t => {
  const f = await fixture(t);
  await writeFile(f.nativePath, f.history + JSON.stringify({ type: "user", uuid, message: { content: "already sent" } }) + "\n");
  await assert.rejects(f.changes(), /conflicting delivery evidence/u);
  await writeFile(f.nativePath, f.history + '{"type":');
  await assert.rejects(f.changes());
  await rm(f.nativePath);
  await assert.rejects(f.changes(), /conflicting delivery evidence/u);
});

test("publisher preflight is read-only; apply backs up exact original and supports interrupted retry", async t => {
  const f = await fixture(t);
  const oldConfig = process.env.CLAUDE_CONFIG_DIR;
  process.env.CLAUDE_CONFIG_DIR = f.configRoot;
  t.after(() => { if (oldConfig === undefined) delete process.env.CLAUDE_CONFIG_DIR; else process.env.CLAUDE_CONFIG_DIR = oldConfig; });
  const systemRoot = path.join(f.root, "state");
  const store = createVibe64SessionStore({ projectContextRoot: f.workdir, projectRuntimeRoot: path.join(systemRoot, "projects/example") });
  await store.createSession({ runtimeKind: "genesis", sessionId: "repair" });
  for (const [key, value] of Object.entries(f.metadata)) await store.writeMetadataValue("repair", key, value);
  await store.writeAgentRunEvent("repair", f.run.id, { patch: f.run });
  const routePath = path.join(systemRoot, "projects/example/sessions/active/repair/metadata/assistant_routing_request");
  const before = await readFile(routePath, "utf8");
  const backupRoot = path.join(systemRoot, "upgrades/backups/20261016-claude-rejected-input");
  const context = { systemRoot, backupRoot, report() {} };
  await upgradeClaudeRejectedInput({ ...context, apply: false });
  assert.equal(await readFile(routePath, "utf8"), before);
  await assert.rejects(stat(backupRoot), { code: "ENOENT" });
  await upgradeClaudeRejectedInput({ ...context, apply: true });
  const after = await readFile(routePath, "utf8");
  assert.equal(JSON.parse(after).delivery, "failed");
  const beforePath = path.join(backupRoot, "before", path.relative(systemRoot, routePath));
  assert.equal(await readFile(beforePath, "utf8"), before);
  await writeFile(routePath, before);
  await upgradeClaudeRejectedInput({ ...context, apply: true });
  assert.equal(await readFile(routePath, "utf8"), after);
  await writeFile(f.nativePath, f.history + JSON.stringify({ type: "user", uuid, message: { content: "late receipt" } }) + "\n");
  await assert.rejects(upgradeClaudeRejectedInput({ ...context, apply: true }), /conflicting delivery evidence/u);
  await writeFile(f.nativePath, f.history);
  await writeFile(routePath, "changed externally");
  await assert.rejects(upgradeClaudeRejectedInput({ ...context, apply: true }), /differs from both upgrade copies/u);
  assert.equal(await readFile(beforePath, "utf8"), before);
  assert.equal(await readFile(f.nativePath, "utf8"), f.history);
});
