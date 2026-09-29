import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { withRouteProject } from "./vibe64RouteTestHelpers.js";

test("the native JSKIT catalogue exposes bounded conversation contracts without internal state", async () => {
  const calls = [];
  const native = {
    ok: true, conversationId: "chat-1", status: "inProgress", runId: "run-1",
    providerConversationId: "private-native-id", nativeBindings: { secret: "private-binding" },
    messages: Array.from({ length: 25 }, (_, index) => ({ id: `message-${index}`, role: "assistant", text: "x".repeat(8000), privateField: "private-value" }))
  };
  const terminals = {
    async updateTemporaryConversation(sessionId, input) { calls.push({ sessionId, input }); return { ok: true,
      routingMetadata: { assistant_routing: JSON.stringify({ ...input.assistantRouting, workflowEngineId: "codex", review: false }),
        private: "private-native-binding" } }; },
    async readSessionWorkPlan() { return { ok: true, available: true, text: "  Full page 🙂\n", status: "ready", revision: "a".repeat(64),
      offset: 0, nextOffset: 14, totalCharacters: 16020, hasMore: true, path: "/private/plan.md", token: "secret" }; },
    async readTemporaryConversation(...args) { calls.push(args); return native; },
    async listTemporaryConversations() { return { ok: true, conversations: Array(60).fill(native) }; },
    async stopTemporaryConversation() { return { ok: false, code: "vibe64_busy", error: "The conversation is closing." }; }
  };
  const sessions = {
    async rewindConversation(sessionId, input) { calls.push({ sessionId, input }); return { ok: true, text: `  ${"🙂".repeat(8000)}\n`, nativeCheckpoint: "private-checkpoint" }; },
    async updateAssistantSelection(sessionId, input) { calls.push({ sessionId, input }); return { ok: true, sessionId, assistantSelection: { engineId: "codex", modelId: "previous-model" }, metadata: {
      assistant_routing: JSON.stringify({ ...input.assistantRouting, workflowEngineId: "codex" }),
      assistant_routing_request: JSON.stringify({ status: "completed", resolvedMode: "senior" })
    } }; },
    async inspectAssistantAccess() { return { ok: true, currentMode: "junior", canUse: true, purposes: {
      junior: { available: true, role: "junior", workflowEngineId: "codex", backupUsed: true, message: "Using Backup.",
        effectiveSelection: { engineId: "codex", modelProviderId: "openai", modelId: "observed-model", variantId: "high", agentId: "codex", catalogRevision: "sha256:observed" },
        connectionIdentity: { private: "private-account" }, executionProfileRequest: { private: "private-workload" } },
      auto: { available: false, reasonCode: "missing-router", message: "Configure Router first." },
      unrelated: { available: true, private: "private-unrelated" }
    } }; },
    async sendAgentMessage(sessionId, input) { calls.push({ sessionId, input }); return { ok: true, sessionId, messageId: input.messageId, delivered: true, deliveryMode: "steer", turn: { id: "turn-1", state: "inProgress", active: true }, assistantRoutingRequest: { status: "sent", resolvedMode: "junior", input: { privateValue: "secret" } } }; },
    async interruptAgentTurn() { return { ok: true, interrupted: true, routingCancelled: true }; },
    async readSessionConversationLog() { return { ok: true, rewind: { turnId: "000010", pending: false, text: "private-full-prompt" }, conversationLog: Array.from({ length: 10 }, (_, i) => ({ turnId: `turn-${i}`, user: { text: `Question ${i}` }, assistant: { text: "a".repeat(6000) }, privateBinding: "secret" })), pagination: { hasMoreBefore: true } }; },
    async inspectSession() { return { ok: true, sessionId: "session-1", status: "active", agentSession: { turn: { state: "inProgress", active: true, phase: "thinking", id: "turn-1" } }, metadata: { assistant_routing_request: JSON.stringify({ status: "planning", task: "planning", assignments: { secret: "private-model-binding" } }) } }; },
    async listSessions() { return { ok: true, sessions: [{ sessionId: "session-1", sessionName: "Planning", status: "active", sourcePath: "/private/repository", metadata: { token: "private-token" } }] }; },
    async createSession(input) { calls.push(input); return { ok: true, sessionId: "created-session", workspaceSetup: { status: "running" }, sourcePath: "/private/source" }; }
  };
  const actions = createActionCatalogue();
  actions.register({ contributorId: "conversation-tools", domain: "vibe64", actions: [
    ...createSessionActions({ sessions }), ...createTerminalActions({ terminals })
  ].map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
  const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
  const context = { surface: "app" };
  const toolSet = catalog.resolveToolSet(context);
  assert.equal(toolSet.tools.length, 37);
  assert.equal(toolSet.tools.some((tool) => tool.actionId.includes("attachment") || tool.actionId.includes("repository")), false);
  async function execute(actionId, input) {
    const tool = toolSet.tools.find((entry) => entry.actionId === actionId);
    assert.ok(tool, actionId);
    const wireSchema = catalog.toOpenAiToolSchema(tool);
    assert.ok(wireSchema.function.parameters.properties.projectSlug);
    assert.equal(Object.hasOwn(wireSchema.function.parameters.properties, "vibe64User"), false);
    return runWithProjectRequestContext({ slug: "alpha", vibe64User: { username: "member" } }, () => catalog.executeToolCall({
      toolName: tool.name, argumentsText: JSON.stringify({ projectSlug: "alpha", ...input }), context, toolSet
    }));
  }
  const read = await execute("vibe64.terminals.temporary-conversation.read", { sessionId: "session-1", conversationId: "chat-1" });
  assert.equal(read.ok, true, JSON.stringify(read));
  const inspected = await execute("vibe64.sessions.inspect", { sessionId: "session-1" });
  assert.equal(inspected.result.agentStatus, "inProgress");
  assert.equal(inspected.result.turnActive, true);
  assert.equal(inspected.result.agentPhase, "thinking");
  assert.equal(inspected.result.routingStatus, "planning");
  assert.equal(inspected.result.routingMode, "planning");
  assert.equal(JSON.stringify(inspected).includes("private-model-binding"), false);
  const main = await execute("vibe64.sessions.conversation-log.read", { sessionId: "session-1", limit: "10" });
  assert.equal(main.ok, true, JSON.stringify(main));
  assert.equal(main.result.turns.length, 6);
  assert.equal(main.result.nextBeforeTurnId, "turn-4");
  assert.equal(main.result.hasMoreBefore, true);
  assert.equal(main.result.turns[0].assistant.length, 4000);
  assert.equal(main.result.turns[0].truncated, true);
  assert.equal(JSON.stringify(main).includes("secret"), false);
  assert.equal(main.result.rewindTurnId, "000010");
  assert.equal(main.result.rewindPending, false);
  assert.equal(JSON.stringify(main).includes("private-full-prompt"), false);
  const undone = await execute("vibe64.sessions.conversation.rewind", { sessionId: "session-1", turnId: "000010" });
  assert.equal(undone.ok, true, JSON.stringify(undone));
  assert.equal(undone.result.restoredText, `  ${"🙂".repeat(7998)}`);
  assert.equal(undone.result.truncated, true);
  assert.equal(JSON.stringify(undone).includes("private-checkpoint"), false);
  assert.equal(calls.at(-1).input.vibe64User.username, "member");
  const rewindCallCount = calls.length;
  for (const input of [{}, { sessionId: "", turnId: "000010" }, { sessionId: "session-1", turnId: "latest" }]) {
    assert.equal((await execute("vibe64.sessions.conversation.rewind", input)).ok, false);
  }
  assert.equal(calls.length, rewindCallCount);
  assert.equal(read.result.status, "inProgress");
  assert.equal(read.result.messages.length, 12);
  assert.equal(read.result.messages[0].id, "message-13");
  assert.equal(read.result.messages[0].text.length, 1600);
  assert.equal(read.result.messagesTruncated, true);
  assert.equal(read.result.messages[0].truncated, true);
  assert.equal(JSON.stringify(read).includes("private-"), false);
  assert.equal(calls[0][1].vibe64User.username, "member");
  const list = await execute("vibe64.terminals.temporary-conversation.list", { sessionId: "session-1" });
  assert.equal(list.ok, true, JSON.stringify(list));
  assert.equal(list.result.conversations.length, 40);
  assert.equal(list.result.conversationsTruncated, true);
  assert.deepEqual(list.result.conversations[0].messages, []);
  const listedSessions = await execute("vibe64.sessions.list", {});
  assert.deepEqual(listedSessions.result.sessions, [{ sessionId: "session-1", sessionName: "Planning", status: "active" }]);
  assert.equal(JSON.stringify(listedSessions).includes("private-"), false);
  const failed = await execute("vibe64.terminals.temporary-conversation.stop", { sessionId: "session-1", conversationId: "chat-1" });
  assert.equal(failed.ok, true);
  assert.equal(failed.result.ok, false);
  assert.equal(failed.result.code, "vibe64_busy");
  const beforeInvalidRead = calls.length;
  const invalid = await execute("vibe64.terminals.temporary-conversation.read", { sessionId: "session-1", conversationId: "chat-1", messageLimit: 200 });
  assert.equal(invalid.ok, false);
  assert.equal(calls.length, beforeInvalidRead);
  const created = await execute("vibe64.sessions.create", { workflowEngineId: "codex" });
  assert.deepEqual(created.result, { ok: true, sessionId: "created-session", workspaceSetupStatus: "running" });
  assert.equal(calls.at(-1).vibe64User.username, "member");
  const sent = await execute("vibe64.sessions.agent-message.send", { sessionId: "session-1", message: "Please consider this correction.", messageId: "steer-1", submissionKind: "steer" });
  assert.equal(sent.ok, true, JSON.stringify(sent));
  assert.equal(sent.result.delivered, true);
  assert.equal(sent.result.turnActive, true);
  assert.equal(sent.result.routingMode, "junior");
  assert.equal(JSON.stringify(sent).includes("secret"), false);
  const before = calls.length;
  assert.equal((await execute("vibe64.sessions.agent-message.send", { sessionId: "session-1" })).ok, false);
  assert.equal(calls.length, before, "required message validation runs before the service");
  const stopped = await execute("vibe64.sessions.agent-turn.interrupt", { sessionId: "session-1" });
  assert.deepEqual(stopped.result, { ok: true, interrupted: true, routingCancelled: true });
  const changed = await execute("vibe64.sessions.assistant-selection.update", { sessionId: "session-1", assistantRouting: { mode: "junior", review: true } });
  assert.equal(changed.ok, true, JSON.stringify(changed));
  assert.equal(changed.result.chatMode, "junior");
  assert.equal(changed.result.routingMode, "senior", "saved preferences must remain separate from the previous request's mode");
  assert.equal(changed.result.reviewEnabled, false, "direct Junior does not schedule Senior review");
  assert.equal(changed.result.deslopEnabled, false);
  const auto = await execute("vibe64.sessions.assistant-selection.update", { sessionId: "session-1", assistantRouting: { mode: "auto", review: false } });
  assert.equal(auto.result.reviewEnabled, true, "Auto always reviews even with cleanup off");
  assert.equal(auto.result.deslopEnabled, false);
  assert.equal(changed.result.workflowEngineId, "codex");
  assert.equal(changed.result.hasModelOverride, false);
  assert.equal(changed.result.modelId, "previous-model", "changing mode does not claim that the active model changed");
  const access = await execute("vibe64.sessions.assistant-access.inspect", { sessionId: "session-1" });
  assert.equal(access.ok, true, JSON.stringify(access));
  assert.equal(access.result.canUse, true);
  assert.equal(access.result.purposes.length, 2);
  assert.equal(access.result.purposes[0].modelId, "observed-model");
  assert.equal(access.result.purposes[0].backupUsed, true);
  assert.equal(access.result.purposes[1].available, false);
  assert.equal(access.result.purposes[1].reasonCode, "missing-router");
  assert.equal(JSON.stringify(access).includes("private"), false);
  const plan = await execute("vibe64.terminals.work-plan.read", { sessionId: "session-1", limit: 16000 });
  assert.equal(plan.ok, true, JSON.stringify(plan));
  assert.equal(plan.result.text, "  Full page 🙂\n", "plan whitespace must be preserved");
  assert.equal(plan.result.hasMore, true);
  assert.equal(JSON.stringify(plan).includes("private"), false);
  assert.equal(JSON.stringify(plan).includes("secret"), false);
  assert.equal((await execute("vibe64.terminals.work-plan.read", { sessionId: "session-1", limit: 16001 })).ok, false);
  assert.equal((await execute("vibe64.terminals.work-plan.read", {})).ok, false);
  const temporaryMode = await execute("vibe64.terminals.temporary-conversation.update", {
    sessionId: "session-1", conversationId: "chat-1", assistantRouting: { mode: "junior", review: true }
  });
  assert.equal(temporaryMode.ok, true, JSON.stringify(temporaryMode));
  assert.equal(temporaryMode.result.chatMode, "junior");
  assert.equal(temporaryMode.result.workflowEngineId, "codex");
  assert.equal(temporaryMode.result.reviewEnabled, false, "the output reports stored preferences rather than echoing the request");
  assert.equal(temporaryMode.result.hasModelOverride, false);
  assert.equal(JSON.stringify(temporaryMode).includes("private"), false);
  const count = calls.length;
  for (const assistantRouting of [{}, { mode: "auto" }, { mode: "invented" }]) {
    assert.equal((await execute("vibe64.terminals.temporary-conversation.update", {
      sessionId: "session-1", conversationId: "chat-1", assistantRouting
    })).ok, false);
  }
  assert.equal(calls.length, count);
  const temporaryTool = toolSet.tools.find(({ actionId }) => actionId === "vibe64.terminals.temporary-conversation.update");
  const temporarySchema = catalog.toOpenAiToolSchema(temporaryTool).function.parameters;
  const routingSchema = temporarySchema.definitions[temporarySchema.properties.assistantRouting.allOf[0].$ref.split("/").at(-1)];
  assert.deepEqual(routingSchema.properties.mode.enum, ["custom", "senior", "junior"]);
});

test("session lifecycle tools preserve canonical execution, bounded results and current authority", async () => {
  await withRouteProject(async ({ projectContext, slug }) => {
    let user = { username: "member", uid: 42, role: "member" };
    let allowed = true;
    const calls = [];
    const cases = [
      ["rename", "renameSession", { name: "Reviewed label" }, { sessionName: "Reviewed label" }],
      ["archive", "archiveSession", {}, { status: "archived" }],
      ["workspace-setup.retry", "retryWorkspaceSetup", {}, { workspaceSetup: { status: "running" } }],
      ["assistant-selection.update", "updateAssistantSelection", { assistantRouting: { mode: "senior", review: false } }, {}]
    ];
    const sessions = Object.fromEntries(cases.map(([, method, , result]) => [method, async (sessionId, input) => {
      calls.push({ sessionId, input });
      return { ok: true, sessionId, ...result, metadata: { credential: "private" }, sourcePath: "/private/repository", log: "x".repeat(20000) };
    }]));
    const actions = createActionCatalogue();
    actions.register({ contributorId: "sessions", domain: "vibe64", actions: createSessionActions({ sessions }).map((action) => ({
      channels: ["api", "automation"], surfaces: ["app"], ...action
    })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => user,
      authorizeProject() { if (!allowed) throw Object.assign(new Error("Project access revoked."), { statusCode: 403 }); }
    });
    const catalog = createServiceToolCatalog(actions);
    const context = { surface: "app", channel: "automation" };
    const toolSet = catalog.resolveToolSet(context);
    for (const [suffix, , fields] of cases) {
      const actionId = `vibe64.sessions.${suffix}`;
      const tool = toolSet.tools.find((entry) => entry.actionId === actionId);
      assert.ok(tool, actionId);
      const input = { projectSlug: slug, sessionId: "session-1", ...fields };
      const direct = await actions.execute({ actionId, input, context });
      const execute = (extra = {}) => catalog.executeToolCall({ toolName: tool.name, argumentsText: JSON.stringify({ ...input, ...extra }), context, toolSet });
      const result = await execute();
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.equal(result.result.ok, true);
      assert.equal(result.result.sessionId, direct.sessionId);
      assert.equal(JSON.stringify(result).includes("private"), false);
      assert.ok(JSON.stringify(result).length < 400);
      if (suffix === "rename") assert.equal(result.result.sessionName, direct.sessionName);
      if (suffix === "archive") assert.equal(result.result.status, "archived");
      if (suffix === "workspace-setup.retry") assert.equal(result.result.workspaceSetupStatus, "running");
      assert.deepEqual(calls.at(-1), calls.at(-2), "tool and direct action must reach the same service inputs");
      assert.equal(calls.at(-1).sessionId, "session-1");
      assert.deepEqual(calls.at(-1).input.vibe64User, user);
      const admitted = calls.length;
      assert.equal((await execute({ sessionId: undefined })).ok, false, "the canonical action must require an exact session ID");
      assert.equal((await execute({ sessionId: "  " })).ok, false, "an empty session ID cannot select a default session");
      assert.ok(catalog.toOpenAiToolSchema(tool).function.parameters.required.includes("sessionId"));
      if (suffix === "assistant-selection.update") {
        const schema = catalog.toOpenAiToolSchema(tool).function.parameters;
        const routing = schema.definitions[schema.properties.assistantRouting.allOf[0].$ref.split("/").at(-1)];
        const selection = schema.definitions[schema.properties.assistantSelection.allOf[0].$ref.split("/").at(-1)];
        assert.deepEqual(routing.properties.mode.enum, ["custom", "senior", "junior", "auto"]);
        assert.ok(routing.required.includes("mode"));
        assert.ok(selection.properties.modelId);
        assert.equal((await execute({ assistantRouting: {} })).ok, false);
        assert.equal((await execute({ assistantRouting: { mode: "invented" } })).ok, false);
      }
      assert.equal((await execute({ vibe64User: { username: "owner", role: "owner" } })).ok, false);
      allowed = false;
      assert.equal((await execute()).ok, false);
      allowed = true;
      const actor = user;
      user = null;
      assert.equal((await execute()).ok, false);
      user = actor;
      assert.equal(calls.length, admitted, "invalid or revoked requests must not reach the service");
    }
  });
});
