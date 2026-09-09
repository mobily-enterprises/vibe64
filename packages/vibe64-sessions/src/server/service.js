import crypto from "node:crypto";

import { vibe64Result } from "@local/vibe64-core/server/serverResponses";
import {
  currentProjectRequestContext,
  currentProjectVibe64User
} from "@local/vibe64-core/server/projectRequestContext";
import {
  writeSessionUiSyncPreviewState
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  vibe64SessionStatusIsOpen
} from "@local/vibe64-runtime/server/sessionStore";
import {
  runVibe64AgentWriteExclusive
} from "@local/vibe64-runtime/server/agentWriteLock";
import {
  VIBE64_ASSISTANT_ENGINE_IDS,
  VIBE64_ASSISTANT_SELECTION_METADATA,
  VIBE64_CODEX_DEFAULT_MODEL,
  VIBE64_CODEX_DEFAULT_THINKING,
  assertVibe64AssistantSelectionUpdate,
  defineVibe64AssistantSelection,
  serializeVibe64AssistantSelection,
  vibe64AssistantSelectionFromMetadata
} from "@local/vibe64-runtime/shared";
import {
  REPOSITORY_UPDATE_RELATIONSHIPS,
  normalizeRepositoryUpdateCheck
} from "@local/vibe64-core/shared";
import {
  sessionContextUsageFromMetadata,
  sessionRenewalAdvisory
} from "./sessionRenewalAdvisory.js";
import { createSessionRenewalController } from "./sessionRenewal.js";
import { presenceActor } from "./sessionPresence.js";
import {
  appendSuggestion,
  assertSuggestionSubmissionAllowed,
  newSessionMessageSuggestion,
  readSessionMessageSuggestionState,
  replaceSuggestion,
  strictSuggestion,
  suggestionById,
  suggestionError,
  writeSessionMessageSuggestionState
} from "./sessionMessageSuggestions.js";

function text(value = "") {
  return String(value || "").trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const REPOSITORY_UPDATE_CHECK_METADATA = "repository_update_check";
const REPOSITORY_UPDATE_CHECK_CACHE_MS = 25_000;
function repositoryUpdateCheckIsFresh(value = {}, now = Date.now()) {
  const checkedAt = Date.parse(text(value?.checkedAt));
  return Number.isFinite(checkedAt) && now - checkedAt >= 0 &&
    now - checkedAt < REPOSITORY_UPDATE_CHECK_CACHE_MS;
}

function cachedRepositoryUpdateCheck(session = {}) {
  const raw = text(session?.metadata?.[REPOSITORY_UPDATE_CHECK_METADATA]);
  if (!raw) {
    return null;
  }
  try {
    const parsed = record(JSON.parse(raw));
    const checkedAt = text(parsed.checkedAt);
    const relationship = text(parsed.relationship);
    if (
      !checkedAt ||
      !Number.isFinite(Date.parse(checkedAt)) ||
      !REPOSITORY_UPDATE_RELATIONSHIPS.has(relationship) ||
      (Number(parsed.behind || 0) > 0 && !Array.isArray(parsed.incomingVersions)) ||
      (
        text(session?.metadata?.canonical_commit) &&
        text(parsed.canonicalCommit) !== text(session.metadata.canonical_commit)
      )
    ) {
      return null;
    }
    const normalized = normalizeRepositoryUpdateCheck(parsed, checkedAt);
    return normalized.relationship === relationship ? normalized : null;
  } catch {
    return null;
  }
}

async function persistRepositoryUpdateCheck(runtime, sessionId, result = {}) {
  const status = normalizeRepositoryUpdateCheck(result);
  await runtime.store.writeMetadataValue(
    sessionId,
    REPOSITORY_UPDATE_CHECK_METADATA,
    JSON.stringify(status)
  );
  return status;
}

function sessionResult(operation, fallbackMessage = "Vibe64 session request failed.") {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_session_request_failed",
    fallbackMessage
  });
}

function requiredRepositorySessionId(value = "") {
  const sessionId = text(value);
  if (!sessionId) {
    const error = new Error("Select a session before opening its repository history.");
    error.code = "vibe64_repository_history_session_required";
    throw error;
  }
  return sessionId;
}

function conversationPageOptions(options = {}) {
  const limit = Number.parseInt(String(options.limit || ""), 10);
  return {
    beforeTurnId: text(options.beforeTurnId),
    limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 50
  };
}

function conversationPage(result = {}, options = {}) {
  if (Array.isArray(result)) {
    return {
      conversationLog: result,
      pagination: {
        beforeTurnId: options.beforeTurnId,
        hasMoreBefore: false,
        limit: options.limit,
        nextBeforeTurnId: ""
      }
    };
  }
  return {
    conversationLog: Array.isArray(result.conversationLog) ? result.conversationLog : [],
    pagination: record(result.pagination)
  };
}

function messageText(input = {}) {
  return text(input.message);
}

function sessionRuntimeOptions(terminals) {
  const createSessionSource = typeof terminals?.createSessionSource === "function"
    ? (context) => terminals.createSessionSource(context)
    : null;
  return createSessionSource ? { createSessionSource } : {};
}

function publicSession(session = {}, extra = {}) {
  return {
    ...session,
    ...extra,
    ok: true
  };
}

function sessionCreationLimitError(policy = {}) {
  const error = new Error(
    text(policy?.creation?.disabledReason) || "No more sessions can be created for this project."
  );
  error.code = "vibe64_session_creation_limit";
  error.details = {
    maxOpenSessions: Number(policy?.limits?.maxOpenSessions || 0),
    openSessionCount: Number(policy?.limits?.openSessionCount || 0)
  };
  error.statusCode = 409;
  return error;
}

function renewalActorResolverUnavailableError() {
  const error = new Error(
    "The current Vibe64 host cannot restore the user identity required to continue this session renewal."
  );
  error.code = "vibe64_session_renewal_actor_resolver_unavailable";
  error.retryable = true;
  error.statusCode = 409;
  return error;
}

function assertRenewalActorResolver(resolver = null) {
  if (resolver !== null && typeof resolver !== "function") {
    throw new TypeError("Vibe64 session renewal actor resolver must be a function or null.");
  }
  return resolver;
}

const SESSION_SAVE_TASK_ID = "save-work";
const SESSION_UPDATE_TASK_ID = "update-session";
const LEGACY_CODEX_CATALOG_REVISION =
  "sha256:cd4f63e20cf4c9a130dc9581a295517e1273bc501b166d9d4a0ba8e6bec54729";

function legacyCodexAssistantSelection() {
  return defineVibe64AssistantSelection({
    agentId: "codex",
    catalogRevision: LEGACY_CODEX_CATALOG_REVISION,
    engineId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX,
    modelId: VIBE64_CODEX_DEFAULT_MODEL,
    modelProviderId: "openai",
    variantId: VIBE64_CODEX_DEFAULT_THINKING
  });
}

function createService({
  project,
  publishSessionChanged = async () => null,
  renewalActorResolver = null,
  sessionPresence = null,
  terminals,
  workspaceSetupRunner = null
} = {}) {
  if (!project) {
    throw new TypeError("createService requires vibe64.project.");
  }
  if (!terminals) {
    throw new TypeError("createService requires vibe64.terminals.");
  }
  if (
    sessionPresence !== null &&
    (
      typeof sessionPresence?.update !== "function" ||
      typeof sessionPresence?.close !== "function"
    )
  ) {
    throw new TypeError("Vibe64 session presence requires update() and close().");
  }
  assertRenewalActorResolver(renewalActorResolver);
  const setupRunner = workspaceSetupRunner || Object.freeze({
    isRunning: (sessionId) => typeof terminals.workspaceSetupIsRunning === "function" &&
      terminals.workspaceSetupIsRunning(sessionId),
    start: ({ retry = false, runtime, session }) => terminals.prepareWorkspaceSetup(
      session.sessionId,
      { retry, runtime, session }
    ),
    startRenewal: ({ retry = false, runtime, session }) => terminals.prepareRenewalWorkspaceSetup(
      session.sessionId,
      { retry, runtime, session }
    ),
    wait: (sessionId) => typeof terminals.waitForWorkspaceSetup === "function"
      ? terminals.waitForWorkspaceSetup(sessionId)
      : null
  });
  const activeSaveOperations = new Map();
  const activeUpdateOperations = new Map();
  const activeRepositoryUpdateChecks = new Map();
  const activeSuggestionDeliveries = new Map();
  let configuredRenewalActorResolver = renewalActorResolver;
  async function resolveRenewalActor(actor = {}, context = {}) {
    if (typeof configuredRenewalActorResolver !== "function") {
      throw renewalActorResolverUnavailableError();
    }
    return configuredRenewalActorResolver(actor, context);
  }

  function trustedAssistantUser(input = {}) {
    return currentProjectVibe64User() || input.vibe64User || null;
  }

  async function publishSuggestionChanged(sessionId, suggestion, reason, originId = "") {
    await publishSessionChanged(sessionId, {
      originId: text(originId),
      payload: {
        messageSuggestionPatch: {
          suggestion,
          type: "upsert"
        }
      },
      reason,
      session: null
    });
  }

  async function pinSuggestionAttachments(terminalsContext, suggestion) {
    if (suggestion.attachmentIds.length < 1) {
      return;
    }
    if (
      typeof terminals.pinAgentAttachments !== "function" ||
      typeof terminals.unpinAgentAttachments !== "function"
    ) {
      throw suggestionError(
        "vibe64_message_suggestion_attachment_unavailable",
        "Attachments cannot be retained for owner approval.",
        503
      );
    }
    const result = await terminals.pinAgentAttachments(
      terminalsContext.session.sessionId,
      {
        attachmentIds: suggestion.attachmentIds,
        suggestionId: suggestion.id
      },
      terminalsContext
    );
    const retained = new Set(Array.isArray(result?.retained) ? result.retained.map(text) : []);
    const failed = (
      result?.ok === false ||
      Array.isArray(result?.missing) && result.missing.length > 0 ||
      Array.isArray(result?.busy) && result.busy.length > 0 ||
      suggestion.attachmentIds.some((id) => !retained.has(id))
    );
    if (failed) {
      if (retained.size > 0) {
        await unpinSuggestionAttachments(terminalsContext, {
          ...suggestion,
          attachmentIds: [...retained]
        }).catch((error) => {
          vibe64SessionDebugLog("server.sessions.messageSuggestion.pinRollback.error", {
            error: vibe64SessionDebugError(error),
            sessionId: terminalsContext.session.sessionId,
            suggestionId: suggestion.id
          });
        });
      }
      throw suggestionError(
        text(result?.code) || "vibe64_message_suggestion_attachment_unavailable",
        text(result?.error) || "One or more attachments could not be retained for owner approval.",
        409
      );
    }
  }

  async function unpinSuggestionAttachments(terminalsContext, suggestion) {
    if (
      suggestion.attachmentIds.length < 1 ||
      typeof terminals.unpinAgentAttachments !== "function"
    ) {
      return;
    }
    await terminals.unpinAgentAttachments(
      terminalsContext.session.sessionId,
      {
        attachmentIds: suggestion.attachmentIds,
        suggestionId: suggestion.id
      },
      terminalsContext
    );
  }
  const renewal = createSessionRenewalController({
    project,
    publishSessionChanged,
    resolveRenewalActor,
    resolveSuccessorAssistantSelection,
    setupRunner,
    terminals
  });

  async function resolveAssistantSelection(input = {}, vibe64User = null, {
    configuredOnly = false
  } = {}) {
    const requested = record(input);
    if (typeof terminals.resolveAssistantSelection === "function") {
      const selection = Object.keys(requested).length > 0
        ? requested
        : { engineId: VIBE64_ASSISTANT_ENGINE_IDS.CODEX };
      return defineVibe64AssistantSelection(await terminals.resolveAssistantSelection(
        configuredOnly ? { ...selection, configuredOnly: "true" } : selection,
        { vibe64User }
      ));
    }
    if (Object.keys(requested).length > 0) {
      throw new TypeError("This Vibe64 host cannot resolve assistant selections.");
    }
    return legacyCodexAssistantSelection();
  }

  async function resolveSuccessorAssistantSelection(input = {}, {
    session = null,
    vibe64User = null
  } = {}) {
    const requested = record(input);
    const explicitlySelected = Object.keys(requested).length > 0;
    const current = explicitlySelected
      ? requested
      : vibe64AssistantSelectionFromMetadata(session?.metadata);
    const selection = await resolveAssistantSelection(
      explicitlySelected
        ? current
        : {
            agentId: current.agentId,
            engineId: current.engineId,
            modelId: current.modelId,
            modelProviderId: current.modelProviderId,
            variantId: current.variantId
          },
      vibe64User
    );
    await terminals.requireAssistantSelectionAccess(selection, {
      vibe64User
    });
    return selection;
  }

  async function sessionsOccupyingPolicySlots(runtime, openSessions = null) {
    const visible = Array.isArray(openSessions)
      ? openSessions
      : await runtime.listSessionSummaries({ statusGroup: "open" });
    if (typeof runtime?.store?.listSessionsForRenewal !== "function") {
      return visible;
    }
    const visibleIds = new Set(visible.map((session) => text(session?.sessionId)).filter(Boolean));
    const reservations = [];
    const reservedRenewalIds = new Set();
    for (const session of await runtime.store.listSessionsForRenewal()) {
      const status = text(session?.status);
      if (!["renewal_pending", "renewal_quiesced"].includes(status)) {
        continue;
      }
      const renewalId = text(
        session.metadata?.renewal_id || session.metadata?.renewal_quiesced_id
      );
      const linkedSessionIds = [
        text(session.sessionId),
        text(session.metadata?.renewed_from),
        text(session.metadata?.renewed_to)
      ].filter(Boolean);
      if (
        !renewalId ||
        reservedRenewalIds.has(renewalId)
      ) {
        continue;
      }
      reservedRenewalIds.add(renewalId);
      if (linkedSessionIds.some((sessionId) => visibleIds.has(sessionId))) {
        continue;
      }
      reservations.push(session);
    }
    return [...visible, ...reservations];
  }

  async function publishCanonicalChanged(runtime, sourceSessionId, canonicalCommit, {
    originId = ""
  } = {}) {
    const sessions = typeof runtime.listSessionSummaries === "function"
      ? await runtime.listSessionSummaries({ statusGroup: "open" })
      : [];
    const deliveries = await Promise.allSettled(sessions.map(async (candidate) => {
      const candidateId = text(candidate?.sessionId);
      if (!candidateId || candidateId === sourceSessionId) {
        return;
      }
      await runtime.store.writeMetadataValue(
        candidateId,
        "canonical_commit",
        canonicalCommit
      );
      await publishSessionChanged(candidateId, {
        operation: "updated",
        originId: text(originId),
        payload: {
          canonicalCommit,
          sourceSessionId
        },
        reason: "repository-canonical-changed",
        session: candidate
      });
    }));
    deliveries.forEach((delivery, index) => {
      if (delivery.status === "rejected") {
        vibe64SessionDebugLog("server.sessions.repositoryCanonicalChanged.publish.error", {
          error: vibe64SessionDebugError(delivery.reason),
          sessionId: text(sessions[index]?.sessionId),
          sourceSessionId
        });
      }
    });
  }

  function observeWorkspaceSetup(sessionId, completion, {
    originId = ""
  } = {}) {
    if (!completion || typeof completion.then !== "function") {
      return;
    }
    void completion.then(async (workspaceSetup) => {
      const runtime = await project.createRuntime({
        inspectSource: false
      });
      await publishSessionChanged(sessionId, {
        operation: "updated",
        originId: text(originId),
        reason: "workspace-setup-completed",
        session: await runtime.getSession(sessionId, {
          inspectSource: false
        }),
        workspaceSetup
      });
    }).catch((error) => {
      vibe64SessionDebugLog("server.sessions.workspaceSetup.publish.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
    });
  }

  async function recoverInterruptedSave(runtime, session, task) {
    if (task?.status !== "running" || typeof terminals.recoverSessionWorkSave !== "function") {
      return task;
    }
    if (activeSaveOperations.get(session.sessionId) === text(task.operationId)) {
      return task;
    }
    try {
      const result = await terminals.recoverSessionWorkSave(session.sessionId, {
        recovery: task,
        runtime,
        session
      });
      await runtime.store.writeMetadataValue(session.sessionId, "canonical_commit", result.saveCommit);
      if (result.reconciled === true) {
        await runtime.store.writeMetadataValue(session.sessionId, "base_commit", result.saveCommit);
      }
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_SAVE_TASK_ID, {
        event: {
          kind: "save-recovered",
          message: result.cacheMaintenance?.retryable === true
            ? "Interrupted Save recovered. The local clone cache could not be refreshed and will be retried later."
            : result.reconciled === true
              ? "Interrupted Save recovered and reconciled."
              : "Interrupted Save was published and needs local reconciliation.",
          status: "ready"
        },
        patch: {
          ...result,
          status: "ready"
        }
      });
    } catch (error) {
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_SAVE_TASK_ID, {
        event: {
          kind: "save-recovery-failed",
          message: text(error?.message) || "Interrupted Save needs attention.",
          status: "failed"
        },
        patch: {
          code: text(error?.code),
          error: text(error?.message) || "Interrupted Save needs attention.",
          retryable: error?.retryable === true,
          status: "failed"
        }
      });
    }
  }

  async function recoverInterruptedUpdate(runtime, session, task) {
    if (task?.status !== "running" || typeof terminals.recoverSessionWorkUpdate !== "function") {
      return task;
    }
    if (activeUpdateOperations.get(session.sessionId) === text(task.operationId)) {
      return task;
    }
    try {
      const result = await terminals.recoverSessionWorkUpdate(session.sessionId, {
        recovery: task,
        runtime,
        session
      });
      await runtime.store.writeMetadataValue(session.sessionId, "canonical_commit", result.canonicalCommit);
      if (result.reconciled === true) {
        await runtime.store.writeMetadataValue(session.sessionId, "base_commit", result.canonicalCommit);
      }
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_UPDATE_TASK_ID, {
        event: {
          kind: "update-recovered",
          message: "Interrupted session update recovered.",
          status: "ready"
        },
        patch: { ...result, status: "ready" }
      });
    } catch (error) {
      return runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_UPDATE_TASK_ID, {
        event: {
          kind: "update-recovery-failed",
          message: text(error?.message) || "Interrupted session update needs attention.",
          status: "failed"
        },
        patch: {
          code: text(error?.code),
          error: text(error?.message) || "Interrupted session update needs attention.",
          retryable: error?.retryable === true,
          status: "failed"
        }
      });
    }
  }

  async function resolveSupersededUpdateFailure(runtime, sessionId, saveResult = {}, options = {}) {
    if (
      saveResult?.reconciled !== true ||
      typeof runtime?.store?.readBackgroundTask !== "function"
    ) {
      return null;
    }
    const task = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
    if (task?.status !== "failed") {
      return task || null;
    }
    if (options.knownNewer !== true) {
      const saveUpdatedAt = Date.parse(text(saveResult.updatedAt));
      const updateUpdatedAt = Date.parse(text(task.updatedAt));
      if (
        !Number.isFinite(saveUpdatedAt) ||
        !Number.isFinite(updateUpdatedAt) ||
        saveUpdatedAt <= updateUpdatedAt
      ) {
        return task;
      }
    }
    return runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
      event: {
        kind: "update-superseded-by-save",
        message: "The repository issue was resolved by the completed Save.",
        status: "ready"
      },
      patch: {
        code: "",
        error: "",
        resolvedBySaveCommit: text(saveResult.saveCommit),
        retryable: false,
        status: "ready"
      }
    });
  }

  function publicAssistantAccess(access = {}) {
    return {
      accessLabel: text(access.accessLabel) || "Unavailable",
      available: access.available === true,
      canRequestMessage: access.canRequestMessage === true,
      canUse: access.canUse === true,
      endpointCode: text(access.endpointCode),
      engineId: text(access.engineId),
      modelProviderId: text(access.modelProviderId),
      ok: true,
      ownerOnly: access.ownerOnly === true,
      transportId: text(access.transportId)
    };
  }

  async function suggestionTerminalContext(runtime, sessionId, vibe64User) {
    const session = await runtime.getSession(sessionId, { inspectSource: false });
    return {
      runtime,
      session,
      vibe64User
    };
  }

  function requireSuggestionOwner(vibe64User = null) {
    if (vibe64User?.role !== "owner") {
      throw suggestionError(
        "vibe64_message_suggestion_owner_required",
        "Only the workspace owner can review message requests.",
        403
      );
    }
  }

  async function approveMessageSuggestion(sessionId, input = {}) {
    return sessionResult(async () => {
      const vibe64User = trustedAssistantUser(input);
      requireSuggestionOwner(vibe64User);
      const suggestionId = text(input.suggestionId);
      const key = `${text(sessionId)}:${suggestionId}`;
      const existing = activeSuggestionDeliveries.get(key);
      if (existing) {
        return existing;
      }
      const delivery = (async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const prepared = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const context = await suggestionTerminalContext(runtime, sessionId, vibe64User);
          await terminals.requireAssistantAccess(sessionId, context);
          const state = await readSessionMessageSuggestionState(runtime.store, sessionId);
          const current = suggestionById(state, suggestionId);
          if (current.status === "delivered") {
            return { alreadyDelivered: true, context, suggestion: current };
          }
          if (["discarded", "withdrawn"].includes(current.status)) {
            throw suggestionError(
              "vibe64_message_suggestion_not_pending",
              "Only a pending suggestion can be approved.",
              409
            );
          }
          const now = new Date().toISOString();
          const next = strictSuggestion({
            ...current,
            decidedAt: now,
            decidedBy: vibe64User,
            deliveryAttempts: current.deliveryAttempts + 1,
            lastDeliveryError: "",
            status: "delivering",
            updatedAt: now
          });
          await writeSessionMessageSuggestionState(
            runtime.store,
            sessionId,
            replaceSuggestion(state, next, now)
          );
          return { alreadyDelivered: false, context, suggestion: next };
        }, { operation: "approve-message-suggestion" });
        if (!prepared.acquired) {
          return prepared.value;
        }
        if (prepared.value.alreadyDelivered) {
          return { duplicate: true, ok: true, suggestion: prepared.value.suggestion };
        }
        const pending = prepared.value.suggestion;
        await publishSuggestionChanged(
          sessionId,
          pending,
          "session-message-suggestion-approval-started",
          input.originId
        );
        let result = null;
        let deliveryError = null;
        try {
          result = await terminals.sendAgentMessage(sessionId, {
            attachmentIds: pending.attachmentIds,
            ...(pending.displayAttachments?.length
              ? { displayAttachments: pending.displayAttachments }
              : {}),
            displayMessage: [
              `Suggested by ${pending.author.displayName} (${pending.author.username}); approved by ${pending.decidedBy.displayName} (${pending.decidedBy.username}).`,
              pending.displayMessage || pending.message
            ].join("\n\n"),
            message: pending.message,
            messageId: pending.providerMessageId,
            originId: input.originId,
            vibe64User
          }, {
            runtime,
            vibe64User
          });
        } catch (error) {
          deliveryError = error;
        }
        const delivered = !deliveryError && result?.ok !== false;
        const finalized = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const state = await readSessionMessageSuggestionState(runtime.store, sessionId);
          const current = suggestionById(state, suggestionId);
          if (current.status === "delivered") {
            return { context: prepared.value.context, suggestion: current };
          }
          const now = new Date().toISOString();
          const next = strictSuggestion({
            ...current,
            deliveredAt: delivered ? now : "",
            lastDeliveryError: delivered
              ? ""
              : text(deliveryError?.message || result?.error || "Assistant delivery failed."),
            status: delivered ? "delivered" : "pending",
            updatedAt: now
          });
          await writeSessionMessageSuggestionState(
            runtime.store,
            sessionId,
            replaceSuggestion(state, next, now)
          );
          return { context: prepared.value.context, suggestion: next };
        }, { operation: "finalize-message-suggestion" });
        if (!finalized.acquired) {
          if (deliveryError) {
            throw deliveryError;
          }
          return finalized.value;
        }
        if (delivered) {
          await unpinSuggestionAttachments(finalized.value.context, finalized.value.suggestion)
            .catch((error) => {
              vibe64SessionDebugLog("server.sessions.messageSuggestion.unpin.error", {
                error: vibe64SessionDebugError(error),
                sessionId,
                suggestionId
              });
            });
        }
        await publishSuggestionChanged(
          sessionId,
          finalized.value.suggestion,
          delivered
            ? "session-message-suggestion-delivered"
            : "session-message-suggestion-delivery-failed",
          input.originId
        );
        if (deliveryError) {
          throw deliveryError;
        }
        return {
          ...(result || {}),
          ok: delivered,
          suggestion: finalized.value.suggestion
        };
      })();
      activeSuggestionDeliveries.set(key, delivery);
      try {
        return await delivery;
      } finally {
        if (activeSuggestionDeliveries.get(key) === delivery) {
          activeSuggestionDeliveries.delete(key);
        }
      }
    }, "Vibe64 could not approve this message suggestion.");
  }

  return Object.freeze({
    ...renewal,
    closeSessionPresence() {
      sessionPresence?.close?.();
    },
    setRenewalActorResolver(resolver = null) {
      configuredRenewalActorResolver = assertRenewalActorResolver(resolver);
    },
    async inspectRepositoryHistory(input = {}) {
      return sessionResult(async () => {
        const sessionId = requiredRepositorySessionId(input.sessionId);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const history = await terminals.inspectRepositoryHistory({ ...input, session });
        const updateCheck = cachedRepositoryUpdateCheck(session);
        return {
          ...history,
          ...(updateCheck ? { updateCheck } : {})
        };
      }, "Vibe64 could not read project version history.");
    },

    async inspectRepositoryVersionFiles(input = {}) {
      return sessionResult(async () => {
        const sessionId = requiredRepositorySessionId(input.sessionId);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        return terminals.inspectRepositoryVersionFiles({ ...input, session });
      }, "Vibe64 could not read this project version.");
    },

    async inspectRepositoryVersionFileDiff(input = {}) {
      return sessionResult(async () => {
        const sessionId = requiredRepositorySessionId(input.sessionId);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        return terminals.inspectRepositoryVersionFileDiff({ ...input, session });
      }, "Vibe64 could not read this version's file change.");
    },

    async archiveSession(sessionId, input = {}) {
      return sessionResult(async () => {
        if (setupRunner.isRunning(sessionId)) {
          const error = new Error("Wait for workspace preparation to finish before archiving this session.");
          error.code = "vibe64_workspace_setup_running";
          throw error;
        }
        const runtime = await project.createRuntime();
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const currentSession = await runtime.getSession(sessionId, {
            inspectSource: false
          });
          const sourceCreationFailed = currentSession.sourceReady !== true &&
            text(currentSession.metadata?.source_creation_failed).toLowerCase() === "yes";
          await runtime.markSessionClosing(sessionId, {
            reason: "archived"
          });
          try {
            await terminals.closeSessionTerminals(sessionId);
            if (typeof terminals.removeOutputResultsForSession === "function") {
              await terminals.removeOutputResultsForSession(sessionId);
            }
            if (!sourceCreationFailed && typeof project.releaseSessionResources === "function") {
              await project.releaseSessionResources({
                sessionId
              });
            }
            return runtime.archiveSession(sessionId);
          } catch (error) {
            await runtime.clearSessionClosing(sessionId).catch(() => null);
            throw error;
          }
        }, { operation: "archive-session" });
        if (!exclusive.acquired) {
          return exclusive.value;
        }
        const session = exclusive.value;
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: text(input.originId),
          reason: "session-archived",
          session
        });
        return publicSession(session);
      }, "Vibe64 could not archive this session.");
    },

    async broadcastSessionPreviewState(sessionId, input = {}) {
      const preview = {
        originId: text(input.originId),
        projectSlug: text(input.projectSlug),
        route: text(input.route),
        sessionId: text(sessionId),
        title: text(input.title).slice(0, 256),
        updatedAt: new Date().toISOString()
      };
      if (!preview.sessionId || !preview.projectSlug || !preview.route || !preview.originId) {
        return {
          error: "Preview updates require a session, project, route, and origin.",
          ok: false
        };
      }
      writeSessionUiSyncPreviewState(preview);
      return {
        ok: true,
        preview
      };
    },

    async createSession(input = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const assistantSelection = await resolveAssistantSelection(
          input.assistantSelection,
          vibe64User,
          { configuredOnly: true }
        );
        await terminals.requireAssistantSelectionAccess(assistantSelection, {
          vibe64User
        });
        const runtime = await project.createRuntime(sessionRuntimeOptions(terminals));
        if (
          typeof project.developmentDatabasePolicy !== "function" ||
          typeof project.runProjectSessionPolicyExclusive !== "function"
        ) {
          throw new TypeError("Session creation requires the project session policy boundary.");
        }
        const created = await project.runProjectSessionPolicyExclusive(async () => {
          const visibleOpenSessions = await runtime.listSessionSummaries({
            statusGroup: "open"
          });
          const openSessions = await sessionsOccupyingPolicySlots(runtime, visibleOpenSessions);
          const policy = await project.developmentDatabasePolicy({ openSessions });
          if (policy?.creation?.canCreate !== true) {
            throw sessionCreationLimitError(policy);
          }
          const session = await runtime.createSession({
            metadata: {
              [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(
                assistantSelection
              ),
              created_by: text(vibe64User?.username || vibe64User?.name)
            },
            sourceContext: {
              vibe64User
            }
          });
          const updatedPolicy = await project.developmentDatabasePolicy({
            openSessions: [...openSessions, session]
          });
          return {
            session,
            updatedPolicy
          };
        }, {
          operation: "create-session"
        });
        let setup = null;
        try {
          setup = await setupRunner.start({
            retry: true,
            runtime,
            session: created.session
          });
        } catch (error) {
          vibe64SessionDebugLog("server.sessions.workspaceSetup.start.error", {
            error: vibe64SessionDebugError(error),
            sessionId: created.session.sessionId
          });
        }
        let currentSession = created.session;
        try {
          currentSession = await runtime.getSession(created.session.sessionId, {
            inspectSource: false
          }) || created.session;
        } catch (error) {
          vibe64SessionDebugLog("server.sessions.createSession.inspect.error", {
            error: vibe64SessionDebugError(error),
            sessionId: created.session.sessionId
          });
        }
        try {
          await publishSessionChanged(created.session.sessionId, {
            operation: "created",
            originId: text(input.originId),
            reason: "session-created",
            session: currentSession
          });
        } catch (error) {
          vibe64SessionDebugLog("server.sessions.createSession.publish.error", {
            error: vibe64SessionDebugError(error),
            sessionId: created.session.sessionId
          });
        }
        if (setup) {
          observeWorkspaceSetup(created.session.sessionId, setup.completion, {
            originId: input.originId
          });
        }
        return publicSession(currentSession, {
          creation: created.updatedPolicy.creation,
          limits: created.updatedPolicy.limits
        });
      }, "Vibe64 could not create a chat session.");
    },

    async inspectSession(sessionId) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime();
        const session = await runtime.getSession(sessionId);
        const [agentSession, conversation] = await Promise.all([
          typeof terminals.agentSessionState === "function"
            ? terminals.agentSessionState(sessionId, {
              runtime,
              session
            })
            : null,
          runtime.readConversationLogPage(sessionId, { limit: 1 })
        ]);
        return publicSession(session, {
          ...(agentSession?.ok === false ? {} : { agentSession }),
          renewalAdvisory: sessionRenewalAdvisory({
            contextUsage: sessionContextUsageFromMetadata(session.metadata, {
              expectedThreadId: session.metadata?.agent_identity_conversation_id
            }),
            conversationTurnCount: conversation?.pagination?.totalTurnCount,
            session
          })
        });
      });
    },

    async listAssistantCapabilities(input = {}) {
      return sessionResult(async () => {
        if (typeof terminals.listAssistantCapabilities !== "function") {
          return {
            engines: [],
            ok: true,
            unavailable: true
          };
        }
        return terminals.listAssistantCapabilities(input, {
          vibe64User: input.vibe64User || null
        });
      }, "Vibe64 could not read the current assistant catalog.");
    },

    async updateAssistantModelAccess(input = {}) {
      return sessionResult(async () => {
        if (typeof terminals.updateAssistantModelAccess !== "function") {
          const error = new Error("This Vibe64 host does not support changing provider model access.");
          error.code = "vibe64_assistant_model_access_unavailable";
          error.statusCode = 503;
          throw error;
        }
        return terminals.updateAssistantModelAccess({
          engineId: text(input.engineId),
          modelProviderId: text(input.modelProviderId),
          unlocked: input.unlocked === true
        }, {
          vibe64User: trustedAssistantUser(input)
        });
      }, "Vibe64 could not change this provider's model access.");
    },

    async inspectSessionWork(sessionId) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        const existingTask = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
        const operation = await recoverInterruptedSave(runtime, session, existingTask);
        const updateTask = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
        const recoveredUpdateOperation = await recoverInterruptedUpdate(runtime, session, updateTask);
        const updateOperation = recoveredUpdateOperation?.status === "failed"
          ? await resolveSupersededUpdateFailure(runtime, sessionId, operation)
          : recoveredUpdateOperation;
        const work = await terminals.inspectSessionWork(sessionId, {
          runtime,
          session
        });
        const [latestOperation, latestUpdateOperation] = await Promise.all([
          runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID),
          runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID)
        ]);
        const activeSaveOperationId = text(activeSaveOperations.get(sessionId));
        const activeUpdateOperationId = text(activeUpdateOperations.get(sessionId));
        return {
          ...work,
          activeOperation: activeSaveOperationId
            ? { kind: "save", operationId: activeSaveOperationId }
            : activeUpdateOperationId
              ? { kind: "update", operationId: activeUpdateOperationId }
              : null,
          operation: latestOperation || operation,
          updateOperation: latestUpdateOperation || updateOperation,
          ok: true
        };
      }, "Vibe64 could not inspect this session's work.");
    },

    async inspectSessionChanges(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        return terminals.inspectSessionChanges(sessionId, {
          ...input,
          runtime,
          session
        });
      }, "Vibe64 could not inspect this session's current changes.");
    },

    async inspectSessionChangeDiff(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        return terminals.inspectSessionChangeDiff(sessionId, {
          ...input,
          runtime,
          session
        });
      }, "Vibe64 could not inspect this changed file.");
    },

    async saveSessionWork(sessionId, input = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        await terminals.requireAssistantAccess(sessionId, {
          runtime,
          session,
          vibe64User
        });
        const operationId = crypto.randomUUID();
        let operationStarted = false;
        try {
          const result = await terminals.saveSessionWork(sessionId, {
            onRepositoryWriteAcquired: async () => {
              operationStarted = true;
              activeSaveOperations.set(sessionId, operationId);
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
                event: {
                  kind: "save-started",
                  message: "Saving session work.",
                  status: "running"
                },
                patch: {
                  operationId,
                  status: "running"
                },
                reset: true
              });
              await publishSessionChanged(sessionId, {
                operation: "updated",
                originId: text(input.originId),
                reason: "session-save-started",
                session: await runtime.getSession(sessionId, { inspectSource: false })
              });
            },
            operationId,
            onProgress: async (progress = {}) => {
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
                event: {
                  kind: text(progress.kind) || "save-progress",
                  message: text(progress.message),
                  status: "running"
                },
                patch: {
                  ...progress,
                  operationId,
                  status: "running"
                }
              });
              await publishSessionChanged(sessionId, {
                operation: "updated",
                originId: text(input.originId),
                reason: "session-save-progress",
                session: await runtime.getSession(sessionId, { inspectSource: false })
              });
            },
            runtime,
            session,
            vibe64User
          });
          await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.saveCommit);
          if (result.reconciled === true) {
            await runtime.store.writeMetadataValue(sessionId, "base_commit", result.saveCommit);
          }
          const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
            event: {
              kind: result.status,
              message: result.cacheMaintenance?.retryable === true
                ? "Session work was saved. The local clone cache could not be refreshed and will be retried later."
                : result.reconciled === true
                  ? "Session work was saved."
                  : "Session work was published and needs local reconciliation.",
              status: "ready"
            },
            patch: {
              ...result,
              status: "ready"
            }
          });
          await resolveSupersededUpdateFailure(runtime, sessionId, result, { knownNewer: true });
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-save-completed",
            session: await runtime.getSession(sessionId, { inspectSource: false })
          });
          await publishCanonicalChanged(runtime, sessionId, result.saveCommit, {
            originId: input.originId
          });
          return {
            ...result,
            operation: task,
            ok: true
          };
        } catch (error) {
          if (!operationStarted) {
            throw error;
          }
          const updateRequired = error?.code === "vibe64_session_save_update_required";
          const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
            event: {
              kind: updateRequired ? "save-update-required" : "save-failed",
              message: text(error?.message) || "Session Save failed.",
              status: updateRequired ? "ready" : "failed"
            },
            patch: {
              code: text(error?.code),
              ...(updateRequired
                ? { updateRequired: true }
                : { error: text(error?.message) || "Session Save failed." }),
              operationId,
              status: updateRequired ? "ready" : "failed"
            }
          });
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: updateRequired ? "session-save-update-required" : "session-save-failed",
            session: await runtime.getSession(sessionId, { inspectSource: false }),
            task
          });
          throw error;
        } finally {
          if (activeSaveOperations.get(sessionId) === operationId) {
            activeSaveOperations.delete(sessionId);
          }
        }
      }, "Vibe64 could not save this session's work.");
    },

    async checkSessionUpdates(sessionId, input = {}) {
      return sessionResult(async () => {
        const normalizedSessionId = text(sessionId);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const activeCheck = activeRepositoryUpdateChecks.get(normalizedSessionId);
        if (activeCheck) {
          return activeCheck;
        }
        const cached = cachedRepositoryUpdateCheck(session);
        if (input.force !== true && cached && repositoryUpdateCheckIsFresh(cached)) {
          return {
            ...cached,
            cached: true,
            ok: true
          };
        }
        const check = (async () => {
          const previousCanonicalCommit = text(
            session?.metadata?.canonical_commit || session?.metadata?.base_commit
          );
          const result = await terminals.checkSessionUpdates(sessionId, {
            ...input,
            operationId: crypto.randomUUID(),
            runtime,
            session
          });
          await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.canonicalCommit);
          if (result.reconciled === true) {
            await runtime.store.writeMetadataValue(sessionId, "base_commit", result.canonicalCommit);
          }
          const updateCheck = await persistRepositoryUpdateCheck(runtime, sessionId, result);
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-repository-checked",
            payload: { repositoryUpdateCheck: updateCheck },
            session: await runtime.getSession(sessionId, { inspectSource: false })
          });
          if (previousCanonicalCommit && previousCanonicalCommit !== result.canonicalCommit) {
            await publishCanonicalChanged(runtime, sessionId, result.canonicalCommit, {
              originId: input.originId
            });
          }
          return {
            ...result,
            ...updateCheck
          };
        })();
        activeRepositoryUpdateChecks.set(normalizedSessionId, check);
        try {
          return await check;
        } finally {
          if (activeRepositoryUpdateChecks.get(normalizedSessionId) === check) {
            activeRepositoryUpdateChecks.delete(normalizedSessionId);
          }
        }
      }, "Vibe64 could not check this session for updates.");
    },

    async updateSessionWork(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const previousTask = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
        const conflictRecovery = previousTask?.status === "failed" &&
          previousTask?.conflictRecovery && typeof previousTask.conflictRecovery === "object"
          ? previousTask.conflictRecovery
          : null;
        const operationId = crypto.randomUUID();
        let operationStarted = false;
        try {
          const result = await terminals.updateSessionWork(sessionId, {
            conflictRecovery,
            onRepositoryWriteAcquired: async () => {
              operationStarted = true;
              activeUpdateOperations.set(sessionId, operationId);
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
                event: {
                  kind: "update-started",
                  message: "Updating this session (rebase).",
                  status: "running"
                },
                patch: { operationId, status: "running" },
                reset: true
              });
              await publishSessionChanged(sessionId, {
                operation: "updated",
                originId: text(input.originId),
                reason: "session-update-started",
                session: await runtime.getSession(sessionId, { inspectSource: false })
              });
            },
            operationId,
            onProgress: async (progress = {}) => {
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
                event: {
                  kind: text(progress.kind) || "update-progress",
                  message: text(progress.message),
                  status: "running"
                },
                patch: { ...progress, operationId, status: "running" }
              });
            },
            runtime,
            session,
            vibe64User: input.vibe64User || null
          });
          await runtime.store.writeMetadataValue(sessionId, "canonical_commit", result.canonicalCommit);
          if (result.reconciled === true) {
            await runtime.store.writeMetadataValue(sessionId, "base_commit", result.canonicalCommit);
          }
          const refreshedSession = await runtime.getSession(sessionId, { inspectSource: false });
          const refreshedWork = await terminals.inspectSessionWork(sessionId, {
            runtime,
            session: refreshedSession
          });
          const updateCheck = await persistRepositoryUpdateCheck(runtime, sessionId, refreshedWork);
          const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
            event: {
              kind: result.status,
              message: result.status === "already_current" ? "This session was already current." : "This session was updated.",
              status: "ready"
            },
            patch: {
              ...result,
              code: "",
              conflictPaths: [],
              conflictRecovery: null,
              error: "",
              status: "ready"
            }
          });
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-update-completed",
            session: await runtime.getSession(sessionId, { inspectSource: false })
          });
          return {
            ...result,
            ...updateCheck,
            ok: true,
            operation: task
          };
        } catch (error) {
          if (!operationStarted) {
            throw error;
          }
          const task = await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
            event: {
              kind: "update-failed",
              message: text(error?.message) || "Session update failed.",
              status: "failed"
            },
            patch: {
              code: text(error?.code),
              conflictPaths: Array.isArray(error?.details?.conflictPaths)
                ? error.details.conflictPaths
                : [],
              conflictRecovery: error?.details?.conflictRecovery || null,
              error: text(error?.message) || "Session update failed.",
              operationId,
              status: "failed"
            }
          });
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-update-failed",
            session: await runtime.getSession(sessionId, { inspectSource: false }),
            task
          });
          throw error;
        } finally {
          if (activeUpdateOperations.get(sessionId) === operationId) {
            activeUpdateOperations.delete(sessionId);
          }
        }
      }, "Vibe64 could not update this session.");
    },

    async interruptAgentTurn(sessionId, input = {}) {
      return sessionResult(async () => {
        const result = await terminals.interruptAgentTurn(sessionId, input, {
          runtime: await project.createRuntime({ inspectSource: false })
        });
        if (result?.ok !== false) {
          await publishSessionChanged(sessionId, {
            originId: text(input.originId),
            reason: "session-agent-turn-interrupted"
          });
        }
        return result;
      }, "Vibe64 could not interrupt the assistant.");
    },

    async listSessions() {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const sessions = await runtime.listSessionSummaries({ statusGroup: "open" });
        if (typeof project.developmentDatabasePolicy !== "function") {
          throw new TypeError("Session listing requires the project session policy.");
        }
        const openSessions = await sessionsOccupyingPolicySlots(runtime, sessions);
        const policy = await project.developmentDatabasePolicy({ openSessions });
        return {
          creation: policy.creation,
          limits: policy.limits,
          ok: true,
          sessions
        };
      });
    },

    async listArchivedSessions() {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const sessions = await runtime.listSessionSummaries({ statusGroup: "archived" });
        return {
          ok: true,
          sessions: [...sessions].sort((left, right) => (
            text(right.archivedAt).localeCompare(text(left.archivedAt)) ||
            text(right.sessionId).localeCompare(text(left.sessionId))
          ))
        };
      });
    },

    async readSessionConversationLog(sessionId, options = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime();
        const pageOptions = conversationPageOptions(options);
        const result = await runtime.readConversationLogPage(sessionId, pageOptions);
        return {
          ...conversationPage(result, pageOptions),
          ok: true,
          sessionId
        };
      });
    },

    async retryWorkspaceSetup(sessionId, input = {}) {
      return sessionResult(async () => {
        if (setupRunner.isRunning(sessionId)) {
          const error = new Error("Workspace preparation is already running.");
          error.code = "vibe64_workspace_setup_running";
          throw error;
        }
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        if (!["ambiguous", "failed", "required", "unconfigured"].includes(text(session.workspaceSetup?.status))) {
          const error = new Error(
            "Workspace preparation can only be started when it is required, newly configured, failed, or needs a recipe choice."
          );
          error.code = "vibe64_workspace_setup_retry_not_available";
          throw error;
        }
        const setup = await setupRunner.start({
          retry: true,
          runtime,
          session
        });
        if (setup?.ok === false) {
          return setup;
        }
        const currentSession = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: text(input.originId),
          reason: "workspace-setup-retried",
          session: currentSession
        });
        observeWorkspaceSetup(sessionId, setup.completion, {
          originId: input.originId
        });
        return publicSession(currentSession);
      }, "Vibe64 could not retry workspace preparation.");
    },

    async inspectAssistantAccess(sessionId, input = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const runtime = await project.createRuntime({ inspectSource: false });
        const context = await suggestionTerminalContext(runtime, sessionId, vibe64User);
        return publicAssistantAccess(await terminals.inspectAssistantAccess(sessionId, context));
      }, "Vibe64 could not inspect assistant access.");
    },

    async listMessageSuggestions(sessionId, input = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const username = text(vibe64User?.username).toLowerCase();
        if (!username) {
          throw suggestionError(
            "vibe64_message_suggestion_actor_invalid",
            "Sign in before viewing message suggestions.",
            401
          );
        }
        const runtime = await project.createRuntime({ inspectSource: false });
        await runtime.getSession(sessionId, { inspectSource: false });
        const canManage = vibe64User?.role === "owner";
        const state = await readSessionMessageSuggestionState(runtime.store, sessionId);
        const suggestions = state.entries
          .filter((entry) => canManage || entry.author.username === username)
          .sort((left, right) => right.createdAt.localeCompare(left.createdAt));
        return {
          canManage,
          ok: true,
          revision: state.revision,
          suggestions
        };
      }, "Vibe64 could not read message suggestions.");
    },

    async suggestAgentMessage(sessionId, input = {}) {
      return sessionResult(async () => {
        const request = messageText(input);
        const vibe64User = trustedAssistantUser(input);
        const runtime = await project.createRuntime({ inspectSource: false });
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const context = await suggestionTerminalContext(runtime, sessionId, vibe64User);
          const access = await terminals.inspectAssistantAccess(sessionId, context);
          if (access?.canRequestMessage !== true) {
            if (access?.canUse === true) {
              throw suggestionError(
                "vibe64_message_suggestion_not_required",
                "This connection permits direct messages; send the message normally.",
                409
              );
            }
            throw suggestionError(
              "vibe64_assistant_connection_unavailable",
              "Message requests are unavailable for the current AI.",
              409
            );
          }
          const state = await readSessionMessageSuggestionState(runtime.store, sessionId);
          assertSuggestionSubmissionAllowed(state, vibe64User);
          const suggestion = newSessionMessageSuggestion({
            attachmentIds: input.attachmentIds,
            author: vibe64User,
            displayAttachments: input.displayAttachments,
            displayMessage: input.displayMessage,
            id: crypto.randomUUID(),
            message: request
          });
          await pinSuggestionAttachments(context, suggestion);
          try {
            await writeSessionMessageSuggestionState(
              runtime.store,
              sessionId,
              appendSuggestion(state, suggestion, suggestion.updatedAt)
            );
          } catch (error) {
            await unpinSuggestionAttachments(context, suggestion).catch(() => null);
            throw error;
          }
          return suggestion;
        }, { operation: "suggest-agent-message" });
        if (!exclusive.acquired) {
          return exclusive.value;
        }
        await publishSuggestionChanged(
          sessionId,
          exclusive.value,
          "session-message-suggestion-created",
          input.originId
        );
        return { ok: true, suggestion: exclusive.value };
      }, "Vibe64 could not suggest this message to the owner.");
    },

    async withdrawMessageSuggestion(sessionId, input = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const username = text(vibe64User?.username).toLowerCase();
        const runtime = await project.createRuntime({ inspectSource: false });
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const context = await suggestionTerminalContext(runtime, sessionId, vibe64User);
          const state = await readSessionMessageSuggestionState(runtime.store, sessionId);
          const current = suggestionById(state, input.suggestionId);
          if (current.author.username !== username) {
            throw suggestionError(
              "vibe64_message_suggestion_withdraw_forbidden",
              "Only the suggestion's author may withdraw it.",
              403
            );
          }
          if (current.status !== "pending") {
            throw suggestionError(
              "vibe64_message_suggestion_not_pending",
              "Only a pending suggestion can be withdrawn.",
              409
            );
          }
          const now = new Date().toISOString();
          const next = strictSuggestion({
            ...current,
            status: "withdrawn",
            updatedAt: now,
            withdrawnAt: now
          });
          await writeSessionMessageSuggestionState(
            runtime.store,
            sessionId,
            replaceSuggestion(state, next, now)
          );
          await unpinSuggestionAttachments(context, next).catch((error) => {
            vibe64SessionDebugLog("server.sessions.messageSuggestion.unpin.error", {
              error: vibe64SessionDebugError(error),
              sessionId,
              suggestionId: next.id
            });
          });
          return next;
        }, { operation: "withdraw-message-suggestion" });
        if (!exclusive.acquired) {
          return exclusive.value;
        }
        await publishSuggestionChanged(
          sessionId,
          exclusive.value,
          "session-message-suggestion-withdrawn",
          input.originId
        );
        return { ok: true, suggestion: exclusive.value };
      }, "Vibe64 could not withdraw this message suggestion.");
    },

    approveMessageSuggestion,

    async discardMessageSuggestion(sessionId, input = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const runtime = await project.createRuntime({ inspectSource: false });
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const context = await suggestionTerminalContext(runtime, sessionId, vibe64User);
          requireSuggestionOwner(vibe64User);
          const state = await readSessionMessageSuggestionState(runtime.store, sessionId);
          const current = suggestionById(state, input.suggestionId);
          if (current.status !== "pending") {
            throw suggestionError(
              "vibe64_message_suggestion_not_pending",
              "Only a pending suggestion can be discarded.",
              409
            );
          }
          const now = new Date().toISOString();
          const next = strictSuggestion({
            ...current,
            decidedAt: now,
            decidedBy: vibe64User,
            status: "discarded",
            updatedAt: now
          });
          await writeSessionMessageSuggestionState(
            runtime.store,
            sessionId,
            replaceSuggestion(state, next, now)
          );
          await unpinSuggestionAttachments(context, next).catch((error) => {
            vibe64SessionDebugLog("server.sessions.messageSuggestion.unpin.error", {
              error: vibe64SessionDebugError(error),
              sessionId,
              suggestionId: next.id
            });
          });
          return next;
        }, { operation: "discard-message-suggestion" });
        if (!exclusive.acquired) {
          return exclusive.value;
        }
        await publishSuggestionChanged(
          sessionId,
          exclusive.value,
          "session-message-suggestion-discarded",
          input.originId
        );
        return { ok: true, suggestion: exclusive.value };
      }, "Vibe64 could not discard this message suggestion.");
    },

    async sendAgentMessage(sessionId, input = {}) {
      const request = messageText(input);
      if (!request) {
        return {
          code: "vibe64_agent_message_input_required",
          error: "Assistant messages require text.",
          ok: false
        };
      }
      const startedAt = Date.now();
      await setupRunner.wait(sessionId);
      const runtime = await project.createRuntime({ inspectSource: false });
      const messageId = text(input.messageId) || crypto.randomUUID();
      vibe64SessionDebugLog("server.sessions.sendAgentMessage.dispatching", {
        durationMs: Date.now() - startedAt,
        messageId,
        sessionId
      });
      try {
        const result = await terminals.sendAgentMessage(sessionId, {
          ...input,
          messageId,
          message: request
        }, {
          runtime,
          vibe64User: input.vibe64User || null
        });
        const accepted = result?.ok !== false;
        await publishSessionChanged(sessionId, {
          originId: text(input.originId),
          reason: accepted
            ? "session-agent-message-accepted"
            : "session-agent-message-failed",
          session: await runtime.getSession(sessionId, {
            inspectSource: false
          })
        });
        return {
          ...result,
          messageId,
          ok: accepted,
          sessionId
        };
      } catch (error) {
        vibe64SessionDebugLog("server.sessions.sendAgentMessage.error", {
          error: vibe64SessionDebugError(error),
          sessionId
        });
        throw error;
      }
    },

    async updateAssistantSelection(sessionId, input = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const runtime = await project.createRuntime({ inspectSource: false });
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          const session = await runtime.getSession(sessionId, { inspectSource: false });
          const current = vibe64AssistantSelectionFromMetadata(session.metadata);
          const requested = {
            ...record(input.assistantSelection),
            engineId: text(input.assistantSelection?.engineId) || current.engineId
          };
          const resolved = await resolveAssistantSelection(
            requested,
            vibe64User
          );
          await terminals.requireAssistantSelectionAccess(resolved, {
            vibe64User
          });
          const agentSession = typeof terminals.agentSessionState === "function"
            ? await terminals.agentSessionState(sessionId, { runtime, session })
            : null;
          const next = assertVibe64AssistantSelectionUpdate(current, resolved, {
            turnActive: agentSession?.turn?.active === true
          });
          await runtime.store.writeMetadataValue(
            sessionId,
            VIBE64_ASSISTANT_SELECTION_METADATA,
            serializeVibe64AssistantSelection(next)
          );
          return {
            assistantSelection: next,
            session: await runtime.getSession(sessionId, { inspectSource: false })
          };
        }, { operation: "update-assistant-selection" });
        if (!exclusive.acquired) {
          return exclusive.value;
        }
        await publishSessionChanged(sessionId, {
          operation: "updated",
          originId: text(input.originId),
          reason: "session-assistant-selection-updated",
          session: exclusive.value.session
        });
        return publicSession(exclusive.value.session, {
          assistantSelection: exclusive.value.assistantSelection
        });
      }, "Vibe64 could not update this session's assistant selection.");
    },

    async updateSessionPresence(sessionId, input = {}) {
      const actor = presenceActor(input.vibe64User);
      if (!actor || !sessionPresence) {
        return {
          ok: true,
          status: "unavailable"
        };
      }
      return sessionResult(async () => {
        const projectSlug = text(currentProjectRequestContext()?.slug);
        if (!projectSlug) {
          return {
            ok: true,
            status: "unavailable"
          };
        }
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        if (!vibe64SessionStatusIsOpen(session?.status)) {
          return {
            ok: true,
            status: "unavailable"
          };
        }
        return sessionPresence.update({
          ...actor,
          originId: input.originId,
          projectSlug,
          sequence: input.sequence,
          sessionId,
          typing: input.typing
        });
      }, "Vibe64 could not update typing presence.");
    },

    async updateCurrentSession(sessionId = "") {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const current = await runtime.updateCurrentSession(sessionId);
        return {
          ok: true,
          sessionId: text(current.sessionId)
        };
      });
    }
  });
}

export { createService };
