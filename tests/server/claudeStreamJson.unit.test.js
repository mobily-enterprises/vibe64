import { prepareSessionDetachedConversationRun, prepareSessionDetachedConversationCleanup, createSessionConversationBinding, prepareSessionConversationActivity, prepareSessionConversationRenewal, prepareSessionConversationCreation, prepareSessionConversationReadiness, prepareSessionConversationDisposal, prepareProjectConversationCleanup, prepareConversationRuntimeInvalidation, prepareConversationReconciliation } from "../../packages/vibe64-terminals/src/server/mainConversationBinding.js";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { test } from "node:test";
import { mkdtemp, rm, readFile, writeFile, mkdir } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { claudeCodeArguments, createClaudeCodeProcess } from "../../packages/vibe64-terminals/src/server/claudeCodeProcess.js";
import { readClaudeHistory } from "@jskit-ai/assistant-core/server/claude-history";
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

test("Claude subscription launch preserves native auth and makes helper tools unavailable", () => {
  const args = claudeCodeArguments({ sessionId: "session", resume: true, model: "sonnet", effort: "high", toolFree: true });
  assert.ok(args.includes("--resume"));
  assert.ok(args.includes("stream-json"));
  assert.equal(args[args.indexOf("--thinking-display") + 1], "summarized");
  assert.equal(claudeCodeArguments({ terminal: true }).includes("--thinking-display"), false);
  assert.equal(args.includes("--bare"), false);
  assert.equal(args[args.indexOf("--tools") + 1], "");
  assert.equal(args.includes("bypassPermissions"), false);
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
      ? prepareSessionConversationReadiness(provider, id, context) : operation === "dispose"
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
      ? prepareSessionConversationReadiness(provider, id, context) : operation === "dispose"
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
  const behavior = { account: { loggedIn: true, email: "owner@example.test", authMethod: "claude.ai" } };
  const providerOptions = { [fixtureRuntimeOwners]: owners, systemRoot: path.join(root, "system"), env: {
    CLAUDE_CONFIG_DIR: path.join(root, "config"), VIBE64_AGENT_RUNTIME_DIR: path.join(root, "agent-runtime")
  },
    projectService: { readCurrentProject: async () => ({ sourceRoot: workdir }) },
    accountStatus: async () => behavior.account,
    credentialHome: { home: root }, recordGitActor: async () => ({ ok: true }), connectionStatus: async () => true,
    createProcess: async (options) => {
      const native = { options, executionId: `test-${processes.length}`, stopped: false, stopAllowed: true,
        initialization: { models: [{ value: "sonnet", supportedEffortLevels: ["low", "high"] }, { value: "haiku", supportedEffortLevels: [] }] },
        async stop() { this.stopped = this.stopAllowed; return { exited: this.stopped, scopeEmpty: this.stopped }; },
        client: { async request(request) { (native.requests ||= []).push(request); return {}; }, interrupt: async () => {
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
  return { provider, providerOptions, behavior, context, processes, written, root, checkpoints, git };
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
  assert.deepEqual(f.written.map((message) => message.role), ["user", "user", "thinking", "assistant"]);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  assert.equal(f.checkpoints.at(-1).status, "ready");
  assert.equal(f.git("show", `${f.checkpoints.at(-1).checkpointCommit}:edited.txt`), "Retain this work");
  assert.equal(f.git("rev-parse", "HEAD"), previousHead);
  assert.equal((await f.provider.sendMessage(f.context, { message: "First", messageId: "first" })).duplicate, true);
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
  assert.equal((await state()).turn.phase, "");
});

test("Claude stop requires process exit proof and resume keeps the native conversation", async (t) => {
  const f = await fixture(t);
  const initial = await f.provider.sendMessage(f.context, { message: "Go", messageId: "go" });
  f.processes[0].stopAllowed = false;
  await assert.rejects(f.provider.interruptTurn(f.context), /exit has not been confirmed/u);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, true);
  f.processes[0].stopAllowed = true;
  await f.provider.interruptTurn(f.context);
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
  await f.provider.sendMessage(f.context, { message: "Continue", messageId: "continue" });
  assert.equal(f.processes[1].options.sessionId, initial.thread.id);
  assert.equal(f.processes[1].options.resume, true);
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
  assert.equal((await f.provider.sessionState(f.context)).turn.active, false);
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

test("Claude account identity survives restart and prevents another account from resuming owned history", async (t) => {
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
  await assert.rejects(restarted.sendMessage(f.context, { message: "Other account", messageId: "other" }),
    (error) => error.code === "vibe64_claude_account_changed");
  assert.equal(f.processes[1].stopped, true);
  const changedRestart = createClaudeSessionAgentProvider(f.providerOptions);
  assert.equal((await changedRestart.describeProvider(f.context)).accountIdentitySignature, changed.accountIdentitySignature);
  await assert.rejects(changedRestart.sendMessage(f.context, { message: "Other account", messageId: "other" }),
    (error) => error.code === "vibe64_claude_account_changed");
  assert.equal(f.processes.length, 2);
});

test("Claude requires an authenticated account identity before starting a native conversation", async (t) => {
  const f = await fixture(t);
  f.behavior.account = { loggedIn: false };
  await assert.rejects(f.provider.sendMessage(f.context, { message: "Work" }),
    (error) => error.code === "vibe64_claude_account_required");
  assert.equal(f.processes.length, 0);
});



test("Claude changes model and effort through native controls without restarting the conversation", async (t) => {
  const f = await fixture(t);
  const first = await f.provider.sendMessage(f.context, { message: "Hello", messageId: "initial" });
  await f.processes[0].options.onEvent({ type: "result", subtype: "success", result: "Ready." });
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
  const retired = provider.invalidateRuntimes({}, { provider: "claude", reason: "claude-auth-change" });
  response.reject(new Error("Native usage unavailable"));
  await rejectedUsage;
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
    await writeFile(path.join(directory, `${native.options.sessionId}.jsonl`), `${JSON.stringify({
      type: "attachment", timestamp: new Date(timestamp++).toISOString(),
      attachment: { type: "goal_status", condition: condition === "clear" ? "Tests pass" : condition, sentinel: true, met: condition === "clear" }
    })}\n`);
    if (condition === "clear") await native.options.onEvent({ type: "result", subtype: "success", result: "" });
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
  assert.equal(forwarded.length, 2);
  assert.deepEqual(forwarded.map(event => [event.threadId, event.turnId]), [[conversationId, first.runId], [conversationId, first.runId]]);
  assert.equal(forwarded[0].message.id, "claude_temporary-api_0");
  assert.equal(forwarded[0].message.complete, false);
  assert.equal(forwarded[1].message.id, "claude_temporary-frame_0");
  assert.equal(forwarded[1].message.outputId, forwarded[0].message.id);
  assert.equal(forwarded[1].message.complete, true);
  const observed = await f.provider.readConversation(f.context, { conversationId, persistent: true });
  assert.deepEqual(observed.messages.find(message => message.id === forwarded[1].message.id), forwarded[1].message);
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
    await writeFile(path.join(root, "connection.json"), JSON.stringify({ apiKey: "private-key", claudeReady: true }));
    const verified = await f.provider.assistantAccess(context);
    assert.equal(verified.available, true);
    assert.equal(verified.connectionIdentity, `curated:${providerId}:fixture-generation`);
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
  const home = path.join(f.providerOptions.systemRoot, "ai-connections", "codex", "deepseek");
  await mkdir(home, { recursive: true });
  await writeFile(path.join(home, "connection.json"), JSON.stringify({ apiKey: "fixture-deepseek-secret", claudeReady: true }));
  const first = await f.provider.sendMessage(f.context, { message: "Plan this", messageId: "plan" });
  const native = f.processes[0];
  await native.options.onEvent({ type: "result", subtype: "success", result: "Agreed." });
  f.context.assistantSelection = { ...f.context.assistantSelection, modelProviderId: "deepseek", modelId: "deepseek-flash" };
  const second = await f.provider.sendMessage(f.context, { message: "Implement it", messageId: "code" });
  assert.equal(second.thread.id, first.thread.id);
  assert.equal(f.processes.length, 1);
  assert.deepEqual(native.requests.slice(-2).map(({ subtype }) => subtype), ["apply_flag_settings", "set_model"]);
  const flags = native.requests.at(-2).settings;
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
  const root = path.join(f.providerOptions.systemRoot, "ai-connections", "codex", "deepseek");
  await mkdir(path.join(root, "auth", "codex"), { recursive: true });
  await writeFile(path.join(root, "connection.json"), JSON.stringify({ apiKey: "claude-only-key", codexDisabled: true, claudeReady: true }));
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
  await terminalProvider.startTerminal(f.context);
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
      ? prepareSessionConversationReadiness(provider, id, context) : operation === "dispose"
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
    await writeHistory(f, native.options.sessionId, [{ type: "attachment", timestamp: new Date(timestamp++).toISOString(),
      attachment: { type: "goal_status", condition: condition === "clear" ? "Tests pass" : condition,
        sentinel: true, met: condition === "clear" } }]);
    if (condition === "clear") await native.options.onEvent({ type: "result", subtype: "success", result: "" });
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

test("main Claude canonical goals adopt original receipts and keep literal commands outside chat changeover", { timeout: 15000 }, async t => {
  const f = await boundMainFixture(t);
  const canonical = await f.open();
  const events = [];
  canonical.subscribe(event => events.push(event));
  const sent = [];
  let timestamp = Date.now();
  f.behavior.afterSend = async (native, message) => {
    sent.push(message);
    if (message.startsWith("/goal ")) {
      const condition = message.slice(6);
      await writeHistory(f, native.options.sessionId, [{ type: "attachment", timestamp: new Date(timestamp++).toISOString(),
        attachment: { type: "goal_status", condition: condition === "clear" ? "Tests pass" : condition,
          sentinel: true, met: condition === "clear" } }]);
      if (condition !== "clear") return;
    }
    await native.options.onEvent({ type: "result", subtype: "success", result: "" });
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
  let goal = await canonical.readGoal();
  assert.equal(goal.status, "active");
  await assert.rejects(canonical.updateGoal({ action: "pause", expectedSegmentId: segmentId, expectedGoalId: "stale" }), /goal changed/u);
  assert.equal((await canonical.updateGoal({ action: "pause", expectedSegmentId: segmentId, expectedGoalId: goal.id })).status, "paused");
  const resumed = await canonical.updateGoal({ action: "resume", expectedSegmentId: segmentId,
    expectedGoalId: goal.id, messageId: "resume-goal" });
  assert.equal(resumed.status, "accepted");
  goal = await canonical.readGoal();
  const cleared = await canonical.updateGoal({ action: "cancel", expectedSegmentId: segmentId,
    expectedGoalId: goal.id, messageId: "clear-goal" });
  assert.equal(cleared.status, "accepted");
  await canonical.wait();
  assert.equal(await canonical.readGoal(), null);
  assert.deepEqual(sent, ["/goal Tests pass", "/goal Tests pass", "/goal clear"]);

  await f.provider.sendMessage(f.context, { message: "Ordinary chat", messageId: "chat-before-goal" });
  await canonical.wait();
  await f.store.writeConversationAssistantMessage("test", { messageId: "late-context", text: "A later result for the chat cursor." });
  const cursor = (await f.store.readSession("test")).metadata.assistant_changeover;
  assert.ok(cursor);
  const next = await canonical.updateGoal({ action: "set", expectedSegmentId: segmentId,
    objective: "Follow up", messageId: "after-chat-goal" });
  assert.equal(next.status, "accepted");
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
  const closed = await native.dispose(f.context);
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


test("main Claude terminal service uses the actual manager, shared runtime and native receipt owner", { timeout: 30000 }, async t => {
  let removeFixture;
  const f = await fixture({ after(callback) { removeFixture = callback; } });
  let service;
  t.after(async () => {
    try { await service?.close(); }
    finally { await removeFixture(); }
  });
  const store = createVibe64SessionStore({ projectContextRoot: f.root, projectRuntimeRoot: path.join(f.root, "runtime") });
  await store.createSession({ sessionId: "test", runtimeKind: "genesis",
    metadata: { ...f.context.session.metadata, label: "BoundClaude" } });
  const runtime = { ...f.context.runtime, stateRoot: path.join(f.root, "runtime"),
    projectContextRoot: f.root, store, getSession: id => store.readSession(id) };
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
createInterface({ input: process.stdin }).on('line', async line => {
  const frame = JSON.parse(line);
  trace({ frame });
  if (frame.type === 'control_request') {
    emit({ type: 'control_response', response: { subtype: 'success', request_id: frame.request_id,
      response: { models: [{ value: 'sonnet', supportedEffortLevels: ['high'] }] } } });
    if (frame.request.subtype === 'interrupt') emit({ type: 'result', subtype: 'success', terminal_reason: 'aborted_streaming', result: '' });
    return;
  }
  if (frame.type !== 'user') return;
  record(frame);
  const text = frame.message.content;
  if (text.startsWith('/goal ')) {
    while (existsSync(${JSON.stringify(goalAcknowledgementGate)})) await new Promise(resolve => setTimeout(resolve, 5));
    const condition = text.slice(6);
    record({ type: 'attachment', timestamp: new Date().toISOString(), attachment: {
      type: 'goal_status', condition: condition === 'clear' ? 'Tests pass' : condition, sentinel: true, met: condition === 'clear'
    } });
    emit(frame);
    if (condition === 'clear') emit({ type: 'result', subtype: 'success', result: '' });
    return;
  }
  emit(frame);
  emit({ type: 'stream_event', event: { type: 'message_start', message: { id: frame.uuid + '-reply' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } } });
  emit({ type: 'stream_event', event: { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Service progress' } } });
});
`, { mode: 0o700 });
  const publications = [];
  const streamed = Promise.withResolvers();
  service = createTerminalService({ projectService,
    env: { ...f.providerOptions.env, VIBE64_CLAUDE_COMMAND: command,
      VIBE64_SYSTEM_ROOT: path.join(f.root, "system"), VIBE64_RUNTIME_NAMESPACE: "test", VIBE64_WORKSPACE: "test" },
    codexTerminalController: { codexToolHomeRequired: false,
      codexAppServerProviderOptions: { systemRoot: path.join(f.root, "system") } },
    publishSessionChanged: { agentTerminal: async (_sessionId, event) => {
      publications.push(event);
      if (event.reason === "assistant-stream" && event.payload.conversationStream.messages.some(message => message.text === "Service progress")) streamed.resolve();
    } }
  });
  const actor = { username: "service-owner", role: "owner" };
  const options = { runtime, vibe64User: actor };
  const actions = createActionCatalogue();
  registerVibe64ActionContext(actions, {
    projectContext: { projectsRoot: path.dirname(f.root), async readWorkspaceProject() {
      return { project: { projectRoot: f.root, projectRuntimeRoot: runtime.stateRoot } };
    } },
    resolveUser: async () => actor,
    authorizeProject: async ({ slug }) => assert.equal(slug, "claude-main-fixture")
  });
  const sessions = createSessionService({ actions, project: projectService, terminals: service });
  actions.register({ contributorId: "test.claude-main-goals", domain: "vibe64",
    actions: [...createSessionActions({ sessions }), ...createTerminalActions({ terminals: service })]
      .map(definition => ({ channels: ["api", "automation", "internal"], surfaces: ["app"], ...definition })) });
  const goalFacade = await sessions.browserConversations.open({
    id: mainConversationId({ projectSlug: "claude-main-fixture", sessionId: "test" }), context: { channel: "internal", surface: "app" }
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
    assert.equal(emptyGoalRead.target.segmentId, `claude:${state.thread.id}`,
      "the empty-goal read returns its selected identity without a second target lookup");
    const trace = async () => {
      try { return (await readFile(tracePath, "utf8")).trim().split("\n").filter(Boolean).map(JSON.parse); }
      catch (error) { if (error.code === "ENOENT") return []; throw error; }
    };
    assert.equal((await trace()).some(row => row.args?.includes("--print")), false, "inspection does not start native inference");
    const request = { message: "Work", messageId: "service-main" };
    const sent = await service.sendAgentMessage("test", request, options);
    assert.equal(sent.delivered, true);
    assert.equal(sent.thread.id, state.thread.id);
    await streamed.promise;
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
    const routedSelection = { ...defineVibe64AssistantSelection(f.context.assistantSelection), selectionSource: "explicit" };
    await createAssistantRoutingStore({ systemRoot: path.join(f.root, "system") }).write({
      claude: { senior: routedSelection, junior: routedSelection }
    }, 0);
    await store.writeMetadataValue("test", "assistant_routing", JSON.stringify({ mode: "senior", workflowEngineId: "claude" }));
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
    const nativeObjective = assistantModePrompt("senior", canonicalCommand.objective);
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
    await rm(goalAcknowledgementGate);
    const accepted = await canonicalResult;
    assert.equal(accepted.error, undefined);
    assert.equal(accepted.value.status, "accepted");
    assert.equal(accepted.value.messageId, canonicalCommand.messageId);
    assert.doesNotMatch(JSON.stringify(accepted.value), /"(?:nativeResult|session|threadId)"\s*:/u);
    let pinned = JSON.parse((await store.readSession("test")).metadata.assistant_routing_goal);
    assert.equal(pinned.objective, canonicalCommand.objective);
    assert.equal(pinned.selection.engineId, "claude");
    assert.equal(pinned.status, "active");
    const readView = await goalFacade.readGoal();
    const visible = readView.goal;
    assert.equal(readView.target.segmentId, `claude:${state.thread.id}`);
    assert.equal(readView.target.capabilities.goalBudgets, false);
    assert.equal(readView.target.capabilities.goalCommands.set.delivery, "message");
    assert.equal(readView.target.capabilities.goalCommands.pause.delivery, "control");
    assert.equal(visible.objective, canonicalCommand.objective);
    const nativeHistory = await readClaudeHistory({ configRoot: f.providerOptions.env.CLAUDE_CONFIG_DIR,
      workdir: f.context.session.metadata.source_path, conversationId: state.thread.id });
    assert.equal(nativeHistory.goal.objective, nativeObjective);
    assert.equal(visible.id, createHash("sha256").update(JSON.stringify([
      state.thread.id, nativeHistory.goal.createdAt, nativeObjective
    ])).digest("hex"), "display decoration never changes the canonical native identity");
    const pinBeforeDuplicate = (await store.readSession("test")).metadata.assistant_routing_goal;
    const nativeMessagesBeforeDuplicate = (await trace()).filter(row => row.frame?.type === "user").length;
    const duplicateGoal = await startGoal({ ...canonicalCommand, objective: "A changed retry" }, { canonical: true });
    assert.equal(duplicateGoal.duplicate, true);
    assert.equal(duplicateGoal.turnId, accepted.value.turnId);
    assert.equal((await trace()).filter(row => row.frame?.type === "user").length, nativeMessagesBeforeDuplicate);
    assert.equal((await store.readSession("test")).metadata.assistant_routing_goal, pinBeforeDuplicate,
      "an existing UUID has no new native result and cannot commit a different goal pin");
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
    rows = await store.readConversationLog("test");
    assert.equal(rows.filter(turn => turn.user?.messageId === canonicalCommand.messageId).length, 1);
    assert.equal(rows.some(turn => turn.metadata.runtime), false);
    assert.equal((await store.readSession("test")).metadata.runtime, undefined);
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
    const saved = f.written.at(-1);
    assert.equal(saved.messageId, `claude_saved-block-${index}_0`);
    assert.equal(saved.outputId, `claude_same-api-message_${index}`);
    assert.deepEqual(store.readConversationStream("test").messages, [],
      "Saving the exact output retires its partial before native block Stop");
    await event({ type: "stream_event", event: { type: "content_block_stop", index } });
  }
  await event({ type: "result", subtype: "success", result: "The answer.", uuid: "output-owner-result" });
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
