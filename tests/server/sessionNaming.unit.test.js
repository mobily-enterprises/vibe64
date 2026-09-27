import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, rm, readdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { createSessionNaming, parseSessionName } from "../../packages/vibe64-terminals/src/server/sessionNaming.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-session-name-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: path.join(root, "runtime") });
  await store.createSession({ sessionId: "original-id", runtimeKind: "genesis" });
  const selection = { engineId: "codex", modelProviderId: "openai", modelId: "helper-model", agentId: "codex", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}` };
  const actor = { role: "member", username: "ada" };
  const context = { vibe64User: actor, session: { sessionId: "original-id", metadata: { assistant_selection: JSON.stringify(selection) } }, runtime: { stateRoot: root, store } };
  const calls = [];
  const events = [];
  const warnings = [];
  const profile = { profileId: "helper", workloadId: "session_title", providerId: "codex", revision: "helper-v1", model: "helper-model", thinking: "low",
    limits: { maxInputCharacters: 24000, maxOutputCharacters: 512, timeoutMs: 30000 },
    policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
    request: { allowProviderModelFallback: false, reasoning: true, summary: false } };
  const agent = {
    async resolveAssistantPurpose(input, options) {
      calls.push("resolve");
      assert.deepEqual(input, { purpose: "session_title", workflowEngineId: "codex" });
      assert.equal(options.vibe64User, actor);
      return { available: true, effectiveSelection: selection, connectionIdentity: "ada-connection" };
    },
    async resolveEphemeralExecutionProfile(scope, request, options) {
      calls.push("profile");
      assert.deepEqual(request, { profileId: "helper", workloadId: "session_title" });
      assert.equal(options.expectedConnectionIdentity, "ada-connection");
      assert.equal((await store.readBackgroundTask("original-id", "session-name")).assistantHelper.scope.id, scope.id);
      assert.deepEqual(scope.environment, {});
      return profile;
    },
    async runEphemeralChatTurn(_scope, input, options) {
      calls.push(input.prompt);
      assert.equal(options.session, undefined);
      await options.onEvent({ type: "thread", threadId: "helper-thread" });
      await options.onEvent({ type: "helper-execution", executionId: "helper-execution" });
      return { ok: true, text: '{"name":"Bookings"}', executionProfile: profile };
    },
    async deleteEphemeralConversation(_scope, input) {
      calls.push("delete");
      assert.equal(input.conversationId, "helper-thread");
      assert.equal(input.cleanupExecutionId, "helper-execution");
      return { ok: true };
    }
  };
  const create = () => createSessionNaming({ agent, publishSessionChanged: async (...args) => events.push(args), logger: { warn: (...args) => warnings.push(args) } });
  return { store, context, calls, events, warnings, agent, profile, create, naming: create(), root };
}

test("the first message gets one Helper name, with owned cleanup and no ID or path changes", async (t) => {
  const f = await fixture(t);
  const before = f.store.paths("original-id");
  await f.store.writeConversationUserMessage("original-id", { messageId: "first", text: "Improve bookings" });
  f.naming.start(f.context, "first");
  f.naming.start(f.context, "first");
  await f.naming.close();
  assert.deepEqual(f.warnings, []);
  assert.equal(await f.store.readMetadataValue("original-id", "label"), "Bookings");
  assert.deepEqual(f.store.paths("original-id"), before);
  assert.equal((await f.store.readSession("original-id")).sessionId, "original-id");
  const task = await f.store.readBackgroundTask("original-id", "session-name");
  assert.equal(task.status, "ready");
  assert.equal(task.assistantHelper, null);
  assert.deepEqual(await readdir(path.join(f.root, "assistant-helpers")), []);
  assert.equal(f.events[0][1].reason, "session-renamed");
  const restarted = f.create();
  restarted.start(f.context, "first");
  await restarted.close();
  assert.equal(f.calls.filter((call) => call === "resolve").length, 1);
});

test("manual rename wins while a nonblocking Helper is working and close waits for cleanup", async (t) => {
  const f = await fixture(t);
  let release;
  const waiting = new Promise((resolve) => { release = resolve; });
  let started;
  const ready = new Promise((resolve) => { started = resolve; });
  const run = f.agent.runEphemeralChatTurn;
  f.agent.runEphemeralChatTurn = async (...args) => { started(); await waiting; return run(...args); };
  await f.store.writeConversationUserMessage("original-id", { messageId: "first", text: "Bookings" });
  assert.equal(f.naming.start(f.context, "first"), undefined);
  await ready;
  await f.store.writeSessionLabel("original-id", "My chosen name");
  let closed = false;
  const close = f.naming.closeSession(f.context).then(() => { closed = true; });
  assert.equal(closed, false);
  release();
  await close;
  assert.equal(await f.store.readMetadataValue("original-id", "label"), "My chosen name");
  assert.equal(f.calls.at(-1), "delete");
});

test("later messages including after rewind do not backfill names", async (t) => {
  const f = await fixture(t);
  const first = await f.store.writeConversationUserMessage("original-id", { messageId: "first", text: "First" });
  await f.store.rewindConversationLog("original-id", [first.turnId]);
  await f.store.writeConversationUserMessage("original-id", { messageId: "second", text: "Second" });
  f.naming.start(f.context, "second");
  await f.naming.close();
  assert.equal((await f.store.readFirstUserMessage("original-id")).messageId, "first");
  assert.deepEqual(f.calls, []);
  assert.equal(await f.store.readBackgroundTask("original-id", "session-name"), null);
});

test("unavailable Helper does not use another account or retry from later requests", async (t) => {
  const f = await fixture(t);
  f.agent.resolveAssistantPurpose = async () => ({ available: false, reasonCode: "helper_unavailable", message: "Configure Helper." });
  await f.store.writeConversationUserMessage("original-id", { messageId: "first", text: "Bookings" });
  f.naming.start(f.context, "first");
  await f.naming.close();
  assert.equal((await f.store.readBackgroundTask("original-id", "session-name")).status, "failed");
  assert.equal(f.warnings.length, 1);
  f.agent.resolveAssistantPurpose = async () => { throw new Error("Must not retry"); };
  const restarted = f.create();
  restarted.start(f.context, "first");
  await restarted.close();
  assert.equal(f.warnings.length, 1);
  await f.store.writeSessionLabel("original-id", "Manual");
});

test("failed helper cleanup stays owned for retry on close", async (t) => {
  const f = await fixture(t);
  const cleanup = f.agent.deleteEphemeralConversation;
  f.agent.deleteEphemeralConversation = async () => ({ ok: false, error: "Try cleanup again" });
  await f.store.writeConversationUserMessage("original-id", { messageId: "first", text: "Bookings" });
  f.naming.start(f.context, "first");
  await f.naming.close();
  const task = await f.store.readBackgroundTask("original-id", "session-name");
  assert.equal(task.status, "failed");
  assert.equal(task.assistantHelper.conversationId, "helper-thread");
  f.agent.deleteEphemeralConversation = cleanup;
  await f.create().closeSession(f.context);
  assert.equal((await f.store.readBackgroundTask("original-id", "session-name")).assistantHelper, null);
});

test("names validate before storage and automatic names must be one word", async (t) => {
  const f = await fixture(t);
  for (const invalid of [null, {}, "", "  ", "a\nb", "a\u0000b", "a".repeat(121)]) {
    await assert.rejects(f.store.writeSessionLabel("original-id", invalid), { code: "vibe64_session_name_invalid" });
  }
  assert.equal(await f.store.writeSessionLabel("original-id", "  My session  "), "My session");
  for (const value of ['{"name":"Two words"}', '{"name":"Okay!"}', '{"name":"a","extra":1}', "bad", '{"name":""}']) {
    assert.throws(() => parseSessionName(value), { code: "vibe64_session_name_invalid" });
  }
  assert.equal(parseSessionName('{"name":"予約"}'), "予約");
  assert.equal(parseSessionName('{"name":"Café"}'), "Café");
});
