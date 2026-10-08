import { createClaudeConversationStorage } from "../../claudeConversationStorage.js";
import { createClaudeConversationEnvironment } from "../../claudeConversationEnvironment.js";
import { createClaudeConversationEvents } from "../../claudeConversationEvents.js";
import { claudeCapabilities, createClaudeConversationAccounts } from "../../claudeConversationAccounts.js";
import { requireCompletedNativeConversationReplacement } from "../../assistantChangeover.js";
import { createClaudeConversationMessagePolicy, publishMainConversationEvent, readSessionConversationContext } from "../../mainConversationBinding.js";
import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { randomUUID } from "node:crypto";
import path from "node:path";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";
import { appCredentialContext, runVibe64Command, stopVibe64Execution } from "@local/vibe64-execution/server";
import { closeTerminalSessionsForNamespace, listTerminalSessions } from "@local/vibe64-execution/server/terminalSessions";
import { readClaudeCodeAuthStatus } from "@local/studio-terminal-core/server/claudeRuntime";
import { resolveVibe64SystemRoot } from "@local/vibe64-core/server/studioRoots";
import { STUDIO_MANAGED_CLAUDE_COMMAND } from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import { createClaudeCodeProcess } from "../../claudeCodeProcess.js";
import { createClaudeConversationOwner, claudeNativeMessageId as nativeMessageId } from "@jskit-ai/assistant-core/server/claude-turn";
import { prepareAgentSessionCommandEnvironment } from "../../agentCommandEnvironment.js";
import { recordSessionGitCommandActor } from "../../sessionGitCommandActor.js";
import {
  defineSessionRenewalOperationId, defineSessionRenewalApprovedHandover,
  sessionRenewalClientMessageId, sessionRenewalHandoverPrompt, sessionRenewalSeedPrompt,
  sessionRenewalAcknowledgementOutputSchema
} from "../../sessionRenewalHandover.js";
import {
  completeClaudeSessionRenewalHandover, completeClaudeSessionRenewalSeed
} from "../../sessionRenewalReceipts.js";
import { claudeConversationError as error, claudeTerminalNamespace } from "../../terminalShared.js";

const ENGINE = "claude";
const TRANSPORT = "claude_stream_json";
const text = (value) => String(value ?? "").trim();
const now = () => new Date().toISOString();

function createClaudeConversationHost({
  env = process.env, projectService, publishSessionChanged: publishApplicationSessionChanged = async () => {},
  publishConversation,
  runNativeDetachedConversation,
  command = env.VIBE64_CLAUDE_COMMAND || STUDIO_MANAGED_CLAUDE_COMMAND,
  credentialHome = appCredentialContext(), createProcess = createClaudeCodeProcess,
  commandRunner = runVibe64Command, stopExecution = stopVibe64Execution,
  connectionStatus = async () => false,
  systemRoot = resolveVibe64SystemRoot({ env }),
  accountStatus = () => readClaudeCodeAuthStatus({ env, credentialHome, commandRunner }),
  prepareCommandEnvironment = prepareAgentSessionCommandEnvironment,
  recordGitActor = recordSessionGitCommandActor,
  codexGitCommand, agentDatabaseCommand, agentEnvCommand, agentPreviewCommand, agentSessionCommand
} = {}) {
  const publishSessionChanged = publishMainConversationEvent.bind(
    null, claudeTerminalNamespace, publishApplicationSessionChanged, publishConversation
  );
  const providerConnections = createCodexProviderConnectionStore({ systemRoot });
  const configRoot = env.CLAUDE_CONFIG_DIR || path.join(credentialHome.home, ".claude");
  const conversationStorage = createClaudeConversationStorage({ createError: error });
  const { metadata, ...nativeStorage } = conversationStorage;
  const messagePolicy = createClaudeConversationMessagePolicy({ env, recordGitActor, publishSessionChanged });
  const { prepareConfiguration, prepareProcess, configureProcess, configureTerminal, createTerminalAccess } =
    createClaudeConversationEnvironment({ env, projectService, command, credentialHome, commandRunner, stopExecution,
      providerConnections, prepareCommandEnvironment, codexGitCommand, agentDatabaseCommand, agentEnvCommand,
      agentPreviewCommand, agentSessionCommand });
  const conversations = createClaudeConversationOwner({ configRoot, createError: error,
    disconnectedMessage: "Claude was interrupted when Vibe64 disconnected.",
    store: nativeStorage,
    preparation: {
      account(entry) { return accounts.prepareAccount(entry); },
      context: contextFor,
      entry: prepareEntry,
      checkConfiguration,
      configuration: prepareConfiguration,
      check: messagePolicy.check,
      message: messagePolicy.prepareMessage
    },
    process: { prepare: prepareProcess, configure: configureProcess, configureTerminal, create: createProcess, stopExecution },
    onEvent(entry, event) { return publishTurnEvent(entry, event); }
  });
  const accounts = createClaudeConversationAccounts({ owner: conversations, configRoot, providerConnections,
    accountStatus, connectionStatus, createProcess, command, commandRunner, stopExecution, credentialHome, env });
  const { queries: accountQueries, queryFailure: accountQueryFailure } = accounts;
  const publishTurnEvent = createClaudeConversationEvents({ projectService, storage: conversationStorage,
    messagePolicy, owner: conversations, accountQueries, publishSessionChanged });
  const terminalAccess = createTerminalAccess(conversations, recordGitActor);
  async function contextFor(context) {
    return readSessionConversationContext("claude", projectService, context.sessionId, context);
  }

  function prepareEntry(ctx, context, conversationId, { create, cleanupExecutionId, operation, input }) {
    if (!conversationId) requireCompletedNativeConversationReplacement(ctx.session);
    return {
      options: { conversationId, mainId: ctx.session?.metadata?.claude_conversation_id,
        create, cleanupExecutionId, recoveringCleanup: ctx.assistantScope && cleanupExecutionId !== undefined,
        nativeWorkdir: ctx.assistantScope ? credentialHome.home : ctx.workdir
      },
      check(entry) {
        if (operation === "start" && context.assistantScope && JSON.stringify(entry.profile || null) !==
            JSON.stringify(input.executionProfile ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : null)) {
          throw error("The scoped helper profile changed. Start a new helper.");
        }
        if (operation === "delete" && entry.main) throw error("The main Claude conversation cannot be deleted as a temporary chat.");
      }
    };
  }

  function checkConfiguration(entry) {
    requireCompletedNativeConversationReplacement(entry.context.session);
    if (listTerminalSessions({ namespace: claudeTerminalNamespace(entry.context.sessionId), runningOnly: true }).length) {
      throw error("Close the Claude Code terminal before sending in chat.", "vibe64_claude_terminal_active");
    }
    return { get sessionClosing() { return sessionIsClosing(entry.context.session); } };
  }

  async function sessionState(context, nativeState) {
    return { ...nativeState,
      terminal: listTerminalSessions({ namespace: claudeTerminalNamespace(context.sessionId), runningOnly: true })[0] || null };
  }

  const cleanupApplication = {
    readContext: context => contextFor({ ...context, allowClosing: true }),
    terminals: { close: sessionId => closeTerminalSessionsForNamespace(claudeTerminalNamespace(sessionId)) }
  };

  function prepareSessionCleanup(context) {
    return { context, application: cleanupApplication };
  }

  function prepareRenewalTurn(input, kind, prompt, outputSchema) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const clientMessageId = sessionRenewalClientMessageId(kind, operationId);
    return { operationId, get input() { return {
      clientMessageId, prompt, outputSchema, expectedThreadId: input.expectedThreadId,
      forbiddenThreadId: input.forbiddenThreadId || input.oldThreadId, requireFreshHistory: kind === "seed",
      timeoutMs: 180_000
    }; }, options: { createError: error, unreadableCode: "vibe64_session_renewal_turn_unreadable",
      failedCode: "vibe64_session_renewal_turn_failed", acceptedField: "handoverPromptAccepted" } };
  }

  function prepareRenewalHandover(context, input = {}) {
    const prepared = prepareRenewalTurn(input, "handover", sessionRenewalHandoverPrompt(input));
    return { get input() { return prepared.input; }, options: prepared.options, completeResult: nativeResult =>
      completeClaudeSessionRenewalHandover({ input, prepared, context, metadata, contextFor }, nativeResult) };
  }

  function prepareRenewalSeed(context, input = {}) {
    const approved = defineSessionRenewalApprovedHandover(input);
    const prepared = prepareRenewalTurn(input, "seed", sessionRenewalSeedPrompt(approved), sessionRenewalAcknowledgementOutputSchema(approved));
    return { get input() { return prepared.input; }, options: prepared.options, completeResult: nativeResult =>
      completeClaudeSessionRenewalSeed({ input, prepared, context, metadata, contextFor, approved, now, transport: TRANSPORT }, nativeResult) };
  }

  function runDetachedChatTurn(context, input = {}) {
    return runNativeDetachedConversation({ id: context.sessionId, context, input, options: context });
  }

  const provider = {
    conversationOperations: Object.freeze(["createConversation", "ensureSession", "sendMessage", "sessionState", "inspectMessageAdmission", "interruptTurn", "readGoal", "updateGoal", "readConversation", "startConversationTurn", "waitForConversationTurn", "stopConversation", "deleteConversation", "closeSession", "closeProject", "invalidateRuntimes", "reconcileSessions", "generateSessionRenewalHandover", "seedSessionRenewalHandover", "interruptDetachedChatTurn", "deleteDetachedChatThread", "listNativeConversationStorage", "retireConversationHistory", "hasActiveTemporaryConversation", "releaseRenewalPredecessorProcessExitProof", "releaseRenewalSuccessorProcessExitProof"]),
    prepareConversationRequest(method, context, input) {
      if (method === "generateSessionRenewalHandover" || method === "seedSessionRenewalHandover") {
        return { input: input === undefined ? {} : input, context };
      }
      if (method === "interruptDetachedChatTurn" || method === "deleteDetachedChatThread") return { input, context };
      if (method === "ensureSession") return { context };
      if (method === "createConversation") {
        if (input === undefined) input = {};
        return { context, input: {
          get executionProfile() {
            return context.assistantScope && input.executionProfile
              ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : undefined;
          },
          get persistent() { return input.persistent; },
          get ephemeral() { return input.ephemeral; }
        } };
      }
      if (method === "closeSession") return {
        namespace: claudeTerminalNamespace(context.sessionId), sessionId: context.sessionId,
        context, options: context
      };
      if (["readConversation", "startConversationTurn", "waitForConversationTurn", "stopConversation", "deleteConversation"].includes(method)) {
        if (input === undefined && !["stopConversation", "deleteConversation"].includes(method)) input = {};
        const conversationId = text(input.conversationId || input.threadId);
        return { scopedConversationId: conversationId || undefined, input };
      }
      if (method === "sessionState" || method === "readGoal" || method === "interruptTurn") return {};
      if (method !== "sendMessage") return { input: method === "updateGoal" && input === undefined ? {} : input };
      const message = { ...input, message: input.message || input.prompt, messageId: text(input.messageId) || randomUUID() };
      return { input: message, async prepareInput(prepared) {
        const current = { ...message, ...prepared };
        return context.prepareMessage ? context.prepareMessage(current) : current;
      } };
    },
    async projectConversationResult(method, perform) {
      if (method === "hasActiveTemporaryConversation") return { ok: true, active: await perform() };
      return method === "sendMessage" || method === "interruptTurn" ? (await perform()).value : perform();
    },
    runDetachedChatTurn,
    streamDetachedChatTurn: runDetachedChatTurn,
    prepareConversationHost(sessionId, openingContext = {}, mode = "main", input = {}) {
      if (mode === "detached") return {
        native: { owner: conversations,
          get executionProfile() {
            return input.executionProfile ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : null;
          }
        }
      };
      if (mode === "activity") return contextFor(openingContext).then(context => ({
        context, native: { owner: conversations }
      }));
      if (mode === "detachedCleanup") return {
        native: { owner: conversations }
      };
      if (mode === "storage") return {
        native: { owner: conversations, configRoot, preparation: {
          retirement(binding, context) {
            return { configRoot, binding, beforeDelete: context.beforeDelete, signal: context.signal,
              application: {
                get saved() { return JSON.parse(context.session.metadata[`claude_conversation_${binding.conversationId}`] || "null"); },
                get terminalRunning() { return listTerminalSessions({ namespace: claudeTerminalNamespace(context.sessionId), runningOnly: true }).length; }
              } };
          }
        } }
      };
      if (mode === "renewalProof") return {
        native: { owner: conversations, application: cleanupApplication }
      };
      if (mode === "renewal") return {
        native: { owner: conversations, preparation: {
          handover: (input, context) => prepareRenewalHandover(context, input),
          seed: (input, context) => prepareRenewalSeed(context, input)
        } }
      };
      if (mode === "reconciliation") return {
        native: { owner: conversations, application: cleanupApplication }
      };
      if (mode === "projectCleanup" || mode === "invalidation") return {
        native: { owner: conversations, application: cleanupApplication,
          account: { queries: accountQueries, failure: accountQueryFailure } }
      };
      return (async () => {
        if (mode === "readiness") return {
          native: { owner: conversations }
        };
        if (mode === "scoped" || mode === "create" || mode === "dispose") return {
          namespace: claudeTerminalNamespace(sessionId),
          native: { owner: conversations,
            preparation: { cleanup: prepareSessionCleanup } }
        };
        const context = await contextFor({ ...openingContext, sessionId });
        const { runtime } = context;
        return {
          context, namespace: claudeTerminalNamespace(sessionId), publish: publishSessionChanged,
          state: {
            async read(current, representation, nativeState) {
              if (representation === "native") return { nativeResult: await sessionState(current, nativeState) };
              const nativeResult = current ? await sessionState(current, nativeState) : null;
              const session = await runtime.getSession(sessionId, { inspectSource: false });
              const id = nativeResult?.thread.id || text(session.metadata.claude_conversation_id);
              const turn = conversations.readRetainedTurn(context.key, id, {
                nativeResult,
                get saved() { return JSON.parse(session.metadata[`claude_conversation_${id}`] || "null"); }
              });
              return { session, threadId: id, turn, nativeResult };
            }
          },
          native: {
            owner: conversations,
            preparation: { cleanup: current => prepareSessionCleanup(current ? { ...context, ...current } : context) },
            completeResult(current) {
              if (!current?.canonicalGoal) return;
              if (current.goalOperation === "read") return current.onGoalResult;
              if (current.goalOperation === "update") return result => current.onGoalResult?.(result);
            }
          }
        };
      })();
    },
    id: ENGINE, transportId: TRANSPORT, executionProfiles: ["helper"],
    assistantAccess: accounts.assistantAccess,
    capabilities: accounts.capabilities,
    describeProvider: accounts.describeProvider,
    readPlanUsage: accounts.readPlanUsage,
    resolveExecutionProfile: accounts.resolveExecutionProfile,
    startTerminal: terminalAccess.startTerminal,
    readTerminal: terminalAccess.readTerminal,
    closeTerminal: terminalAccess.closeTerminal,
    resizeTerminal: terminalAccess.resizeTerminal,
    subscribeTerminal: terminalAccess.subscribeTerminal,
    writeTerminal: terminalAccess.writeTerminal,
    async unsubscribeSessions() { return { ok: true }; },
    async releaseRenewalPredecessorAttachments() { return { ok: true, released: 0 }; }
  };
  return Object.freeze(provider);
}

export { claudeCapabilities, createClaudeConversationHost, nativeMessageId };
