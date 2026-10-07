import { codexAppServerControlDisabledResult } from "../../codexConversationPreparation.js";
import { renewalArchivedPredecessorContext, renewalSuccessorProcessExitProofReleaseContext } from "../../sessionRenewalHandover.js";
import { beginTerminalNamespaceOperation } from "@local/vibe64-execution/server/terminalSessions";
import {
  codexCatalogRows as nativeCodexCatalogRows,
  codexCatalogReasoningEfforts,
  codexCatalogModels,
  codexConfiguredModelCatalog
} from "@jskit-ai/assistant-core/server/codex-configuration";
import { withCodexState } from "../../codexConversationStorage.js";
import { prepareCodexModelRouting } from "../../nativeConversationRetirement.js";
import { codexTerminalNamespace, vibe64Result } from "../../terminalShared.js";
import { CURATED_CODEX_PROVIDERS, curatedCodexModel } from "@local/vibe64-core/shared/curatedCodexProviders";
import { createHash } from "node:crypto";

import {
  normalizeText
} from "@local/vibe64-core/server/core";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  VIBE64_AGENT_HELPER_WORKLOAD_LIMITS,
  VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES,
  VIBE64_AGENT_EXECUTION_PROFILE_IDS,
  VIBE64_AGENT_EXECUTION_TOOL_POLICIES,
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  Vibe64AgentExecutionProfileError,
  defineVibe64AgentExecutionProfileRequest,
  defineVibe64AgentExecutionProfileResolution,
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";

const CODEX_PRODUCT_PROVIDER_ID = "codex";
const CODEX_APP_SERVER_TRANSPORT_ID = "codex_app_server";
const CODEX_ATTACHMENT_MAX_ITEMS = 10;
const CODEX_ATTACHMENT_RENEW_RETRY_DELAYS_MS = Object.freeze([500, 1_000, 2_000, 5_000]);
const CODEX_HELPER_PROFILE_REVISION = "codex-helper-selected-v4";
const CODEX_HELPER_WORKLOAD_LIMITS = VIBE64_AGENT_HELPER_WORKLOAD_LIMITS;
const acceptedAttachmentRenewalTimers = new WeakMap();

function codexAssistantSettings(context = {}, input = {}) {
  const requested = input?.agentSettings && typeof input.agentSettings === "object"
    ? input.agentSettings
    : context?.agentSettings && typeof context.agentSettings === "object"
      ? context.agentSettings
      : {};
  const selection = context?.assistantSelection;
  return selection?.engineId === CODEX_PRODUCT_PROVIDER_ID
    ? {
        ...requested,
        model: selection.modelId,
        modelProviderId: selection.modelProviderId,
        providerId: CODEX_PRODUCT_PROVIDER_ID,
        thinking: selection.variantId
      }
    : requested;
}

function codexAssistantCapabilities(connected = true, catalog = codexConfiguredModelCatalog(false), connections = []) {
  // The native process knows all routable models. Account choices still belong
  // to their own credential routes; knowing metadata does not grant access.
  const rows = codexCatalogRows(catalog).filter((model) => model.hidden !== true && !curatedCodexModel(model.model));
  const models = codexCatalogModels(rows);
  const defaultModel = rows.find((model) => model.model === VIBE64_CODEX_DEFAULT_MODEL) ||
    rows.find((model) => model.isDefault === true) || rows[0];
  const defaultThinking = codexCatalogReasoningEfforts(defaultModel).has(VIBE64_CODEX_DEFAULT_THINKING)
    ? VIBE64_CODEX_DEFAULT_THINKING
    : normalizeText(defaultModel?.defaultReasoningEffort);
  const curated = CURATED_CODEX_PROVIDERS.map((provider) => {
    const connection = connections.find(({ id }) => id === provider.id);
    return {
      id: provider.id,
      label: provider.label,
      description: provider.description,
      connected: connection?.connected === true,
      apiKeyCompatible: true,
      defaultModelId: provider.models[0].id,
      models: provider.models.map((model) => ({
        id: model.id,
        label: model.label,
        status: "available",
        capabilities: { images: model.images === true, defaultVariantId: model.defaultThinking },
        variants: model.variants.map((id) => ({ id, label: id[0].toUpperCase() + id.slice(1) }))
      }))
    };
  });
  const defaultCuratedProvider = curated.find((provider) => provider.connected);
  const available = connected || Boolean(defaultCuratedProvider);
  const revision = `sha256:${createHash("sha256").update(JSON.stringify({
    connected,
    models,
    curated
  })).digest("hex")}`;
  return {
    agents: [{
      description: "OpenAI Codex coding agent",
      id: "codex",
      label: "Codex",
      mode: "primary"
    }],
    authentication: {
      management: "account-owner",
      modes: ["oauth", "api-key"]
    },
    defaults: {
      agentId: "codex",
      modelId: connected ? normalizeText(defaultModel?.model) : defaultCuratedProvider?.defaultModelId || "",
      modelProviderId: connected ? "openai" : defaultCuratedProvider?.id || "openai",
      variantId: connected ? defaultThinking : ""
    },
    engineId: CODEX_PRODUCT_PROVIDER_ID,
    health: {
      message: available ? "" : "Connect a Codex provider in AI Accounts.",
      status: available ? "ready" : "unavailable"
    },
    label: "Codex",
    modelProviders: [{
      connected,
      description: "Codex models provided by OpenAI",
      id: "openai",
      label: "GPT",
      models
    }, ...curated],
    revision,
    transportId: CODEX_APP_SERVER_TRANSPORT_ID
  };
}

function codexExecutionProfileError(code, message, details = {}) {
  return new Vibe64AgentExecutionProfileError(code, message, details);
}

function codexCatalogRows(value = null) {
  return nativeCodexCatalogRows(value, message => codexExecutionProfileError(
    VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE,
    message
  ));
}

function codexHelperExecutionProfileRequest(request = {}) {
  const executionProfile = defineVibe64AgentExecutionProfileRequest(request);
  if (executionProfile.profileId !== VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER) {
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.PROFILE_UNKNOWN,
      `Codex does not provide execution profile ${executionProfile.profileId}.`,
      { profileId: executionProfile.profileId }
    );
  }
  const limits = CODEX_HELPER_WORKLOAD_LIMITS[executionProfile.workloadId];
  if (!limits) {
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.WORKLOAD_UNSUPPORTED,
      `Codex helper does not support workload ${executionProfile.workloadId}.`,
      { workloadId: executionProfile.workloadId }
    );
  }
  return {
    executionProfile,
    limits
  };
}

function resolveCodexHelperExecutionProfile(request = {}, catalog = null, modelId = "", thinking = "") {
  const { executionProfile, limits } = codexHelperExecutionProfileRequest(request);
  const model = codexCatalogRows(catalog).find((row) => row?.hidden !== true && normalizeText(row?.model) === modelId);
  if (!model) {
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.MODEL_UNAVAILABLE,
      "The selected Codex helper model is unavailable. Choose another in Model routing.",
      { model: modelId }
    );
  }
  if (thinking && !codexCatalogReasoningEfforts(model).has(thinking)) {
    throw codexExecutionProfileError(
      VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.REASONING_UNSUPPORTED,
      `The selected Codex helper model does not support ${thinking} thinking.`,
      { model: modelId, thinking }
    );
  }
  return defineVibe64AgentExecutionProfileResolution({
    ...executionProfile,
    limits,
    model: modelId,
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: VIBE64_AGENT_EXECUTION_TOOL_POLICIES.NONE
    },
    providerId: CODEX_PRODUCT_PROVIDER_ID,
    request: { allowProviderModelFallback: false, reasoning: Boolean(thinking), summary: false },
    revision: CODEX_HELPER_PROFILE_REVISION,
    thinking
  });
}

function normalizeCodexTurn(result = {}) {
  const turn = result?.codexAgentTurn || {};
  const id = normalizeText(turn?.turnId || result?.turnId);
  const active = Boolean(id) && (turn?.active === true || result?.active === true);
  if (!id && !active) {
    return null;
  }
  return {
    active,
    error: normalizeText(turn?.error),
    id,
    phase: active ? normalizeText(turn?.phase) : "",
    startedAt: normalizeText(turn?.startedAt),
    state: normalizeText(turn?.state),
    status: normalizeText(turn?.status || turn?.state),
    threadId: normalizeText(turn?.threadId || result?.codexThreadId || result?.threadId),
    updatedAt: normalizeText(turn?.updatedAt)
  };
}

function normalizeCodexSessionResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result) ? result : {};
  const turn = normalizeCodexTurn(source);
  return {
    ...(normalizeText(source.code) ? { code: normalizeText(source.code) } : {}),
    ...(normalizeText(source.error) ? { error: normalizeText(source.error) } : {}),
    ...(normalizeText(source.deliveryMode) ? { deliveryMode: normalizeText(source.deliveryMode) } : {}),
    delivered: source.delivered === true,
    ...(normalizeText(source.operationOutcome) ? { operationOutcome: normalizeText(source.operationOutcome) } : {}),
    ...(normalizeText(source.reason) ? { reason: normalizeText(source.reason) } : {}),
    connectionReused: typeof source.connectionReused === "boolean" ? source.connectionReused : null,
    identity: source.agentIdentity || null,
    ...(typeof source.interrupted === "boolean" ? { interrupted: source.interrupted } : {}),
    newTurnRequired: source.newTurnRequired === true,
    ok: source.ok !== false,
    refreshRecommended: source.refreshRecommended === true,
    retryable: typeof source.retryable === "boolean" ? source.retryable : null,
    sessionUpdated: source.sessionUpdated === true,
    terminal: source.codexTerminal || null,
    thread: {
      id: normalizeText(source.codexThreadId || source.threadId || turn?.threadId)
    },
    turn,
    workdir: normalizeText(source.codexWorkdir)
  };
}

function codexAttachmentIds(input = {}) {
  return Array.isArray(input?.attachmentIds)
    ? input.attachmentIds.map(normalizeText).filter(Boolean)
    : [];
}

function codexAttachmentDeliveryFailure(code, error, retryable) {
  return {
    code,
    error,
    ok: false,
    retryable
  };
}

async function validateCodexAttachmentsBeforeDelivery(attachments, sessionId = "", input = {}) {
  const attachmentIds = codexAttachmentIds(input);
  if (attachmentIds.length < 1) {
    return null;
  }
  if (typeof attachments.renewAttachments !== "function") {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_unavailable",
      "Attachments are temporarily unavailable. Try sending again.",
      true
    );
  }
  let renewal;
  try {
    renewal = await attachments.renewAttachments(sessionId, attachmentIds);
  } catch (error) {
    vibe64SessionDebugLog("server.codexAttachments.deliveryValidation.error", {
      attachmentCount: attachmentIds.length,
      error: vibe64SessionDebugError(error),
      sessionId
    });
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_unavailable",
      "Attachments are temporarily unavailable. Try sending again.",
      true
    );
  }
  if (renewal?.ok === false) {
    return codexAttachmentDeliveryFailure(
      normalizeText(renewal?.code) || "vibe64_agent_attachment_unavailable",
      normalizeText(renewal?.error) || "Attachments are temporarily unavailable. Try sending again.",
      renewal?.retryable !== false
    );
  }

  const expectedIds = new Set(attachmentIds);
  const busyIds = new Set((Array.isArray(renewal?.busy) ? renewal.busy : [])
    .map(normalizeText)
    .filter((attachmentId) => expectedIds.has(attachmentId)));
  const missingIds = new Set((Array.isArray(renewal?.missing) ? renewal.missing : [])
    .map(normalizeText)
    .filter((attachmentId) => expectedIds.has(attachmentId)));
  const retainedIds = new Set((Array.isArray(renewal?.retained) ? renewal.retained : [])
    .map(normalizeText)
    .filter((attachmentId) => expectedIds.has(attachmentId)));
  if (missingIds.size > 0) {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_missing",
      "One or more attachments are no longer available. Remove and upload them again.",
      false
    );
  }
  if (busyIds.size > 0) {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_busy",
      "One or more attachments are still being prepared. Try sending again.",
      true
    );
  }
  if ([...expectedIds].some((attachmentId) => !retainedIds.has(attachmentId))) {
    return codexAttachmentDeliveryFailure(
      "vibe64_agent_attachment_unavailable",
      "Attachments could not be verified. Try sending again.",
      true
    );
  }
  return null;
}

async function renewAcceptedCodexAttachments(attachments, sessionId = "", input = {}, accepted = false) {
  const attachmentIds = codexAttachmentIds(input);
  if (!accepted || attachmentIds.length < 1 || typeof attachments.renewAttachments !== "function") {
    return;
  }
  // Delivery cannot be rolled back after the provider or PTY has accepted it.
  // Retrying only the lease operation cannot submit the human turn twice.
  let pendingIds = attachmentIds;
  let lastRenewal = null;
  for (const retryDelayMs of [0, 100, 250]) {
    if (retryDelayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
    }
    let renewal;
    try {
      renewal = await attachments.renewAttachments(sessionId, pendingIds);
    } catch (error) {
      vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.error", {
        attachmentCount: pendingIds.length,
        error: vibe64SessionDebugError(error),
        sessionId
      });
      scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds);
      return lastRenewal;
    }
    lastRenewal = renewal;
    if (renewal?.ok === false) {
      scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds);
      return renewal;
    }
    const busy = Array.isArray(renewal?.busy)
      ? renewal.busy.map(normalizeText).filter(Boolean)
      : [];
    if (busy.length < 1) {
      return renewal;
    }
    pendingIds = busy;
  }
  scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds);
  return lastRenewal;
}

function acceptedCodexAttachmentRenewalTimerMap(attachments) {
  let timers = acceptedAttachmentRenewalTimers.get(attachments);
  if (!timers) {
    timers = new Map();
    acceptedAttachmentRenewalTimers.set(attachments, timers);
  }
  return timers;
}

function scheduleAcceptedCodexAttachmentRenewal(
  attachments,
  sessionId,
  attachmentIds,
  attempt = 0
) {
  const pendingIds = [...new Set((Array.isArray(attachmentIds) ? attachmentIds : [])
    .map(normalizeText)
    .filter(Boolean))];
  if (pendingIds.length < 1) {
    return;
  }
  if (attempt >= CODEX_ATTACHMENT_RENEW_RETRY_DELAYS_MS.length) {
    vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.exhausted", {
      attachmentCount: pendingIds.length,
      sessionId
    });
    return;
  }
  const timerKey = `${normalizeText(sessionId)}:${[...pendingIds].sort().join(",")}`;
  const timers = acceptedCodexAttachmentRenewalTimerMap(attachments);
  const existingTimer = timers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    if (timers.get(timerKey) !== timer) {
      return;
    }
    timers.delete(timerKey);
    void Promise.resolve().then(() => (
      attachments.renewAttachments(sessionId, pendingIds)
    )).then((renewal) => {
      const busy = Array.isArray(renewal?.busy)
        ? renewal.busy.map(normalizeText).filter(Boolean)
        : [];
      if (renewal?.ok === false) {
        scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds, attempt + 1);
        return;
      }
      if (busy.length > 0) {
        scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, busy, attempt + 1);
        return;
      }
      const missing = Array.isArray(renewal?.missing)
        ? renewal.missing.map(normalizeText).filter(Boolean)
        : [];
      if (missing.length > 0) {
        vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.missing", {
          attachmentCount: missing.length,
          sessionId
        });
      }
    }).catch((error) => {
      vibe64SessionDebugLog("server.codexAttachments.acceptedRenewal.error", {
        attachmentCount: pendingIds.length,
        error: vibe64SessionDebugError(error),
        sessionId
      });
      scheduleAcceptedCodexAttachmentRenewal(attachments, sessionId, pendingIds, attempt + 1);
    });
  }, CODEX_ATTACHMENT_RENEW_RETRY_DELAYS_MS[attempt]);
  timer.unref?.();
  timers.set(timerKey, timer);
}

function codexAttachmentLimitResult(input = {}) {
  const attachmentIds = codexAttachmentIds(input);
  if (attachmentIds.length <= CODEX_ATTACHMENT_MAX_ITEMS) {
    return null;
  }
  return {
    code: "vibe64_agent_attachment_limit_exceeded",
    error: `A message can include at most ${CODEX_ATTACHMENT_MAX_ITEMS} attachments.`,
    ok: false
  };
}

function emitCodexExecutionProfile(context = {}, executionProfile = null) {
  if (!executionProfile) {
    return null;
  }
  const snapshot = vibe64AgentExecutionProfileAuditSnapshot(executionProfile);
  if (typeof context.onEvent === "function") {
    context.onEvent({
      executionProfile: snapshot,
      type: "execution-profile"
    });
  }
  return snapshot;
}


function createCodexSessionAgentProvider({
  connectionStatus = async () => true,
  runNativeDetachedConversation,
  listConnections = async () => [],
  runOwner: codexAppServerRunOwner,
  providerOwner: codexAppServerProviderOwner,
  conversationPreparation: codexConversationPreparation,
  lifecyclePreparation: codexLifecyclePreparation = {},
  helperPreparation: codexHelperPreparation = {},
  renewalPreparation = {},
  sessionRuntimeHost = {},
  storage: codexConversationStorage,
  catalog: codexAssistantCatalog,
  terminals,
  attachments,
  enabled: codexAppServerPromptDeliveryEnabled = true,
  env = process.env,
  publishSessionChanged,
  checkpoint: checkpointCodexAppServerTurn
} = {}) {
  if (!codexAssistantCatalog) {
    throw new TypeError("Codex session agent provider requires its catalogue facility.");
  }
  const { createRuntimeForSession } = sessionRuntimeHost;
  const { restoration: prepareCodexAppServerHelperRestoration } = codexHelperPreparation;
  const { prepareCodexRenewalHandover, prepareCodexRenewalSeed, prepareRenewalProcessExitProof } = renewalPreparation;
  const { prepareNativeStorageProvider, prepareCodexAppServerThreadUnsubscription,
    codexAppServerReconciliationPreparation, prepareCodexSessionCleanup,
    prepareCodexProjectCleanup } = codexLifecyclePreparation;
  const nativeSessionResult = result => Object.hasOwn(result, "session")
    ? withCodexState(result.value, result.session) : result.value;

  return Object.freeze({
    executionProfiles: Object.freeze([
      VIBE64_AGENT_EXECUTION_PROFILE_IDS.HELPER
    ]),
    id: CODEX_PRODUCT_PROVIDER_ID,
    transportId: CODEX_APP_SERVER_TRANSPORT_ID,
    prepareSelection: prepareCodexModelRouting,
    prepareConversationHost(sessionId, context = {}, mode = "main") {
      if (mode === "activity") return { native: { runOwner: codexAppServerRunOwner } };
      if (mode === "renewalProof") return {
        native: { providerOwner: codexAppServerProviderOwner, preparation: {
          predecessor(options) {
            const context = renewalArchivedPredecessorContext(sessionId, options);
            return prepareRenewalProcessExitProof(context.session);
          },
          successor(options) {
            const context = renewalSuccessorProcessExitProofReleaseContext(sessionId, options);
            return prepareRenewalProcessExitProof(context.session);
          }
        } }
      };
      if (mode === "renewal") return {
        native: { runOwner: codexAppServerRunOwner, preparation: {
          handover: (input, current) => prepareCodexRenewalHandover(sessionId, input, current),
          seed: (input, current) => prepareCodexRenewalSeed(sessionId, input, current)
        } }
      };
      if (mode === "reconciliation") return {
        native: { runOwner: codexAppServerRunOwner, preparation: codexAppServerReconciliationPreparation() }
      };
      if (mode === "unsubscription") return {
        native: { runOwner: codexAppServerRunOwner, preparation: {
          get enabled() { return codexAppServerPromptDeliveryEnabled; },
          get disabledResult() { return codexAppServerControlDisabledResult(); },
          session: prepareCodexAppServerThreadUnsubscription,
          failureMessage: "Vibe64 Codex app-server thread unsubscribe failed.",
          cleanupFailureMessage: "Vibe64 Codex app-server provider cleanup failed."
        } }
      };
      if (mode === "invalidation") return {
        native: { runOwner: codexAppServerRunOwner, preparation: {
        get enabled() { return codexAppServerPromptDeliveryEnabled; },
        get disabledResult() { return codexAppServerControlDisabledResult(); },
        get helpers() {
          return (async () => {
            const runtime = await createRuntimeForSession();
            return prepareCodexAppServerHelperRestoration({ runtime });
          })();
        }
        } }
      };
      if (mode === "detached" || mode === "detachedCleanup") return { native: { runOwner: codexAppServerRunOwner } };
      if (mode === "storage") return {
        native: { providerOwner: codexAppServerProviderOwner, errorPrefix: "vibe64_",
          preparation: { storage: prepareNativeStorageProvider } }
      };
      if (mode === "projectCleanup") return {
        native: { runOwner: codexAppServerRunOwner, preparation: { projectCleanup: prepareCodexProjectCleanup } }
      };
      return (async () => {
        if (mode === "readiness") return {
          native: { runOwner: codexAppServerRunOwner, preparation: { readiness: () => codexConversationPreparation.readiness(sessionId) } }
        };
        if (mode === "scoped" || mode === "create" || mode === "dispose") return {
          ...(mode === "dispose" ? { cleanupOptions: {
            ...(context.assistantScope ? { assistantScope: context.assistantScope } : {}),
            changeover: context.changeover === true,
            preserveProcessExitProof: context.preserveProcessExitProof === true,
            renewalCleanup: context.renewalCleanup,
            runtime: context.runtime,
            session: context.session
          } } : {}),
          namespace: codexTerminalNamespace(sessionId),
          native: { runOwner: codexAppServerRunOwner, providerOwner: codexAppServerProviderOwner,
            namespace: codexTerminalNamespace(sessionId),
            preparation: { cleanup: options => prepareCodexSessionCleanup(sessionId, options) } }
        };
        const { runtime } = context;
        const session = context.session || await codexConversationStorage.readSession(sessionId);
        const messagePreparation = codexConversationPreparation.message(sessionId);
        return {
          context: { runtime, session }, namespace: codexTerminalNamespace(sessionId),
          messageEnvironment: env,
          publish: publishSessionChanged, checkpoint: checkpointCodexAppServerTurn,
          state: codexConversationStorage.state(sessionId),
          native: {
            runOwner: codexAppServerRunOwner, providerOwner: codexAppServerProviderOwner,
            admission: () => beginTerminalNamespaceOperation(codexTerminalNamespace(sessionId)),
            messagePreparation,
            controlPreparation: (options, input) => codexConversationPreparation.control(sessionId, options, input),
            readGoalContext: options => codexConversationPreparation.readGoal(sessionId, options),
            goalPreparation: {
              readiness: operation => codexConversationPreparation.threadReadiness(sessionId, {}, operation),
              project: (context, options) => codexConversationPreparation.goalContext(sessionId, context, options)
            },
            inspectionPreparation: (input, options) => codexConversationPreparation.inspection(sessionId, input, options),
            namespace: codexTerminalNamespace(sessionId),
            preparation: { cleanup: options => prepareCodexSessionCleanup(sessionId, { ...options, runtime }) }
          }
        };
      })();
    },
    conversationOperations: Object.freeze(["createConversation", "ensureSession", "sendMessage", "sessionState", "inspectMessageAdmission", "interruptTurn", "readGoal", "updateGoal", "readConversation", "startConversationTurn", "waitForConversationTurn", "stopConversation", "deleteConversation", "closeSession", "closeProject", "invalidateRuntimes", "reconcileSessions", "unsubscribeSessions", "generateSessionRenewalHandover", "seedSessionRenewalHandover", "releaseRenewalPredecessorProcessExitProof", "releaseRenewalSuccessorProcessExitProof", "interruptDetachedChatTurn", "deleteDetachedChatThread", "listNativeConversationStorage", "retireConversationHistory", "hasActiveTemporaryConversation"]),
    prepareConversationRequest(method, context, input = {}) {
      if (method === "releaseRenewalPredecessorProcessExitProof") return { context: {
        renewalId: input.renewalId,
        runtime: context.runtime,
        session: context.session
      } };
      if (method === "releaseRenewalSuccessorProcessExitProof") return { context: {
        authorization: input.authorization,
        renewalId: input.renewalId,
        runtime: context.runtime,
        session: context.session
      } };
      if (method === "generateSessionRenewalHandover" || method === "seedSessionRenewalHandover") return {
        input: { ...input, agentSettings: codexAssistantSettings(context, input),
          vibe64User: input.vibe64User || context.vibe64User || null },
        context: { runtime: context.runtime, session: context.session }
      };
      if (method === "interruptDetachedChatTurn" || method === "deleteDetachedChatThread") return {
        input, context: { runtime: context.runtime, session: context.session }
      };
      if (method === "ensureSession") return { context: {} };
      if (method === "createConversation") return {
        input: { ...input, agentSettings: codexAssistantSettings(context, input) },
        context: { assistantScope: context.assistantScope, runtime: context.runtime, session: context.session }
      };
      if (method === "closeSession") return {
        namespace: codexTerminalNamespace(context.sessionId), sessionId: context.sessionId, context,
        options: {
          changeover: context.changeover === true,
          forgetConversationBinding: context.forgetConversationBinding === true,
          preserveProcessExitProof: context.preserveProcessExitProof === true,
          renewalCleanup: context.renewalCleanup,
          session: context.session
        }
      };
      if (["readConversation", "startConversationTurn", "waitForConversationTurn", "stopConversation", "deleteConversation"].includes(method)) {
        const message = method === "startConversationTurn" ? {
          ...input,
          agentSettings: codexAssistantSettings(context, input),
          vibe64User: input.vibe64User || context.vibe64User || null
        } : null;
        return {
          scopedConversationId: normalizeText(input.conversationId) ? input.conversationId : undefined,
          get input() { return message || { ...input, agentSettings: codexAssistantSettings(context, input) }; }
        };
      }
      if (method === "sessionState" || method === "readGoal") return {};
      if (method !== "sendMessage") return { input };
      const message = input && typeof input === "object" && !Array.isArray(input)
        ? {
            ...input,
            agentSettings: codexAssistantSettings(context, input),
            vibe64User: input.vibe64User || context.vibe64User || null
          }
        : {
            agentSettings: codexAssistantSettings(context),
            message: input,
            vibe64User: context.vibe64User || null
          };
      return { input: message, async prepareInput(input) {
        const prepared = { ...message, ...input };
        return context.prepareMessage ? context.prepareMessage(prepared) : prepared;
      } };
    },
    async projectConversationResult(method, perform) {
      if (method === "hasActiveTemporaryConversation") return { active: await perform(), ok: true };
      if (method === "invalidateRuntimes") {
        const operation = perform();
        return vibe64Result(() => operation);
      }
      if (method === "readGoal" || method === "updateGoal") return perform();
      if (["inspectMessageAdmission", "closeProject", "reconcileSessions", "unsubscribeSessions",
        "generateSessionRenewalHandover", "seedSessionRenewalHandover"].includes(method)) return vibe64Result(perform);
      return normalizeCodexSessionResult(await vibe64Result(async () => {
        const result = await perform();
        return method === "sendMessage" || method === "interruptTurn" ? nativeSessionResult(result) : result;
      }));
    },
    async runDetachedChatTurn(context, input = {}) {
      const executionProfile = emitCodexExecutionProfile(context, input.executionProfile);
      const result = await runNativeDetachedConversation({
        id: context.sessionId,
        context,
        input: { ...input, vibe64User: input.vibe64User || context.vibe64User || null },
        options: {
          ...(typeof context.onEvent === "function" ? { onEvent: context.onEvent } : {}),
          runtime: context.runtime,
          session: context.session
        }
      });
      return executionProfile ? { ...result, executionProfile } : result;
    },
    async streamDetachedChatTurn(context, input = {}) {
      const executionProfile = emitCodexExecutionProfile(context, input.executionProfile);
      const result = await runNativeDetachedConversation({
        id: context.sessionId,
        context,
        input: { ...input, vibe64User: input.vibe64User || context.vibe64User || null },
        options: { onEvent: context.onEvent, runtime: context.runtime, session: context.session }
      });
      return executionProfile ? { ...result, executionProfile } : result;
    },
    async capabilities(context = {}, input = {}) {
      const connected = (await connectionStatus(context)) !== false;
      const configuredOnly = normalizeText(input.configuredOnly).toLowerCase() === "true";
      // A provider filter must not change the catalogue revision used by Apply.
      const catalog = connected && !configuredOnly
        ? await codexAssistantCatalog.modelCatalog({ signal: context.signal })
        : codexConfiguredModelCatalog(
            connected, VIBE64_CODEX_DEFAULT_MODEL, VIBE64_CODEX_DEFAULT_THINKING
          );
      return codexAssistantCapabilities(connected, catalog, await listConnections());
    },
    async releaseRenewalPredecessorAttachments(context, input = {}) {
      return codexLifecyclePreparation.releaseRenewalPredecessorAttachments(context.sessionId, {
        renewalId: input.renewalId,
        runtime: context.runtime,
        session: context.session
      });
    },
    async closeTerminal(context, input = {}) {
      return terminals.closeTerminal(context.sessionId, input.terminalSessionId);
    },
    async describeProvider(context) {
      if (typeof codexAssistantCatalog.describeProvider !== "function") {
        throw new TypeError("Codex provider account description is unavailable.");
      }
      return codexAssistantCatalog.describeProvider(context.sessionId, {
        runtime: context.runtime,
        session: context.session
      });
    },
    readPlanUsage(context) {
      return codexAssistantCatalog.readPlanUsage(context.sessionId, { runtime: context.runtime, session: context.session });
    },
    async resolveExecutionProfile(context, input = {}) {
      if (typeof codexAssistantCatalog.executionProfileModelCatalog !== "function") {
        throw codexExecutionProfileError(
          VIBE64_AGENT_EXECUTION_PROFILE_ERROR_CODES.POLICY_UNENFORCEABLE,
          "Codex helper model discovery is unavailable."
        );
      }
      const {
        executionProfile,
        limits
      } = codexHelperExecutionProfileRequest(input);
      const helperModelId = context.assistantSelection?.modelId;
      return resolveCodexHelperExecutionProfile(
        executionProfile,
        await codexAssistantCatalog.executionProfileModelCatalog(context.sessionId, {
          ...(context.assistantScope ? { assistantScope: context.assistantScope,
            agentSettings: codexAssistantSettings(context) } : {}),
          runtime: context.runtime,
          session: context.session,
          signal: context.signal,
          timeoutMs: limits.timeoutMs
        }),
        helperModelId,
        context.assistantSelection?.variantId || ""
      );
    },
    async readTerminal(context, input = {}) {
      return terminals.readTerminal(context.sessionId, input.terminalSessionId);
    },
    async resizeTerminal(context, input = {}) {
      return terminals.resizeTerminal(context.sessionId, input.terminalSessionId, input.size);
    },
    async startTerminal(context, input = {}) {
      return vibe64Result(async () => {
        if (!codexAppServerPromptDeliveryEnabled) {
          return codexConversationPreparation.disabledFailure(context.sessionId);
        }
        return terminals.startTerminal(context.sessionId, input);
      });
    },
    async subscribeTerminal(context, input = {}) {
      return terminals.subscribeTerminal(context.sessionId, input.terminalSessionId, input.subscriber);
    },
    async writeTerminal(context, input = {}) {
      const terminalInput = {
        ...input.input,
        vibe64User: input.input?.vibe64User || context.vibe64User || null
      };
      const attachmentLimit = codexAttachmentLimitResult(terminalInput);
      if (attachmentLimit) {
        return attachmentLimit;
      }
      const attachmentValidation = await validateCodexAttachmentsBeforeDelivery(
        attachments,
        context.sessionId,
        terminalInput
      );
      if (attachmentValidation) {
        return attachmentValidation;
      }
      const result = await terminals.writeTerminal(
        context.sessionId,
        input.terminalSessionId,
        input.data,
        terminalInput
      );
      await renewAcceptedCodexAttachments(
        attachments,
        context.sessionId,
        terminalInput,
        result?.ok === true
      );
      return result;
    }
  });
}

export {
  CODEX_APP_SERVER_TRANSPORT_ID,
  CODEX_ATTACHMENT_MAX_ITEMS,
  CODEX_HELPER_PROFILE_REVISION,
  CODEX_HELPER_WORKLOAD_LIMITS,
  CODEX_PRODUCT_PROVIDER_ID,
  createCodexSessionAgentProvider,
  resolveCodexHelperExecutionProfile
};
