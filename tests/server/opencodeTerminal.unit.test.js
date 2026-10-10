import { createSessionConversationBinding, prepareSessionConversationDisposal } from "../../packages/vibe64-terminals/src/server/mainConversationBinding.js";
import { createService as createTerminalService } from "../../packages/vibe64-terminals/src/server/service.js";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { opencodeTerminalNamespace } from "../../packages/vibe64-terminals/src/server/terminalShared.js";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { registerVibe64ActionContext } from "../../packages/vibe64-core/src/server/actionContext.js";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { createService as createSessionService } from "../../packages/vibe64-sessions/src/server/service.js";
import { mainConversationId } from "../../packages/vibe64-sessions/src/shared/conversationIdentity.js";
import assert from "node:assert/strict";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { genesisCommandShimDirectory } from "@local/vibe64-genesis/server";

import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  VIBE64_AGENT_HELPER_WORKLOAD_LIMITS,
  serializeVibe64AssistantSelection
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  openCodeAssistantCapabilities
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js";
import {
  resolveOpenCodeHelperExecutionProfile
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js";
import {
  OPENCODE_HELPER_AGENT_ID,
  OPENCODE_EPHEMERAL_AGENT_ID
} from "../../packages/vibe64-terminals/src/server/opencodeServerProcess.js";
import {
  sessionRenewalHandoverHash,
  sessionRenewalSeedPrompt
} from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";

import { agents, controllerHarness, providerDefinition } from "../fixtures/opencodeController.js";

function throughCommonScopedConversation(controller) {
  const provider = controller.provider;
  const runtime = createConversationRuntime({
    authorize: ({ context, conversationId }) => context.sessionId === conversationId,
    host: { conversation: ({ id, context, input, operation }) => operation === "dispose"
      ? prepareSessionConversationDisposal(provider, id, context, input)
      : createSessionConversationBinding(provider, id, context) }
  });
  const native = (method) => async (sessionId, input = {}, options = {}) => {
    const conversation = await runtime.open({ id: sessionId, representation: "native",
      context: { ...options, sessionId, scopedConversationId: input.conversationId } });
    return conversation[method](input);
  };
  return { ...controller,
    startConversationTurn: native("send"), readConversation: native("read"),
    waitForConversationTurn: native("wait"), stopConversation: native("cancel"),
    deleteConversation: native("dispose") };
}

test("OpenCode conversation events retain exact text snapshots and deltas for live replies", async (t) => {
  const harness = await controllerHarness({ providerEvents: [
    { data: { type: "message.part.updated", properties: { part: {
      id: "part-1", messageID: "message-1", type: "text", text: '{"kind":"reply","text":"Hello '
    } } } },
    { data: { type: "message.part.delta", properties: {
      partID: "part-1", messageID: "message-1", field: "text", delta: "world "
    } } }
  ] });
  t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { recursive: true, force: true }); });
  const events = [];
  const options = { runtime: harness.runtime, session: harness.session, onEvent: (event) => events.push(event) };
  const { conversationId } = await harness.controller.createConversation("session-1", {}, options);
  await harness.controller.runDetachedChatTurn("session-1", { conversationId, prompt: "Hello" }, options);
  assert.equal(events.find((event) => event.type === "message.part.updated").textSnapshot, '{"kind":"reply","text":"Hello ');
  assert.equal(events.find((event) => event.type === "message.part.delta").textDelta, "world ");
  assert.equal(events.find((event) => event.type === "message.part.delta").partId, "part-1");
});

test("OpenCode shutdown waits for the completed turn's checkpoint persistence", async (t) => {
  const harness = await controllerHarness();
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const write = harness.runtime.store.writeBackgroundTaskEvent;
  harness.runtime.store.writeBackgroundTaskEvent = async (...args) => {
    entered.resolve();
    await release.promise;
    return write(...args);
  };
  t.after(async () => {
    release.resolve();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Finish", messageId: "checkpoint-before-close" });
  await entered.promise;
  let closed = false;
  const closing = harness.controller.invalidateRuntimes({ reason: "server-shutdown" }).then((result) => {
    closed = true;
    return result;
  });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(closed, false);
  release.resolve();
  assert.equal((await closing).ok, true);
  assert.equal(harness.checkpoints.length, 1);
});

test("OpenCode retains its generated conversation ID across restarts and engine changeover", async (t) => {
  const harness = await controllerHarness();
  let controller = harness.controller;
  t.after(async () => {
    await controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const first = await controller.ensureSession("session-1");
  assert.match(first.thread.id, /^ses_native_/);
  assert.equal(harness.session.metadata.opencode_conversation_id, first.thread.id);

  const databasePath = harness.processStarts[0].options.dbPath;
  await mkdir(path.dirname(databasePath), { recursive: true });
  await writeFile(databasePath, "native history");
  await controller.closeAllForProject();
  await rm(path.join(harness.root, "agent-providers"), { recursive: true, force: true });
  assert.equal(await readFile(databasePath, "utf8"), "native history");

  harness.session.metadata.agent_identity_provider = "codex";
  harness.session.metadata.agent_identity_conversation_id = "codex-native-thread";
  controller = harness.createController();
  const resumed = await controller.ensureSession("session-1");
  assert.equal(resumed.thread.id, first.thread.id);
  assert.equal(harness.createdSessions.length, 1);
  assert.equal(Object.hasOwn(harness.createdSessionInputs[0], "id"), false);
});

test("OpenCode starts fresh when only an old caller-supplied conversation ID exists", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const oldId = "ses_vibe64_previous";
  harness.session.metadata.agent_identity_provider = "opencode";
  harness.session.metadata.agent_identity_conversation_id = oldId;
  harness.upstreamSessions.set(oldId, { id: oldId });

  const sent = await harness.controller.sendMessage("session-1", {
    message: "Hello",
    messageId: "native-session-start"
  });
  await harness.controller.waitForTurn("session-1");
  assert.notEqual(sent.thread.id, oldId);
  assert.equal(sent.turn.threadId, sent.thread.id);
  assert.equal(harness.promptCalls[0].id, sent.thread.id);
  assert.equal(harness.readSessionCalls(), 0);
  assert.equal(Object.hasOwn(harness.createdSessionInputs[0], "id"), false);

  const registryPath = path.join(harness.root, "agent-providers", "opencode", "session-environments.json");
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(registry.sessions[0].upstreamSessionId, sent.thread.id);
});

test("OpenCode changeover delivers one combined prompt, retains authored text, and reuses native history", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const sent = [];
  const send = (id, message, displayMessage) => harness.controller.sendMessage("session-1", {
    messageId: id, message, displayMessage,
    onPromptSending({ threadId }) {
      assert.equal(harness.promptCalls.length, sent.length, "claim must precede the native prompt");
      sent.push(threadId);
    }
  });
  await send("before-changeover", "Initial task", "Initial task");
  await harness.controller.waitForTurn("session-1");
  await harness.controller.closeAllForSession("session-1");
  const combined = "[Vibe64 conversation changeover]\nCodex changed the plan.\n[End Vibe64 conversation changeover]\n\nUser's message:\nContinue the work";
  const result = await send("after-changeover", combined, "Continue the work");
  assert.equal(result.delivered, true, JSON.stringify(result));
  assert.equal(sent.length, 2);
  assert.equal(sent[1], sent[0]);
  assert.equal(harness.promptCalls.length, 2);
  assert.equal(harness.promptCalls[1].input.prompt.text, combined);
  assert.equal(harness.userMessages[1].text, "Continue the work");
  await harness.controller.waitForTurn("session-1");
});

test("OpenCode waits for a cold event connection before submitting a prompt", { timeout: 10_000 }, async (t) => {
  let ready = false;
  const harness = await controllerHarness({
    async *events(_id, { onReady, signal }) {
      await new Promise((resolve) => setTimeout(resolve, 5_100));
      signal.throwIfAborted();
      ready = true;
      onReady();
      yield { data: { type: "server.connected" } };
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    }
  });
  t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
  const pending = harness.controller.sendMessage("session-1", { message: "Hello", messageId: "cold-events" });
  assert.equal(harness.promptCalls.length, 0);
  const result = await pending;
  assert.equal(ready, true);
  assert.equal(result.delivered, true, JSON.stringify(result));
  assert.equal(harness.promptCalls.length, 1);
  await harness.controller.waitForTurn("session-1");
});

test("OpenCode resend records its provider failure separately from an earlier connection failure", async (t) => {
  let attempt = 0;
  const harness = await controllerHarness({
    assistantError: {
      name: "APIError",
      data: { message: "OpenCode's free tier can only be used from within OpenCode" }
    },
    async *events(_id, { onReady, signal }) {
      if (++attempt === 1) {
        throw Object.assign(new Error("OpenCode's event connection did not become ready. Try sending again."), {
          code: "vibe64_opencode_events_timeout"
        });
      }
      onReady();
      yield { data: { type: "server.connected" } };
      await new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
    }
  });
  t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
  const input = { message: "Hello! My name is Tony", messageId: "same-message-on-resend" };
  const first = await harness.controller.sendMessage("session-1", input);
  assert.equal(first.delivered, false);
  assert.equal(first.retryable, true);
  assert.equal(harness.promptCalls.length, 0);
  assert.equal((await harness.controller.sendMessage("session-1", input)).delivered, true);
  const result = await harness.controller.waitForTurn("session-1");
  assert.equal(result.active, false);
  assert.equal(result.state, "failed");
  assert.equal(harness.promptCalls.length, 1);
  assert.equal(harness.systemMessages.length, 2);
  assert.notEqual(harness.systemMessages[0].messageId, harness.systemMessages[1].messageId,
    "Transcript deduplication must not discard the resend's failure");
  assert.match(harness.systemMessages[1].text, /free tier can only be used/);
});

const renewalSource = Object.freeze({
  authority: "github",
  commit: "a".repeat(40),
  ref: "refs/heads/main",
  repository: "https://github.com/example/project.git"
});

function renewalHandover() {
  return [
    "# Session handover",
    "## Objective",
    "Continue the saved work.",
    "## Decisions",
    "Keep the existing architecture.",
    "## Saved source",
    "- Authority: github",
    "- Repository: https://github.com/example/project.git",
    "- Ref: refs/heads/main",
    `- Commit: ${renewalSource.commit}`,
    "## Touched areas",
    "The server.",
    "## Verification",
    "Focused tests passed.",
    "## Unresolved work",
    "One task remains.",
    "## Next action",
    "Continue the task."
  ].join("\n");
}


test("OpenCode streams partial snapshots before saving the final answer and clears them on Stop", { timeout: 5_000 }, async (t) => {
  const response = { pending: true, text: "Hello " };
  let receive;
  let waiting = new Promise((resolve) => { receive = resolve; });
  const harness = await controllerHarness({ assistantResponses: [response, { pending: true, text: "Next" }],
    onSessionChanged(_id, event) {
      if (event.reason === "assistant-stream") receive(event.payload.conversationStream);
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Answer", messageId: "stream-input" });
  const first = await waiting;
  assert.equal(first.messages[0].text, "Hello ");
  assert.equal(harness.assistantMessages.length, 0);
  assert.equal(harness.runtime.store.readConversationStream("session-1").messages[0].text, "Hello ");
  response.text = "Hello world";
  response.pending = false;
  await harness.controller.waitForTurn("session-1");
  assert.equal(harness.assistantMessages.length, 1);
  assert.equal(harness.assistantMessages[0].messageId, first.messages[0].messageId);
  assert.equal(harness.assistantMessages[0].text, "Hello world");
  assert.deepEqual(harness.runtime.store.readConversationStream("session-1").messages, []);
  waiting = new Promise((resolve) => { receive = resolve; });
  await harness.controller.sendMessage("session-1", { message: "Again", messageId: "stream-next" });
  assert.equal((await waiting).messages[0].text, "Next");
  await harness.controller.interruptTurn("session-1");
  assert.deepEqual(harness.runtime.store.readConversationStream("session-1").messages, []);
});

test("OpenCode compaction phase follows the live native summary and clears on Stop", { timeout: 5_000 }, async (t) => {
  const response = { pending: true, summary: true, text: "" };
  let changed = Promise.withResolvers();
  const harness = await controllerHarness({ assistantResponses: [response, "Continued"],
    onSessionChanged(_id, event) {
      const turn = event.payload?.agentSession?.turn;
      if (turn?.phase !== undefined) changed.resolve(turn);
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Work", messageId: "compact-work" });
  while ((await changed.promise).phase !== "compacting") changed = Promise.withResolvers();
  assert.equal((await harness.controller.sessionState("session-1")).turn.phase, "compacting");
  assert.equal((await harness.runtime.store.readAgentRun("session-1", "opencode_server")).phase, "compacting");
  changed = Promise.withResolvers();
  response.summary = false;
  assert.equal((await changed.promise).phase, "");
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
  changed = Promise.withResolvers();
  response.summary = true;
  assert.equal((await changed.promise).phase, "compacting");
  await harness.controller.interruptTurn("session-1");
  assert.equal((await harness.controller.sessionState("session-1")).turn.phase, "");
  await harness.controller.sendMessage("session-1", { message: "Continue", messageId: "compact-continue" });
  await harness.controller.waitForTurn("session-1");
  assert.equal((await harness.controller.sessionState("session-1")).turn.phase, "");
});

for (const replay of [false, true]) {
  test(`OpenCode follows automatic compaction to the actual answer (replayed prompt: ${replay})`, { timeout: 8_000 }, async (t) => {
    const response = { pending: true, text: "" };
    const compacting = Promise.withResolvers();
    let observed = Promise.withResolvers();
    let reads = 0;
    let expectedReads = Infinity;
    const harness = await controllerHarness({ assistantResponses: [response],
      beforeMessages() { if (++reads >= expectedReads) observed.resolve(); },
      onSessionChanged(_id, event) {
        if (event.payload?.agentSession?.turn?.phase === "compacting") compacting.resolve();
      }
    });
    t.after(async () => {
      await harness.controller.closeAllForProject();
      await rm(harness.root, { force: true, recursive: true });
    });
    const sent = await harness.controller.sendMessage("session-1", { message: "Finish the work", messageId: "compact-continuation" });
    async function remainsActive() {
      observed = Promise.withResolvers();
      expectedReads = reads + 3;
      await Promise.race([observed.promise, harness.controller.waitForTurn("session-1")]);
      assert.equal((await harness.controller.sessionState("session-1")).turn.active, true, "Compaction must not finish the tracked request");
    }
    const created = Date.now();
    response.messages = [
      { id: sent.turn.id, type: "user", time: { created } },
      { id: "before-compact", type: "assistant", text: "I will continue.", time: { created: created + 1, completed: created + 2 } },
      { id: "compact-control", type: "user", time: { created: created + 3 }, content: [{ type: "compaction", auto: true }] }
    ];
    await remainsActive();
    response.messages.push({ id: "compact-summary", type: "assistant", summary: true, text: "Internal summary", time: { created: created + 4 } });
    await compacting.promise;
    await remainsActive();
    response.messages.at(-1).time.completed = created + 5;
    await remainsActive();
    response.messages.push({ id: "compact-followup", type: "user", time: { created: created + 6 }, content: replay
      ? [{ type: "text", text: "Finish the work" }]
      : [{ type: "text", synthetic: true, metadata: { compaction_continue: true }, text: "Continue" }]
    });
    await remainsActive();
    response.messages.push(
      { id: "actual-answer", type: "assistant", text: "The work is complete.", time: { created: created + 7, completed: created + 8 } },
      { id: "next-request", type: "user", text: "A different request", time: { created: created + 9 } },
      { id: "next-answer", type: "assistant", text: "A different answer", time: { created: created + 10, completed: created + 11 } }
    );
    assert.equal((await harness.controller.waitForTurn("session-1")).state, "completed");
    assert.equal(harness.assistantMessages.at(-1).text, "The work is complete.");
    assert.equal(harness.assistantMessages.some((message) => message.text.includes("Internal summary")), false);
    assert.equal(harness.assistantMessages.some((message) => message.text.includes("A different answer")), false);
    assert.equal(harness.userMessages.length, 1, "Native maintenance messages must not appear as user requests");
  });
}

test("OpenCode Stop settles a stalled turn after native abort without waiting for a final answer", async (t) => {
  const harness = await controllerHarness({ assistantResponses: [{ pending: true, text: "" }] });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Answer briefly.", messageId: "stalled-turn" });
  const result = await harness.controller.interruptTurn("session-1");
  assert.equal(result.ok, true);
  const settled = await Promise.race([
    harness.controller.waitForTurn("session-1").then(() => true),
    new Promise((resolve) => setTimeout(() => resolve(false), 750))
  ]);
  assert.equal(settled, true, "Stop acknowledged, but the turn still waits for an assistant final answer");
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, false);
  assert.equal(result.turn.state, "interrupted");
  assert.equal(harness.systemMessages.length, 0);
  await harness.controller.sendMessage("session-1", { message: "Next answer.", messageId: "after-stop" });
  assert.equal((await harness.controller.waitForTurn("session-1")).state, "completed");
  assert.equal(harness.promptCalls.at(-1).input.delivery, "queue");
});

test("OpenCode surfaces an event-only provider failure without waiting for an assistant answer", async (t) => {
  const harness = await controllerHarness({
    assistantResponses: [{ pending: true, text: "" }],
    providerEvents: [{ data: {
      type: "session.error",
      properties: { error: { name: "APIError", data: { message: "This model does not support image input." } } }
    } }]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Read image.", messageId: "image-error" });
  const result = await harness.controller.waitForTurn("session-1");
  assert.equal(result.state, "failed");
  assert.equal(result.error, "This model does not support image input.");
  assert.equal(harness.systemMessages.length, 1);
  assert.match(harness.systemMessages[0].text, /This model does not support image input\./u);
  assert.equal(harness.publishedSessionChanges.at(-1)[1].payload.agentSession.turn.active, false);
  assert.equal(harness.promptCalls.length, 1, "A provider failure must not trigger answer recovery");
});

test("OpenCode bounds an unresponsive abort and permits a second Stop attempt", async (t) => {
  let attempts = 0;
  const harness = await controllerHarness({
    assistantResponses: [{ pending: true, text: "" }],
    interrupt: async (_id, { signal }) => {
      if (++attempts === 1) {
        await new Promise((_resolve, reject) => {
          signal.addEventListener("abort", () => reject(signal.reason), { once: true });
        });
      }
      return true;
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Answer", messageId: "abort-timeout" });
  const started = Date.now();
  await assert.rejects(harness.controller.interruptTurn("session-1"), (error) => (
    error.code === "vibe64_opencode_interrupt_timeout" && error.statusCode === 504
  ));
  assert.ok(Date.now() - started < 6_000);
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
  const result = await harness.controller.interruptTurn("session-1");
  assert.equal(result.turn.active, false);
  assert.equal(result.turn.state, "interrupted");
});

test("OpenCode cold catalog discovery never loads configured credentials", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.capabilities({ engineId: "opencode" });

  assert.equal(harness.processStarts.length, 0);
  assert.equal(harness.runtimeCreateCalls(), 0);
  assert.equal(path.basename(harness.catalogReadCalls[0].workdir), "workspace");
  assert.equal(Object.hasOwn(harness.catalogReadCalls[0], "providerConnections"), false);
  assert.equal(typeof harness.catalogReadCalls[0].createServerProcess, "function");
});

test("OpenCode Stop cancels an in-flight history read without waiting for its response", async (t) => {
  const reading = Promise.withResolvers();
  const harness = await controllerHarness({
    assistantResponses: [{ pending: true, text: "" }],
    beforeMessages: async (_id, { signal }) => {
      reading.resolve();
      await new Promise((_resolve, reject) => {
        signal.throwIfAborted();
        signal.addEventListener("abort", () => reject(signal.reason), { once: true });
      });
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Answer", messageId: "pending-read" });
  await reading.promise;
  const started = Date.now();
  assert.equal((await harness.controller.interruptTurn("session-1")).turn.state, "interrupted");
  assert.ok(Date.now() - started < 500);
});

test("OpenCode carries an early error forward but keeps Stop available until native work is idle", async (t) => {
  let busy = true;
  const readStatus = Promise.withResolvers();
  const harness = await controllerHarness({
    assistantResponses: [{ pending: true, text: "" }],
    providerEvents: [{ data: { type: "session.error", properties: {
      error: { name: "UnknownError", data: { message: "An input file could not be read." } }
    } } }],
    sessionStatus: async () => { readStatus.resolve(); return { type: busy ? "busy" : "idle" }; }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Read file", messageId: "busy-error" });
  await readStatus.promise;
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
  busy = false;
  const result = await harness.controller.waitForTurn("session-1");
  assert.equal(result.state, "failed");
  assert.equal(result.error, "An input file could not be read.");
  assert.equal(harness.systemMessages.length, 1);
});

test("OpenCode ignores another conversation's error and Stop leaves its active turn alone", async (t) => {
  const harness = await controllerHarness({
    assistantResponses: [{ pending: true, text: "" }, { pending: true, text: "" }],
    providerEvents: [{ data: { type: "session.error", properties: {
      sessionID: "ses_unrelated", error: { name: "APIError", data: { message: "Other conversation failed" } }
    } } }]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const secondSession = {
    ...harness.session,
    sessionId: "session-2",
    sessionRoot: path.join(harness.root, "session-state", "session-2"),
    metadata: { ...harness.session.metadata, source_path: path.join(harness.root, "sessions", "active", "session-2", "source") }
  };
  await mkdir(secondSession.metadata.source_path, { recursive: true });
  await mkdir(secondSession.sessionRoot, { recursive: true });
  await harness.controller.sendMessage("session-1", { message: "Answer", messageId: "one" });
  await harness.controller.sendMessage("session-2", { message: "Answer", messageId: "two" }, { session: secondSession });
  const result = await harness.controller.interruptTurn("session-1");
  assert.equal(result.turn.state, "interrupted");
  assert.equal((await harness.controller.sessionState("session-2", { session: secondSession })).turn.active, true);
  assert.equal(harness.systemMessages.length, 0);
  assert.equal(harness.processStops.length, 0);
  assert.equal(harness.processStarts.length, 1);
  await harness.controller.interruptTurn("session-2", {}, { session: secondSession });
});

test("OpenCode does not release a turn when the native abort is unconfirmed", async (t) => {
  let attempts = 0;
  const harness = await controllerHarness({
    assistantResponses: [{ pending: true, text: "" }],
    interrupt: async () => ++attempts > 1
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Answer", messageId: "unconfirmed" });
  await assert.rejects(harness.controller.interruptTurn("session-1"), { code: "vibe64_opencode_interrupt_unconfirmed" });
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
  assert.equal((await harness.controller.interruptTurn("session-1")).turn.active, false);
});

test("configured OpenCode choices never read or start OpenCode", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.capabilities({ configuredOnly: "true" }, {
    vibe64User: { username: "ada" }
  });

  assert.equal(result.health.status, "ready");
  assert.deepEqual(result.modelProviders.map(({ id }) => id), ["deepseek"]);
  assert.equal(harness.catalogReadCalls.length, 0);
  assert.equal(harness.processStarts.length, 0);
  assert.equal(harness.runtimeCreateCalls(), 0);
});

test("OpenCode runtime invalidation preserves its credential-free catalog snapshot", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.capabilities({ engineId: "opencode" });
  await harness.controller.invalidateRuntimes({
    modelProviderId: "deepseek",
    reason: "created"
  });
  await harness.controller.capabilities({ engineId: "opencode" });

  assert.equal(harness.catalogReadCalls.length, 1);
});

test("OpenCode refreshes the same clean catalogue after a managed process starts", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const before = await harness.controller.capabilities({ engineId: "opencode" });
  await harness.controller.ensureSession("session-1");
  const later = Date.now() + 11 * 60 * 1000;
  const clock = t.mock.method(Date, "now", () => later);
  try {
    const after = await harness.controller.capabilities({ engineId: "opencode" });
    assert.equal(harness.catalogReadCalls.length, 2);
    assert.equal(after.modelProviders[0].definitionRevision, before.modelProviders[0].definitionRevision);
    assert.equal(after.modelProviders[0].connected, true);
  } finally { clock.mock.restore(); }
});

test("OpenCode exposes a finite connection verifier through its controller", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.verifyConnection({
    apiKey: "deepseek-key",
    engineId: "opencode",
    modelId: "deepseek-chat",
    modelProviderId: "deepseek"
  });

  assert.deepEqual(result, { ok: true });
  assert.equal(harness.verifyConnectionCalls.length, 1);
  assert.equal(harness.verifyConnectionCalls[0].apiKey, "deepseek-key");
  assert.equal(Object.hasOwn(harness.verifyConnectionCalls[0], "canonicalUrl"), false);
  assert.equal(harness.verifyConnectionCalls[0].modelId, "deepseek-chat");
  assert.equal(harness.verifyConnectionCalls[0].modelProviderId, "deepseek");
  assert.equal(path.basename(harness.verifyConnectionCalls[0].workdir), "workspace");
  await assert.rejects(
    () => harness.controller.verifyConnection({ engineId: "codex" }),
    (error) => error?.code === "vibe64_assistant_engine_invalid" && error.statusCode === 400
  );
  assert.equal(harness.verifyConnectionCalls.length, 1);
  await assert.rejects(
    () => harness.controller.verifyConnection({
      apiKey: "deepseek-key",
      engineId: "opencode",
      modelId: "removed-model",
      modelProviderId: "deepseek"
    }),
    (error) => error?.code === "vibe64_assistant_catalog_stale" && error.statusCode === 409
  );
  assert.equal(harness.verifyConnectionCalls.length, 1);
});

test("OpenCode verifies Zen's live ids and rejects models removed from its current list", async (t) => {
  const zen = {
    id: "opencode",
    models: {
      "big-pickle": {
        free: true,
        id: "big-pickle",
        name: "Big Pickle",
        status: "active"
      },
      "removed-model": {
        free: true,
        id: "removed-model",
        name: "Removed model",
        status: "active"
      }
    },
    name: "OpenCode Zen"
  };
  const harness = await controllerHarness({
    catalogProviders: {
      all: [zen],
      default: { opencode: "big-pickle" }
    },
    zenModelIds: ["big-pickle", "new-live-model"]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await assert.rejects(
    () => harness.controller.verifyConnection({
      apiKey: "zen-key",
      engineId: "opencode",
      modelId: "removed-model",
      modelProviderId: "opencode"
    }),
    (error) => error?.code === "vibe64_assistant_catalog_stale" && error.statusCode === 409
  );
  assert.equal(harness.verifyConnectionCalls.length, 0);

  await harness.controller.verifyConnection({
    apiKey: "zen-key",
    engineId: "opencode",
    modelId: "new-live-model",
    modelProviderId: "opencode"
  });
  assert.equal(harness.verifyConnectionCalls.length, 1);
  assert.equal(harness.verifyConnectionCalls[0].modelId, "new-live-model");
});

test("OpenCode connections use native provider routing when no URL override exists", async (t) => {
  const harness = await controllerHarness();
  harness.connection.canonicalUrl = "";
  harness.connection.endpointCode = "";
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-native-provider-route"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.processStarts[0].options.providerConnections.length, 1);
  assert.equal(harness.processStarts[0].options.providerConnections[0].canonicalUrl, "");
  assert.equal(harness.processStarts[0].options.providerConnections[0].endpointCode, "");
});

test("OpenCode leaves starting state when Git identity admission fails", async (t) => {
  const harness = await controllerHarness({
    gitActorFailure: {
      code: "vibe64_git_identity_missing",
      error: "Choose a Git identity before sending.",
      ok: false
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.sendMessage("session-1", {
    message: "Try this turn",
    messageId: "client-message-git-identity"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.code, "vibe64_git_identity_missing");
  assert.deepEqual(
    [...new Set(harness.agentRunEvents.map(({ run }) => run.state))],
    ["starting", "failed"]
  );
  assert.equal(harness.userMessages.length, 0);
});

test("OpenCode capability discovery does not start an app server", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.capabilities({}, {
    vibe64User: { username: "ada" }
  });

  assert.equal(result.engineId, "opencode");
  assert.equal(harness.processStarts.length, 0);
});

test("OpenCode gives one cold start the full default readiness window", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.ensureSession("session-1", {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });

  assert.equal(result.ok, true);
  assert.equal(harness.serverStartCalls.length, 1);
  assert.equal(harness.serverStartCalls[0].readinessTimeoutMs, undefined);
  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.userMessages.length, 0);
  assert.equal(harness.promptCalls.length, 0);
  assert.equal(harness.agentCatalogCalls(), 0);
  assert.equal(harness.providerCatalogCalls(), 0);
});

test("an immediate first message joins the selected view's cold start", async (t) => {
  let releaseServerStart = () => null;
  let serverStartReached = () => null;
  const serverStartGate = new Promise((resolve) => {
    releaseServerStart = resolve;
  });
  const serverStartReady = new Promise((resolve) => {
    serverStartReached = resolve;
  });
  const harness = await controllerHarness({
    async serverStartGate() {
      serverStartReached();
      await serverStartGate;
    }
  });
  t.after(async () => {
    releaseServerStart();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };

  const opened = harness.controller.ensureSession("session-1", options);
  await serverStartReady;
  const delivered = harness.controller.sendMessage("session-1", {
    message: "Hello",
    messageId: "client-message-immediate"
  }, options);
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(harness.serverStartCalls.length, 1);
  assert.equal(harness.processStarts.length, 0);
  assert.equal(harness.promptCalls.length, 0);

  releaseServerStart();
  const [openedResult, deliveredResult] = await Promise.all([opened, delivered]);
  assert.equal(openedResult.ok, true);
  assert.equal(deliveredResult.ok, true);
  assert.equal(harness.serverStartCalls.length, 1);
  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.createdSessions.length, 1);
  assert.equal(harness.promptCalls.length, 1);
  assert.equal(harness.agentCatalogCalls(), 0);
  assert.equal(harness.providerCatalogCalls(), 0);
  await harness.controller.waitForTurn("session-1", options);
});

test("OpenCode returns a readable failed-message result after a cold start times out", async (t) => {
  const startupMessage = "OpenCode did not become ready before the startup deadline.";
  const startupTimeout = () => Object.assign(new Error(startupMessage), {
    code: "vibe64_opencode_start_timeout"
  });
  const harness = await controllerHarness({
    serverStartErrors: [startupTimeout()]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const result = await harness.controller.sendMessage("session-1", {
    message: "Hello",
    messageId: "client-message-cold-start-failed"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });

  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.code, "vibe64_opencode_start_timeout");
  assert.equal(result.error, startupMessage);
  assert.equal(result.retryable, true);
  assert.equal(result.turn.state, "failed");
  assert.equal(harness.serverStartCalls.length, 1);
  assert.equal(harness.processStarts.length, 0);
  assert.equal(harness.userMessages.length, 0);
  assert.deepEqual(
    [...new Set(harness.agentRunEvents.map(({ run }) => run.state))],
    ["starting", "failed"]
  );
});

test("OpenCode preserves application failure results for extracted transport errors", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  harness.failPrompt(Object.assign(new Error("OpenCode rejected the request."), {
    code: "assistant_opencode_server_request_failed", statusCode: 503
  }));
  const result = await harness.controller.sendMessage("session-1", { message: "Hello", messageId: "transport-failure" });
  assert.equal(result.ok, false);
  assert.equal(result.delivered, false);
  assert.equal(result.code, "vibe64_opencode_server_request_failed");
  assert.equal(result.refreshRecommended, true);
  assert.equal(result.turn.state, "failed");
  assert.equal(harness.promptCalls.length, 1);
  assert.equal(harness.userMessages.length, 0);
});

test("OpenCode reports local persistence failure after upstream admission without resending", async (t) => {
  let historyUnavailable = false;
  let restarted = null;
  const harness = await controllerHarness({ beforeMessages: async () => {
    if (historyUnavailable) throw new Error("Injected provider history outage");
  } });
  t.after(async () => {
    await restarted?.closeAllForProject();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  harness.runtime.store.writeConversationUserMessage = async () => {
    throw new Error("Injected conversation persistence failure");
  };

  await assert.rejects(
    harness.controller.sendMessage("session-1", {
      message: "Continue after integration setup.",
      messageId: "integration-continuation-1"
    }, {
      runtime: harness.runtime,
      session: harness.session,
      vibe64User: { username: "ada" }
    }),
    /Injected conversation persistence failure/u
  );

  // Provider acceptance precedes local persistence. A caller must not treat
  // this error as proof that it is safe to repeat the prompt.
  assert.equal(harness.promptCalls.length, 1);
  assert.match(harness.promptCalls[0].input.id, /^msg_vibe64_/u);
  assert.equal(harness.userMessages.length, 0);
  await harness.controller.closeAllForProject();
  restarted = harness.createController();
  const threadId = harness.promptCalls[0].id;
  const sessionCount = harness.createdSessions.length;
  const accepted = await restarted.inspectMessageAdmission("session-1", {
    messageId: "integration-continuation-1", threadId
  });
  assert.deepEqual(accepted, {
    ok: true, admission: "accepted", messageId: "integration-continuation-1", threadId,
    turnId: harness.promptCalls[0].input.id
  });
  const unknown = await restarted.inspectMessageAdmission("session-1", {
    messageId: "another-continuation", threadId
  });
  assert.equal(unknown.admission, "unknown");
  historyUnavailable = true;
  const unavailable = await restarted.inspectMessageAdmission("session-1", {
    messageId: "integration-continuation-1", threadId
  });
  assert.equal(unavailable.admission, "unknown");
  await assert.rejects(restarted.inspectMessageAdmission("session-1", {
    messageId: "integration-continuation-1", threadId: "another-thread"
  }), /original assistant thread/u);
  assert.equal(harness.promptCalls.length, 1);
  assert.equal(harness.createdSessions.length, sessionCount);
  assert.equal(harness.userMessages.length, 0);
});

test("OpenCode persists a user message and its display attachments only after upstream admission", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  harness.failPrompt();
  await assert.rejects(
    () => harness.controller.sendMessage("session-1", {
      message: "First attempt",
      messageId: "client-message-1"
    }, {
      runtime: harness.runtime,
      session: harness.session,
      vibe64User: { username: "ada" }
    }),
    /admission failed/u
  );
  assert.equal(harness.userMessages.length, 0);
  assert.deepEqual(
    [...new Set(harness.agentRunEvents.map(({ run }) => run.state))],
    ["starting", "failed"]
  );

  const delivered = await harness.controller.sendMessage("session-1", {
    displayAttachments: [{
      fileName: "report.md",
      size: 15360
    }],
    message: "Second attempt",
    messageId: "client-message-2"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { preferredName: "Ada", username: "ada" }
  });
  assert.equal(delivered.ok, true);
  assert.equal(harness.userMessages.length, 1);
  assert.equal(harness.userMessages[0].messageId, "client-message-2");
  assert.deepEqual(harness.userMessages[0].attachments, [{
    fileName: "report.md",
    size: 15360
  }]);
  assert.equal(harness.userMessages[0].turnMetadata.engineId, "opencode");
  assert.match(harness.userMessages[0].turnMetadata.upstreamMessageId, /^msg_vibe64_/u);
  assert.equal(harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  )).length, 1);
  assert.equal(
    harness.processStarts.find((entry) => (
      entry.options.execution.operationId === "opencode-server"
    )).options.providerConnections[0].apiKey,
    "deepseek-key-one"
  );
  const sessionProcess = harness.processStarts.find((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));
  assert.deepEqual(sessionProcess.options.execution, {
    label: "OpenCode assistant",
    operationId: "opencode-server",
    ownerId: "opencode"
  });
  const mainPrompt = harness.promptCalls.filter((entry) => (
    entry.id === delivered.thread.id
  )).at(-1).input;
  assert.equal(mainPrompt.agent, "build");
  assert.deepEqual(mainPrompt.model, {
    id: "deepseek-chat",
    providerID: "deepseek",
    variant: "high"
  });
  assert.equal(mainPrompt.prompt.text, "GENESIS start: Second attempt");
  assert.equal(Object.hasOwn(mainPrompt.prompt, "turnContext"), false);
  assert.doesNotMatch(mainPrompt.prompt.text, /Vibe64 session briefing|hidden-turn-context/u);
  const completed = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });
  assert.equal(completed.state, "completed");
  assert.equal(harness.assistantMessages.length, 1);
  assert.equal(harness.assistantMessages[0].text, "Main turn complete");
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-server-assistant-message" &&
    payload.payload?.conversationLogPatch?.turn?.text === "Main turn complete"
  )), true);
  const starting = harness.publishedSessionChanges.find(([, payload]) => (
    payload.reason === "opencode-server-turn-active" &&
    payload.payload?.agentRun?.state === "starting"
  ));
  assert.equal(starting?.[1]?.payload?.agentRun?.active, true);
  assert.equal(starting?.[1]?.payload?.agentSession?.turn?.state, "starting");
  const active = harness.publishedSessionChanges.find(([, payload]) => (
    payload.reason === "opencode-server-turn-active" &&
    payload.payload?.agentRun?.state === "active"
  ));
  assert.deepEqual(active?.[1]?.payload?.agentRun, {
    active: true,
    id: "opencode_server",
    provider: "opencode",
    providerInterface: "opencode_server",
    providerStatus: "active",
    providerThreadId: delivered.thread.id,
    providerTurnId: delivered.turn.id,
    state: "active",
    updatedAt: active[1].payload.agentRun.updatedAt
  });
  assert.equal(active?.[1]?.payload?.agentSession?.providerId, "opencode");
  assert.equal(active?.[1]?.payload?.agentSession?.turn?.active, true);
  assert.equal(active?.[1]?.session?.revision, 7);
  const idle = harness.publishedSessionChanges.findLast(([, payload]) => (
    payload.reason === "opencode-server-turn-idle"
  ));
  assert.equal(idle?.[1]?.payload?.agentRun?.active, false);
  assert.equal(idle?.[1]?.payload?.agentRun?.state, "completed");
  assert.equal(idle?.[1]?.payload?.agentSession?.turn?.active, false);
  assert.equal(idle?.[1]?.payload?.agentSession?.turn?.state, "idle");
});

for (const throughCommonMain of [false, true]) {
  test(`OpenCode reuses an established session without repeating setup or model switches${throughCommonMain ? " through the common Main handle" : ""}`, async (t) => {
  const fixtureOptions = {
    assistantResponses: ["First turn", "Second turn"],
    withCommandBoundary: true
  };
  const harness = throughCommonMain
    ? await boundMainOpenCodeFixture(t, fixtureOptions)
    : await controllerHarness(fixtureOptions);
  if (!throughCommonMain) t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const sendMessage = throughCommonMain
    ? (sessionId, input, options) => harness.manager.sendMessage(sessionId, input, { ...harness.context, ...options, sessionId })
    : (...args) => harness.controller.sendMessage(...args);
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };

  await sendMessage("session-1", {
    message: "First",
    messageId: "client-message-fast-path-1"
  }, options);
  await harness.controller.waitForTurn("session-1", options);
  await sendMessage("session-1", {
    message: "Second",
    messageId: "client-message-fast-path-2"
  }, options);
  await harness.controller.waitForTurn("session-1", options);

  assert.equal(harness.commandEnvironmentCalls.length, 2);
  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.listConnectionCalls(), 1);
  assert.equal(harness.agentCatalogCalls(), 0);
  assert.equal(harness.providerCatalogCalls(), 0);
  assert.equal(harness.readSessionCalls(), 0);
  assert.equal(harness.createdSessions.length, 1);
  assert.deepEqual(harness.switchedModels, []);
  assert.deepEqual(harness.switchedAgents, []);
  assert.deepEqual(harness.renderPromptCalls.map(({ task }) => task), ["start"]);
  assert.equal(harness.promptCalls[0].input.prompt.text, "GENESIS start: First");
  assert.equal(harness.promptCalls[1].input.prompt.text, "Second");
  assert.equal(Object.hasOwn(harness.promptCalls[0].input.prompt, "turnContext"), false);
  assert.equal(Object.hasOwn(harness.promptCalls[1].input.prompt, "turnContext"), false);
});
}

test("OpenCode renders explicit Deslop through Genesis and leaves later follow-ups ordinary", async (t) => {
  const harness = await controllerHarness({
    assistantResponses: ["First turn", "Deslop turn", "Follow-up turn"]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };

  await harness.controller.sendMessage("session-1", {
    message: "First",
    messageId: "client-message-deslop-1"
  }, options);
  await harness.controller.waitForTurn("session-1", options);
  await harness.controller.sendMessage("session-1", {
    genesisTask: "deslop",
    message: `Deslop commit ${"a".repeat(40)}.`,
    messageId: "client-message-deslop-2"
  }, options);
  await harness.controller.waitForTurn("session-1", options);
  await harness.controller.sendMessage("session-1", {
    message: "Explain one cleanup choice.",
    messageId: "client-message-deslop-3"
  }, options);
  await harness.controller.waitForTurn("session-1", options);

  assert.deepEqual(harness.renderPromptCalls.map(({ task }) => task), ["start", "deslop"]);
  assert.match(harness.promptCalls[1].input.prompt.text, /GENESIS deslop: Deslop commit/u);
  assert.doesNotMatch(harness.promptCalls[2].input.prompt.text, /GENESIS/u);
  assert.match(harness.promptCalls[2].input.prompt.text, /Explain one cleanup choice\.$/u);
});

test("OpenCode verification observes a ready session without write admission or environment preparation", { timeout: 10_000 }, async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let checking = false;
  const harness = await controllerHarness({
    withCommandBoundary: true,
    async beforeReadSession() {
      if (checking) {
        entered.resolve();
        await release.promise;
      }
    }
  });
  t.after(async () => {
    release.resolve();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const first = await harness.controller.ensureSession("session-1");
  const preparations = harness.commandEnvironmentCalls.length;
  harness.runtime.store.runSessionExclusive = async () => {
    throw new Error("Verification requested write admission");
  };
  checking = true;
  const pending = harness.controller.ensureSession("session-1");
  await entered.promise;
  assert.equal(harness.commandEnvironmentCalls.length, preparations);
  release.resolve();
  const result = await pending;
  assert.equal(result.ok, true);
  assert.equal(result.thread.id, first.thread.id);
  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.commandEnvironmentCalls.length, preparations);
  assert.equal(harness.switchedModels.length, 0);
});

test("OpenCode discards a late verification response after session closure", { timeout: 10_000 }, async (t) => {
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  let checking = false;
  const harness = await controllerHarness({
    async beforeReadSession() {
      if (checking) {
        entered.resolve();
        await release.promise;
      }
    }
  });
  t.after(async () => {
    release.resolve();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.ensureSession("session-1");
  checking = true;
  const pending = harness.controller.ensureSession("session-1");
  const rejected = assert.rejects(pending, { code: "vibe64_agent_session_changed" });
  await entered.promise;
  await harness.controller.closeAllForSession("session-1");
  release.resolve();
  await rejected;
  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.processStops.length, 1);
});

test("OpenCode recovery waits for write admission before replacing an unhealthy server", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.ensureSession("session-1");
  const attempts = [];
  harness.runtime.store.runSessionExclusive = async (_id, lock, _operation, options) => {
    attempts.push({ lock, ...options });
    return { acquired: false };
  };
  harness.failHealth();
  const result = await harness.controller.ensureSession("session-1");
  assert.equal(result.code, "vibe64_agent_write_mode_busy");
  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.processStops.length, 0);
  assert.deepEqual(attempts, [{ lock: "agent-write-mode", operation: "prepare-agent-session", waitMs: 10_000 }]);
});

test("OpenCode rechecks its native session after recovering an unhealthy server", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };

  const first = await harness.controller.ensureSession("session-1", options);
  harness.failHealth();
  const recovered = await harness.controller.ensureSession("session-1", options);

  assert.equal(recovered.thread.id, first.thread.id);
  assert.equal(harness.processStarts.length, 2);
  assert.equal(harness.processStops.length, 1);
  assert.equal(harness.readSessionCalls(), 1);
  assert.equal(harness.createdSessions.length, 1);
  assert.equal(harness.switchedModels.length, 1);
  assert.equal(harness.switchedAgents.length, 1);
});

test("OpenCode recovers a reasoning-only completion into a final answer", async (t) => {
  const harness = await controllerHarness({
    assistantResponses: [{
      content: [{
        id: "reasoning-only-part",
        text: "The command completed and the result is 42.",
        type: "reasoning"
      }],
      text: ""
    }, {
      text: "The result is 42."
    }]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Run the command and tell me its result.",
    messageId: "client-message-reasoning-only"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const completed = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(completed.state, "completed");
  const turnPrompts = harness.promptCalls.filter((entry) => (
    entry.input?.agent !== "vibe64-helper"
  ));
  assert.equal(turnPrompts.length, 2);
  assert.match(
    turnPrompts[1].input.prompt.text,
    /previous response ended without a user-facing final answer/u
  );
  assert.equal(harness.userMessages.length, 1);
  assert.equal(harness.thinkingMessages[0].text, "The command completed and the result is 42.");
  assert.deepEqual(
    harness.assistantMessages.map((message) => message.text),
    ["The result is 42."]
  );
});

test("OpenCode fails explicitly after two reasoning-only completions", async (t) => {
  const reasoningOnly = (id) => ({
    content: [{
      id,
      text: "I have the result but did not emit a final answer.",
      type: "reasoning"
    }],
    text: ""
  });
  const harness = await controllerHarness({
    assistantResponses: [
      reasoningOnly("reasoning-only-first"),
      reasoningOnly("reasoning-only-second")
    ]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Run the command and tell me its result.",
    messageId: "client-message-reasoning-only-twice"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const completed = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  const turnPrompts = harness.promptCalls.filter((entry) => (
    entry.input?.agent !== "vibe64-helper"
  ));
  assert.equal(turnPrompts.length, 2);
  assert.equal(completed.state, "failed");
  assert.equal(
    completed.error,
    "OpenCode finished without a user-facing final response. Please send your message again."
  );
  assert.deepEqual(harness.assistantMessages, []);
});

test("OpenCode close waits for the main turn's final durable write", { timeout: 10_000 }, async (t) => {
  const harness = await controllerHarness({ assistantResponses: [{ pending: true, text: "Working" }] });
  const writing = Promise.withResolvers();
  const release = Promise.withResolvers();
  const write = harness.runtime.store.writeAgentRunEvent;
  harness.runtime.store.writeAgentRunEvent = async (...args) => {
    if (args[2].patch.state === "cancelled") {
      writing.resolve();
      await release.promise;
    }
    return write(...args);
  };
  t.after(async () => {
    release.resolve();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { messageId: "close-during-code", message: "Implement this." });
  let closed = false;
  const closing = harness.controller.closeAllForSession("session-1").then((result) => { closed = true; return result; });
  await writing.promise;
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(closed, false, "close must retain the session until its final write settles");
  release.resolve();
  assert.equal((await closing).ok, true);
  assert.equal(harness.agentRunEvents.at(-1).run.state, "cancelled");
});

test("OpenCode shares one lazy server across open sessions and stops it after the last closes", async (t) => {
  const harness = await controllerHarness();
  const secondSourceRoot = path.join(
    harness.root,
    "sessions",
    "active",
    "session-2",
    "source"
  );
  const secondSessionRoot = path.join(harness.root, "session-state", "session-2");
  await Promise.all([
    mkdir(secondSourceRoot, { recursive: true }),
    mkdir(secondSessionRoot, { recursive: true })
  ]);
  const secondSession = {
    ...harness.session,
    metadata: {
      ...harness.session.metadata,
      source_path: secondSourceRoot
    },
    sessionId: "session-2",
    sessionRoot: secondSessionRoot
  };
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const reconciled = await harness.controller.reconcileSessions([
    harness.session,
    secondSession
  ], {
    runtime: harness.runtime,
    vibe64User: { username: "ada" }
  });
  const serverStarts = harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));

  assert.equal(reconciled.ok, true);
  assert.equal(reconciled.results.every((result) => result.resumed === false), true);
  assert.equal(serverStarts.length, 1);
  assert.equal(harness.createdSessions.length, 2);

  const firstClose = await harness.controller.closeAllForSession("session-1");
  assert.equal(firstClose.processExitProof.sharedProcessRetained, true);
  assert.equal(harness.processStops.length, 0);

  const lastClose = await harness.controller.closeAllForSession("session-2");
  assert.equal(lastClose.processExitProof.exited, true);
  assert.equal(harness.processStops.length, 1);

  const reopened = await harness.controller.ensureSession("session-1", {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  assert.ok(reopened.thread.id);
  assert.equal(harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  )).length, 2);

  const reopenedClose = await harness.controller.closeAllForSession("session-1");
  assert.equal(reopenedClose.processExitProof.exited, true);
  assert.equal(harness.processStops.length, 2);
});

test("a pending OpenCode session start retains the shared server while another session closes", async (t) => {
  let releaseSecondStart = () => null;
  let secondStartReached = () => null;
  const secondStartGate = new Promise((resolve) => {
    releaseSecondStart = resolve;
  });
  const secondStartReady = new Promise((resolve) => {
    secondStartReached = resolve;
  });
  const harness = await controllerHarness({
    async commandEnvironmentGate(input) {
      if (input.sessionId === "session-2") {
        secondStartReached();
        await secondStartGate;
      }
    },
    withCommandBoundary: true
  });
  const secondSourceRoot = path.join(
    harness.root,
    "sessions",
    "active",
    "session-2",
    "source"
  );
  const secondSessionRoot = path.join(harness.root, "session-state", "session-2");
  await Promise.all([
    mkdir(secondSourceRoot, { recursive: true }),
    mkdir(secondSessionRoot, { recursive: true })
  ]);
  const secondSession = {
    ...harness.session,
    metadata: {
      ...harness.session.metadata,
      source_path: secondSourceRoot
    },
    sessionId: "session-2",
    sessionRoot: secondSessionRoot
  };
  t.after(async () => {
    releaseSecondStart();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    vibe64User: { username: "ada" }
  };

  await harness.controller.ensureSession("session-1", {
    ...options,
    session: harness.session
  });
  const secondStart = harness.controller.ensureSession("session-2", {
    ...options,
    session: secondSession
  });
  await secondStartReady;

  const firstClose = await harness.controller.closeAllForSession("session-1");
  releaseSecondStart();
  await secondStart;

  assert.equal(firstClose.processExitProof.sharedProcessRetained, true);
  assert.equal(harness.processStops.length, 0);
  assert.equal(harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  )).length, 1);

  const lastClose = await harness.controller.closeAllForSession("session-2");
  assert.equal(lastClose.processExitProof.exited, true);
  assert.equal(harness.processStops.length, 1);
});

test("OpenCode publishes current provider reasoning while its turn is active", async (t) => {
  const historicalReasoning = "This belongs to an earlier provider turn.";
  const reasoning = "I should answer directly and keep the response concise.";
  const harness = await controllerHarness({
    assistantParts: [{
      id: "reasoning-part-current",
      text: reasoning,
      type: "reasoning"
    }],
    providerEvents: [
      {
        data: {
          properties: {
            part: {
              id: "reasoning-part-old",
              messageID: "assistant-message-old",
              text: historicalReasoning,
              time: { start: Date.now() - 60_000 },
              type: "reasoning"
            }
          },
          type: "message.part.updated"
        },
        id: "reasoning-event-old"
      },
      {
        data: {
          properties: {
            part: {
              id: "reasoning-part-current",
              messageID: "assistant-message-current",
              text: reasoning,
              time: { start: Date.now() + 1_000 },
              type: "reasoning"
            }
          },
          type: "message.part.updated"
        },
        id: "reasoning-event-current"
      }
    ]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Give me a concise answer",
    messageId: "client-message-reasoning"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(harness.thinkingMessages.some((message) => (
    message.text === reasoning
  )), true);
  assert.equal(harness.thinkingMessages.some((message) => (
    message.text === historicalReasoning
  )), false);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-server-reasoning" &&
    payload.payload?.conversationLogPatch?.turn?.text === reasoning
  )), true);
  const progress = harness.publishedSessionChanges.find(([, payload]) => (
    payload.reason === "opencode-server-progress" &&
    payload.payload?.assistantProgress?.partType === "reasoning"
  ));
  assert.equal(progress?.[1]?.payload?.assistantProgress?.text, reasoning);
});

test("OpenCode presents long provider reasoning as compact progress and omits tool completion noise", async (t) => {
  const first = "I should find current sources before answering.";
  const second = "I will compare the useful results and keep the answer concise.";
  const third = "The evidence is ready, so I can now write the response.";
  const reasoning = `${first} ${second}\n\n${third}`;
  const harness = await controllerHarness({
    assistantParts: [
      {
        id: "reasoning-part-current",
        text: reasoning,
        type: "reasoning"
      },
      {
        id: "tool-part-current",
        state: { status: "completed" },
        type: "tool"
      }
    ],
    providerEvents: [
      {
        data: {
          properties: {
            part: {
              id: "reasoning-part-current",
              messageID: "msg_assistant",
              text: `${first} ${second}`,
              time: { start: Date.now() + 1_000 },
              type: "reasoning"
            }
          },
          type: "message.part.updated"
        },
        id: "reasoning-event-current-1"
      },
      {
        data: {
          properties: {
            part: {
              id: "reasoning-part-current",
              messageID: "msg_assistant",
              text: reasoning,
              time: { start: Date.now() + 1_000 },
              type: "reasoning"
            }
          },
          type: "message.part.updated"
        },
        id: "reasoning-event-current-2"
      }
    ]
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Research this, then answer",
    messageId: "client-message-segmented-reasoning"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  const latestById = new Map(harness.thinkingMessages.map((message) => [
    message.messageId,
    message.text
  ]));
  assert.deepEqual([...latestById.values()], [first]);
  assert.equal(harness.thinkingMessages.some((message) => message.text === reasoning), false);
  assert.deepEqual(harness.commentaryMessages, []);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-server-tool"
  )), false);
});

test("OpenCode preserves structured provider errors as readable turn failures", async (t) => {
  const harness = await controllerHarness({
    assistantError: {
      data: { message: "Aborted" },
      name: "MessageAbortedError"
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-1"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const result = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(result.error, "Aborted");
  assert.equal(result.state, "failed");
  assert.equal(harness.systemMessages.length, 1);
  assert.equal(
    harness.systemMessages[0].text,
    "OpenCode could not finish.\n\nAborted\n\nSaved project changes remain."
  );
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-provider-failure" &&
    payload.payload?.conversationLogPatch?.type === "upsert-turn"
  )), true);
});

test("OpenCode makes structured provider API failures actionable", async (t) => {
  const harness = await controllerHarness({
    assistantError: {
      data: { message: "Insufficient balance. Top up your account." },
      name: "APIError"
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-provider-api-failure"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const result = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(result.error, "Insufficient balance. Top up your account.");
  assert.equal(result.state, "failed");
  assert.equal(harness.systemMessages.length, 1);
  assert.match(harness.systemMessages[0].text, /Insufficient balance\. Top up your account\./u);
  assert.match(harness.systemMessages[0].text, /Saved project changes remain/u);
  assert.match(harness.systemMessages[0].text, /\[Manage AI accounts\]\(\/app\/manage\/accounts\)/u);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-provider-failure" &&
    payload.payload?.conversationLogPatch?.type === "upsert-turn"
  )), true);
});

test("OpenCode does not misclassify model token limits as credential failures", async (t) => {
  const harness = await controllerHarness({
    assistantError: {
      data: { message: "Maximum output token limit exceeded" },
      name: "ModelOutputError"
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-token-limit"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const result = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(result.error, "Maximum output token limit exceeded");
  assert.equal(result.state, "failed");
  assert.equal(harness.systemMessages.length, 1);
  assert.match(harness.systemMessages[0].text, /Maximum output token limit exceeded/u);
  assert.doesNotMatch(harness.systemMessages[0].text, /Manage AI accounts/u);
});

test("OpenCode turns make revoked provider keys actionable without exposing raw provider errors", async (t) => {
  const harness = await controllerHarness({
    assistantError: {
      data: { message: "Authentication failed: API key expired or revoked" },
      name: "AuthenticationError"
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.sendMessage("session-1", {
    message: "Reply exactly OK",
    messageId: "client-message-revoked-key"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  const result = await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.equal(result.state, "failed");
  assert.match(result.error, /OpenCode needs attention/u);
  assert.match(result.error, /Open AI Accounts/u);
  assert.doesNotMatch(result.error, /Authentication failed/u);
  assert.equal(harness.systemMessages.length, 1);
  assert.match(harness.systemMessages[0].text, /expired or been revoked/u);
  assert.match(harness.systemMessages[0].text, /\[Open AI Accounts\]\(\/app\/manage\/accounts\)/u);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-credential-failure" &&
    payload.payload?.conversationLogPatch?.type === "upsert-turn"
  )), true);
});

test("OpenCode restarts on key replacement while preserving its database and native session id", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };
  const first = await harness.controller.ensureSession("session-1", options);
  harness.connection.apiKey = "deepseek-key-two";
  harness.connection.fingerprint = `sha256:${"2".repeat(64)}`;
  const second = await harness.controller.ensureSession("session-1", options);
  const sessionStarts = harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));

  assert.equal(first.thread.id, second.thread.id);
  assert.equal(sessionStarts.length, 2);
  assert.equal(sessionStarts[0].options.dbPath, sessionStarts[1].options.dbPath);
  assert.equal(sessionStarts[0].options.workdir, sessionStarts[1].options.workdir);
  assert.equal(sessionStarts[0].options.providerConnections[0].apiKey, "deepseek-key-one");
  assert.equal(sessionStarts[1].options.providerConnections[0].apiKey, "deepseek-key-two");
  assert.equal(harness.processStops.includes(sessionStarts[0].options), true);
  assert.equal(harness.createdSessions.filter((entry) => entry.id === first.thread.id).length, 1);
});

test("OpenCode switches connected providers while preserving its database and native session id", async (t) => {
  const zaiProvider = {
    id: "zai-coding-plan",
    models: {
      "glm-5.3": {
        capabilities: {
          reasoning: true,
          toolcall: true
        },
        id: "glm-5.3",
        name: "GLM 5.3",
        status: "active",
        variants: {
          high: {},
          low: {}
        }
      }
    },
    name: "Z.AI Coding Plan",
    source: "api"
  };
  const catalogProviders = {
    all: [providerDefinition, zaiProvider],
    default: {
      deepseek: "deepseek-chat",
      "zai-coding-plan": "glm-5.3"
    }
  };
  const zaiRevision = openCodeAssistantCapabilities({
    agents,
    providers: catalogProviders
  }).modelProviders.find(({ id }) => id === zaiProvider.id).definitionRevision;
  const harness = await controllerHarness({ catalogProviders });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };
  const first = await harness.controller.ensureSession("session-1", options);

  harness.connection.apiKey = "zai-key-one";
  harness.connection.canonicalUrl = "https://api.z.ai/api/coding/paas/v4";
  harness.connection.defaultModelId = "glm-5.3";
  harness.connection.endpointCode = "zai_coding_plan";
  harness.connection.fingerprint = `sha256:${"3".repeat(64)}`;
  harness.connection.modelProviderId = "zai-coding-plan";
  harness.connection.providerRevision = zaiRevision;
  harness.session.metadata.assistant_selection = serializeVibe64AssistantSelection({
    ...harness.selection,
    modelId: "glm-5.3",
    modelProviderId: "zai-coding-plan"
  });

  const second = await harness.controller.ensureSession("session-1", options);
  const sessionStarts = harness.processStarts.filter((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));

  assert.equal(first.thread.id, second.thread.id);
  assert.equal(sessionStarts.length, 2);
  assert.equal(sessionStarts[0].options.dbPath, sessionStarts[1].options.dbPath);
  assert.equal(sessionStarts[0].options.workdir, sessionStarts[1].options.workdir);
  assert.equal(sessionStarts[0].options.providerConnections[0].modelProviderId, "deepseek");
  assert.equal(sessionStarts[1].options.providerConnections[0].modelProviderId, "zai-coding-plan");
  assert.equal(sessionStarts[1].options.providerConnections[0].apiKey, "zai-key-one");
  assert.equal(harness.processStops.includes(sessionStarts[0].options), true);
  assert.deepEqual(harness.switchedModels.at(-1), {
    id: second.thread.id,
    model: {
      id: "glm-5.3",
      providerID: "zai-coding-plan",
      variant: "high"
    }
  });
  assert.equal(harness.createdSessions.filter((entry) => entry.id === first.thread.id).length, 1);
});

test("OpenCode helper turns use the hidden deny-all agent and bounded structured output", async (t) => {
  const harness = await controllerHarness({
    helperResponse: '```json\n{"subject":"Add durable OpenCode sessions"}\n```',
    providerEvents: [{
      data: {
        properties: { timestamp: Date.now() },
        type: "session.next.reasoning.started"
      },
      id: "detached-progress"
    }]
  });
  const events = [];
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const executionProfile = resolveOpenCodeHelperExecutionProfile({
    assistantSelection: {
      ...harness.selection,
      schema: "vibe64.assistant-selection.v1"
    },
    assistantAccess: {
      defaultModelId: harness.connection.defaultModelId
    }
  }, {
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER,
    workloadId: VIBE64_AGENT_EXECUTION_WORKLOAD_IDS.COMMIT_TITLE
  });
  const conversation = await harness.controller.createConversation("session-1", {
    executionProfile
  }, {
    runtime: harness.runtime,
    session: harness.session
  });
  const result = await harness.controller.runDetachedChatTurn("session-1", {
    conversationId: conversation.conversationId,
    executionProfile,
    outputSchema: {
      properties: { subject: { type: "string" } },
      required: ["subject"],
      type: "object"
    },
    prompt: "Name this work"
  }, {
    onEvent(event) {
      events.push(event);
    },
    runtime: harness.runtime,
    session: harness.session
  });

  assert.deepEqual(events[0], {
    threadId: result.threadId,
    type: "thread"
  });
  const helperSession = harness.createdSessions.find((entry) => entry.id === result.threadId);
  assert.equal(helperSession.agent, OPENCODE_HELPER_AGENT_ID);
  assert.deepEqual(helperSession.model, {
    id: "deepseek-chat",
    providerID: "deepseek",
    variant: "high"
  });
  const helperWorkdir = harness.processStarts[0].options.workdir;
  assert.equal(helperSession.location.directory, helperWorkdir);
  assert.notEqual(helperWorkdir, path.join(
    harness.root,
    "sessions",
    "active",
    "session-1",
    "source"
  ));
  assert.deepEqual(
    harness.createdSessionDirectories.find(({ id }) => id === result.threadId),
    { directory: helperWorkdir, id: result.threadId }
  );
  assert.equal(result.text, '{"subject":"Add durable OpenCode sessions"}');
  const helperPrompt = harness.promptCalls.find((entry) => entry.id === result.threadId).input;
  assert.deepEqual(
    harness.promptDirectories.find(({ id }) => id === result.threadId),
    { directory: helperWorkdir, id: result.threadId }
  );
  assert.equal(helperPrompt.agent, OPENCODE_HELPER_AGENT_ID);
  assert.deepEqual(helperPrompt.model, {
    id: "deepseek-chat",
    providerID: "deepseek",
    variant: "high"
  });
  assert.match(helperPrompt.prompt.text, /Return only one JSON value matching this JSON Schema/u);
  assert.match(helperPrompt.prompt.text, /"required":\["subject"\]/u);
  assert.equal(Object.hasOwn(helperPrompt.prompt, "turnContext"), false);
  assert.equal(events.some((event) => event.type === "session.next.reasoning.started"), true);
  assert.equal(harness.publishedSessionChanges.some(([, payload]) => (
    payload.reason === "opencode-server-progress"
  )), false);
  const registry = JSON.parse(await readFile(
    harness.processStarts[0].options.sessionEnvironmentRegistry,
    "utf8"
  ));
  assert.equal(Object.hasOwn(registry, "promptContexts"), false);

  const tinyProfile = {
    ...executionProfile,
    limits: {
      ...executionProfile.limits,
      maxInputCharacters: 5
    }
  };
  const startsBeforeRejectedInput = harness.processStarts.length;
  await assert.rejects(
    () => harness.controller.runDetachedChatTurn("session-1", {
      executionProfile: tinyProfile,
      prompt: "This input is too long"
    }, {
      runtime: harness.runtime,
      session: harness.session
    }),
    (error) => error?.code === "vibe64_opencode_execution_input_too_large"
  );
  assert.equal(harness.processStarts.length, startsBeforeRejectedInput);
});

test("non-project ephemeral conversations use OpenCode's guarded host agent without project state", async (t) => {
  const harness = await controllerHarness({
    helperResponse: "The trusted host snapshot needs attention."
  });
  harness.controller = throughCommonScopedConversation(harness.controller);
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const workdir = path.join(harness.root, "system-repair-workdir");
  const runtimeRoot = path.join(harness.root, "system-repair-runtime");
  await Promise.all([
    mkdir(workdir, { recursive: true }),
    mkdir(runtimeRoot, { recursive: true })
  ]);
  const assistantScope = {
    environment: {},
    id: "system_repair_test",
    runtimeRoot,
    stableContext: "Trusted bounded host snapshot.",
    workdir
  };
  const options = {
    assistantScope,
    assistantSelection: {
      ...harness.selection,
      schema: "vibe64.assistant-selection.v1"
    },
    vibe64User: { role: "owner", username: "owner" }
  };

  const conversation = await harness.controller.createConversation(assistantScope.id, {
    ephemeral: true
  }, options);
  const turn = await harness.controller.startConversationTurn(assistantScope.id, {
    conversationId: conversation.conversationId,
    ephemeral: true,
    message: "Explain this snapshot only.",
    messageId: "message_1"
  }, options);

  assert.equal(turn.ok, true, JSON.stringify(turn));
  assert.equal(harness.runtimeCreateCalls(), 0);
  assert.equal(harness.createdSessions[0].agent, OPENCODE_EPHEMERAL_AGENT_ID);
  assert.equal(harness.createdSessions[0].location.directory, workdir);
  assert.equal(harness.promptCalls[0].input.agent, OPENCODE_EPHEMERAL_AGENT_ID);
  assert.equal(harness.promptCalls[0].input.prompt.text, "Explain this snapshot only.");
  const registry = JSON.parse(await readFile(
    harness.processStarts[0].options.sessionEnvironmentRegistry,
    "utf8"
  ));
  const ephemeralEnvironment = registry.sessions.find((entry) => (
    entry.sessionId === assistantScope.id
  ));
  assert.deepEqual(ephemeralEnvironment.promptContext, {
    scope: "ephemeral",
    stableContext: assistantScope.stableContext
  });
  assert.deepEqual(ephemeralEnvironment.env, {});
  assert.deepEqual(ephemeralEnvironment.pathEntries, []);

  const deleted = await harness.controller.deleteConversation(assistantScope.id, {
    conversationId: conversation.conversationId,
    ephemeral: true
  }, options);
  assert.equal(deleted.ok, true, JSON.stringify(deleted));
  assert.equal(deleted.providerExit.ok, true);
  assert.equal(deleted.providerExit.processExitProof.sharedProcessRetained, true);
  assert.equal(harness.processStops.length, 0);
  await harness.controller.closeAllForProject();
  assert.equal(harness.processStops.length, 1);
});

test("scoped OpenCode helpers retain bounded policy and cleanup without rebinding main chat", async (t) => {
  const limit = VIBE64_AGENT_HELPER_WORKLOAD_LIMITS.request_routing.maxOutputCharacters;
  const harness = await controllerHarness({ helperResponse: "x".repeat(limit + 1) });
  harness.controller = throughCommonScopedConversation(harness.controller);
  t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
  await harness.controller.ensureSession("session-1");
  const before = structuredClone(harness.session);
  const assistantScope = { id: "router_scope", environment: {}, workdir: harness.root,
    runtimeRoot: path.join(harness.root, "router-runtime"), stableContext: "Classify supplied text." };
  const options = { assistantScope, assistantSelection: { ...harness.selection, modelId: "deepseek-reasoner",
    schema: "vibe64.assistant-selection.v1" } };
  const executionProfile = resolveOpenCodeHelperExecutionProfile({ ...options,
    assistantAccess: { defaultModelId: "legacy-helper-model" }
  }, { profileId: "helper", workloadId: "request_routing" });
  assert.equal(executionProfile.model, "deepseek-reasoner");
  const created = await harness.controller.createConversation(assistantScope.id, { ephemeral: true, executionProfile }, options);
  const input = { ephemeral: true, conversationId: created.conversationId, executionProfile, message: "Classify" };
  const started = await harness.controller.startConversationTurn(assistantScope.id, input, options);
  assert.equal(started.ok, true);
  await assert.rejects(harness.controller.waitForConversationTurn(assistantScope.id, { ...input, timeoutMs: 60_000 }, options),
    /output exceeded/, "an explicit wait timeout cannot bypass the stored workload's bounded completion");
  await assert.rejects(harness.controller.readConversation(assistantScope.id, input, options), /output exceeded/);
  const helper = harness.createdSessions.find(({ id }) => id === created.conversationId);
  assert.equal(helper.agent, OPENCODE_HELPER_AGENT_ID);
  assert.equal(helper.model.id, "deepseek-reasoner");
  assert.equal(harness.promptCalls.at(-1).input.agent, OPENCODE_HELPER_AGENT_ID);
  const registry = JSON.parse(await readFile(harness.processStarts.at(-1).options.sessionEnvironmentRegistry, "utf8"));
  const environment = registry.sessions.find(({ sessionId }) => sessionId === assistantScope.id);
  assert.deepEqual(environment.env, {});
  assert.deepEqual(environment.pathEntries, []);
  assert.deepEqual(environment.promptContext, { scope: "ephemeral", stableContext: assistantScope.stableContext },
    "the scope receives only its supplied context, without project guidance");
  await assert.rejects(harness.controller.startConversationTurn(assistantScope.id, { ...input, executionProfile: undefined }, options), /profile changed/);
  const deleted = await harness.controller.deleteConversation(assistantScope.id, input, options);
  assert.equal(deleted.ok, true);
  assert.deepEqual(harness.session, before);
  await harness.controller.sendMessage("session-1", { message: "Main continues", messageId: "main-continues" });
  await harness.controller.waitForTurn("session-1");
  assert.equal(harness.promptCalls.at(-1).input.model.id, harness.selection.modelId);
});

test("sequential scoped OpenCode helpers reuse the service after removing their private conversations", async (t) => {
  const deleted = [];
  const harness = await controllerHarness({ helperResponse: "Plan", beforeDeleteSession: id => deleted.push(id) });
  harness.controller = throughCommonScopedConversation(harness.controller);
  t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
  for (const id of ["router_first", "router_second"]) {
    const assistantScope = { id, environment: {}, workdir: path.join(harness.root, id),
      runtimeRoot: path.join(harness.root, id, "runtime"), stableContext: "Classify supplied text." };
    const options = { assistantScope, assistantSelection: harness.selection };
    const executionProfile = resolveOpenCodeHelperExecutionProfile(options,
      { profileId: "helper", workloadId: "request_routing" });
    const { conversationId } = await harness.controller.createConversation(id, { ephemeral: true, executionProfile }, options);
    const input = { conversationId, executionProfile, ephemeral: true, message: "Classify this request." };
    await harness.controller.startConversationTurn(id, input, options);
    assert.equal((await harness.controller.waitForConversationTurn(id, input, options)).text, "Plan");
    const closed = await harness.controller.deleteConversation(id, input, options);
    assert.equal(closed.ok, true);
    assert.equal(closed.providerExit.processExitProof.sharedProcessRetained, true);
    assert.ok(deleted.includes(conversationId));
    const registry = JSON.parse(await readFile(harness.processStarts[0].options.sessionEnvironmentRegistry, "utf8"));
    assert.deepEqual(registry.sessions, [], "the retained service must not retain helper scope or context");
    assert.equal(harness.processStops.length, 0, "helper cleanup must not force the next request through cold startup");
  }
  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.promptCalls.length, 2);
  await harness.controller.closeAllForProject({ projectContextRoot: harness.root });
  assert.equal(harness.processStops.length, 1, "project cleanup still stops an idle shared service");
});

test("OpenCode receives the same complete session command boundary as Codex", async (t) => {
  const harness = await controllerHarness({ withCommandBoundary: true });
  harness.controllerOptions.projectService.projectInspectionEnvironment = async (input) => {
    assert.equal(input.sessionId, "session-1");
    assert.equal(input.target, "opencode");
    return { REFERENCE_SECRET: "dummy-project-secret" };
  };
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  await harness.controller.ensureSession("session-1", {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });

  assert.equal(harness.commandEnvironmentCalls.length, 1);
  assert.equal(harness.commandEnvironmentCalls[0].sessionId, "session-1");
  assert.equal(harness.commandEnvironmentCalls[0].worktreePath, path.join(
    harness.root,
    "sessions",
    "active",
    "session-1",
    "source"
  ));
  const sessionProcess = harness.processStarts.find((entry) => (
    entry.options.execution.operationId === "opencode-server"
  ));
  assert.deepEqual(sessionProcess.options.shimDirs, [genesisCommandShimDirectory()]);
  assert.match(sessionProcess.options.hostContextResolver, /vibe64-genesis-host-context$/u);
  const registry = JSON.parse(await readFile(
    sessionProcess.options.sessionEnvironmentRegistry,
    "utf8"
  ));
  assert.deepEqual(registry.sessions[0].env, {
    REFERENCE_SECRET: "dummy-project-secret",
    VIBE64_AGENT_DATABASE_COMMAND_SOCKET: "/managed/database.sock",
    VIBE64_AGENT_ENV_COMMAND_SOCKET: "/managed/environment.sock",
    VIBE64_AGENT_PREVIEW_COMMAND_SOCKET: "/managed/preview.sock",
    VIBE64_CODEX_GIT_COMMAND_SOCKET: "/managed/git.sock"
  });
  assert.deepEqual(registry.sessions[0].pathEntries, ["/managed/wrappers"]);
  assert.equal(registry.sessions[0].sessionId, "session-1");
  assert.deepEqual(registry.sessions[0].promptContext, {
    conversationKind: "main",
    scope: "session",
    session: {
      managedDatabaseRefresh: true,
      managedEnvironment: true,
      managedGit: true,
      managedPreview: true
    }
  });

  const conversation = await harness.controller.createConversation("session-1", {}, {
    runtime: harness.runtime,
    session: harness.session
  });
  await harness.controller.runDetachedChatTurn("session-1", {
    conversationId: conversation.conversationId,
    prompt: "Run one temporary task"
  }, {
    runtime: harness.runtime,
    session: harness.session
  });
  const updatedRegistry = JSON.parse(await readFile(
    sessionProcess.options.sessionEnvironmentRegistry,
    "utf8"
  ));
  const temporaryEnvironment = updatedRegistry.sessions.find((entry) => (
    entry.upstreamSessionId === conversation.conversationId
  ));
  assert.deepEqual(temporaryEnvironment, {
    ...updatedRegistry.sessions[0],
    promptContext: {
      conversationKind: "temporary",
      scope: "session",
      session: {
        managedDatabaseRefresh: true,
        managedEnvironment: true,
        managedGit: true,
        managedPreview: true
      }
    },
    upstreamSessionId: conversation.conversationId
  });
});

test("OpenCode distinguishes an admitted renewal handover from a failed model response", async (t) => {
  const harness = await controllerHarness({
    assistantError: "Authentication failed"
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const handover = renewalHandover();
  const handoverHash = sessionRenewalHandoverHash(handover);
  let failure = null;

  await assert.rejects(
    () => harness.controller.seedSessionRenewalHandover("session-1", {
      handover,
      handoverHash,
      oldThreadId: "predecessor-thread",
      operationKey: "renewal:failed-model",
      source: renewalSource
    }, {
      runtime: harness.runtime,
      session: harness.session
    }),
    (error) => {
      failure = error;
      return error?.code === "vibe64_session_renewal_turn_failed";
    }
  );

  assert.equal(failure.details.handoverPromptAccepted, true);
  assert.ok(failure.details.threadId);
  assert.ok(failure.details.turnId);
  assert.equal(harness.promptCalls.length, 1);
  assert.equal(
    harness.promptCalls[0].input.prompt.text,
    sessionRenewalSeedPrompt({ handover, handoverHash, source: renewalSource })
  );
});

test("OpenCode preserves handover admission when waiting for the model fails", async (t) => {
  const harness = await controllerHarness({
    messagesErrorAfterPrompt: new Error("Timed out waiting for OpenCode")
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const handover = renewalHandover();
  const handoverHash = sessionRenewalHandoverHash(handover);
  let failure = null;

  await assert.rejects(
    () => harness.controller.seedSessionRenewalHandover("session-1", {
      handover,
      handoverHash,
      oldThreadId: "predecessor-thread",
      operationKey: "renewal:model-timeout",
      source: renewalSource
    }, {
      runtime: harness.runtime,
      session: harness.session
    }),
    (error) => {
      failure = error;
      return error?.code === "vibe64_session_renewal_turn_failed";
    }
  );

  assert.equal(failure.details.handoverPromptAccepted, true);
  assert.ok(failure.details.threadId);
  assert.equal(harness.promptCalls.length, 1);
});

test("OpenCode does not claim handover delivery when the fresh history cannot be read", async (t) => {
  const harness = await controllerHarness({
    messagesErrorAfterPrompt: new Error("OpenCode history is unavailable"),
    messagesErrorAfterPromptCount: 2
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const handover = renewalHandover();
  let failure = null;

  await assert.rejects(
    () => harness.controller.seedSessionRenewalHandover("session-1", {
      handover,
      handoverHash: sessionRenewalHandoverHash(handover),
      oldThreadId: "predecessor-thread",
      operationKey: "renewal:unreadable-history",
      source: renewalSource
    }, {
      runtime: harness.runtime,
      session: harness.session
    }),
    (error) => {
      failure = error;
      return error?.code === "vibe64_session_renewal_turn_failed";
    }
  );

  assert.equal(failure.details.handoverPromptAccepted, false);
  assert.ok(failure.details.threadId);
  assert.equal(harness.promptCalls.length, 1);
});

test("OpenCode leaves the first visible message raw after a delivered renewal handover", async (t) => {
  const harness = await controllerHarness();
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  harness.session.metadata.renewal_handover_delivered_at =
    "2026-09-04T01:00:00.000Z";

  await harness.controller.sendMessage("session-1", {
    message: "Continue after I repair the provider login.",
    messageId: "renewal-visible-follow-up"
  }, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });
  await harness.controller.waitForTurn("session-1", {
    runtime: harness.runtime,
    session: harness.session
  });

  assert.deepEqual(harness.renderPromptCalls, []);
  assert.equal(
    harness.promptCalls[0].input.prompt.text,
    "Continue after I repair the provider login."
  );
});

test("OpenCode starts its interactive terminal by attaching to the session's native history", async (t) => {
  const harness = await controllerHarness({ withCommandBoundary: true });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });

  const terminal = await harness.controller.startTerminal("session-1", {}, {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  });

  assert.equal(terminal.ok, true);
  assert.equal(terminal.id, "opencode-terminal-1");
  assert.equal(harness.terminalStarts.length, 1);
  assert.equal(harness.terminalStarts[0].session, harness.session);
  assert.equal(harness.terminalStarts[0].workdir, path.join(
    harness.root,
    "sessions",
    "active",
    "session-1",
    "source"
  ));
  assert.match(harness.terminalStarts[0].namespace, /vibe64-opencode.*session-1/u);
  assert.equal(harness.terminalStarts[0].upstreamSessionId, harness.session.metadata.opencode_conversation_id);
  assert.doesNotMatch(harness.terminalStarts[0].upstreamSessionId, /^ses_vibe64_/u);
});

test("OpenCode reuses its terminal without creating prompt actor state", async (t) => {
  const harness = await controllerHarness({
    realAttachedTerminal: true,
    withCommandBoundary: true
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = {
    runtime: harness.runtime,
    session: harness.session,
    vibe64User: { username: "ada" }
  };

  const first = await harness.controller.startTerminal("session-1", {}, options);
  const second = await harness.controller.startTerminal("session-1", {}, options);

  assert.equal(first.ok, true);
  assert.equal(second.id, first.id);
  assert.equal(harness.terminalStarts.length, 1);

  await harness.controller.writeTerminal("session-1", first.id, "first", {
    trackGitActor: true
  }, {
    ...options,
    vibe64User: { preferredName: "Ada", username: "ada" }
  });
  await harness.controller.writeTerminal("session-1", first.id, "second", {
    trackGitActor: true
  }, {
    ...options,
    vibe64User: { preferredName: "Grace", username: "grace" }
  });
  await harness.controller.writeTerminal("session-1", first.id, "third", {
    trackGitActor: true
  }, {
    ...options,
    vibe64User: { username: "unnamed" }
  });
  const registryPath = harness.processStarts[0].options.sessionEnvironmentRegistry;
  const registry = JSON.parse(await readFile(registryPath, "utf8"));
  assert.equal(Object.hasOwn(registry.sessions[0], "turnContext"), false);

  await harness.controller.sendMessage("session-1", {
    message: "Routed message",
    messageId: "client-message-after-terminal"
  }, {
    ...options,
    vibe64User: { preferredName: "Ada", username: "ada" }
  });
  assert.equal(Object.hasOwn(harness.promptCalls.at(-1).input.prompt, "turnContext"), false);
});

test("OpenCode grants retained file access to the attached conversation before writing and never prompts", async (t) => {
  const permissions = [];
  let permissionError = false;
  const harness = await controllerHarness({
    realAttachedTerminal: true,
    async allowConversationAttachments(id, attachments) {
      if (permissionError) throw new Error("Permission update failed");
      permissions.push({ id, attachments });
    }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = { runtime: harness.runtime, session: harness.session };
  const terminal = await harness.controller.startTerminal("session-1", {}, options);
  const attachments = [{ path: "/retained/attachment/file" }];
  const result = await harness.controller.writeTerminal("session-1", terminal.id,
    "[/retained/attachment/file] ", { attachments }, options);
  assert.equal(result.ok, true);
  assert.deepEqual(permissions, [{ id: harness.session.metadata.opencode_conversation_id, attachments }]);
  assert.equal(harness.promptCalls.length, 0);
  permissionError = true;
  await assert.rejects(harness.controller.writeTerminal("session-1", terminal.id,
    "ignored", { attachments }, options), /Permission update failed/);
  await harness.controller.closeTerminal("session-1", terminal.id);
  await assert.rejects(harness.controller.writeTerminal("session-1", terminal.id,
    "ignored", { attachments }, options), /Reopen the OpenCode terminal/);
});

for (const fallback of [false, true]) {
  test(`OpenCode observation loss verifies ${fallback ? "shared process exit" : "native abort"} and requires explicit Send`, async (t) => {
    const loss = Promise.withResolvers();
    let interrupts = 0;
    let connections = 0;
    const harness = await controllerHarness({
      assistantResponses: [{ pending: true, text: "" }, "Explicit continuation"],
      interrupt: async () => { interrupts += 1; return !fallback; },
      async *events(_id, { onReady, signal }) {
        onReady();
        yield { data: { type: "session.status", properties: { sessionID: _id } } };
        connections += 1;
        await Promise.race([
          connections === 1 ? loss.promise : new Promise(() => {}),
          new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))
        ]);
      }
    });
    t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
    await harness.controller.sendMessage("session-1", { message: "Work", messageId: "before-loss" });
    loss.resolve();
    const stopped = await harness.controller.waitForTurn("session-1");
    assert.equal(stopped.active, false);
    assert.match(stopped.error, /event connection ended/);
    assert.equal(interrupts, 1);
    assert.equal(harness.processStops.length, fallback ? 1 : 0);
    assert.equal(harness.promptCalls.length, 1);
    const admitted = await harness.controller.sendMessage("session-1", { message: "Continue", messageId: "after-loss" });
    assert.equal(admitted.ok, true);
    await harness.controller.waitForTurn("session-1");
    assert.equal(harness.assistantMessages.at(-1).text, "Explicit continuation");
  });
}

test("OpenCode keeps Stop available and refuses new work when process exit is unverified", async (t) => {
  const loss = Promise.withResolvers();
  let stopped = false;
  const harness = await controllerHarness({
    assistantResponses: [{ pending: true, text: "" }],
    interrupt: async () => false,
    stop: async () => ({ exited: stopped }),
    async *events(_id, { onReady, signal }) {
      onReady();
      yield { data: { type: "session.status", properties: { sessionID: _id } } };
      await Promise.race([loss.promise, new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }))]);
    }
  });
  t.after(async () => { stopped = true; await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
  await harness.controller.sendMessage("session-1", { message: "Work", messageId: "unknown-stop" });
  loss.resolve();
  const state = await harness.controller.waitForTurn("session-1");
  assert.equal(state.active, true);
  assert.equal(state.status, "observation_lost");
  await assert.rejects(harness.controller.sendMessage("session-1", { message: "Cannot overlap", messageId: "overlap" }), /could not be verified/);
  assert.equal(harness.promptCalls.length, 1);
  stopped = true;
  const retried = await harness.controller.interruptTurn("session-1");
  assert.equal(retried.ok, true);
  assert.equal(retried.turn.active, false);
});

test("OpenCode stops native work when saving its transcript fails", async (t) => {
  let interrupts = 0;
  const harness = await controllerHarness({ interrupt: async () => { interrupts += 1; return true; } });
  t.after(async () => { await harness.controller.closeAllForProject(); await rm(harness.root, { force: true, recursive: true }); });
  harness.runtime.store.writeConversationAssistantMessage = async () => { throw new Error("Transcript storage unavailable"); };
  await harness.controller.sendMessage("session-1", { message: "Work", messageId: "storage-failure" });
  const state = await harness.controller.waitForTurn("session-1");
  assert.equal(interrupts, 1);
  assert.equal(state.active, false);
  assert.match(state.error, /Transcript storage unavailable/);
  assert.equal(harness.promptCalls.length, 1);
});

for (const condition of ["idle", "missing turn identity", "busy", "unknown", "read failure", "newer run"]) {
  test(`OpenCode connection checks reconcile stale busy records: ${condition}`, async (t) => {
    let statusRead = async () => ({ type: "idle" });
    const harness = await controllerHarness({ sessionStatus: (...args) => statusRead(...args) });
    t.after(async () => {
      await harness.controller.closeAllForProject();
      await rm(harness.root, { force: true, recursive: true });
    });
    const ready = await harness.controller.ensureSession("session-1");
    const savedRun = {
      id: "opencode_server",
      active: true,
      state: "active",
      observationError: "Event connection lost; stop unconfirmed.",
      updatedAt: "2026-09-16T15:20:24.255Z",
      ...(condition === "missing turn identity" ? {} : { threadId: ready.thread.id, turnId: "old-turn" })
    };
    harness.session.agentRuns = [savedRun];
    const writeRun = harness.runtime.store.writeAgentRunEvent;
    harness.runtime.store.writeAgentRunEvent = async (...args) => {
      const run = await writeRun(...args);
      harness.session.agentRuns = [run];
      return run;
    };
    statusRead = async () => {
      if (condition === "read failure") throw new Error("Status unavailable");
      if (condition === "newer run") {
        harness.session.agentRuns = [{ ...savedRun, updatedAt: "2026-09-18T15:20:24.255Z" }];
      }
      return { type: ["busy", "unknown"].includes(condition) ? condition : "idle" };
    };
    if (condition === "read failure") {
      await assert.rejects(harness.controller.ensureSession("session-1"), /Status unavailable/);
    } else {
      assert.equal((await harness.controller.ensureSession("session-1")).ok, true);
    }
    const recovered = ["idle", "missing turn identity"].includes(condition);
    assert.equal(harness.session.agentRuns[0].active, !recovered);
    assert.equal(harness.agentRunEvents.length, recovered ? 1 : 0);
    assert.equal(harness.promptCalls.length, 0);
    if (recovered) {
      assert.notEqual((await harness.controller.sessionState("session-1")).turn?.active, true);
      assert.equal((await harness.controller.ensureSession("session-1")).ok, true);
      assert.equal(harness.agentRunEvents.length, 1);
    }
  });
}

test("OpenCode startup retries an unverified observation stop without restarting the turn", async (t) => {
  const loss = Promise.withResolvers();
  let exited = false;
  const harness = await controllerHarness({
    assistantResponses: [{ pending: true, text: "" }],
    interrupt: async () => false,
    stop: async () => ({ exited }),
    async *events(id, { onReady, signal }) {
      onReady();
      yield { data: { type: "session.status", properties: { sessionID: id } } };
      const aborted = new Promise((resolve) => signal.addEventListener("abort", resolve, { once: true }));
      await Promise.race([loss.promise, aborted]);
    }
  });
  let restarted;
  t.after(async () => {
    exited = true;
    await restarted?.closeAllForProject();
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Work", messageId: "restart-unverified" });
  loss.resolve();
  await harness.controller.waitForTurn("session-1");
  const savedRun = structuredClone(harness.agentRunEvents.at(-1).run);
  assert.equal(savedRun.active, true);
  assert.ok(savedRun.observationError);
  const session = { ...harness.session, agentRuns: [savedRun] };
  restarted = harness.createController();
  const failed = await restarted.reconcileSessions([session]);
  assert.equal(failed.ok, false);
  assert.equal(harness.promptCalls.length, 1);
  exited = true;
  const stopped = await restarted.reconcileSessions([session]);
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  assert.equal(stopped.results[0].resumed, false);
  assert.equal(harness.agentRunEvents.at(-1).run.active, false);
  assert.equal(harness.promptCalls.length, 1);
});

for (const [label, failure, expected] of [
  ["timeout", `GENESIS_HOOK_FAILURE ${JSON.stringify({ scope: "turn", outcome: "timeout", elapsedMs: 5005, timeoutMs: 5000, code: null, signal: "SIGTERM", stderr: "" })}`, /Genesis turn hook timed out after 5\.0s \(signal SIGTERM\)/u],
  ["nonzero exit", `GENESIS_HOOK_FAILURE ${JSON.stringify({ scope: "session", outcome: "failed", elapsedMs: 92, timeoutMs: 5000, code: 7, signal: null, stderr: "Project resolver configuration is invalid." })}`, /Genesis session hook failed after 0\.1s \(exit\/code 7\)/u],
  ["missing executable", `GENESIS_HOOK_FAILURE ${JSON.stringify({ scope: "turn", outcome: "unavailable", elapsedMs: 2, timeoutMs: 5000, code: "ENOENT", signal: null, stderr: "" })}`, /Genesis executable was unavailable/u],
  ["legacy hook", "Command failed: genesis hook turn --project-root /workspace/source at genericNodeError (node:child_process:998:22) at Plugin.trigger (/$bunfs/root/chunk.js:1:5)", /timeout is unconfirmed/u]
]) {
  test(`OpenCode reports a Genesis hook ${label} without a raw runtime stack or credential advice`, async (t) => {
    const harness = await controllerHarness({ assistantError: { name: "UnknownError", data: { message: `Error: ${failure}\n at Plugin.trigger (/$bunfs/root/chunk.js:1:5)` } } });
    t.after(async () => {
      await harness.controller.closeAllForProject();
      await rm(harness.root, { recursive: true, force: true });
    });
    await harness.controller.sendMessage("session-1", { message: "Continue", messageId: `hook-${label}` });
    const result = await harness.controller.waitForTurn("session-1");
    assert.equal(result.state, "failed");
    const notice = harness.systemMessages[0].text;
    assert.match(notice, expected);
    assert.match(notice, /Saved project changes remain/u);
    assert.match(notice, /send your message again/u);
    assert.doesNotMatch(notice, /Plugin\.trigger|\$bunfs|GENESIS_HOOK_FAILURE|Manage AI accounts/u);
    if (label === "nonzero exit") assert.match(notice, /Project resolver configuration is invalid\./u);
  });
}

async function boundMainOpenCodeFixture(t, options = {}) {
  let conversations;
  const harness = await controllerHarness({ ...options,
    async onSessionChanged(id, event) {
      await options.onSessionChanged?.(id, event);
      if (conversations) await conversations.publishNative({ namespace: opencodeTerminalNamespace(id), sessionId: id, event });
    }
  });
  const suppliedRuntime = options.runtimeFactory ? await options.runtimeFactory({ harness }) : null;
  const store = suppliedRuntime ? suppliedRuntime.store : createVibe64SessionStore({ projectContextRoot: harness.root,
    projectRuntimeRoot: path.join(harness.root, "runtime") });
  if (suppliedRuntime) {
    harness.runtime = suppliedRuntime;
    harness.controllerOptions.projectService.createRuntime = async () => suppliedRuntime;
  } else {
    await store.createSession({ sessionId: "session-1", runtimeKind: "genesis" });
    for (const [key, value] of Object.entries(harness.session.metadata)) await store.writeMetadataValue("session-1", key, value);
  }
  // The existing fake native client selects its response by this saved identity.
  // Mirror fixture metadata only; every durable write uses the actual app store.
  const writeMetadata = store.writeMetadataValue;
  store.writeMetadataValue = async (id, key, value) => {
    const result = await writeMetadata(id, key, value);
    harness.session.metadata[key] = value;
    return result;
  };
  harness.runtime.store = store;
  if (!suppliedRuntime) harness.runtime.getSession = id => store.readSession(id);
  const context = { runtime: harness.runtime, sessionId: suppliedRuntime ? harness.session.sessionId : "session-1", providerId: "opencode",
    vibe64User: { id: "owner", username: "Owner", role: "owner" } };
  conversations = createConversationRuntime({ authorize: ({ context, conversationId }) => context.sessionId === conversationId,
    host: { nativeTools: true, conversation: ({ id, context, input, operation }) => operation === "dispose"
      ? prepareSessionConversationDisposal(provider, id, context, input)
      : createSessionConversationBinding(provider, id, {
      ...context, prepareInput: (input, current) => current.prepareInput ? current.prepareInput(input) : input
    }) }
  });
  const provider = harness.controller.provider;
  const manager = createSessionAgentManager({ conversationRuntime: conversations, providers: [provider],
    readAssistantAccess: async () => ({ available: true, ownerOnly: false,
      connectionIdentity: harness.connection.fingerprint, endpointCode: harness.connection.endpointCode })
  });
  t.after(async () => {
    try { await conversations.close(); await harness.controller.closeAllForProject(); }
    finally { await rm(harness.root, { force: true, recursive: true }); }
  });
  return { ...harness, store, conversations, provider, manager, context,
    open: (representation = "canonical") => conversations.open({ id: context.sessionId, context, representation }) };
}

test("main OpenCode binds the original receipt, stream, steering and native identity", { timeout: 15000 }, async t => {
  const first = { pending: true, text: "First partial" };
  const second = { pending: true, text: "Steered partial" };
  const streamed = Promise.withResolvers();
  const f = await boundMainOpenCodeFixture(t, { assistantResponses: [first, second],
    onSessionChanged(_id, event) {
      if (event.reason === "assistant-stream" && event.payload.conversationStream.messages.length) streamed.resolve();
    }
  });
  const canonical = await f.open();
  const events = [];
  const unsubscribe = await canonical.subscribe(event => events.push(event));
  t.after(unsubscribe);
  assert.equal((await canonical.read()).engine, "opencode");
  assert.equal(f.processStarts.length, 0, "passive opening must not start native work");
  const sent = await f.manager.sendMessage(f.context.sessionId, { message: "Initial task", messageId: "bound-open-first" }, f.context);
  assert.equal(sent.delivered, true, JSON.stringify(sent));
  await streamed.promise;
  assert.equal((await canonical.read()).status, "working");
  assert.equal((await f.manager.sessionState(f.context.sessionId, f.context)).thread.id, sent.thread.id);
  assert.equal(f.promptCalls[0].input.delivery, "queue");
  const steered = await f.manager.sendMessage(f.context.sessionId, { message: "Make it shorter", messageId: "bound-open-steer" }, f.context);
  assert.equal(steered.deliveryMode, "steer");
  assert.equal(f.promptCalls[1].input.delivery, "steer");
  assert.equal(steered.thread.id, sent.thread.id);
  second.pending = false;
  second.text = "Finished more briefly.";
  await f.controller.waitForTurn("session-1");
  const saved = await f.store.readConversationLog("session-1");
  assert.deepEqual(saved.filter(turn => turn.user).map(turn => turn.user.messageId), ["bound-open-first", "bound-open-steer"]);
  assert.ok(saved.some(turn => turn.messages.some(message => message.text === "Finished more briefly.")));
  assert.ok(saved.some(turn => turn.metadata.actorId === "Owner"));
  assert.ok(events.some(event => event.type === "transcript" && event.patch.turn.user?.messageId === "bound-open-first"));
  const count = f.promptCalls.length;
  assert.equal((await f.manager.sendMessage(f.context.sessionId, { message: "Initial task", messageId: "bound-open-first" }, f.context)).duplicate, true);
  assert.equal(f.promptCalls.length, count, "the original authored receipt must prevent a second native prompt");
  assert.equal(f.processStarts.length, 1);
  const session = await f.store.readSession("session-1");
  assert.equal(session.metadata.opencode_conversation_id, sent.thread.id);
  assert.equal(session.metadata.runtime, undefined);
  assert.equal(saved.some(turn => turn.metadata.runtime), false);
});

test("main OpenCode Stop retains failed native cleanup and permits the original retry", { timeout: 15000 }, async t => {
  let attempts = 0;
  const f = await boundMainOpenCodeFixture(t, { assistantResponses: [{ pending: true, text: "" }],
    interrupt: async () => ++attempts > 1 });
  const sent = await f.manager.sendMessage(f.context.sessionId, { message: "Continue working", messageId: "bound-open-stop" }, f.context);
  assert.equal(sent.delivered, true, JSON.stringify(sent));
  await assert.rejects(f.manager.interruptTurn(f.context.sessionId, {}, f.context), { code: "vibe64_opencode_interrupt_unconfirmed" });
  assert.equal((await f.manager.sessionState(f.context.sessionId, f.context)).turn.active, true);
  const stopped = await f.manager.interruptTurn(f.context.sessionId, {}, f.context);
  assert.equal(stopped.turn.state, "interrupted");
  assert.equal(stopped.turn.active, false);
  assert.equal(f.promptCalls.length, 1);
  assert.equal(attempts, 2);
  const next = await f.manager.sendMessage(f.context.sessionId, { message: "A new task", messageId: "bound-open-after-stop" }, f.context);
  assert.equal(next.delivered, true, JSON.stringify(next));
  assert.equal(f.promptCalls.at(-1).input.delivery, "queue");
  await f.controller.waitForTurn("session-1");
});


async function mainOpenCodeServiceFixture(t, { actions = null, onSessionChanged = null, ...options } = {}) {
  let removeFixture;
  const f = await boundMainOpenCodeFixture({ after(callback) { removeFixture = callback; } }, options);
  let service;
  t.after(async () => {
    try { await service?.close(); }
    finally { await removeFixture(); }
  });
  await f.store.writeMetadataValue(f.context.sessionId, "label", "BoundOpenCode");
  const projectService = {
    ...f.controllerOptions.projectService,
    createRuntime: () => f.runtime,
    createSessionStore: () => f.store,
    currentTargetRoot: () => f.root,
    readCurrentProject: async () => ({ path: f.root, projectContextRoot: f.root,
      sourceRoot: f.session.metadata.source_path, slug: "opencode-main-fixture" }),
    projectInspectionEnvironment: async () => ({ VIBE64_RUNTIME_NAMESPACE: "test", VIBE64_WORKSPACE: "test" }),
    projectExecutionEnvironment: async () => ({}),
    readEnv: async () => ({ ok: true, records: [] }),
    runInProjectContext: async (_context, operation) => operation(),
    saveEnvUserValues: async () => ({ ok: true })
  };
  const publications = [];
  service = createTerminalService({ actions, projectService,
    env: { ...f.controllerOptions.env, VIBE64_SYSTEM_ROOT: path.join(f.root, "system"),
      VIBE64_RUNTIME_NAMESPACE: "test", VIBE64_WORKSPACE: "test" },
    codexTerminalController: { codexToolHomeRequired: false,
      codexAppServerProviderOptions: { systemRoot: path.join(f.root, "system") } },
    opencodeTerminalController: f.controllerOptions,
    publishSessionChanged: { agentTerminal: async (id, event) => {
      publications.push(event);
      await onSessionChanged?.(id, event);
    } }
  });
  service.configureAssistantRuntime({
    listConnections: f.controllerOptions.listConnections,
    resolveConnection: f.controllerOptions.resolveConnection,
    readAssistantAccess: async () => ({ available: true, ownerOnly: false,
      connectionIdentity: f.connection.fingerprint, endpointCode: f.connection.endpointCode })
  });
  return { ...f, service, projectService, publications };
}

test("main OpenCode terminal service retains original admission, streaming and Stop", { timeout: 30000 }, async t => {
  const response = { pending: true, text: "Service progress" };
  const streamed = Promise.withResolvers();
  const f = await mainOpenCodeServiceFixture(t, {
    assistantResponses: [response],
    onSessionChanged(_id, event) {
      if (event.reason === "assistant-stream" && event.payload.conversationStream.messages.some(message => message.text === "Service progress")) streamed.resolve();
    }
  });
  const { service, publications } = f;
  const actor = { id: "service-owner", username: "service-owner", role: "owner" };
  const options = { runtime: f.runtime, vibe64User: actor };
  assert.equal((await service.agentSessionState("session-1", options)).ok, true);
  assert.equal(f.processStarts.length, 0, "state inspection does not start a native server");
  const request = { message: "Work", messageId: "service-open-main" };
  const sent = await service.sendAgentMessage("session-1", request, options);
  assert.equal(sent.delivered, true, JSON.stringify(sent));
  await streamed.promise;
  assert.equal(f.processStarts.length, 1);
  assert.equal((await service.agentSessionState("session-1", options)).thread.id, sent.thread.id);
  assert.equal((await service.sendAgentMessage("session-1", request, options)).duplicate, true);
  assert.equal(f.promptCalls.length, 1, "an authored duplicate never starts another native prompt");
  assert.ok(publications.some(event => event.reason === "opencode-server-message-delivered"));
  const stopped = await service.interruptAgentTurn("session-1", options);
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  assert.equal((await service.agentSessionState("session-1", options)).turn.active, false);
  const rows = await f.store.readConversationLog("session-1");
  assert.deepEqual(rows.filter(turn => turn.user).map(turn => turn.user.messageId), [request.messageId]);
  assert.equal(rows[0].metadata.actorId, actor.username);
  assert.equal(rows.some(turn => turn.metadata.runtime), false);
  const metadata = (await f.store.readSession("session-1")).metadata;
  assert.equal(metadata.runtime, undefined);
  assert.equal(metadata.opencode_conversation_id, sent.thread.id);
  assert.equal(JSON.parse(metadata.assistant_changeover).engines.opencode.pending, undefined);
});


test("main OpenCode preserves immediate native duplicates and ownership conflicts over an existing monitor", { timeout: 10000 }, async t => {
  const f = await boundMainOpenCodeFixture(t, { assistantResponses: [{ pending: true, text: "Still working" }] });
  const request = { message: "Keep working", messageId: "already-native" };
  const original = await f.controller.sendMessage("session-1", request, f.context);
  assert.equal(original.delivered, true);
  const context = { ...f.context, turnOwnership: { threadId: original.thread.id, turnId: original.turn.id, reusable: false } };
  const promptly = async operation => {
    let timer;
    try { return await Promise.race([operation, new Promise((_, reject) => {
      timer = setTimeout(() => reject(new Error("Original immediate result waited for an unrelated native monitor.")), 750);
    })]); } finally { clearTimeout(timer); }
  };
  const conflict = await promptly(f.manager.sendMessage(context.sessionId, { message: "Another user's instruction", messageId: "wrong-owner" }, context));
  assert.equal(conflict.code, "vibe64_agent_turn_owner_conflict");
  assert.equal(conflict.delivered, false);
  const duplicate = await promptly(f.manager.sendMessage(f.context.sessionId, request, f.context));
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.delivered, true);
  assert.equal(f.promptCalls.length, 1);
  assert.equal((await f.controller.sessionState("session-1")).turn.active, true);
  assert.equal((await f.manager.interruptTurn(f.context.sessionId, {}, f.context)).turn.active, false);
});

test("main OpenCode closes its retained native owner when the session is unreadable or removed", { timeout: 15000 }, async t => {
  for (const unavailable of ["unreadable", "removed"]) {
    const f = await boundMainOpenCodeFixture(t, { assistantResponses: [{ pending: true, text: "Still working" }] });
    const handle = await f.open("native");
    const sent = await f.manager.sendMessage(f.context.sessionId, {
      message: "Keep working until closed", messageId: `close-${unavailable}`
    }, f.context);
    assert.equal(sent.delivered, true);
    f.runtime.getSession = async () => {
      if (unavailable === "unreadable") throw new Error("Session storage is unavailable.");
      return null;
    };
    const closed = await f.manager.closeSession(f.context.sessionId, { ...f.context, session: null });
    assert.equal(closed.ok, true, JSON.stringify(closed));
    assert.equal(closed.processExitProof.exited, true);
    assert.equal(f.processStops.length, 1, "the original native cleanup still stops its process");
    await assert.rejects(handle.read(), { code: "conversation_closed" });
    assert.equal((await f.manager.closeSession(f.context.sessionId, { ...f.context, session: null })).ok, true,
      "an absent common entry falls back to the original idempotent resource close");
  }
});

test("main OpenCode close retires delayed initialization without deleting a later binding", { timeout: 15000 }, async t => {
  for (const outcome of ["resolve", "reject"]) {
    const f = await boundMainOpenCodeFixture(t);
    const readSession = f.runtime.getSession;
    const waiting = Promise.withResolvers();
    const release = Promise.withResolvers();
    let reads = 0;
    f.runtime.getSession = (...args) => {
      // First read builds the real host binding; the second is the retained
      // entry's initialization read, before a provider has been opened.
      if (++reads === 2) {
        waiting.resolve();
        return release.promise;
      }
      return readSession(...args);
    };
    const opening = f.open("native");
    opening.catch(() => {});
    t.after(() => release.resolve(null));
    await waiting.promise;
    assert.equal((await f.manager.closeSession(f.context.sessionId, f.context)).ok, true,
      "resource cleanup does not await the blocked initialization read");
    const replacement = await f.open("native");
    if (outcome === "resolve") release.resolve(await readSession("session-1"));
    else release.reject(new Error("The retired initialization read failed."));
    await assert.rejects(opening, outcome === "resolve"
      ? { code: "conversation_closed" } : /retired initialization read failed/);
    f.runtime.getSession = async () => { throw new Error("Do not reopen the replacement to close it."); };
    assert.equal((await f.manager.closeSession(f.context.sessionId, f.context)).ok, true);
    await assert.rejects(replacement.read(), { code: "conversation_closed" },
      "the late retired initializer must not remove the replacement from the retained map");
    assert.equal(f.processStarts.length, 0, "passive binding and cleanup never start native work");
  }
});

test("Main OpenCode browser facade keeps original action authority and live native state", { timeout: 30000 }, async t => {
  const actions = createActionCatalogue();
  const access = { allowed: true, user: { ...os.userInfo(), role: "owner" } };
  const response = { pending: true, text: "Service progress" };
  const privatePublication = Promise.withResolvers();
  const deniedPublication = Promise.withResolvers();
  const f = await mainOpenCodeServiceFixture(t, {
    actions,
    assistantResponses: [response],
    onSessionChanged(_id, event) {
      if (event.reason === "assistant-stream" &&
          event.payload.conversationStream.messages.some(message => message.text === "Private progress")) {
        privatePublication.resolve();
      }
    }
  });
  registerVibe64ActionContext(actions, {
    projectContext: {
      projectsRoot: path.dirname(f.runtime.projectContextRoot),
      async readWorkspaceProject() {
        return { project: { projectRoot: f.runtime.projectContextRoot, projectRuntimeRoot: f.runtime.stateRoot } };
      }
    },
    resolveUser: async () => access.user,
    async authorizeProject({ slug }) {
      if (!access.allowed || slug !== "opencode-main-fixture") {
        deniedPublication.resolve();
        throw Object.assign(new Error("Project access denied."), { statusCode: 403 });
      }
    }
  });
  const sessions = createSessionService({ actions, project: f.projectService, terminals: f.service });
  actions.register({ contributorId: "test.main-opencode-sessions", domain: "vibe64-sessions",
    actions: createSessionActions({ sessions }).map(definition => ({
      channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition
    })) });
  const id = mainConversationId({ projectSlug: "opencode-main-fixture", sessionId: "session-1" });
  const context = { surface: "app", channel: "internal", requestMeta: { request: {
    headers: { host: "localhost", origin: "http://localhost", "x-jskit-surface": "app" }
  } } };
  const facade = await sessions.browserConversations.open({ id, context });
  const before = (await f.store.readSession("session-1")).metadata;
  const initial = await facade.read();
  assert.equal(initial.id, id);
  assert.equal(initial.engine, "opencode");
  assert.equal(initial.pagination.limit, 20);
  assert.deepEqual(initial.conversationLog, await f.store.readConversationLog("session-1"));
  assert.equal(initial.configuration, undefined);
  assert.equal(initial.capabilities.goals, false);
  assert.equal(initial.capabilities.goalCommands, undefined);
  assert.equal(f.processStarts.length, 0, "the browser read never prepares a native provider");
  assert.deepEqual((await f.store.readSession("session-1")).metadata, before);

  const events = [];
  const streamed = Promise.withResolvers();
  const release = await facade.subscribe(event => {
    events.push(event);
    if (event.type === "message" && event.text === "Service progress") streamed.resolve();
  });
  try {
    const input = { messageId: "main-opencode-browser-send", text: "Read the actual source" };
    const sent = await facade.send(input);
    assert.equal(sent.ok, true, JSON.stringify(sent));
    assert.equal(sent.delivered, true);
    await streamed.promise;
    assert.equal((await facade.read()).status, "working");
    assert.equal(f.processStarts.length, 1);
    assert.equal((await facade.send(input)).delivered, true);
    assert.equal(f.promptCalls.length, 1, "the original receipt prevents duplicate native dispatch");
    for (const field of ["session", "turnId", "threadId", "nativeIdentity", "nativeResult", "status", "workdir"]) {
      assert.equal(Object.hasOwn(sent, field), false, `Product acceptance must not expose ${field}`);
    }
    assert.ok(events.every(event => event.conversationId === id &&
      !Object.hasOwn(event, "session") && !Object.hasOwn(event, "nativeResult")));

    const eventCount = events.length;
    access.allowed = false;
    response.text = "Private progress";
    // Observe the original native publication and the original action owner's
    // denial before issuing another operation; a rejected read cannot satisfy
    // this per-event authorization proof.
    await Promise.all([privatePublication.promise, deniedPublication.promise]);
    assert.equal(events.length, eventCount, "revoked project access stops retained browser publications");
    await assert.rejects(facade.read(), { statusCode: 403 });
    await assert.rejects(facade.send({ messageId: "revoked", text: "Do not send" }), { statusCode: 403 });
    assert.equal(f.promptCalls.length, 1);
    access.allowed = true;
    const stopped = await facade.cancel();
    assert.equal(stopped.ok, true, JSON.stringify(stopped));
    assert.equal((await facade.read()).status, "ready");

    const rows = await f.store.readConversationLog("session-1");
    assert.deepEqual(rows.filter(turn => turn.user).map(turn => turn.user.messageId), [input.messageId]);
    assert.equal(rows[0].metadata.actorId, access.user.username);
    assert.equal(rows.some(turn => turn.metadata.runtime), false);
    const metadata = (await f.store.readSession("session-1")).metadata;
    assert.equal(metadata.runtime, undefined);
    assert.equal(metadata.opencode_conversation_id, f.promptCalls[0].id);
    assert.equal(JSON.parse(metadata.assistant_changeover).engines.opencode.pending, undefined);
  } finally {
    access.allowed = true;
    release();
  }
});

test("OpenCode renewal preserves ACK-write and stop failure ordering while retrying one native seed", { timeout: 15000 }, async (t) => {
  const handover = renewalHandover();
  const handoverHash = sessionRenewalHandoverHash(handover);
  const acknowledgement = JSON.stringify({
    handoverHash, message: "I am ready to continue from the approved handover.",
    schemaVersion: "vibe64.session-renewal-acknowledgement.v1",
    sourceCommit: renewalSource.commit, status: "ready"
  });
  const metadataReached = Promise.withResolvers();
  const releaseMetadata = Promise.withResolvers();
  const metadataFailure = new Error("The private successor metadata write failed.");
  let historyReads = 0;
  let allowStop = false;
  const stoppedMetadata = [];
  const harness = await controllerHarness({
    assistantResponses: [acknowledgement],
    beforeMessages() { historyReads += 1; },
    beforePrompt() {
      assert.equal(historyReads, 2, "Freshness and receipt history remain separate reads before dispatch");
    },
    stop() {
      stoppedMetadata.push({ ...harness.session.metadata });
      return { exited: allowStop, signal: "SIGTERM" };
    }
  });
  const writeMetadata = harness.runtime.store.writeMetadataValue;
  harness.runtime.store.writeMetadataValue = async (...args) => {
    if (args[1] === "agent_renewal_seed_operation_id") {
      metadataReached.resolve();
      await releaseMetadata.promise;
      throw metadataFailure;
    }
    return writeMetadata(...args);
  };
  t.after(async () => {
    releaseMetadata.resolve();
    allowStop = true;
    harness.runtime.store.writeMetadataValue = writeMetadata;
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const input = { handover, handoverHash, oldThreadId: "predecessor-thread",
    operationKey: "renewal:ordered-seed", source: renewalSource };
  const options = { runtime: harness.runtime, session: harness.session };
  const seeding = harness.controller.seedSessionRenewalHandover("session-1", input, options);
  const rejectedWrite = assert.rejects(seeding, error => error === metadataFailure);
  await metadataReached.promise;
  assert.equal(harness.promptCalls.length, 1);
  assert.equal(harness.processStops.length, 0, "Cleanup waits for the original metadata transaction");
  releaseMetadata.resolve();
  await rejectedWrite;
  assert.equal(harness.processStops.length, 0, "A rejected metadata write does not enter cleanup");

  harness.runtime.store.writeMetadataValue = writeMetadata;
  await assert.rejects(harness.controller.seedSessionRenewalHandover("session-1", input, options),
    { code: "vibe64_opencode_stop_unverified" });
  assert.equal(harness.promptCalls.length, 1, "Accepted history is reconciled after the write failure");
  assert.equal(stoppedMetadata.length, 1);
  assert.equal(stoppedMetadata[0].agent_renewal_seed_operation_id, input.operationKey);
  assert.equal(stoppedMetadata[0].agent_renewal_seed_handover_hash, handoverHash);
  assert.equal(stoppedMetadata[0].agent_briefing_delivered, "yes");
  assert.equal(stoppedMetadata[0].agent_briefing_delivered_at,
    stoppedMetadata[0].agent_renewal_seed_acknowledged_at);

  allowStop = true;
  const result = await harness.controller.seedSessionRenewalHandover("session-1", input, options);
  assert.equal(result.ok, true);
  assert.equal(result.reconciled, true);
  assert.equal(result.freshThread, false);
  assert.equal(result.subscriptionDeferred, true);
  assert.equal(result.acknowledgement.status, "ready");
  assert.equal(result.handoverHash, handoverHash);
  assert.equal(result.operationId, input.operationKey);
  assert.deepEqual(result.source, renewalSource);
  assert.deepEqual(result.processExitProof, { exited: true, signal: "SIGTERM" });
  assert.equal(result.threadId, harness.session.metadata.agent_renewal_seed_thread_id);
  assert.equal(result.turnId, harness.session.metadata.agent_renewal_seed_turn_id);
  assert.equal(result.acknowledgedAt, harness.session.metadata.agent_renewal_seed_acknowledged_at);
  assert.equal(harness.promptCalls.length, 1, "A failed native stop never resends the accepted seed");
  assert.equal(stoppedMetadata.length, 2);
  assert.equal(harness.userMessages.length, 0, "Hidden seeding creates no Main authored row");
});

test("OpenCode renewal rejects changed and unrelated native histories before dispatch", { timeout: 15000 }, async (t) => {
  const handover = renewalHandover();
  const handoverHash = sessionRenewalHandoverHash(handover);
  let historyReads = 0;
  const harness = await controllerHarness({
    assistantResponses: [handover], beforeMessages() { historyReads += 1; }
  });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const options = { runtime: harness.runtime, session: harness.session };
  const { thread: { id: threadId } } = await harness.controller.ensureSession("session-1", options);
  await assert.rejects(harness.controller.generateSessionRenewalHandover("session-1", {
    operationId: "renewal:changed-predecessor", expectedThreadId: "different-thread", source: null
  }, options), error => {
    assert.equal(error.code, "vibe64_session_renewal_thread_mismatch");
    assert.equal(error.statusCode, 409);
    assert.deepEqual(error.details, { actualThreadId: threadId, expectedThreadId: "different-thread" });
    return true;
  });
  const seed = { handover, handoverHash, operationId: "renewal:identity-seed", source: renewalSource };
  for (const identity of [{ expectedThreadId: "different-thread" }, { oldThreadId: threadId }]) {
    await assert.rejects(harness.controller.seedSessionRenewalHandover("session-1", { ...seed, ...identity }, options), error => {
      assert.equal(error.code, "vibe64_session_renewal_fresh_thread_required");
      assert.equal(error.statusCode, 409);
      assert.deepEqual(error.details, { actualThreadId: threadId,
        expectedThreadId: identity.expectedThreadId || "", forbiddenThreadId: identity.oldThreadId || "" });
      return true;
    });
  }
  assert.equal(historyReads, 0, "Identity rejection precedes native history and source prompt validation");
  assert.equal(harness.promptCalls.length, 0);

  const generated = await harness.controller.generateSessionRenewalHandover("session-1", {
    operationId: "renewal:exact-predecessor", expectedThreadId: threadId, source: renewalSource
  }, options);
  assert.equal(generated.threadId, threadId);
  assert.equal(generated.handover, handover);
  assert.equal(generated.handoverHash, handoverHash);
  assert.equal(harness.session.metadata.agent_renewal_handover_hash, handoverHash);
  assert.equal(harness.processStops.length, 0, "Generating the handover does not close its predecessor");
  const readsBeforeSeed = historyReads;
  await assert.rejects(harness.controller.seedSessionRenewalHandover("session-1", {
    ...seed, expectedThreadId: threadId, oldThreadId: "another-predecessor"
  }, options), error => {
    assert.equal(error.code, "vibe64_session_renewal_fresh_thread_required");
    assert.equal(error.statusCode, 409);
    assert.deepEqual(error.details, { threadId });
    assert.match(error.message, /contains unrelated conversation/);
    return true;
  });
  assert.equal(historyReads, readsBeforeSeed + 1);
  assert.equal(harness.promptCalls.length, 1, "Unrelated successor history is rejected before another dispatch");
});

test("OpenCode renewal leaves an accepted seed available when ACK validation fails", { timeout: 15000 }, async (t) => {
  const handover = renewalHandover();
  const harness = await controllerHarness({ assistantResponses: ["{}"] });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const input = { handover, handoverHash: sessionRenewalHandoverHash(handover),
    operationId: "renewal:invalid-ack", oldThreadId: "predecessor-thread", source: renewalSource };
  const options = { runtime: harness.runtime, session: harness.session };
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(harness.controller.seedSessionRenewalHandover("session-1", input, options), error => {
      assert.equal(error.code, "vibe64_session_renewal_acknowledgement_invalid");
      assert.equal(error.details.handoverPromptAccepted, true);
      assert.equal(error.details.threadId, harness.session.metadata.opencode_conversation_id);
      assert.ok(error.details.turnId);
      assert.ok(error.details.clientMessageId);
      return true;
    });
    assert.equal(harness.promptCalls.length, 1);
    assert.equal(harness.processStops.length, 0, "An invalid ACK does not enter native cleanup");
    assert.equal(harness.session.metadata.agent_renewal_seed_acknowledged_at, undefined);
  }
});

// R19 probes retain the original controller and its native protocol hooks.
// These assertions describe required observations; they do not approve the
// changed completion policy or substitute for real OpenCode inference.
test("R19 completed tool-call rows retain native ownership until the actual idle final answer", { timeout: 15000 }, async (t) => {
  const busyPolls = Promise.withResolvers();
  const response = { messages: [] };
  const created = Date.now();
  let phase = "tool";
  let statusReads = 0;
  let harness;
  harness = await controllerHarness({
    assistantResponses: [response],
    beforeMessages() {
      const nativeInputId = harness.promptCalls[0].input.id;
      response.messages = [
        { id: nativeInputId, type: "user", text: "Use the tool and answer.", time: { created } },
        phase === "tool"
          ? { id: "r19-tool-message", type: "assistant", finish: "tool-calls",
              content: [{ type: "tool", state: { status: "running" } }],
              time: { created: created + 1, completed: created + 2 } }
          : { id: "r19-final-message", type: "assistant", text: "The actual final answer.", finish: "stop",
              time: { created: created + 3, completed: created + 4 } }
      ];
    },
    sessionStatus: async () => {
      statusReads += 1;
      if (phase === "tool" && statusReads >= 3) busyPolls.resolve();
      return { type: phase === "tool" ? "busy" : "idle" };
    }
  });
  t.after(async () => {
    phase = "final";
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  await harness.controller.sendMessage("session-1", { message: "Use the tool and answer.", messageId: "r19-tool-input" });
  await busyPolls.promise;
  assert.ok(statusReads >= 3, "A completed tool message must survive more than the original two completion polls.");
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
  assert.equal(harness.promptCalls.length, 1, "A completed tool call must not trigger empty-answer recovery.");
  assert.equal(harness.checkpoints.length, 0, "Busy native work must not publish a completed source checkpoint.");
  assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
  phase = "final";
  const completed = await harness.controller.waitForTurn("session-1");
  assert.equal(completed.state, "completed");
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, false);
  assert.equal(harness.assistantMessages.at(-1).text, "The actual final answer.");
  assert.equal(harness.promptCalls.length, 1);
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-tool-input"]);
});

test("R19 steering during awaited projection or status cannot complete the predecessor input", { timeout: 15000 }, async (t) => {
  for (const boundary of ["projection", "status"]) {
    await t.test(boundary, async (t) => {
      const entered = Promise.withResolvers();
      const release = Promise.withResolvers();
      const latestRead = Promise.withResolvers();
      const response = { messages: [] };
      const created = Date.now();
      let historyReads = 0;
      let statusReads = 0;
      let finishLatest = false;
      let harness;
      harness = await controllerHarness({
        assistantResponses: [response, response],
        beforeMessages() {
          historyReads += 1;
          const first = harness.promptCalls[0].input.id;
          response.messages = [
            { id: first, type: "user", text: "First input", time: { created } },
            { id: "r19-predecessor-answer", type: "assistant", text: historyReads === 1 ? "First snapshot" : "Updated predecessor snapshot",
              finish: "stop", time: { created: created + 1, completed: created + 2 } }
          ];
          if (harness.promptCalls.length === 2) {
            response.messages.push(
              { id: harness.promptCalls[1].input.id, type: "user", text: "Latest input", time: { created: created + 3 } },
              { id: "r19-latest-answer", type: "assistant", text: finishLatest ? "The latest answer." : "Latest progress",
                time: { created: created + 4, ...(finishLatest ? { completed: created + 5 } : {}) } }
            );
            latestRead.resolve();
          }
        },
        sessionStatus: async () => {
          statusReads += 1;
          if (boundary === "status" && statusReads === 2) {
            entered.resolve();
            await release.promise;
          }
          return { type: "idle" };
        },
        async onSessionChanged(_id, event) {
          if (boundary === "projection" && event.reason === "assistant-stream" &&
              event.payload.conversationStream.messages.some(message => message.text === "Updated predecessor snapshot") &&
              harness.promptCalls.length === 1) {
            entered.resolve();
            await release.promise;
          }
        }
      });
      t.after(async () => {
        finishLatest = true;
        release.resolve();
        await harness.controller.closeAllForProject();
        await rm(harness.root, { force: true, recursive: true });
      });
      const first = await harness.controller.sendMessage("session-1", { message: "First input", messageId: `r19-${boundary}-first` });
      const completion = harness.controller.waitForTurn("session-1");
      await entered.promise;
      const statusReadsBeforeSteering = statusReads;
      const latest = await harness.controller.sendMessage("session-1", { message: "Latest input", messageId: `r19-${boundary}-latest` });
      assert.equal(latest.deliveryMode, "steer");
      assert.equal(latest.thread.id, first.thread.id);
      assert.notEqual(harness.promptCalls[0].input.id, harness.promptCalls[1].input.id);
      release.resolve();
      const observation = await Promise.race([
        latestRead.promise.then(() => "latest-history"),
        completion.then(() => "premature-completion")
      ]);
      assert.equal(observation, "latest-history", "The old snapshot must not retire the monitor after steering.");
      assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
      if (boundary === "projection") {
        assert.equal(statusReads, statusReadsBeforeSteering,
          "A changed input after projection must be re-read before checking the predecessor's native status.");
      }
      assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
      finishLatest = true;
      const completed = await completion;
      assert.equal(completed.state, "completed");
      assert.equal(harness.assistantMessages.at(-1).text, "The latest answer.");
      assert.deepEqual(harness.userMessages.map(message => message.messageId),
        [`r19-${boundary}-first`, `r19-${boundary}-latest`]);
      assert.equal(harness.promptCalls.length, 2, "Following the admitted input must not submit a recovery or duplicate prompt.");
    });
  }
});

test("R19 completed errors wait for idle and a failed status observation retains the original failure cleanup", { timeout: 15000 }, async (t) => {
  await t.test("completed error remains owned while busy and surfaces exactly when idle", async (t) => {
    const busyPolls = Promise.withResolvers();
    let busy = true;
    let statusReads = 0;
    const harness = await controllerHarness({
      assistantResponses: [{ error: { name: "UnknownError", data: { message: "The completed native answer failed." } } }],
      sessionStatus: async () => {
        statusReads += 1;
        if (busy && statusReads >= 3) busyPolls.resolve();
        return { type: busy ? "busy" : "idle" };
      }
    });
    t.after(async () => {
      busy = false;
      await harness.controller.closeAllForProject();
      await rm(harness.root, { force: true, recursive: true });
    });
    await harness.controller.sendMessage("session-1", { message: "Answer", messageId: "r19-completed-error" });
    await busyPolls.promise;
    assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
    assert.equal(harness.systemMessages.length, 0);
    assert.equal(harness.checkpoints.length, 0);
    assert.equal(harness.promptCalls.length, 1);
    busy = false;
    const completed = await harness.controller.waitForTurn("session-1");
    assert.equal(completed.state, "failed");
    assert.equal(completed.error, "The completed native answer failed.");
    assert.equal((await harness.controller.sessionState("session-1")).turn.active, false);
    assert.equal(harness.systemMessages.length, 1);
    assert.match(harness.systemMessages[0].text, /The completed native answer failed\./u);
    assert.equal(harness.promptCalls.length, 1, "A completed native error must not trigger empty-answer recovery.");
  });
  await t.test("failed success-path status read stops native work instead of declaring completion", async (t) => {
    const interrupted = [];
    let failStatus = true;
    const harness = await controllerHarness({
      assistantResponses: ["The observed answer.", "The next answer."],
      sessionStatus: async () => {
        if (failStatus) {
          failStatus = false;
          throw new Error("Controlled native status read failure.");
        }
        return { type: "idle" };
      },
      interrupt: async id => { interrupted.push(id); return true; }
    });
    t.after(async () => {
      failStatus = false;
      await harness.controller.closeAllForProject();
      await rm(harness.root, { force: true, recursive: true });
    });
    const delivered = await harness.controller.sendMessage("session-1", { message: "Answer", messageId: "r19-status-read-failure" });
    const failed = await harness.controller.waitForTurn("session-1");
    assert.equal(failed.state, "failed");
    assert.match(failed.error, /Controlled native status read failure\./u);
    assert.deepEqual(interrupted, [delivered.thread.id]);
    assert.equal((await harness.controller.sessionState("session-1")).turn.active, false);
    assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
    assert.equal(harness.processStops.length, 0, "Confirmed native abort must not kill the shared server.");
    assert.equal(harness.promptCalls.length, 1);
    assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-status-read-failure"]);
    await harness.controller.sendMessage("session-1", { message: "Next answer", messageId: "r19-after-status-failure" });
    assert.equal((await harness.controller.waitForTurn("session-1")).state, "completed");
    assert.equal(harness.assistantMessages.at(-1).text, "The next answer.");
    assert.equal(harness.promptCalls.length, 2);
  });
});

test("R19 native-admitted steering cannot retire its monitor while the authored-row commit is held", { timeout: 15000 }, async (t) => {
  const secondRead = Promise.withResolvers();
  const releaseRead = Promise.withResolvers();
  const commitEntered = Promise.withResolvers();
  const releaseCommit = Promise.withResolvers();
  const continuedRead = Promise.withResolvers();
  const response = { messages: [] };
  const created = Date.now();
  let historyReads = 0;
  let steering;
  let harness;
  harness = await controllerHarness({
    assistantResponses: [response, response],
    async beforeMessages() {
      historyReads += 1;
      if (historyReads === 2) {
        secondRead.resolve();
        await releaseRead.promise;
      }
      response.messages = [
        { id: harness.promptCalls[0].input.id, type: "user", text: "First input", time: { created } },
        { id: "r19-committed-predecessor", type: "assistant", text: "Predecessor answer.", finish: "stop",
          time: { created: created + 1, completed: created + 2 } }
      ];
      if (harness.promptCalls.length === 2) {
        response.messages.push(
          { id: harness.promptCalls[1].input.id, type: "user", text: "Admitted latest input", time: { created: created + 3 } },
          { id: "r19-admitted-successor", type: "assistant", text: "The admitted latest answer.", finish: "stop",
            time: { created: created + 4, completed: created + 5 } }
        );
      }
      if (historyReads >= 3) continuedRead.resolve();
    },
    sessionStatus: async () => ({ type: "idle" })
  });
  const writeUser = harness.runtime.store.writeConversationUserMessage;
  harness.runtime.store.writeConversationUserMessage = async (...args) => {
    if (args[1].messageId === "r19-held-commit-latest") {
      commitEntered.resolve();
      await releaseCommit.promise;
    }
    return writeUser(...args);
  };
  t.after(async () => {
    releaseRead.resolve();
    releaseCommit.resolve();
    await steering?.catch(() => {});
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const first = await harness.controller.sendMessage("session-1", { message: "First input", messageId: "r19-held-commit-first" });
  const completion = harness.controller.waitForTurn("session-1");
  await secondRead.promise;
  steering = harness.controller.sendMessage("session-1", { message: "Admitted latest input", messageId: "r19-held-commit-latest" });
  await commitEntered.promise;
  assert.equal(harness.promptCalls.length, 2);
  assert.equal(harness.promptCalls[1].input.delivery, "steer");
  assert.notEqual(harness.promptCalls[0].input.id, harness.promptCalls[1].input.id);
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-held-commit-first"]);
  releaseRead.resolve();
  const observation = await Promise.race([
    continuedRead.promise.then(() => "continued-observation"),
    completion.then(() => "premature-completion")
  ]);
  assert.equal(observation, "continued-observation",
    "Native-admitted steering must remain owned while its authored-row commit is held.");
  assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
  releaseCommit.resolve();
  const admitted = await steering;
  assert.equal(admitted.deliveryMode, "steer");
  assert.equal(admitted.thread.id, first.thread.id);
  assert.equal((await harness.controller.waitForTurn("session-1")).state, "completed");
  assert.equal(harness.assistantMessages.at(-1).text, "The admitted latest answer.");
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-held-commit-first", "r19-held-commit-latest"]);
  assert.equal(harness.promptCalls.length, 2);
});

test("R19 two completed native B polls still await its original authored-row commit", { timeout: 15000 }, async (t) => {
  const commitEntered = Promise.withResolvers();
  const releaseCommit = Promise.withResolvers();
  const twoCompletedPolls = Promise.withResolvers();
  const response = { messages: [] };
  const created = Date.now();
  let completedBPolls = 0;
  let completed = false;
  let steering;
  let harness;
  harness = await controllerHarness({
    assistantResponses: [response, response],
    beforeMessages() {
      const firstId = harness.promptCalls[0].input.id;
      response.messages = [
        { id: firstId, type: "user", text: "A", time: { created } },
        { id: "r19-two-polls-a", type: "assistant", text: "A progress", time: { created: created + 1 } }
      ];
      if (harness.promptCalls.length === 2) {
        response.messages.push(
          { id: harness.promptCalls[1].input.id, type: "user", text: "B", time: { created: created + 2 } },
          { id: "r19-two-polls-b", type: "assistant", text: "B finished.", finish: "stop",
            time: { created: created + 3, completed: created + 4 } }
        );
      }
    },
    sessionStatus: async () => {
      if (harness.promptCalls.length === 2) {
        completedBPolls += 1;
        if (completedBPolls === 2) twoCompletedPolls.resolve();
      }
      return { type: "idle" };
    }
  });
  const writeUser = harness.runtime.store.writeConversationUserMessage;
  harness.runtime.store.writeConversationUserMessage = async (...args) => {
    if (args[1].messageId === "r19-two-polls-latest") {
      commitEntered.resolve();
      await releaseCommit.promise;
    }
    return writeUser(...args);
  };
  t.after(async () => {
    releaseCommit.resolve();
    await steering?.catch(() => {});
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: "r19-two-polls-first" });
  const completion = harness.controller.waitForTurn("session-1");
  void completion.then(() => { completed = true; }, () => { completed = true; });
  steering = harness.controller.sendMessage("session-1", { message: "B", messageId: "r19-two-polls-latest" });
  await commitEntered.promise;
  await twoCompletedPolls.promise;
  for (let index = 0; index < 3; index += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(completedBPolls, 2, "The original waiter reached its two completed/idle observations.");
  assert.equal(completed, false, "A terminal native result must still await the authored-row commit.");
  assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
  assert.equal(harness.checkpoints.length, 0);
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-two-polls-first"]);
  releaseCommit.resolve();
  const latest = await steering;
  assert.equal(latest.deliveryMode, "steer");
  assert.equal(latest.thread.id, first.thread.id);
  assert.equal((await completion).state, "completed");
  assert.equal(harness.assistantMessages.at(-1).text, "B finished.");
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-two-polls-first", "r19-two-polls-latest"]);
  assert.equal(harness.promptCalls.length, 2);
});

test("R19 rejected Main B restores A observation without stopping or replaying", { timeout: 15000 }, async (t) => {
  const response = { messages: [] };
  const interrupted = [];
  const created = Date.now();
  let finishA = false;
  let rejectedCallbacks = 0;
  let harness;
  harness = await controllerHarness({
    assistantResponses: [response],
    beforeMessages() {
      response.messages = [
        { id: harness.promptCalls[0].input.id, type: "user", text: "A", time: { created } },
        { id: "r19-rejected-a", type: "assistant", text: finishA ? "A finished." : "A progress",
          time: { created: created + 1, ...(finishA ? { completed: created + 2 } : {}) } }
      ];
    },
    interrupt: async id => { interrupted.push(id); return true; }
  });
  t.after(async () => {
    finishA = true;
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: "r19-rejected-first" });
  const completion = harness.controller.waitForTurn("session-1");
  const owner = harness.controller.prepareConversationHost("session-1", {}, "activity").native.owner;
  const tracked = [...owner.turns.values()].find(turn => turn.threadId === first.thread.id);
  const previousAdmission = tracked.admission;
  harness.failPrompt(Object.assign(new Error("Controlled B rejection"), {
    code: "assistant_opencode_server_request_failed", statusCode: 400
  }));
  const rejected = await harness.controller.sendMessage("session-1", {
    message: "B", messageId: "r19-rejected-latest", onPromptRejected() { rejectedCallbacks += 1; }
  });
  assert.equal(rejected.delivered, false);
  assert.equal(rejected.code, "vibe64_opencode_server_request_failed");
  assert.equal(rejectedCallbacks, 1);
  assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
  assert.equal(tracked.inputMessageId, harness.promptCalls[0].input.id);
  assert.equal(tracked.admission, previousAdmission, "Rejection restores the same previous gate, not a resolved substitute.");
  assert.deepEqual(interrupted, []);
  assert.equal(harness.checkpoints.length, 0);
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-rejected-first"]);
  finishA = true;
  assert.equal((await completion).state, "completed");
  assert.equal(harness.assistantMessages.at(-1).text, "A finished.");
  assert.equal(harness.promptCalls.length, 2);
});

for (const stopConfirmed of [true, false]) {
  test(`R19 unknown Main B retains its exact input and original Stop recovery: ${stopConfirmed ? "confirmed" : "unconfirmed"}`, { timeout: 15000 }, async (t) => {
    const response = { messages: [] };
    const interrupted = [];
    const created = Date.now();
    let processExited = stopConfirmed;
    let nativeB = false;
    let harness;
    harness = await controllerHarness({
      assistantResponses: [response],
      beforeMessages() {
        response.messages = [
          { id: harness.promptCalls[0].input.id, type: "user", text: "A", time: { created } },
          { id: "r19-unknown-a", type: "assistant", text: "A progress", time: { created: created + 1 } }
        ];
        if (nativeB) response.messages.push(
          { id: harness.promptCalls[1].input.id, type: "user", text: "B", time: { created: created + 2 } },
          { id: "r19-unknown-b", type: "assistant", text: "Native B was admitted.", finish: "stop",
            time: { created: created + 3, completed: created + 4 } }
        );
      },
      beforePrompt() {
        if (harness.promptCalls.length === 2) {
          nativeB = true;
          throw Object.assign(new Error("Controlled lost B acknowledgement"), {
            code: "assistant_opencode_server_request_failed", statusCode: 408
          });
        }
      },
      interrupt: async id => { interrupted.push(id); return stopConfirmed; },
      stop: async () => ({ exited: processExited })
    });
    t.after(async () => {
      processExited = true;
      await harness.controller.closeAllForProject();
      await rm(harness.root, { recursive: true, force: true });
    });
    const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: "r19-unknown-first" });
    const result = await harness.controller.sendMessage("session-1", { message: "B", messageId: "r19-unknown-latest" });
    assert.equal(result.delivered, false);
    assert.equal(result.code, "vibe64_opencode_server_request_failed");
    const owner = harness.controller.prepareConversationHost("session-1", {}, "activity").native.owner;
    const tracked = [...owner.turns.values()].find(turn => turn.threadId === first.thread.id);
    assert.equal(tracked.inputMessageId, harness.promptCalls[1].input.id, "Unknown ACK must not restore A as if B were rejected.");
    assert.deepEqual(interrupted, [first.thread.id]);
    assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-unknown-first"]);
    assert.equal(harness.promptCalls.length, 2);
    assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
    const state = await harness.controller.sessionState("session-1");
    assert.equal(state.turn.active, !stopConfirmed);
    assert.equal(state.turn.status, "observation_lost");
    if (stopConfirmed) {
      assert.equal(harness.processStops.length, 0, "Confirmed native Stop retains the shared server.");
      const admission = await harness.controller.inspectMessageAdmission("session-1", {
        messageId: "r19-unknown-latest", threadId: first.thread.id
      });
      assert.equal(admission.admission, "accepted");
      assert.equal(admission.turnId, harness.promptCalls[1].input.id);
    } else {
      assert.equal(harness.processStops.length, 1);
      await assert.rejects(harness.controller.sendMessage("session-1", {
        message: "Must not overlap", messageId: "r19-unknown-next"
      }), /could not be verified/);
      assert.equal(harness.promptCalls.length, 2, "An unconfirmed Stop must not dispatch another prompt.");
      assert.equal((await harness.controller.sessionState("session-1")).turn.active, true);
    }
  });
}

test("R19 admitted Main B commit failure keeps native identity and never replays", { timeout: 15000 }, async (t) => {
  const response = { messages: [] };
  const interrupted = [];
  const persistenceFailure = new Error("Controlled admitted B commit failure");
  const created = Date.now();
  let harness;
  harness = await controllerHarness({
    assistantResponses: [response, response],
    beforeMessages() {
      response.messages = [
        { id: harness.promptCalls[0].input.id, type: "user", text: "A", time: { created } },
        { id: "r19-failed-commit-a", type: "assistant", text: "A progress", time: { created: created + 1 } }
      ];
      if (harness.promptCalls.length === 2) response.messages.push(
        { id: harness.promptCalls[1].input.id, type: "user", text: "B", time: { created: created + 2 } },
        { id: "r19-failed-commit-b", type: "assistant", text: "Native B finished.", finish: "stop",
          time: { created: created + 3, completed: created + 4 } }
      );
    },
    interrupt: async id => { interrupted.push(id); return true; }
  });
  const writeUser = harness.runtime.store.writeConversationUserMessage;
  harness.runtime.store.writeConversationUserMessage = async (...args) => {
    if (args[1].messageId === "r19-failed-commit-latest") throw persistenceFailure;
    return writeUser(...args);
  };
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: "r19-failed-commit-first" });
  await assert.rejects(harness.controller.sendMessage("session-1", {
    message: "B", messageId: "r19-failed-commit-latest"
  }), error => error === persistenceFailure);
  const owner = harness.controller.prepareConversationHost("session-1", {}, "activity").native.owner;
  const tracked = [...owner.turns.values()].find(turn => turn.threadId === first.thread.id);
  assert.equal(tracked.inputMessageId, harness.promptCalls[1].input.id);
  assert.deepEqual(interrupted, [first.thread.id]);
  assert.equal((await harness.controller.waitForTurn("session-1")).state, "failed");
  assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-failed-commit-first"]);
  const admission = await harness.controller.inspectMessageAdmission("session-1", {
    messageId: "r19-failed-commit-latest", threadId: first.thread.id
  });
  assert.equal(admission.admission, "accepted");
  assert.equal(admission.turnId, harness.promptCalls[1].input.id);
  assert.equal(harness.promptCalls.length, 2);
  assert.equal(harness.processStops.length, 0);
});

test("R19 Main B fences an awaited final A projection before checkpoint", { timeout: 15000 }, async (t) => {
  const projectionEntered = Promise.withResolvers();
  const releaseProjection = Promise.withResolvers();
  let steering;
  const harness = await controllerHarness({ assistantResponses: ["A finished.", "B finished."] });
  const writeAssistant = harness.runtime.store.writeConversationAssistantMessage;
  harness.runtime.store.writeConversationAssistantMessage = async (...args) => {
    if (args[1].text === "A finished.") {
      projectionEntered.resolve();
      await releaseProjection.promise;
    }
    return writeAssistant(...args);
  };
  t.after(async () => {
    releaseProjection.resolve();
    await steering?.catch(() => {});
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: "r19-final-projection-first" });
  const completion = harness.controller.waitForTurn("session-1");
  await projectionEntered.promise;
  steering = harness.controller.sendMessage("session-1", { message: "B", messageId: "r19-final-projection-latest" });
  const latest = await steering;
  assert.equal(latest.deliveryMode, "steer");
  assert.equal(latest.thread.id, first.thread.id);
  assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
  assert.equal(harness.checkpoints.length, 0);
  releaseProjection.resolve();
  assert.equal((await completion).state, "completed");
  assert.equal(harness.assistantMessages.at(-1).text, "B finished.");
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-final-projection-first", "r19-final-projection-latest"]);
  assert.equal(harness.promptCalls.length, 2);
  assert.equal(harness.checkpoints.length, 1);
});

test("R19 Main B joins claimed A terminal cleanup before its own original monitor", { timeout: 15000 }, async (t) => {
  const checkpointEntered = Promise.withResolvers();
  const releaseCheckpoint = Promise.withResolvers();
  const requestEntered = Promise.withResolvers();
  let holdCheckpoint = true;
  let startingB = false;
  let next;
  const harness = await controllerHarness({ assistantResponses: ["A finished.", "B finished."] });
  const writeCheckpoint = harness.runtime.store.writeBackgroundTaskEvent;
  harness.runtime.store.writeBackgroundTaskEvent = async (...args) => {
    if (holdCheckpoint) {
      checkpointEntered.resolve();
      await releaseCheckpoint.promise;
    }
    return writeCheckpoint(...args);
  };
  const messageExists = harness.runtime.store.conversationMessageIdExists;
  harness.runtime.store.conversationMessageIdExists = async (...args) => {
    if (startingB) requestEntered.resolve();
    return messageExists(...args);
  };
  t.after(async () => {
    holdCheckpoint = false;
    releaseCheckpoint.resolve();
    await next?.catch(() => {});
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: "r19-cleanup-first" });
  const firstCompletion = harness.controller.waitForTurn("session-1");
  await checkpointEntered.promise;
  const owner = harness.controller.prepareConversationHost("session-1", {}, "activity").native.owner;
  const tracked = [...owner.turns.values()].find(turn => turn.threadId === first.thread.id);
  assert.equal(tracked.active, false, "Terminal ownership must be claimed before awaited checkpoint cleanup.");
  startingB = true;
  next = harness.controller.sendMessage("session-1", { message: "B", messageId: "r19-cleanup-latest" });
  await requestEntered.promise;
  for (let index = 0; index < 3; index += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(harness.promptCalls.length, 1, "B must not attach to a retiring observer during its cleanup.");
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-cleanup-first"]);
  holdCheckpoint = false;
  releaseCheckpoint.resolve();
  assert.equal((await firstCompletion).state, "completed");
  const latest = await next;
  assert.equal(latest.deliveryMode, "new_turn");
  assert.equal(latest.thread.id, first.thread.id);
  assert.equal((await harness.controller.waitForTurn("session-1")).state, "completed");
  assert.equal(harness.assistantMessages.at(-1).text, "B finished.");
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r19-cleanup-first", "r19-cleanup-latest"]);
  assert.equal(harness.promptCalls.length, 2);
  assert.equal(harness.checkpoints.length, 2);
});

test("R20 reasoning-only recovery retains the exact native ID and selected settings for one attempt", { timeout: 15000 }, async (t) => {
  const { upstreamMessageId } = await import("../../packages/vibe64-terminals/src/server/openCodeConversationStorage.js");
  const harness = await controllerHarness({ assistantResponses: [
    { text: "", content: [{ id: "r20-reasoning", type: "reasoning", text: "The saved result is 42." }] },
    { text: "", content: [{ id: "r20-recovery-reasoning", type: "reasoning", text: "The result is still 42." }] }
  ] });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  const submitted = await harness.controller.sendMessage("session-1", {
    messageId: "r20-exact-recovery", message: "Tell me the saved result."
  });
  const result = await harness.controller.waitForTurn("session-1");
  const prompts = harness.promptCalls.filter(entry => entry.input.agent !== "vibe64-helper");
  assert.equal(prompts.length, 2, "The original empty-answer policy admits at most one recovery prompt.");
  assert.equal(prompts[0].input.id, upstreamMessageId("r20-exact-recovery"));
  assert.equal(prompts[1].id, submitted.thread.id);
  assert.equal(prompts[1].input.id, upstreamMessageId(`${submitted.turn.id}:final-response`));
  assert.equal(prompts[1].input.agent, harness.selection.agentId);
  assert.deepEqual(prompts[1].input.model, {
    id: harness.selection.modelId, providerID: harness.selection.modelProviderId, variant: harness.selection.variantId
  });
  assert.equal(prompts[1].input.delivery, "queue");
  assert.equal(prompts[1].input.resume, true);
  assert.equal(prompts[1].input.prompt.text,
    "Your previous response ended without a user-facing final answer. Do not call tools or repeat your reasoning. Return the concise final answer to the user's latest request now.");
  assert.equal(result.state, "failed");
  assert.equal(result.error, "OpenCode finished without a user-facing final response. Please send your message again.");
  assert.deepEqual(harness.userMessages.map(message => message.messageId), ["r20-exact-recovery"]);
  assert.deepEqual(harness.assistantMessages, []);
});

test("R20 confirmed Stop at the completed-empty recovery projection never submits another prompt", { timeout: 15000 }, async (t) => {
  const projectionEntered = Promise.withResolvers();
  const releaseProjection = Promise.withResolvers();
  const nativeIdle = Promise.withResolvers();
  let idlePolls = 0;
  let stopping;
  let harness;
  harness = await controllerHarness({
    assistantResponses: [{ text: "", content: [{
      id: "r20-stopped-reasoning", type: "reasoning", text: "The command finished with a saved result."
    }] }],
    async sessionStatus() {
      if (harness.promptCalls.length && ++idlePolls >= 2) nativeIdle.resolve();
      return { type: "idle" };
    }
  });
  const writeThinking = harness.runtime.store.writeConversationThinkingMessage;
  harness.runtime.store.writeConversationThinkingMessage = async (...args) => {
    projectionEntered.resolve();
    await releaseProjection.promise;
    return writeThinking(...args);
  };
  t.after(async () => {
    releaseProjection.resolve();
    await stopping?.catch(() => {});
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  const submitted = await harness.controller.sendMessage("session-1", {
    messageId: "r20-stop-empty", message: "Finish this command."
  });
  const completion = harness.controller.waitForTurn("session-1");
  await projectionEntered.promise;
  await nativeIdle.promise;
  const owner = harness.controller.prepareConversationHost("session-1", {}, "activity").native.owner;
  const tracked = [...owner.turns.values()].find(turn => turn.threadId === submitted.thread.id);
  stopping = harness.controller.interruptTurn("session-1");
  for (let index = 0; index < 3; index += 1) await new Promise(resolve => setImmediate(resolve));
  assert.equal(tracked.interruptAcknowledged, true, "Native Stop is confirmed before the held projection finishes.");
  assert.equal(harness.promptCalls.length, 1);
  releaseProjection.resolve();
  const stopped = await stopping;
  assert.equal(stopped.ok, true);
  assert.equal(stopped.turn.state, "interrupted");
  assert.equal((await completion).state, "interrupted");
  assert.equal(harness.promptCalls.length, 1, "Confirmed interruption must not become an empty-answer recovery.");
  assert.deepEqual(harness.assistantMessages, []);
  assert.deepEqual(harness.systemMessages, []);
  assert.equal(harness.processStops.length, 0, "Independent Stop leaves the original shared service warm.");
});

test("R20 accepted completed-empty renewal seed retries preserve native history without resending or cleanup", { timeout: 15000 }, async (t) => {
  const harness = await controllerHarness({ assistantResponses: [{ text: "" }] });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  const handover = renewalHandover();
  const input = { handover, handoverHash: sessionRenewalHandoverHash(handover),
    operationId: "renewal:r20-completed-empty", oldThreadId: "r20-predecessor", source: renewalSource };
  const options = { runtime: harness.runtime, session: harness.session };
  let retainedThreadId;
  let retainedClientMessageId;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    await assert.rejects(harness.controller.seedSessionRenewalHandover("session-1", input, options), error => {
      assert.equal(error.code, "vibe64_session_renewal_turn_unreadable");
      assert.equal(error.details.handoverPromptAccepted, true);
      assert.equal(error.details.threadId, harness.session.metadata.opencode_conversation_id);
      assert.notEqual(error.details.threadId, input.oldThreadId);
      retainedThreadId ||= error.details.threadId;
      retainedClientMessageId ||= error.details.clientMessageId;
      assert.equal(error.details.threadId, retainedThreadId);
      assert.equal(error.details.clientMessageId, retainedClientMessageId);
      assert.ok(retainedClientMessageId);
      return true;
    });
    assert.equal(harness.promptCalls.length, 1, "An accepted empty result is checked by its exact history, never submitted twice.");
    assert.equal(harness.processStops.length, 0, "Unreadable acceptance cannot acknowledge or release the seed.");
    assert.equal(harness.session.metadata.agent_renewal_seed_acknowledged_at, undefined);
    assert.equal(harness.session.metadata.agent_renewal_seed_operation_id, undefined);
    assert.equal(harness.session.metadata.agent_briefing_delivered, undefined);
    assert.deepEqual(harness.userMessages, []);
    assert.deepEqual(harness.assistantMessages, []);
  }
  assert.equal(harness.createdSessions.length, 1, "Retry retains the original native successor rather than creating another.");
});

test("actual Learning OpenCode Main publishes one catalogue and promotes its admitted question at the native final checkpoint", { timeout: 30_000 }, async t => {
  const { trainingTeachingFixture } = await import("../fixtures/trainingTeachingFixture.js");
  const { Vibe64SessionRuntime } = await import("@local/vibe64-runtime/server");
  const { createTrainingMainTeaching } = await import("../../packages/vibe64-training/src/server/mainTeaching.js");
  const { createTrainingAnswerAssessment } = await import("../../packages/vibe64-training/src/server/answerAssessment.js");
  const { createTrainingLearningSessions } = await import("../../packages/vibe64-training/src/server/learningSessions.js");
  const { createTrainingTeachingBrief } = await import("../../packages/vibe64-training/src/server/teachingBrief.js");
  const { createTrainingActions } = await import("../../packages/vibe64-training/src/server/actions.js");
  const { createTrainingTeachingActions } = await import("../../packages/vibe64-training/src/server/teachingActions.js");
  const { createTrainingAssessmentActions } = await import("../../packages/vibe64-training/src/server/assessmentActions.js");
  const { createTrainingPresentationActions } = await import("../../packages/vibe64-training/src/server/presentationActions.js");
  const { createTrainingPracticalActions } = await import("../../packages/vibe64-training/src/server/practicalActions.js");
  const { createLearningTeachingContextActions } = await import("../../packages/vibe64-sessions/src/server/actions.js");
  const { createOpenCodeConversationPlugin, openCodeApplicationToolSchemas } = await import("@jskit-ai/assistant-core/server/opencode-process");
  let removeTeaching;
  const teaching = await trainingTeachingFixture({ after(callback) { removeTeaching = callback; } },
    { ready: false, exercise: false });
  teaching.actor.role = "owner";
  const main = createTrainingMainTeaching({ teaching: teaching.owner,
    assessment: createTrainingAnswerAssessment({ learners: teaching.learners, content: teaching.content, teaching: teaching.owner }) });
  const saved = await teaching.learners.readLearningSessionScope({ actor: teaching.actor, attemptId: teaching.attemptId });
  const actions = createActionCatalogue();
  let runtime;
  const brief = createTrainingTeachingBrief({ learners: teaching.learners, content: teaching.content });
  const learning = createTrainingLearningSessions({ learners: teaching.learners, teachingBrief: brief, learningTeaching: main,
    project: { createRuntime: async () => runtime }, sessions: { createSession() {}, inspectSession() {} } });
  const scope = await learning.resolveContext({ actor: teaching.actor, attemptId: teaching.attemptId });
  const nativeRows = [];
  const response = { messages: nativeRows, pending: true };
  let busy = true;
  const f = await mainOpenCodeServiceFixture(t, { actions, assistantResponses: [response, response],
    sessionStatus: async () => ({ type: busy ? "busy" : "idle" }),
    beforePrompt({ input }) {
      nativeRows.push({ id: input.id, type: "user", text: input.prompt.text, time: { created: Date.now() } });
    },
    async runtimeFactory({ harness }) {
      harness.session.sessionId = `learning-${teaching.attemptId}`;
      runtime = new Vibe64SessionRuntime({ projectContextRoot: harness.root, projectRuntimeRoot: saved.projectRuntimeRoot,
        learningScope: scope.learningScope, learningInstructions: scope.learningInstructions, learningTeaching: scope.learningTeaching,
        promptRenderer: () => assert.fail("A genuine no-exercise Main must not render a source prompt") });
      await runtime.createSession({ sessionId: harness.session.sessionId,
        metadata: { assistant_selection: harness.session.metadata.assistant_selection } });
      return runtime;
    }
  });
  // Drain the original native owner before removing its learner-owned storage.
  t.after(() => removeTeaching());
  let allowed = true;
  const sessions = createSessionService({ actions, project: f.projectService, terminals: f.service });
  const definitions = [...createSessionActions({ sessions }), ...createLearningTeachingContextActions(),
    ...createTrainingActions({ catalogue: { readCatalogue() {} }, learners: teaching.learners, teachingBrief: brief }),
    ...createTrainingTeachingActions({ mainTeaching: main }),
    ...createTrainingPresentationActions({ learners: teaching.learners, content: teaching.content, mainTeaching: main }),
    ...createTrainingAssessmentActions({ mainTeaching: main }),
    ...createTrainingPracticalActions()];
  actions.register({ contributorId: "actual-learning-opencode-main", domain: "training",
    actions: definitions.map(action => ({ ...action, channels: action.channels || ["api", "automation", "internal"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => {
    if (!allowed) throw Object.assign(new Error("Learning actor access revoked"), { statusCode: 403 });
    return teaching.actor;
  }, authorizeProject: () => assert.fail("Source-less teaching must not borrow a project ACL"),
  resolveLearningContext: input => learning.resolveContext(input) });
  const sessionId = f.context.sessionId;
  const context = { surface: "app", channel: "internal", requestMeta: { request: {
    params: { learningAttemptId: teaching.attemptId }, vibe64User: teaching.actor } } };
  const ready = await f.service.ensureAgentSession(sessionId, { runtime, vibe64User: teaching.actor });
  assert.equal(ready.ok, true, JSON.stringify(ready));
  assert.equal(f.processStarts.length, 1);
  assert.equal(f.promptCalls.length, 0, "readiness does not start inference");
  const registryPath = f.processStarts[0].options.sessionEnvironmentRegistry;
  const readRegistry = async () => JSON.parse(await readFile(registryPath, "utf8"));
  const nativeThreadId = ready.thread.id;
  let registry = await readRegistry();
  const initialManifest = registry.sessions.find(row => row.upstreamSessionId === nativeThreadId).conversation;
  assert.deepEqual(initialManifest.tools.schemas, openCodeApplicationToolSchemas);
  assert.equal(initialManifest.tools.url, undefined, "schema readiness alone supplies no effect transport");
  assert.equal(initialManifest.nativeTools, false);
  assert.equal(f.createdSessionInputs[0].agent, "jskit-assistant-actions");
  assert.equal(f.createdSessionInputs[0].model.id, f.selection.modelId);
  const repeated = await f.service.ensureAgentSession(sessionId, { runtime, vibe64User: teaching.actor });
  assert.equal(repeated.thread.id, nativeThreadId);
  assert.equal(f.createdSessions.length, 1);
  assert.deepEqual(f.switchedAgents, [], "unchanged readiness preserves the original same-session fast path");

  const messageId = "actual-opencode-teaching-request";
  const sent = await actions.execute({ actionId: "vibe64.sessions.agent-message.send", input: {
    learningAttemptId: teaching.attemptId, sessionId, messageId, message: "Teach this exact saved lesson.", submissionKind: "send" }, context });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(f.promptCalls.length, 1);
  assert.equal(f.promptCalls[0].id, nativeThreadId);
  assert.equal(f.promptCalls[0].input.agent, "jskit-assistant-actions");
  assert.equal(f.createdSessions.length, 1, "Send retains the prepared native identity");
  registry = await readRegistry();
  const connection = registry.sessions.find(row => row.upstreamSessionId === nativeThreadId).conversation.tools;
  assert.deepEqual(connection.schemas, initialManifest.tools.schemas);
  assert.match(connection.url, /^http:\/\/127\.0\.0\.1:\d+\/call$/u);
  const previousSchemas = process.env.JSKIT_OPENCODE_TOOL_SCHEMAS;
  process.env.JSKIT_OPENCODE_TOOL_SCHEMAS = JSON.stringify(connection.schemas);
  t.after(() => {
    if (previousSchemas === undefined) delete process.env.JSKIT_OPENCODE_TOOL_SCHEMAS;
    else process.env.JSKIT_OPENCODE_TOOL_SCHEMAS = previousSchemas;
  });
  const plugin = await createOpenCodeConversationPlugin({ registryPath });
  async function call(id, name, input) {
    const row = { id: `assistant-${id}`, type: "assistant", time: { created: Date.now() }, finish: "tool-calls",
      content: [{ type: "tool", callID: id, tool: name, state: { status: "running", input } }] };
    nativeRows.push(row);
    await plugin["tool.execute.before"]({ tool: name, sessionID: nativeThreadId });
    const result = JSON.parse(await plugin.tool[name].execute(input, { sessionID: nativeThreadId,
      messageID: row.id, callID: id, abort: new AbortController().signal }));
    row.content[0].state = { ...row.content[0].state, status: "completed", output: JSON.stringify(result) };
    return result;
  }
  const search = await call("learning-search", "assistant_action_search", { limit: main.actionIds.length });
  assert.equal(search.ok, true, JSON.stringify(search));
  assert.deepEqual(search.result.items.map(value => value.actionId).sort(), [...main.actionIds].sort());
  const contract = await call("learning-question-contract", "assistant_action_contract", { actionId: "vibe64.training.question.prepare" });
  assert.equal(contract.ok, true, JSON.stringify(contract));
  const prepared = await call("learning-question", "assistant_action_execute", { actionId: "vibe64.training.question.prepare", input: {
    attemptId: teaching.attemptId, expectedRevision: 1, requestId: "actual-opencode-first-question",
    assessmentId: "explain", text: teaching.input.text, assistance: "none" } });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  let log = await f.store.readConversationLog(sessionId);
  const canonical = log.find(turn => turn.messages.some(message => message.messageId === messageId));
  assert.equal(canonical.metadata.trainingQuestionDelivery.phase, "prepared");
  assert.equal(canonical.metadata.trainingQuestionDelivery.nativeThreadId, nativeThreadId);
  const nativeTurnId = f.promptCalls[0].input.id;
  assert.equal(canonical.metadata.trainingQuestionDelivery.nativeTurnId, nativeTurnId);
  assert.equal(canonical.metadata.applicationTools.find(value => value.id === "learning-question").status, "complete");
  assert.equal(canonical.messages.find(message => message.messageId === messageId).text, "Teach this exact saved lesson.");
  nativeRows.push({ id: "actual-final-question", type: "assistant", text: teaching.input.text,
    finish: "stop", time: { created: Date.now(), completed: Date.now() } });
  busy = false;
  async function waitForDelivery() {
    for (let index = 0; index < 500; index++) {
      const rows = await f.store.readConversationLog(sessionId);
      const delivered = rows.find(turn => turn.metadata.trainingQuestionDelivery?.phase === "delivered");
      if (delivered) return delivered;
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.fail("The original native final checkpoint did not promote its exact delivered question");
  }
  const delivered = await waitForDelivery();
  assert.equal(delivered.metadata.trainingQuestionDelivery.nativeTurnId, nativeTurnId);
  assert.equal(delivered.messages.findLast(message => message.role === "assistant").text, teaching.input.text);
  assert.equal(delivered.messages.findLast(message => message.role === "assistant").outputId,
    delivered.messages.findLast(message => message.role === "assistant").messageId);
  assert.equal(delivered.metadata.trainingQuestionDelivery.outputId,
    delivered.messages.findLast(message => message.role === "assistant").outputId);
  assert.equal((await teaching.read()).completion.passed, 0);
  assert.equal(f.checkpoints.length, 0, "a source-less native completion has no Git checkpoint");
  const userWords = "I try it in Preview.\nKeep these exact words.";
  busy = true;
  const answer = await actions.execute({ actionId: "vibe64.sessions.agent-message.send", input: {
    learningAttemptId: teaching.attemptId, sessionId, messageId: "actual-opencode-answer", message: userWords,
    trainingQuestion: delivered.metadata.trainingQuestionDelivery.reference, submissionKind: "send" }, context });
  assert.equal(answer.ok, true, JSON.stringify(answer));
  log = await f.store.readConversationLog(sessionId);
  const accepted = log.flatMap(turn => turn.messages).find(message => message.messageId === "actual-opencode-answer");
  assert.equal(accepted.text, userWords);
  assert.equal(accepted.data.trainingQuestion.attemptId, teaching.attemptId);
  assert.equal(accepted.data.trainingQuestion.question.id, delivered.metadata.trainingQuestionDelivery.reference.questionId);
  assert.equal(accepted.data.trainingQuestion.question.assessmentId, delivered.metadata.trainingQuestionDelivery.reference.assessmentId);
  assert.equal(accepted.data.trainingQuestion.question.issuedRevision, delivered.metadata.trainingQuestionDelivery.reference.issuedRevision);
  assert.deepEqual(accepted.data.trainingQuestion.delivery, { conversationId: sessionId,
    turnId: delivered.turnId, outputId: delivered.metadata.trainingQuestionDelivery.outputId });
  assert.equal(f.createdSessions.length, 1);
  allowed = false;
  await assert.rejects(call("revoked-learning-read", "assistant_action_search", {}), /Learning actor access revoked/);
  assert.equal((await teaching.read()).completion.passed, 0);
  allowed = true;
  busy = false;
  await f.service.interruptAgentTurn(sessionId, {}, { runtime, vibe64User: teaching.actor });
  // Closing drains the actual after-turn completion queue before checking it.
  await f.service.close();
  assert.equal((await runtime.getSession(sessionId, { inspectSource: false })).workspaceSetup.status, "unconfigured",
    "A no-workspace lesson must not run source preparation or save a false source failure after its native turn.");
});


test("Learning Main final reader exposes the original OpenCode saved publication at its own native checkpoint", { timeout: 30_000 }, async t => {
  const { trainingTeachingFixture } = await import("../fixtures/trainingTeachingFixture.js");
  const { Vibe64SessionRuntime } = await import("@local/vibe64-runtime/server");
  let removeTeaching;
  const teaching = await trainingTeachingFixture({ after(callback) { removeTeaching = callback; } }, { ready: false, exercise: false });
  const saved = await teaching.learners.readLearningSessionScope({ actor: teaching.actor, attemptId: teaching.attemptId });
  let native, checkpointResult;
  const teachingBinding = {
    bindConversation(input) { native = input.native; return {}; },
    async completeConversation({ nativeTurn, outcome }) {
      if (outcome === "completed") checkpointResult = native.readFinalAssistantResult(nativeTurn);
    },
    async cleanupConversation() {}
  };
  const f = await boundMainOpenCodeFixture(t, { assistantResponses: ["Exact native explanation."],
    async runtimeFactory({ harness }) {
      harness.session.sessionId = `learning-${teaching.attemptId}`;
      const runtime = new Vibe64SessionRuntime({ projectContextRoot: harness.root,
        projectRuntimeRoot: saved.projectRuntimeRoot, learningScope: saved.scope,
        learningInstructions: () => "Teach only the installed lesson in this controlled native binding proof.",
        learningTeaching: teachingBinding,
        promptRenderer: () => assert.fail("A source-less binding must not render a project source prompt.") });
      await runtime.createSession({ sessionId: harness.session.sessionId,
        metadata: { assistant_selection: harness.session.metadata.assistant_selection } });
      return runtime;
    }
  });
  t.after(() => removeTeaching());
  await f.manager.sendMessage(f.context.sessionId,
    { messageId: "native-reader-request", message: "Explain this lesson." }, f.context);
  const state = await f.manager.sessionState(f.context.sessionId, f.context);
  await f.controller.waitForTurn(f.context.sessionId, f.context);
  const turn = (await f.manager.sessionState(f.context.sessionId, f.context)).turn;
  const result = native.readFinalAssistantResult({ threadId: state.thread.id, turnId: turn.id });
  assert.ok(result, "The reader must use the original successful native result, not saved chat inference.");
  assert.deepEqual(checkpointResult, result, "The original checkpoint sees the already published native receipt.");
  const log = await f.store.readConversationLog(f.context.sessionId);
  const written = log.find(value => value.assistant?.text === "Exact native explanation.");
  assert.deepEqual(result.conversationTurn, written);
  assert.equal(result.text, written.assistant.text);
  assert.equal(result.conversationTurn.assistant.outputId, written.assistant.outputId);
  assert.equal(result.threadId, state.thread.id);
  assert.equal(result.turnId, turn.id);
  assert.equal(native.readFinalAssistantResult({ threadId: "foreign-thread", turnId: turn.id }), null);
  assert.equal(native.readFinalAssistantResult({ threadId: state.thread.id, turnId: "foreign-turn" }), null);
  result.conversationTurn.assistant.text = "Caller mutation";
  assert.equal(native.readFinalAssistantResult({ threadId: state.thread.id, turnId: turn.id }).conversationTurn.assistant.text,
    "Exact native explanation.");
  assert.equal(f.promptCalls.length, 1, "Final reads do not dispatch another native prompt.");
});


// The recovery input is already in native history before B; only its ACK is
// delayed. This proves the receipt fence, not native HTTP created-time ordering.
test("R19 a late recovery ACK cannot replace admitted B or bypass its authored-row commit", { timeout: 15000 }, async (t) => {
  const { upstreamMessageId } = await import("../../packages/vibe64-terminals/src/server/openCodeConversationStorage.js");
  const recoveryEntered = Promise.withResolvers();
  const releaseRecoveryAck = Promise.withResolvers();
  const commitEntered = Promise.withResolvers();
  const releaseCommit = Promise.withResolvers();
  const postRecoveryRead = Promise.withResolvers();
  const twoCompletedBPolls = Promise.withResolvers();
  const response = { messages: [] };
  const firstMessageId = "r19-recovery-ack-first";
  const latestMessageId = "r19-recovery-ack-latest";
  const firstInputId = upstreamMessageId(firstMessageId);
  const latestInputId = upstreamMessageId(latestMessageId);
  const recoveryInputId = upstreamMessageId(`${firstInputId}:final-response`);
  const created = Date.now();
  let recoveryAckReleased = false;
  let completedBPolls = 0;
  let steering;
  let harness;
  harness = await controllerHarness({
    assistantResponses: [response, response, response],
    async beforePrompt({ input }) {
      if (input.id === firstInputId) {
        response.messages.push(
          { id: firstInputId, type: "user", text: "A", time: { created } },
          { id: "r19-recovery-ack-a", type: "assistant", finish: "stop",
            content: [{ id: "r19-recovery-ack-reasoning", type: "reasoning", text: "A's saved reasoning." }],
            time: { created: created + 1, completed: created + 2 } }
        );
      } else if (input.id === recoveryInputId) {
        response.messages.push(
          { id: recoveryInputId, type: "user", text: input.prompt.text, time: { created: created + 3 } },
          { id: "r19-recovery-ack-r", type: "assistant", text: "The predecessor recovery answer.", finish: "stop",
            time: { created: created + 4, completed: created + 5 } }
        );
        recoveryEntered.resolve();
        await releaseRecoveryAck.promise;
      } else {
        assert.equal(input.id, latestInputId, "The only new authored input is B.");
        response.messages.push(
          { id: latestInputId, type: "user", text: "B", time: { created: created + 6 } },
          { id: "r19-recovery-ack-b", type: "assistant", text: "B's exact final answer.", finish: "stop",
            time: { created: created + 7, completed: created + 8 } }
        );
      }
    },
    beforeMessages() {
      if (recoveryAckReleased && harness.promptCalls.length === 3) postRecoveryRead.resolve();
    },
    sessionStatus: async () => {
      if (recoveryAckReleased && harness.promptCalls.length === 3 && ++completedBPolls === 2) {
        twoCompletedBPolls.resolve();
      }
      return { type: "idle" };
    }
  });
  const writeUser = harness.runtime.store.writeConversationUserMessage;
  harness.runtime.store.writeConversationUserMessage = async (...args) => {
    if (args[1].messageId === latestMessageId) {
      commitEntered.resolve();
      await releaseCommit.promise;
    }
    return writeUser(...args);
  };
  t.after(async () => {
    releaseRecoveryAck.resolve();
    releaseCommit.resolve();
    await steering?.catch(() => {});
    await harness.controller.closeAllForProject();
    await rm(harness.root, { recursive: true, force: true });
  });
  const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: firstMessageId });
  const completion = harness.controller.waitForTurn("session-1");
  await recoveryEntered.promise;
  const recovery = harness.promptCalls[1];
  assert.equal(recovery.id, first.thread.id);
  assert.equal(recovery.input.id, recoveryInputId);
  assert.equal(recovery.input.delivery, "queue");
  assert.equal(recovery.input.resume, true);
  assert.equal(recovery.input.agent, harness.selection.agentId);
  assert.deepEqual(recovery.input.model, {
    id: harness.selection.modelId, providerID: harness.selection.modelProviderId, variant: harness.selection.variantId
  });
  assert.ok(harness.thinkingMessages.some(message => message.text === "A's saved reasoning."));
  steering = harness.controller.sendMessage("session-1", { message: "B", messageId: latestMessageId });
  await commitEntered.promise;
  const owner = harness.controller.prepareConversationHost("session-1", {}, "activity").native.owner;
  const tracked = [...owner.turns.values()].find(turn => turn.threadId === first.thread.id);
  const latestAdmission = tracked.admission;
  assert.equal(tracked.inputMessageId, latestInputId);
  assert.equal(harness.promptCalls[2].input.delivery, "steer");
  recoveryAckReleased = true;
  releaseRecoveryAck.resolve();
  await postRecoveryRead.promise;
  assert.equal(tracked.inputMessageId, latestInputId, "A late recovery receipt must not retarget the latest native input.");
  assert.equal(tracked.admission, latestAdmission, "The same held B commit still owns the terminal fence.");
  assert.equal(await Promise.race([
    twoCompletedBPolls.promise.then(() => "observed-B"),
    completion.then(() => "premature-completion")
  ]), "observed-B");
  assert.equal(tracked.active, true);
  assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
  assert.equal(harness.checkpoints.length, 0);
  assert.deepEqual(harness.userMessages.map(message => message.messageId), [firstMessageId]);
  releaseCommit.resolve();
  const latest = await steering;
  assert.equal(latest.thread.id, first.thread.id);
  assert.equal(latest.deliveryMode, "steer");
  assert.equal((await completion).state, "completed");
  assert.equal(tracked.inputMessageId, latestInputId);
  assert.equal(harness.assistantMessages.at(-1).text, "B's exact final answer.");
  assert.equal(harness.assistantMessages.some(message => message.text === "The predecessor recovery answer."), false);
  assert.deepEqual(harness.userMessages.map(message => message.messageId), [firstMessageId, latestMessageId]);
  assert.deepEqual(harness.promptCalls.map(({ input }) => input.id), [firstInputId, recoveryInputId, latestInputId]);
  assert.equal(harness.checkpoints.length, 1, "The original outer turn checkpoints once after B's commit.");
  assert.deepEqual(harness.systemMessages, []);
});

// These companions use the original Main controller and native-history fixture.
// A prompt ACK deliberately precedes native user creation, as prompt_async does.
for (const order of ["later", "safe-tie", "unsafe-tie"]) {
  test(`R19 recovery receipt gates native B creation and preserves its authored commit (${order})`, { timeout: 15000 }, async t => {
    const { upstreamMessageId } = await import("../../packages/vibe64-terminals/src/server/openCodeConversationStorage.js");
    const firstMessageId = `r19-native-receipt-A-${order}`;
    const firstInputId = upstreamMessageId(firstMessageId);
    const recoveryInputId = upstreamMessageId(`${firstInputId}:final-response`);
    let latestMessageId = `r19-native-receipt-B-${order}`;
    if (order !== "later") {
      for (let suffix = 0; ; suffix += 1) {
        latestMessageId = `r19-native-receipt-B-${order}-${suffix}`;
        if ((upstreamMessageId(latestMessageId) > recoveryInputId) === (order === "safe-tie")) break;
      }
    }
    const latestInputId = upstreamMessageId(latestMessageId);
    const recoveryEntered = Promise.withResolvers();
    const joinedRecovery = Promise.withResolvers();
    const committedB = Promise.withResolvers();
    const missingBRead = Promise.withResolvers();
    const response = { messages: [] };
    const created = Date.now();
    let steering;
    let harness;
    harness = await controllerHarness({
      assistantResponses: [response, response, response],
      beforePrompt({ input }) {
        if (input.id === firstInputId) {
          response.messages.push(
            { id: firstInputId, type: "user", text: "A", time: { created } },
            { id: "r19-native-receipt-reasoning", type: "assistant", finish: "stop",
              content: [{ id: "r19-native-receipt-thought", type: "reasoning", text: "Retained A reasoning." }],
              time: { created: created + 1, completed: created + 2 } }
          );
        } else if (input.id === recoveryInputId) {
          recoveryEntered.resolve();
        } else {
          assert.equal(input.id, latestInputId);
          assert.equal(response.messages.some(row => row.id === recoveryInputId), true,
            "B cannot dispatch before exact native R custody.");
        }
      },
      beforeMessages() {
        if (harness.promptCalls.length === 3 && harness.userMessages.some(row => row.messageId === latestMessageId) &&
            !response.messages.some(row => row.id === latestInputId)) missingBRead.resolve();
      }
    });
    const writeUser = harness.runtime.store.writeConversationUserMessage;
    harness.runtime.store.writeConversationUserMessage = async (...args) => {
      const value = await writeUser(...args);
      if (args[1].messageId === latestMessageId) committedB.resolve();
      return value;
    };
    t.after(async () => {
      await harness.controller.interruptTurn("session-1").catch(() => {});
      await steering?.catch(() => {});
      await harness.controller.closeAllForProject();
      await rm(harness.root, { recursive: true, force: true });
    });
    const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: firstMessageId });
    const completion = harness.controller.waitForTurn("session-1");
    await recoveryEntered.promise;
    const owner = harness.controller.prepareConversationHost("session-1", {}, "activity").native.owner;
    const tracked = [...owner.turns.values()].find(turn => turn.threadId === first.thread.id);
    const gate = tracked.recoveryAdmission;
    assert.ok(gate);
    const receiptPromise = gate.promise;
    Object.defineProperty(gate, "promise", { get() { joinedRecovery.resolve(); return receiptPromise; } });
    steering = harness.controller.sendMessage("session-1", { message: "B", messageId: latestMessageId });
    await joinedRecovery.promise;
    assert.deepEqual(harness.promptCalls.map(({ input }) => input.id), [firstInputId, recoveryInputId]);
    assert.deepEqual(harness.userMessages.map(row => row.messageId), [firstMessageId]);
    assert.equal(tracked.inputMessageId, firstInputId, "Undispatched B cannot replace current input.");
    assert.equal(tracked.active, true);
    assert.equal(harness.checkpoints.length, 0);
    response.messages.push({ id: recoveryInputId, type: "user", text: "Internal R", time: { created: created + 3 } });
    await committedB.promise;
    await missingBRead.promise;
    assert.deepEqual(harness.userMessages.map(row => row.messageId), [firstMessageId, latestMessageId],
      "The ACK-admitted authored B is saved while its native creation is still unknown.");
    assert.equal(tracked.inputMessageId, latestInputId);
    assert.equal(tracked.active, true);
    assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
    assert.equal(harness.checkpoints.length, 0);
    const bCreated = created + (order === "later" ? 4 : 3);
    response.messages.push(
      { id: latestInputId, type: "user", text: "B", time: { created: bCreated } },
      { id: "r19-native-receipt-final", type: "assistant", text: "Exact B final.", finish: "stop",
        time: { created: created + 5, completed: created + 6 } }
    );
    // Native history uses the producer's created-time then JavaScript ID order.
    response.messages.sort((left, right) => left.time.created - right.time.created ||
      (left.id > right.id ? 1 : left.id < right.id ? -1 : 0));
    const latest = await steering;
    const finished = await completion;
    assert.equal(latest.delivered, true);
    assert.equal(latest.thread.id, first.thread.id);
    assert.equal(latest.deliveryMode, "steer");
    assert.deepEqual(harness.userMessages.map(row => row.messageId), [firstMessageId, latestMessageId]);
    assert.deepEqual(harness.promptCalls.map(({ input }) => input.id), [firstInputId, recoveryInputId, latestInputId]);
    assert.ok(harness.thinkingMessages.some(row => row.text === "Retained A reasoning."));
    assert.equal(harness.processStops.length, 0, "Existing confirmed session cleanup keeps shared peers warm.");
    if (order === "unsafe-tie") {
      assert.equal(finished.status, "observation_lost");
      assert.equal(finished.state, "failed");
      assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
      assert.equal(harness.assistantMessages.some(row => row.text === "Exact B final."), false);
      assert.match(finished.error, /could not confirm that the new input follows/u);
    } else {
      assert.equal(finished.state, "completed");
      assert.equal(harness.assistantMessages.at(-1).text, "Exact B final.");
      assert.equal(harness.checkpoints.length, 1);
      assert.deepEqual(harness.systemMessages, []);
    }
  });
}

for (const stopAt of ["R", "B"]) {
  test(`R19 Stop releases unknown native ${stopAt} custody without dispatching or replaying queued work`, { timeout: 15000 }, async t => {
    const { upstreamMessageId } = await import("../../packages/vibe64-terminals/src/server/openCodeConversationStorage.js");
    const firstMessageId = `r19-stop-receipt-A-${stopAt}`;
    const latestMessageId = `r19-stop-receipt-B-${stopAt}`;
    const firstInputId = upstreamMessageId(firstMessageId);
    const latestInputId = upstreamMessageId(latestMessageId);
    const recoveryInputId = upstreamMessageId(`${firstInputId}:final-response`);
    const recoveryEntered = Promise.withResolvers();
    const joinedRecovery = Promise.withResolvers();
    const missingBRead = Promise.withResolvers();
    const response = { messages: [] };
    const created = Date.now();
    let interrupts = 0;
    let steering;
    let harness;
    harness = await controllerHarness({
      assistantResponses: [response, response, response],
      interrupt: async () => { interrupts += 1; return true; },
      beforePrompt({ input }) {
        if (input.id === firstInputId) {
          response.messages.push(
            { id: firstInputId, type: "user", text: "A", time: { created } },
            { id: "r19-stop-receipt-reasoning", type: "assistant", finish: "stop",
              content: [{ id: "r19-stop-receipt-thought", type: "reasoning", text: "Saved reasoning." }],
              time: { created: created + 1, completed: created + 2 } }
          );
        } else if (input.id === recoveryInputId) {
          if (stopAt === "B") response.messages.push(
            { id: recoveryInputId, type: "user", text: "Internal R", time: { created: created + 3 } }
          );
          recoveryEntered.resolve();
        } else assert.equal(input.id, latestInputId);
      },
      beforeMessages() {
        if (harness.promptCalls.length === 3 && harness.userMessages.some(row => row.messageId === latestMessageId)) {
          missingBRead.resolve();
        }
      }
    });
    t.after(async () => {
      await harness.controller.interruptTurn("session-1").catch(() => {});
      await steering?.catch(() => {});
      await harness.controller.closeAllForProject();
      await rm(harness.root, { recursive: true, force: true });
    });
    const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: firstMessageId });
    const completion = harness.controller.waitForTurn("session-1");
    await recoveryEntered.promise;
    const owner = harness.controller.prepareConversationHost("session-1", {}, "activity").native.owner;
    const tracked = [...owner.turns.values()].find(turn => turn.threadId === first.thread.id);
    const gate = tracked.recoveryAdmission;
    const receiptPromise = gate.promise;
    Object.defineProperty(gate, "promise", { get() { joinedRecovery.resolve(); return receiptPromise; } });
    steering = harness.controller.sendMessage("session-1", { message: "B", messageId: latestMessageId });
    // Attach before Stop; an undispatched input may reject with the abort cause.
    const delivery = steering.then(value => ({ value }), error => ({ error }));
    await joinedRecovery.promise;
    if (stopAt === "B") await missingBRead.promise;
    const stopped = await harness.controller.interruptTurn("session-1");
    const result = await delivery;
    assert.equal(stopped.ok, true);
    assert.equal(stopped.turn.state, "interrupted");
    assert.equal((await completion).state, "interrupted");
    assert.equal(tracked.active, false);
    assert.equal(interrupts, 1);
    assert.equal(harness.processStops.length, 0);
    assert.deepEqual(harness.systemMessages, []);
    assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
    if (stopAt === "R") {
      assert.equal(result.error?.name, "AbortError");
      assert.deepEqual(harness.promptCalls.map(({ input }) => input.id), [firstInputId, recoveryInputId]);
      assert.deepEqual(harness.userMessages.map(row => row.messageId), [firstMessageId]);
      assert.equal(tracked.inputMessageId, firstInputId);
    } else {
      assert.equal(result.value.delivered, true, "ACK-admitted B keeps its authored receipt after Stop.");
      assert.equal(result.value.turn.state, "interrupted");
      assert.deepEqual(harness.promptCalls.map(({ input }) => input.id), [firstInputId, recoveryInputId, latestInputId]);
      assert.deepEqual(harness.userMessages.map(row => row.messageId), [firstMessageId, latestMessageId]);
      assert.equal(tracked.inputMessageId, latestInputId);
    }
  });
}

for (const failureAt of ["R", "B"]) {
  test(`R19 original native failure releases missing ${failureAt} custody without resending`, { timeout: 15000 }, async t => {
    const { upstreamMessageId } = await import("../../packages/vibe64-terminals/src/server/openCodeConversationStorage.js");
    const firstMessageId = `r19-failed-receipt-A-${failureAt}`;
    const latestMessageId = `r19-failed-receipt-B-${failureAt}`;
    const firstInputId = upstreamMessageId(firstMessageId);
    const latestInputId = upstreamMessageId(latestMessageId);
    const recoveryInputId = upstreamMessageId(`${firstInputId}:final-response`);
    const recoveryEntered = Promise.withResolvers();
    const joinedRecovery = Promise.withResolvers();
    const missingBRead = Promise.withResolvers();
    const emitFailure = Promise.withResolvers();
    const response = { messages: [] };
    const created = Date.now();
    const failureText = `Native ${failureAt} construction failed before custody.`;
    let rejectedB = 0;
    let steering;
    let harness;
    harness = await controllerHarness({
      assistantResponses: [response, response, response],
      async *events(id, { onReady, signal }) {
        onReady();
        yield { data: { type: "server.connected" } };
        await emitFailure.promise;
        signal.throwIfAborted();
        yield { data: { type: "session.error", properties: {
          sessionID: id, error: { name: "APIError", data: { message: failureText } }
        } } };
        if (!signal.aborted) await new Promise(resolve => signal.addEventListener("abort", resolve, { once: true }));
      },
      beforePrompt({ input }) {
        if (input.id === firstInputId) {
          response.messages.push(
            { id: firstInputId, type: "user", text: "A", time: { created } },
            { id: "r19-failed-receipt-reasoning", type: "assistant", finish: "stop",
              content: [{ id: "r19-failed-receipt-thought", type: "reasoning", text: "Saved A reasoning." }],
              time: { created: created + 1, completed: created + 2 } }
          );
        } else if (input.id === recoveryInputId) {
          if (failureAt === "B") response.messages.push(
            { id: recoveryInputId, type: "user", text: "Internal R", time: { created: created + 3 } }
          );
          recoveryEntered.resolve();
        } else assert.equal(input.id, latestInputId);
      },
      beforeMessages() {
        if (harness.promptCalls.length === 3 && harness.userMessages.some(row => row.messageId === latestMessageId)) {
          missingBRead.resolve();
        }
      }
    });
    t.after(async () => {
      emitFailure.resolve();
      await harness.controller.interruptTurn("session-1").catch(() => {});
      await steering?.catch(() => {});
      await harness.controller.closeAllForProject();
      await rm(harness.root, { recursive: true, force: true });
    });
    const first = await harness.controller.sendMessage("session-1", { message: "A", messageId: firstMessageId });
    const completion = harness.controller.waitForTurn("session-1");
    await recoveryEntered.promise;
    const owner = harness.controller.prepareConversationHost("session-1", {}, "activity").native.owner;
    const tracked = [...owner.turns.values()].find(turn => turn.threadId === first.thread.id);
    const gate = tracked.recoveryAdmission;
    const receiptPromise = gate.promise;
    Object.defineProperty(gate, "promise", { get() { joinedRecovery.resolve(); return receiptPromise; } });
    steering = harness.controller.sendMessage("session-1", { message: "B", messageId: latestMessageId,
      onPromptRejected() { rejectedB += 1; } });
    const delivery = steering.then(value => ({ value }), error => ({ error }));
    await joinedRecovery.promise;
    if (failureAt === "B") await missingBRead.promise;
    emitFailure.resolve();
    const result = await delivery;
    const finished = await completion;
    assert.equal(finished.state, "failed");
    assert.equal(finished.status, "observation_lost");
    assert.equal(finished.active, false);
    assert.match(finished.error, /construction failed before custody/u);
    assert.equal(rejectedB, 0, "Failure of R/observation cannot reject an undispatched or ACK-admitted B.");
    assert.equal(harness.agentRunEvents.some(({ run }) => run.state === "completed"), false);
    assert.equal(harness.processStops.length, 0, "Original confirmed session cleanup does not retire shared peers.");
    assert.ok(harness.thinkingMessages.some(row => row.text === "Saved A reasoning."));
    if (failureAt === "R") {
      assert.equal(result.error?.name, "APIError");
      assert.deepEqual(harness.promptCalls.map(({ input }) => input.id), [firstInputId, recoveryInputId]);
      assert.deepEqual(harness.userMessages.map(row => row.messageId), [firstMessageId]);
      assert.equal(tracked.inputMessageId, firstInputId);
    } else {
      assert.equal(result.value.delivered, true);
      assert.equal(result.value.turn.status, "observation_lost");
      assert.deepEqual(harness.promptCalls.map(({ input }) => input.id), [firstInputId, recoveryInputId, latestInputId]);
      assert.deepEqual(harness.userMessages.map(row => row.messageId), [firstMessageId, latestMessageId]);
      assert.equal(tracked.inputMessageId, latestInputId);
    }
  });
}

test("R20 hidden renewal successor preserves the original invalid-ACK boundary through the real store", { timeout: 15_000 }, async t => {
  const { Vibe64SessionRuntime } = await import("@local/vibe64-runtime/server");
  const handover = renewalHandover();
  const handoverHash = sessionRenewalHandoverHash(handover);
  const nativeResponse = { messages: [] };
  const f = await mainOpenCodeServiceFixture(t, {
    // The existing controller fixture supplies the authorized command-host seam;
    // command-server HTTP health remains the separately tested host boundary.
    withCommandBoundary: true,
    helperResponse: nativeResponse,
    beforePrompt({ id, input }) {
      // Replay the observed ordering: completed skill call, then final Markdown.
      // Only fixture identities/source replace the private live session values.
      const created = Date.now();
      nativeResponse.messages = [
        { id: input.id, type: "user", text: input.prompt.text, time: { created } },
        { id: "msg_r20_skill", type: "assistant", time: { created: created + 1, completed: created + 2 },
          content: [{ type: "tool", tool: "skill", state: { status: "completed",
            input: { name: "genesis-project" }, output: "Loaded skill: genesis-project" } }] },
        { id: "msg_r20_final", type: "assistant", time: { created: created + 3, completed: created + 4 },
          text: ["**Acknowledgement — renewal session**", "",
            `- **Handover accepted**: yes — the approved handover (hash \`${handoverHash}\`) is accepted as this thread's continuity context.`,
            `- **Canonical source accepted**: ${renewalSource.authority} → ${renewalSource.repository}, ref ${renewalSource.ref}, commit ${renewalSource.commit}.`,
            "- **Scope acknowledged**: no new Helper, no setup/tests, no file changes, no automatic goal execution — awaiting an explicit next request.",
            "- **Actions taken this turn**: none (read-only acknowledgement)."].join("\n") }
      ];
      assert.ok(id);
    },
    async runtimeFactory({ harness }) {
      const { managedSessionSourcePath } = await import("@local/vibe64-core/server/sessionSourcePath");
      const predecessorSource = harness.session.metadata.source_path;
      const runtime = new Vibe64SessionRuntime({ projectContextRoot: harness.root,
        projectRuntimeRoot: path.join(harness.root, "runtime"), projectSessionSourceRoot: harness.root,
        createSessionSource: async ({ session, store, expectedCommit }) => {
          // Use the original renewal fixture's real clone/private attachment sequence.
          const source = managedSessionSourcePath(harness.root, session.sessionId);
          await mkdir(path.dirname(source), { recursive: true });
          harness.git("clone", "--no-hardlinks", predecessorSource, source);
          assert.equal(harness.git("-C", source, "rev-parse", "HEAD"), expectedCommit);
          for (const [name, value] of Object.entries({ source_kind: "session_clone",
            source_path: source, source_path_authority: "managed_session_source" })) {
            await store.writeMetadataValueForRenewal(session.sessionId, name, value);
          }
        } });
      await runtime.store.createSession({ sessionId: "session-1", runtimeKind: "genesis",
        metadata: harness.session.metadata });
      return runtime;
    }
  });
  const renewalId = "11111111-2222-4333-8444-555555555555";
  const successorId = "renewal-r20-private-successor";
  await f.store.quiesceSessionForRenewal({ renewalId, sourceSessionId: "session-1" });
  await f.runtime.createRenewalSession({ renewalId, renewedFrom: "session-1", sessionId: successorId,
    actorId: "owner", actorDisplayName: "Owner", confirmedAt: "2026-10-10T10:00:00.000Z",
    metadata: { assistant_selection: f.session.metadata.assistant_selection },
    sourceContext: { expectedCommit: f.git("rev-parse", "HEAD") } });
  const successor = await f.runtime.getSessionForRenewal(successorId, { inspectSource: false });
  const predecessor = await f.store.readSessionForRenewal("session-1");
  assert.equal(successor.status, "renewal_pending");
  assert.equal(successor.metadata.renewed_from, "session-1");
  assert.equal(successor.sourcePath, path.join(f.root, "sessions", "active", successorId, "source"));
  assert.ok(path.isAbsolute(successor.sessionRoot));
  assert.ok(path.isAbsolute(f.runtime.stateRoot));
  await assert.rejects(f.runtime.getSession(successorId, { inspectSource: false }),
    { code: "vibe64_session_renewal_private" });
  const forbiddenReads = [];
  const restoreReaders = [];
  for (const [owner, method] of [[f.runtime, "getSession"], [f.store, "readSession"], [f.store, "readStatus"], [f.store, "readAgentRun"]]) {
    const original = owner[method];
    owner[method] = async function (...args) {
      try { return await original.apply(this, args); }
      catch (error) {
        if (args[0] === successorId && error.code === "vibe64_session_renewal_private") {
          forbiddenReads.push({ method, sessionId: args[0], stack: error.stack });
        }
        throw error;
      }
    };
    restoreReaders.push(() => { owner[method] = original; });
  }
  try {
    const input = { handover, handoverHash, operationId: "renewal:r20-private-invalid-ack",
      forbiddenThreadId: "r20-predecessor-native", source: renewalSource };
    const options = { runtime: f.runtime, session: successor, vibe64User: f.context.vibe64User };
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await assert.rejects(f.service.seedSessionRenewalHandover(successorId, input, options), error => {
        if (error.code !== "vibe64_session_renewal_acknowledgement_invalid") {
          t.diagnostic(`R20 unexpected seed failure: ${JSON.stringify({ code: error.code, message: error.message, stack: error.stack })}`);
        }
        assert.equal(error.code, "vibe64_session_renewal_acknowledgement_invalid");
        assert.equal(error.details.handoverPromptAccepted, true);
        assert.equal(error.details.turnId, "msg_r20_final");
        return true;
      });
      assert.equal(f.commandEnvironmentCalls.length, attempt + 1);
      const preparedHost = f.commandEnvironmentCalls.at(-1);
      assert.equal(preparedHost.runtime, f.runtime);
      assert.equal(preparedHost.sessionId, successorId);
      assert.equal(preparedHost.worktreePath, successor.sourcePath);
      assert.equal(f.promptCalls.length, 1, "Same-operation retry must inspect the exact native seed without resending");
      assert.equal(f.processStops.length, 0, "Invalid ACK must not release native ownership");
      const retained = await f.runtime.getSessionForRenewal(successorId, { inspectSource: false });
      assert.equal(retained.status, "renewal_pending");
      assert.ok(retained.metadata.opencode_conversation_id);
      assert.equal(retained.metadata.agent_renewal_seed_acknowledged_at, undefined);
    }
    // Match the workflow's accepted-native failure catch, without accepting its Markdown ACK.
    const retainedNativeRows = structuredClone(nativeResponse.messages);
    const cleanupSuccessor = await f.runtime.getSessionForRenewal(successorId, { inspectSource: false });
    let cleaned;
    try {
      cleaned = await f.service.closeRenewalSuccessorSessionTerminals(cleanupSuccessor, { renewalId, runtime: f.runtime });
    } catch (error) {
      t.diagnostic(`R20 successor cleanup failure: ${JSON.stringify({ code: error.code, message: error.message, stack: error.stack })}`);
      throw error;
    }
    assert.equal(cleaned.ok, true);
    assert.equal(f.promptCalls.length, 1, "Accepted-native failure cleanup must not replay the renewal seed");
    assert.deepEqual(nativeResponse.messages, retainedNativeRows, "Cleanup must retain the exact native seed history");
    const cleanedSuccessor = await f.runtime.getSessionForRenewal(successorId, { inspectSource: false });
    assert.equal(cleanedSuccessor.status, "renewal_pending");
    assert.equal(cleanedSuccessor.metadata.agent_renewal_seed_acknowledged_at, undefined);
    // Retained helper cleanup reuses the same event writer within the exact private lease.
    const { createOpenCodeConversationPresentation } = await import("../../packages/vibe64-terminals/src/server/openCodeConversationPresentation.js");
    const helperId = "reasoning_11111111-2222-4333-8444-555555555555";
    const helperRoot = path.join(f.runtime.stateRoot, "assistant-helpers", helperId);
    const helper = { scope: { id: helperId, workdir: path.join(helperRoot, "workdir"),
      runtimeRoot: path.join(helperRoot, "runtime") }, conversationId: "r20-retained-helper",
      executionId: "r20-retained-helper-execution", selection: { engineId: "opencode", modelProviderId: "opencode", modelId: "big-pickle" } };
    await mkdir(helper.scope.workdir, { recursive: true });
    await f.store.mutateSessionForRenewal(successorId, () => f.store.writeAgentRunEvent(successorId, "opencode_server", {
      event: { kind: "reasoning-helper-created" }, patch: { reasoningSummaryHelper: helper } }));
    let deleteConfirmed = false;
    const deletedHelpers = [];
    const presentation = createOpenCodeConversationPresentation({ getAssistantManager: () => ({
      async deleteEphemeralConversation(scope, input, options) {
        deletedHelpers.push({ scope, input, options });
        return { ok: deleteConfirmed, error: deleteConfirmed ? "" : "Helper deletion is not confirmed" };
      } }), turns: new Map(), temporaryConversations: new Map(), publishSessionChanged: async () => {} });
    const privateCleanup = { sessionId: successorId, runtime: f.runtime,
      session: await f.runtime.getSessionForRenewal(successorId, { inspectSource: false }),
      renewalCleanup: { kind: "successor", renewalId, sourceSessionId: "session-1" }, vibe64User: f.context.vibe64User };
    await assert.rejects(presentation.cleanupReasoningSummary({ ...privateCleanup,
      renewalCleanup: { ...privateCleanup.renewalCleanup, renewalId: "wrong-renewal" } }), TypeError);
    assert.equal(deletedHelpers.length, 0);
    await assert.rejects(presentation.cleanupReasoningSummary(privateCleanup), /Helper deletion is not confirmed/);
    const failedHelperRun = (await f.runtime.getSessionForRenewal(successorId, { inspectSource: false })).agentRuns.find(run => run.id === "opencode_server");
    assert.deepEqual(failedHelperRun.reasoningSummaryHelper, helper);
    assert.equal(failedHelperRun.events.some(event => event.kind === "reasoning-helper-closed"), false);
    assert.ok((await (await import("node:fs/promises")).stat(helperRoot)).isDirectory());
    deleteConfirmed = true;
    await presentation.cleanupReasoningSummary(privateCleanup);
    assert.deepEqual(deletedHelpers[1], { scope: helper.scope,
      input: { conversationId: helper.conversationId, cleanupExecutionId: helper.executionId },
      options: { assistantSelection: helper.selection, vibe64User: f.context.vibe64User } });
    const closedHelperRun = (await f.runtime.getSessionForRenewal(successorId, { inspectSource: false })).agentRuns.find(run => run.id === "opencode_server");
    assert.equal(closedHelperRun.reasoningSummaryHelper, null);
    assert.equal(closedHelperRun.events.filter(event => event.kind === "reasoning-helper-closed").length, 1);
    await assert.rejects((await import("node:fs/promises")).stat(helperRoot), { code: "ENOENT" });
    await assert.rejects(f.store.readAgentRun(successorId, "opencode_server"), { code: "vibe64_session_renewal_private" });
    assert.deepEqual(await f.store.readSessionForRenewal("session-1"), predecessor);
    assert.deepEqual(forbiddenReads.map(({ method, sessionId }) => ({ method, sessionId })),
      [{ method: "readAgentRun", sessionId: successorId }],
      "Only the explicit normal-access guard probe may enter a forbidden reader");
  } finally {
    for (const restore of restoreReaders) restore();
    for (const read of forbiddenReads) t.diagnostic(`R20 forbidden successor read: ${JSON.stringify(read)}`);
  }
});


test("R20 OpenCode renewal requests its exact existing JSON acknowledgement contract", async t => {
  const handover = renewalHandover();
  const handoverHash = sessionRenewalHandoverHash(handover);
  const acknowledgement = { schemaVersion: "vibe64.session-renewal-acknowledgement.v1",
    status: "ready", handoverHash, sourceCommit: renewalSource.commit, message: "Ready from the approved handover." };
  const harness = await controllerHarness({ assistantResponses: [JSON.stringify(acknowledgement)],
    beforePrompt({ input }) {
      assert.equal(input.prompt.text, sessionRenewalSeedPrompt({ handover, handoverHash, source: renewalSource }));
      assert.match(input.prompt.text, /Return only one JSON value matching this JSON Schema\. Do not wrap it in Markdown code fences:/u);
      assert.match(input.prompt.text, /Do not edit files, run commands, begin the next action, or ask questions/u);
      const schema = JSON.parse(input.prompt.text.split("\n").at(-1));
      assert.equal(schema.type, "object");
      assert.equal(schema.additionalProperties, false);
      assert.deepEqual(schema.required, ["schemaVersion", "status", "handoverHash", "sourceCommit", "message"]);
      assert.deepEqual(schema.properties.schemaVersion.enum, [acknowledgement.schemaVersion]);
      assert.deepEqual(schema.properties.status.enum, ["ready"]);
      assert.deepEqual(schema.properties.handoverHash.enum, [handoverHash]);
      assert.deepEqual(schema.properties.sourceCommit.enum, [renewalSource.commit]);
      assert.deepEqual(schema.properties.message, { maxLength: 500, minLength: 1, type: "string" });
    }, stop: async () => ({ exited: true, signal: "SIGTERM" }) });
  t.after(async () => {
    await harness.controller.closeAllForProject();
    await rm(harness.root, { force: true, recursive: true });
  });
  const operationId = "renewal:r20-explicit-json-schema";
  const result = await harness.controller.seedSessionRenewalHandover("session-1", {
    handover, handoverHash, oldThreadId: "predecessor-native", operationId, source: renewalSource
  }, { runtime: harness.runtime, session: harness.session });
  assert.equal(result.ok, true);
  assert.deepEqual(result.acknowledgement, { ...acknowledgement, rawOutput: JSON.stringify(acknowledgement) });
  assert.deepEqual(result.processExitProof, { exited: true, signal: "SIGTERM" });
  assert.equal(harness.promptCalls.length, 1);
  assert.equal(harness.userMessages.length, 0);
  const metadata = harness.session.metadata;
  assert.equal(metadata.agent_briefing_delivered, "yes");
  assert.equal(metadata.agent_briefing_delivered_at, result.acknowledgedAt);
  assert.equal(metadata.agent_briefing_transport, "opencode_server");
  assert.equal(metadata.agent_renewal_seed_acknowledged_at, result.acknowledgedAt);
  assert.equal(metadata.agent_renewal_seed_handover_hash, handoverHash);
  assert.equal(metadata.agent_renewal_seed_operation_id, operationId);
  assert.equal(metadata.agent_renewal_seed_thread_id, result.threadId);
  assert.equal(metadata.agent_renewal_seed_turn_id, result.turnId);
});
