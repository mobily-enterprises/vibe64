import { AppError } from "@jskit-ai/kernel/server/runtime";
import { conversationConfiguration } from "./conversationConfiguration.js";
import {
  appCredentialContext,
  createVibe64ConversationExecution,
  homeEnvForUser,
  operatorCliCommand
} from "@local/vibe64-execution/server";
import {
  codexAppServerControlsLog,
  codexAppServerRuntimeBaseDir,
  codexAppServerRuntimeDir,
  codexAppServerRuntimeHost
} from "@local/vibe64-runtime/server/codexAppServerProvider";
import {
  assistantRoutingFromMetadata,
  assistantRoutingRequestFromMetadata
} from "@local/vibe64-runtime/shared/assistantRouting";
import { requireCompletedConversationRewind } from "./assistantChangeover.js";
import path from "node:path";
import { vibe64HostContextEnvironment } from "@local/vibe64-genesis/server";
import {
  assertProjectEffectAdmission,
  captureProjectRequestContext,
  currentProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { VIBE64_ASSISTANT_ENGINE_IDS, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { realtimeDebugEnabled } from "./serviceMainConversationHost.js";
import { AGENT_WRITE_WAIT_MS } from "./serviceSessionAccess.js";
import { sessionHasActiveAgentRun } from "./serviceSessionRecords.js";

/** @typedef {import("./types.js").ServiceState} ServiceState */
/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("./types.js").ServiceAssistantContext} ServiceAssistantContext */
/** @typedef {import("./types.js").ServiceGoals} ServiceGoals */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").OpenCodeSessionRegistration} OpenCodeSessionRegistration */
/** @typedef {import("@local/vibe64-core/server/types").CodexProviderConnectionStore} CodexProviderConnectionStore */
/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").SessionConversations} SessionConversations */
/** @typedef {import("./types.js").SessionNaming} SessionNaming */
/** @typedef {import("./types.js").SessionPromptHintsService} SessionPromptHintsService */
/** @typedef {import("./types.js").AssistantRouting} AssistantRouting */
/** @typedef {import("./types.js").CodexAppServerProviderOptions} CodexAppServerProviderOptions */
/** @typedef {import("./types.js").ConversationRuntime} ConversationRuntime */


/**
 * The runtime proved this message never reached the assistant. Say so in the
 * response, so the browser shows the failure instead of an uncertain receipt.
 * Only Vibe64's own coded failures keep their message; internal ones do not.
 */
function notSentDeliveryError(error, messageId) {
  const delivery = { status: "not-sent", messageId };
  const status = Number(error.status || error.statusCode);
  // conversation_* codes are the shared conversation protocol's definite
  // rejections; the browser recovers from them by code.
  const readable = error instanceof AppError || /^(vibe64|conversation)_/u.test(String(error.code || ""));
  return new AppError(status >= 400 && status < 500 ? status : 422,
    readable ? error.message : "The message was not sent because Vibe64 could not prepare it. Your chat is saved; try again.", {
      code: readable ? error.code : "vibe64_assistant_message_not_sent",
      details: { ...(readable && error.details && typeof error.details === "object" ? error.details : {}), delivery }
    });
}

/**
 * A session's assistant: its access, selection and configuration, the conversation host it opens, and
 * the messages, cancels, interrupts and browser conversations of its turns.
 * @param {object} dependencies
 * @param {ServiceState} dependencies.state
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ServiceAssistantContext} dependencies.assistantContext
 * @param {ServiceGoals} dependencies.goals
 * @param {AssistantRouting} dependencies.assistantRouting
 * @param {CodexProviderConnectionStore} dependencies.codexProviderConnections
 * @param {CodexAppServerProviderOptions} dependencies.codexProviderOptions
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeLogger} dependencies.logger
 * @param {ConversationRuntime} dependencies.mainConversations
 * @param {OpenCodeSessionRegistration} dependencies.opencode
 * @param {object} dependencies.opencodeTerminalController
 * @param {SessionAgentManager} dependencies.sessionAgent
 * @param {SessionConversations} dependencies.sessionConversations
 * @param {SessionNaming} dependencies.sessionNaming
 * @param {SessionPromptHintsService} dependencies.sessionPromptHints
 */
function createServiceAssistant({
  state,
  sessionAccess,
  assistantContext,
  goals,
  assistantRouting,
  codexProviderConnections,
  codexProviderOptions,
  env,
  logger,
  mainConversations,
  opencode,
  opencodeTerminalController,
  sessionAgent,
  sessionConversations,
  sessionNaming,
  sessionPromptHints
}) {
  /**
   * A temporary send refused before admission uses Main's definite rejection.
   */
  async function startTemporaryConversationTurn(sessionId, input = {}, options = {}) {
    try {
      return await sessionConversations.startTemporaryConversationTurn(sessionId, input, options);
    } catch (error) {
      if (error?.delivery === "not-sent") throw notSentDeliveryError(error, input.messageId);
      throw error;
    }
  }

  function describeAgentProvider(options = {}) {
    return sessionAgent.describeProvider(options);
  }

  async function inspectAssistantAccess(sessionId, options = {}) {
    const context = await assistantContext.assistantSessionOptions(sessionId, options);
    const preferences = assistantRoutingFromMetadata(context.session.metadata);
    const native = await sessionAgent.assistantAccess(sessionId, context);
    const purposes = await sessionAgent.inspectAssistantPurposes({ ...preferences }, context);
    const currentMode = preferences?.mode || "";
    const steering = sessionHasActiveAgentRun(context.session);
    const available = currentMode && !steering ? purposes[currentMode]?.available === true : native.available;
    const canUse = currentMode && !steering ? purposes[currentMode]?.available === true : native.canUse;
    return {
      ...native,
      available,
      canUse,
      nativeCanUse: native.canUse,
      steering,
      canUseAny: Object.values(purposes).some(purpose => purpose.available),
      currentMode,
      purposes
    };
  }

  async function requireAssistantAccess(sessionId, options = {}) {
    return sessionAgent.requireAssistantAccess(
      sessionId,
      await assistantContext.assistantSessionOptions(sessionId, options)
    );
  }

  function requireAssistantSelectionAccess(assistantSelection, options = {}) {
    return sessionAgent.requireAssistantAccessForSelection(assistantSelection, options);
  }

  function createConversationHost(scope) {
    const credentialHome = appCredentialContext();
    if (credentialHome.ok === false) throw new Error(credentialHome.error);

    function prepareOpenCodeHost(input) {
      return opencode.hostPreparation.conversationHost(input);
    }

    async function prepareCodexHost({ providerId }) {
      // Same account/runtime scope as main chat. The conversation's workdir
      // and command environment belong to its thread, not this service.
      const options = {
        ...codexProviderOptions,
        ...(providerId === "openai" ? {} : await codexProviderConnections.runtimeOptions(providerId)),
        executionMode: "",
        executionRoot: "",
        workdir: "",
        project: {},
        session: {},
        terminalEnv: await vibe64HostContextEnvironment(codexAppServerRuntimeBaseDir({ env })),
        userKey: ""
      };
      options.runtimeDir ||= codexAppServerRuntimeDir(options);
      return { ...codexAppServerRuntimeHost(options), log: codexAppServerControlsLog(logger), options };
    }

    return Object.freeze({
      workdir: scope.workdir,
      stateDirectory: path.join(scope.runtimeRoot, "native"),
      allowAccountChange: scope.allowAccountChange === true,
      env: {
        ...homeEnvForUser(credentialHome, env),
        CODEX_HOME: path.join(codexProviderOptions.toolHomeSource, ".codex")
      },
      commands: {
        codex: codexProviderOptions.codexCommand || operatorCliCommand("codex", { env }),
        claude: operatorCliCommand("claude", { env }),
        opencode: opencodeTerminalController.command || operatorCliCommand("opencode", { env })
      },
      execution: createVibe64ConversationExecution({
        credentialHome,
        capturePurpose: "account",
        execution: { ownerId: scope.id },
        operationId: "conversation",
        label: "Assistant conversation"
      }),
      opencode: prepareOpenCodeHost,
      codex: prepareCodexHost
    });
  }

  async function resolveConversationConfiguration(assistantSelection, systemPrompt, options = {}) {
    await sessionAgent.requireAssistantAccessForSelection(assistantSelection, options);
    return conversationConfiguration(assistantSelection, systemPrompt);
  }

  async function resolveConversationConnection({ integrationId, assistantSelection }, options = {}) {
    await sessionAgent.requireAssistantAccessForSelection(assistantSelection, options);
    if (integrationId !== assistantSelection.modelProviderId) {
      throw new Error("The requested connection differs from the authorized assistant selection.");
    }
    let connection;
    if (assistantSelection.engineId === "opencode") connection = await state.assistantRuntime.resolveConnection(assistantSelection);
    else if (assistantSelection.engineId === "claude") connection = await codexProviderConnections.claudeProviderSettings(integrationId);
    else {
      await codexProviderConnections.runtimeOptions(integrationId);
      connection = await codexProviderConnections.read(integrationId, "codex");
    }
    if (!connection?.apiKey) throw new Error("Reconnect the selected AI account before continuing.");
    return {
      providerId: integrationId,
      model: assistantSelection.modelId,
      apiKey: connection.apiKey,
      ...(connection.canonicalUrl ? { baseURL: connection.canonicalUrl } : {})
    };
  }

  function listAssistantCapabilities(input = {}, options = {}) {
    return sessionAgent.listCapabilities(input, options);
  }

  function resolveAssistantPurpose(input = {}, options = {}, resolution = {}) {
    return sessionAgent.resolveAssistantPurpose(input, options, resolution);
  }

  function inspectAssistantRoutingConfiguration(configuration, options = {}) {
    return sessionAgent.inspectRoutingConfiguration(configuration, options);
  }

  function updateAssistantModelAccess(input = {}, options = {}) {
    if (input.engineId !== VIBE64_ASSISTANT_ENGINE_IDS.OPENCODE) {
      const error = new Error("Only OpenCode providers expose configurable model access.");
      error.code = "vibe64_assistant_model_access_not_configurable";
      error.statusCode = 400;
      throw error;
    }
    // readable-check: allow method-probe - optional operation: a host without model access changes refuses them
    if (typeof state.assistantRuntime.updateModelAccess !== "function") {
      const error = new Error("This Vibe64 host does not support changing provider model access.");
      error.code = "vibe64_assistant_model_access_unavailable";
      error.statusCode = 503;
      throw error;
    }
    return state.assistantRuntime.updateModelAccess({
      engineId: input.engineId,
      modelProviderId: String(input.modelProviderId || "").trim(),
      unlocked: input.unlocked === true,
      vibe64User: options.vibe64User || null
    });
  }

  function verifyAssistantConnection(input = {}, options = {}) {
    void options;
    return opencode.accounts.verifyConnection(input);
  }

  function resolveAssistantSelection(input = {}, options = {}) {
    return sessionAgent.resolveSelection(input, options);
  }

  function resolveAgentExecutionProfile(sessionId, input = {}, options = {}) {
    return sessionAgent.resolveExecutionProfile(sessionId, input, options);
  }

  /**
   * Cancel of one unsent or unconfirmed Main message; it always succeeds.
   */
  function cancelAgentMessage(sessionId, input = {}, options = {}) {
    return assistantRouting.cancelMessage(sessionId, { messageId: input.messageId }, options);
  }

  async function interruptAgentTurn(sessionId, input = {}, options = {}) {
    await goals.stopGoalIntent(sessionId, await assistantContext.assistantSessionOptions(sessionId, options));
    if (await assistantRouting.cancel(sessionId, options)) return { ok: true, interrupted: true, routingCancelled: true };
    return sessionAgent.interruptTurn(sessionId, input, options);
  }

  function generateSessionPromptHints(sessionId, input = {}) {
    return sessionPromptHints.generateSessionPromptHints(sessionId, input);
  }

  function cancelSessionPromptHints(sessionId, input = {}) {
    return sessionPromptHints.cancelSessionPromptHints(sessionId, input);
  }

  async function resumeIntegrationContinuation(sessionId, input = {}, options = {}) {
    const inspectConfiguration = async (saved) => {
      // readable-check: allow method-probe - test asserts error: a goal without an integration configuration reader is refused
      if (typeof options.readIntegrationConfiguration !== "function") {
        return {
          ok: false,
          code: "vibe64_integration_configuration_unavailable",
          error: "Integration configuration cannot be checked before continuing.",
          integrationSetup: saved
        };
      }
      const current = await options.readIntegrationConfiguration();
      if (current?.ok === false) return current;
      if (current?.baseHash !== saved.configurationHash ||
          !Object.hasOwn(current?.configuration?.integrations || {}, saved.integrationId)) {
        return {
          ok: false,
          code: "vibe64_integration_configuration_changed",
          error: "Integration configuration changed after verification. Return to chat and request setup for the updated configuration.",
          integrationSetup: saved
        };
      }
      return null;
    };
    const unconfirmed = (saved) => ({
      ok: false,
      code: "vibe64_integration_continuation_unconfirmed",
      error: "Assistant delivery could not be confirmed. Check again to inspect delivery; this will not send a duplicate message.",
      integrationSetup: saved
    });
    const prepared = await sessionAccess.runMainAgentWrite(sessionId, options, async (context) => {
      requireCompletedConversationRewind(context.session);
      const store = context.runtime.store;
      const saved = await store.readIntegrationSetupRequest(sessionId, input.turnId);
      if (!saved || saved.requestId !== input.requestId || saved.outcome !== "completed") {
        return {
          ok: false,
          code: "vibe64_integration_setup_not_completed",
          error: "This integration request has not been completed."
        };
      }
      if (saved.continuation.status === "accepted") {
        return { ok: true, integrationSetup: saved };
      }
      const route = assistantRoutingRequestFromMetadata(context.session.metadata);
      // A previously claimed delivery without a routing request is only
      // inspected. Never turn its old receipt into a fresh routed Send.
      if (saved.continuation.status === "sending" && route?.messageId !== saved.continuationMessageId) {
        let delivered = await store.conversationMessageIdExists(sessionId, saved.continuationMessageId);
        if (!delivered && vibe64AssistantSelectionFromMetadata(context.session.metadata).engineId === saved.continuation.engineId) {
          try {
            const admission = await sessionAgent.inspectMessageAdmission(sessionId, {
              messageId: saved.continuationMessageId,
              threadId: saved.continuation.threadId
            }, context);
            delivered = admission.ok !== false && admission.admission === "accepted";
          } catch {
            // Keep the original receipt for another read after reconnection.
          }
        }
        if (!delivered) return unconfirmed(saved);
        const accepted = await store.acceptIntegrationContinuation(sessionId, {
          ...input,
          continuationMessageId: saved.continuationMessageId,
          ...saved.continuation
        });
        return { ok: true, integrationSetup: accepted.integrationSetup };
      }
      if (saved.continuation.status === "pending") {
        const failure = await inspectConfiguration(saved);
        if (failure) return failure;
      }
      return { saved, runtime: context.runtime };
    }, { operation: "resume-integration-continuation", waitMs: AGENT_WRITE_WAIT_MS });
    if (!prepared.saved) return prepared;
    const { saved, runtime } = prepared;
    let delivered = false;
    let failure;
    try {
      const result = await assistantRouting.send(sessionId, {
        messageId: saved.continuationMessageId,
        submissionKind: "send",
        message: `Integration setup completed for slot ${JSON.stringify(saved.integrationId)}. Continue the implementation from your integration setup request. Read the project's saved integration configuration; do not request or expose credentials in chat.`
      }, {
        ...options,
        runtime,
        purpose: "junior",
        onPromptSending: async ({ threadId, assistantSelection }) => {
          const changed = await inspectConfiguration(saved);
          if (changed) throw Object.assign(new Error(changed.error), { code: changed.code });
          await runtime.store.claimIntegrationContinuation(sessionId, {
            ...input,
            continuationMessageId: saved.continuationMessageId,
            engineId: assistantSelection.engineId,
            threadId
          });
        }
      });
      delivered = result?.ok !== false && result?.delivered === true;
    } catch (error) {
      failure = { ok: false, code: error.code, error: error.message };
      logOperationalEvent(logger, "warn", {
        code: error.code,
        component: "vibe64.integration_continuation",
        event: "vibe64.integration_continuation.delivery_failed",
        sessionId,
        messageId: saved.continuationMessageId
      }, "Integration continuation delivery failed; its request remains available for recovery.");
    }
    return sessionAccess.runMainAgentWrite(sessionId, { ...options, runtime }, async () => {
      const current = await runtime.store.readIntegrationSetupRequest(sessionId, input.turnId);
      if (!current || current.requestId !== saved.requestId) return unconfirmed(current);
      if (current.continuation.status === "accepted") return { ok: true, integrationSetup: current };
      if (current.continuation.status === "pending") return failure || unconfirmed(current);
      if (!delivered) return unconfirmed(current);
      const accepted = await runtime.store.acceptIntegrationContinuation(sessionId, {
        ...input,
        continuationMessageId: current.continuationMessageId,
        ...current.continuation
      });
      return { ok: true, integrationSetup: accepted.integrationSetup };
    }, { operation: "complete-integration-continuation", waitMs: AGENT_WRITE_WAIT_MS });
  }

  async function sendAgentMessage(sessionId, input = {}, options = {}) {
    assertProjectEffectAdmission();
    const startedAt = Date.now();
    const deliveryStartedAt = performance.now();
    const username = (currentProjectRequestContext()?.vibe64User || options.vibe64User)?.username || null;
    logOperationalEvent(logger, "info", {
      event: "vibe64.agent_message.received",
      component: "vibe64.agent_message",
      sessionId,
      messageId: input.messageId
    }, "Assistant message received.");
    void sessionPromptHints.cancelSessionPromptHintsForSession(sessionId).catch((error) => {
      logOperationalEvent(logger, "warn", { event: "vibe64.prompt_hints.cleanup_failed", error: error.message, sessionId },
        "Prompt suggestion cleanup will be retried on session close.");
    });
    try {
      const result = await assistantRouting.send(sessionId, input, { ...options, deliveryMessageId: input.messageId });
      const deliveryDurationMs = performance.now() - deliveryStartedAt;
      logOperationalEvent(logger, deliveryDurationMs >= 1000 ? "warn" : "info", {
        event: "vibe64.agent_message.delivery_finished",
        component: "vibe64.agent_message",
        sessionId,
        messageId: input.messageId,
        durationMs: deliveryDurationMs,
        delivered: result?.delivered === true,
        duplicate: result?.duplicate === true
      }, "Assistant message delivery finished.");
      if (result?.ok === true && !result.duplicate && !options.purpose && !input.reviewAction && !state.lifecycle.closing) {
        try {
          sessionNaming.start(await assistantContext.assistantSessionOptions(sessionId, options), input.messageId);
        } catch (error) {
          logger.warn({ error: error.message, sessionId }, "Session naming could not start.");
        }
      }
      if (result?.ok === false) {
        logOperationalEvent(logger, "warn", {
          code: result.code,
          component: "vibe64.agent_message",
          durationMs: Date.now() - startedAt,
          error: result.error || result.errors?.[0]?.message,
          event: "vibe64.agent_message.delivery_failed",
          username,
          messageId: input.messageId,
          operationOutcome: result.operationOutcome,
          refreshRecommended: result.refreshRecommended,
          retryable: result.retryable,
          sessionId,
          threadId: result.thread?.id,
          turnId: result.turn?.id
        }, "Vibe64 assistant message delivery failed.");
      }
      return result;
    } catch (error) {
      logOperationalEvent(logger, "warn", {
        code: error?.code,
        component: "vibe64.agent_message",
        durationMs: Date.now() - startedAt,
        error,
        event: "vibe64.agent_message.delivery_failed",
        username,
        messageId: input.messageId,
        nativeStartupStderr: error?.nativeStartupStderr,
        sessionId
      }, "Vibe64 assistant message delivery failed.");
      if (error?.delivery === "not-sent") throw notSentDeliveryError(error, input.messageId);
      throw error;
    }
  }

  async function readAgentPlanUsage(sessionId, options) {
    return sessionAgent.readPlanUsage(sessionId, await assistantContext.assistantSessionOptions(sessionId, options));
  }

  async function ensureAgentSession(sessionId, options = {}) {
    const startedAt = Date.now();
    const username = (currentProjectRequestContext()?.vibe64User || options.vibe64User)?.username || null;
    const logFailure = (fields) => logOperationalEvent(logger, "warn", {
      ...fields,
      component: "vibe64.agent_session",
      durationMs: Date.now() - startedAt,
      event: "vibe64.agent_session.reconciliation_failed",
      username,
      sessionId
    }, "Vibe64 assistant status could not be verified.");

    try {
      const context = await assistantContext.assistantSessionOptions(sessionId, options);
      // An archived session, such as a renewed predecessor, has no assistant to prepare.
      if (context.session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
        return { ok: false, code: "vibe64_session_archived", error: "This session is archived.", sessionId };
      }
      const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
      if (selection.engineId === "codex" && (context.session.metadata.agent_identity_provider !== "codex" ||
          !context.session.metadata.agent_identity_conversation_id)) {
        await sessionAgent.prepareSelection(sessionId, selection, context);
      }
      const result = await sessionAgent.ensureSession(
        sessionId,
        ["codex", "opencode"].includes(selection.engineId) ? assistantContext.applicationToolManifest(context) : context
      );
      if (result?.ok !== false) await assistantRouting.reconcile(sessionId, context);
      if (result?.ok === false) {
        logFailure({
          code: result.code,
          error: result.error,
          retryable: result.retryable
        });
      }
      return result;
    } catch (error) {
      logFailure({ code: error?.code, error });
      throw error;
    }
  }

  async function openBrowserConversation(sessionId, options = {}) {
    if (!options.browserAuthority || options.browserAuthority.sessionId !== sessionId) {
      throw Object.assign(new Error("Main browser conversations require current project access."), {
        code: "conversation_forbidden",
        statusCode: 403
      });
    }
    const diagnostics = realtimeDebugEnabled(env);
    let phase = "session-read";
    let started = performance.now();
    let completed = false;
    try {
      const saved = await sessionAccess.readAssistantSession(sessionId, options);
      if (diagnostics) logOperationalEvent(logger, "warn", {
        event: "vibe64.conversation.browser_timing",
        sessionId,
        phase,
        completed: true,
        durationMs: performance.now() - started
      }, "Browser conversation opening timing.");
      phase = "native-open";
      started = performance.now();
      // The tool manifest resolves the saved selection, so it belongs to opening.
      const context = assistantContext.applicationToolManifest(saved);
      const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
      const current = {
        ...context,
        sessionId,
        assistantSelection: selection,
        providerId: selection.engineId,
        browserProjectContext: captureProjectRequestContext()
      };
      const conversation = await mainConversations.open({ id: sessionId, context: current });
      completed = true;
      /**
       * A cancelled message is never offered for recovery and has no other receipt.
       */
      return Object.freeze({
        ...conversation,
        async read(...args) {
          const conversationState = await conversation.read(...args);
          if (!conversationState?.pendingRequest ||
              !await assistantRouting.isCancelled(sessionId, conversationState.pendingRequest.messageId, current)) {
            return conversationState;
          }
          return { ...conversationState, pendingRequest: null, ...(conversationState.status === "unconfirmed" ? { status: "ready" } : {}) };
        },
        async inspectDelivery(input) {
          if (await assistantRouting.isCancelled(sessionId, input.messageId, current)) return {
            status: "cancelled",
            messageId: input.messageId
          };
          const receipt = await conversation.inspectDelivery(input);
          if (receipt?.status !== "unknown") return receipt;
          const routed = await assistantRouting.inspectDelivery(sessionId, input, current);
          if (routed?.delivered === true) return conversation.inspectDelivery(input);
          return routed?.status === "not-sent" ? routed : receipt;
        }
      });
    } finally {
      if (diagnostics) logOperationalEvent(logger, "warn", {
        event: "vibe64.conversation.browser_timing",
        sessionId,
        phase,
        completed,
        durationMs: performance.now() - started
      }, "Browser conversation opening timing.");
    }
  }

  async function openTemporaryBrowserConversation(sessionId, conversationId, options = {}) {
    const authority = options.browserAuthority;
    if (!authority || authority.sessionId !== sessionId || authority.conversationId !== conversationId) {
      throw Object.assign(new Error("Temporary browser conversations require current project access."), {
        code: "conversation_forbidden",
        statusCode: 403
      });
    }
    const context = await assistantContext.assistantSessionOptions(sessionId, options);
    return mainConversations.open({
      id: sessionId,
      context: {
        ...context,
        sessionId,
        temporaryConversationId: conversationId,
        browserProjectContext: captureProjectRequestContext()
      }
    });
  }

  function agentSessionState(sessionId, options = {}) {
    return sessionAgent.sessionState(sessionId, options);
  }

  function cancelAssistantRoutingForSelection(sessionId, messageId, options = {}) {
    return assistantRouting.cancel(sessionId, options, { waitForCleanup: true, expectedMessageId: messageId });
  }

  return Object.freeze({
    agentSessionState,
    cancelAgentMessage,
    cancelAssistantRoutingForSelection,
    cancelSessionPromptHints,
    createConversationHost,
    describeAgentProvider,
    ensureAgentSession,
    generateSessionPromptHints,
    inspectAssistantAccess,
    inspectAssistantRoutingConfiguration,
    interruptAgentTurn,
    listAssistantCapabilities,
    openBrowserConversation,
    openTemporaryBrowserConversation,
    readAgentPlanUsage,
    requireAssistantAccess,
    requireAssistantSelectionAccess,
    resolveAgentExecutionProfile,
    resolveAssistantPurpose,
    resolveAssistantSelection,
    resolveConversationConfiguration,
    resolveConversationConnection,
    resumeIntegrationContinuation,
    sendAgentMessage,
    startTemporaryConversationTurn,
    updateAssistantModelAccess,
    verifyAssistantConnection
  });
}

export {
  createServiceAssistant
};
