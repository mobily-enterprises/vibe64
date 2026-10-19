import { assistantGoalManagementMessage } from "@local/vibe64-runtime/shared/assistantRouting";
import { prepareSessionDetachedConversationRun, prepareSessionDetachedConversationCleanup, createSessionConversationBinding, prepareSessionConversationActivity, prepareSessionConversationRenewal, prepareSessionConversationCreation, prepareSessionConversationReadiness, prepareSessionConversationSettings, prepareSessionConversationDisposal, prepareProjectConversationCleanup, prepareConversationRuntimeInvalidation, prepareConversationReconciliation } from "../../packages/vibe64-terminals/src/server/mainConversationBinding.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeCodeArguments, createClaudeCodeProcess } from "../../packages/vibe64-terminals/src/server/claudeCodeProcess.js";
import { claudeHistoryPath, readClaudeHistory } from "@jskit-ai/assistant-core/server/claude-history";
import { claudeCapabilities, createClaudeConversationHost as createNativeClaudeSessionAgentProvider, nativeMessageId } from "../../packages/vibe64-terminals/src/server/agent/providers/claudeConversationHost.js";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { sessionRenewalManualHandoverTemplate, sessionRenewalHandoverHash } from "../../packages/vibe64-terminals/src/server/sessionRenewalHandover.js";
import { readClaudeCodeAuthStatus } from "../../packages/studio-terminal-core/src/server/claudeRuntime.js";
import { defineVibe64AssistantCapabilities, defineVibe64AssistantSelection } from "../../packages/vibe64-runtime/src/shared/assistantSelection.js";
import { vibe64DriverInputFromRegistry } from "../../packages/vibe64-genesis/src/server/promptContext.js";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { createService as createTerminalService } from "../../packages/vibe64-terminals/src/server/service.js";
import { assistantModePrompt } from "@local/vibe64-runtime/shared/assistantRouting";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { ACTION_READ_CONVERSATION_CONTEXT, createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { createService as createSessionService } from "../../packages/vibe64-sessions/src/server/service.js";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { mainConversationId } from "../../packages/vibe64-sessions/src/shared/conversationIdentity.js";
import { createSessionChangedPublisher } from "../../packages/vibe64-core/src/server/sessionRealtimeEvents.js";
import { agentTurnRealtimeOverlayFromPayload } from "../../src/lib/vibe64AgentTurnRealtimeOverlay.js";

test("Claude subscription launch preserves native auth and makes helper tools unavailable", () => {
  const args = claudeCodeArguments({ sessionId: "session", resume: true, model: "sonnet", effort: "high", toolFree: true });
  assert.ok(args.includes("--resume"));
  assert.ok(args.includes("stream-json"));
  assert.equal(args[args.indexOf("--thinking-display") + 1], "summarized");
  assert.equal(claudeCodeArguments({ terminal: true }).includes("--thinking-display"), false);
  assert.equal(args.includes("--bare"), false);
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args.includes("bypassPermissions"), false);
  const mainArgs = claudeCodeArguments({ sessionId: "session", resume: true });
  const settings = JSON.parse(mainArgs[mainArgs.indexOf("--settings") + 1]);
  assert.equal(settings.includeGitInstructions, false);
  assert.ok(settings.hooks.PreToolUse.length, "managed command admission remains installed");
});

test("Claude's live model and effort catalog fits the shared assistant selection contract", () => {
  const catalog = claudeCapabilities({ models: [{ value: "sonnet", displayName: "Sonnet", supportedEffortLevels: ["low", "high"] }] }, true);
  assert.equal(defineVibe64AssistantCapabilities(catalog).engineId, "claude");
  assert.equal(catalog.defaults.variantId, "high");
  assert.equal(catalog.modelProviders[0].models[0].variants[0].label, "Low");
});

const fixtureRuntimeOwners = Symbol("Claude fixture runtime owners");

// Preserve the original fixture call shape while exercising the same manager and
// common runtime used by the application. Original low-level retained cases use
// the actual native owner and acquire function supplied by its existing binding.
// Product scoped admission remains covered by manager/Temporary integration.
function createClaudeSessionAgentProvider(options) {
  const { [fixtureRuntimeOwners]: owners, ...nativeOptions } = options;
  let provider;
  const conversations = options.conversationRuntime || createConversationRuntime({
    authorize: ({ context, conversationId }) => context.sessionId === conversationId,
    host: { nativeTools: true, conversation: ({ id, context, input, options, operation }) => operation === "runDetachedConversation"
      ? prepareSessionDetachedConversationRun(provider, id, context, input, options) : operation === "interruptDetachedConversation" || operation === "deleteDetachedConversation"
      ? prepareSessionDetachedConversationCleanup(provider, id, context, input,
        operation === "interruptDetachedConversation" ? "interruptDetachedChatTurn" : "deleteDetachedChatThread") : operation === "inspectTemporaryActivity"
      ? prepareSessionConversationActivity(provider, id, context) : operation === "generateRenewalHandover" || operation === "seedRenewalHandover"
      ? prepareSessionConversationRenewal(provider, id, context, input) : operation === "reconcileSessions"
      ? prepareConversationReconciliation(provider, context, input, options) : operation === "closeProject"
      ? prepareProjectConversationCleanup(provider, context, input) : operation === "invalidateRuntimes"
      ? prepareConversationRuntimeInvalidation(provider, context, input) : operation === "create"
      ? prepareSessionConversationCreation(provider, id, context, input) : operation === "ensure"
      ? prepareSessionConversationReadiness(provider, id, context) : operation === "updateSettings"
      ? prepareSessionConversationSettings(provider, id, context) : operation === "dispose"
      ? prepareSessionConversationDisposal(provider, id, context, input) : createSessionConversationBinding(provider, id, {
      ...context, prepareInput: (input, current) => current.prepareInput ? current.prepareInput(input) : input
    }) }
  });
  provider = createNativeClaudeSessionAgentProvider({ ...nativeOptions, conversationRuntime: conversations,
    runNativeDetachedConversation: request => conversations.runNativeDetachedConversation(request),
    publishConversation: options.publishConversation || (event => conversations.publishNative(event)) });
  const manager = createSessionAgentManager({ conversationRuntime: conversations, defaultProviderId: "claude",
    providers: [provider], readAssistantAccess: async () => ({ available: true, ownerOnly: false }) });
  async function retainedNative(context, input) {
    const opening = context.assistantScope ? { ...context,
      scopedConversationId: String(input.conversationId || input.threadId || "").trim()
    } : context;
    return (await createSessionConversationBinding(provider, context.sessionId, opening)).native;
  }

  async function readConversation(context, input = {}) {
    const { owner: conversations } = await retainedNative(context, input);
    const entry = await conversations.acquire(context, input.conversationId || input.threadId);
    return conversations.read(entry, input);
  }

  async function startConversationTurn(context, input = {}) {
    const { owner: conversations } = await retainedNative(context, input);
    const entry = await conversations.acquire(context, input.conversationId || input.threadId, { operation: "start", input });
    return conversations.startTurn(entry, input);
  }

  async function waitForConversationTurn(context, input = {}) {
    const { owner: conversations } = await retainedNative(context, input);
    const entry = await conversations.acquire(context, input.conversationId || input.threadId);
    return conversations.wait(entry, input, { context, acquire: conversations.acquire });
  }

  function stopConversation(context, input) {
    return conversations.interruptNativeDetachedConversation({ id: context.sessionId, context, input });
  }

  function deleteConversation(context, input) {
    return conversations.deleteNativeDetachedConversation({ id: context.sessionId, context, input });
  }


  const facade = { ...provider,
    open: context => conversations.open({ id: context.sessionId, context }),
    hasActiveTemporaryConversation: context => provider.projectConversationResult("hasActiveTemporaryConversation", () =>
      conversations.inspectNativeTemporaryActivity({ id: context.sessionId, context })),
    generateSessionRenewalHandover: (context, input) => conversations.generateNativeRenewalHandover({ id: context.sessionId, context, input }),
    seedSessionRenewalHandover: (context, input) => conversations.seedNativeRenewalHandover({ id: context.sessionId, context, input }),
    reconcileSessions: (context, sessions, options) => conversations.reconcileNativeSessions({ context, sessions, options }),
    closeProject: (context, input) => conversations.closeNativeProject({ context, input }),
    invalidateRuntimes: (context, input) => conversations.invalidateNativeRuntimes({ context, input }),
    createConversation: (context, input) => conversations.createNativeConversation({ id: context.sessionId, context, input }),
    readConversation, startConversationTurn, waitForConversationTurn, stopConversation, deleteConversation,
    async closeSession(context) {
      return (await conversations.disposeNative(provider.prepareConversationRequest("closeSession", context))).result;
    },
    ensureSession: context => manager.ensureSession(context.sessionId, context),
    updateSessionSettings: (context, input) => manager.updateSessionSettings(context.sessionId, input, context),
    sendMessage: (context, input) => manager.sendMessage(context.sessionId, input, context),
    sessionState: context => manager.sessionState(context.sessionId, context),
    inspectMessageAdmission: (context, input) => manager.inspectMessageAdmission(context.sessionId, input, context),
    interruptTurn: (context, input) => manager.interruptTurn(context.sessionId, input, context),
    readGoal: context => manager.readGoal(context.sessionId, context),
    updateGoal: (context, input) => manager.updateGoal(context.sessionId, input, context)
  };
  if (!options.conversationRuntime) owners?.push({ provider: facade, conversations });
  return facade;
}

function scopedProvider(options) {
  let provider;
  const conversations = createConversationRuntime({
    authorize: ({ context, conversationId }) => context.sessionId === conversationId,
    host: { conversation: ({ id, context, input, options, operation }) => operation === "interruptDetachedConversation" || operation === "deleteDetachedConversation"
      ? prepareSessionDetachedConversationCleanup(provider, id, context, input,
        operation === "interruptDetachedConversation" ? "interruptDetachedChatTurn" : "deleteDetachedChatThread") : operation === "inspectTemporaryActivity"
      ? prepareSessionConversationActivity(provider, id, context) : operation === "generateRenewalHandover" || operation === "seedRenewalHandover"
      ? prepareSessionConversationRenewal(provider, id, context, input) : operation === "reconcileSessions"
      ? prepareConversationReconciliation(provider, context, input, options) : operation === "closeProject"
      ? prepareProjectConversationCleanup(provider, context, input) : operation === "invalidateRuntimes"
      ? prepareConversationRuntimeInvalidation(provider, context, input) : operation === "create"
      ? prepareSessionConversationCreation(provider, id, context, input) : operation === "ensure"
      ? prepareSessionConversationReadiness(provider, id, context) : operation === "updateSettings"
      ? prepareSessionConversationSettings(provider, id, context) : operation === "dispose"
      ? prepareSessionConversationDisposal(provider, id, context, input) : createSessionConversationBinding(provider, id, context) }
  });
  provider = createClaudeSessionAgentProvider({ ...options, conversationRuntime: conversations });
  options[fixtureRuntimeOwners]?.push({ provider, conversations });
  return provider;
}

async function fixture(t, { scopedConversations = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-provider-test-"));
  const owners = [];
  t.after(async () => {
    const failures = [];
    for (const { provider, conversations } of [...owners].reverse()) {
      try { await provider.closeProject(); } catch (error) { failures.push(error); }
      try { await conversations.close(); } catch (error) { failures.push(error); }
    }
    await rm(root, { recursive: true, force: true });
    if (failures.length) throw new AggregateError(failures, "Claude fixture cleanup failed.");
  });
  const selection = { engineId: "claude", agentId: "claude", modelId: "sonnet", modelProviderId: "anthropic", variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` };
  const workdir = path.join(root, "sessions", "active", "test", "source");
  await mkdir(workdir, { recursive: true });
  const git = (...args) => execFileSync("git", args, { cwd: workdir, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  git("init", "--initial-branch=main");
  git("-c", "user.name=Test", "-c", "user.email=test@example.test", "commit", "--allow-empty", "-m", "Initial");
  const session = { sessionId: "test", sessionRoot: path.join(root, "state"), metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source", source_path: workdir, assistant_selection: JSON.stringify(selection) } };
  const written = [];
  const checkpoints = [];
  const persisted = createVibe64SessionStore({ projectContextRoot: root,
    projectRuntimeRoot: path.join(root, "fixture-runtime") });
  await persisted.createSession({ sessionId: "test", runtimeKind: "genesis", metadata: session.metadata });
  Object.assign(session, await persisted.readSession("test"));
  // Keep the original observation arrays and mutable session snapshot, but let
  // the real store own transactions, transcript receipts and changeover state.
  const store = { ...persisted,
    async writeBackgroundTaskEvent(id, task, input) {
      checkpoints.push(input.patch);
      return persisted.writeBackgroundTaskEvent(id, task, input);
    },
    async writeMetadataValue(id, key, value) {
      const result = await persisted.writeMetadataValue(id, key, value);
      session.metadata[key] = value;
      return result;
    },
    async deleteMetadataValue(id, key) {
      const result = await persisted.deleteMetadataValue(id, key);
      delete session.metadata[key];
      return result;
    },
    async writeConversationUserMessage(id, message) {
      written.push({ role: "user", ...message });
      return persisted.writeConversationUserMessage(id, message);
    },
    async writeConversationAssistantMessage(id, message) {
      written.push({ role: "assistant", ...message });
      return persisted.writeConversationAssistantMessage(id, message);
    },
    async writeConversationCommentaryMessage(id, message) {
      written.push({ role: "commentary", ...message });
      return persisted.writeConversationCommentaryMessage(id, message);
    },
    async writeConversationThinkingMessage(id, message) {
      written.push({ role: "thinking", ...message });
      return persisted.writeConversationThinkingMessage(id, message);
    }
  };
  const runtime = { stateRoot: root, store, getSession: async () => session,
    renderPrompt: async (_id, input) => ({ prompt: `Context: ${input.request}` }) };
  const context = { sessionId: "test", session, runtime, assistantSelection: selection };
  const processes = [];
  const diagnostics = [];
  const publications = [];
  const behavior = { account: { loggedIn: true, email: "owner@example.test", authMethod: "claude.ai" } };
  const providerOptions = { [fixtureRuntimeOwners]: owners, systemRoot: path.join(root, "system"), env: {
    CLAUDE_CONFIG_DIR: path.join(root, "config"), VIBE64_AGENT_RUNTIME_DIR: path.join(root, "agent-runtime")
  },
    logger: { info: fields => diagnostics.push(fields), warn: fields => diagnostics.push(fields) },
    publishSessionChanged: async (_id, event) => publications.push(event),
    projectService: { readCurrentProject: async () => ({ sourceRoot: workdir }) },
    accountStatus: async () => behavior.account,
    credentialHome: { home: root }, recordGitActor: async () => ({ ok: true }), connectionStatus: async () => true,
    createProcess: async (options) => {
      const native = { options, executionId: `test-${processes.length}`, stopped: false, stopAllowed: true,
        initialization: { models: [{ value: "sonnet", supportedEffortLevels: ["low", "high"] }, { value: "haiku", supportedEffortLevels: [] }] },
        async stop() { this.stopped = this.stopAllowed; return { exited: this.stopped, scopeEmpty: this.stopped }; },
        client: { async request(request) {
          (native.requests ||= []).push(request);
          return request.subtype === "get_context_usage"
            ? (behavior.contextUsage || { totalTokens: 1000, maxTokens: 1_000_000, autoCompactThreshold: 967_000, model: "sonnet" }) : {};
        }, interrupt: async () => {
          await options.onEvent({ type: "result", subtype: "success", terminal_reason: "aborted_streaming", result: "" });
          return {};
        }, async send(message, input) {
          native.lastInput = { message, ...input };
          if (behavior.lifecycle) {
            await options.onEvent({ type: "command_lifecycle", command_uuid: input.messageId, state: "queued" });
            await options.onEvent({ type: "command_lifecycle", command_uuid: input.messageId, state: "started" });
          } else await options.onEvent({ type: "user", uuid: input.messageId, session_id: options.sessionId });
          await behavior.afterSend?.(native, message);
        } }
      };
      processes.push(native);
      return native;
    }
  };
  const provider = scopedConversations ? scopedProvider(providerOptions) : createClaudeSessionAgentProvider(providerOptions);
  return { provider, providerOptions, behavior, context, processes, written, root, checkpoints, git, diagnostics, publications,
    open: () => provider.open(context) };
}

test("Claude main and temporary chats receive project values with their managed commands", async (t) => {
  const f = await fixture(t);
  const provider = createClaudeSessionAgentProvider({
    ...f.providerOptions,
    codexGitCommand: {},
    projectService: {
      ...f.providerOptions.projectService,
      async projectInspectionEnvironment(input) {
        assert.equal(input.sessionId, "test");
        assert.equal(input.target, "claude");
        return { REFERENCE_SECRET: "dummy-project-secret" };
      }
    },
    prepareCommandEnvironment: async () => ({ ok: true, env: { MANAGED_COMMAND: "ready" }, shimDirs: [] })
  });
  await provider.sendMessage(f.context, { message: "First", messageId: "main-env" });
  const temporary = await provider.createConversation(f.context);
  await provider.startConversationTurn(f.context, {
    conversationId: temporary.conversationId, message: "Temporary", messageId: "temporary-env"
  });
  for (const { options } of f.processes) {
    assert.equal(options.env.REFERENCE_SECRET, "dummy-project-secret");
    assert.equal(options.env.MANAGED_COMMAND, "ready");
  }
  assert.equal(f.processes.length, 2);
});

test("Claude main and temporary chats install composed system guidance and yield their Genesis hooks", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "First", messageId: "main-guidance" });
  const temporary = await f.provider.createConversation(f.context);
  await f.provider.startConversationTurn(f.context, {
    conversationId: temporary.conversationId, message: "Temporary", messageId: "temporary-guidance"
  });
  for (const [index, kind] of ["main", "temporary"].entries()) {
    const options = f.processes[index].options;
    assert.equal(options.instructionArguments[0], "--append-system-prompt");
    assert.match(options.instructionArguments[1], /Genesis/);
    assert.match(options.instructionArguments[1], /VIBE64 CONVERSATION CONTEXT/);
    assert.ok(options.env.GENESIS_HOST_CONTEXT_RESOLVER.endsWith("vibe64-genesis-host-context"));
    assert.equal(options.env.GENESIS_TURN_CONTEXT_ENABLED, "0");
    const input = await vibe64DriverInputFromRegistry({
      data: JSON.parse(options.env.GENESIS_HOST_CONTEXT_RESOLVER_DATA),
      providerSessionId: options.sessionId, scope: "session"
    });
    assert.equal(input.conversationKind, kind);
  }
  assert.equal(f.processes[0].options.env.GENESIS_HOST_CONTEXT_RESOLVER_DATA,
    f.processes[1].options.env.GENESIS_HOST_CONTEXT_RESOLVER_DATA);
  await f.provider.closeProject();
  const options = f.processes[0].options;
  assert.equal((await vibe64DriverInputFromRegistry({
    data: JSON.parse(options.env.GENESIS_HOST_CONTEXT_RESOLVER_DATA),
    providerSessionId: options.sessionId, scope: "session"
  })).conversationKind, "main", "stopping JSON transport must retain context for native terminal resume");
});

test("Claude provider admits prompts in order, steers, projects thinking and text, and deduplicates sends", async (t) => {
  const f = await fixture(t);
  const sent = await f.provider.sendMessage(f.context, { message: "First", messageId: "first" });
  assert.equal(sent.delivered, true);
  assert.equal(f.processes[0].lastInput.message, "Context: First");
  const steered = await f.provider.sendMessage(f.context, { message: "Change direction", messageId: "second" });
  assert.equal(steered.deliveryMode, "steer");
  assert.equal(f.processes.length, 1);
  const previousHead = f.git("rev-parse", "HEAD");
  await writeFile(path.join(f.context.session.metadata.source_path, "edited.txt"), "Retain this work");
  await f.processes[0].options.onEvent({ type: "assistant", message: { id: "answer", content: [
    { type: "thinking", thinking: "Exposed thinking summary." }, { type: "text", text: "Done." }
  ] } });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Done.", uuid: "result" });
  await (await f.open()).wait();
  assert.deepEqual(f.written.map((message) => message.role), ["user", "user", "thinking", "assistant"]);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  assert.equal(f.checkpoints.at(-1).status, "ready");
  assert.equal(f.git("show", `${f.checkpoints.at(-1).checkpointCommit}:edited.txt`), "Retain this work");
  assert.equal(f.git("rev-parse", "HEAD"), previousHead);
  assert.equal((await f.provider.sendMessage(f.context, { message: "First", messageId: "first" })).duplicate, true);
});

test("Claude local command provenance survives the public writer and reload", async t => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "/goal clear", messageId: "goal-clear" });
  await f.processes[0].options.onEvent({ type: "system", subtype: "local_command_output", uuid: "goal-confirmation",
    content: "Goal cleared: Finish checks" });
  const turns = await f.context.runtime.store.readConversationLog("test");
  const confirmation = turns.flatMap(turn => turn.messages).find(message => message.messageId === "claude_goal-confirmation");
  assert.deepEqual(confirmation.data, { native: { engineId: "claude", type: "system", subtype: "local_command_output" } });
  assert.equal(assistantGoalManagementMessage(confirmation, turns.find(turn => turn.messages.includes(confirmation))), true);
});

test("actual synthetic Claude goal confirmation survives the public writer and hides only management output", async t => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "/goal clear", messageId: "synthetic-clear" });
  await f.processes[0].options.onEvent({ type: "assistant", uuid: "synthetic-confirmation",
    local_command_run: { command: "goal", args: "clear" },
    local_command_source: "<local-command-stdout>No goal set</local-command-stdout>",
    message: { id: "synthetic-api", model: "<synthetic>", stop_reason: "end_turn",
      content: [{ type: "text", text: "No goal set" }] } });
  const turns = await f.context.runtime.store.readConversationLog("test");
  const confirmation = turns.flatMap(turn => turn.messages).find(message => message.messageId === "claude_synthetic-confirmation_0");
  assert.deepEqual(confirmation.data, { native: { engineId: "claude", type: "assistant", command: "goal", output: "stdout" } });
  assert.equal(assistantGoalManagementMessage(confirmation, turns.find(turn => turn.messages.includes(confirmation))), true);
  assert.equal(assistantGoalManagementMessage({ ...confirmation, data: undefined }), false,
    "An ordinary assistant reply with identical text has no command provenance");
});

test("Claude compaction status is scoped to the active conversation and clears after completion or Stop", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "Work", messageId: "compact-work" });
  const event = f.processes[0].options.onEvent;
  const state = () => f.provider.sessionState(f.context);
  await event({ type: "system", subtype: "status", status: "compacting", parent_tool_use_id: "nested-agent" });
  assert.equal((await state()).turn.phase, "");
  await event({ type: "system", subtype: "status", status: "compacting" });
  assert.equal((await state()).turn.phase, "compacting");
  await event({ type: "system", subtype: "compact_boundary" });
  assert.equal((await state()).turn.phase, "");
  assert.equal((await state()).turn.active, true);
  await event({ type: "system", subtype: "status", status: "compacting" });
  await event({ type: "system", subtype: "status", status: null });
  assert.equal((await state()).turn.phase, "");
  await event({ type: "system", subtype: "status", status: "compacting" });
  await f.provider.interruptTurn(f.context);
  assert.equal((await state()).turn.phase, "");
  await event({ type: "system", subtype: "status", status: "compacting" });
  assert.equal((await state()).turn.phase, "", "A stopped process cannot restore compaction");
  await f.provider.sendMessage(f.context, { message: "Continue", messageId: "compact-continue" });
  assert.equal((await state()).turn.phase, "");
  const nextEvent = f.processes[1].options.onEvent;
  await nextEvent({ type: "system", subtype: "status", status: "compacting" });
  await nextEvent({ type: "result", subtype: "error_during_execution", is_error: true, errors: ["Provider unavailable"] });
  await (await f.open()).wait();
  assert.equal((await state()).turn.phase, "");
});

test("Claude stop requires process exit proof and resume keeps the native conversation", async (t) => {
  const f = await fixture(t);
  const initial = await f.provider.sendMessage(f.context, { message: "Go", messageId: "go" });
  f.processes[0].stopAllowed = false;
  await assert.rejects(f.provider.interruptTurn(f.context), /exit has not been confirmed/u);
  let unconfirmed;
  await assert.doesNotReject(async () => { unconfirmed = (await f.provider.sessionState(f.context)).turn; },
    "Failed Stop must leave status readable");
  assert.equal(unconfirmed.active, true);
  assert.equal(unconfirmed.status, "observation_lost");
  assert.equal(unconfirmed.phase, "");
  assert.match(unconfirmed.error, /exit has not been confirmed/);
  assert.ok(f.publications.some(event => event.payload?.agentSession?.turn?.status === "observation_lost"));
  f.processes[0].stopAllowed = true;
  await assert.doesNotReject(() => f.provider.interruptTurn(f.context), "Stop retries native cleanup");
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  await assert.doesNotReject(() => f.provider.sendMessage(f.context, { message: "Continue", messageId: "continue" }),
    "Confirmed Stop permits a new input");
  assert.equal(f.processes[1].options.sessionId, initial.thread.id);
  assert.equal(f.processes[1].options.resume, true);
});

test("Claude split tool progress stays commentary in live and restored history", async (t) => {
  const f = await fixture(t);
  const sent = await f.provider.sendMessage(f.context, { message: "Inspect", messageId: "split-progress" });
  const event = f.processes[0].options.onEvent;
  const frames = [
    { type: "assistant", uuid: "progress", message: { id: "tool-message", content: [{ type: "text", text: "Checking files" }] } },
    { type: "assistant", uuid: "read-tool", message: { id: "tool-message", content: [{ type: "tool_use", id: "read", name: "Read", input: {} }] } },
    { type: "assistant", uuid: "answer", message: { id: "answer-message", content: [{ type: "text", text: "All checked" }] } }
  ];
  for (const frame of frames) await event(frame);
  await event({ type: "result", subtype: "success", result: "All checked" });
  await (await f.open()).wait();
  assert.deepEqual(f.written.filter(message => message.role !== "user").map(({ role, text }) => ({ role, text })), [
    { role: "commentary", text: "Checking files" }, { role: "assistant", text: "All checked" }
  ]);
  await writeHistory(f, sent.thread.id, frames);
  const history = await readClaudeHistory({ configRoot: path.join(f.root, "config"),
    workdir: f.context.session.metadata.source_path, conversationId: sent.thread.id });
  assert.deepEqual(history.messages.map(message => message.role), ["commentary", "assistant"]);
  assert.equal(history.text, "All checked");
});

test("Claude split native frames retain thinking and answers across streaming and history", async (t) => {
  const f = await fixture(t);
  const deltas = [];
  f.context.onEvent = (event) => { if (event.type === "text") deltas.push(event); };
  const completedStreams = [];
  f.context.runtime.store.completeConversationStreamMessage = (_id, messageId) => completedStreams.push(messageId);
  const sent = await f.provider.sendMessage(f.context, { message: "Go", messageId: "go" });
  const event = f.processes[0].options.onEvent;
  const content = [{ type: "thinking", thinking: "Exposed summary." }, { type: "text", text: "Done." }];
  const nativeFrames = content.map((block, index) => ({
    type: "assistant", uuid: `block-${index}`, message: { id: "shared-api-id", content: [block] }
  }));
  await event({ type: "stream_event", event: { type: "message_start", message: { id: "shared-api-id" } } });
  for (const [index, block] of content.entries()) {
    await event({ type: "stream_event", event: { type: "content_block_start", index, content_block: { type: block.type } } });
    await event({ type: "stream_event", event: { type: "content_block_delta", index,
      delta: block.type === "thinking" ? { thinking: block.thinking } : { text: block.text } } });
    await event({ type: "stream_event", event: { type: "content_block_stop", index } });
    await event(nativeFrames[index]);
  }
  await event({ type: "result", subtype: "success", result: "Done." });
  assert.deepEqual(deltas.map(({ messageId, text }) => ({ messageId, text })), [
    { messageId: "claude_shared-api-id_1", text: "Done." }
  ]);
  const live = await f.provider.readConversation(f.context);
  assert.deepEqual(live.messages.map(({ role, text }) => ({ role, text })), [
    { role: "thinking", text: "Exposed summary." }, { role: "assistant", text: "Done." }
  ]);
  assert.equal(new Set(live.messages.map((message) => message.id)).size, 2);
  assert.equal(new Set(f.written.filter((message) => message.role !== "user").map((message) => message.messageId)).size, 2);
  assert.ok(completedStreams.includes("claude_shared-api-id_1"));
  await writeHistory(f, sent.thread.id, nativeFrames.map((frame, apiBlockIndex) => ({ ...frame, apiBlockIndex })));
  const history = await readClaudeHistory({ configRoot: path.join(f.root, "config"),
    workdir: f.context.session.metadata.source_path, conversationId: sent.thread.id });
  assert.deepEqual(history.messages.map((message) => message.id), live.messages.map((message) => message.id));
  assert.deepEqual(history.messages.map((message) => message.text), ["Exposed summary.", "Done."]);
  assert.equal((await f.provider.readConversation(f.context)).messages.length, 2);
  const userId = nativeMessageId("offline-original-input");
  const structured = { kind: "reply", text: "Saved structured answer 🌏", toolName: "", arguments: "" };
  const inspectedFrames = [
    ...nativeFrames.map((frame, apiBlockIndex) => ({ ...frame, apiBlockIndex })),
    { type: "user", uuid: "meta-user", isMeta: true, message: { content: "Hidden meta input" } },
    { type: "user", uuid: userId, message: { content: [{ type: "text", text: "Original input 🌏" }, { type: "image" }, { type: "text", text: "Second part" }] } },
    { type: "assistant", uuid: "structured-carrier", message: { content: [
      { type: "tool_use", id: "structured-tool", name: "StructuredOutput", input: structured }
    ] } },
    { type: "assistant", uuid: "unrelated-carrier", message: { content: [
      { type: "tool_use", id: "unrelated-tool", name: "unrelated_native_tool", input: structured }
    ] } },
    { type: "assistant", uuid: "nested-carrier", parent_tool_use_id: "parent", message: { content: [
      { type: "tool_use", id: "nested-tool", name: "StructuredOutput", input: structured }
    ] } },
    { type: "assistant", uuid: "sidechain-carrier", isSidechain: true, message: { content: [
      { type: "tool_use", id: "sidechain-tool", name: "StructuredOutput", input: structured }
    ] } },
    { type: "result", uuid: "native-final", subtype: "success", structured_output: structured },
    { type: "result", uuid: "nested-final", parent_tool_use_id: "parent", subtype: "success", structured_output: structured },
    { type: "result", uuid: "sidechain-final", isSidechain: true, subtype: "success", structured_output: structured },
    { type: "result", uuid: "meta-final", isMeta: true, subtype: "success", structured_output: structured }
  ];
  await writeHistory(f, sent.thread.id, inspectedFrames);
  const options = { configRoot: path.join(f.root, "config"), workdir: f.context.session.metadata.source_path,
    conversationId: sent.thread.id, allowIncompleteTail: false };
  const nativePath = (await claudeHistoryPath(options)).path;
  const bytes = await readFile(nativePath);
  const ordinary = await readClaudeHistory(options);
  assert.equal(Object.hasOwn(ordinary, "userMessages"), false);
  assert.equal(Object.hasOwn(ordinary, "completedResults"), false);
  assert.equal(Object.hasOwn(ordinary, "structuredOutputs"), false);
  assert.equal(Object.hasOwn(ordinary, "failedResults"), false);
  const inspected = await readClaudeHistory({ ...options, includeUserMessages: true, includeFinalCarriers: true });
  const { userMessages, completedResults, failedResults, structuredOutputs, ...unchanged } = inspected;
  assert.deepEqual(unchanged, ordinary, "Opt-in custody does not change original history projection");
  assert.deepEqual(userMessages, [{ id: userId, text: "Original input 🌏\n\nSecond part" }]);
  assert.deepEqual(completedResults, [{ id: "native-final", userId, text: JSON.stringify(structured) }]);
  assert.deepEqual(structuredOutputs, [{ id: "structured-carrier", userId,
    toolUseId: "structured-tool", text: JSON.stringify(structured) }]);
  assert.deepEqual(failedResults, []);
  assert.deepEqual(await readFile(nativePath), bytes, "History inspection leaves exact native bytes unchanged");
  const candidateOnly = inspectedFrames.filter(frame => frame.type !== "result");
  await writeHistory(f, sent.thread.id, candidateOnly);
  const candidate = await readClaudeHistory({ ...options, includeFinalCarriers: true });
  assert.deepEqual(candidate.completedResults, [], "A saved StructuredOutput tool candidate is not fabricated completion");
  assert.deepEqual(candidate.structuredOutputs, structuredOutputs);
  await writeHistory(f, sent.thread.id, [ ...candidateOnly,
    { type: "result", uuid: "plain-final", subtype: "success", result: "Original plain result" },
    { type: "result", uuid: "failed-final", subtype: "error_during_execution", is_error: true, errors: ["Private provider detail"] },
    { type: "result", uuid: "interrupted-final", subtype: "success", terminal_reason: "aborted_tools", result: "Interrupted words" }
  ]);
  const terminal = await readClaudeHistory({ ...options, includeFinalCarriers: true });
  assert.deepEqual(terminal.completedResults, [{ id: "plain-final", userId, text: "Original plain result" }]);
  assert.deepEqual(terminal.failedResults, [{ id: "failed-final", userId }, { id: "interrupted-final", userId }]);
  assert.doesNotMatch(JSON.stringify(terminal.failedResults), /Private provider detail|Interrupted words/);
  await writeFile(nativePath, (await readFile(nativePath, "utf8")) + '{"type":"result"');
  await assert.rejects(readClaudeHistory({ ...options, includeUserMessages: true, includeFinalCarriers: true }), /incomplete/);
});

test("offline Claude command inspection retains exact identity without changing ordinary history", async t => {
  const f = await fixture(t);
  const sent = await f.provider.sendMessage(f.context, { message: "Start", messageId: "command-inspection" });
  const options = { configRoot: path.join(f.root, "config"), workdir: f.context.session.metadata.source_path,
    conversationId: sent.thread.id, allowIncompleteTail: false };
  // Claude 2.1.289 stores its synthetic live assistant confirmation this way.
  const command = { type: "system", subtype: "local_command", uuid: "clear-command",
    commandRun: { command: "goal", args: "clear" },
    content: "<local-command-stdout>Goal cleared: Original objective\n\nRetained text</local-command-stdout>" };
  await writeHistory(f, sent.thread.id, [command,
    { ...command, uuid: "error-command", content: "<local-command-stderr>Not allowed</local-command-stderr>" },
    { ...command, uuid: "missing-command", commandRun: undefined },
    { ...command, uuid: "bad-wrapper", content: "<local-command-stdout>Wrong close</local-command-stderr>" },
    { ...command, uuid: "nested-command", parent_tool_use_id: "parent" },
    { ...command, uuid: "side-command", isSidechain: true },
    { type: "assistant", uuid: "ordinary-answer", message: { content: [{ type: "text", text: "Goal cleared: Here is my explanation" }] } }
  ]);
  const file = (await claudeHistoryPath(options)).path;
  const bytes = await readFile(file);
  const ordinary = await readClaudeHistory(options);
  assert.equal(Object.hasOwn(ordinary, "commandMessages"), false);
  const { commandMessages, ...rest } = await readClaudeHistory({ ...options, includeCommandMessages: true });
  assert.deepEqual(rest, ordinary);
  assert.deepEqual(commandMessages, [
    { id: "claude_clear-command_0", text: "Goal cleared: Original objective\n\nRetained text",
      data: { native: { engineId: "claude", type: "system", subtype: "local_command", command: "goal", output: "stdout" } } },
    { id: "claude_error-command_0", text: "Not allowed",
      data: { native: { engineId: "claude", type: "system", subtype: "local_command", command: "goal", output: "stderr" } } }
  ]);
  assert.deepEqual(await readFile(file), bytes);
});

test("Claude inspection defers native hooks until the prepared first Send", async (t) => {
  const f = await fixture(t);
  const hookPath = path.join(f.context.session.metadata.source_path, ".claude", "settings.json");
  await mkdir(path.dirname(hookPath), { recursive: true });
  await writeFile(hookPath, "original hook configuration");
  let loadedHooks;
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    createProcess: async (options) => {
      loadedHooks = await readFile(hookPath, "utf8");
      return f.providerOptions.createProcess(options);
    }
  });
  const first = await provider.ensureSession(f.context);
  assert.equal((await provider.ensureSession(f.context)).thread.id, first.thread.id);
  assert.equal(f.processes.length, 0);
  // The service performs this authorized synchronization before dispatch.
  await writeFile(hookPath, "refreshed Genesis hook configuration");
  const sent = await provider.sendMessage(f.context, { message: "Hello", messageId: "prepared-first" });
  assert.equal(sent.thread.id, first.thread.id);
  assert.equal(f.processes.length, 1);
  assert.equal(loadedHooks, "refreshed Genesis hook configuration");
});

test("Claude reuses its main conversation when callers hold older session snapshots", async (t) => {
  const f = await fixture(t);
  const staleSession = structuredClone(f.context.session);
  const first = await f.provider.ensureSession(f.context);
  const staleContext = { ...f.context, session: staleSession };
  const state = await f.provider.sessionState(staleContext);
  const sent = await f.provider.sendMessage(staleContext, { message: "Hello", messageId: "hello" });
  assert.equal(state.thread.id, first.thread.id);
  assert.equal(sent.thread.id, first.thread.id);
  assert.equal(f.processes.length, 1);
});

test("Claude replacement forgets its cached main binding and blocks admission while preparing", async (t) => {
  const f = await fixture(t);
  const first = await f.provider.sessionState(f.context);
  f.context.session.metadata.assistant_changeover = JSON.stringify({ lastEngine: "claude", engines: { claude: { seen: {} } }, replacement: { status: "preparing" } });
  await f.context.runtime.store.writeMetadataValue("test", "assistant_changeover", f.context.session.metadata.assistant_changeover);
  await assert.rejects(f.provider.sessionState(f.context), { code: "vibe64_conversation_replacement_pending" });
  assert.equal((await f.provider.closeSession({ ...f.context, forgetConversationBinding: true })).ok, true);
  delete f.context.session.metadata.claude_conversation_id;
  delete f.context.session.metadata.agent_identity_conversation_id;
  f.context.session.metadata.assistant_changeover = JSON.stringify({ lastEngine: "claude", engines: { claude: { seen: {} } }, replacement: { status: "ready" } });
  await f.context.runtime.store.deleteMetadataValue("test", "claude_conversation_id");
  await f.context.runtime.store.deleteMetadataValue("test", "agent_identity_conversation_id");
  await f.context.runtime.store.writeMetadataValue("test", "assistant_changeover", f.context.session.metadata.assistant_changeover);
  const successor = await f.provider.sessionState(f.context);
  assert.notEqual(successor.thread.id, first.thread.id);
  assert.equal(f.context.session.metadata.claude_conversation_id, successor.thread.id);
  assert.equal(f.processes.length, 0);
});

test("restoring Claude conversations preserves another engine's main identity", async (t) => {
  for (const operation of ["hasActiveTemporaryConversation", "closeSession", "reconcileSessions"]) {
    await t.test(operation, async (t) => {
      const f = await fixture(t);
      const main = await f.provider.sessionState(f.context);
      const temporary = await f.provider.createConversation(f.context);
      await f.provider.startConversationTurn(f.context, {
        conversationId: temporary.conversationId, message: "Temporary", messageId: "temp"
      });
      const identity = {
        agent_identity_conversation_id: "codex-main", agent_identity_provider: "codex",
        agent_identity_resume_strategy: "provider-native", agent_identity_status: "ready",
        agent_identity_workdir: f.context.session.metadata.source_path,
        agent_transport_id: "codex_app_server", agent_transport_kind: "app-server"
      };
      Object.assign(f.context.session.metadata, identity, {
        assistant_selection: JSON.stringify({ ...f.context.assistantSelection, engineId: "codex", agentId: "codex" })
      });
      for (const key of [...Object.keys(identity), "assistant_selection"]) {
        await f.context.runtime.store.writeMetadataValue("test", key, f.context.session.metadata[key]);
      }
      // A temporary Claude operation receives a selection-specific snapshot;
      // its store still writes to the parent session.
      const context = { ...f.context, session: structuredClone(f.context.session) };
      const stopped = [];
      const restored = createClaudeSessionAgentProvider({ ...f.providerOptions,
        stopExecution: async (id) => { stopped.push(id); return { scopeEmpty: true }; } });
      if (operation === "reconcileSessions") {
        await restored.reconcileSessions({}, [context.session], context);
      } else {
        const result = await restored[operation](context);
        if (operation === "hasActiveTemporaryConversation") assert.equal(result.active, true);
      }
      for (const [key, value] of Object.entries(identity)) assert.equal(f.context.session.metadata[key], value, key);
      assert.equal(f.context.session.metadata.claude_conversation_id, main.thread.id);
      if (operation !== "hasActiveTemporaryConversation") assert.deepEqual(stopped, ["test-0"]);
      assert.equal(f.processes.length, 1);

      // Explicitly returning to Claude must activate the cached main entry.
      const selected = { ...f.context, session: structuredClone(f.context.session) };
      selected.session.metadata.assistant_selection = JSON.stringify(selected.assistantSelection);
      await f.context.runtime.store.writeMetadataValue("test", "assistant_selection", selected.session.metadata.assistant_selection);
      assert.equal((await restored.sessionState(selected)).thread.id, main.thread.id);
      assert.equal(f.context.session.metadata.agent_identity_provider, "claude");
      assert.equal(f.context.session.metadata.agent_identity_conversation_id, main.thread.id);
      assert.equal(f.context.session.metadata.agent_transport_id, "claude_stream_json");
    });
  }
});

test("Claude observation failure stops native work before publishing idle", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "Go", messageId: "go" });
  await f.processes[0].options.onFailure(new Error("Broken stream"));
  assert.equal(f.processes[0].stopped, true);
  assert.equal((await f.provider.sessionState(f.context)).turn.state, "interrupted");
});

test("Claude active turn publication carries the revision the client overlay requires", async (t) => {
  const f = await fixture(t);
  const before = (await f.context.runtime.store.readSession("test")).revision;
  await f.provider.sendMessage(f.context, { message: "Go", messageId: "working-revision" });
  const event = f.publications.find(publication => publication.reason === "claude-stream-turn-active");
  assert.ok(event, "Claude published its active turn.");
  assert.ok(Number.isSafeInteger(event.session?.revision) && event.session.revision > before);
  const published = [];
  await createSessionChangedPublisher({ publish: async value => published.push(value) })("test", event);
  const overlay = agentTurnRealtimeOverlayFromPayload(published[0].realtime.payload, "test");
  assert.equal(overlay?.active, true);
  assert.equal(overlay.revision, event.session.revision);
});

test("Claude managed bridge carries JSON and provides a verified scope stop", async (t) => {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-bridge-test-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const command = path.join(root, "claude-fixture");
  await writeFile(command, `#!/usr/bin/env node
const readline = require('node:readline');
if (Number(process.env.VIBE64_CODEX_GIT_COMMAND_NO_STDIN_PARENT_PID) !== process.pid) {
  throw new Error('Native Git probes would wait forever for stdin.');
}
readline.createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  if (frame.type === 'control_request') process.stdout.write(JSON.stringify({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id, response: { models: [{ value: 'fixture' }] } } }) + '\\n');
  else process.stdout.write(JSON.stringify(frame) + '\\n');
});
`, { mode: 0o700 });
  const observed = Promise.withResolvers();
  const native = await createClaudeCodeProcess({ command, workdir: root, credentialHome: { home: root },
    onEvent: (event) => observed.resolve(event) });
  t.after(() => native.stop());
  assert.equal(native.initialization.models[0].value, "fixture");
  await native.client.send("Unicode 🌏", { messageId: "test" });
  assert.equal((await observed.promise).message.content, "Unicode 🌏");
  assert.equal((await native.stop()).scopeEmpty, true);
});

function nativeGoalFrames(native, condition, timestamp = Date.now()) {
  const uuid = native.lastInput.messageId;
  const marker = { type: "attachment", uuid: `${uuid}-goal`, timestamp: new Date(timestamp).toISOString(),
    attachment: { type: "goal_status", condition: condition === "clear" ? "Tests pass" : condition,
      sentinel: true, met: condition === "clear" } };
  return [marker, { type: "user", uuid, parentUuid: marker.uuid, message: { content: native.lastInput.message } }];
}

async function writeHistory(f, id, events, workdir = f.context.session.metadata.source_path) {
  const directory = path.join(f.root, "config", "projects", workdir.replace(/[^a-zA-Z0-9]/gu, "-"));
  await mkdir(directory, { recursive: true });
  await writeFile(path.join(directory, `${id}.jsonl`), events.map((event) => JSON.stringify(event)).join("\n") + "\n");
}

test("Claude command admission is distinct from user tool-result frames and waits for native background work", async (t) => {
  const f = await fixture(t);
  f.behavior.lifecycle = true;
  await f.provider.sendMessage(f.context, { message: "Go", messageId: "go" });
  const event = f.processes[0].options.onEvent;
  await event({ type: "user", uuid: "tool-result", message: { content: [{ type: "tool_result" }] } });
  await event({ type: "system", subtype: "task_started", task_id: "task", task_type: "local_agent" });
  await event({ type: "result", subtype: "success", result: "Done", uuid: "done" });
  assert.equal((await f.provider.sessionState(f.context)).turn.active, true);
  await event({ type: "system", subtype: "task_notification", task_id: "task", status: "completed" });
  await (await f.open()).wait();
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
});

test("Claude automatic continuation restores Main activity and Stop while logging only lifecycle facts", async t => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "private prompt marker", messageId: "automatic" });
  const event = f.processes[0].options.onEvent;
  await event({ type: "result", subtype: "success", result: "private answer marker" });
  await (await f.open()).wait();
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  await event({ type: "user", uuid: "notification", origin: { kind: "task-notification" },
    message: { content: "private task notification marker" } });
  assert.equal((await f.provider.sessionState(f.context)).turn.active, true);
  await event({ type: "system", subtype: "background_tasks_changed", tasks: [
    { task_id: "build", task_type: "local_bash", description: "private task description marker" }
  ] });
  await event({ type: "assistant", uuid: "automatic-answer", message: {
    id: "automatic-answer", content: [{ type: "text", text: "private continued answer marker" }]
  } });
  await event({ type: "stream_event", event: { type: "message_start", message: { id: "automatic-answer" } } });
  await event({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "end_turn" } } });
  assert.ok(f.written.some(message => message.text === "private continued answer marker"));
  const interrupted = await f.provider.interruptTurn(f.context);
  assert.equal(interrupted.interrupted, true);
  assert.equal(f.processes[0].stopped, true);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  assert.ok(f.diagnostics.some(value => value.stage === "continued"));
  assert.ok(f.diagnostics.some(value => value.stage === "background_tasks" && value.backgroundTasks === 1));
  assert.ok(f.diagnostics.some(value => value.stage === "native_result"));
  assert.doesNotMatch(JSON.stringify(f.diagnostics), /private .* marker/);
  assert.ok(f.diagnostics.every(value => value.sessionId === "test" && value.conversationId));
});

test("Claude diagnostics cannot turn a logger failure into a conversation failure", async t => {
  const f = await fixture(t);
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    logger: { info() { throw new Error("Log sink unavailable"); }, warn() { throw new Error("Log sink unavailable"); } }
  });
  await provider.sendMessage(f.context, { message: "Work", messageId: "logs-unavailable" });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Done" });
  await (await provider.open(f.context)).wait();
  assert.equal((await provider.sessionState(f.context)).turn.state, "completed");
});

test("Claude conversations work concurrently and stopping one leaves the other active", async t => {
  const f = await fixture(t);
  const temporary = await f.provider.createConversation(f.context);
  await Promise.all([
    f.provider.sendMessage(f.context, { message: "Main", messageId: "concurrent-main" }),
    f.provider.startConversationTurn(f.context, { conversationId: temporary.conversationId, message: "Temporary", messageId: "concurrent-temporary" })
  ]);
  assert.equal(f.processes.length, 2);
  const temporaryProcess = f.processes.find(process => process.options.sessionId === temporary.conversationId);
  const mainProcess = f.processes.find(process => process !== temporaryProcess);
  await f.provider.interruptTurn(f.context);
  assert.equal(mainProcess.stopped, true);
  assert.notEqual(temporaryProcess.stopped, true);
  assert.equal((await f.provider.readConversation(f.context, { conversationId: temporary.conversationId })).status, "inProgress");
  await temporaryProcess.options.onEvent({ type: "result", subtype: "success", result: "Temporary completed" });
  assert.equal((await f.provider.waitForConversationTurn(f.context, { conversationId: temporary.conversationId })).text, "Temporary completed");
});

test("Claude recovers exact admission and temporary history without resending after restart", async (t) => {
  const f = await fixture(t);
  const temporary = await f.provider.createConversation(f.context);
  await f.provider.startConversationTurn(f.context, { conversationId: temporary.conversationId, message: "Temporary", messageId: "temp" });
  await writeHistory(f, temporary.conversationId, [
    { type: "user", uuid: nativeMessageId("temp"), message: { content: "Temporary" } },
    { type: "assistant", uuid: "answer", message: { id: "answer", content: [{ type: "text", text: "Recovered" }] } }
  ]);
  const stopped = [];
  const restored = createClaudeSessionAgentProvider({ ...f.providerOptions,
    stopExecution: async (id) => { stopped.push(id); return { scopeEmpty: true }; } });
  const read = await restored.readConversation(f.context, { conversationId: temporary.conversationId, messageId: "temp" });
  assert.equal(read.text, "Recovered");
  assert.equal(read.admitted, true);
  assert.deepEqual(stopped, ["test-0"]);
  assert.equal(f.processes.length, 1);
  assert.equal((await restored.closeSession(f.context)).processExitProof.exited, true);
  await restored.deleteConversation(f.context, { conversationId: temporary.conversationId });
  assert.equal(Object.hasOwn(f.context.session.metadata, `claude_conversation_${temporary.conversationId}`), false);
  await assert.rejects(restored.readConversation(f.context, { conversationId: temporary.conversationId }), /unavailable/u);
});

test("Claude shutdown cannot restore a closed temporary chat from a cached main snapshot", async (t) => {
  const f = await fixture(t);
  const recovered = [];
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    stopExecution: async (id) => { recovered.push(id); return { scopeEmpty: false }; } });
  await provider.sessionState(f.context);
  const temporary = await provider.createConversation(f.context);
  await provider.startConversationTurn(f.context, {
    conversationId: temporary.conversationId, message: "Temporary", messageId: "temp"
  });
  // Main polling retains its own snapshot while the temporary process is active.
  const stale = { ...f.context, session: structuredClone(f.context.session) };
  await provider.sessionState(stale);
  await provider.deleteConversation({ ...f.context, session: structuredClone(f.context.session) }, temporary);
  const key = `claude_conversation_${temporary.conversationId}`;
  assert.equal(Object.hasOwn(f.context.session.metadata, key), false);
  assert.equal(f.processes[0].stopped, true);

  assert.equal((await provider.closeProject()).ok, true);
  assert.deepEqual(recovered, [], "Closed execution must not be recovered from an old snapshot");
  assert.equal(Object.hasOwn(f.context.session.metadata, key), false);
});

test("Claude shutdown retains its resolved selection after main chat moves to Codex", async (t) => {
  const f = await fixture(t);
  const context = { ...f.context, assistantSelection: undefined };
  await f.provider.sendMessage(context, { message: "First", messageId: "before-changeover" });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Done", uuid: "done" });
  const claudeId = f.context.session.metadata.claude_conversation_id;
  const selection = JSON.stringify({ ...f.context.assistantSelection, engineId: "codex", agentId: "codex",
    modelProviderId: "deepseek", modelId: "deepseek-flash" });
  Object.assign(f.context.session.metadata, { assistant_selection: selection,
    agent_identity_provider: "codex", agent_identity_conversation_id: "retained-codex-thread" });
  for (const key of ["assistant_selection", "agent_identity_provider", "agent_identity_conversation_id"]) {
    await f.context.runtime.store.writeMetadataValue("test", key, f.context.session.metadata[key]);
  }
  const messages = structuredClone(f.written);

  assert.equal((await f.provider.invalidateRuntimes({}, { reason: "server-shutdown" })).ok, true);
  assert.equal(f.processes[0].stopped, true);
  assert.equal(JSON.parse(f.context.session.metadata[`claude_conversation_${claudeId}`]).executionId, "");
  assert.equal(f.context.session.metadata.assistant_selection, selection);
  assert.equal(f.context.session.metadata.agent_identity_provider, "codex");
  assert.equal(f.context.session.metadata.agent_identity_conversation_id, "retained-codex-thread");
  assert.deepEqual(f.written, messages);
  assert.equal(f.processes.length, 1, "Shutdown does not start another provider process");
});

test("Claude recovery discovers saved processes created after its supplied snapshot", async (t) => {
  const f = await fixture(t);
  await f.provider.sessionState(f.context);
  const stale = { ...f.context, session: structuredClone(f.context.session) };
  const temporary = await f.provider.createConversation(f.context);
  await f.provider.startConversationTurn(f.context, {
    conversationId: temporary.conversationId, message: "Temporary", messageId: "temp"
  });
  const recovered = [];
  const restarted = createClaudeSessionAgentProvider({ ...f.providerOptions,
    stopExecution: async (id) => { recovered.push(id); return { scopeEmpty: true }; } });
  assert.equal((await restarted.closeSession(stale)).ok, true);
  assert.deepEqual(recovered, [f.processes[0].executionId]);
  const saved = JSON.parse(f.context.session.metadata[`claude_conversation_${temporary.conversationId}`]);
  assert.equal(saved.executionId, "");
  assert.equal(saved.state, "interrupted");
});

test("Claude admission inspection uses the shared contract and native history prevents duplicate sends", async (t) => {
  const f = await fixture(t);
  const ready = await f.provider.ensureSession(f.context);
  await writeHistory(f, ready.thread.id, [{ type: "user", uuid: nativeMessageId("accepted"), message: { content: "accepted" } }]);
  const inspected = await f.provider.inspectMessageAdmission(f.context, { messageId: "accepted", threadId: ready.thread.id });
  assert.equal(inspected.admission, "accepted");
  assert.equal(inspected.turnId, nativeMessageId("accepted"));
  assert.equal((await f.provider.sendMessage(f.context, { message: "accepted", messageId: "accepted" })).duplicate, true);
  assert.equal(f.processes.length, 0, "An already accepted message does not start a process or send again");
});

test("Claude bounded helpers use the selected Haiku without tools or the project's command environment", async (t) => {
  const f = await fixture(t);
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "haiku", variantId: "" };
  const executionProfile = await f.provider.resolveExecutionProfile(f.context, { profileId: "helper", workloadId: "commit_title" });
  f.behavior.afterSend = (native) => native.options.onEvent({ type: "result", subtype: "success", result: "Fix the title", uuid: "title" });
  const result = await f.provider.runDetachedChatTurn(f.context, { prompt: "Write a title", executionProfile });
  assert.equal(result.text, "Fix the title");
  assert.equal(result.executionProfile.model, "haiku");
  assert.equal(f.processes[0].options.toolFree, true);
  assert.equal(f.processes[0].options.workdir, f.root);
  assert.equal(f.written.length, 0);
  await f.provider.deleteConversation(f.context, { conversationId: result.conversationId });
});

test("Claude renewal uses the main native history and verifies the approved fresh-thread acknowledgement", async (t) => {
  const f = await fixture(t);
  const source = { authority: "github", ref: "refs/heads/main", commit: "a".repeat(40) };
  const handover = sessionRenewalManualHandoverTemplate({ source });
  const handoverHash = sessionRenewalHandoverHash(handover);
  f.behavior.afterSend = (native) => native.options.onEvent({ type: "result", subtype: "success", result: handover, uuid: "handover" });
  const generated = await f.provider.generateSessionRenewalHandover(f.context, { operationId: "renew-one", source });
  assert.equal(generated.handoverHash, handoverHash);
  assert.equal(generated.processExitProof.exited, true);
  assert.equal(f.written.length, 0);
  const successor = await fixture(t);
  successor.behavior.afterSend = (native) => native.options.onEvent({ type: "result", subtype: "success", uuid: "ack", structured_output: {
    schemaVersion: "vibe64.session-renewal-acknowledgement.v1", status: "ready", handoverHash, sourceCommit: source.commit, message: "Ready."
  } });
  const seeded = await successor.provider.seedSessionRenewalHandover(successor.context, {
    operationId: "renew-one", source, handover, handoverHash, forbiddenThreadId: generated.threadId
  });
  assert.equal(seeded.acknowledgement.status, "ready");
  assert.equal(seeded.freshThread, true);
  assert.equal(successor.context.session.metadata.agent_briefing_delivered, "yes");
  assert.equal(successor.processes[0].stopped, true);
  assert.equal(successor.written.length, 0);
});

test("Claude renewal failures allow the shared manual handover recovery without losing the old conversation", async (t) => {
  const f = await fixture(t);
  const source = { authority: "github", ref: "refs/heads/main", commit: "a".repeat(40) };
  const ready = await f.provider.ensureSession(f.context);
  f.behavior.afterSend = (native) => native.options.onEvent({
    type: "result", subtype: "error_during_execution", is_error: true,
    errors: ["Start a new session to continue."], uuid: "refused"
  });
  await assert.rejects(f.provider.generateSessionRenewalHandover(f.context, { operationId: "renew-refused", source }), {
    code: "vibe64_session_renewal_turn_failed"
  });
  assert.equal(f.processes[0].stopped, true);
  assert.equal(f.context.session.metadata.claude_conversation_id, ready.thread.id);
  assert.equal(f.written.length, 0);
});

test("Vibe64 supplies its managed account execution policy to the shared Claude status reader", async () => {
  const status = await readClaudeCodeAuthStatus({
    env: { VIBE64_CLAUDE_COMMAND: "/managed/claude" }, credentialHome: { home: "/home/fixture" },
    commandRunner: async input => {
      assert.equal(input.actor, "app");
      assert.equal(input.command, "/managed/claude");
      assert.equal(input.cwd, "/home/fixture");
      assert.deepEqual(input.allowedRoots, ["/home/fixture"]);
      assert.equal(input.inheritProcessEnv, false);
      assert.equal(input.mode, "capture");
      assert.equal(input.purpose, "account");
      assert.equal(input.envPolicy, "auth");
      assert.deepEqual(input.runtimes, ["operator-clis", "node26"]);
      return { ok: true, stdout: '{"loggedIn":true,"email":"owner@example.test"}' };
    }
  });
  assert.equal(status.email, "owner@example.test");
});

test("Claude Main follows the current workspace account after stopping its previous process and preserves history across restart", async (t) => {
  const f = await fixture(t);
  const original = await f.provider.describeProvider(f.context);
  await f.provider.sendMessage(f.context, { message: "Work", messageId: "owned" });
  await f.provider.closeSession(f.context);
  const restarted = createClaudeSessionAgentProvider(f.providerOptions);
  assert.equal((await restarted.describeProvider(f.context)).accountIdentitySignature, original.accountIdentitySignature);
  await restarted.sendMessage(f.context, { message: "Continue", messageId: "resume" });
  assert.equal(f.processes[1].options.resume, true);
  f.behavior.account = { ...f.behavior.account, email: "someone-else@example.test" };
  const changed = await restarted.describeProvider(f.context);
  assert.notEqual(changed.accountIdentitySignature, original.accountIdentitySignature);
  f.processes[1].stopAllowed = false;
  await assert.rejects(restarted.sendMessage(f.context, { message: "Current account", messageId: "other" }),
    (error) => error.code === "vibe64_claude_stop_unconfirmed");
  assert.equal(f.processes.length, 2, "Unconfirmed cleanup cannot start another authenticated process");
  f.processes[1].stopAllowed = true;
  await restarted.sendMessage(f.context, { message: "Current account", messageId: "other" });
  assert.equal(f.processes[1].stopped, true);
  assert.equal(f.processes[2].options.resume, true);
  assert.equal(f.processes[2].options.sessionId, f.processes[0].options.sessionId);
  await restarted.closeSession(f.context);
  const changedRestart = createClaudeSessionAgentProvider(f.providerOptions);
  assert.equal((await changedRestart.describeProvider(f.context)).accountIdentitySignature, changed.accountIdentitySignature);
  await changedRestart.sendMessage(f.context, { message: "Continue on the current account", messageId: "current-resume" });
  assert.equal(f.processes[3].options.resume, true);
  assert.equal(f.processes[3].options.sessionId, f.processes[0].options.sessionId);
  assert.equal(f.processes.length, 4);
});

test("Claude requires an authenticated account identity before starting a native conversation", async (t) => {
  const f = await fixture(t);
  f.behavior.account = { loggedIn: false };
  await assert.rejects(f.provider.sendMessage(f.context, { message: "Work" }),
    (error) => error.code === "vibe64_claude_account_required");
  assert.equal(f.processes.length, 0);
});

test("Claude account inspection failures do not ask a connected user to sign in again", async (t) => {
  const f = await fixture(t);
  for (const detail of ["spawn claude EACCES", "Claude auth status timed out.", "Claude Code returned an invalid account status."]) {
    f.behavior.account = { loggedIn: false, error: detail };
    await assert.rejects(f.provider.sendMessage(f.context, { message: "Work" }), error => {
      assert.equal(error.code, "vibe64_claude_account_status_failed");
      assert.match(error.message, /account status could not be checked/);
      assert.ok(error.message.includes(detail));
      assert.doesNotMatch(error.message, /Sign in/);
      return true;
    });
  }
  assert.equal(f.processes.length, 0);
});



test("Claude model settings use the current workspace account without requiring the previous login", async t => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "Work", messageId: "before-account-change" });
  const before = await f.provider.sessionState(f.context);
  await f.provider.invalidateRuntimes({}, { provider: "claude", reason: "claude-auth-change" });
  f.behavior.account = { ...f.behavior.account, email: "current@example.test" };
  const next = defineVibe64AssistantSelection({ ...f.context.assistantSelection, modelId: "haiku", variantId: "" });
  const selected = { ...f.context, assistantSelection: next,
    session: { ...f.context.session, metadata: { ...f.context.session.metadata, assistant_selection: JSON.stringify(next) } } };
  const changed = await f.provider.updateSessionSettings(selected, { threadId: before.thread.id, model: next.modelId, effort: next.variantId });
  assert.notEqual(changed.ok, false, JSON.stringify(changed));
  assert.equal(f.processes[0].stopped, true);
  await f.provider.sendMessage(selected, { message: "Continue", messageId: "after-account-change" });
  const resumed = f.processes.at(-1);
  assert.equal(resumed.options.sessionId, before.thread.id);
  assert.equal(resumed.options.resume, true);
  assert.equal(resumed.options.model, "haiku");
});

test("Claude next-turn settings reach the retained native owner while the current turn stays active", async t => {
  const f = await fixture(t);
  const sent = await f.provider.sendMessage(f.context, { message: "Keep working", messageId: "active-settings" });
  assert.notEqual(sent.ok, false, JSON.stringify(sent));
  const before = await f.provider.sessionState(f.context);
  assert.equal(before.turn.active, true);
  const native = f.processes[0];
  const initialRequests = native.requests.length;
  const initialMessages = f.written.length;
  const next = defineVibe64AssistantSelection({ ...f.context.assistantSelection, modelId: "haiku", variantId: "" });
  const selected = { ...f.context, assistantSelection: next,
    session: { ...f.context.session, metadata: { ...f.context.session.metadata, assistant_selection: JSON.stringify(next) } } };
  const changed = await f.provider.updateSessionSettings(selected, { threadId: before.thread.id, model: next.modelId, effort: next.variantId });
  assert.notEqual(changed.ok, false, JSON.stringify(changed));
  assert.equal(f.processes.length, 1);
  assert.equal(native.stopped, false);
  assert.deepEqual(native.requests.slice(initialRequests).map(({ subtype }) => subtype), ["apply_flag_settings", "set_model"]);
  assert.deepEqual(native.requests.at(-1), { subtype: "set_model", model: "haiku" });
  assert.equal(native.requests.at(-2).settings.effortLevel, null);
  const after = await f.provider.sessionState(selected);
  assert.equal(after.turn.active, true);
  assert.equal(after.thread.id, before.thread.id);
  assert.equal(after.turn.turnId, before.turn.turnId);
  assert.equal(f.written.length, initialMessages, "settings are not submitted as a new chat or goal command");
});

test("Claude changes model and effort through native controls without restarting the conversation", async (t) => {
  const f = await fixture(t);
  const first = await f.provider.sendMessage(f.context, { message: "Hello", messageId: "initial" });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Ready." });
  await (await f.open()).wait();
  const native = f.processes[0];
  const requests = [];
  native.client.request = async (request) => { requests.push(request); return {}; };
  f.context.assistantSelection = defineVibe64AssistantSelection({ ...f.context.assistantSelection, modelId: "haiku", variantId: "" });
  await f.context.runtime.store.writeMetadataValue("test", "assistant_selection", JSON.stringify(f.context.assistantSelection));
  const second = await f.provider.ensureSession(f.context);
  assert.equal(second.thread.id, first.thread.id);
  assert.deepEqual(requests.map(({ subtype }) => subtype), ["apply_flag_settings", "set_model"]);
  assert.equal(requests[0].settings.effortLevel, null);
  assert.deepEqual(requests[1], { subtype: "set_model", model: "haiku" });
  f.context.assistantSelection = defineVibe64AssistantSelection({ ...f.context.assistantSelection, modelId: "sonnet", variantId: "low" });
  await f.context.runtime.store.writeMetadataValue("test", "assistant_selection", JSON.stringify(f.context.assistantSelection));
  await f.provider.ensureSession(f.context);
  assert.equal(requests.at(-2).settings.effortLevel, "low");
  assert.equal(f.processes.length, 1);
  assert.equal(native.stopped, false);
  await f.provider.sendMessage(f.context, { message: "Continue", messageId: "switched" });
  assert.equal(f.processes.length, 1);
  assert.equal(requests.length, 4);
});

test("Claude retires a process when its settings change is only partially accepted", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "Hello", messageId: "initial" });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Ready." });
  await (await f.open()).wait();
  const native = f.processes[0];
  native.client.request = async (request) => {
    if (request.subtype === "apply_flag_settings") throw new Error("Settings rejected");
    return {};
  };
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "haiku", variantId: "" };
  await assert.rejects(f.provider.ensureSession(f.context), /Settings rejected/u);
  assert.equal(native.stopped, true);
  await f.provider.sendMessage(f.context, { message: "Retry", messageId: "retry-settings" });
  assert.equal(f.processes.length, 2);
  assert.equal(f.processes[1].options.model, "haiku");
});

test("Claude reads account capabilities and allowance through an already owned process", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "Hello", messageId: "initial" });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Ready." });
  await (await f.open()).wait();
  const native = f.processes[0];
  native.client.request = async (request) => {
    assert.equal(request.subtype, "get_usage");
    return { rate_limits_available: true, rate_limits: { seven_day: { utilization: 25 } } };
  };
  assert.equal((await f.provider.capabilities(f.context)).modelProviders[0].models.length, 2);
  assert.equal((await f.provider.readPlanUsage(f.context)).windows[0].remainingPercent, 75);
  assert.equal(f.processes.length, 1);
  assert.equal(native.stopped, false);
  await f.provider.invalidateRuntimes({}, { provider: "claude", reason: "claude-auth-change" });
  assert.equal(native.stopped, true);
});

test("Claude configured defaults do not start a model discovery process", async (t) => {
  const f = await fixture(t);
  const catalog = defineVibe64AssistantCapabilities(await f.provider.capabilities(f.context, { configuredOnly: "true" }));
  assert.equal(catalog.modelProviders.find(({ id }) => id === "anthropic").connected, true);
  assert.equal(catalog.defaults.modelId, "sonnet");
  assert.equal(f.processes.length, 0);
  assert.equal((await f.provider.capabilities(f.context)).modelProviders[0].models.length, 2);
  assert.equal(f.processes.length, 1, "full configuration still reads the native model catalogue");
  assert.equal(f.processes[0].options.accountQuery, "catalogue");
});

test("Claude retains failed catalog cleanup and retries it before another query or account change", async (t) => {
  const f = await fixture(t);
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    createProcess: async (options) => {
      const native = await f.providerOptions.createProcess(options);
      native.stopAllowed = false;
      return native;
    }
  });
  await assert.rejects(provider.capabilities(f.context), /could not be stopped|cleanup could not be confirmed/u);
  await assert.rejects(provider.capabilities(f.context), /could not be stopped|cleanup could not be confirmed/u);
  assert.equal(f.processes.length, 1);
  f.processes[0].stopAllowed = true;
  assert.equal((await provider.invalidateRuntimes({}, { provider: "claude", reason: "claude-auth-change" })).ok, true);
  assert.equal(f.processes[0].stopped, true);
});

test("A failed Claude usage request still cleans up before an account change", async (t) => {
  const f = await fixture(t);
  const requested = Promise.withResolvers();
  const response = Promise.withResolvers();
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    createProcess: async (options) => {
      const native = await f.providerOptions.createProcess(options);
      native.client.request = async () => { requested.resolve(); return response.promise; };
      return native;
    }
  });
  const usage = provider.readPlanUsage(f.context);
  const rejectedUsage = assert.rejects(usage, /Native usage unavailable/u);
  await requested.promise;
  response.reject(new Error("Native usage unavailable"));
  await rejectedUsage;
  const retired = provider.invalidateRuntimes({}, { provider: "claude", reason: "claude-auth-change" });
  assert.equal((await retired).ok, true);
  assert.equal(f.processes[0].stopped, true);
});

test("Claude goals use native commands, preserve the goal on pause and reject stale actions", async (t) => {
  const f = await fixture(t);
  let timestamp = Date.now();
  f.behavior.afterSend = async (native, message) => {
    const directory = path.join(f.root, "config", "projects", native.options.workdir.replace(/[^a-zA-Z0-9]/gu, "-"));
    await mkdir(directory, { recursive: true });
    const condition = message.slice(6);
    await writeFile(path.join(directory, `${native.options.sessionId}.jsonl`), nativeGoalFrames(native, condition, timestamp++).map(JSON.stringify).join("\n") + "\n");
    if (condition === "clear") await native.options.onEvent({ type: "result", subtype: "success", local_command: "goal", user_message_uuid: native.lastInput.messageId, result: "" });
  };
  const started = await f.provider.updateGoal(f.context, { action: "set", objective: "Tests pass" });
  assert.equal(f.processes[0].lastInput.message, "/goal Tests pass");
  assert.equal(started.goal.status, "active");
  const action = { threadId: started.threadId, objective: started.goal.objective, createdAt: started.goal.createdAt };
  await assert.rejects(f.provider.updateGoal(f.context, { ...action, action: "pause", createdAt: -1 }), /goal changed/u);
  const paused = await f.provider.updateGoal(f.context, { ...action, action: "pause" });
  assert.equal(f.processes[0].stopped, true);
  assert.equal(paused.goal.status, "paused");
  const resumed = await f.provider.updateGoal(f.context, { ...action, action: "resume" });
  assert.equal(f.processes[1].options.resume, true);
  assert.equal(resumed.goal.status, "active");
  const cancelled = await f.provider.updateGoal(f.context, { action: "cancel", threadId: resumed.threadId,
    objective: resumed.goal.objective, createdAt: resumed.goal.createdAt });
  assert.equal(cancelled.goal, null);
  assert.equal(f.processes.at(-1).lastInput.message, "/goal clear");
  await assert.rejects(f.provider.updateGoal(f.context, { action: "set", objective: "Tests pass", tokenBudget: 100 }), /token budget/u);
});


test("Claude helper choices apply to new tasks without changing an already resolved task", async (t) => {
  const f = await fixture(t);
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "sonnet" };
  const selected = await f.provider.resolveExecutionProfile(f.context, { profileId: "helper", workloadId: "commit_title" });
  assert.equal(selected.model, "sonnet");
  assert.equal(selected.thinking, f.context.assistantSelection.variantId);
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "haiku", variantId: "" };
  assert.equal((await f.provider.resolveExecutionProfile(f.context, { profileId: "helper", workloadId: "commit_title" })).model, "haiku");
  f.behavior.afterSend = (native) => native.options.onEvent({ type: "result", subtype: "success", result: "Title", uuid: "title" });
  await f.provider.runDetachedChatTurn(f.context, { prompt: "Write a title", executionProfile: selected });
  assert.equal(f.processes.at(-1).options.model, "sonnet");
  assert.equal(f.processes.at(-1).requests.at(-1).model, "sonnet");
  assert.equal(f.processes.at(-1).options.toolFree, true);
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "unavailable" };
  await assert.rejects(f.provider.resolveExecutionProfile(f.context, { profileId: "helper", workloadId: "commit_title" }), /helper model is unavailable/u);
});


test("Claude reads a historical rewound branch and its subsequent replies without exposing Undo", async (t) => {
  const f = await fixture(t);
  const ready = await f.provider.ensureSession(f.context);
  for (const messageId of ["first", "second"]) {
    await f.provider.sendMessage(f.context, { message: messageId, messageId });
    await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Done." });
  }
  const first = nativeMessageId("first");
  const second = nativeMessageId("second");
  const frames = [
    { type: "user", uuid: first, parentUuid: null, message: { content: "First" } },
    { type: "assistant", uuid: "answer-1", parentUuid: first, message: { content: [{ type: "text", text: "Retained" }] } },
    { type: "user", uuid: second, parentUuid: "answer-1", message: { content: "Second" } },
    { type: "assistant", uuid: "answer-2", parentUuid: second, message: { content: [{ type: "text", text: "Discarded" }] } }
  ];
  await writeHistory(f, ready.thread.id, frames);
  frames.push({ type: "last-prompt", leafUuid: "answer-1", explicit: true, rewound: true });
  await writeHistory(f, ready.thread.id, frames);
  assert.equal(typeof f.provider.rewindConversation, "undefined");
  let history = await readClaudeHistory({ configRoot: path.join(f.root, "config"), workdir: f.context.session.metadata.source_path, conversationId: ready.thread.id });
  assert.deepEqual(history.userIds, [first]);
  assert.deepEqual(history.messages.map((message) => message.text), ["Retained"]);
  frames.push(
    { type: "user", uuid: nativeMessageId("replacement"), parentUuid: "answer-1", message: { content: "Replacement" } },
    { type: "assistant", uuid: "answer-3", parentUuid: nativeMessageId("replacement"), message: { content: [{ type: "text", text: "New branch" }] } }
  );
  await writeHistory(f, ready.thread.id, frames);
  history = await readClaudeHistory({ configRoot: path.join(f.root, "config"), workdir: f.context.session.metadata.source_path, conversationId: ready.thread.id });
  assert.deepEqual(history.messages.map((message) => message.text), ["Retained", "New branch"]);
  const inspected = await readClaudeHistory({ configRoot: path.join(f.root, "config"), workdir: f.context.session.metadata.source_path,
    conversationId: ready.thread.id, includeUserMessages: true, includeFinalCarriers: true });
  assert.deepEqual(inspected.userMessages, [{ id: first, text: "First" }, { id: nativeMessageId("replacement"), text: "Replacement" }],
    "Opt-in input custody follows the same original selected rewind branch");
  assert.deepEqual(inspected.structuredOutputs, []);
  assert.deepEqual(inspected.completedResults, []);
  assert.deepEqual(inspected.failedResults, []);
});


test("persistent Claude waits beyond three minutes but retains completion, Stop and bounded deadlines", async (t) => {
  const f = await fixture(t, { scopedConversations: true });
  for (const outcome of ["complete", "stop", "deadline", "helper"]) {
    const abort = new AbortController();
    const context = { assistantSelection: f.context.assistantSelection, signal: abort.signal, sessionId: "persistent_wait",
      assistantScope: { id: "persistent_wait", stableContext: "Answer the supplied request.", environment: {}, workdir: f.root, runtimeRoot: path.join(f.root, "wait-runtime") } };
    const executionProfile = outcome === "helper"
      ? await f.provider.resolveExecutionProfile(context, { profileId: "helper", workloadId: "request_routing" }) : undefined;
    const { conversationId } = await f.provider.createConversation(context, { persistent: true, executionProfile });
    await f.provider.startConversationTurn(context, { conversationId, persistent: true, executionProfile,
      message: "Investigate", messageId: outcome });
    const subscribed = Promise.withResolvers();
    const addListener = abort.signal.addEventListener.bind(abort.signal);
    t.mock.method(abort.signal, "addEventListener", (...args) => {
      addListener(...args);
      subscribed.resolve();
    });
    t.mock.timers.enable({ apis: ["setTimeout"] });
    try {
      let settled = false;
      const pending = f.provider.waitForConversationTurn(context, {
        conversationId, ...(["deadline", "helper"].includes(outcome) ? { timeoutMs: 200_000 } : {})
      });
      void pending.then(() => { settled = true; }, () => { settled = true; });
      await subscribed.promise;
      t.mock.timers.tick(outcome === "helper" ? executionProfile.limits.timeoutMs - 1 : 180_001);
      await new Promise((resolve) => setImmediate(resolve));
      assert.equal(settled, false, "retained interactive work has no default Helper deadline");
      if (outcome === "complete") {
        await f.processes.at(-1).options.onEvent({ type: "result", subtype: "success", result: "Finished" });
        assert.equal((await pending).status, "completed");
      } else if (outcome === "stop") {
        abort.abort();
        assert.equal((await pending).status, "interrupted");
      } else {
        t.mock.timers.tick(outcome === "helper" ? 1 : 19_999);
        await assert.rejects(pending, /time limit/);
        assert.equal(f.processes.at(-1).stopped, true, "deadline failure waits for native Stop proof");
      }
    } finally {
      t.mock.timers.reset();
      await f.provider.stopConversation(context, { conversationId });
    }
  }
});

test("temporary Claude accepts active-turn steering in its existing native conversation", async (t) => {
  const f = await fixture(t, { scopedConversations: true });
  const forwarded = [];
  f.context.routingConversationId = "saved-temporary";
  f.context.onEvent = event => { if (event.type === "message") forwarded.push(structuredClone(event)); };
  const { conversationId } = await f.provider.createConversation(f.context, { persistent: true });
  const first = await f.provider.startConversationTurn(f.context, { conversationId, persistent: true, message: "Investigate", messageId: "first" });
  const guided = await f.provider.startConversationTurn(f.context, { conversationId, persistent: true, steer: true, message: "Read logs first", messageId: "guidance" });
  assert.equal(guided.ok, true);
  assert.equal(guided.runId, first.runId);
  assert.equal(f.processes.length, 1);
  assert.equal(f.processes[0].lastInput.message, "Read logs first");
  const receive = f.processes[0].options.onEvent;
  await receive({ type: "stream_event", event: { type: "message_start", message: { id: "temporary-api" } } });
  await receive({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text" } } });
  await receive({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { text: "Reading the logs." } } });
  await receive({ type: "assistant", uuid: "temporary-frame", message: { id: "temporary-api", content: [{ type: "text", text: "Reading the logs." }] } });
  await receive({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "tool_use" } } });
  assert.equal(forwarded.length, 2);
  assert.deepEqual(forwarded.map(event => [event.threadId, event.turnId]), [[conversationId, first.runId], [conversationId, first.runId]]);
  assert.equal(forwarded[0].message.id, "claude_temporary-api_0");
  assert.equal(forwarded[0].message.complete, false);
  assert.equal(forwarded[1].message.id, "claude_temporary-frame_0");
  assert.equal(forwarded[1].message.outputId, forwarded[0].message.id);
  assert.equal(forwarded[1].message.complete, true);
  const observed = await f.provider.readConversation(f.context, { conversationId, persistent: true });
  assert.deepEqual(observed.messages.find(message => message.id === forwarded[1].message.id),
    { ...forwarded[1].message, requestMessageId: "" }); // No canonical Main request owns this native temporary frame.
  assert.equal(f.written.length, 0, "temporary steering stays out of main History");
  await f.provider.stopConversation(f.context, { conversationId, persistent: true });
});


test("Claude shared API access requires native verification and reports connection identity without inference", async (t) => {
  const f = await fixture(t);
  const native = await f.provider.assistantAccess(f.context);
  assert.equal(native.ownerOnly, true);
  assert.equal(native.available, true);
  assert.match(native.connectionIdentity, /^sha256:[a-f0-9]{64}$/);
  f.behavior.account.email = "different@example.test";
  assert.notEqual((await f.provider.assistantAccess(f.context)).connectionIdentity, native.connectionIdentity);
  for (const providerId of ["deepseek", "zai-coding-plan"]) {
    const root = path.join(f.providerOptions.systemRoot, "ai-connections", "codex", providerId);
    await mkdir(path.join(root, "auth", "codex"), { recursive: true });
    await writeFile(path.join(root, "connection.json"), JSON.stringify({ apiKey: "private-key", claudeReady: false }));
    await writeFile(path.join(root, "auth", "codex", "status.json"), JSON.stringify({ connected: true, generation: "fixture-generation" }));
    const context = { ...f.context, assistantSelection: { ...f.context.assistantSelection, modelProviderId: providerId } };
    const unchecked = await f.provider.assistantAccess(context);
    assert.equal(unchecked.available, false, "Codex key verification does not prove the Claude endpoint works");
    assert.equal(unchecked.ownerOnly, providerId !== "deepseek");
    const claudeRoot = path.join(f.providerOptions.systemRoot, "ai-connections", "claude", providerId);
    await mkdir(path.join(claudeRoot, "auth", "codex"), { recursive: true });
    await writeFile(path.join(claudeRoot, "connection.json"), JSON.stringify({ apiKey: "claude-private-key" }));
    await writeFile(path.join(claudeRoot, "auth", "codex", "status.json"), JSON.stringify({ connected: true, generation: "fixture-generation" }));
    const verified = await f.provider.assistantAccess(context);
    assert.equal(verified.available, true);
    assert.equal(verified.connectionIdentity, `curated:claude:${providerId}:fixture-generation`);
    assert.doesNotMatch(JSON.stringify(verified), /private-key/);
    const catalog = await f.provider.capabilities(context, { modelProviderId: providerId });
    assert.equal(catalog.modelProviders.find(({ id }) => id === providerId).connected, true);
  }
  assert.equal(f.processes.length, 0, "access facts and external catalogues do not start an inference process");
});

test("Claude refreshes changed system instructions while preserving the native conversation", async (t) => {
  const f = await fixture(t);
  const context = { assistantSelection: f.context.assistantSelection, sessionId: "colleague_prompt",
    assistantScope: { id: "colleague_prompt", environment: {}, workdir: f.root, runtimeRoot: path.join(f.root, "colleague-runtime"),
      stableContext: "Original product instructions." } };
  f.behavior.afterSend = async (native) => native.options.onEvent({ type: "result", subtype: "success", result: "Done" });
  const { conversationId } = await f.provider.createConversation(context, { persistent: true });
  const send = (id) => f.provider.startConversationTurn(context, { conversationId, persistent: true, message: "Check projects", messageId: id });
  await send("first");
  await send("unchanged");
  assert.equal(f.processes.length, 1, "ordinary turns retain the same instruction installation");
  context.assistantScope.stableContext = "Current product instructions and updated tools.";
  await send("changed");
  assert.equal(f.processes.length, 2);
  assert.equal(f.processes[0].stopped, true);
  assert.equal(f.processes[1].options.sessionId, conversationId);
  assert.equal(f.processes[1].options.resume, true);
  assert.equal(f.processes[1].options.instructionArguments[1], context.assistantScope.stableContext);
  assert.equal(f.processes[1].lastInput.message, "Check projects", "instructions never enter user text");
  await send("unchanged-again");
  assert.equal(f.processes.length, 2);
});

test("rejecting an instruction change during work preserves the current steering binding", async (t) => {
  const f = await fixture(t);
  const context = { assistantSelection: f.context.assistantSelection, sessionId: "colleague_prompt_busy",
    assistantScope: { id: "colleague_prompt_busy", environment: {}, workdir: f.root, runtimeRoot: path.join(f.root, "colleague-runtime"),
      stableContext: "Current instructions." } };
  const { conversationId } = await f.provider.createConversation(context, { persistent: true });
  await f.provider.startConversationTurn(context, { conversationId, persistent: true, message: "Start", messageId: "busy-first" });
  context.assistantScope.stableContext = "Changed instructions.";
  await assert.rejects(f.provider.startConversationTurn(context, {
    conversationId, persistent: true, message: "Change", messageId: "busy-change", steer: true
  }), /Stop the current Claude turn/);
  context.assistantScope.stableContext = "Current instructions.";
  await f.provider.startConversationTurn(context, {
    conversationId, persistent: true, message: "Read first", messageId: "busy-steer", steer: true
  });
  assert.equal(f.processes.length, 1);
  assert.equal(f.processes[0].lastInput.message, "Read first");
  await f.provider.stopConversation(context, { conversationId });
});

test("retained scoped Claude conversations survive restart without touching a development session", async (t) => {
  const f = await fixture(t, { scopedConversations: true });
  const original = structuredClone(f.context.session);
  const context = { assistantSelection: f.context.assistantSelection, sessionId: "colleague_test",
    assistantScope: { id: "colleague_test", environment: {}, workdir: f.root, runtimeRoot: path.join(f.root, "colleague-runtime"),
      stableContext: "Operate only the supplied product actions." } };
  const { conversationId } = await f.provider.createConversation(context, { persistent: true });
  const stopped = [];
  const restored = scopedProvider({ ...f.providerOptions,
    stopExecution: async (id) => { stopped.push(id); return { scopeEmpty: true }; } });
  assert.equal((await restored.readConversation(context, { conversationId })).status, "completed");
  await restored.startConversationTurn(context, { conversationId, persistent: true, message: "Hello", messageId: "colleague-1" });
  await writeHistory(f, conversationId, [
    { type: "user", uuid: nativeMessageId("colleague-1"), message: { content: "Hello" } },
    { type: "assistant", uuid: "reply", message: { content: [{ type: "text", text: "Welcome back" }] } }
  ], f.root);
  const restarted = scopedProvider({ ...f.providerOptions,
    stopExecution: async (id) => { stopped.push(id); return { scopeEmpty: true }; } });
  const read = await restarted.readConversation(context, { conversationId, messageId: "colleague-1" });
  assert.equal(read.text, "Welcome back");
  assert.equal(read.admitted, true);
  assert.deepEqual(stopped, ["test-0"]);
  assert.equal(f.processes.length, 1, "Reading after restart does not resend the request");
  await assert.rejects(restarted.readConversation({ ...context, sessionId: "other_user", assistantScope: {
    ...context.assistantScope, id: "other_user"
  } }, { conversationId }), /unavailable/);
  await restarted.deleteConversation(context, { conversationId });
  await assert.rejects(restarted.readConversation(context, { conversationId }), /unavailable/);
  assert.deepEqual(f.context.session, original);
  await restored.closeProject();
});

test("scoped Claude helpers use the resolved model and can stop while main chat continues", async (t) => {
  const f = await boundMainFixture(t);
  await f.provider.sendMessage(f.context, { message: "Main task", messageId: "main-task" });
  const main = f.processes[0];
  const original = structuredClone(f.context.session);
  const context = { assistantSelection: f.context.assistantSelection, sessionId: "router_job",
    assistantScope: { id: "router_job", environment: {}, workdir: f.root, runtimeRoot: path.join(f.root, "helper-runtime"),
      stableContext: "Classify only the supplied text." } };
  const executionProfile = await f.provider.resolveExecutionProfile(context, { profileId: "helper", workloadId: "request_routing" });
  assert.equal(executionProfile.model, f.context.assistantSelection.modelId);
  assert.equal(executionProfile.thinking, context.assistantSelection.variantId);
  const { conversationId } = await f.provider.createConversation(context, { ephemeral: true, executionProfile });
  await f.provider.startConversationTurn(context, { conversationId, executionProfile, message: "Classify", messageId: "helper-turn" });
  const helper = f.processes.at(-1);
  assert.notEqual(helper, main);
  assert.equal(helper.options.toolFree, true);
  assert.equal(helper.options.model, executionProfile.model);
  assert.equal(helper.options.effort, context.assistantSelection.variantId);
  assert.equal(helper.options.instructionArguments[1], context.assistantScope.stableContext);
  assert.equal(helper.options.appendSystemPrompt, undefined);
  await f.provider.stopConversation(context, { conversationId });
  assert.equal(helper.stopped, true);
  assert.equal(main.stopped, false);
  await f.provider.deleteConversation(context, { conversationId });
  assert.deepEqual(f.context.session, original);
  const continued = await f.provider.sendMessage(f.context, { message: "Continue main", messageId: "main-steer", steer: true });
  assert.equal(continued.ok, true);
  assert.equal(main.lastInput.message, "Continue main");
});

test("Claude router reasoning does not consume the structured answer limit", async (t) => {
  const f = await fixture(t, { scopedConversations: true });
  const context = { assistantSelection: f.context.assistantSelection, sessionId: "router_output",
    assistantScope: { id: "router_output", environment: {}, workdir: f.root, runtimeRoot: path.join(f.root, "helper-runtime") } };
  const executionProfile = await f.provider.resolveExecutionProfile(context, { profileId: "helper", workloadId: "request_routing" });
  const { conversationId } = await f.provider.createConversation(context, { ephemeral: true, executionProfile });
  await f.provider.startConversationTurn(context, { conversationId, executionProfile, message: "Classify", messageId: "router-output" });
  const event = f.processes.at(-1).options.onEvent;
  const thinking = "Reasoning summary. ".repeat(Math.ceil(executionProfile.limits.maxOutputCharacters / 19) + 1);
  assert.ok(thinking.length > executionProfile.limits.maxOutputCharacters);
  await event({ type: "stream_event", event: { type: "message_start", message: { id: "router-answer" } } });
  await event({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "thinking", thinking: "" } } });
  await event({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { thinking } } });
  await event({ type: "assistant", message: { id: "router-answer", content: [{ type: "thinking", thinking }] } });
  const decision = { mode: "junior", reason: "explicit_implementation" };
  await event({ type: "result", subtype: "success", structured_output: decision });
  const result = await f.provider.waitForConversationTurn(context, { conversationId });
  assert.equal(result.status, "completed");
  assert.deepEqual(JSON.parse(result.text), decision);
  assert.equal(f.written.length, 0, "helper reasoning stays outside main chat");
  await f.provider.deleteConversation(context, { conversationId });
});

test("Claude helpers still reject oversized answer text and structured results", async (t) => {
  const f = await fixture(t, { scopedConversations: true });
  const context = { assistantSelection: f.context.assistantSelection, sessionId: "helper_limit",
    assistantScope: { id: "helper_limit", environment: {}, workdir: f.root, runtimeRoot: path.join(f.root, "helper-runtime") } };
  const executionProfile = await f.provider.resolveExecutionProfile(context, { profileId: "helper", workloadId: "request_routing" });
  const { conversationId } = await f.provider.createConversation(context, { ephemeral: true, executionProfile });
  await f.provider.startConversationTurn(context, { conversationId, executionProfile, message: "Classify", messageId: "helper-limit" });
  const event = f.processes.at(-1).options.onEvent;
  const oversized = "x".repeat(executionProfile.limits.maxOutputCharacters + 1);
  await event({ type: "stream_event", event: { type: "message_start", message: { id: "oversized-answer" } } });
  await event({ type: "stream_event", event: { type: "content_block_start", index: 0, content_block: { type: "text", text: "" } } });
  await assert.rejects(event({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { text: oversized } } }), /output exceeded/u);
  await assert.rejects(event({ type: "assistant", message: { id: "oversized-answer", content: [{ type: "text", text: oversized }] } }), /output exceeded/u);
  await assert.rejects(event({ type: "result", subtype: "success", structured_output: { mode: oversized } }), /output exceeded/u);
  await f.provider.deleteConversation(context, { conversationId });
});

test("Claude changes provider controls before model and keeps the native conversation", async (t) => {
  const f = await fixture(t);
  const home = path.join(f.providerOptions.systemRoot, "ai-connections", "claude", "deepseek");
  await mkdir(path.join(home, "auth", "codex"), { recursive: true });
  await writeFile(path.join(home, "connection.json"), JSON.stringify({ apiKey: "fixture-deepseek-secret" }));
  await writeFile(path.join(home, "auth", "codex", "status.json"), JSON.stringify({ connected: true, generation: "fixture-controls" }));
  const first = await f.provider.sendMessage(f.context, { message: "Plan this", messageId: "plan" });
  const native = f.processes[0];
  await native.options.onEvent({ type: "result", subtype: "success", result: "Agreed." });
  f.context.assistantSelection = { ...f.context.assistantSelection, modelProviderId: "deepseek", modelId: "deepseek-flash" };
  const second = await f.provider.sendMessage(f.context, { message: "Implement it", messageId: "code" });
  assert.equal(second.thread.id, first.thread.id);
  assert.equal(f.processes.length, 1);
  assert.deepEqual(native.requests.slice(-2).map(({ subtype }) => subtype), ["apply_flag_settings", "set_model"]);
  const flags = native.requests.at(-2).settings;
  assert.equal(flags.includeGitInstructions, false, "provider changes preserve the host Git workflow");
  assert.equal(flags.env.ANTHROPIC_BASE_URL, "https://api.deepseek.com/anthropic");
  assert.equal(flags.env.ANTHROPIC_AUTH_TOKEN, "fixture-deepseek-secret");
  assert.equal(flags.env.ANTHROPIC_DEFAULT_HAIKU_MODEL, "deepseek-flash");
  assert.equal(flags.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "deepseek-flash[1m]");
  assert.equal(flags.env.CLAUDE_CODE_SUBAGENT_MODEL, "deepseek-flash");
  assert.equal(flags.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "786432");
  assert.equal(native.requests.at(-1).model, "deepseek-flash[1m]");
  assert.ok(flags.hooks.PreToolUse.length);
  assert.deepEqual(flags.fallbackModel, []);
  assert.ok(!JSON.stringify(native.options.env).includes("fixture-deepseek-secret"));
  await native.options.onEvent({ type: "result", subtype: "success", result: "Implemented." });
  f.context.assistantSelection = { ...f.context.assistantSelection, modelProviderId: "anthropic", modelId: "sonnet" };
  await f.provider.sendMessage(f.context, { message: "Review it", messageId: "review" });
  assert.equal(native.requests.at(-2).settings.env.ANTHROPIC_AUTH_TOKEN, "");
  assert.equal(native.requests.at(-2).settings.env.ANTHROPIC_BASE_URL, "https://api.anthropic.com");
  assert.equal(native.requests.at(-2).settings.env.ANTHROPIC_DEFAULT_SONNET_MODEL, "");
  assert.equal(native.requests.at(-2).settings.env.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "");
  assert.equal(native.requests.at(-2).settings.env.CLAUDE_CODE_SUBAGENT_MODEL, "");
  assert.equal(f.processes.length, 1);
});


test("Claude-only keys work in the catalogue, access check, chat and native terminal", async (t) => {
  const f = await fixture(t);
  const root = path.join(f.providerOptions.systemRoot, "ai-connections", "claude", "deepseek");
  await mkdir(path.join(root, "auth", "codex"), { recursive: true });
  await writeFile(path.join(root, "connection.json"), JSON.stringify({ apiKey: "claude-only-key" }));
  await writeFile(path.join(root, "auth", "codex", "status.json"), JSON.stringify({ connected: true, generation: "test" }));
  f.context.assistantSelection = { ...f.context.assistantSelection, modelProviderId: "deepseek", modelId: "deepseek-flash" };
  const access = await f.provider.assistantAccess(f.context);
  assert.equal(access.available, true);
  assert.equal(access.ownerOnly, false);
  const catalog = await f.provider.capabilities(f.context, { configuredOnly: true });
  assert.equal(catalog.modelProviders.find(({ id }) => id === "deepseek").connected, true);
  await f.provider.sendMessage(f.context, { message: "Hello", messageId: "hello" });
  const native = f.processes.at(-1);
  assert.equal(native.requests.at(-1).model, "deepseek-flash[1m]");
  await native.options.onEvent({ type: "result", subtype: "success", result: "Done" });
  await f.provider.closeProject();
  let request;
  const terminalProvider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    commandRunner: async input => { request = input; return { ok: true }; }
  });
  const claudeSettings = path.join(f.providerOptions.env.CLAUDE_CONFIG_DIR, ".claude.json");
  await mkdir(path.dirname(claudeSettings), { recursive: true });
  await writeFile(claudeSettings, JSON.stringify({ oauthAccount: { emailAddress: "fixture@example.test" } }));
  await terminalProvider.startTerminal(f.context);
  // A headless-only account must open the conversation, not first-run login setup.
  assert.deepEqual(JSON.parse(await readFile(claudeSettings, "utf8")),
    { oauthAccount: { emailAddress: "fixture@example.test" }, hasCompletedOnboarding: true });
  assert.equal(request.mode, "pty");
  assert.equal(request.args[request.args.indexOf("--model") + 1], "deepseek-flash[1m]");
  assert.equal(request.baseEnv.ANTHROPIC_AUTH_TOKEN, "claude-only-key");
  assert.equal(request.baseEnv.CLAUDE_CODE_AUTO_COMPACT_WINDOW, "786432");
  assert.equal(request.baseEnv.DISABLE_AUTOUPDATER, "1");
  assert.doesNotMatch(request.args.join(" "), /claude-only-key/u);
});

test("Claude does not send when a provider-settings acknowledgement fails", async (t) => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "First", messageId: "first" });
  const native = f.processes[0];
  await native.options.onEvent({ type: "result", subtype: "success", result: "Done." });
  native.client.request = async () => { throw new Error("Settings rejected"); };
  f.context.assistantSelection = { ...f.context.assistantSelection, variantId: "low" };
  await assert.rejects(f.provider.sendMessage(f.context, { message: "Second", messageId: "second" }), /Settings rejected/);
  assert.equal(native.lastInput.messageId, nativeMessageId("first"));
  assert.equal(native.stopped, true);
});

test("scoped Claude helper cleanup recovers the captured managed process after restart", async (t) => {
  const f = await fixture(t);
  let captured;
  const provider = scopedProvider({ ...f.providerOptions, async createProcess(options) {
    const native = await f.providerOptions.createProcess(options);
    await options.onStarted?.(native.executionId);
    return native;
  } });
  const context = { assistantSelection: f.context.assistantSelection, sessionId: "router_cleanup",
    assistantScope: { id: "router_cleanup", environment: {}, workdir: path.join(f.root, "work"), runtimeRoot: path.join(f.root, "runtime"),
      stableContext: "Classify only the supplied text." },
    async onEvent(event) { if (event.type === "helper-execution") captured = event; } };
  const executionProfile = await provider.resolveExecutionProfile(context, { profileId: "helper", workloadId: "request_routing" });
  const created = await provider.createConversation(context, { ephemeral: true, executionProfile });
  await provider.startConversationTurn(context, { conversationId: created.conversationId, executionProfile, message: "Classify", messageId: "helper-turn" });
  assert.equal(captured.conversationId, created.conversationId);
  assert.equal(captured.executionId, f.processes.at(-1).executionId);
  const stopped = [];
  let confirmStop = false;
  const restarted = scopedProvider({ ...f.providerOptions, async stopExecution(id) {
    stopped.push(id);
    return { scopeEmpty: confirmStop };
  } });
  const input = { conversationId: captured.conversationId, cleanupExecutionId: captured.executionId };
  await assert.rejects(restarted.deleteConversation(context, input), /exit has not been confirmed/);
  confirmStop = true;
  assert.equal((await restarted.deleteConversation(context, input)).deleted, true);
  assert.deepEqual(stopped, [captured.executionId, captured.executionId]);
  assert.equal(f.context.session.metadata[`claude_conversation_${captured.conversationId}`], undefined);
});

async function boundMainFixture(t, { configureProcess, runtimeFactory, actions, toolPolicy } = {}) {
  let removeFixture;
  const f = await fixture({ after(callback) { removeFixture = callback; } });
  let store;
  if (runtimeFactory) {
    f.context.runtime = await runtimeFactory(f);
    store = f.context.runtime.store;
    f.context.session = await store.readSession(f.context.sessionId);
  } else {
    store = createVibe64SessionStore({ projectContextRoot: f.root, projectRuntimeRoot: path.join(f.root, "runtime") });
    await store.createSession({ sessionId: "test", runtimeKind: "genesis" });
    for (const [key, value] of Object.entries(f.context.session.metadata)) await store.writeMetadataValue("test", key, value);
    f.context.runtime.store = store;
    f.context.runtime.getSession = id => store.readSession(id);
    f.context.session = await store.readSession("test");
  }
  let provider;
  const conversations = createConversationRuntime({ ...(actions ? { actions, toolPolicy } : {}),
    authorize: ({ context, conversationId }) => context.sessionId === conversationId,
    host: { nativeTools: true, conversation: ({ id, context, input, options, operation }) => operation === "interruptDetachedConversation" || operation === "deleteDetachedConversation"
      ? prepareSessionDetachedConversationCleanup(provider, id, context, input,
        operation === "interruptDetachedConversation" ? "interruptDetachedChatTurn" : "deleteDetachedChatThread") : operation === "inspectTemporaryActivity"
      ? prepareSessionConversationActivity(provider, id, context) : operation === "generateRenewalHandover" || operation === "seedRenewalHandover"
      ? prepareSessionConversationRenewal(provider, id, context, input) : operation === "reconcileSessions"
      ? prepareConversationReconciliation(provider, context, input, options) : operation === "closeProject"
      ? prepareProjectConversationCleanup(provider, context, input) : operation === "invalidateRuntimes"
      ? prepareConversationRuntimeInvalidation(provider, context, input) : operation === "create"
      ? prepareSessionConversationCreation(provider, id, context, input) : operation === "ensure"
      ? prepareSessionConversationReadiness(provider, id, context) : operation === "updateSettings"
      ? prepareSessionConversationSettings(provider, id, context) : operation === "dispose"
      ? prepareSessionConversationDisposal(provider, id, context, input) : createSessionConversationBinding(provider, id, {
      ...context, prepareInput: (input, current) => current.prepareInput ? current.prepareInput(input) : input
    }) }
  });
  const publications = [];
  provider = createClaudeSessionAgentProvider({ ...f.providerOptions, conversationRuntime: conversations,
    ...(configureProcess ? { createProcess: async options => {
      const native = await f.providerOptions.createProcess(options);
      configureProcess(native);
      return native;
    } } : {}),
    publishSessionChanged: async (_id, event) => publications.push(event),
    publishConversation: event => conversations.publishNative(event)
  });
  t.after(async () => {
    try { await conversations.close(); await provider.closeProject(); }
    finally { await removeFixture(); }
  });
  return { ...f, provider, store, conversations, publications,
    open: (representation = "canonical", context = f.context) => conversations.open({ id: f.context.sessionId, context, representation }) };
}

test("main Claude binds the actual provider once and adopts its original receipt, stream and steering", { timeout: 15000 }, async t => {
  const f = await boundMainFixture(t);
  const canonical = await f.open();
  assert.equal((await f.store.readSession("test")).metadata.claude_conversation_id, undefined, "open is inert");
  assert.equal(f.processes.length, 0);
  const state = await f.provider.sessionState(f.context);
  assert.ok(state.thread.id);
  assert.equal(f.processes.length, 0, "the original explicit state read selects identity without starting a process");
  const events = [];
  const receiptsBeforeAdmission = [];
  canonical.subscribe(event => {
    events.push(event);
    if (event.type === "accepted") receiptsBeforeAdmission.push(f.publications.some(publication =>
      publication.reason === "claude-stream-message-delivered" &&
      publication.payload.conversationLogPatch.turn.messages.some(message => message.messageId === event.messageId)));
  });
  let callbackThread;
  const first = await f.provider.sendMessage({ ...f.context, vibe64User: { username: "first", role: "owner" } }, {
    message: "First", messageId: "bound-first", onPromptSending({ threadId }) { callbackThread = threadId; }
  });
  assert.equal(first.delivered, true);
  assert.equal(callbackThread, state.thread.id);
  assert.equal(first.conversationTurn.messages[0].messageId, "bound-first");
  // Ordinary steering must not reinstall refreshed project guidance mid-turn.
  f.providerOptions.env.VIBE64_HOST_AGENT_GUIDANCE = "Updated host guidance for the next idle turn.";
  const second = await f.provider.sendMessage({ ...f.context, vibe64User: { username: "second", role: "owner" } }, {
    message: "Guide", messageId: "bound-second"
  });
  assert.equal(second.deliveryMode, "steer");
  assert.equal(f.processes.length, 1);
  const receive = f.processes[0].options.onEvent;
  await receive({ type: "stream_event", event: { type: "message_start", message: { id: "bound-answer" } } });
  await receive({ type: "stream_event", event: { type: "content_block_start", index: 0,
    content_block: { type: "text", text: "" } } });
  await receive({ type: "stream_event", event: { type: "content_block_delta", index: 0,
    delta: { type: "text_delta", text: "Done" } } });
  assert.ok(events.some(event => event.type === "message" && event.text === "Done"), "the original live stream reaches the common subscriber before completion");
  await receive({ type: "assistant", message: { id: "bound-answer", content: [{ type: "text", text: "Done" }] } });
  await receive({ type: "result", subtype: "success", result: "Done", uuid: "bound-result" });
  await canonical.wait();
  const turns = await f.store.readConversationLog("test");
  assert.deepEqual(turns.flatMap(turn => turn.messages).filter(message => message.role === "user").map(message => message.messageId),
    ["bound-first", "bound-second"]);
  assert.equal(turns[0].metadata.actorId, "first");
  assert.equal(turns[1].metadata.actorId, "second", "steering uses this command's actor, not the opening context");
  assert.equal(turns.flatMap(turn => turn.messages).filter(message => message.role === "assistant").length, 1);
  assert.deepEqual(events.filter(event => event.type === "accepted").map(event => event.messageId), ["bound-first", "bound-second"]);
  assert.deepEqual(receiptsBeforeAdmission, [true, true]);
  assert.ok(events.some(event => event.type === "message" && event.text === "Done"));
  const patches = events.filter(event => event.type === "transcript").map(event => event.patch);
  assert.deepEqual(patches.find(patch => patch.turn.messages.some(message => message.messageId === "bound-first")),
    { type: "upsert-turn", turn: first.conversationTurn });
  assert.deepEqual(patches.find(patch => patch.turn.messages.some(message => message.messageId === "bound-second")),
    { type: "upsert-turn", turn: second.conversationTurn });
  const finalTurn = turns.find(turn => turn.messages.some(message => message.role === "assistant" && message.text === "Done"));
  assert.deepEqual(patches.findLast(patch => patch.turn.turnId === finalTurn.turnId),
    { type: "upsert-turn", turn: finalTurn }, "completion publishes the original saved row with its unchanged grouping");
  assert.doesNotMatch(JSON.stringify(events), /"(?:nativeResult|session)"\s*:/u);
  assert.equal((await f.provider.sendMessage(f.context, { message: "First", messageId: "bound-first" })).duplicate, true);
  const metadata = (await f.store.readSession("test")).metadata;
  assert.equal(metadata.runtime, undefined);
  assert.equal(JSON.parse(metadata.assistant_changeover).engines.claude.pending, undefined);
  assert.equal(turns.some(turn => turn.metadata.runtime), false, "original rows receive no common runtime annotation");
  assert.equal(events.some(event => Object.hasOwn(event, "nativeResult") || Object.hasOwn(event, "session")), false);
  await f.provider.sendMessage(f.context, { message: "Next idle turn", messageId: "bound-third" });
  assert.equal(f.processes.length, 2, "idle admission installs the deferred guidance");
  assert.equal(f.processes[0].stopped, true);
  assert.equal(f.processes[1].options.sessionId, f.processes[0].options.sessionId);
  assert.match(f.processes[1].options.instructionArguments[1], /Updated host guidance for the next idle turn/);
});

test("main Claude preserves a native-only duplicate without inventing a canonical authored receipt", { timeout: 15000 }, async t => {
  const f = await boundMainFixture(t);
  const ready = await f.provider.ensureSession(f.context);
  await writeHistory(f, ready.thread.id, [{ type: "user", uuid: nativeMessageId("native-only"), message: { content: "Accepted" } }]);
  const canonical = await f.open();
  const events = [];
  canonical.subscribe(event => events.push(event));
  const result = await f.provider.sendMessage(f.context, { message: "Accepted", messageId: "native-only" });
  // This original assertion covers the provider's native value, without the
  // manager's separate application-routing attribution.
  for (const key of ["engineId", "providerId", "sessionId", "transportId"]) delete result[key];
  assert.deepEqual(result, { ok: true, delivered: true, duplicate: true, thread: { id: ready.thread.id }, turn: null });
  await canonical.wait();
  assert.equal(f.processes.length, 0);
  assert.deepEqual(await f.store.readConversationLog("test"), []);
  await assert.rejects(canonical.send({ text: "Accepted", messageId: "native-only" }), { code: "conversation_receipt_unavailable" });
  await canonical.wait();
  assert.equal(events.some(event => event.type === "accepted"), false);
  assert.equal((await canonical.read()).status, "ready");
  assert.equal((await canonical.read()).error, "");
  assert.equal((await f.store.readSession("test")).metadata.runtime, undefined);
  await assert.rejects(canonical.updateGoal({ action: "set", expectedSegmentId: `claude:${ready.thread.id}`,
    objective: "Accepted", messageId: "native-only" }), { code: "conversation_receipt_unavailable" });
  await canonical.wait();
  assert.deepEqual(await canonical.inspectDelivery({ messageId: "native-only" }), { status: "accepted", messageId: "native-only", duplicate: true });
  assert.equal(f.processes.length, 0, "checking a native-only goal UUID never submits another command");
  assert.deepEqual(await f.store.readConversationLog("test"), []);
  assert.equal(events.some(event => event.type === "accepted"), false);
  assert.equal((await canonical.read()).status, "ready");
});

test("main Claude raw goals retain original commands and stale identities", { timeout: 15000 }, async t => {
  const f = await boundMainFixture(t);
  const canonical = await f.open();
  assert.equal(f.processes.length, 0);
  assert.equal((await f.store.readSession("test")).metadata.claude_conversation_id, undefined);
  let timestamp = Date.now();
  f.behavior.afterSend = async (native, message) => {
    const condition = message.slice(6);
    await writeHistory(f, native.options.sessionId, nativeGoalFrames(native, condition, timestamp++));
    if (condition === "clear") await native.options.onEvent({ type: "result", subtype: "success", local_command: "goal", user_message_uuid: native.lastInput.messageId, result: "" });
  };
  const started = await f.provider.updateGoal(f.context, { action: "set", objective: "Tests pass" });
  assert.equal(started.status, "available");
  assert.equal(started.goal.status, "active");
  assert.equal(f.processes[0].lastInput.message, "/goal Tests pass");
  const expected = { threadId: started.threadId, objective: started.goal.objective, createdAt: started.goal.createdAt };
  await assert.rejects(f.provider.updateGoal(f.context, { ...expected, action: "pause", createdAt: -1 }), /goal changed/u);
  const paused = await f.provider.updateGoal(f.context, { ...expected, action: "pause" });
  assert.equal(paused.goal.status, "paused");
  assert.equal(f.processes[0].stopped, true);
  const resumed = await f.provider.updateGoal(f.context, { ...expected, action: "resume" });
  assert.equal(resumed.goal.status, "active");
  assert.equal(f.processes[1].options.resume, true);
  const cancelled = await f.provider.updateGoal(f.context, { action: "cancel", threadId: resumed.threadId,
    objective: resumed.goal.objective, createdAt: resumed.goal.createdAt });
  assert.equal(cancelled.goal, null);
  assert.equal(f.processes.at(-1).lastInput.message, "/goal clear");
  assert.equal((await canonical.read()).capabilities.goals, true);
  assert.equal((await canonical.read()).capabilities.goalCommands.set.delivery, "message");
  assert.equal((await f.store.readSession("test")).metadata.runtime, undefined);
  assert.equal((await f.store.readConversationLog("test")).some(turn => turn.metadata.runtime), false);
});

test("main Claude accepts a goal while its canonical conversation is working", async t => {
  const f = await boundMainFixture(t);
  const canonical = await f.open();
  const goalWritten = Promise.withResolvers();
  f.behavior.afterSend = async (native, message) => {
    if (!message.startsWith("/goal ")) return;
    await writeHistory(f, native.options.sessionId, nativeGoalFrames(native, message.slice(6)));
    goalWritten.resolve();
  };
  await canonical.send({ messageId: "before-goal", text: "Keep working" });
  const { segmentId } = await canonical.read();
  assert.equal(await canonical.readGoal(), null);
  const result = await canonical.updateGoal({ action: "set", expectedSegmentId: segmentId,
    objective: "Finish the work", messageId: "busy-goal" });
  assert.equal(result.status, "accepted");
  assert.equal(f.processes.length, 1);
  assert.equal(f.processes[0].stopped, false);
  assert.equal(f.processes[0].lastInput.message, "/goal Finish the work");
  await goalWritten.promise;
  assert.equal((await canonical.readGoal()).objective, "Finish the work");
  assert.equal((await canonical.readGoal()).status, "active");
});

test("main Claude canonical goals adopt original receipts and keep literal commands outside chat changeover", { timeout: 15000 }, async t => {
  const f = await boundMainFixture(t);
  const canonical = await f.open();
  const events = [];
  canonical.subscribe(event => events.push(event));
  const sent = [];
  let timestamp = Date.now();
  let goalWritten = Promise.withResolvers();
  f.behavior.afterSend = async (native, message) => {
    sent.push(message);
    if (message.startsWith("/goal ")) {
      const condition = message.slice(6);
      await writeHistory(f, native.options.sessionId, nativeGoalFrames(native, condition, timestamp++));
      goalWritten.resolve();
      if (condition !== "clear") return;
    }
    await native.options.onEvent({ type: "result", subtype: "success", result: "",
      ...(message === "/goal clear" ? { local_command: "goal", user_message_uuid: native.lastInput.messageId } : {}) });
  };
  const first = await canonical.updateGoal({ action: "set", expectedSegmentId: null,
    objective: "Tests pass", messageId: "first-goal" });
  assert.equal(first.status, "accepted");
  assert.equal(first.messageId, "first-goal");
  const metadata = (await f.store.readSession("test")).metadata;
  const segmentId = `claude:${metadata.claude_conversation_id}`;
  assert.ok(metadata.claude_conversation_id, "the original goal read selects the first native identity");
  assert.equal(metadata.assistant_changeover, undefined, "a goal does not create a chat delivery cursor");
  assert.equal(metadata.runtime, undefined);
  const firstRow = (await f.store.readConversationLog("test")).find(turn => turn.turnId === first.turnId);
  assert.equal(firstRow.user.messageId, "first-goal");
  assert.equal(firstRow.user.text, "/goal Tests pass");
  assert.equal(firstRow.metadata.runtime, undefined);
  assert.equal(firstRow.user.goal, undefined, "the original authored row has no fabricated goal descriptor");
  await goalWritten.promise;
  let goal = await canonical.readGoal();
  assert.equal(goal.status, "active");
  await assert.rejects(canonical.updateGoal({ action: "pause", expectedSegmentId: segmentId, expectedGoalId: "stale" }), /goal changed/u);
  assert.equal((await canonical.updateGoal({ action: "pause", expectedSegmentId: segmentId, expectedGoalId: goal.id })).status, "paused");
  goalWritten = Promise.withResolvers();
  const resumed = await canonical.updateGoal({ action: "resume", expectedSegmentId: segmentId,
    expectedGoalId: goal.id, messageId: "resume-goal" });
  assert.equal(resumed.status, "accepted");
  await goalWritten.promise;
  goal = await canonical.readGoal();
  const cleared = await canonical.updateGoal({ action: "cancel", expectedSegmentId: segmentId,
    expectedGoalId: goal.id, messageId: "clear-goal" });
  assert.equal(cleared.status, "accepted");
  await canonical.wait();
  assert.equal(await canonical.readGoal(), null);
  assert.deepEqual(sent, ["/goal Tests pass", "/goal clear", "/goal Tests pass", "/goal clear"]);

  await f.provider.sendMessage(f.context, { message: "Ordinary chat", messageId: "chat-before-goal" });
  await canonical.wait();
  await f.store.writeConversationAssistantMessage("test", { messageId: "late-context", text: "A later result for the chat cursor." });
  const cursor = (await f.store.readSession("test")).metadata.assistant_changeover;
  assert.ok(cursor);
  goalWritten = Promise.withResolvers();
  const next = await canonical.updateGoal({ action: "set", expectedSegmentId: segmentId,
    objective: "Follow up", messageId: "after-chat-goal" });
  assert.equal(next.status, "accepted");
  await goalWritten.promise;
  assert.equal(sent.at(-1), "/goal Follow up", "prior chat history is never rendered into a native goal command");
  assert.equal((await f.store.readSession("test")).metadata.assistant_changeover, cursor);
  const beforeDuplicate = sent.length;
  const duplicate = await canonical.updateGoal({ action: "set", expectedSegmentId: segmentId,
    objective: "An altered retry cannot replace the admitted UUID", messageId: "after-chat-goal" });
  assert.deepEqual(duplicate, { status: "accepted", messageId: "after-chat-goal", turnId: next.turnId, origin: "user", duplicate: true });
  assert.equal(sent.length, beforeDuplicate);
  assert.equal((await canonical.readGoal()).objective, "Follow up");
  const rows = await f.store.readConversationLog("test");
  assert.equal(rows.flatMap(turn => turn.messages).filter(message => message.messageId === "after-chat-goal").length, 1);
  assert.equal(rows.some(turn => turn.metadata.runtime), false);
  assert.deepEqual(events.filter(event => event.type === "accepted").map(event => event.messageId),
    ["first-goal", "resume-goal", "clear-goal", "chat-before-goal", "after-chat-goal"]);
  assert.doesNotMatch(JSON.stringify(events), /"(?:nativeResult|session)"\s*:/u);
});

test("main Claude common close retains unconfirmed ownership and replacement uses the same broad cleanup", { timeout: 15000 }, async t => {
  const f = await boundMainFixture(t);
  const native = await f.open("native");
  const sent = await f.provider.sendMessage(f.context, { message: "Work", messageId: "before-replace" });
  const temporary = await f.provider.createConversation(f.context);
  await f.provider.startConversationTurn(f.context, { conversationId: temporary.conversationId, message: "Temporary", messageId: "temporary-work" });
  f.processes[0].stopAllowed = false;
  await assert.rejects(native.dispose(f.context), /exit has not been confirmed/u);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, true);
  assert.ok(JSON.parse((await f.store.readSession("test")).metadata[`claude_conversation_${sent.thread.id}`]).executionId);
  f.processes[0].stopAllowed = true;
  let closed;
  await assert.doesNotReject(async () => { closed = await native.dispose(f.context); }, "Close retries native cleanup");
  assert.equal(closed.ok, true);
  assert.equal(closed.processExitProofs.length, 2);
  assert.equal(f.processes.every(process => process.stopped), true);
  const reopened = await f.open("native");
  const replacement = await reopened.replace({ operationId: "replace-claude", expectedSegmentId: `claude:${sent.thread.id}`,
    reason: "renewal", briefing: "Continue the original work." });
  assert.equal(replacement.replacement.status, "ready");
  assert.equal(f.processes.length, 2, "replacement does not start its successor");
  f.context.session = await f.store.readSession("test");
  const successor = await f.provider.sendMessage(f.context, { message: "Continue", messageId: "after-replace" });
  assert.notEqual(successor.thread.id, sent.thread.id);
  assert.match(f.processes.at(-1).lastInput.message, /Continue the original work/u);
  await f.provider.interruptTurn(f.context);
  const metadata = (await f.store.readSession("test")).metadata;
  assert.equal(JSON.parse(metadata.assistant_changeover).replacement.successorConversationId, successor.thread.id);
  assert.equal(metadata.runtime, undefined);
  assert.deepEqual((await f.store.readConversationLog("test")).flatMap(turn => turn.messages)
    .filter(message => message.role === "user").map(message => message.messageId), ["before-replace", "after-replace"]);
});

test("main Claude Stop remains available while the original goal acknowledgement is pending", { timeout: 15000 }, async t => {
  const sent = Promise.withResolvers();
  const inputs = [];
  const f = await boundMainFixture(t, { configureProcess(native) {
    native.client.send = async (message, input) => {
      native.lastInput = { message, ...input };
      inputs.push(native.lastInput);
      sent.resolve(native);
      // Leave the original turn owner's admission pending: neither a user
      // echo nor a queued command acknowledgement has arrived.
    };
  } });
  const canonical = await f.open();
  const events = [];
  canonical.subscribe(event => events.push(event));
  let goalSettled = false;
  const pendingGoal = f.provider.updateGoal(f.context, { action: "set", objective: "Tests pass" });
  const goalResult = pendingGoal.then(value => {
    goalSettled = true;
    return { value };
  }, error => {
    goalSettled = true;
    return { error };
  });
  const native = await sent.promise;
  assert.equal(goalSettled, false);
  assert.deepEqual(inputs.map(input => input.message), ["/goal Tests pass"]);
  assert.deepEqual(await f.store.readConversationLog("test"), []);
  let stopDeadline;
  let stopped;
  try {
    stopped = await Promise.race([
      f.provider.interruptTurn(f.context),
      new Promise((_, reject) => {
        stopDeadline = setTimeout(() => reject(new Error("Stop waited for the pending native goal acknowledgement.")), 2000);
      })
    ]);
  } finally { clearTimeout(stopDeadline); }
  assert.equal(stopped.interrupted, true);
  assert.equal(stopped.thread.id, native.options.sessionId);
  assert.equal(native.stopped, true, "the original managed stop is confirmed without a goal acknowledgement");
  const result = await goalResult;
  assert.equal(result.value, undefined);
  assert.equal(result.error?.code, "assistant_claude_turn_failed");
  assert.equal(result.error?.message, "Claude stopped before acknowledging the prompt.");
  assert.equal(inputs.length, 1, "Stop never resends or replaces the original goal message");
  const metadata = (await f.store.readSession("test")).metadata;
  assert.equal(JSON.parse(metadata[`claude_conversation_${native.options.sessionId}`]).executionId, "");
  assert.equal(metadata.runtime, undefined);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  assert.deepEqual(await f.store.readConversationLog("test"), []);
  assert.equal(events.some(event => event.type === "accepted" || event.type === "transcript"), false);
  await native.options.onEvent({ type: "user", uuid: inputs[0].messageId, session_id: native.options.sessionId });
  assert.deepEqual(await f.store.readConversationLog("test"), [], "a late acknowledgement cannot recreate the stopped admission");
});

test("main Claude canonical goal acknowledgement leaves Stop available and cannot commit a failed goal", { timeout: 15000 }, async t => {
  const sent = Promise.withResolvers();
  const inputs = [];
  const f = await boundMainFixture(t, { configureProcess(native) {
    native.client.send = async (message, input) => {
      inputs.push({ message, ...input });
      sent.resolve(native);
    };
  } });
  const canonical = await f.open();
  const events = [];
  canonical.subscribe(event => events.push(event));
  let committed = 0;
  const pending = f.provider.updateGoal({ ...f.context, canonicalGoal: true, onGoalResult: () => { committed++; } }, {
    action: "set", expectedSegmentId: null, objective: "Tests pass", messageId: "unacknowledged-goal"
  }).then(value => ({ value }), error => ({ error }));
  const native = await sent.promise;
  assert.equal(committed, 0);
  assert.deepEqual(inputs.map(input => input.message), ["/goal Tests pass"]);
  let deadline;
  try {
    assert.deepEqual(await Promise.race([canonical.cancel(), new Promise((_, reject) => {
      deadline = setTimeout(() => reject(new Error("Canonical Stop waited for goal acknowledgement.")), 2000);
    })]), { stopped: true });
  } finally { clearTimeout(deadline); }
  const result = await pending;
  assert.equal(result.value, undefined);
  assert.equal(result.error?.code, "assistant_claude_turn_failed");
  assert.equal(result.error?.message, "Claude stopped before acknowledging the prompt.");
  assert.equal(native.stopped, true);
  assert.equal(committed, 0, "a rejected command never reaches the original application post-result policy");
  assert.equal(inputs.length, 1);
  assert.deepEqual(await f.store.readConversationLog("test"), []);
  assert.equal((await f.store.readSession("test")).metadata.runtime, undefined);
  assert.equal(events.some(event => event.type === "accepted" || event.type === "transcript"), false);
  await native.options.onEvent({ type: "user", uuid: inputs[0].messageId, session_id: native.options.sessionId });
  assert.deepEqual(await f.store.readConversationLog("test"), []);
  assert.deepEqual(await canonical.inspectDelivery({ messageId: "unacknowledged-goal" }), {
    status: "unknown", messageId: "unacknowledged-goal"
  });
  assert.equal(inputs.length, 1, "inspection never resends an unproven goal command");
});


for (const busyGoal of [false, true]) test(`main Claude terminal service uses actual owners for an ${busyGoal ? "active" : "idle"} goal`, { timeout: 60000 }, async t => {
  let removeFixture;
  const f = await fixture({ after(callback) { removeFixture = callback; } });
  let service;
  t.after(async () => {
    try { await service?.close(); }
    finally { await removeFixture(); }
  });
  let recoveryLockContended;
  const store = createVibe64SessionStore({ projectContextRoot: f.root, projectRuntimeRoot: path.join(f.root, "runtime"),
    logger: { warn(record) {
      if (record.operation === "resume-agent-goal" && ["vibe64.session_lock.contended", "vibe64.session_lock.rejected"].includes(record.event)) {
        recoveryLockContended?.resolve(record);
      }
    } } });
  await store.createSession({ sessionId: "test", runtimeKind: "genesis",
    metadata: { ...f.context.session.metadata, label: "BoundClaude" } });
  const runtime = { ...f.context.runtime, stateRoot: path.join(f.root, "runtime"),
    projectContextRoot: f.root, store, getSession: id => store.readSession(id),
    listSessions: async () => [await store.readSession("test")] };
  const projectService = {
    ...f.providerOptions.projectService,
    createRuntime: () => runtime,
    createSessionStore: () => store,
    currentServiceDataRoot: () => path.join(f.root, "service-data"),
    currentTargetRoot: () => f.root,
    readCurrentProject: async () => ({ path: f.root, projectContextRoot: f.root,
      sourceRoot: f.context.session.metadata.source_path, slug: "claude-main-fixture" }),
    projectInspectionEnvironment: async () => ({ VIBE64_RUNTIME_NAMESPACE: "test", VIBE64_WORKSPACE: "test" }),
    projectExecutionEnvironment: async () => ({}),
    readEnv: async () => ({ ok: true, records: [] }),
    runInProjectContext: async (_context, operation) => operation(),
    saveEnvUserValues: async () => ({ ok: true })
  };
  // Only native inference is synthetic. The service, manager, provider, shared
  // runtime, managed process transport and original session store are real.
  const command = path.join(f.root, "service-claude.cjs");
  const tracePath = path.join(f.root, "service-claude-trace.jsonl");
  const goalAcknowledgementGate = path.join(f.root, "hold-goal-acknowledgement");
  const goalAttachmentGate = path.join(f.root, "hold-goal-attachment");
  const recoveryToolProbe = path.join(f.root, "probe-recovery-tool-authority");
  await writeFile(command, `#!${process.execPath}
const { createInterface } = require('node:readline');
const { appendFileSync, existsSync, mkdirSync } = require('node:fs');
const path = require('node:path');
const args = process.argv.slice(2);
const emit = value => process.stdout.write(JSON.stringify(value) + '\\n');
const trace = value => appendFileSync(${JSON.stringify(tracePath)}, JSON.stringify(value) + '\\n');
trace({ args, pid: process.pid });
if (args[0] === 'auth') {
  emit({ loggedIn: true, authMethod: 'claude.ai', email: 'owner@example.test' });
  process.exit(0);
}
const flag = args.includes('--resume') ? '--resume' : '--session-id';
const conversationId = args[args.indexOf(flag) + 1];
const directory = path.join(process.env.CLAUDE_CONFIG_DIR, 'projects', process.cwd().replace(/[^a-zA-Z0-9]/gu, '-'));
mkdirSync(directory, { recursive: true });
const record = value => appendFileSync(path.join(directory, conversationId + '.jsonl'), JSON.stringify(value) + '\\n');
const pauseTool = (name, id, input) => {
  emit({ type: 'assistant', uuid: id + '-message', message: { content: [
    { type: 'tool_use', id, name: 'mcp__application__' + name, input }
  ] } });
  emit({ type: 'control_request', request_id: id, request: { subtype: 'mcp_message', server_name: 'application',
    message: { jsonrpc: '2.0', id, method: 'tools/call', params: { name, arguments: input, _meta: { 'claudecode/toolUseId': id } } }
  } });
};
createInterface({ input: process.stdin }).on('line', async line => {
  const frame = JSON.parse(line);
  trace({ frame });
  if (frame.type === 'control_request') {
    if (frame.request.subtype === 'initialize') emit({ type: 'system', subtype: 'init', capabilities: ['interrupt_send_now_v1'] });
    emit({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id,
      response: { models: [{ value: 'sonnet', supportedEffortLevels: ['high'] }] } } });
    if (frame.request.subtype === 'interrupt') emit({ type: 'result', subtype: 'success', terminal_reason: 'aborted_streaming', result: '' });
    return;
  }
  if (frame.type === 'control_response' && ['self-pause-contract', 'self-block-contract', 'self-block-goal-contract'].includes(frame.response.request_id)) {
    const action = frame.response.request_id.startsWith('self-block') ? 'block' : 'pause';
    pauseTool('assistant_action_execute', frame.response.request_id.replace('-contract', '-execute'), { actionId: 'vibe64.terminals.main-goal.' + action, version: 1,
      input: action === 'block' ? { reason: 'The human must supply the missing approval code.' } : {} });
    return;
  }
  if (frame.type === 'control_response' && frame.response.request_id.endsWith('-execute')) {
    const receipt = { type: 'user', message: { content: [{ type: 'tool_result',
      tool_use_id: frame.response.request_id, content: JSON.stringify(frame.response.response) }] } };
    record(receipt);
    emit(receipt);
    return;
  }
  if (frame.type !== 'user') return;
  record(frame);
  const text = frame.message.content;
  if (text.startsWith('/goal ')) {
    while (existsSync(${JSON.stringify(goalAcknowledgementGate)})) await new Promise(resolve => setTimeout(resolve, 5));
    emit(frame);
    while (existsSync(${JSON.stringify(goalAttachmentGate)})) await new Promise(resolve => setTimeout(resolve, 5));
    const condition = text.slice(6);
    const marker = { type: 'attachment', uuid: frame.uuid + '-goal', timestamp: new Date().toISOString(), attachment: {
      type: 'goal_status', condition: condition === 'clear' ? 'Tests pass' : condition, sentinel: true, met: condition === 'clear'
    } };
    record(marker);
    record({ ...frame, parentUuid: marker.uuid });
    if (condition === 'clear') emit({ type: 'result', subtype: 'success', local_command: 'goal', user_message_uuid: frame.uuid, result: '' });
    if (condition === 'BLOCK_ON_GOAL') setTimeout(() => pauseTool('assistant_action_contract', 'self-block-goal-contract', { actionId: 'vibe64.terminals.main-goal.block', version: 1 }), 50);
    if (condition !== 'clear' && existsSync(${JSON.stringify(recoveryToolProbe)})) setTimeout(() => pauseTool('assistant_action_contract', 'recovery-authority-contract', { actionId: 'vibe64.terminals.main-goal.pause', version: 1 }), 50);
    return;
  }
  emit(frame);
  if (text.includes('Pause through the admitted application tool.') || text.includes('Block through the admitted application tool.')) {
    const action = text.includes('Block through') ? 'block' : 'pause';
    pauseTool('assistant_action_contract', 'self-' + action + '-contract', { actionId: 'vibe64.terminals.main-goal.' + action, version: 1 });
    return;
  }
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: frame.uuid + '-reply' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Service progress' } } });
});
`, { mode: 0o700 });
  const publications = [];
  const streamed = Promise.withResolvers();
  const deliveryDiagnostics = [];
  const firstResponseTiming = Promise.withResolvers();
  const recordDeliveryDiagnostic = record => {
    deliveryDiagnostics.push(record);
    if (record.event === "vibe64.agent_message.delivery_timing" && record.stage === "first-response") firstResponseTiming.resolve();
  };
  const actions = createActionCatalogue();
  const actor = { username: "service-owner", uid: 73, role: "owner" };
  let recoveredActorReads = 0;
  const createService = () => {
    const value = createTerminalService({ projectService, actions,
    logger: { info: recordDeliveryDiagnostic, warn: recordDeliveryDiagnostic, error: recordDeliveryDiagnostic },
    env: { ...f.providerOptions.env, VIBE64_CLAUDE_COMMAND: command, JSKIT_REALTIME_DEBUG: "1",
      VIBE64_SYSTEM_ROOT: path.join(f.root, "system"), VIBE64_RUNTIME_NAMESPACE: "test", VIBE64_WORKSPACE: "test" },
    codexTerminalController: { codexToolHomeRequired: false,
      codexAppServerProviderOptions: { systemRoot: path.join(f.root, "system") } },
    publishSessionChanged: { agentTerminal: async (_sessionId, event) => {
      publications.push(event);
      if (event.reason === "assistant-stream" && event.payload.conversationStream.messages.some(message => message.text === "Service progress")) streamed.resolve();
    } }
  });
    value.configureAssistantRuntime({
      resolveAssistantUser: async user => user?.username === actor.username ? actor : user,
      createActionContext(user) {
        assert.equal(user.username, actor.username);
        return { channel: "internal", surface: "app", resolveAssistantUser: async () => {
          recoveredActorReads++; return actor;
        } };
      },
      authorizeProjectMessage: async user => user?.username === actor.username ? actor : user
    });
    return value;
  };
  service = createService();
  const options = { runtime, vibe64User: actor };
  const originalGoalRequest = { headers: { cookie: "fixture-session" } };
  let requireGoalRequest = false;
  registerVibe64ActionContext(actions, {
    projectContext: { projectsRoot: path.dirname(f.root), async readWorkspaceProject() {
      return { project: { projectRoot: f.root, projectRuntimeRoot: runtime.stateRoot } };
    } },
    resolveUser: async ({ request, context }) => typeof context.resolveAssistantUser === "function"
      ? context.resolveAssistantUser()
      : !requireGoalRequest || request?.headers?.cookie === originalGoalRequest.headers.cookie ? actor : null,
    authorizeProject: async ({ slug }) => assert.equal(slug, "claude-main-fixture")
  });
  // Daemon recreation below must leave the browser facade using the current owner.
  const terminals = new Proxy({}, { get: (_target, key) => service[key] });
  const sessions = createSessionService({ actions, project: projectService, terminals });
  actions.register({ contributorId: "test.claude-main-goals", domain: "vibe64",
    actions: [...createSessionActions({ sessions }), ...createTerminalActions({ terminals })]
      .map(definition => ({ channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition })) });
  const goalFacade = await sessions.browserConversations.open({
    id: mainConversationId({ projectSlug: "claude-main-fixture", sessionId: "test" }), context: { channel: "internal", surface: "app", requestMeta: { request: originalGoalRequest } }
  });
  const goalProject = (await actions.execute({ actionId: ACTION_READ_CONVERSATION_CONTEXT,
    input: { projectSlug: "claude-main-fixture", sessionId: "test" }, context: { channel: "internal", surface: "app" } })).project;
  // Keep raw service calls in the same project namespace; each command still supplies its own actor.
  await runWithProjectRequestContext({ ...goalProject, vibe64User: null }, async () => {
    const emptyGoalRead = await goalFacade.readGoal();
    assert.equal(emptyGoalRead.status, "available");
    assert.equal(emptyGoalRead.goal, null);
    const state = await service.agentSessionState("test", { ...options, session: await store.readSession("test") });
    assert.ok(state.thread.id);
    const browserAuthority = { sessionId: "test", projectSlug: "claude-main-fixture", actorId: String(actor.uid),
      requestContext: { channel: "internal", surface: "app" } };
    const browser = await service.openBrowserConversation("test", { ...options, browserAuthority });
    const releaseBrowser = await browser.subscribe(() => {});
    await browser.read();
    releaseBrowser();
    await assert.rejects(service.openBrowserConversation("test", { ...options,
      browserAuthority: { ...browserAuthority, actorId: "another-person" } }), { code: "conversation_forbidden" });
    const browserTimings = deliveryDiagnostics.filter(event => event.event === "vibe64.conversation.browser_timing");
    assert.ok(browserTimings.some(event => event.phase === "session-read" && event.completed));
    assert.ok(browserTimings.some(event => event.phase === "native-open" && event.completed));
    for (const operation of ["open", "read"]) {
      assert.ok(browserTimings.some(event => event.phase === "authorization" && event.operation === operation && event.allowed));
    }
    assert.ok(browserTimings.filter(event => event.phase === "authorization" && event.operation === "subscribe")
      .every(event => !event.allowed || event.durationMs >= 100), "Healthy streaming checks do not log per token");
    assert.ok(browserTimings.some(event => event.phase === "authorization" && event.allowed === false));
    assert.ok(browserTimings.every(event => Number.isFinite(event.durationMs) && event.durationMs >= 0));
    assert.equal(JSON.stringify(browserTimings).includes(actor.username), false);
    assert.equal(emptyGoalRead.target.segmentId, `claude:${state.thread.id}`,
      "the empty-goal read returns its selected identity without a second target lookup");
    const trace = async () => {
      try { return (await readFile(tracePath, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    };
    assert.equal((await trace()).some(row => row.args?.includes("--print")), false, "inspection does not start native inference");
    await assert.rejects(goalFacade.updateGoal({ action: "set", objective: "clear", messageId: "invalid-goal-condition",
      expectedSegmentId: emptyGoalRead.target.segmentId }), {
      code: "conversation_invalid_goal", statusCode: 400, delivery: "not-sent"
    });
    assert.notEqual(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent || "null")?.active, true,
      "pre-dispatch validation cannot leave an active continuation intent behind");
    assert.equal((await trace()).some(row => row.frame?.type === "user"), false);
    const request = { message: "Work", messageId: "service-main" };
    const sent = await service.sendAgentMessage("test", request, options);
    assert.equal(sent.delivered, true);
    assert.equal(sent.thread.id, state.thread.id);
    await streamed.promise;
    await firstResponseTiming.promise;
    const timingStages = deliveryDiagnostics.filter(event => event.event === "vibe64.agent_message.delivery_timing" &&
      event.messageId === request.messageId).map(event => event.stage);
    const milestones = ["received", "preparation-started", "provider-started", "runtime-ready",
      "dispatch-started", "native-acknowledged", "receipt-persisted", "accepted"];
    // Finer marks may appear between these milestones; the milestones keep their order.
    assert.deepEqual(timingStages.filter(stage => milestones.includes(stage)).slice(0, 8), milestones);
    if (timingStages.includes("authorized")) assert.ok(timingStages.includes("git-actor"), "Preparation marks its Git actor on the delivery observer.");
    assert.equal(timingStages.filter(stage => stage === "first-response").length, 1);
    assert.ok(deliveryDiagnostics.some(event => event.event === "vibe64.agent_message.lock_acquired" && event.messageId === request.messageId));
    assert.ok(deliveryDiagnostics.some(event => event.event === "vibe64.agent_message.delivery_finished" && event.delivered));
    assert.equal(JSON.stringify(deliveryDiagnostics.filter(event => event.event?.startsWith("vibe64.agent_message."))).includes('"Work"'), false);
    assert.ok(publications.some(event => event.reason === "claude-stream-message-delivered"));
    assert.equal((await service.agentSessionState("test", { ...options, session: await store.readSession("test") })).turn.active, true);
    assert.equal((await service.sendAgentMessage("test", request, options)).duplicate, true);
    let rows = await store.readConversationLog("test");
    assert.deepEqual(rows.flatMap(turn => turn.messages).filter(message => message.role === "user").map(message => message.messageId), ["service-main"]);
    assert.equal(rows[0].metadata.actorId, actor.username);
    assert.equal((await trace()).filter(row => row.frame?.type === "user").length, 1, "duplicate delivery never invokes native Send again");
    assert.equal((await trace()).filter(row => row.args?.includes("--print")).length, 1);
    const stopped = await service.interruptAgentTurn("test", {}, options);
    assert.equal(stopped.interrupted, true);
    const nativePid = (await trace()).find(row => row.args?.includes("--print")).pid;
    assert.throws(() => process.kill(nativePid, 0), { code: "ESRCH" }, "Stop returns only after the managed native process has exited");
    assert.equal((await service.agentSessionState("test", { ...options, session: await store.readSession("test") })).turn.active, false);
    assert.equal(JSON.parse((await store.readSession("test")).metadata[`claude_conversation_${state.thread.id}`]).executionId, "");

    async function startGoal(input, representation) {
      const before = (await trace()).filter(row => row.frame?.type === "user").length;
      const deadline = Date.now() + 5000;
      let result;
      for (;;) {
        result = representation?.canonical
          ? await goalFacade.updateGoal(input)
          : await service.updateAgentGoal("test", { ...options, ...input }, representation);
        if (result?.ok !== false || result.code !== "vibe64_agent_write_mode_busy" || result.retryable !== true) break;
        assert.equal((await trace()).filter(row => row.frame?.type === "user").length, before,
          "the original write-mode busy response rejects before native goal admission");
        if (Date.now() >= deadline) break;
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      return result;
    }
    const started = await startGoal({ action: "set", objective: "Tests pass" });
    assert.equal(started.ok, true, JSON.stringify(started));
    assert.equal(started.threadId, state.thread.id);
    assert.equal(started.goal.status, "active");
    const goal = { threadId: started.threadId, createdAt: started.goal.createdAt, objective: started.goal.objective };
    await assert.rejects(service.updateAgentGoal("test", { ...options, ...goal, action: "pause", createdAt: -1 }), /goal changed/u);
    const paused = await service.updateAgentGoal("test", { ...options, ...goal, action: "pause" });
    assert.equal(paused.goal.status, "paused");
    assert.equal((await service.readAgentGoal("test", options)).goal.status, "paused");
    assert.deepEqual((await trace()).filter(row => row.frame?.type === "user").map(row => row.frame.message.content), ["Context: Work", "/goal Tests pass"]);
    assert.equal((await trace()).filter(row => row.args?.includes("--print")).length, 2);
    rows = await store.readConversationLog("test");
    assert.equal(rows.flatMap(turn => turn.messages).filter(message => message.role === "user").length, 2);
    assert.equal(rows.some(turn => turn.metadata.runtime), false);
    const metadata = (await store.readSession("test")).metadata;
    assert.equal(metadata.runtime, undefined);
    assert.equal(JSON.parse(metadata.assistant_changeover).engines.claude.pending, undefined);
    assert.equal(metadata.claude_conversation_id, state.thread.id);

    await service.updateAgentGoal("test", { ...options, ...goal, action: "cancel" });
    // Raw Cancel acknowledges /goal clear before its terminal result is drained.
    // Finish that original native command before this separate canonical journey.
    const clearDeadline = Date.now() + 5000;
    let clearedState;
    for (;;) {
      clearedState = await service.agentSessionState("test", { ...options, session: await store.readSession("test") });
      assert.equal(clearedState.thread.id, state.thread.id, "goal clear retains the original native thread");
      if (clearedState.turn?.active === false) break;
      assert.ok(Date.now() < clearDeadline, "the admitted goal clear reaches its original terminal state");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.notEqual(clearedState.turn.state, "failed", clearedState.turn.error);
    assert.equal((await service.readAgentGoal("test", options)).goal, null);
    const routedSelection = { ...defineVibe64AssistantSelection(f.context.assistantSelection), selectionSource: "explicit" };
    await createAssistantRoutingStore({ systemRoot: path.join(f.root, "system") }).write({
      claude: { senior: routedSelection, junior: routedSelection }
    }, 0);
    await store.writeMetadataValue("test", "assistant_routing", JSON.stringify({ mode: "senior", workflowEngineId: "claude" }));
    if (busyGoal) {
      const working = await service.sendAgentMessage("test", { message: "Continue working", messageId: "before-busy-goal" }, options);
      assert.equal(working.delivered, true);
      assert.equal((await service.agentSessionState("test", { ...options, session: await store.readSession("test") })).turn.active, true);
    }
    if (!busyGoal) {
      await store.writeMetadataValue("test", "assistant_goal_intent", "null");
      const preparationEntered = Promise.withResolvers();
      const preparationRelease = Promise.withResolvers();
      t.signal.addEventListener("abort", () => preparationRelease.resolve(), { once: true });
      const waitStoppedIntent = async () => {
        const deadline = Date.now() + 5000;
        while (JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active) {
          assert.ok(Date.now() < deadline, "Stop records its intent before waiting for native preparation");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      };
      let holdPreparation = true;
      service.configureAssistantRuntime({ async resolveAssistantUser(user) {
        if (holdPreparation) {
          holdPreparation = false;
          preparationEntered.resolve();
          await preparationRelease.promise;
        }
        return user;
      } });
      const beforeStoppedSet = (await trace()).filter(row => row.frame?.type === "user").length;
      const stoppedSet = startGoal({ action: "set",
        expectedSegmentId: `claude:${state.thread.id}`, objective: "Do not dispatch this stopped goal",
        messageId: "stopped-first-goal" }, { canonical: true }).then(value => ({ value }), error => ({ error }));
      await Promise.race([preparationEntered.promise, stoppedSet.then(result => {
        throw new Error(`Goal ended before preparation gate: ${result.error?.message || JSON.stringify(result.value)}`);
      })]);
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
        "the first goal records intent before asynchronous preparation");
      const stoppingPreparation = service.interruptAgentTurn("test", {}, options);
      await waitStoppedIntent();
      preparationRelease.resolve();
      await stoppingPreparation;
      assert.match((await stoppedSet).error?.message || "", /stopped during preparation/u);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, beforeStoppedSet);
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false,
        "Stop cannot be undone by a late first-goal preparation");

      const dispatchEntered = Promise.withResolvers();
      const dispatchRelease = Promise.withResolvers();
      t.signal.addEventListener("abort", () => dispatchRelease.resolve(), { once: true });
      let holdDispatch = true;
      service.configureAssistantRuntime({ async resolveAssistantUser(user) {
        const intent = JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent || "null");
        if (holdDispatch && intent?.selection && intent.pending?.messageId === "stopped-authorized-goal") {
          holdDispatch = false;
          dispatchEntered.resolve();
          await dispatchRelease.promise;
        }
        return user;
      } });
      const stoppedDispatch = startGoal({ action: "set",
        expectedSegmentId: `claude:${state.thread.id}`, objective: "Do not dispatch after authorization",
        messageId: "stopped-authorized-goal" }, { canonical: true }).then(value => ({ value }), error => ({ error }));
      await Promise.race([dispatchEntered.promise, stoppedDispatch.then(result => {
        throw new Error(`Goal ended before dispatch gate: ${result.error?.message || JSON.stringify(result.value)}`);
      })]);
      const stoppingDispatch = service.interruptAgentTurn("test", {}, options);
      await waitStoppedIntent();
      dispatchRelease.resolve();
      await stoppingDispatch;
      assert.match((await stoppedDispatch).error?.message || "", /stopped before dispatch/u);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, beforeStoppedSet,
        "Stop during final account authorization prevents native dispatch");
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false);
    }
    const processCountBeforeGoal = (await trace()).filter(row => row.args?.includes("--print")).length;
    await writeFile(goalAcknowledgementGate, "hold");
    let canonicalSettled = false;
    const canonicalCommand = { action: "set", expectedSegmentId: `claude:${state.thread.id}`,
      objective: "Verify the service", messageId: "service-canonical-goal" };
    const canonicalResult = startGoal(canonicalCommand, { canonical: true }).then(value => {
      canonicalSettled = true;
      return { value };
    }, error => {
      canonicalSettled = true;
      return { error };
    });
    const nativeObjective = canonicalCommand.objective;
    const frameDeadline = Date.now() + 5000;
    while (!(await trace()).some(row => row.frame?.type === "user" && row.frame.message.content === `/goal ${nativeObjective}`)) {
      if (canonicalSettled) {
        const result = await canonicalResult;
        assert.fail(`Canonical goal ended before dispatch: ${result.error?.message || JSON.stringify(result)}`);
      }
      assert.ok(Date.now() < frameDeadline, "canonical service goal reached the original native sender");
      await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(canonicalSettled, false);
    assert.equal((await store.readSession("test")).metadata.assistant_routing_goal, undefined,
      "preparing and writing native history does not commit the application goal pin before acknowledgement");
    assert.equal((await store.readConversationLog("test")).some(turn => turn.user?.messageId === canonicalCommand.messageId), false);
    // Save a different role while native acknowledgement is still held. Its
    // next-turn pin must survive the older goal-start completion callback.
    await store.writeMetadataValue("test", "assistant_routing", JSON.stringify({ mode: "junior", workflowEngineId: "claude" }));
    await writeFile(goalAttachmentGate, "hold");
    await rm(goalAcknowledgementGate);
    while (!await store.conversationMessageIdExists("test", canonicalCommand.messageId)) {
      assert.ok(Date.now() < frameDeadline, "native admission is saved before its attachment");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.equal(canonicalSettled, false, "command acknowledgement cannot adopt an older goal snapshot");
    assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).pending.messageId, canonicalCommand.messageId);
    await rm(goalAttachmentGate);
    const accepted = await canonicalResult;
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.value.status, "accepted");
    assert.equal(accepted.value.messageId, canonicalCommand.messageId);
    assert.doesNotMatch(JSON.stringify(accepted.value), /"(?:nativeResult|session|threadId)"\s*:/u);
    let pinned = JSON.parse((await store.readSession("test")).metadata.assistant_routing_goal);
    assert.equal(pinned.objective, canonicalCommand.objective);
    assert.equal(pinned.selection.engineId, "claude");
    assert.equal(pinned.status, "active");
    assert.equal(pinned.mode, "junior");
    const readView = await goalFacade.readGoal();
    let visible = readView.goal;
    assert.equal(readView.target.segmentId, `claude:${state.thread.id}`);
    assert.equal(readView.target.capabilities.goalBudgets, false);
    assert.equal(readView.target.capabilities.goalCommands.set.delivery, "message");
    assert.equal(readView.target.capabilities.goalCommands.pause.delivery, "control");
    assert.equal(visible.objective, canonicalCommand.objective);
    const nativeHistory = await readClaudeHistory({ configRoot: f.providerOptions.env.CLAUDE_CONFIG_DIR,
      workdir: f.context.session.metadata.source_path, conversationId: state.thread.id });
    assert.equal(nativeHistory.goal.objective, nativeObjective);
    assert.doesNotMatch(nativeHistory.goal.objective, /Vibe64 role|Auto plan/);
    if (busyGoal) assert.equal((await trace()).filter(row => row.args?.includes("--print")).length, processCountBeforeGoal,
      "setting a busy goal retains its current native process and instructions");
    for (const key of ["engineId", "modelProviderId", "agentId", "modelId", "variantId"]) {
      assert.equal(pinned.selection[key], routedSelection[key], `goal retains selected ${key}`);
    }
    assert.equal(visible.id, createHash("sha256").update(JSON.stringify([
      state.thread.id, nativeHistory.goal.createdAt, nativeObjective
    ])).digest("hex"), "display decoration never changes the canonical native identity");
    const pinBeforeDuplicate = (await store.readSession("test")).metadata.assistant_routing_goal;
    let nativeMessagesBeforeDuplicate = (await trace()).filter(row => row.frame?.type === "user").length;
    const duplicateGoal = await startGoal({ ...canonicalCommand, objective: "A changed retry" }, { canonical: true });
    assert.equal(duplicateGoal.duplicate, true);
    assert.equal(duplicateGoal.turnId, accepted.value.turnId);
    assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate);
    assert.equal((await store.readSession("test")).metadata.assistant_routing_goal, pinBeforeDuplicate,
      "an existing UUID has no new native result and cannot commit a different goal pin");
    let intentBeforeRestart = JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent);
    assert.equal(intentBeforeRestart.active, true);
    assert.equal(intentBeforeRestart.pending, null);
    assert.equal(intentBeforeRestart.native.objective, nativeObjective);
    assert.equal(intentBeforeRestart.actor.username, actor.username);
    await service.close();
    assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
      "daemon shutdown preserves the person's active goal intent");
    service = createService();
    if (!busyGoal) {
      const historyFile = await claudeHistoryPath({ configRoot: f.providerOptions.env.CLAUDE_CONFIG_DIR,
        workdir: f.context.session.metadata.source_path, conversationId: state.thread.id });
      const beforeLoopLimit = await readFile(historyFile.path, "utf8");
      await writeFile(historyFile.path, JSON.stringify({ type: "system", subtype: "informational",
        timestamp: new Date().toISOString(),
        content: "A hook blocked the turn from ending 9 consecutive times — overriding and ending turn." }) + "\n", { flag: "a" });
      const blocked = await service.recoverActiveGoals();
      assert.equal(blocked.results.at(-1).blocked, true, JSON.stringify(blocked));
      const blockedRead = await service.readAgentGoal("test", options, { canonical: true });
      assert.equal(blockedRead.goal.status, "blocked");
      assert.match(blockedRead.goal.reason, /Resolve the blocker/);
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
        "a native blocker preserves the person's unfinished goal intent");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "restart never blindly starts the same native loop again");
      await writeFile(historyFile.path, beforeLoopLimit + JSON.stringify({ type: "attachment",
        timestamp: new Date().toISOString(), attachment: { type: "goal_status", condition: nativeObjective,
          met: false, failed: true, reason: "The remaining checks need credentials from the user." } }) + "\n");
      const impossible = await service.recoverActiveGoals();
      assert.equal(impossible.results.at(-1).blocked, true, JSON.stringify(impossible));
      const impossibleRead = await service.readAgentGoal("test", options, { canonical: true });
      assert.equal(impossibleRead.goal.status, "blocked");
      assert.equal(impossibleRead.goal.reason, "The remaining checks need credentials from the user.");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "a native failed evaluation must not be resumed after restart either");
      await service.close();
      await writeFile(historyFile.path, beforeLoopLimit);
      service = createService();
      service.configureAssistantRuntime({ authorizeProjectMessage: async () => {
        throw new Error("The original actor no longer has project access.");
      } });
      const denied = await service.recoverActiveGoals();
      assert.equal(denied.ok, false);
      assert.match(denied.results[0].error, /actor no longer/u);
      assert.match((await service.readAgentGoal("test", options, { canonical: true })).error, /actor no longer/u,
        "recovery failure remains visible without removing native goal controls");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate);
      await service.close();
      await store.writeMetadataValue("test", "assistant_goal_intent", JSON.stringify({ ...intentBeforeRestart, native: null,
        pending: { action: "set", messageId: canonicalCommand.messageId, expectedSegmentId: canonicalCommand.expectedSegmentId,
          objective: nativeObjective } }));
      service = createService();
      const attachedAfterCrash = await service.recoverActiveGoals();
      assert.equal(attachedAfterCrash.results.at(-1).resumed, true, JSON.stringify(attachedAfterCrash));
      intentBeforeRestart = JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent);
      assert.equal(intentBeforeRestart.active, true);
      assert.equal(intentBeforeRestart.pending, null);
      nativeMessagesBeforeDuplicate++;
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "the original accepted attachment is reconciled, then exactly one Resume is sent");
      await service.close();
      await store.writeMetadataValue("test", "assistant_goal_intent", JSON.stringify({ ...intentBeforeRestart,
        pending: { action: "resume", messageId: canonicalCommand.messageId, objective: nativeObjective } }));
      service = createService();
      const unrelatedAttachment = await service.recoverActiveGoals();
      assert.equal(unrelatedAttachment.ok, false);
      assert.match(unrelatedAttachment.results.at(-1).error, /own native goal attachment/u);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "an accepted old command cannot adopt a newer goal with identical text");
      await service.close();
      await store.writeMetadataValue("test", "assistant_goal_intent", JSON.stringify({ ...intentBeforeRestart,
        pending: { action: "resume", messageId: "unknown-goal-receipt", objective: nativeObjective } }));
      service = createService();
      const uncertain = await service.recoverActiveGoals();
      assert.equal(uncertain.ok, false);
      assert.match(uncertain.results[0].error, /delivery is uncertain/u);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "unknown goal delivery is never replaced with a new Resume");
      await service.close();
      await store.writeMetadataValue("test", "assistant_goal_intent", JSON.stringify(intentBeforeRestart));
      service = createService();
    }
    if (!busyGoal) {
      // Exercise real lock expiry without spending its production minute in a
      // test; only the deadline is shortened at the existing store boundary.
      const held = Promise.withResolvers();
      const release = Promise.withResolvers();
      const preparing = store.runSessionExclusive("test", "agent-write-mode", async () => {
        held.resolve(); await release.promise;
      }, { operation: "prepare-workspace" });
      await held.promise;
      runtime.store = { ...store, runSessionExclusive(id, name, operation, lockOptions = {}) {
        if (lockOptions.operation === "resume-agent-goal") {
          assert.equal(lockOptions.waitMs, 60_000);
          lockOptions = { ...lockOptions, waitMs: 20 };
        }
        return store.runSessionExclusive(id, name, operation, lockOptions);
      } };
      try {
        const timedOut = await service.recoverActiveGoals();
        assert.equal(timedOut.ok, false);
        assert.equal(timedOut.results[0].code, "vibe64_agent_write_mode_busy");
        assert.match((await service.readAgentGoal("test", options, { canonical: true })).error, /Another assistant operation/u);
        assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
          "lock timeout is visible and never dispatches or retries a goal");
      } finally { release.resolve(); runtime.store = store; }
      await preparing;
      await service.close();
      service = createService();
      runtime.listSessions = async () => [{ sessionId: "removed-during-recovery" }, await store.readSession("test")];
    }
    const prepareEntered = Promise.withResolvers();
    const prepareReleased = Promise.withResolvers();
    recoveryLockContended = Promise.withResolvers();
    const preparing = store.runSessionExclusive("test", "agent-write-mode", async () => {
      prepareEntered.resolve();
      await prepareReleased.promise;
    }, { operation: "prepare-workspace" });
    await prepareEntered.promise;
    await writeFile(goalAttachmentGate, "hold");
    requireGoalRequest = true;
    await writeFile(recoveryToolProbe, "probe");
    const recovering = service.recoverActiveGoals();
    try {
      const contention = await recoveryLockContended.promise;
      assert.equal(contention.waitMs, 60_000, "restart recovery queues behind ordinary workspace preparation");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate,
        "waiting for the preparation owner cannot dispatch a goal");
    } finally { prepareReleased.resolve(); }
    await preparing;
    const attachmentDeadline = Date.now() + 5000;
    while ((await trace()).filter(row => row.frame?.type === "user").length === nativeMessagesBeforeDuplicate) {
      assert.ok(Date.now() < attachmentDeadline, "restart Resume reaches native admission");
      await new Promise(resolve => setTimeout(resolve, 5));
    }
    await new Promise(resolve => setTimeout(resolve, 20));
    assert.ok(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).pending,
      "restart Resume retains its pending command until its own attachment arrives");
    await rm(goalAttachmentGate);
    const recovery = await recovering;
    assert.equal(recovery.ok, busyGoal, JSON.stringify(recovery));
    assert.equal(recovery.results.at(-1).resumed, true, "one removed session cannot suppress the next goal's recovery");
    const probeDeadline = Date.now() + 5000;
    let probe;
    while (!probe) {
      probe = (await trace()).findLast(row => row.frame?.type === "control_response" &&
        row.frame.response?.request_id === "recovery-authority-contract");
      assert.ok(Date.now() < probeDeadline, "Recovered native goal can discover its application control contract");
      if (!probe) await new Promise(resolve => setTimeout(resolve, 10));
    }
    assert.equal(probe.frame.response.subtype, "success", JSON.stringify(probe));
    assert.doesNotMatch(JSON.stringify(probe), /Log in to Vibe64|vibe64_auth_required/);
    assert.ok(recoveredActorReads > 0, "Recovered tools use host-issued fresh authority without a browser request");
    await rm(recoveryToolProbe);
    requireGoalRequest = false;
    if (!busyGoal) assert.equal(recovery.results[0].ok, false);
    runtime.listSessions = async () => [await store.readSession("test")];
    const framesAfterRecovery = (await trace()).filter(row => row.frame?.type === "user").length;
    assert.equal(framesAfterRecovery, nativeMessagesBeforeDuplicate + 1, "restart admits exactly one canonical Resume");
    await service.recoverActiveGoals();
    assert.equal((await trace()).filter(row => row.frame?.type === "user").length, framesAfterRecovery);
    visible = (await service.readAgentGoal("test", options, { canonical: true })).goal;
    assert.equal(visible.status, "active");
    if (busyGoal) {
      await service.close();
      service = createService();
      const held = Promise.withResolvers();
      const release = Promise.withResolvers();
      recoveryLockContended = Promise.withResolvers();
      const preparing = store.runSessionExclusive("test", "agent-write-mode", async () => {
        held.resolve(); await release.promise;
      }, { operation: "prepare-workspace" });
      await held.promise;
      const recovering = service.recoverActiveGoals();
      let stopping;
      try {
        await recoveryLockContended.promise;
        stopping = service.interruptAgentTurn("test", {}, options);
        const deadline = Date.now() + 5000;
        while (JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active) {
          assert.ok(Date.now() < deadline, "Stop records intent before waiting for the preparation lock");
          await new Promise(resolve => setTimeout(resolve, 10));
        }
      } finally { release.resolve(); }
      await preparing;
      await stopping;
      assert.equal((await recovering).ok, false, "Stop prevents a queued automatic Resume");
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, framesAfterRecovery);
    }
    const differentSelection = { ...f.context.assistantSelection, engineId: "codex", agentId: "codex",
      modelProviderId: "openai", modelId: "gpt-6-astra" };
    await store.writeMetadataValue("test", "assistant_selection", JSON.stringify(differentSelection));
    const stoppingOptions = { runtime, vibe64User: { username: "reader", role: "member" } };
    const pinnedRead = await service.readAgentGoal("test", stoppingOptions, { canonical: true });
    assert.equal(pinnedRead.goal.id, visible.id);
    assert.equal(pinnedRead.target.segmentId, canonicalCommand.expectedSegmentId);
    assert.equal(pinnedRead.routing.selection.engineId, "claude");
    const stoppedGoal = await service.updateAgentGoal("test", { ...stoppingOptions, action: "pause",
      expectedSegmentId: canonicalCommand.expectedSegmentId, expectedGoalId: visible.id }, { canonical: true });
    assert.equal(stoppedGoal.status, "paused");
    assert.equal((await store.readSession("test")).metadata.assistant_selection, JSON.stringify(differentSelection),
      "read and Pause retain the pinned goal target without rebinding the visible chat");
    pinned = JSON.parse((await store.readSession("test")).metadata.assistant_routing_goal);
    assert.equal(pinned.status, "paused");
    assert.equal(pinned.selection.engineId, "claude");
    assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false);
    await service.close();
    service = createService();
    assert.equal((await service.recoverActiveGoals()).results[0].skipped, true);
    assert.equal((await trace()).filter(row => row.frame?.type === "user").length, framesAfterRecovery,
      "explicit Pause survives another daemon restart");
    rows = await store.readConversationLog("test");
    assert.equal(rows.filter(turn => turn.user?.messageId === canonicalCommand.messageId).length, 1);
    assert.equal(rows.some(turn => turn.metadata.runtime), false);
    assert.equal((await store.readSession("test")).metadata.runtime, undefined);
    if (!busyGoal) {
      await store.writeMetadataValue("test", "assistant_selection", JSON.stringify(routedSelection));
      const retainedGoal = await service.readAgentGoal("test", options);
      const currentGoal = await service.updateAgentGoal("test", { ...options, action: "resume",
        threadId: retainedGoal.threadId, createdAt: retainedGoal.goal.createdAt, objective: retainedGoal.goal.objective });
      assert.equal(currentGoal.goal.status, "active");
      await assert.rejects(actions.execute({ actionId: "vibe64.terminals.main-goal.pause",
        input: { projectSlug: "claude-main-fixture" }, context: { channel: "automation", surface: "app" } }), {
        code: "vibe64_main_goal_control_required"
      });
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
        "Knowing the action ID is not authority to pause a Main goal");
      const prose = await goalFacade.send({ messageId: "service-pause-prose", text: "I am paused.", steer: true });
      assert.equal(prose.delivered, true);
      assert.equal((await service.readAgentGoal("test", options)).goal.status, "active");
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
        "Ordinary prose never substitutes for the structured Pause operation");
      const pauseReceipt = await goalFacade.send({ messageId: "service-self-pause", text: "Pause through the admitted application tool.", steer: true });
      assert.equal(pauseReceipt.delivered, true);
      const pauseDeadline = Date.now() + 5000;
      let pauseCall;
      while (!pauseCall || pauseCall.status === "running") {
        const log = await store.readConversationLog("test");
        pauseCall = log.flatMap(turn => turn.metadata.applicationTools || []).find(call => call.id.endsWith("self-pause-execute"));
        assert.ok(Date.now() < pauseDeadline, JSON.stringify({ pauseCall, frames: (await trace()).slice(-4) }));
        if (!pauseCall || pauseCall.status === "running") await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(pauseCall.status, "complete");
      assert.equal(pauseCall.result.ok, true, JSON.stringify(pauseCall.result));
      assert.equal(pauseCall.result.result.result.status, "paused");
      const afterPause = await service.readAgentGoal("test", options);
      assert.equal(afterPause.goal.status, "paused");
      assert.equal(afterPause.goal.objective, currentGoal.goal.objective);
      assert.equal(afterPause.goal.createdAt, currentGoal.goal.createdAt);
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false);
      const selfPausePid = (await trace()).findLast(row => row.args?.includes("--print")).pid;
      const pauseExitDeadline = Date.now() + 3000;
      for (;;) {
        try { process.kill(selfPausePid, 0); }
        catch (error) { if (error.code === "ESRCH") break; throw error; }
        assert.ok(Date.now() < pauseExitDeadline, "Self-Pause drains after its native tool receipt");
        await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.throws(() => process.kill(selfPausePid, 0), { code: "ESRCH" });
      const framesBeforeRestart = (await trace()).filter(row => row.frame?.type === "user").length;
      await service.close();
      service = createService();
      assert.equal((await service.recoverActiveGoals()).results[0].skipped, true);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, framesBeforeRestart);
      const ordinary = await goalFacade.send({ messageId: "service-after-paused-restart", text: "An ordinary message while the goal stays paused." });
      assert.equal(ordinary.delivered, true);
      assert.equal((await service.readAgentGoal("test", options)).goal.status, "paused");
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, false);
      const nativeInputs = (await trace()).filter(row => row.frame?.type === "user").slice(-2);
      assert.equal(nativeInputs[0].frame.message.content, "/goal clear");
      assert.match(nativeInputs[1].frame.message.content, /An ordinary message while the goal stays paused/);
      const beforeBlock = await service.readAgentGoal("test", options);
      await service.updateAgentGoal("test", { ...options, ...beforeBlock.goal, action: "resume", threadId: beforeBlock.threadId });
      await assert.rejects(actions.execute({ actionId: "vibe64.terminals.main-goal.block",
        input: { projectSlug: "claude-main-fixture", reason: "Missing approval code" },
        context: { channel: "automation", surface: "app" } }), { code: "vibe64_main_goal_control_required" });
      const blockReceipt = await goalFacade.send({ messageId: "service-self-block", text: "Block through the admitted application tool.", steer: true });
      assert.equal(blockReceipt.delivered, true);
      const blockDeadline = Date.now() + 5000;
      let blockCall;
      while (!blockCall || blockCall.status === "running") {
        const log = await store.readConversationLog("test");
        blockCall = log.flatMap(turn => turn.metadata.applicationTools || []).find(call => call.id.endsWith("self-block-execute"));
        assert.ok(Date.now() < blockDeadline, JSON.stringify({ blockCall, frames: (await trace()).slice(-4) }));
        if (!blockCall || blockCall.status === "running") await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(blockCall.status, "complete");
      assert.equal(blockCall.result.ok, true, JSON.stringify(blockCall.result));
      assert.equal(blockCall.result.result.result.status, "blocked");
      const blocked = await service.readAgentGoal("test", options);
      assert.equal(blocked.goal.status, "blocked");
      assert.equal(blocked.goal.reason, "The human must supply the missing approval code.");
      assert.equal(JSON.parse((await store.readSession("test")).metadata.assistant_goal_intent).active, true,
        "A model-reported external blocker does not manufacture a human Pause");
      const blockedFrames = (await trace()).filter(row => row.frame?.type === "user").length;
      await service.close();
      service = createService();
      assert.equal((await service.recoverActiveGoals()).results[0].blocked, true);
      assert.equal((await trace()).filter(row => row.frame?.type === "user").length, blockedFrames,
        "Restart retains the blocker without invoking Claude again");
      const blockedOrdinary = await goalFacade.send({ messageId: "service-blocked-ordinary", text: "Explain the blocker without resuming." });
      assert.equal(blockedOrdinary.delivered, true);
      assert.equal((await service.readAgentGoal("test", options)).goal.status, "blocked");
      const blockedInputs = (await trace()).filter(row => row.frame?.type === "user").slice(-2);
      assert.equal(blockedInputs[0].frame.message.content, "/goal clear");
      assert.match(blockedInputs[1].frame.message.content, /Explain the blocker without resuming/);
      await service.updateAgentGoal("test", { ...options, ...blocked.goal, threadId: blocked.threadId, action: "resume" });
      assert.equal((await service.readAgentGoal("test", options)).goal.status, "active");
      const resumedBlocked = await goalFacade.readGoal();
      await goalFacade.updateGoal({ action: "cancel", expectedSegmentId: resumedBlocked.target.segmentId,
        expectedGoalId: resumedBlocked.goal.id, messageId: "before-block-on-goal" });
      requireGoalRequest = true;
      service.configureAssistantRuntime({ resolveAssistantUser: async () => null });
      await startGoal({ action: "set", objective: "BLOCK_ON_GOAL", messageId: "block-on-goal",
        expectedSegmentId: resumedBlocked.target.segmentId }, { canonical: true });
      const goalToolDeadline = Date.now() + 5000;
      let goalToolCall;
      while (!goalToolCall || goalToolCall.status === "running") {
        goalToolCall = (await store.readConversationLog("test")).flatMap(turn => turn.metadata.applicationTools || [])
          .find(call => call.id.endsWith("self-block-goal-execute"));
        assert.ok(Date.now() < goalToolDeadline, JSON.stringify({ goalToolCall, frames: (await trace()).slice(-5) }));
        if (!goalToolCall || goalToolCall.status === "running") await new Promise(resolve => setTimeout(resolve, 10));
      }
      assert.equal(goalToolCall.result.ok, true, JSON.stringify(goalToolCall));
      assert.equal((await service.readAgentGoal("test", options)).goal.status, "blocked",
        "The goal command retains fresh request authority even without a hosted runtime actor or intervening user message");

    }
  });
});


test("Claude native status frames preserve forwarding before usage and goal publication", async (t) => {
  const f = await fixture(t);
  const events = [];
  const entered = Promise.withResolvers();
  const release = Promise.withResolvers();
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    async publishSessionChanged(_id, event) {
      if (["claude-goal", "claude-plan-usage"].includes(event.reason)) events.push(["published", event.reason]);
    }
  });
  t.after(() => release.resolve());
  const context = { ...f.context, async onEvent(event) {
    if (event.type !== "provider-event") return;
    events.push(["forwarded", event]);
    if (event.event.type === "rate_limit_event") {
      entered.resolve();
      await release.promise;
    }
  } };
  const sent = await provider.sendMessage(context, { message: "Hello", messageId: "status-order" });
  const native = f.processes[0];
  let usageReads = 0;
  native.client.request = async request => {
    assert.equal(request.subtype, "get_usage");
    usageReads++;
    return { rate_limits_available: true, rate_limits: { seven_day: { utilization: 25 } } };
  };
  await provider.readPlanUsage(context);
  await provider.readPlanUsage(context);
  assert.equal(usageReads, 1);
  events.length = 0;
  const usageFrame = { type: "rate_limit_event", session_id: sent.thread.id };
  const received = native.options.onEvent(usageFrame);
  await entered.promise;
  const forwarded = frame => ({ type: "provider-event", event: frame, providerId: "claude",
    threadId: sent.thread.id, turnId: sent.turn.id });
  assert.deepEqual(events, [["forwarded", forwarded(usageFrame)]]);
  await provider.readPlanUsage(context);
  assert.equal(usageReads, 1, "forwarding completes before the cached usage is invalidated");
  release.resolve();
  await received;
  assert.deepEqual(events, [["forwarded", forwarded(usageFrame)], ["published", "claude-plan-usage"]]);
  await provider.readPlanUsage(context);
  assert.equal(usageReads, 2);

  events.length = 0;
  const goalFrame = { type: "active_goal", session_id: sent.thread.id };
  await native.options.onEvent(goalFrame);
  assert.deepEqual(events, [["forwarded", forwarded(goalFrame)], ["published", "claude-goal"]]);
  await provider.readPlanUsage(context);
  assert.equal(usageReads, 2, "a goal update does not invalidate account usage");
  assert.equal(f.processes.length, 1);
});

test("restored Claude detached facade awaits the original profile event before starting native work", async (t) => {
  const f = await fixture(t);
  f.context.assistantSelection = { ...f.context.assistantSelection, modelId: "haiku", variantId: "" };
  const profile = await f.provider.resolveExecutionProfile(f.context, { profileId: "helper", workloadId: "commit_title" });
  const catalogueProcesses = [...f.processes];
  assert.equal(catalogueProcesses.length, 1);
  assert.equal(catalogueProcesses[0].stopped, true);
  assert.equal(catalogueProcesses[0].options.toolFree, true);
  assert.equal(catalogueProcesses[0].lastInput, undefined);
  let release;
  let entered;
  const held = new Promise(resolve => { release = resolve; });
  const eventEntered = new Promise(resolve => { entered = resolve; });
  f.context.onEvent = async event => {
    if (event.type !== "execution-profile") return;
    assert.equal(event.type, "execution-profile");
    assert.deepEqual(event.executionProfile, profile);
    assert.deepEqual(f.processes, catalogueProcesses, "Audit must finish before any conversation process starts.");
    entered();
    await held;
  };
  f.behavior.afterSend = native => native.options.onEvent({ type: "result", subtype: "success", result: "Bounded title", uuid: "title" });
  const running = f.provider.runDetachedChatTurn(f.context, { prompt: "Write the bounded title.", executionProfile: profile });
  await eventEntered;
  assert.deepEqual(f.processes, catalogueProcesses, "Audit must finish before any conversation process starts.");
  release();
  const result = await running;
  assert.equal(result.text, "Bounded title");
  assert.deepEqual(result.executionProfile, profile);
  assert.equal(f.processes.length, catalogueProcesses.length + 1);
  const beforeRejection = f.processes.length;
  f.context.onEvent = async () => { throw new Error("Controlled audit rejection."); };
  await assert.rejects(f.provider.streamDetachedChatTurn(f.context, { prompt: "Must not start native work.", executionProfile: profile }),
    /Controlled audit rejection/);
  assert.equal(f.processes.length, beforeRejection);
});

test("Claude Main preserves split native output identity through canonical storage and restart", async (t) => {
  const f = await fixture(t);
  const store = f.context.runtime.store;
  await f.provider.sendMessage(f.context, { message: "Explain", messageId: "output-owner-request" });
  const event = f.processes[0].options.onEvent;
  await event({ type: "stream_event", event: { type: "message_start", message: { id: "same-api-message" } } });
  for (const [index, block] of [
    { type: "thinking", thinking: "The reasoning." }, { type: "text", text: "The answer." }
  ].entries()) {
    await event({ type: "stream_event", event: { type: "content_block_start", index, content_block: { type: block.type } } });
    await event({ type: "stream_event", event: { type: "content_block_delta", index,
      delta: block.type === "thinking" ? { thinking: block.thinking } : { text: block.text } } });
    if (block.type === "text") {
      const live = store.readConversationStream("test").messages;
      assert.equal(live.length, 1);
      assert.equal(live[0].messageId, "claude_same-api-message_1");
      assert.equal(live[0].outputId, "claude_same-api-message_1");
      assert.equal(live[0].text, "The answer.");
    }
    // Native saved frames can precede block retirement; their local index is zero.
    await event({ type: "assistant", uuid: `saved-block-${index}`,
      message: { id: "same-api-message", content: [block] } });
    if (block.type === "text") {
      await event({ type: "stream_event", event: { type: "content_block_stop", index } });
      assert.equal(store.readConversationStream("test").messages[0].text, "The answer.",
        "The partial stays visible until Claude identifies the message role");
      await event({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "end_turn" } } });
    }
    const saved = f.written.at(-1);
    assert.equal(saved.messageId, `claude_saved-block-${index}_0`);
    assert.equal(saved.outputId, `claude_same-api-message_${index}`);
    assert.deepEqual(store.readConversationStream("test").messages, [],
      "Saving the exact output retires its partial");
    if (block.type === "thinking") await event({ type: "stream_event", event: { type: "content_block_stop", index } });
  }
  await event({ type: "result", subtype: "success", result: "The answer.", uuid: "output-owner-result" });
  await (await f.open()).wait();
  const rows = await store.readConversationLog("test");
  assert.deepEqual(rows.flatMap(turn => turn.messages).filter(message => message.role !== "user")
    .map(({ messageId, outputId, role, text }) => ({ messageId, outputId, role, text })), [
    { messageId: "claude_saved-block-0_0", outputId: "claude_same-api-message_0", role: "thinking", text: "The reasoning." },
    { messageId: "claude_saved-block-1_0", outputId: "claude_same-api-message_1", role: "assistant", text: "The answer." }
  ]);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  const reopened = createVibe64SessionStore({ projectContextRoot: f.root,
    projectRuntimeRoot: path.join(f.root, "fixture-runtime") });
  assert.deepEqual(await reopened.readConversationLog("test"), rows,
    "Restart reads the original canonical rows without rewriting message or output identity");
});

test("Claude Main does not guess a live output from ambiguous native blocks", async (t) => {
  const f = await fixture(t);
  const store = f.context.runtime.store;
  await f.provider.sendMessage(f.context, { message: "Explain", messageId: "ambiguous-output-request" });
  const event = f.processes[0].options.onEvent;
  await event({ type: "stream_event", event: { type: "message_start", message: { id: "ambiguous-api" } } });
  for (const index of [3, 4]) {
    await event({ type: "stream_event", event: { type: "content_block_start", index,
      content_block: { type: "text", text: "" } } });
    await event({ type: "stream_event", event: { type: "content_block_delta", index, delta: { text: `Partial ${index}` } } });
  }
  const live = store.readConversationStream("test");
  assert.equal(live.messages.length, 2);
  await event({ type: "assistant", uuid: "ambiguous-saved",
    message: { id: "ambiguous-api", content: [{ type: "text", text: "Complete" }] } });
  await event({ type: "stream_event", event: { type: "message_delta", delta: { stop_reason: "end_turn" } } });
  const saved = f.written.at(-1);
  assert.equal(saved.messageId, "claude_ambiguous-saved_0");
  assert.equal(saved.outputId, saved.messageId, "Only the actual saved native identity is available");
  assert.deepEqual(store.readConversationStream("test").messages, live.messages,
    "A saved local index must not retire either uncorrelated live block");
  await f.provider.interruptTurn(f.context);
  assert.deepEqual(store.readConversationStream("test").messages, []);
});

test("Claude Main result-only output retains native identity and interrupted partials remain unsaved", async (t) => {
  const f = await fixture(t);
  const store = f.context.runtime.store;
  await f.provider.sendMessage(f.context, { message: "Explain", messageId: "result-output-request" });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Only result.", uuid: "native-result" });
  const saved = f.written.at(-1);
  assert.equal(saved.messageId, "claude_native-result_result");
  assert.equal(saved.outputId, saved.messageId);
  assert.equal(saved.text, "Only result.");
  await f.provider.sendMessage(f.context, { message: "Continue", messageId: "partial-output-request" });
  const event = f.processes.at(-1).options.onEvent;
  await event({ type: "stream_event", event: { type: "message_start", message: { id: "canceled-output" } } });
  await event({ type: "stream_event", event: { type: "content_block_start", index: 0,
    content_block: { type: "text", text: "" } } });
  await event({ type: "stream_event", event: { type: "content_block_delta", index: 0, delta: { text: "Unfinished" } } });
  assert.equal(store.readConversationStream("test").messages[0].text, "Unfinished");
  await f.provider.interruptTurn(f.context);
  const answers = (await store.readConversationLog("test")).flatMap(turn => turn.messages)
    .filter(message => message.role === "assistant");
  assert.deepEqual(answers.map(({ messageId, outputId, text }) => ({ messageId, outputId, text })), [
    { messageId: "claude_native-result_result", outputId: "claude_native-result_result", text: "Only result." }
  ]);
  assert.deepEqual(store.readConversationStream("test").messages, []);
});


// This receipt-only companion uses the original Main manager, supplied native
// store, canonical writer/publication and native result event. Claude teaching
// remains disabled in the Main binding until command/tool custody is composed.
test("Claude original Main writer returns exact canonical final proof without enabling teaching", async t => {
  const f = await fixture(t);
  await f.provider.sendMessage(f.context, { message: "Explain", messageId: "receipt-owner-request" });
  const binding = await createSessionConversationBinding(f.provider, f.context.sessionId, f.context);
  const owner = binding.native.owner;
  const entry = [...owner.entries.values()].find(entry => entry.main && entry.context.sessionId === f.context.sessionId);
  assert.equal(Object.hasOwn(binding, "applicationTools"), false);
  assert.equal(owner.readFinalAssistantResult(entry.context.key, entry.id, entry.turn.id), null);
  await f.processes[0].options.onEvent({ type: "result", session_id: entry.id,
    subtype: "success", result: "Canonical answer", uuid: "receipt-native-result" });
  await (await f.open()).wait();
  const receipt = owner.readFinalAssistantResult(entry.context.key, entry.id, entry.turn.id);
  const rows = await f.context.runtime.store.readConversationLog(f.context.sessionId);
  const canonical = rows.find(turn => turn.messages.some(message => message.messageId === "claude_receipt-native-result_result"));
  assert.deepEqual(receipt.conversationTurn, canonical);
  assert.equal(receipt.text, "Canonical answer");
  assert.equal(receipt.itemId, "claude_receipt-native-result_result");
  assert.equal(receipt.outputId, receipt.itemId);
  assert.equal(receipt.threadId, entry.id);
  assert.equal(receipt.turnId, entry.turn.id);
  assert.equal(entry.turn.active, false);
  assert.equal(f.checkpoints.length > 0, true, "Original source checkpoint still runs");
  await f.provider.closeProject();
  assert.equal(owner.readFinalAssistantResult(entry.context.key, entry.id, entry.turn.id), null);
});


// Uses the same original bound Main fixture, native process/ACK, actual supplied
// Store, Core catalogue and Training question/progress owners. Its server context
// grant is composed here; it does not claim HTTP/browser/account acceptance.
test("actual Claude Learning Main executes its admitted native tool and promotes only its exact final checkpoint", { timeout: 30_000 }, async t => {
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
  let removeTeaching;
  const teaching = await trainingTeachingFixture({ after(callback) { removeTeaching = callback; } }, { ready: false, exercise: false });
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
  const f = await boundMainFixture(t, { actions,
    toolPolicy: ({ actionId, context }) => Boolean(context.runtime?.learningScope && context.runtime.learningTeaching?.actionIds.includes(actionId)),
    async runtimeFactory(base) {
      base.context.sessionId = `learning-${teaching.attemptId}`;
      runtime = new Vibe64SessionRuntime({ projectContextRoot: base.root, projectRuntimeRoot: saved.projectRuntimeRoot,
        learningScope: scope.learningScope, learningInstructions: scope.learningInstructions, learningTeaching: scope.learningTeaching,
        promptRenderer: () => assert.fail("No-exercise Main must not render a project source prompt") });
      await runtime.createSession({ sessionId: base.context.sessionId,
        metadata: { assistant_selection: base.context.session.metadata.assistant_selection } });
      return runtime;
    }
  });
  // The original provider drains before its actual learner-owned storage is removed.
  t.after(() => removeTeaching());
  let allowed = true;
  const sessionContext = createSessionActions({ sessions: {} }).filter(action => action.id === ACTION_READ_CONVERSATION_CONTEXT);
  const definitions = [...sessionContext, ...createLearningTeachingContextActions(),
    ...createTrainingActions({ catalogue: { readCatalogue() {} }, learners: teaching.learners, teachingBrief: brief }),
    ...createTrainingTeachingActions({ mainTeaching: main }),
    ...createTrainingAssessmentActions({ mainTeaching: main }),
    ...createTrainingPresentationActions({ learners: teaching.learners, content: teaching.content, mainTeaching: main }),
    ...createTrainingPracticalActions()];
  actions.register({ contributorId: "actual-learning-claude-main", domain: "training",
    actions: definitions.map(action => ({ ...action, channels: action.channels || ["api", "automation", "internal"], surfaces: ["app"] })) });
  registerVibe64ActionContext(actions, { resolveUser: async () => {
    if (!allowed) throw Object.assign(new Error("Learning actor access revoked"), { statusCode: 403 });
    return teaching.actor;
  }, authorizeProject: () => assert.fail("Source-less teaching cannot borrow a project ACL"),
  resolveLearningContext: input => learning.resolveContext(input) });
  const sessionId = f.context.sessionId;
  const requestContext = { surface: "app", channel: "internal", requestMeta: { request: {
    params: { learningAttemptId: teaching.attemptId }, vibe64User: teaching.actor } } };
  f.context.vibe64User = teaching.actor;
  f.context.browserAuthority = { sessionId, learningAttemptId: teaching.attemptId,
    actorId: scope.learningScope.learnerId, requestContext };
  f.context.teachingActions = actions;
  f.context.teachingTerminals = { async requireAssistantSelectionAccess(selection, options) {
    assert.deepEqual(selection, defineVibe64AssistantSelection(f.context.assistantSelection));
    assert.equal(options.vibe64User.uid, teaching.actor.uid);
  } };
  const sendLearning = async input => f.provider.sendMessage(f.context,
    await main.captureMessage({ input, context: f.context, runtime, sessionId, actions }));
  const canonical = await f.open();
  assert.equal(f.processes.length, 0, "Opening the actual Main is inert");
  let sent = await sendLearning({ message: "Teach this exact saved lesson.",
    messageId: "actual-claude-learning-request", clientId: "actual-claude-browser", data: { forged: true } });
  assert.equal(sent.delivered, true);
  assert.equal(f.processes.length, 1);
  const process = f.processes[0];
  assert.equal(process.options.applicationTools, true);
  assert.equal(process.options.toolFree, false, "The supplied native owner is not replaced by Helper/isolated execution");
  assert.equal(process.options.workdir, await runtime.getNativeExecutionRoot(sessionId));
  const native = (await createSessionConversationBinding(f.provider, sessionId, f.context)).native;
  const entry = [...native.owner.entries.values()].find(value => value.main && value.context.sessionId === sessionId);
  assert.equal(entry.command.admitted, true);
  assert.equal(entry.main, true);
  assert.equal(Boolean(entry.profile), false);
  let log = await f.store.readConversationLog(sessionId);
  assert.deepEqual(log[0].messages.find(message => message.role === "user").data, { clientId: "actual-claude-browser" });
  async function call(id, name, input) {
    await process.options.onEvent({ type: "assistant", session_id: entry.id, uuid: `native-${id}`,
      message: { content: [{ type: "tool_use", id, name: `mcp__application__${name}`, input }] } });
    const response = await process.options.onControlRequest({ subtype: "mcp_message", server_name: "application",
      message: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: input,
        _meta: { "claudecode/toolUseId": id } } } }, { signal: new AbortController().signal });
    return JSON.parse(response.mcp_response.result.content[0].text);
  }
  const retiredInput = { limit: main.actionIds.length };
  await process.options.onEvent({ type: "assistant", session_id: entry.id, uuid: "retired-native-tool",
    message: { content: [{ type: "tool_use", id: "retired-tool-call", name: "mcp__application__assistant_action_search", input: retiredInput }] } });
  sent = await sendLearning({ message: "Use this current request to teach the lesson.",
    messageId: "actual-claude-current-teaching-request", clientId: "actual-claude-browser" });
  assert.equal(sent.deliveryMode, "steer");
  assert.equal(f.processes.length, 1);
  await assert.rejects(process.options.onControlRequest({ subtype: "mcp_message", server_name: "application",
    message: { jsonrpc: "2.0", id: "retired-tool-call", method: "tools/call", params: {
      name: "assistant_action_search", arguments: retiredInput, _meta: { "claudecode/toolUseId": "retired-tool-call" } } }
  }, { signal: new AbortController().signal }), /retired input/);
  assert.equal(entry.command.toolFailure, undefined, "Refusal must happen before the real Common executor can poison the new input");
  const search = await call("learning-search", "assistant_action_search", { limit: main.actionIds.length });
  assert.equal(search.ok, true, JSON.stringify(search));
  assert.deepEqual(search.result.items.map(value => value.actionId).sort(), [...main.actionIds].sort());
  const contract = await call("learning-question-contract", "assistant_action_contract", {
    actionId: "vibe64.training.question.prepare", version: 1 });
  assert.equal(contract.ok, true, JSON.stringify(contract));
  assert.equal(contract.result.actionId, "vibe64.training.question.prepare");
  assert.equal(contract.result.version, 1);
  const prepared = await call("learning-question", "assistant_action_execute", { actionId: "vibe64.training.question.prepare", input: {
    attemptId: teaching.attemptId, expectedRevision: 1, requestId: "actual-claude-first-question",
    assessmentId: "explain", text: teaching.input.text, assistance: "none" } });
  assert.equal(prepared.ok, true, JSON.stringify(prepared));
  log = await f.store.readConversationLog(sessionId);
  const authored = log.find(turn => turn.messages.some(message => message.messageId === "actual-claude-current-teaching-request"));
  assert.equal(authored.metadata.trainingQuestionDelivery.phase, "prepared");
  assert.equal(authored.metadata.trainingQuestionDelivery.nativeThreadId, sent.thread.id);
  assert.equal(authored.metadata.trainingQuestionDelivery.nativeTurnId, sent.turn.id);
  assert.equal((await teaching.read()).completion.passed, 0, "Tool preparation is not an assessment pass");
  await process.options.onEvent({ type: "result", session_id: entry.id, subtype: "success",
    result: teaching.input.text, uuid: "actual-claude-question-final" });
  await canonical.wait();
  log = await f.store.readConversationLog(sessionId);
  assert.equal(log.find(turn => turn.turnId === authored.turnId).metadata.trainingQuestionDelivery.phase, "delivered");
  const final = native.owner.readFinalAssistantResult(entry.context.key, entry.id, entry.turn.id);
  assert.equal(final.threadId, sent.thread.id);
  assert.equal(final.turnId, sent.turn.id);
  assert.equal(final.text, teaching.input.text);
  const finalPublication = f.publications.findLast(event => event.reason === "claude-stream-message" &&
    event.payload.conversationLogPatch.turn.messages.some(message => message.messageId === final.itemId));
  assert.ok(finalPublication, "The exact final must have its original canonical publication");
  assert.deepEqual(final.conversationTurn, finalPublication.payload.conversationLogPatch.turn);
  assert.equal(final.conversationTurn.turnId, authored.turnId);
  assert.equal(final.conversationTurn.metadata.trainingQuestionDelivery.phase, "prepared",
    "Later checkpoint promotion cannot rewrite the original published final snapshot");
  assert.equal((await teaching.read()).completion.passed, 0, "Confirmed question delivery is not grading");
  assert.equal(entry.command, null);
  assert.equal(entry.process, process, "The original supplied owner retains its process");
  assert.equal(f.processes.length, 1);
  const delivered = log.find(turn => turn.turnId === authored.turnId);
  await sendLearning({ message: "I try it in Preview.", messageId: "actual-claude-stop-request",
    trainingQuestion: delivered.metadata.trainingQuestionDelivery.reference });
  const answered = (await f.store.readConversationLog(sessionId)).flatMap(turn => turn.messages)
    .find(message => message.messageId === "actual-claude-stop-request");
  assert.equal(answered.text, "I try it in Preview.");
  assert.equal(answered.data.trainingQuestion.attemptId, teaching.attemptId);
  assert.deepEqual(answered.data.trainingQuestion.delivery, { conversationId: sessionId,
    turnId: delivered.turnId, outputId: delivered.metadata.trainingQuestionDelivery.outputId });
  allowed = false;
  await assert.rejects(call("revoked-read", "assistant_action_execute", { actionId: "vibe64.training.learning.read", input: {} }), /Learning actor access revoked/);
  allowed = true;
  await f.provider.interruptTurn(f.context);
  await canonical.wait();
  assert.equal(native.owner.readFinalAssistantResult(entry.context.key, entry.id, entry.turn.id), null);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
});

// Exercise the original Public wrapper, including its early host-owned ID.
test("Claude managed wrapper lends one startup cleanup while initialization is pending", async (t) => {
  const { stopVibe64Execution } = await import("@local/vibe64-execution/server");
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-startup-receipt-"));
  const command = path.join(root, "claude-fixture");
  await writeFile(command, `#!/usr/bin/env node
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  if (frame.type === 'control_request') process.stdout.write(JSON.stringify({
    type: 'system', subtype: 'startup-wait'
  }) + '\\n');
});
`, { mode: 0o700 });
  const initializing = Promise.withResolvers();
  const starts = [];
  const stops = [];
  let starting;
  t.after(async () => {
    if (typeof starts[1]?.stop === "function") await starts[1].stop();
    else if (starts.length) await stopVibe64Execution(starts[0].id);
    await starting?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  starting = createClaudeCodeProcess({ command, workdir: root, credentialHome: { home: root },
    async stopExecution(id, options) {
      stops.push(id);
      return stopVibe64Execution(id, options);
    },
    onStarted(id, stop) { starts.push({ id, stop }); },
    onEvent(event) { if (event.subtype === "startup-wait") initializing.resolve(); }
  });
  starting.catch(() => {});
  await Promise.race([initializing.promise, starting]);
  assert.equal(starts.length, 2);
  assert.equal(starts[0].id, starts[1].id);
  assert.equal(starts[0].stop, undefined, "early ID custody remains before factory initialization");
  assert.equal(typeof starts[1].stop, "function");
  assert.equal((await starts[1].stop()).scopeEmpty, true);
  await assert.rejects(starting, error => error.executionId === starts[0].id && error.stopProof?.scopeEmpty === true);
  assert.deepEqual(stops, [starts[0].id], "startup failure and cancellation join one private cleanup");
});

test("Claude records one execution when the managed wrapper later lends its startup cleanup", async (t) => {
  const f = await fixture(t);
  const metadataWrites = [];
  const write = f.context.runtime.store.writeMetadataValue;
  f.context.runtime.store.writeMetadataValue = async (...args) => {
    metadataWrites.push(args);
    return write(...args);
  };
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions, async createProcess(options) {
    const native = await f.providerOptions.createProcess(options);
    await options.onStarted(native.executionId);
    const writes = metadataWrites.length;
    assert.ok(metadataWrites.some(([, , value]) => {
      try { return JSON.parse(value)?.executionId === native.executionId; }
      catch { return false; }
    }), "early execution custody is persisted before the cleanup receipt arrives");
    await options.onStarted(native.executionId, () => native.stop());
    assert.equal(metadataWrites.length, writes, "lending cleanup does not write the same execution again");
    return native;
  } });
  await provider.sendMessage(f.context, { message: "Go", messageId: "receipt-once" });
  assert.equal(f.processes[0].lastInput.messageId, nativeMessageId("receipt-once"));
});


test("Claude delayed practice events retain only original control after admission callback ends", async (t) => {
  const { runWithPracticeProjectContext, currentProjectRequestContext, currentPracticeProjectScope,
    assertProjectEffectAdmission } = await import("../../packages/vibe64-core/src/server/projectRequestContext.js");
  const f = await fixture(t);
  const owner = {};
  const practice = { access: "write", slug: "training-test", vibe64User: { uid: 42 },
    training: { attemptId: "exact-attempt", pin: { lesson: "exact-pin" } } };
  const release = Promise.withResolvers();
  let delayed;
  let expired;
  let admitted;
  let canonical;
  const observed = [];
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    async publishSessionChanged() {
      const scope = currentPracticeProjectScope(owner);
      if (!scope) return;
      observed.push(scope);
      assert.equal(currentProjectRequestContext().vibe64User.uid, 42);
      assert.deepEqual(scope.training, practice.training);
      if (scope.access === "control") assert.throws(assertProjectEffectAdmission, { code: "vibe64_practice_effect_admission_required" });
    }
  });
  f.behavior.afterSend = native => {
    delayed = release.promise.then(async () => {
      await native.options.onEvent({ type: "assistant", uuid: "late-answer", message: { id: "late-answer", content: [{ type: "text", text: "Preserved answer." }] } });
      await native.options.onEvent({ type: "result", subtype: "success", result: "Preserved answer." });
    });
    delayed.catch(() => {});
  };
  await runWithPracticeProjectContext(owner, practice, async () => {
    expired = currentProjectRequestContext();
    canonical = await provider.open(f.context);
    admitted = await provider.sendMessage(f.context, { message: "Go", messageId: "practice-late-final" });
  });
  await assert.rejects(() => runWithProjectRequestContext(expired, async () => currentProjectRequestContext()), { code: "vibe64_practice_scope_expired" });
  release.resolve();
  await delayed;
  await canonical.wait();
  const state = await provider.sessionState(f.context);
  assert.equal(state.thread.id, admitted.thread.id);
  assert.equal(state.turn.active, false);
  assert.equal(state.turn.state, "completed");
  assert.ok(observed.some(scope => scope.access === "control"));
  assert.equal(f.written.filter(message => message.role === "user").length, 1);
  assert.equal(f.written.find(message => message.role === "assistant").text, "Preserved answer.");
});

test("Claude delayed practice failure proves native stop then publishes original inactive owner", async (t) => {
  const { runWithPracticeProjectContext, currentPracticeProjectScope, assertProjectEffectAdmission } =
    await import("../../packages/vibe64-core/src/server/projectRequestContext.js");
  const f = await fixture(t);
  const owner = {};
  const practice = { access: "write", slug: "training-test", vibe64User: { uid: 42 },
    training: { attemptId: "exact-attempt", pin: { lesson: "exact-pin" } } };
  const release = Promise.withResolvers();
  let delayed;
  let admitted;
  let canonical;
  let observedIdle = false;
  const provider = createClaudeSessionAgentProvider({ ...f.providerOptions,
    async publishSessionChanged(_id, event) {
      const scope = currentPracticeProjectScope(owner);
      if (!scope) return;
      assert.deepEqual(scope.training, practice.training);
      if (event.reason === "claude-stream-turn-idle") {
        assert.equal(scope.access, "control");
        assert.throws(assertProjectEffectAdmission, { code: "vibe64_practice_effect_admission_required" });
        assert.equal(f.processes[0].stopped, true);
        observedIdle = true;
      }
    }
  });
  f.behavior.afterSend = native => {
    delayed = release.promise.then(() => native.options.onFailure(new Error("Broken practice stream")));
    delayed.catch(() => {});
  };
  await runWithPracticeProjectContext(owner, practice, async () => {
    canonical = await provider.open(f.context);
    admitted = await provider.sendMessage(f.context, { message: "Go", messageId: "practice-late-failure" });
  });
  release.resolve();
  await delayed;
  await canonical.wait();
  const state = await provider.sessionState(f.context);
  assert.equal(state.thread.id, admitted.thread.id);
  assert.equal(f.processes[0].stopped, true);
  assert.equal(state.turn.active, false);
  assert.equal(state.turn.state, "interrupted");
  assert.equal(state.turn.error, "Broken practice stream");
  assert.equal(observedIdle, true);
});


test("Claude native cleanup cannot leave the saved run active when learning checkpoint refuses", async (t) => {
  const f = await fixture(t);
  const sent = await f.provider.sendMessage(f.context, { message: "Go", messageId: "refused-checkpoint-stop" });
  f.context.runtime.learningScope = { noExercise: true };
  f.context.runtime.getNativeExecutionRoot = async () => f.context.session.metadata.source_path;
  f.context.runtime.learningTeaching = {
    async completeConversation() { throw Object.assign(new Error("Saved lesson authority changed before checkpoint."), { code: "test_checkpoint_refused" }); }
  };
  try {
    await assert.rejects(() => f.processes[0].options.onFailure(new Error("Broken stream")), { code: "test_checkpoint_refused" });
    assert.equal(f.processes[0].stopped, true, "the original native cleanup completed");
    const saved = JSON.parse(f.context.session.metadata[`claude_conversation_${sent.thread.id}`]);
    assert.equal(saved.state, "interrupted", "verified native cleanup must not retain an active checkpoint");
    const state = await f.provider.sessionState(f.context);
    assert.equal(state.turn.active, false);
    assert.equal(state.turn.error, "Saved lesson authority changed before checkpoint.");
  } finally {
    delete f.context.runtime.learningScope;
    delete f.context.runtime.learningTeaching;
  }
});

test("Claude successful startup diagnostics distinguish launch from initialization and warn only when slow", async (t) => {
  const { runVibe64Command } = await import("@local/vibe64-execution/server");
  for (const [elapsed, level] of [[5_000, "warn"], [5_001, "warn"], [5_001, "debug"]]) await t.test(`${elapsed}ms ${level}`, async t => {
    const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-startup-timing-"));
    const command = path.join(root, "claude-fixture");
    await writeFile(command, `#!/usr/bin/env node
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  if (frame.type !== 'control_request') return;
  process.stderr.write('private startup output\\n');
  process.stdout.write(JSON.stringify({ type: 'control_response', response: {
    subtype: 'success', request_id: frame.request_id, response: { privateValue: 'private response' }
  } }) + '\\n');
});
`, { mode: 0o700 });
    let clock = 100_000;
    t.mock.method(Date, "now", () => clock);
    const diagnostics = [];
    let native;
    t.after(async () => {
      await native?.stop();
      await rm(root, { recursive: true, force: true });
    });
    native = await createClaudeCodeProcess({ command, workdir: root, credentialHome: { home: root }, accountQuery: "catalogue",
      env: { ...process.env, ANTHROPIC_API_KEY: "private-credential" },
      async commandRunner(input) {
        const result = await runVibe64Command(input);
        clock += 2_000;
        return result;
      },
      logger: { level, ...Object.fromEntries(["info", "warn"].map(logLevel => [logLevel, fields => {
        diagnostics.push({ level: logLevel, ...fields });
        if (fields.stage === "stream_ready") clock += elapsed - 2_000;
      }])) }
    });
    assert.deepEqual(diagnostics.map(event => event.stage), ["starting", "stream_ready",
      "initialize_requested", "initialize_written", "initialize_response_received", "initialized"]);
    const completed = diagnostics.at(-1);
    assert.equal(completed.durationMs, elapsed);
    assert.equal(completed.streamReadyMs, 2_000);
    assert.equal(completed.initializationMs, elapsed - 2_000);
    assert.equal(completed.executionId, native.executionId);
    assert.ok(diagnostics.every(event => level === "debug"
      ? event.accountQuery === "catalogue" : !Object.hasOwn(event, "accountQuery")));
    assert.equal(completed.level, elapsed > 5_000 ? "warn" : "info");
    assert.equal(diagnostics.filter(event => event.level === "warn").length, elapsed > 5_000 ? 1 : 0);
    assert.doesNotMatch(JSON.stringify(diagnostics), /private startup output|private response|private-credential/);
  });
});

test("Claude startup failure preserves bounded redacted stderr before verified cleanup", async (t) => {
  const { runVibe64Command, stopVibe64Execution } = await import("@local/vibe64-execution/server");
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-startup-stderr-"));
  const command = path.join(root, "claude-fixture");
  await writeFile(command, `#!/usr/bin/env node
require('node:readline').createInterface({ input: process.stdin }).on('line', line => {
  const frame = JSON.parse(line);
  if (frame.type !== 'control_request') return;
  const secret = process.env.ANTHROPIC_API_KEY;
  const ending = '\\nstartup diagnostic marker\\nAPI_TOKEN=assignment-secret\\nBearer bearer-secret\\n' + secret + '\\n';
  const boundary = secret.slice(10);
  require('node:fs').writeSync(2, 'old-prefix\\n' + 'z'.repeat(70 * 1024) + secret + '\\n' +
    'x'.repeat(64 * 1024 - boundary.length - 1 - ending.length) + ending);
  process.stdout.write(JSON.stringify({ type: 'system', subtype: 'startup-wait',
    stdoutOnly: 'stdout must not be preserved' }) + '\\n');
});
`, { mode: 0o700 });
  const initialized = Promise.withResolvers();
  const starts = [];
  const stops = [];
  const diagnostics = [];
  let logPath;
  let starting;
  t.after(async () => {
    if (typeof starts[1]?.stop === "function") await starts[1].stop();
    else if (starts.length) await stopVibe64Execution(starts[0].id);
    await starting?.catch(() => {});
    await rm(root, { recursive: true, force: true });
  });
  starting = createClaudeCodeProcess({ command, workdir: root, credentialHome: { home: root },
    logger: { info: fields => diagnostics.push(fields), warn: fields => diagnostics.push(fields) },
    env: { ...process.env, ANTHROPIC_API_KEY: "bare-fixture-credential" },
    commandRunner(input) { logPath = input.logPath; return runVibe64Command(input); },
    async stopExecution(id, options) {
      stops.push(id);
      const output = await readFile(logPath);
      assert.ok(output.toString().includes("startup diagnostic marker"));
      assert.ok(output.subarray(-64 * 1024).toString().startsWith("bare-fixture-credential".slice(10)),
        "the real bounded reader begins inside the supplied credential");
      return stopVibe64Execution(id, options);
    },
    onStarted(id, stop) { starts.push({ id, stop }); },
    onEvent(event) { if (event.subtype === "startup-wait") initialized.resolve(); }
  });
  starting.catch(() => {});
  await Promise.race([initialized.promise, starting]);
  assert.equal((await starts[1].stop()).scopeEmpty, true);
  await assert.rejects(starting, error => {
    assert.equal(error.message, "Claude connection was closed.");
    assert.equal(error.executionId, starts[0].id);
    assert.equal(error.stopProof.scopeEmpty, true);
    const failure = diagnostics.find(event => event.stage === "failed");
    assert.equal(failure.executionId, starts[0].id);
    assert.equal(failure.scopeEmpty, true);
    assert.ok(failure.durationMs >= 0);
    assert.match(failure.nativeStartupStderr, /startup diagnostic marker/);
    assert.doesNotMatch(JSON.stringify(diagnostics), /assignment-secret|bearer-secret|bare-fixture-credential|stdout must not be preserved/);
    assert.ok(error.nativeStartupStderr.includes("startup diagnostic marker"));
    assert.ok(error.nativeStartupStderr.includes("[redacted]"));
    assert.ok(error.nativeStartupStderr.length <= 64 * 1024);
    for (const absent of ["old-prefix", "assignment-secret", "bearer-secret",
      "bare-fixture-credential", "bare-fixture-credential".slice(10), "stdout must not be preserved"]) {
      assert.equal(error.nativeStartupStderr.includes(absent), false);
    }
    assert.equal(Object.keys(error).includes("nativeStartupStderr"), false);
    return true;
  });
  await assert.rejects(readFile(logPath), { code: "ENOENT" });
  assert.deepEqual(stops, [starts[0].id], "diagnostic capture keeps the original single cleanup");
});


// Compose the real supplied Claude owner and common accepted-request lifetime.
// No reader is mocked to accept current:true after native settlement.
test("actual Claude Main separate-final completion uses only a settled native receipt and retains its fresh fences", { timeout: 30_000 }, async t => {
  for (const disposition of ["delivered", "selection-changed", "newer-user"]) await t.test(disposition, async t => {
    const { trainingTeachingFixture } = await import("../fixtures/trainingTeachingFixture.js");
    const { Vibe64SessionRuntime } = await import("@local/vibe64-runtime/server");
    const { createTrainingMainTeaching } = await import("../../packages/vibe64-training/src/server/mainTeaching.js");
    const { createTrainingAnswerAssessment } = await import("../../packages/vibe64-training/src/server/answerAssessment.js");
    const { createTrainingLearningSessions } = await import("../../packages/vibe64-training/src/server/learningSessions.js");
    const { createTrainingTeachingBrief } = await import("../../packages/vibe64-training/src/server/teachingBrief.js");
    const { createTrainingActions } = await import("../../packages/vibe64-training/src/server/actions.js");
    const { createTrainingTeachingActions } = await import("../../packages/vibe64-training/src/server/teachingActions.js");
    const { createLearningTeachingContextActions } = await import("../../packages/vibe64-sessions/src/server/actions.js");
    let removeTeaching;
    const teaching = await trainingTeachingFixture({ after(callback) { removeTeaching = callback; } }, { ready: false, exercise: false });
    teaching.actor.role = "owner";
    const main = createTrainingMainTeaching({ teaching: teaching.owner,
      assessment: createTrainingAnswerAssessment({ learners: teaching.learners, content: teaching.content, teaching: teaching.owner }) });
    const saved = await teaching.learners.readLearningSessionScope({ actor: teaching.actor, attemptId: teaching.attemptId });
    const actions = createActionCatalogue();
    const brief = createTrainingTeachingBrief({ learners: teaching.learners, content: teaching.content });
    let runtime, entry, owner, adapter, checkpointReads = 0;
    const teachingHost = { ...main,
      bindConversation(input) { adapter = input.native; return main.bindConversation(input); },
      async completeConversation(input) {
        checkpointReads++;
        assert.equal(entry.nativeTurn.read().active, false, "native settlement precedes the original before-state checkpoint");
        assert.equal(owner.readRetainedTurn(entry.context.key, entry.id, { saved: null, current: true }), null,
          "the actual active-only tool reader cannot admit settled work");
        const final = owner.readFinalAssistantResult(entry.context.key, entry.id, entry.turn.id);
        assert.ok(final);
        assert.equal(final.inputMessageId, nativeMessageId("separate-final-input"));
        assert.equal(final.itemId, final.conversationTurn.assistant.messageId);
        assert.equal(final.outputId, final.conversationTurn.assistant.outputId);
        assert.equal(owner.readFinalAssistantResult(entry.context.key, "foreign-thread", entry.turn.id), null);
        assert.equal(owner.readFinalAssistantResult(entry.context.key, entry.id, "foreign-turn"), null);
        for (const [field, replacement] of [["process", {}], ["executionId", "foreign-execution"],
          ["accountIdentity", "foreign-account"]]) {
          const original = entry[field]; entry[field] = replacement;
          try {
            assert.equal(owner.readFinalAssistantResult(entry.context.key, entry.id, entry.turn.id), null);
            if (typeof adapter.readCompletedTurn === "function") assert.equal(
              await adapter.readCompletedTurn({ threadId: input.nativeTurn.threadId, turnId: input.nativeTurn.turnId }), null,
              `settled projection cannot reattach ${field}`);
          } finally { entry[field] = original; }
        }
        if (disposition === "selection-changed") await runtime.store.writeMetadataValue(input.sessionId, "assistant_selection",
          JSON.stringify({ ...f.context.assistantSelection, modelId: "haiku" }));
        if (disposition === "newer-user") await runtime.store.writeConversationUserMessage(input.sessionId,
          { messageId: "later-accepted-input", text: "A later user owns the conversation." });
        await main.completeConversation(input);
      }
    };
    const learning = createTrainingLearningSessions({ learners: teaching.learners, teachingBrief: brief, learningTeaching: teachingHost,
      project: { createRuntime: async () => runtime }, sessions: { createSession() {}, inspectSession() {} } });
    const scope = await learning.resolveContext({ actor: teaching.actor, attemptId: teaching.attemptId });
    const f = await boundMainFixture(t, { actions,
      toolPolicy: ({ actionId, context }) => Boolean(context.runtime?.learningScope && context.runtime.learningTeaching?.actionIds.includes(actionId)),
      async runtimeFactory(base) {
        base.context.sessionId = `learning-${teaching.attemptId}`;
        runtime = new Vibe64SessionRuntime({ projectContextRoot: base.root, projectRuntimeRoot: saved.projectRuntimeRoot,
          learningScope: scope.learningScope, learningInstructions: scope.learningInstructions, learningTeaching: teachingHost,
          promptRenderer: () => assert.fail("source-less teaching must not create a project prompt") });
        await runtime.createSession({ sessionId: base.context.sessionId,
          metadata: { assistant_selection: base.context.session.metadata.assistant_selection } });
        return runtime;
      }
    });
    t.after(() => removeTeaching());
    actions.register({ contributorId: "settled-claude-main", domain: "training", actions: [
      ...createSessionActions({ sessions: {} }).filter(action => action.id === ACTION_READ_CONVERSATION_CONTEXT),
      ...createLearningTeachingContextActions(),
      ...createTrainingActions({ catalogue: { readCatalogue() {} }, learners: teaching.learners, teachingBrief: brief }),
      ...createTrainingTeachingActions({ mainTeaching: main })
    ].map(action => ({ ...action, channels: action.channels || ["api", "automation", "internal"], surfaces: ["app"] })) });
    registerVibe64ActionContext(actions, { resolveUser: async () => teaching.actor,
      authorizeProject: () => assert.fail("source-less teaching cannot borrow a Working ACL"),
      resolveLearningContext: input => learning.resolveContext(input) });
    const sessionId = f.context.sessionId;
    const requestContext = { surface: "app", channel: "internal", requestMeta: { request: {
      params: { learningAttemptId: teaching.attemptId }, vibe64User: teaching.actor } } };
    Object.assign(f.context, { vibe64User: teaching.actor, teachingActions: actions,
      browserAuthority: { sessionId, learningAttemptId: teaching.attemptId, actorId: scope.learningScope.learnerId, requestContext },
      teachingTerminals: { async requireAssistantSelectionAccess(selection, options) {
        assert.deepEqual(selection, defineVibe64AssistantSelection(f.context.assistantSelection));
        assert.equal(options.vibe64User.uid, teaching.actor.uid);
      } } });
    const canonical = await f.open();
    const input = { message: "Teach the exact saved question.", messageId: "separate-final-input", clientId: "original-browser" };
    const sent = await f.provider.sendMessage(f.context, await main.captureMessage({ input, context: f.context, runtime, sessionId, actions }));
    assert.equal(sent.delivered, true);
    const process = f.processes[0];
    const native = (await createSessionConversationBinding(f.provider, sessionId, f.context)).native;
    owner = native.owner;
    entry = [...owner.entries.values()].find(value => value.main && value.context.sessionId === sessionId);
    assert.ok(owner.readRetainedTurn(entry.context.key, entry.id, { saved: null, current: true }), "active tools retain their original actual native input guard");
    await process.options.onEvent({ type: "assistant", session_id: entry.id, uuid: "progress-before-question",
      message: { content: [{ type: "text", text: "I will prepare the question." }] } });
    const argumentsValue = { actionId: "vibe64.training.question.prepare", input: { attemptId: teaching.attemptId,
      expectedRevision: 1, requestId: "separate-final-question", assessmentId: "explain", text: teaching.input.text, assistance: "none" } };
    async function call(id, name, input) {
      await process.options.onEvent({ type: "assistant", session_id: entry.id, uuid: `native-${id}`,
        message: { content: [{ type: "tool_use", id, name: `mcp__application__${name}`, input }] } });
      const response = await process.options.onControlRequest({ subtype: "mcp_message", server_name: "application",
        message: { jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: input,
          _meta: { "claudecode/toolUseId": id } } } }, { signal: new AbortController().signal });
      return JSON.parse(response.mcp_response.result.content[0].text);
    }
    const contract = await call("separate-final-contract", "assistant_action_contract", {
      actionId: "vibe64.training.question.prepare", version: 1 });
    assert.equal(contract.ok, true, JSON.stringify(contract));
    const response = await call("prepare-separate-final", "assistant_action_execute", argumentsValue);
    assert.equal(response.ok, true, JSON.stringify(response));
    const authored = (await f.store.readConversationLog(sessionId)).find(turn => turn.messages.some(message => message.messageId === input.messageId));
    assert.equal(authored.metadata.trainingQuestionDelivery.phase, "prepared");
    await process.options.onEvent({ type: "result", session_id: entry.id, subtype: "success", result: teaching.input.text, uuid: "separate-native-final" });
    await canonical.wait();
    assert.equal(checkpointReads, 1);
    const log = await f.store.readConversationLog(sessionId);
    const final = owner.readFinalAssistantResult(entry.context.key, entry.id, entry.turn.id);
    assert.ok(final);
    assert.notEqual(final.conversationTurn.turnId, authored.turnId, "the original canonical writer retains the separate final carrier");
    assert.equal(log.find(turn => turn.turnId === authored.turnId).metadata.trainingQuestionDelivery.phase, "prepared");
    assert.equal(log.find(turn => turn.turnId === final.conversationTurn.turnId).metadata.trainingQuestionDelivery?.phase,
      disposition === "delivered" ? "delivered" : undefined, "only the same saved selection and latest accepted user can promote that exact native final");
    assert.equal(typeof adapter.readCompletedTurn, "function", "the completion hook is mandatory after the real delivery assertion");
    assert.equal((await teaching.read()).completion.passed, 0, "question delivery is never grading");
    assert.equal(entry.process, process);
    assert.equal(f.processes.length, 1, "completion does not replace the original process");
  });
});


test("Main transfer budget uses Claude's current context and reserves the request and working space", async t => {
  const f = await fixture(t);
  const binding = await createSessionConversationBinding(f.provider, f.context.sessionId, f.context);
  const signal = new AbortController().signal;
  const options = { context: f.context, input: { message: "Continue" }, handover: "", signal };
  const before = await binding.maximumHistoryBytes(options);
  assert.equal(before, 967_000 - 1000 - 48_350 - 8 - 2 - 4096);
  assert.equal(f.processes.length, 1);
  assert.equal(f.processes[0].lastInput, undefined, "Budget inspection must not submit a request");
  f.behavior.contextUsage = { totalTokens: 20_000, maxTokens: 200_000, autoCompactThreshold: 167_000, model: "haiku" };
  const after = await binding.maximumHistoryBytes(options);
  assert.equal(after, 167_000 - 20_000 - 32_768 - 8 - 2 - 4096);
  assert.equal(f.processes.length, 1, "Repeated inspection reuses the original native owner");
  assert.ok(after < before);
});

test("Main transfer budget summarises a nearly full Claude context before sizing history", async t => {
  const f = await fixture(t);
  const binding = await createSessionConversationBinding(f.provider, f.context.sessionId, f.context);
  const options = { context: f.context, input: { message: "Continue" }, handover: "", signal: new AbortController().signal };
  f.behavior.contextUsage = { totalTokens: 946_000, maxTokens: 1_000_000, autoCompactThreshold: 967_000, model: "opus" };
  f.behavior.afterSend = async (native, message) => {
    assert.equal(message, "/compact");
    f.behavior.contextUsage = { ...f.behavior.contextUsage, totalTokens: 40_000 };
    await native.options.onEvent({ type: "result", subtype: "success", result: "", local_command: "compact",
      user_message_uuid: native.lastInput.messageId, session_id: native.options.sessionId });
  };
  const phases = [];
  assert.equal(await binding.maximumHistoryBytes({ ...options, setPhase: async phase => phases.push(phase) }),
    967_000 - 40_000 - 48_350 - 8 - 2 - 4096);
  assert.equal(f.processes[0].lastInput.message, "/compact");
  assert.deepEqual(phases, ["compacting", "preparing"], "the wait is shown while Claude summarises");

  f.behavior.contextUsage = { totalTokens: 946_000, maxTokens: 1_000_000, autoCompactThreshold: 967_000, model: "opus" };
  f.behavior.afterSend = async native => native.options.onEvent({ type: "result", subtype: "error_during_execution", is_error: true,
    local_command: "compact", user_message_uuid: native.lastInput.messageId, session_id: native.options.sessionId });
  await assert.rejects(binding.maximumHistoryBytes(options), error => error.code === "vibe64_assistant_context_full" &&
    error.statusCode === 409 && /could not be summarised automatically/u.test(error.message));

  f.behavior.afterSend = async native => native.options.onEvent({ type: "result", subtype: "success", result: "",
    local_command: "compact", user_message_uuid: native.lastInput.messageId, session_id: native.options.sessionId });
  await assert.rejects(binding.maximumHistoryBytes(options), error => error.code === "vibe64_assistant_context_full" &&
    error.statusCode === 409 && /too full/u.test(error.message), "a summary that frees too little stays a readable refusal");
});


for (const smallWindow of [false, true]) test(`Main Claude switching retains complete visible history within its actual budget, smallWindow=${smallWindow}`, async t => {
  const f = await fixture(t);
  await f.context.runtime.store.writeMetadataValue("test", "agent_briefing_delivered", "yes");
  f.context.runtime.renderPrompt = async () => {
    assert.fail("Provider switching must not send transferred history through the already-delivered Genesis opening prompt");
  };
  if (smallWindow) f.behavior.contextUsage = { totalTokens: 1000, maxTokens: 200_000, autoCompactThreshold: 167_000, model: "haiku" };
  const store = f.context.runtime.store;
  const texts = [];
  for (let index = 0; index < 40; index++) {
    const user = `Question ${index}: ` + "x".repeat(2400);
    const answer = `Answer ${index}: ` + "y".repeat(2400);
    texts.push(user, answer);
    await store.writeConversationUserMessage("test", { messageId: `previous-user-${index}`, text: user });
    await store.writeConversationThinkingMessage("test", { messageId: `private-thinking-${index}`, text: "REASONING MUST NOT TRANSFER" });
    await store.writeConversationAssistantMessage("test", { messageId: `previous-answer-${index}`, text: answer });
  }
  await store.writeMetadataValue("test", "assistant_changeover", JSON.stringify({ lastEngine: "codex", engines: { codex: { seen: {} } } }));
  const before = await store.readConversationLog("test");
  const sent = await f.provider.sendMessage(f.context, { messageId: "switch-to-claude", message: "Continue this work." });
  assert.equal(sent.ok, true, sent.error);
  const prompt = f.processes[0].lastInput.message;
  const history = JSON.parse(prompt.split("\n").find(line => line.startsWith('{"messages":[')));
  assert.equal(prompt.includes("REASONING MUST NOT TRANSFER"), false);
  assert.equal(history.messages.length > 30, true);
  assert.deepEqual(history.messages.map(message => message.text), texts.slice(-history.messages.length));
  assert.equal(history.messages.length === 80, !smallWindow);
  assert.deepEqual((await store.readConversationLog("test")).slice(0, before.length), before, "The original saved conversation is unchanged");
  assert.equal(f.processes.length, 1);
});
