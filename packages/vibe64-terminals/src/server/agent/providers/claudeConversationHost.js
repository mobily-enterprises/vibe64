import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { createClaudeConversationStorage } from "../../claudeConversationStorage.js";
import { createClaudeConversationEnvironment } from "../../claudeConversationEnvironment.js";
import { createClaudeConversationEvents } from "../../claudeConversationEvents.js";
import { createClaudeConversationAccounts } from "../../claudeConversationAccounts.js";
import { requireCompletedNativeConversationReplacement } from "../../assistantChangeover.js";
import { publishMainConversationEvent } from "../../mainConversationBinding.js";
import { readClaudeConversationOwnerContext, readSessionConversationContext } from "../../mainConversationContext.js";
import { createClaudeConversationMessagePolicy } from "../../mainConversationMessages.js";
import { createCodexProviderConnectionStore } from "@local/vibe64-core/server/codexProviderConnections";
import { randomUUID } from "node:crypto";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_TRANSPORT_IDS,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";
import { appCredentialContext, operatorCliCommand, runVibe64Command, stopVibe64RestoredService } from "@local/vibe64-execution/server";
import { captureProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { closeTerminalSessionsForNamespace, listTerminalSessions } from "@local/vibe64-execution/server/terminalSessions";
import { readClaudeCodeAuthStatus } from "@local/studio-terminal-core/server/claudeRuntime";
import { resolveVibe64SystemRoot } from "@local/vibe64-core/server/studioRoots";
import { claudeConfigRoot, createClaudeCodeProcess } from "../../claudeCodeProcess.js";
import { createClaudeConversationOwner } from "@jskit-ai/assistant-core/server/claude-turn";
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
import { claudeConversationError, claudeTerminalNamespace } from "../../terminalShared.js";
import { isoNow } from "../../isoNow.js";
import { toText } from "@local/vibe64-core/shared/toText";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("../../types.js").CodexGitCommandService} CodexGitCommandService */
/** @typedef {import("../../types.js").AgentDatabaseCommandService} AgentDatabaseCommandService */
/** @typedef {import("../../types.js").AgentEnvCommandService} AgentEnvCommandService */
/** @typedef {import("../../types.js").AgentSessionCommandService} AgentSessionCommandService */
/** @typedef {import("../../types.js").AgentPreviewCommandService} AgentPreviewCommandService */
/** @typedef {import("@local/vibe64-core/server/types").PublishSessionChanged} PublishSessionChanged */

const ENGINE = VIBE64_ASSISTANT_ENGINE_IDS.CLAUDE;
const TRANSPORT = VIBE64_ASSISTANT_TRANSPORT_IDS.CLAUDE_STREAM_JSON;

/**
 * @param {object} dependencies
 * @param {RuntimeEnv} [dependencies.env]
 * @param {ProjectService} dependencies.project
 * @param {RuntimeLogger} dependencies.logger
 * @param {PublishSessionChanged} dependencies.publishSessionChanged
 * @param {(event: object) => unknown} dependencies.publishConversation
 * @param {(request: object) => Promise<unknown>} dependencies.runNativeDetachedConversation
 * @param {() => string} [dependencies.command]
 * @param {object} [dependencies.credentialHome]
 * @param {typeof createClaudeCodeProcess} [dependencies.createProcess]
 * @param {typeof runVibe64Command} [dependencies.commandRunner]
 * @param {typeof stopVibe64RestoredService} [dependencies.stopExecution]
 * @param {(context: object) => Promise<boolean>} [dependencies.connectionStatus]
 * @param {string} [dependencies.systemRoot]
 * @param {(context?: object) => Promise<object>} [dependencies.accountStatus]
 * @param {typeof prepareAgentSessionCommandEnvironment} [dependencies.prepareCommandEnvironment]
 * @param {typeof recordSessionGitCommandActor} [dependencies.recordGitActor]
 * @param {CodexGitCommandService} dependencies.codexGitCommand
 * @param {AgentDatabaseCommandService} dependencies.agentDatabaseCommand
 * @param {AgentEnvCommandService} dependencies.agentEnvCommand
 * @param {AgentPreviewCommandService} dependencies.agentPreviewCommand
 * @param {AgentSessionCommandService} dependencies.agentSessionCommand
 */
function createClaudeConversationHost({
  env = process.env,
  project,
  logger,
  publishSessionChanged: publishApplicationSessionChanged,
  publishConversation,
  runNativeDetachedConversation,
  // Found again at each start, so a Claude Code installed after Vibe64 started is used.
  command = () => operatorCliCommand("claude", { env }),
  credentialHome = appCredentialContext(),
  createProcess = createClaudeCodeProcess,
  // Claude keeps only its execution ID, so a restored ID is stopped as a service.
  commandRunner = runVibe64Command,
  stopExecution = stopVibe64RestoredService,
  connectionStatus = async () => false,
  systemRoot = resolveVibe64SystemRoot({ env }),
  accountStatus = () => readClaudeCodeAuthStatus({ env, credentialHome, commandRunner }),
  prepareCommandEnvironment = prepareAgentSessionCommandEnvironment,
  recordGitActor = recordSessionGitCommandActor,
  codexGitCommand,
  agentDatabaseCommand,
  agentEnvCommand,
  agentPreviewCommand,
  agentSessionCommand
}) {
  const publishSessionChanged = publishMainConversationEvent.bind(
    null, claudeTerminalNamespace, publishApplicationSessionChanged, publishConversation
  );
  const providerConnections = createCodexProviderConnectionStore({ systemRoot });
  const configRoot = claudeConfigRoot({ env, credentialHome });
  const conversationStorage = createClaudeConversationStorage({ createError: claudeConversationError });
  const { metadata, ...nativeStorage } = conversationStorage;
  const messagePolicy = createClaudeConversationMessagePolicy({ env, recordGitActor, publishSessionChanged,
    onTiming(event) {
      // Timing is diagnostic only; a failing log sink must not fail the send.
      try {
        logOperationalEvent(logger, event.elapsedMs >= 1000 ? "warn" : "info", {
          event: "vibe64.agent_message.preparation_timing",
          component: "vibe64.agent_message",
          engineId: "claude",
          ...event
        }, "Assistant message preparation timing.");
      } catch {
        // Ignore: timing diagnostics are best-effort.
      }
    } });
  const { prepareConfiguration, prepareProcess, configureProcess, configureTerminal, createTerminalAccess } =
    createClaudeConversationEnvironment({
      env,
      project,
      command,
      credentialHome,
      commandRunner,
      stopExecution,
      providerConnections,
      prepareCommandEnvironment,
      codexGitCommand,
      agentDatabaseCommand,
      agentEnvCommand,
      agentPreviewCommand,
      agentSessionCommand
    });
  const conversations = createClaudeConversationOwner({ configRoot, createError: claudeConversationError,
    disconnectedMessage: "Claude was interrupted when Vibe64 disconnected.",
    store: nativeStorage,
    preparation: {
      account: prepareAccount,
      context: contextFor,
      entry: prepareEntry,
      checkConfiguration,
      configuration: prepareConfiguration,
      check: messagePolicy.check,
      message: messagePolicy.prepareMessage
    },
    process: { prepare: prepareProcess, configure: configureProcess, configureTerminal, stopExecution,
      create(options) {
        // The accepted native stream outlives its finite practice admission.
        // Keep only the CONTROL projection captured at creation; tool effects still use
        // the saved-attempt action contributor's fresh admission.
        const projectContext = captureProjectRequestContext();
        return createProcess({
          ...options,
          logger,
          onEvent: frame => runWithProjectRequestContext(projectContext || {}, () => options.onEvent(frame)),
          onFailure: failure => runWithProjectRequestContext(projectContext || {}, () => options.onFailure(failure)),
          ...(options.onControlRequest ? {
            onControlRequest: (request, control) => runWithProjectRequestContext(projectContext || {},
              () => options.onControlRequest(request, control))
          } : {})
        });
      }
    },
    onEvent(entry, event) {
      return runWithProjectRequestContext(entry.context.projectContext || {}, () => publishTurnEvent(entry, event));
    }
  });
  const accounts = createClaudeConversationAccounts({
    owner: conversations,
    configRoot,
    providerConnections,
    accountStatus,
    connectionStatus,
    createProcess: options => createProcess({ ...options, logger }),
    command,
    commandRunner,
    stopExecution,
    credentialHome,
    env
  });
  const { queries: accountQueries, queryFailure: accountQueryFailure } = accounts;
  const turnEvents = createClaudeConversationEvents({
    project,
    storage: conversationStorage,
    messagePolicy,
    owner: conversations,
    accountQueries,
    publishSessionChanged,
    logger
  });
  /**
   * The owner calls back into its accounts and turn events, which are built from it.
   */
  function prepareAccount(entry) { return accounts.prepareAccount(entry); }
  function publishTurnEvent(entry, event) { return turnEvents(entry, event); }
  const terminalAccess = createTerminalAccess(conversations, recordGitActor);
  async function contextFor(context) {
    const projectContext = captureProjectRequestContext();
    return { ...await readSessionConversationContext("claude", project, context.sessionId, context), projectContext };
  }

  function prepareEntry(ctx, context, conversationId, { create, cleanupExecutionId, operation, input }) {
    if (!conversationId) requireCompletedNativeConversationReplacement(ctx.session);
    return {
      options: {
        conversationId,
        mainId: ctx.session?.metadata?.claude_conversation_id,
        create,
        cleanupExecutionId,
        recoveringCleanup: ctx.assistantScope && cleanupExecutionId !== undefined,
        nativeWorkdir: ctx.assistantScope ? credentialHome.home : ctx.workdir
      },
      check(entry) {
        if (operation === "start" && context.assistantScope && JSON.stringify(entry.profile || null) !==
            JSON.stringify(input.executionProfile ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : null)) {
          throw claudeConversationError("The scoped helper profile changed. Start a new helper.");
        }
        if (operation === "delete" && entry.main) throw claudeConversationError("The main Claude conversation cannot be deleted as a temporary chat.");
      }
    };
  }

  function checkConfiguration(entry) {
    requireCompletedNativeConversationReplacement(entry.context.session);
    if (listTerminalSessions({ namespace: claudeTerminalNamespace(entry.context.sessionId), runningOnly: true }).length) {
      throw claudeConversationError("Close the Claude Code terminal before sending in chat.", "vibe64_claude_terminal_active");
    }
    return { get sessionClosing() { return sessionIsClosing(entry.context.session); } };
  }

  async function sessionState(context, nativeState) {
    return {
      ...nativeState,
      terminal: listTerminalSessions({ namespace: claudeTerminalNamespace(context.sessionId), runningOnly: true })[0] || null
    };
  }

  /**
   * Cleanup reaches the owner's retained work by session key; a conversation it
   * reopens gets its full context from the owner's own preparation.
   */
  const ownerContextFor = context => readClaudeConversationOwnerContext(project, context.sessionId, context);
  const cleanupApplication = {
    readContext: context => ownerContextFor({ ...context, allowClosing: true }),
    terminals: { close: sessionId => closeTerminalSessionsForNamespace(claudeTerminalNamespace(sessionId)) }
  };

  function prepareSessionCleanup(context) {
    return { context, application: cleanupApplication };
  }

  function prepareRenewalTurn(input, kind, prompt, outputSchema) {
    const operationId = defineSessionRenewalOperationId(input.operationId || input.operationKey);
    const clientMessageId = sessionRenewalClientMessageId(kind, operationId);
    return {
      operationId,
      get input() { return {
        clientMessageId,
        prompt,
        outputSchema,
        expectedThreadId: input.expectedThreadId,
        forbiddenThreadId: input.forbiddenThreadId || input.oldThreadId,
        requireFreshHistory: kind === "seed",
        timeoutMs: 180_000
      }; },
      options: {
        createError: claudeConversationError,
        unreadableCode: "vibe64_session_renewal_turn_unreadable",
        failedCode: "vibe64_session_renewal_turn_failed",
        acceptedField: "handoverPromptAccepted"
      }
    };
  }

  function prepareRenewalHandover(context, input = {}) {
    const prepared = prepareRenewalTurn(input, "handover", sessionRenewalHandoverPrompt(input));
    return {
      get input() { return prepared.input; },
      options: prepared.options,
      completeResult: nativeResult =>
        completeClaudeSessionRenewalHandover({ input, prepared, context, metadata, contextFor }, nativeResult)
    };
  }

  function prepareRenewalSeed(context, input = {}) {
    const approved = defineSessionRenewalApprovedHandover(input);
    const prepared = prepareRenewalTurn(
      input,
      "seed",
      sessionRenewalSeedPrompt(approved),
      sessionRenewalAcknowledgementOutputSchema(approved)
    );
    return {
      get input() { return prepared.input; },
      options: prepared.options,
      completeResult: nativeResult =>
        completeClaudeSessionRenewalSeed({
          input,
          prepared,
          context,
          metadata,
          contextFor,
          approved,
          now: isoNow,
          transport: TRANSPORT
        }, nativeResult)
    };
  }

  function runDetachedChatTurn(context, input = {}) {
    return runNativeDetachedConversation({ id: context.sessionId, context, input, options: context });
  }

  function prepareConversationRequest(method, context, input) {
    if (method === "generateSessionRenewalHandover" || method === "seedSessionRenewalHandover") {
      return { input: input === undefined ? {} : input, context };
    }
    if (method === "interruptDetachedChatTurn" || method === "deleteDetachedChatThread") return { input, context };
    if (method === "ensureSession") return { context };
    if (method === "createConversation") {
      if (input === undefined) input = {};
      return {
        context,
        input: {
          get executionProfile() {
            return context.assistantScope && input.executionProfile
              ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : undefined;
          },
          get persistent() { return input.persistent; },
          get ephemeral() { return input.ephemeral; }
        }
      };
    }
    if (method === "closeSession") return {
      namespace: claudeTerminalNamespace(context.sessionId),
      sessionId: context.sessionId,
      context,
      options: context
    };
    if (["readConversation", "startConversationTurn", "waitForConversationTurn", "stopConversation", "deleteConversation"].includes(
      method
    )) {
      if (input === undefined && !["stopConversation", "deleteConversation"].includes(method)) input = {};
      const conversationId = toText(input.conversationId || input.threadId);
      return { scopedConversationId: conversationId || undefined, input };
    }
    if (method === "sessionState" || method === "readGoal" || method === "interruptTurn") return {};
    if (method !== "sendMessage") return { input: method === "updateGoal" && input === undefined ? {} : input };
    const message = { ...input, message: input.message || input.prompt, messageId: toText(input.messageId) || randomUUID() };
    return {
      input: message,
      async prepareInput(prepared) {
        const current = { ...message, ...prepared };
        return context.prepareMessage ? context.prepareMessage(current) : current;
      }
    };
  }

  async function projectConversationResult(method, perform) {
    if (method === "hasActiveTemporaryConversation") return { ok: true, active: await perform() };
    return method === "sendMessage" || method === "interruptTurn" ? (await perform()).value : perform();
  }

  function prepareConversationHost(sessionId, openingContext = {}, mode = "main", input = {}) {
    if (mode === "detached") return {
      native: {
        owner: conversations,
        get executionProfile() {
          return input.executionProfile ? vibe64AgentExecutionProfileAuditSnapshot(input.executionProfile) : null;
        }
      }
    };
    if (mode === "activity") return ownerContextFor({ ...openingContext, sessionId }).then(context => ({
      context,
      native: { owner: conversations }
    }));
    if (mode === "detachedCleanup") return {
      native: { owner: conversations }
    };
    if (mode === "storage") return {
      native: {
        owner: conversations,
        configRoot,
        preparation: {
          retirement(binding, context) {
            return {
              configRoot,
              binding,
              beforeDelete: context.beforeDelete,
              signal: context.signal,
              application: {
                get saved() { return JSON.parse(context.session.metadata[`claude_conversation_${binding.conversationId}`] || "null"); },
                get terminalRunning() { return listTerminalSessions({
                  namespace: claudeTerminalNamespace(context.sessionId),
                  runningOnly: true
                }).length; }
              }
            };
          }
        }
      }
    };
    if (mode === "renewalProof") return {
      native: { owner: conversations, application: cleanupApplication }
    };
    if (mode === "renewal") return {
      native: {
        owner: conversations,
        preparation: {
          handover: (handoverInput, context) => prepareRenewalHandover(context, handoverInput),
          seed: (seedInput, context) => prepareRenewalSeed(context, seedInput)
        }
      }
    };
    if (mode === "reconciliation") return {
      native: { owner: conversations, application: cleanupApplication }
    };
    if (mode === "projectCleanup" || mode === "invalidation") return {
      native: {
        owner: conversations,
        application: cleanupApplication,
        account: { queries: accountQueries, failure: accountQueryFailure }
      }
    };
    return (async () => {
      if (mode === "readiness" || mode === "settings") return {
        native: { owner: conversations }
      };
      if (mode === "scoped" || mode === "create" || mode === "dispose") return {
        namespace: claudeTerminalNamespace(sessionId),
        native: {
          owner: conversations,
          preparation: { cleanup: prepareSessionCleanup }
        }
      };
      const context = await contextFor({ ...openingContext, sessionId });
      const { runtime } = context;
      return {
        context, namespace: claudeTerminalNamespace(sessionId), publish: publishSessionChanged,
        async readContextUsage({ context: current, input: usageInput, signal }) {
          signal?.throwIfAborted();
          const entry = await conversations.acquire({ ...current, sessionId });
          return conversations.readContextUsage(entry, { ...usageInput, signal });
        },
        async compactContext({ context: current, input: compactInput, signal }) {
          signal?.throwIfAborted();
          const entry = await conversations.acquire({ ...current, sessionId });
          // False: Claude is working, and summarises itself as it goes.
          if (conversations.snapshot(entry)?.active) return false;
          return conversations.compactContext(entry, { ...compactInput, signal });
        },
        state: {
          async read(current, representation, nativeState) {
            if (representation === "native") return { nativeResult: await sessionState(current, nativeState) };
            const nativeResult = current ? await sessionState(current, nativeState) : null;
            const session = await runtime.getSession(sessionId, { inspectSource: false });
            const id = nativeResult?.thread.id || toText(session.metadata.claude_conversation_id);
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
          /** A canonical goal operation's result observer; a canonical read or update always carries one. */
          completeResult(current) {
            if (!current?.canonicalGoal) return;
            if (current.goalOperation === "read") return current.onGoalResult;
            if (current.goalOperation === "update") return result => current.onGoalResult(result);
          }
        }
      };
    })();
  }

  async function unsubscribeSessions() {
    return { ok: true };
  }

  async function releaseRenewalPredecessorAttachments() {
    return { ok: true, released: 0 };
  }

  return Object.freeze({
    conversationOperations: Object.freeze([
      "createConversation",
      "ensureSession",
      "updateSessionSettings",
      "sendMessage",
      "sessionState",
      "inspectMessageAdmission",
      "interruptTurn",
      "readGoal",
      "updateGoal",
      "readConversation",
      "startConversationTurn",
      "waitForConversationTurn",
      "stopConversation",
      "deleteConversation",
      "closeSession",
      "closeProject",
      "invalidateRuntimes",
      "reconcileSessions",
      "generateSessionRenewalHandover",
      "seedSessionRenewalHandover",
      "interruptDetachedChatTurn",
      "deleteDetachedChatThread",
      "listNativeConversationStorage",
      "retireConversationHistory",
      "hasActiveTemporaryConversation",
      "releaseRenewalPredecessorProcessExitProof",
      "releaseRenewalSuccessorProcessExitProof"
    ]),
    prepareConversationRequest,
    projectConversationResult,
    runDetachedChatTurn,
    streamDetachedChatTurn: runDetachedChatTurn,
    prepareConversationHost,
    id: ENGINE,
    transportId: TRANSPORT,
    executionProfiles: [VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER],
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
    unsubscribeSessions,
    releaseRenewalPredecessorAttachments
  });
}

export { createClaudeConversationHost };
