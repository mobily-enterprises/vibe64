import assert from "node:assert/strict";
import test from "node:test";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createEventRuntime } from "@jskit-ai/kernel/server/runtime";
import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { registerVibe64ActionContext, withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createColleagueService } from "../../packages/vibe64-colleague/src/server/service.js";
import { createColleagueActions } from "../../packages/vibe64-colleague/src/server/actions.js";
import { COLLEAGUE_TOOL_PAYLOAD_LIMIT, readEnvelope } from "../../packages/vibe64-colleague/src/server/protocol.js";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { codexAppServerHelperTurnSettings } from "@local/vibe64-runtime/server/codexAppServerSessionBridge";

const selection = { engineId: "codex", modelProviderId: "openai", modelId: "test-model" };
const reply = (text) => JSON.stringify({ kind: "reply", text, toolName: "", arguments: "" });
const call = (value) => JSON.stringify({ kind: "tool", text: "", toolName: "vibe64_test_operate", arguments: JSON.stringify({ value }) });

async function fixture(t, responses, { systemRoot, discovery = false, watching = false, watchPollMs = 30000 } = {}) {
  const root = systemRoot || await mkdtemp(path.join(os.tmpdir(), "colleague-test-"));
  if (!systemRoot) t.after(() => rm(root, { force: true, recursive: true }));
  const actions = createActionCatalogue();
  const observations = { starts: [], mutations: [], creates: 0, allow: true, projectAllowed: true, reads: 0,
    helperCalls: [],
    target: { ok: true, status: "inProgress", runId: "work-1", messages: [{ id: "question", role: "user", text: "What happened?" }] },
    session: { ok: true, status: "active", agentSession: { turn: { id: "main-1", active: true, state: "inProgress" } } }, log: [] };
  const user = { username: "member", uid: 42, role: "member" };
  const context = { channel: "api", surface: "app", requestMeta: { request: { vibe64User: user } } };
  registerVibe64ActionContext(actions, {
    projectContext: { projectsRoot: root, async readWorkspaceProject({ slug }) { return { project: { path: path.join(root, slug) } }; } },
    resolveUser: async ({ request }) => observations.allow ? request?.vibe64User : null,
    authorizeProject() {
      if (!watching) throw new Error("Colleague must not need a project.");
      if (!observations.projectAllowed) throw Object.assign(new Error("Project access denied."), { statusCode: 403 });
    }
  });
  const terminals = {
    async readTemporaryConversation() { observations.reads += 1; return structuredClone(observations.target); },
    async requireAssistantSelectionAccess(actual, options) {
      assert.equal(options.vibe64User.username, "member");
      if (actual.modelId === "denied") throw Object.assign(new Error("Model access denied."), { statusCode: 403 });
    },
    async resolveAssistantSelection(actual, options) {
      assert.equal(options.vibe64User.username, "member");
      if (actual.catalogRevision === "stale") throw Object.assign(new Error("The assistant catalog changed."), { statusCode: 409 });
      return { ...actual, catalogRevision: "current" };
    },
    async resolveAssistantPurpose(input) {
      if (input.purpose === "conversation_summary") {
        observations.helperCalls.push({ purpose: input });
        return { available: observations.helperAvailable !== false, effectiveSelection: { ...selection, modelId: "cheap-helper" }, connectionIdentity: "member-helper" };
      }
      return { available: true, effectiveSelection: selection };
    },
    async resolveEphemeralAgentExecutionProfile(scope, input, options) {
      assert.deepEqual(input, { profileId: "helper", workloadId: "conversation_summary" });
      assert.equal(options.assistantSelection.modelId, "cheap-helper");
      assert.equal(options.expectedConnectionIdentity, "member-helper");
      assert.deepEqual(scope.environment, {});
      assert.ok(scope.workdir.startsWith(path.join(root, "colleague")));
      return { profileId: "helper", workloadId: "conversation_summary", providerId: "codex", revision: "helper-v1", model: "cheap-helper", thinking: "low",
        limits: { maxInputCharacters: 200000, maxOutputCharacters: 16000, timeoutMs: 120000 },
        policy: { environmentAccess: false, networkAccess: false, repositoryWrite: false, tools: "none" },
        request: { allowProviderModelFallback: false, reasoning: true, summary: false } };
    },
    async runEphemeralAgentChatTurn(scope, input, options) {
      observations.helperCalls.push({ scope, input });
      codexAppServerHelperTurnSettings({ cwd: scope.workdir, executionProfile: input.executionProfile, outputSchema: input.outputSchema });
      assert.equal(input.executionProfile.policy.tools, "none");
      await options.onEvent({ type: "thread", threadId: "summary-thread" });
      await options.onEvent({ type: "helper-execution", executionId: "summary-execution" });
      await options.onEvent({ type: "turn", turnId: "summary-turn" });
      observations.helperStarted?.();
      if (observations.blockHelper) await new Promise((resolve, reject) => options.signal.addEventListener("abort", () => reject(options.signal.reason), { once: true }));
      return { ok: true, status: "completed", text: observations.helperAnswer || JSON.stringify({ summary: "The project is a grocery list.", citations: [JSON.parse(input.prompt).messages[0].id] }) };
    },
    async deleteEphemeralAgentConversation(_scope, input) {
      observations.helperCalls.push({ cleanup: input });
      return observations.cleanupFails ? { ok: false, error: "Summary cleanup unavailable." } : { ok: true };
    },
    async createEphemeralAgentConversation(scope, input, options) {
      observations.creates += 1;
      observations.createdSelection = options.assistantSelection;
      assert.equal(input.persistent, true);
      assert.deepEqual(scope.environment, {});
      assert.ok(scope.workdir.startsWith(path.join(root, "colleague")));
      return { ok: true, conversationId: `native-${observations.creates}`, status: "ready" };
    },
    async startEphemeralAgentConversationTurn(scope, input) {
      observations.starts.push({ scope, input });
      return { ok: true, runId: `run-${observations.starts.length}`, status: "inProgress" };
    },
    async waitForEphemeralAgentConversationTurn() {
      const next = responses.shift();
      assert.notEqual(next, undefined, "Unexpected additional model turn");
      return { ok: true, status: observations.waitStatus || "completed",
        [observations.responseField || "text"]: typeof next === "function" ? await next() : next };
    },
    async stopEphemeralAgentConversation() { observations.onStop?.(); return { ok: true, status: "interrupted" }; },
    async readEphemeralAgentConversation() { return { ok: true, status: observations.readStatus || "completed" }; }
  };
  const events = createEventRuntime();
  const service = createColleagueService({ actions, terminals, events, watchPollMs, watchDebounceMs: 1, systemRoot: root,
    accounts: { async readModelRoutingWorkflows() { return { ok: true, workflows: [{ available: true, engineId: "codex" }] }; } } });
  const operation = withVibe64ActionContext({
    id: "vibe64.test.operate", kind: "command", idempotency: "none",
    input: { schema: createSchema({ value: { type: "string", required: true } }), mode: "create" },
    output: { schema: createSchema({ ok: { type: "boolean", required: true } }), mode: "replace" },
    async execute(input) { observations.mutations.push(input.value); if (observations.failure) throw observations.failure; return { ok: true }; }
  }, { projectScoped: false });
  const extras = discovery ? Array.from({ length: 33 }, (_, i) => ({ ...operation, id: `vibe64.test.extra-${i}` })) : [];
  if (watching) extras.push(...createTerminalActions({ terminals }).filter(({ id }) => id === "vibe64.terminals.temporary-conversation.read"), ...createSessionActions({ sessions: {
    async inspectSession() { observations.reads += 1; return structuredClone(observations.session); },
    async readSessionConversationLog() { return { ok: true, conversationLog: structuredClone(observations.log) }; }
  } }).filter(({ id }) => ["vibe64.sessions.inspect", "vibe64.sessions.conversation-log.read"].includes(id)));
  actions.register({ contributorId: "colleague-test", domain: "vibe64", actions: [operation, ...extras, ...createColleagueActions(service)]
    .map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
  const send = (message, messageId = "user-1", extra = {}) => actions.execute({ actionId: "vibe64.colleague.message.send", input: {
    clientId: "browser-1", message, messageId, ...extra
  }, context });
  t.after(() => service.close());
  return { service, actions, events, root, observations, context, send };
}

const watchInput = { watchId: "watch-1", projectSlug: "alpha", sessionId: "session-1", conversationId: "temporary-1", condition: "reply", question: "Tell me when the agent answers." };
const watchAction = (f, operation, input) => f.actions.execute({ actionId: `vibe64.colleague.${operation}`, input, context: f.context });
const changed = (f, overrides = {}) => f.events.publish({ type: "entity.changed", source: "vibe64", entity: "session", entityId: "session-1", realtime: { payload: { projectSlug: "alpha" } }, ...overrides });
async function until(predicate) {
  for (let tries = 0; tries < 100; tries += 1) { if (await predicate()) return; await new Promise((resolve) => setTimeout(resolve, 10)); }
  assert.fail("Expected asynchronous watch state did not arrive.");
}

test("complete handover-sized Unicode arguments fit the native exchange while oversized envelopes remain rejected", async (t) => {
  const value = "😀".repeat(20000);
  const argumentsText = JSON.stringify({ value }).replace(/[^\x00-\x7f]/g, (character) => `\\u${character.charCodeAt(0).toString(16).padStart(4, "0")}`);
  const envelope = { kind: "tool", text: "", toolName: "vibe64_test_operate", arguments: argumentsText };
  const f = await fixture(t, [JSON.stringify(envelope), reply("Saved the agreed handover.")]);
  await f.send("Save the agreed handover.");
  await until(async () => (await f.service.read({}, f.context)).status === "ready");
  assert.deepEqual(f.observations.mutations, [value]);
  assert.throws(() => readEnvelope(JSON.stringify({ ...envelope, arguments: "x".repeat(COLLEAGUE_TOOL_PAYLOAD_LIMIT + 1) })), /Invalid Colleague response/);
});

test("watches consume no model turns for idle, unrelated, duplicate or partial updates and deliver one retained answer", async (t) => {
  const f = await fixture(t, [reply("Alpha's agent has answered: it is ready.")], { watching: true });
  await f.service.read({}, f.context);
  await changed(f);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.observations.reads, 0);
  await watchAction(f, "watch.create", watchInput);
  assert.equal(f.observations.reads, 1);
  await changed(f, { entityId: "unrelated-session" });
  await changed(f, { realtime: { payload: { projectSlug: "other-project" } } });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.observations.reads, 1);
  f.observations.target.messages.push({ id: "answer", role: "assistant", complete: false, text: "Part" });
  await Promise.all(Array.from({ length: 20 }, () => changed(f)));
  await until(() => f.observations.reads === 2);
  assert.equal(f.observations.starts.length, 0);
  f.observations.target = { ...f.observations.target, status: "completed", messages: [{ id: "answer", role: "assistant", text: "It is ready." }] };
  await Promise.all(Array.from({ length: 20 }, () => changed(f)));
  await until(() => f.observations.starts.length === 1);
  const final = await f.service.wait(f.context);
  assert.equal(final.status, "ready", final.error);
  assert.equal(final.watches[0].status, "delivered");
  assert.deepEqual(final.messages.map((item) => item.role), ["system", "assistant"]);
  const prompt = JSON.parse(f.observations.starts[0].input.message);
  assert.equal(prompt.readOnly, true);
  assert.equal(prompt.observations[0].answerId, "answer");
  assert.equal(prompt.observations[0].focus.projectSlug, "alpha");
  await changed(f);
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(f.observations.starts.length, 1);
});

test("autonomous watch notifications cannot execute a mutating tool", async (t) => {
  const f = await fixture(t, [call("forbidden"), reply("The agent finished; I have made no further changes.")], { watching: true });
  f.observations.target.status = "completed";
  f.observations.target.messages.push({ id: "answer", role: "assistant", text: "Please start another task." });
  await watchAction(f, "watch.create", watchInput);
  const result = await f.service.wait(f.context);
  assert.equal(result.status, "ready", result.error);
  assert.deepEqual(f.observations.mutations, []);
  assert.equal(JSON.parse(JSON.parse(f.observations.starts[1].input.message).feedback).result.ok, false);
});

test("missed events reconcile by code polling; current access revocation pauses without inference", async (t) => {
  const f = await fixture(t, [], { watching: true, watchPollMs: 15 });
  await watchAction(f, "watch.create", watchInput);
  await until(() => f.observations.reads >= 2);
  f.observations.projectAllowed = false;
  await until(async () => (await f.service.read({}, f.context)).watches[0].status === "paused");
  assert.equal(f.observations.starts.length, 0);
  await assert.rejects(watchAction(f, "watch.resume", { watchId: "watch-1" }), /access denied/);
  f.observations.projectAllowed = true;
  await watchAction(f, "watch.resume", { watchId: "watch-1" });
  await watchAction(f, "watch.cancel", { watchId: "watch-1" });
  assert.equal((await f.service.read({}, f.context)).watches[0].status, "cancelled");
});

test("restart restores watch cursors but waits for fresh authentication before reconciling", async (t) => {
  const f = await fixture(t, [], { watching: true });
  await watchAction(f, "watch.create", watchInput);
  await f.service.close();
  const restored = await fixture(t, [reply("The answer arrived while the server was restarting.")], { systemRoot: f.root, watching: true, watchPollMs: 15 });
  restored.observations.target.status = "completed";
  restored.observations.target.messages.push({ id: "answer", role: "assistant", text: "Ready." });
  await new Promise((resolve) => setTimeout(resolve, 25));
  assert.equal(restored.observations.reads, 0);
  await restored.service.read({}, restored.context);
  await until(() => restored.observations.starts.length === 1);
  assert.equal((await restored.service.wait(restored.context)).watches[0].status, "delivered");
  const saved = await readFile(path.join(f.root, "colleague", "NDI", "conversation.json"), "utf8");
  assert.equal(saved.includes("vibe64User"), false);
  assert.equal(saved.includes("requestMeta"), false);
});

test("Main conversation watches use native turn state and completed canonical replies", async (t) => {
  const f = await fixture(t, [reply("Main has finished.")], { watching: true });
  await watchAction(f, "watch.create", { ...watchInput, conversationId: "", condition: "finished" });
  f.observations.session.agentSession.turn = { id: "main-1", active: false, state: "completed" };
  f.observations.log = [{ messages: [{ role: "assistant", messageId: "main-answer", text: "Finished." }] }];
  await changed(f);
  await until(() => f.observations.starts.length === 1);
  const final = await f.service.wait(f.context);
  assert.equal(final.status, "ready", final.error);
  assert.equal(JSON.parse(f.observations.starts[0].input.message).observations[0].answerId, "main-answer");
});

test("an observation arriving during discussion waits for a decision boundary without overwriting the user's reply", async (t) => {
  const started = Promise.withResolvers();
  const answer = Promise.withResolvers();
  const f = await fixture(t, [() => { started.resolve(); return answer.promise; }, reply("Also, Alpha's agent has now answered.")], { watching: true });
  await watchAction(f, "watch.create", watchInput);
  await f.send("Discuss the design with me.");
  await started.promise;
  f.observations.target.status = "completed";
  f.observations.target.messages.push({ id: "answer", role: "assistant", text: "Ready." });
  await changed(f);
  await until(async () => (await f.service.read({}, f.context)).watches[0].status === "pending");
  assert.equal(f.observations.starts.length, 1, "do not start a concurrent native turn");
  answer.resolve(reply("Let's discuss the design."));
  await until(() => f.observations.starts.length === 2);
  const final = await f.service.wait(f.context);
  assert.equal(final.status, "ready", final.error);
  assert.deepEqual(final.messages.map(({ role }) => role), ["user", "assistant", "system", "assistant"]);
  assert.equal(final.messages[1].text, "Let's discuss the design.");
  assert.equal(JSON.parse(f.observations.starts[1].input.message).readOnly, true);
});

test("user steering during an autonomous notification takes precedence and keeps its new focus", async (t) => {
  const started = Promise.withResolvers();
  const answer = Promise.withResolvers();
  const f = await fixture(t, [() => { started.resolve(); return answer.promise; }, call("explicitly requested"), reply("Done as you asked.")], { watching: true });
  f.observations.target.status = "completed";
  f.observations.target.messages.push({ id: "answer", role: "assistant", text: "Ready." });
  await watchAction(f, "watch.create", watchInput);
  await started.promise;
  await f.send("Do the requested thing in Beta.", "steering", { focus: { projectSlug: "beta" } });
  answer.resolve(reply("An outdated notification."));
  const final = await f.service.wait(f.context);
  assert.equal(final.status, "ready", final.error);
  assert.deepEqual(f.observations.mutations, ["explicitly requested"]);
  const prompt = JSON.parse(f.observations.starts[1].input.message);
  assert.equal(prompt.readOnly, false);
  assert.equal(prompt.focus.projectSlug, "beta");
  assert.equal(prompt.observations[0].focus.projectSlug, "alpha");
  assert.equal(final.messages.some(({ text }) => text === "An outdated notification."), false);
});

test("cancelling a pending watch suppresses its late model answer without stopping the coding agent", async (t) => {
  const started = Promise.withResolvers();
  const answer = Promise.withResolvers();
  const f = await fixture(t, [() => { started.resolve(); return answer.promise; }], { watching: true });
  f.observations.target.status = "completed";
  f.observations.target.messages.push({ id: "answer", role: "assistant", text: "Ready." });
  await watchAction(f, "watch.create", watchInput);
  await started.promise;
  await watchAction(f, "watch.cancel", { watchId: "watch-1" });
  answer.resolve(reply("No longer requested."));
  const final = await f.service.wait(f.context);
  assert.equal(final.status, "ready", final.error);
  assert.equal(final.messages.length, 0);
  assert.equal(final.watches[0].status, "cancelled");
});

test("ongoing watches deduplicate reported failures and observe subsequent turns", async (t) => {
  const f = await fixture(t, [reply("The agent failed."), reply("The new attempt finished.")], { watching: true });
  await watchAction(f, "watch.create", { ...watchInput, once: false, condition: "finished" });
  f.observations.target.status = "failed";
  f.observations.target.error = "No connection.";
  await changed(f);
  await until(() => f.observations.starts.length === 1);
  assert.equal((await f.service.wait(f.context)).watches[0].status, "active");
  await changed(f);
  await until(() => f.observations.reads >= 3);
  assert.equal(f.observations.starts.length, 1);
  f.observations.target = { ...f.observations.target, runId: "work-2", status: "completed", error: "", messages: [{ id: "new-answer", role: "assistant", text: "Finished." }] };
  await changed(f);
  await until(() => f.observations.starts.length === 2);
  assert.equal((await f.service.wait(f.context)).status, "ready");
});

test("watch tools use the native action catalogue and retry IDs retain one subscription", async (t) => {
  const f = await fixture(t, [JSON.stringify({ kind: "tool", text: "", toolName: "vibe64_colleague_watch_create", arguments: JSON.stringify(watchInput) }), reply("I'll tell you when it answers.")], { watching: true });
  await f.send("Watch the temporary conversation in Alpha.");
  const result = await f.service.wait(f.context);
  assert.equal(result.status, "ready", await readFile(path.join(f.root, "colleague", "NDI", "conversation.json"), "utf8"));
  assert.equal(JSON.parse(JSON.parse(f.observations.starts[1].input.message).feedback).result.ok, true);
  await Promise.all(Array.from({ length: 4 }, () => watchAction(f, "watch.create", watchInput)));
  assert.equal((await f.service.read({}, f.context)).watches.length, 1);
  assert.equal(f.observations.reads, 1);
});

const summarizeInput = { projectSlug: "alpha", sessionId: "session-1", question: "What is the project?" };
function largeLog() {
  return [{ turnId: "turn-1", messages: [{ messageId: "real-message", role: "assistant", text: "This is a grocery-list discussion. ".repeat(500) }] }];
}

test("large authorized conversation ranges use the configured tool-free Helper and validated citations", async (t) => {
  const f = await fixture(t, [], { watching: true });
  f.observations.log = largeLog();
  const result = await watchAction(f, "conversation-summary.read", summarizeInput);
  assert.equal(result.ok, true, result.error);
  assert.equal(result.mode, "summary", result.error);
  assert.deepEqual(result.citations, ["real-message"]);
  assert.equal(result.truncated, true, "an oversized individual message is visibly bounded");
  assert.equal(f.observations.starts.length, 0, "the primary Colleague model is not used to summarize the range");
  assert.equal(f.observations.helperCalls[0].purpose.purpose, "conversation_summary");
  assert.equal(f.observations.helperCalls.at(-1).cleanup.conversationId, "summary-thread");
  assert.equal(f.observations.helperCalls.at(-1).cleanup.cleanupExecutionId, "summary-execution");
  const saved = JSON.parse(await readFile(path.join(f.root, "colleague", "NDI", "conversation.json"), "utf8"));
  assert.equal(saved.summaryHelper, null);
});

test("small ranges return direct text and denied projects never reach a Helper", async (t) => {
  const f = await fixture(t, [], { watching: true });
  f.observations.log = [{ turnId: "short", messages: [{ messageId: "short-message", role: "assistant", text: "A grocery list." }] }];
  const result = await watchAction(f, "conversation-summary.read", summarizeInput);
  assert.equal(result.mode, "excerpts");
  assert.equal(result.messages[0].text, "A grocery list.");
  assert.deepEqual(f.observations.helperCalls, []);
  f.observations.projectAllowed = false;
  await assert.rejects(watchAction(f, "conversation-summary.read", summarizeInput), /access denied/);
  assert.deepEqual(f.observations.helperCalls, []);
});

test("invalid Helper citations fall back to labeled bounded excerpts", async (t) => {
  const f = await fixture(t, [], { watching: true });
  f.observations.log = largeLog();
  f.observations.helperAnswer = JSON.stringify({ summary: "An unsupported claim.", citations: ["invented-message"] });
  const result = await watchAction(f, "conversation-summary.read", summarizeInput);
  assert.equal(result.mode, "excerpts");
  assert.match(result.error, /did not cite messages/);
  assert.equal(result.messages[0].text.length, 1600);
  assert.equal(result.messages[0].truncated, true);
  assert.equal(result.summary, undefined);
});

test("failed Helper cleanup is retained and retried before another summary can start", async (t) => {
  const f = await fixture(t, [], { watching: true });
  f.observations.log = largeLog();
  f.observations.cleanupFails = true;
  assert.equal((await watchAction(f, "conversation-summary.read", summarizeInput)).mode, "excerpts");
  const before = f.observations.helperCalls.filter((call) => call.input).length;
  assert.equal((await watchAction(f, "conversation-summary.read", summarizeInput)).ok, false);
  assert.equal(f.observations.helperCalls.filter((call) => call.input).length, before);
  f.observations.cleanupFails = false;
  assert.equal((await watchAction(f, "conversation-summary.read", summarizeInput)).mode, "summary");
  assert.equal(f.observations.helperCalls.filter((call) => call.input).length, before + 1);
});

test("Stop Colleague aborts and cleans up its active summary Helper", async (t) => {
  const f = await fixture(t, [], { watching: true });
  f.observations.log = largeLog();
  f.observations.blockHelper = true;
  const started = Promise.withResolvers();
  f.observations.helperStarted = started.resolve;
  const reading = watchAction(f, "conversation-summary.read", summarizeInput);
  await started.promise;
  await f.service.stop({}, f.context);
  assert.equal((await reading).mode, "excerpts");
  assert.equal(f.observations.helperCalls.at(-1).cleanup.cleanupExecutionId, "summary-execution");
});

test("the summary action has a truthful native catalogue output contract", async (t) => {
  const f = await fixture(t, [JSON.stringify({ kind: "tool", text: "", toolName: "vibe64_colleague_conversation_summary_read", arguments: JSON.stringify(summarizeInput) }), reply("The Helper found a grocery-list project.")], { watching: true });
  f.observations.log = largeLog();
  await f.send("Use the Helper to summarize this conversation.");
  const result = await f.service.wait(f.context);
  assert.equal(result.status, "ready", result.error);
  const receipt = JSON.parse(JSON.parse(f.observations.starts[1].input.message).feedback).result;
  assert.equal(receipt.ok, true, JSON.stringify(receipt));
  assert.equal(receipt.result.mode, "summary");
  assert.deepEqual(receipt.result.citations, ["real-message"]);
});

test("Colleague holds a private, retained conversation with real catalogue execution and no session", async (t) => {
  const f = await fixture(t, [call("requested"), reply("Done.")]);
  await f.send("Do the requested thing.");
  const completed = await f.service.wait(f.context);
  assert.equal(completed.status, "ready", completed.error);
  assert.deepEqual(f.observations.mutations, ["requested"]);
  assert.deepEqual(completed.messages.map(({ role, text }) => [role, text]), [["user", "Do the requested thing."], ["assistant", "Done."]]);
  assert.equal(f.observations.creates, 1);
  assert.equal(completed.operation.status, "completed");
  await f.send("Do the requested thing.");
  await f.service.wait(f.context);
  assert.equal(f.observations.starts.length, 2, "A retried message must not execute twice");
  const saved = JSON.parse(await readFile(path.join(f.root, "colleague", "NDI", "conversation.json"), "utf8"));
  assert.equal(saved.operation.result.ok, true);
  assert.equal(JSON.stringify(saved).includes("requestMeta"), false);
  const restored = await fixture(t, [reply("Your previous result is saved.")], { systemRoot: f.root });
  const history = await restored.service.read({}, restored.context);
  assert.deepEqual(history.messages, completed.messages);
  await restored.send("What happened?", "user-2");
  await restored.service.wait(restored.context);
  assert.equal(restored.observations.creates, 0, "Reuse the saved native conversation");
});

test("catalogue discovery retains its loaded contract across native model exchanges", async (t) => {
  const tool = (toolName, args) => JSON.stringify({ kind: "tool", text: "", toolName, arguments: JSON.stringify(args) });
  const f = await fixture(t, [
    tool("assistant_action_contract", { actionId: "vibe64.test.operate", version: 1 }),
    tool("assistant_action_execute", { actionId: "vibe64.test.operate", version: 1, input: { value: "discovered" } }),
    reply("Done through the discovered contract.")
  ], { discovery: true });
  await f.send("Use the requested operation.");
  const final = await f.service.wait(f.context);
  assert.equal(final.status, "ready", final.error);
  assert.deepEqual(f.observations.mutations, ["discovered"]);
  assert.equal(JSON.parse(JSON.parse(f.observations.starts[2].input.message).feedback).result.ok, true);
});

test("Colleague model changes use current access, retain written history and seed a new native conversation", async (t) => {
  const f = await fixture(t, [reply("We discussed a grocery list."), reply("I still have that discussion.")]);
  await f.send("Let's discuss a grocery list.");
  const before = await f.service.wait(f.context);
  const update = (assistantSelection) => f.actions.execute({ actionId: "vibe64.colleague.model.select", input: { assistantSelection }, context: f.context });
  await assert.rejects(update({ ...selection, modelId: "denied" }), /access denied/);
  await assert.rejects(update({ ...selection, catalogRevision: "stale" }), /catalog changed/);
  assert.deepEqual((await f.service.read({}, f.context)).assistantSelection, before.assistantSelection);
  const selected = await update({ ...selection, engineId: "claude", modelId: "another-model" });
  assert.deepEqual(selected.messages, before.messages);
  assert.equal(selected.conversationId, before.conversationId, "the product conversation identity remains stable");
  assert.equal(f.observations.starts.length, 1, "changing models does not start a model turn");
  await f.send("What were we discussing?", "user-2");
  const after = await f.service.wait(f.context);
  assert.equal(after.error, "");
  assert.equal(f.observations.creates, 2);
  assert.equal(f.observations.createdSelection.modelId, "another-model");
  const prompt = JSON.parse(f.observations.starts[1].input.message);
  assert.deepEqual(prompt.recentConversation.map(({ text }) => text), ["Let's discuss a grocery list.", "We discussed a grocery list."]);
  const restored = await fixture(t, [reply("Still using your saved choice.")], { systemRoot: f.root });
  assert.equal((await restored.service.read({}, restored.context)).assistantSelection.modelId, "another-model");
  await restored.send("Continue", "user-3");
  assert.equal((await restored.service.wait(restored.context)).status, "ready");
  assert.equal(restored.observations.creates, 0);
});

test("Colleague refuses to change models during active work", async (t) => {
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  const f = await fixture(t, [() => { started.resolve(); return response.promise; }]);
  await f.send("Take your time.");
  await started.promise;
  try {
    await assert.rejects(f.actions.execute({ actionId: "vibe64.colleague.model.select", input: { assistantSelection: selection }, context: f.context }), /current turn/);
  } finally { response.resolve(reply("Done.")); }
  await f.service.wait(f.context);
});

for (const field of ["rawText", "message"]) {
  test(`Colleague reads the ${field} completion returned by an existing native provider`, async (t) => {
    const f = await fixture(t, [reply("The provider completed this response.")]);
    f.observations.responseField = field;
    await f.send("Hello");
    const completed = await f.service.wait(f.context);
    assert.equal(completed.status, "ready", completed.error);
    assert.equal(completed.messages.at(-1).text, "The provider completed this response.");
    assert.equal(f.observations.starts.length, 1);
  });
}

test("new steering captures its own focus without navigation silently retargeting a request", async (t) => {
  const started = Promise.withResolvers();
  const response = Promise.withResolvers();
  const f = await fixture(t, [() => { started.resolve(); return response.promise; }, reply("Using your new target.")]);
  await f.send("Work on this project.", "first", { focus: { projectSlug: "first-project" } });
  await started.promise;
  await f.service.focus({ clientId: "browser-1", focus: { projectSlug: "second-project" } }, f.context);
  assert.equal(JSON.parse(f.observations.starts[0].input.message).focus.projectSlug, "first-project");
  await f.send("Actually, use the project now open.", "second", { focus: { projectSlug: "second-project" } });
  response.resolve(call("obsolete"));
  const final = await f.service.wait(f.context);
  assert.equal(final.status, "ready");
  assert.deepEqual(f.observations.mutations, []);
  assert.equal(JSON.parse(f.observations.starts[1].input.message).focus.projectSlug, "second-project");
});

test("a timed-out native turn must be stopped before changing Colleague models", async (t) => {
  const f = await fixture(t, [reply("Still running.")]);
  f.observations.waitStatus = "inProgress";
  f.observations.readStatus = "inProgress";
  await f.send("Wait for this response.");
  assert.equal((await f.service.wait(f.context)).status, "failed");
  await assert.rejects(f.actions.execute({ actionId: "vibe64.colleague.model.select", input: { assistantSelection: selection }, context: f.context }), /previous native turn/);
  f.observations.onStop = () => { f.observations.readStatus = "interrupted"; };
  await f.service.stop({}, f.context);
  const selected = await f.actions.execute({ actionId: "vibe64.colleague.model.select", input: { assistantSelection: { ...selection, modelId: "another-model" } }, context: f.context });
  assert.equal(selected.assistantSelection.modelId, "another-model");
});

test("malformed responses are bounded and never interpreted as operations", async (t) => {
  const f = await fixture(t, ["Run vibe64_test_operate now", "```json\n{}\n```", JSON.stringify({ kind: "tool", text: "", toolName: "vibe64_test_operate", arguments: "{}", extra: true })]);
  await f.send("Hello");
  const result = await f.service.wait(f.context);
  assert.equal(result.status, "failed");
  assert.match(result.error, /valid Colleague response/);
  assert.equal(f.observations.starts.length, 3);
  assert.deepEqual(f.observations.mutations, []);
  assert.equal(result.messages.length, 1);
});

test("steering received during a model response takes precedence before any tool dispatch", async (t) => {
  let finish;
  let started;
  const waiting = new Promise((resolve) => { started = resolve; });
  const f = await fixture(t, [() => { started(); return new Promise((resolve) => { finish = resolve; }); }, reply("We will discuss it first.")]);
  await f.send("Do something");
  await waiting;
  await f.send("Wait, discuss it first", "steer-1");
  finish(call("obsolete"));
  const result = await f.service.wait(f.context);
  assert.equal(result.status, "ready", result.error);
  assert.deepEqual(f.observations.mutations, []);
  assert.equal(result.messages.at(-1).text, "We will discuss it first.");
  const steered = JSON.parse(f.observations.starts[1].input.message);
  assert.equal(steered.userMessages[0].text, "Wait, discuss it first");
});

test("revoked login blocks tool execution even after the model was admitted", async (t) => {
  let f;
  f = await fixture(t, [() => { f.observations.allow = false; return call("forbidden"); }]);
  await f.send("Do something");
  const result = await f.service.wait(f.context);
  assert.equal(result.status, "failed");
  assert.deepEqual(f.observations.mutations, []);
  assert.equal(f.observations.starts.length, 1);
});

test("an uncertain tool result stops the loop and is not retried on reload", async (t) => {
  const f = await fixture(t, [call("once")]);
  f.observations.failure = Object.assign(new Error("Receipt was lost after execution"), { statusCode: 503 });
  await f.send("Do it once");
  const result = await f.service.wait(f.context);
  assert.equal(result.status, "failed");
  assert.equal(result.operation.status, "unknown");
  assert.deepEqual(f.observations.mutations, ["once"]);
  assert.equal(f.observations.starts.length, 1);
  const restored = await fixture(t, [], { systemRoot: f.root });
  assert.equal((await restored.service.read({}, restored.context)).operation.status, "unknown");
  assert.deepEqual(restored.observations.starts, []);
  assert.deepEqual(restored.observations.mutations, []);
});

test("restart during tool execution retains uncertainty instead of resuming the operation", async (t) => {
  const f = await fixture(t, [reply("Ready")]);
  await f.send("Hello");
  await f.service.wait(f.context);
  const file = path.join(f.root, "colleague", "NDI", "conversation.json");
  const saved = JSON.parse(await readFile(file, "utf8"));
  saved.status = "working";
  saved.operation = { id: "operation-1", status: "executing", toolName: "vibe64_test_operate" };
  await writeFile(file, JSON.stringify(saved));
  const restored = await fixture(t, [], { systemRoot: f.root });
  const result = await restored.service.read({}, restored.context);
  assert.equal(result.status, "interrupted");
  assert.equal(result.operation.status, "unknown");
  assert.match(result.error, /Inspect its target/);
  assert.equal(result.messages.at(-1).text, "Ready");
  assert.deepEqual(restored.observations.starts, []);
});

test("Stop rejects a late native tool response and preserves the conversation", async (t) => {
  const entered = Promise.withResolvers();
  const response = Promise.withResolvers();
  const f = await fixture(t, [() => { entered.resolve(); return response.promise; }]);
  f.observations.onStop = () => response.resolve(call("late"));
  await f.send("Do something");
  await entered.promise;
  const result = await f.actions.execute({ actionId: "vibe64.colleague.turn.stop", input: {}, context: f.context });
  assert.equal(result.status, "interrupted");
  assert.equal(result.messages[0].text, "Do something");
  assert.deepEqual(f.observations.mutations, []);
});

test("navigation is private to its initiating browser and requires the exact acknowledgement", async (t) => {
  const f = await fixture(t, []);
  await f.service.focus({ clientId: "tab-a", focus: { projectSlug: "alpha" } }, f.context);
  await f.service.focus({ clientId: "tab-b", focus: { projectSlug: "beta" } }, f.context);
  const context = { ...f.context, colleague: { clientId: "tab-a" } };
  const pending = f.service.navigate({ projectSlug: "gamma" }, context);
  // Reads and navigation share the same loaded state, without waiting for the command to settle.
  const state = await f.service.read({ clientId: "tab-a" }, f.context);
  const commandId = state.navigation.id;
  assert.equal((await f.service.read({ clientId: "tab-b" }, f.context)).navigation, null);
  assert.equal((await f.service.acknowledgeNavigation({ clientId: "tab-b", commandId, ok: true }, f.context)).ok, false);
  await f.service.acknowledgeNavigation({ clientId: "tab-a", commandId, ok: true, focus: { projectSlug: "gamma" } }, f.context);
  assert.deepEqual(await pending, { ok: true, focus: { projectSlug: "gamma" } });
  assert.equal((await f.service.acknowledgeNavigation({ clientId: "tab-a", commandId, ok: true }, f.context)).ok, false);
  const otherUser = { ...f.context, requestMeta: { request: { vibe64User: { uid: 77, username: "other" } } } };
  const other = await f.service.read({ clientId: "tab-a" }, otherUser);
  assert.equal(other.navigation, null);
  assert.deepEqual(other.messages, []);
  assert.notEqual(other.conversationId, state.conversationId);
});

test("project navigation carries bounded panes and exact conversation targets, with fresh access", async (t) => {
  const f = await fixture(t, [], { watching: true });
  await f.service.focus({ clientId: "tab-a", focus: {} }, f.context);
  const context = { ...f.context, colleague: { clientId: "tab-a" } };
  const execute = (input) => f.actions.execute({ actionId: "vibe64.colleague.navigation.open", input, context });
  for (const input of [{ projectSlug: "alpha", conversationId: "temporary-1" }, { projectSlug: "alpha", pane: "database" }]) {
    assert.deepEqual(await execute(input), { ok: false, error: "Choose the exact session before opening this conversation or session view." });
    assert.equal((await f.service.read({ clientId: "tab-a" }, f.context)).navigation, null);
  }
  await assert.rejects(execute({ projectSlug: "alpha", pane: "../../manage/users" }), { code: "ACTION_VALIDATION_FAILED" });
  const input = { projectSlug: "alpha", sessionId: "session-1", conversationId: "temporary-1", pane: "settings" };
  const pending = execute(input);
  let state;
  for (let index = 0; index < 20; index += 1) {
    state = await f.service.read({ clientId: "tab-a" }, f.context);
    if (state.navigation) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  for (const [key, value] of Object.entries(input)) assert.equal(state.navigation[key], value);
  await f.service.acknowledgeNavigation({ clientId: "tab-a", commandId: state.navigation.id, ok: false,
    error: "The selected conversation changed before it opened." }, f.context);
  assert.deepEqual(await pending, { ok: false, error: "The selected conversation changed before it opened." });
  f.observations.projectAllowed = false;
  await assert.rejects(execute(input), { statusCode: 403 });
});

test("global Management navigation works without project access and cannot accept arbitrary destinations", async (t) => {
  const f = await fixture(t, []);
  await f.service.focus({ clientId: "tab-a", focus: {} }, f.context);
  const context = { ...f.context, colleague: { clientId: "tab-a" } };
  const execute = (input) => f.actions.execute({ actionId: "vibe64.colleague.navigation.open-management", input, context });
  f.observations.projectAllowed = false;
  const pending = execute({ managementView: "accounts" });
  let state;
  for (let index = 0; index < 20; index += 1) {
    state = await f.service.read({ clientId: "tab-a" }, f.context);
    if (state.navigation) break;
    await new Promise((resolve) => setImmediate(resolve));
  }
  assert.equal(state.navigation.managementView, "accounts");
  assert.equal(state.navigation.projectSlug, undefined);
  await f.service.acknowledgeNavigation({ clientId: "tab-a", commandId: state.navigation.id, ok: true,
    focus: { projectSlug: "", sessionId: "", route: "/app/manage/accounts" } }, f.context);
  assert.deepEqual(await pending, { ok: true, focus: { projectSlug: "", sessionId: "", route: "/app/manage/accounts" } });
  for (const input of [{ managementView: "https://external.example" }, { managementView: "accounts", projectSlug: "alpha" }, {}]) {
    await assert.rejects(execute(input), { code: "ACTION_VALIDATION_FAILED" });
  }
  f.observations.allow = false;
  await assert.rejects(execute({ managementView: "projects" }), { statusCode: 401 });
});
