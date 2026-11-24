import { execFileSync } from "node:child_process";
import { rmSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";
import { createConversationRuntime } from "@jskit-ai/assistant-core/server/conversation";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { prepareSessionDetachedConversationRun, prepareSessionDetachedConversationCleanup, createSessionConversationBinding, prepareSessionConversationActivity, prepareSessionConversationRenewal, prepareSessionConversationCreation, prepareSessionConversationReadiness, prepareSessionConversationSettings, prepareSessionConversationDisposal, prepareProjectConversationCleanup, prepareConversationRuntimeInvalidation, prepareConversationReconciliation, prepareSessionConversationRenewalProof } from "../../packages/vibe64-terminals/src/server/mainConversationBinding.js";
import { createClaudeConversationHost as createNativeClaudeSessionAgentProvider } from "../../packages/vibe64-terminals/src/server/agent/providers/claudeConversationHost.js";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { sessionAgentManagerDefaults } from "../fixtures/sessionAgentManagerDefaults.js";

// The Claude provider fixture of claudeStreamJson.unit.test.js, which the Main goal scenario's files
// (claudeMainGoalOwners*.unit.test.js) start from too.

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
    host: { env: process.env, nativeTools: true, conversation: ({ id, context, input, options, operation }) => operation === "runDetachedConversation"
      ? prepareSessionDetachedConversationRun(provider, id, context, input, options) : operation === "releaseRenewalPredecessorProcessExitProof"
      ? prepareSessionConversationRenewalProof(provider, id, context, input, operation) : operation === "interruptDetachedConversation" || operation === "deleteDetachedConversation"
      ? prepareSessionDetachedConversationCleanup(provider, id, context, input,
        operation === "interruptDetachedConversation" ? "interruptDetachedChatTurn" : "deleteDetachedChatThread") : operation === "inspectTemporaryActivity"
      ? prepareSessionConversationActivity(provider, id, context) : operation === "generateRenewalHandover" || operation === "seedRenewalHandover"
      ? prepareSessionConversationRenewal(provider, id, context, input) : operation === "reconcileSessions"
      ? prepareConversationReconciliation(provider, context, input, options) : operation === "closeProject"
      ? prepareProjectConversationCleanup(provider, context, input) : operation === "invalidateRuntimes" || operation === "beginShutdown"
      ? prepareConversationRuntimeInvalidation(provider, context, input) : operation === "create"
      ? prepareSessionConversationCreation(provider, id, context, input) : operation === "ensure"
      ? prepareSessionConversationReadiness(provider, id, context) : operation === "updateSettings"
      ? prepareSessionConversationSettings(provider, id, context) : operation === "dispose"
      ? prepareSessionConversationDisposal(provider, id, context, input) : createSessionConversationBinding(provider, id, {
      ...context, prepareInput: (input, current) => current.prepareInput ? current.prepareInput(input) : input
    }) }
  });
  provider = createNativeClaudeSessionAgentProvider({ env: process.env, logger: silentLogger, trackShutdownWork: work => work, ...nativeOptions, conversationRuntime: conversations,
    runNativeDetachedConversation: request => conversations.runNativeDetachedConversation(request),
    publishConversation: options.publishConversation || (event => conversations.publishNative(event)) });
  const manager = createSessionAgentManager({ ...sessionAgentManagerDefaults, conversationRuntime: conversations, defaultProviderId: "claude",
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


  const facade = { ...provider, manager,
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
      ? prepareProjectConversationCleanup(provider, context, input) : operation === "invalidateRuntimes" || operation === "beginShutdown"
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

// A hook a test registers after its fixture can still take a session lock in a
// removed root; the finished process removes every fixture root once more.
const fixtureRoots = new Set();
process.once("exit", () => {
  for (const root of fixtureRoots) rmSync(root, { recursive: true, force: true });
});

async function fixture(t, { scopedConversations = false } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "v64-claude-provider-test-"));
  fixtureRoots.add(root);
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
  const runtime = { stateRoot: root, store, getSession: async () => session, getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    renderPrompt: async (_id, input) => ({ prompt: `Context: ${input.request}` }) };
  const context = { sessionId: "test", session, runtime, assistantSelection: selection };
  const processes = [];
  const diagnostics = [];
  const publications = [];
  const behavior = { account: { loggedIn: true, email: "owner@example.test", authMethod: "claude.ai" } };
  const providerOptions = { [fixtureRuntimeOwners]: owners, systemRoot: path.join(root, "system"), env: {
    CLAUDE_CONFIG_DIR: path.join(root, "config"), VIBE64_AGENT_RUNTIME_DIR: path.join(root, "agent-runtime"),
    VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "attachments")
  },
    logger: { info: fields => diagnostics.push(fields), warn: fields => diagnostics.push(fields) },
    publishSessionChanged: async (_id, event) => publications.push(event),
    project: { readCurrentProject: async () => ({ sourceRoot: workdir }) },
    accountStatus: async () => behavior.account,
    credentialHome: { home: root }, recordGitActor: async () => ({ ok: true }), connectionStatus: async () => true,
    createProcess: async (options) => {
      // interrupts: Claude's interrupt controls the process received (a person's Stop ends the turn
      // with one and keeps the process; stopped says whether the process itself was stopped).
      const native = { options, executionId: `test-${processes.length}`, command: options.command, stopped: false, stopAllowed: true,
        interrupts: 0,
        initialization: { models: [{ value: "sonnet", supportedEffortLevels: ["low", "high"] }, { value: "haiku", supportedEffortLevels: [] }] },
        async stop() { this.stopped = this.stopAllowed; return { exited: this.stopped, scopeEmpty: this.stopped }; },
        client: { async request(request) {
          (native.requests ||= []).push(request);
          return request.subtype === "get_context_usage"
            ? (behavior.contextUsage || { totalTokens: 1000, maxTokens: 1_000_000, autoCompactThreshold: 967_000, model: "sonnet" }) : {};
        }, interrupt: async () => {
          native.interrupts++;
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

export { createClaudeSessionAgentProvider, fixture, scopedProvider };
