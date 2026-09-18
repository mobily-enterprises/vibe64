import assert from "node:assert/strict";
import { mkdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import { genesisCommandShimDirectory } from "@local/vibe64-genesis/server";

import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_WORKLOAD_IDS,
  serializeVibe64AssistantSelection
} from "../../packages/vibe64-runtime/src/shared/index.js";
import {
  openCodeAssistantCapabilities
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeAssistantCatalog.js";
import {
  resolveOpenCodeEconomyExecutionProfile
} from "../../packages/vibe64-terminals/src/server/agent/providers/opencodeSessionAgentProvider.js";
import {
  OPENCODE_ECONOMY_AGENT_ID,
  OPENCODE_EPHEMERAL_AGENT_ID
} from "../../packages/vibe64-terminals/src/server/opencodeServerProcess.js";
import {
  sessionRenewalHandoverHash,
  sessionRenewalSeedPrompt
} from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";

import { agents, controllerHarness, providerDefinition } from "../fixtures/opencodeController.js";

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
    ok: true, admission: "accepted", messageId: "integration-continuation-1", threadId
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

test("OpenCode reuses an established session without repeating setup or model switches", async (t) => {
  const harness = await controllerHarness({
    assistantResponses: ["First turn", "Second turn"],
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

  await harness.controller.sendMessage("session-1", {
    message: "First",
    messageId: "client-message-fast-path-1"
  }, options);
  await harness.controller.waitForTurn("session-1", options);
  await harness.controller.sendMessage("session-1", {
    message: "Second",
    messageId: "client-message-fast-path-2"
  }, options);
  await harness.controller.waitForTurn("session-1", options);

  assert.equal(harness.commandEnvironmentCalls.length, 2);
  assert.equal(harness.processStarts.length, 1);
  assert.equal(harness.listConnectionCalls(), 1);
  assert.equal(harness.agentCatalogCalls(), 0);
  assert.equal(harness.providerCatalogCalls(), 0);
  assert.equal(harness.readSessionCalls(), 1);
  assert.equal(harness.createdSessions.length, 1);
  assert.deepEqual(harness.switchedModels, []);
  assert.deepEqual(harness.switchedAgents, []);
  assert.deepEqual(harness.renderPromptCalls.map(({ task }) => task), ["start"]);
  assert.equal(harness.promptCalls[0].input.prompt.text, "GENESIS start: First");
  assert.equal(harness.promptCalls[1].input.prompt.text, "Second");
  assert.equal(Object.hasOwn(harness.promptCalls[0].input.prompt, "turnContext"), false);
  assert.equal(Object.hasOwn(harness.promptCalls[1].input.prompt, "turnContext"), false);
});

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
  assert.equal(harness.readSessionCalls(), 2);
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
  assert.equal(harness.promptCalls.length, 2);
  assert.match(
    harness.promptCalls[1].input.prompt.text,
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

  assert.equal(harness.promptCalls.length, 2);
  assert.equal(completed.state, "failed");
  assert.equal(
    completed.error,
    "OpenCode finished without a user-facing final response. Please send your message again."
  );
  assert.deepEqual(harness.assistantMessages, []);
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
    message.text === reasoning && message.requireOpenTurn === true
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
  assert.deepEqual([...latestById.values()], [first, second, third]);
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
  harness.connection.economyModelId = "glm-5.3";
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
  const executionProfile = resolveOpenCodeEconomyExecutionProfile({
    assistantSelection: {
      ...harness.selection,
      schema: "vibe64.assistant-selection.v1"
    },
    assistantAccess: {
      economyModelId: harness.connection.economyModelId
    }
  }, {
    profileId: VIBE64_AGENT_EXECUTION_PROFILE_IDS.ECONOMY,
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
  assert.equal(helperSession.agent, OPENCODE_ECONOMY_AGENT_ID);
  assert.deepEqual(helperSession.model, {
    id: "deepseek-chat",
    providerID: "deepseek"
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
  assert.equal(helperPrompt.agent, OPENCODE_ECONOMY_AGENT_ID);
  assert.deepEqual(helperPrompt.model, {
    id: "deepseek-chat",
    providerID: "deepseek"
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

test("non-project ephemeral conversations use OpenCode's deny-all agent without project state", async (t) => {
  const harness = await controllerHarness({
    helperResponse: "The trusted host snapshot needs attention."
  });
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
  assert.equal(harness.processStops.length, 1);
});

test("OpenCode receives the same complete session command boundary as Codex", async (t) => {
  const harness = await controllerHarness({ withCommandBoundary: true });
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
  assert.match(harness.terminalStarts[0].upstreamSessionId, /^ses_vibe64_/u);
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
