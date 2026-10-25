import crypto from "node:crypto";
import { createMainBrowserConversations } from "./mainBrowserConversations.js";
import { parseSessionConnectedContribution, sessionConnectedSources, sessionConnectedSubmissions, sessionRepositoryDestination,
  sessionRepositoryProject } from "@local/vibe64-core/server/projectRepository";
import { ASSISTANT_ROUTING_METADATA, assistantRoutingAutomation, assistantRoutingPreferences, assistantRoutingFromMetadata, assistantRoutingRequestFromMetadata, assistantRoutingStatusIsPending,
  isAssistantRoutingOwner, assistantRoutingGoalFromMetadata, assistantGoalIsActive } from "@local/vibe64-runtime/shared/assistantRouting";

import {
  assertProjectEffectAdmission,
  captureProjectRequestContext,
  currentProjectRequestContext,
  currentRequestIsPracticeProject,
  currentProjectActionRequestMeta,
  currentProjectVibe64User,
  runWithProjectRequestContext
} from "@local/vibe64-core/server/projectRequestContext";
import {
  writeSessionUiSyncPreviewState
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  assertValidVibe64SessionId,
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
import { readSessionRenewalState, SESSION_RENEWAL_STATUS } from "./sessionRenewalState.js";
import { createSessionRenewalController } from "./sessionRenewal.js";
import { presenceActor } from "./sessionPresence.js";
import { createMainChatApprovals } from "./mainChatApprovals.js";
import { createConnectedContributions } from "./connectedContributions.js";
import { createSessionArchive } from "./sessionArchive.js";
import { publicSession, sessionResult } from "./sessionResults.js";
import { SESSION_SAVE_TASK_ID, SESSION_UPDATE_TASK_ID } from "@local/vibe64-terminals/server/sessionWorkTasks";

function text(value = "") {
  return String(value || "").trim();
}

function record(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

const REPOSITORY_UPDATE_CHECK_METADATA = "repository_update_check";
const REPOSITORY_UPDATE_CHECK_CACHE_MS = 25_000;
// A starter's workspace preparation waits this long for a busy session.
const STARTER_PREPARATION_WAIT_MS = 60_000;
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

function requiredIncomingSessionId(value = "") {
  const sessionId = text(value);
  if (!sessionId) {
    const error = new Error("Select a session before reviewing incoming changes.");
    error.code = "vibe64_incoming_changes_session_required";
    throw error;
  }
  return sessionId;
}

// Project history is readable without a session; a given session pins it to that session's base.
async function optionalRepositorySession(project, value = "") {
  const sessionId = text(value);
  if (!sessionId) {
    return null;
  }
  const runtime = await project.createRuntime({ inspectSource: false });
  return runtime.getSession(sessionId, { inspectSource: false });
}

function conversationPageOptions(options = {}) {
  const limit = Number.parseInt(String(options.limit || ""), 10);
  return {
    pageUnit: "messages",
    beforeTurnId: text(options.beforeTurnId),
    limit: Number.isSafeInteger(limit) && limit > 0 ? Math.min(limit, 200) : 10
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

function assertRenewalActorResolver(resolver = null) {
  if (resolver !== null && typeof resolver !== "function") {
    throw new TypeError("Vibe64 session renewal actor resolver must be a function or null.");
  }
  return resolver;
}

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
  actions = null,
  initializeModelRouting,
  project,
  publishProjectChanged = async () => null,
  publishSessionChanged = async () => null,
  renewalActorResolver = null,
  sessionPresence = null,
  sourceEditor = null,
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
    start: ({ retry = false, runtime, session, waitMs }) => terminals.prepareWorkspaceSetup(
      session.sessionId,
      { retry, runtime, session, waitMs }
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
  const activeWorkInspections = new Map();
  const mainChatApprovals = createMainChatApprovals({
    project, terminals, publishSessionChanged, publishProjectChanged,
    deliver: (sessionId, input, options) => service.sendAgentMessage(sessionId, input, options)
  });
  let configuredRenewalActorResolver = renewalActorResolver;

  function trustedAssistantUser(input = {}) {
    return currentProjectVibe64User() || input.vibe64User || null;
  }
  const { archiveSession, prepareArchive, resumeSessionArchives, setArchivePreparation } = createSessionArchive({
    project, terminals, setupRunner, publishSessionChanged, trustedAssistantUser
  });
  const connected = createConnectedContributions({
    actions, project, terminals, publishSessionChanged, trustedAssistantUser,
    saveOrUpdateRunning: (sessionId) => activeSaveOperations.has(sessionId) || activeUpdateOperations.has(sessionId),
    sessions: () => service
  });
  const { assertConnectedWorkSaved, inspectConnectedWork, prepareConnectedSourcesInsideAgentWrite, saveConnectedWork } = connected;

  const renewal = createSessionRenewalController({
    prepareArchive,
    project,
    publishSessionChanged,
    renewalActorResolver: () => configuredRenewalActorResolver,
    resolveSuccessorAssistant: resolveSessionStart,
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

  // Main chat starts on the owner's setup (a team member's lesson: the team
  // setup). A renewal keeps the chat mode; a chosen model that isn't main
  // chat's own makes the chat Custom.
  async function resolveSessionStart(input = {}, { session = null, vibe64User = null, mode = "senior" } = {}) {
    const direct = isAssistantRoutingOwner(vibe64User) || currentRequestIsPracticeProject();
    if (!direct && Object.keys(input.assistantSelection || {}).length) {
      throw Object.assign(new Error("Main chat runs on the workspace owner's AI. Team members can't choose its model."), {
        code: "vibe64_main_chat_approval_required", statusCode: 403 });
    }
    const explicitSelection = Object.keys(input.assistantSelection || {}).length
      ? await resolveAssistantSelection(input.assistantSelection, vibe64User, { configuredOnly: true })
      : null;
    const previous = session ? assistantRoutingFromMetadata(session.metadata) : null;
    const startMode = previous && !["custom", "fix"].includes(previous.mode) ? previous.mode : mode;
    // Deslop and automatic save start on (their shared default); the chat-mode
    // controls can turn them off.
    const preferences = assistantRoutingPreferences(explicitSelection ? { mode: "custom", override: explicitSelection }
      : { mode: startMode });
    const routingSetup = await initializeModelRouting({ vibe64User });
    if (routingSetup?.ok === false) throw Object.assign(new Error(routingSetup.error), { code: routingSetup.code, statusCode: routingSetup.statusCode });
    // Outside a lesson, a team member's session records main chat's starting
    // model only; their messages wait for the owner, so nothing runs as them here.
    const purpose = preferences.mode === "auto" ? "senior" : preferences.mode;
    const decision = await terminals.resolveAssistantPurpose({ purpose,
      ...(explicitSelection ? { override: { role: "custom", selection: explicitSelection } } : {}) },
    { vibe64User: direct ? vibe64User : { role: "owner" } }, direct ? undefined : { validateModels: false });
    if (!decision.available) throw Object.assign(new Error(decision.message), { code: decision.reasonCode, statusCode: 403 });
    if (direct) {
      await terminals.requireAssistantSelectionAccess(decision.effectiveSelection, {
        vibe64User, expectedConnectionIdentity: decision.connectionIdentity
      });
    }
    return { assistantSelection: decision.effectiveSelection, assistantRouting: preferences };
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
    const source = await runtime.getSession(sourceSessionId, { inspectSource: false });
    const currentProject = await project.readCurrentProject();
    const authorityKey = (session) => {
      const { mode, repository, branch } = sessionRepositoryDestination(currentProject, session);
      return JSON.stringify([mode, repository, branch]);
    };
    const sourceAuthority = authorityKey(source);
    const deliveries = await Promise.allSettled(sessions.map(async (candidate) => {
      const candidateId = text(candidate?.sessionId);
      if (!candidateId || candidateId === sourceSessionId) {
        return;
      }
      if (authorityKey(candidate) !== sourceAuthority) return;
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
    const context = captureProjectRequestContext();
    const observe = async (workspaceSetup) => {
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
    };
    void completion.then(workspaceSetup => context
      ? runWithProjectRequestContext(context, () => observe(workspaceSetup))
      : observe(workspaceSetup)).catch((error) => {
      vibe64SessionDebugLog("server.sessions.workspaceSetup.publish.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
    });
  }

  async function prepareUpdatedWorkspace(runtime, sessionId, options = {}) {
    try {
      const session = await runtime.getSession(sessionId, { inspectSource: false });
      const setup = await setupRunner.start({ runtime, session });
      observeWorkspaceSetup(sessionId, setup.completion, options);
      // A consumer reads this checkout next, so it waits for the rebuild.
      if (options.wait) await setup.completion;
    } catch (error) {
      // Preparation cannot turn a completed repository update into a failed rebase.
      vibe64SessionDebugLog("server.sessions.workspaceSetup.afterUpdate.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
    }
  }

  // Once a Save's outcome is recorded, its prepared ref is no longer recovery
  // evidence. Retiring is best effort: a later recovery still reads the record.
  async function retireRecordedSave(sessionId, operationId, context) {
    if (!text(operationId) || typeof terminals.retireSessionWorkSave !== "function") return;
    try {
      await terminals.retireSessionWorkSave(sessionId, { ...context, operationId });
    } catch (error) {
      vibe64SessionDebugLog("server.sessions.save.retire.error", {
        error: vibe64SessionDebugError(error),
        sessionId
      });
    }
  }

  async function recoverInterruptedSave(runtime, session, task) {
    const failedPublication = task?.status === "failed" && (
      task.stage === "publishing" || task.code === "vibe64_session_save_publication_unknown"
    );
    if ((task?.status !== "running" && !failedPublication) || typeof terminals.recoverSessionWorkSave !== "function") {
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
      const recorded = await runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_SAVE_TASK_ID, {
        event: {
          kind: "save-recovered",
          message: result.cacheMaintenance?.retryable === true
            ? "Interrupted Save recovered. The local clone cache could not be refreshed and will be retried later."
            : result.reconciled === true
              ? "Interrupted Save recovered and reconciled."
              : "Interrupted Save was pushed and needs local reconciliation.",
          status: "ready"
        },
        patch: {
          ...result,
          code: "",
          error: "",
          status: "ready"
        }
      });
      await retireRecordedSave(session.sessionId, task.operationId, { runtime });
      return recorded;
    } catch (error) {
      // A prepared-ref check can prove this failed attempt never published.
      // Preserve its actionable original rejection instead of replacing it
      // with a generic interrupted-Save notice.
      if (failedPublication && task.code !== "vibe64_session_save_publication_unknown" &&
          error.code === "vibe64_session_save_interrupted_retryable") return task;
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
      const recovered = await runtime.store.writeBackgroundTaskEvent(session.sessionId, SESSION_UPDATE_TASK_ID, {
        event: {
          kind: "update-recovered",
          message: "Interrupted session update recovered.",
          status: "ready"
        },
        patch: { ...result, status: "ready" }
      });
      await prepareUpdatedWorkspace(runtime, session.sessionId);
      return recovered;
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
      canUse: access.canUse === true,
      nativeCanUse: access.nativeCanUse === true,
      canUseAny: access.canUseAny === true,
      currentMode: text(access.currentMode),
      steering: access.steering === true,
      // Chat needs each decision and effective selection, not duplicated server
      // dispatch plans. Routing still resolves those afresh when work is sent.
      purposes: JSON.parse(JSON.stringify(access.purposes || {}, (key, value) =>
        ["connectionIdentity", "routerConnectionIdentity", "configuredSelection",
          "seniorJuniorPair", "executionProfileRequest", "router"].includes(key) ? undefined : value)),
      endpointCode: text(access.endpointCode),
      engineId: text(access.engineId),
      modelProviderId: text(access.modelProviderId),
      ok: true,
      ownerOnly: access.ownerOnly === true,
      transportId: text(access.transportId)
    };
  }

  const service = Object.freeze({
    ...renewal,
    ...connected.methods,
    browserConversations: actions ? createMainBrowserConversations({ actions, terminals }) : null,
    closeSessionPresence() {
      sessionPresence?.close?.();
    },
    setArchivePreparation,
    setRenewalActorResolver(resolver = null) {
      configuredRenewalActorResolver = assertRenewalActorResolver(resolver);
    },
    async inspectRepositoryHistory(input = {}) {
      return sessionResult(async () => {
        const session = await optionalRepositorySession(project, input.sessionId);
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
        const session = await optionalRepositorySession(project, input.sessionId);
        return terminals.inspectRepositoryVersionFiles({ ...input, session });
      }, "Vibe64 could not read this project version.");
    },

    async inspectRepositoryVersionFileDiff(input = {}) {
      return sessionResult(async () => {
        const session = await optionalRepositorySession(project, input.sessionId);
        return terminals.inspectRepositoryVersionFileDiff({ ...input, session });
      }, "Vibe64 could not read this version's file change.");
    },

    archiveSession,
    resumeSessionArchives,
    async pinSession(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const result = await runtime.store.runSessionRenewalStateExclusive(sessionId, () => (
          runtime.store.mutateSession(sessionId, async () => {
            const renewal = input.pinned ? await readSessionRenewalState(runtime, sessionId) : null;
            if (renewal && ![SESSION_RENEWAL_STATUS.COMPLETED, SESSION_RENEWAL_STATUS.CANCELLED].includes(renewal.status)) {
              throw Object.assign(new Error("Finish or cancel renewal before pinning this session."), { code: "vibe64_session_pin_unavailable" });
            }
            return runtime.store.updatePinnedSession(sessionId, input.pinned);
          })
        ));
        await publishSessionChanged(sessionId, {
          originId: text(input.originId),
          reason: "session-pin-changed",
          payload: { clientRefresh: { includeList: true } }
        });
        return { ok: true, ...result };
      }, "The session pin could not be changed.");
    },
    async renameSession(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const sessionName = await runtime.store.writeSessionLabel(sessionId, input.name);
        await publishSessionChanged(sessionId, {
          originId: text(input.originId), reason: "session-renamed",
          payload: { clientRefresh: { includeList: true } }
        });
        return { ok: true, sessionId, sessionName };
      }, "The session could not be renamed.");
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

    // Only an internal caller may supply a server-reserved identity.
    async createSession(input = {}, { sessionId, expectedCommit, connectedContribution } = {}) {
      return sessionResult(async () => {
        assertProjectEffectAdmission();
        if (sessionId !== undefined) assertValidVibe64SessionId(sessionId);
        if (expectedCommit !== undefined) {
          if (sessionId === undefined || typeof expectedCommit !== "string" ||
            !/^(?:[0-9a-f]{40}|[0-9a-f]{64})$/iu.test(expectedCommit)) {
            throw new TypeError("An internal source commit requires a reserved session ID and a complete Git object ID.");
          }
          if (input.repositoryBranch != null || input.pullRequestNumber != null) {
            throw new TypeError("An internal source commit cannot be combined with a branch or pull request selection.");
          }
        }
        let contribution = null;
        if (connectedContribution !== undefined) {
          contribution = parseSessionConnectedContribution(connectedContribution);
          if (!sessionId || !expectedCommit || contribution.baseCommit !== expectedCommit.toLowerCase() ||
              currentProjectRequestContext()?.learningScope) {
            throw new TypeError("Contribution creation requires a reserved working session and its exact source commit.");
          }
          sessionRepositoryProject(await project.readCurrentProject(), {
            metadata: { connected_contribution: JSON.stringify(contribution) }
          }, { sourcePreparation: true });
        }
        const vibe64User = trustedAssistantUser(input);
        let learningRuntime = null;
        if (currentProjectRequestContext()?.learningScope) {
          if (sessionId === undefined) {
            throw new TypeError("Learning creation requires a server-reserved session ID.");
          }
          if ((currentProjectRequestContext().learningScope.noExercise && expectedCommit !== undefined) ||
            ["repositoryBranch", "pullRequestNumber", "expectedCommit",
            "sourceContext", "sourcePath", "sourceRoot", "projectSessionSourceRoot", "createSessionSource"]
            .some(name => Object.hasOwn(input, name))) {
            throw new TypeError(currentProjectRequestContext().learningScope.noExercise
              ? "A source-less learning session cannot select source, branch, pull request or commit options."
              : "A saved practice learning session cannot select different source, branch, pull request or commit options.");
          }
          learningRuntime = await project.createRuntime(sessionRuntimeOptions(terminals));
          if (!learningRuntime.learningScope) {
            throw new TypeError("Learning creation requires the trusted Project learning runtime.");
          }
        }
        const pullRequest = input.pullRequestNumber == null ? null : await project.resolvePullRequestSource({
          number: input.pullRequestNumber, vibe64User
        });
        if (pullRequest && input.repositoryBranch) throw new Error("Choose a branch or a pull request for this session.");
        const { assistantSelection, assistantRouting } = await resolveSessionStart(input, {
          vibe64User, mode: learningRuntime ? "junior" : "senior"
        });
        const runtime = learningRuntime || await project.createRuntime(sessionRuntimeOptions(terminals));
        if (runtime.learningScope && !learningRuntime) {
          throw new TypeError("Learning creation requires the trusted Project learning context.");
        }
        const createAdmittedSession = ({ repositoryBranch = null } = {}) => runtime.createSession({
          ...(sessionId === undefined ? {} : { sessionId }),
          metadata: {
            ...(contribution ? { connected_contribution: JSON.stringify(contribution) } : {}),
            ...(repositoryBranch ? { repository_branch: repositoryBranch.name } : {}),
            ...(pullRequest ? { github_pull_request: JSON.stringify(pullRequest) } : {}),
            [ASSISTANT_ROUTING_METADATA]: JSON.stringify(assistantRouting),
            [VIBE64_ASSISTANT_SELECTION_METADATA]: serializeVibe64AssistantSelection(
              assistantSelection
            ),
            created_by: text(vibe64User?.username || vibe64User?.name)
          },
          ...(!runtime.learningScope?.noExercise ? { sourceContext: {
            ...(expectedCommit === undefined ? {} : { expectedCommit }),
            ...(repositoryBranch ? { expectedCommit: repositoryBranch.commit } : {}),
            ...(pullRequest ? { expectedCommit: pullRequest.headCommit } : {}),
            vibe64User
          } } : {})
        });
        let created;
        if (runtime.learningScope?.noExercise) {
          if (typeof runtime.store?.assertSessionCreationAbsent !== "function") {
            throw new TypeError("Reserved session creation requires the session store's absence check.");
          }
          await runtime.store.assertSessionCreationAbsent(sessionId);
          created = { session: await createAdmittedSession() };
        } else {
          if (
            typeof project.developmentDatabasePolicy !== "function" ||
            typeof project.runProjectSessionPolicyExclusive !== "function"
          ) {
            throw new TypeError("Session creation requires the project session policy boundary.");
          }
          created = await project.runProjectSessionPolicyExclusive(async () => {
            const visibleOpenSessions = await runtime.listSessionSummaries({
              statusGroup: "open"
            });
            const openSessions = await sessionsOccupyingPolicySlots(runtime, visibleOpenSessions);
            const policy = await project.developmentDatabasePolicy({ openSessions });
            if (policy?.creation?.canCreate !== true) {
              throw sessionCreationLimitError(policy);
            }
            if (sessionId !== undefined) {
              if (typeof runtime.store?.assertSessionCreationAbsent !== "function") {
                throw new TypeError("Reserved session creation requires the session store's absence check.");
              }
              await runtime.store.assertSessionCreationAbsent(sessionId);
            }
            const repositoryBranch = input.repositoryBranch ? await project.resolveSessionBranch({
              selection: input.repositoryBranch, vibe64User
            }) : null;
            const session = await createAdmittedSession({ repositoryBranch });
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
        }
        let setup = null;
        try {
          // Allocation prepares a receiving checkout only. The originating
          // recipe treats its direct sources; starting the receiver's setup
          // here would recursively allocate its connections (including cycles).
          if (!contribution && !runtime.learningScope?.noExercise) setup = await setupRunner.start({
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
        return publicSession(currentSession, runtime.learningScope?.noExercise ? {} : {
          creation: created.updatedPolicy.creation,
          limits: created.updatedPolicy.limits
        });
      }, "Vibe64 could not create a chat session.");
    },

    async inspectSession(sessionId) {
      return sessionResult(async () => {
        // Realtime chat refreshes read state; source operations own their Git checks.
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const [agentSession, conversation] = await Promise.all([
          session.status !== "archived" && typeof terminals.agentSessionState === "function"
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
          vibe64User: trustedAssistantUser(input)
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

    async inspectSessionWork(sessionId, requestContext = {}, {
      includeConnected = true, inspectContributionPublication = false, knownSubmittedCommit = ""
    } = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        const existingTask = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
        const operation = await recoverInterruptedSave(runtime, session, existingTask);
        const confirmedContributionCommit = text(operation?.verifiedCommit) || knownSubmittedCommit;
        const updateTask = await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID);
        const recoveredUpdateOperation = await recoverInterruptedUpdate(runtime, session, updateTask);
        const updateOperation = recoveredUpdateOperation?.status === "failed"
          ? await resolveSupersededUpdateFailure(runtime, sessionId, operation)
          : recoveredUpdateOperation;
        const inspectionKey = JSON.stringify([
          runtime.stateRoot,
          sessionId,
          session.metadata?.source_path,
          session.metadata?.base_commit,
          session.metadata?.canonical_commit,
          inspectContributionPublication,
          confirmedContributionCommit
        ]);
        let inspection = activeWorkInspections.get(inspectionKey);
        if (!inspection) {
          inspection = Promise.resolve().then(() => terminals.inspectSessionWork(sessionId, {
            runtime, session, ...(inspectContributionPublication ? {
              inspectContributionPublication: true, knownSubmittedCommit: confirmedContributionCommit
            } : {})
          }));
          activeWorkInspections.set(inspectionKey, inspection);
        }
        let work;
        try {
          work = await inspection;
        } finally {
          // Share only overlapping reads; the next read must inspect current files.
          if (activeWorkInspections.get(inspectionKey) === inspection) {
            activeWorkInspections.delete(inspectionKey);
          }
        }
        const [latestOperation, latestUpdateOperation] = await Promise.all([
          runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID),
          runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID)
        ]);
        const activeSaveOperationId = text(activeSaveOperations.get(sessionId));
        const activeUpdateOperationId = text(activeUpdateOperations.get(sessionId));
        let connected = [];
        let connectedInspectionError = "";
        if (includeConnected) {
          try {
            connected = await inspectConnectedWork(session, requestContext);
          } catch (error) {
            // Receiving status must not hide Main Save. Its separate publication
            // preflight repeats the authorized inspection and refuses unknowns.
            connectedInspectionError = text(error?.message) || "Connected repository status is unavailable. Retry Save to check it again.";
          }
        }
        return {
          ...work,
          connected,
          connectedInspectionError,
          connectedSaveRequired: connected.some(item => item.needsSave),
          connectedRequirementsPresent: sessionConnectedSubmissions(session).length > 0,
          connectedReview: connected.map(({ projectSlug, destination }) => ({ projectSlug, destination })),
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

    async inspectIncomingContributions(sessionId, input = {}) {
      return sessionResult(() => terminals.inspectIncomingContributions(requiredIncomingSessionId(sessionId), {
        ...input, vibe64User: trustedAssistantUser(input)
      }), "Incoming changes could not be read. Refresh before acting.");
    },

    async changeIncomingContribution(sessionId, input = {}) {
      return sessionResult(async () => {
        const result = await terminals.changeIncomingContribution(requiredIncomingSessionId(sessionId), {
          ...input, vibe64User: trustedAssistantUser(input)
        });
        // The Git result is confirmed. A failed UI notification must not turn
        // that success into a retry of a remote write.
        if (result.status !== "repair-review") {
          try { await project.refreshGithub(); } catch { /* The next read reconstructs state from Git. */ }
        }
        return result;
      }, "The contribution action was not confirmed. Refresh Incoming changes before retrying.");
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

    async createSessionPullRequest(sessionId, input = {}, requestContext = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        try {
          return await terminals.createSessionPullRequest(sessionId, {
            assertConnectedWorkSaved: () => assertConnectedWorkSaved(runtime, sessionId, requestContext),
            destinationReview: input.destinationReview,
            title: input.title, body: input.body, draft: input.draft,
            operationId: crypto.randomUUID(), runtime, session, vibe64User
          });
        } finally {
          await publishSessionChanged(sessionId, {
            operation: "updated", originId: text(input.originId), reason: "session-pull-request",
            session: await runtime.getSession(sessionId, { inspectSource: false })
          });
        }
      }, "The pull request could not be confirmed. Retry to check GitHub and continue.");
    },

    async saveSessionWork(sessionId, input = {}, requestContext = {}) {
      if (input.connectedReview !== undefined) return saveConnectedWork(sessionId, input, requestContext);
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        let session = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        const previous = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
        if (previous?.status === "failed" && (
          previous.stage === "publishing" || previous.code === "vibe64_session_save_publication_unknown"
        )) {
          const recovered = await recoverInterruptedSave(runtime, session, previous);
          if (recovered?.status === "failed" && recovered.code === "vibe64_session_save_publication_unknown") {
            throw Object.assign(new Error(recovered.error || "Inspect the uncertain Save before saving again."), {
              code: recovered.code
            });
          }
          session = await runtime.getSession(sessionId, { inspectSource: false });
        }
        const operationId = crypto.randomUUID();
        let operationStarted = false;
        try {
          const result = await terminals.saveSessionWork(sessionId, {
            destinationReview: input.destinationReview,
            assertConnectedWorkSaved: () => assertConnectedWorkSaved(runtime, sessionId, requestContext),
            onRepositoryWriteAcquired: async () => {
              operationStarted = true;
              activeSaveOperations.set(sessionId, operationId);
              const previous = await runtime.store.readBackgroundTask(sessionId, SESSION_SAVE_TASK_ID);
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_SAVE_TASK_ID, {
                event: {
                  kind: "save-started",
                  message: "Saving session work.",
                  status: "running"
                },
                patch: {
                  assistantHelper: previous?.assistantHelper || null,
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
                  : "Session work was pushed and needs local reconciliation.",
              status: "ready"
            },
            patch: {
              ...result,
              code: "",
              status: "ready"
            }
          });
          await retireRecordedSave(sessionId, operationId, { runtime });
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
        const reviewedConflictId = text(input.reviewedConflictId);
        // Ordinary Rebase starts over; only an explicit repair check resumes a conflict.
        const previousTask = reviewedConflictId
          ? await runtime.store.readBackgroundTask(sessionId, SESSION_UPDATE_TASK_ID)
          : null;
        const conflictRecovery = previousTask?.status === "failed" &&
          previousTask?.conflictRecovery && typeof previousTask.conflictRecovery === "object"
          ? previousTask.conflictRecovery
          : null;
        const operationId = crypto.randomUUID();
        let operationStarted = false;
        try {
          const result = await terminals.updateSessionWork(sessionId, {
            historyReview: input.historyReview,
            conflictRecovery,
            reviewedConflictId,
            onRepositoryWriteAcquired: async () => {
              operationStarted = true;
              activeUpdateOperations.set(sessionId, operationId);
              await runtime.store.writeBackgroundTaskEvent(sessionId, SESSION_UPDATE_TASK_ID, {
                event: {
                  kind: "update-started",
                  message: "Updating this session (rebase).",
                  status: "running"
                },
                patch: { operationId, requestId: text(input.requestId), status: "running" },
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
          // Keep the update active while automatic preparation is starting so
          // invalidation is presented as pending, not a manual setup failure.
          // A connected refresh that changed nothing leaves its setup alone.
          if (!(input.connectedRefresh === true && result.status === "already_current")) {
            await prepareUpdatedWorkspace(runtime, sessionId, { originId: input.originId, wait: input.connectedRefresh === true });
          }
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
        const summaries = await runtime.listSessionSummaries({ statusGroup: "open", includeUnavailable: true });
        const sessions = summaries.filter((session) => !session.unavailable);
        if (typeof project.developmentDatabasePolicy !== "function") {
          throw new TypeError("Session listing requires the project session policy.");
        }
        const openSessions = await sessionsOccupyingPolicySlots(runtime, sessions);
        const policy = await project.developmentDatabasePolicy({ openSessions });
        const activityReads = await Promise.allSettled(sessions.map(async (session) => (
          runtime.store.readAgentRuns(session.sessionId)
        )));
        return {
          creation: policy.creation,
          limits: policy.limits,
          ok: true,
          sessions: sessions.map((session, index) => {
            const activity = activityReads[index];
            return {
              ...session,
              agentActivity: {
                active: activity.status === "fulfilled" ? activity.value.some((run) => run.active) : null,
                revision: session.revision
              }
            };
          }),
          unavailableSessions: summaries.filter((session) => session.unavailable)
        };
      });
    },

    async listArchivedSessions() {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({
          inspectSource: false
        });
        const summaries = await runtime.listSessionSummaries({ statusGroup: "archived", includeUnavailable: true });
        return {
          ok: true,
          unavailableSessions: summaries.filter((session) => session.unavailable),
          sessions: summaries.filter((session) => !session.unavailable).sort((left, right) => (
            text(right.archivedAt).localeCompare(text(left.archivedAt)) ||
            text(right.sessionId).localeCompare(text(left.sessionId))
          ))
        };
      });
    },

    async resumeIntegrationContinuation(sessionId, input = {}) {
      return sessionResult(async () => {
        await setupRunner.wait(sessionId);
        const runtime = await project.createRuntime({ inspectSource: false });
        const result = await terminals.resumeIntegrationContinuation(sessionId, {
          turnId: input.turnId, requestId: input.requestId
        }, {
          runtime, vibe64User: trustedAssistantUser(input),
          readIntegrationConfiguration: () => sourceEditor.readIntegrations({ sessionId })
        });
        await publishSessionChanged(sessionId, {
          reason: "integration-setup-completed", session: null
        });
        return { ...result, sessionId, turnId: input.turnId };
      });
    },

    async skipIntegrationSetupRequest(sessionId, input = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const integrationSetup = await runtime.store.skipIntegrationSetupRequest(sessionId, {
          turnId: input.turnId, requestId: input.requestId
        });
        await publishSessionChanged(sessionId, {
          reason: "integration-setup-skipped", session: null
        });
        return { ok: true, sessionId, turnId: input.turnId, integrationSetup };
      });
    },

    async readSessionConversationLog(sessionId, options = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime();
        const pageOptions = conversationPageOptions(options);
        const result = await runtime.readConversationLogPage(sessionId, pageOptions);
        return {
          ...conversationPage(result, pageOptions),
          conversationStream: runtime.store.readConversationStream(sessionId),
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
        const status = text(session.workspaceSetup?.status);
        if (!["ambiguous", "failed", "required", "unconfigured", "succeeded"].includes(status)) {
          const error = new Error(
            "Workspace preparation can only be started when it is required, newly configured, finished, or needs a recipe choice."
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

    // A starter replaces the Stack of a session that was prepared as empty;
    // prepare it now so the Preview does not wait for host-managed resources.
    // The new session's first AI turn usually holds the session briefly, so
    // preparation waits its turn instead of giving up and leaving the app
    // without its database until something else prepares it.
    async prepareStarterWorkspace(sessionId) {
      if (setupRunner.isRunning(sessionId)) return;
      const runtime = await project.createRuntime({ inspectSource: false });
      const session = await runtime.getSession(sessionId, { inspectSource: false });
      if (session.status !== "active") return;
      const setup = await setupRunner.start({ runtime, session, waitMs: STARTER_PREPARATION_WAIT_MS });
      if (setup?.ok === false) return;
      await publishSessionChanged(sessionId, {
        operation: "updated",
        reason: "workspace-setup-started",
        session: await runtime.getSession(sessionId, { inspectSource: false })
      });
      observeWorkspaceSetup(sessionId, setup?.completion);
    },

    async inspectAssistantAccess(sessionId, input = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const context = { runtime, session, vibe64User };
        return publicAssistantAccess(await terminals.inspectAssistantAccess(sessionId, context));
      }, "Vibe64 could not inspect assistant access.");
    },

    async sendAgentMessage(sessionId, input = {}, options = {}) {
      const request = messageText(input);
      if (!request) {
        return {
          code: "vibe64_agent_message_input_required",
          error: "Assistant messages require text.",
          ok: false
        };
      }
      // A team member's main-chat message waits for the owner's approval,
      // except in their own lesson, which runs on the team setup.
      const vibe64User = trustedAssistantUser(input);
      if (vibe64User && !isAssistantRoutingOwner(vibe64User) && !currentRequestIsPracticeProject()) {
        return { ...await mainChatApprovals.enqueue(sessionId, { message: request, messageId: text(input.messageId),
          attachmentIds: input.attachmentIds || [] }, { vibe64User }), sessionId };
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
      const { messageSource, ...message } = input;
      try {
        const result = await terminals.sendAgentMessage(sessionId, {
          ...message,
          ...(messageSource === "lesson" ? { turnMetadata: { source: "lesson" } } : {}),
          messageId,
          message: request
        }, {
          ...(options.browserAuthority ? { browserAuthority: options.browserAuthority } : {}),
          runtime,
          vibe64User
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

    readMainChatApprovals(sessionId, input = {}) {
      return mainChatApprovals.read(sessionId, { vibe64User: trustedAssistantUser(input) });
    },

    editMainChatApproval(sessionId, approvalId, input = {}) {
      return mainChatApprovals.edit(sessionId, approvalId, input, { vibe64User: trustedAssistantUser(input) });
    },

    withdrawMainChatApproval(sessionId, approvalId, input = {}) {
      return mainChatApprovals.withdraw(sessionId, approvalId, input, { vibe64User: trustedAssistantUser(input) });
    },

    declineMainChatApproval(sessionId, approvalId, input = {}) {
      return mainChatApprovals.decline(sessionId, approvalId, input, { vibe64User: trustedAssistantUser(input) });
    },

    approveMainChatApproval(sessionId, approvalId, input = {}, options = {}) {
      return mainChatApprovals.approve(sessionId, approvalId, input, {
        vibe64User: trustedAssistantUser(input), browserAuthority: options.browserAuthority || null
      });
    },

    async updateAssistantSelection(sessionId, input = {}) {
      return sessionResult(async () => {
        const vibe64User = trustedAssistantUser(input);
        // Main chat's mode, review and model are the owner's, with or without a
        // goal, except in a team member's own lesson.
        if (!isAssistantRoutingOwner(vibe64User) && !currentRequestIsPracticeProject()) {
          throw Object.assign(new Error("Main chat runs on the workspace owner's AI. Only the owner can change its chat mode, review or model."),
            { code: "vibe64_main_chat_approval_required", statusCode: 403 });
        }
        const runtime = await project.createRuntime({ inspectSource: false });
        const save = async () => {
          const apply = async ({ deferred = false } = {}) => {
            const session = await runtime.getSession(sessionId, { inspectSource: false });
            const current = vibe64AssistantSelectionFromMetadata(session.metadata);
            let preferences = null;
            let resolved;
            let connectionIdentity;
            // One answer, read once, to "is a turn running or a goal unfinished":
            // the native goal when the tool reports it, else the live session's,
            // else the pin. A model change reads it only after access is checked.
            let nativeState = null;
            const readNativeState = async () => {
              if (nativeState) return nativeState;
              const agentSession = typeof terminals.agentSessionState === "function"
                ? await terminals.agentSessionState(sessionId, { runtime, session }) : null;
              const observedGoal = typeof terminals.readAgentGoal === "function"
                ? await terminals.readAgentGoal(sessionId, { runtime, session, vibe64User }) : null;
              nativeState = { turnActive: agentSession?.turn?.active === true,
                goalActive: assistantGoalIsActive(observedGoal?.status === "available" ? observedGoal.goal
                  : observedGoal?.goal || agentSession?.goal || assistantRoutingGoalFromMetadata(session.metadata)) };
              return nativeState;
            };
            if (input.assistantRouting && input.assistantRouting.mode !== "custom") {
              // An omitted Deslop or automatic save choice keeps the chat's own.
              preferences = assistantRoutingPreferences({
                ...assistantRoutingAutomation(assistantRoutingFromMetadata(session.metadata)), ...input.assistantRouting });
              // Main chat's tool follows the owner's setup; a changed tool
              // catches up on the next message. Only an active goal rebinds now.
              if (!(await readNativeState()).goalActive) {
                await runtime.store.writeMetadataValue(sessionId, ASSISTANT_ROUTING_METADATA, JSON.stringify(preferences));
                return { assistantSelection: current, session: await runtime.getSession(sessionId, { inspectSource: false }) };
              }
              const decision = await terminals.resolveAssistantPurpose({
                purpose: preferences.mode, reviewEnabled: preferences.review,
                ...(preferences.override ? { override: { role: preferences.mode, selection: preferences.override } } : {})
              }, { vibe64User });
              if (!decision.available) throw Object.assign(new Error(decision.message), { code: decision.reasonCode, statusCode: 403 });
              const destination = preferences.mode === "auto" ? decision.seniorJuniorPair.senior : decision;
              resolved = destination.effectiveSelection;
              connectionIdentity = destination.connectionIdentity;
            } else {
              const requestedSelection = input.assistantRouting?.mode === "custom"
                ? input.assistantRouting.override : input.assistantSelection;
              if (!requestedSelection) throw new Error("Choose an assistant or a chat mode.");
              resolved = await resolveAssistantSelection({
                ...record(requestedSelection),
                engineId: text(requestedSelection.engineId) || current.engineId
              }, vibe64User);
            }
            await terminals.requireAssistantSelectionAccess(resolved, {
              vibe64User, ...(connectionIdentity ? { expectedConnectionIdentity: connectionIdentity } : {})
            });
            const { turnActive, goalActive } = await readNativeState();
            const next = resolved;
            const nextPreferences = preferences || {
              mode: "custom", review: false, override: next
            };
            if (deferred || turnActive || goalActive) {
              await terminals.applyGoalSelection(sessionId, next, nextPreferences, { runtime, session, vibe64User });
              await runtime.store.writeMetadataValue(sessionId, ASSISTANT_ROUTING_METADATA, JSON.stringify(nextPreferences));
              return { assistantSelection: current, session: await runtime.getSession(sessionId, { inspectSource: false }) };
            }
            const routingRequest = assistantRoutingRequestFromMetadata(session.metadata);
            if (routingRequest?.helper || !routingRequest?.stopped && (assistantRoutingStatusIsPending(routingRequest) ||
                routingRequest?.status === "working" && routingRequest.workflow && routingRequest.delivery === "accepted")) {
              return { cancelRouting: routingRequest.messageId };
            }
            await terminals.prepareRoutingSelection(sessionId, next, { runtime, session, vibe64User });
            await runtime.store.writeMetadataValue(sessionId, ASSISTANT_ROUTING_METADATA, JSON.stringify(nextPreferences));
            await runtime.store.writeMetadataValue(
              sessionId,
              VIBE64_ASSISTANT_SELECTION_METADATA,
              serializeVibe64AssistantSelection(next)
            );
            return {
              assistantSelection: next,
              session: await runtime.getSession(sessionId, { inspectSource: false })
            };
          };
          const update = async () => {
            const result = await runVibe64AgentWriteExclusive(runtime, sessionId, () => apply(),
              { operation: "update-assistant-selection" });
            // Saving the next selection does not wait for native startup. Only
            // immediate idle changeover requires the admission/cleanup lock.
            return result.acquired ? result : { acquired: true, value: await apply({ deferred: true }) };
          };
          let exclusive = await update();
          if (exclusive.acquired && Object.hasOwn(exclusive.value || {}, "cancelRouting")) {
            // Router cleanup needs this lock for its final callbacks. Release it,
            // cancel through its owner, then revalidate access and native state.
            await terminals.cancelAssistantRoutingForSelection(sessionId, exclusive.value.cancelRouting, { runtime, vibe64User });
            exclusive = await update();
            if (exclusive.acquired && Object.hasOwn(exclusive.value || {}, "cancelRouting")) {
              throw new Error("Another routing request started. Retry the assistant selection.");
            }
          }
          if (!exclusive.acquired) {
            return exclusive.value;
          }
          if (exclusive.value?.ok === false) return exclusive.value;
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-assistant-selection-updated",
            session: exclusive.value.session
          });
          return publicSession(exclusive.value.session, {
            assistantSelection: exclusive.value.assistantSelection
          });
        };
        if (!runtime.store.runSessionExclusive) return save();
        const saved = await runtime.store.runSessionExclusive(sessionId, "assistant-settings", save,
          { operation: "save-assistant-settings", waitMs: 10_000 });
        if (!saved.acquired) throw new Error("Another settings change is being saved. Try again in a moment.");
        return saved.value;
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
        const status = await runtime.store.readStatus(sessionId);
        if (!vibe64SessionStatusIsOpen(status)) {
          return {
            ok: true,
            status: "unavailable"
          };
        }
        const conversationId = text(input.conversationId);
        if (conversationId) {
          const conversation = await runtime.store.readSessionConversation(sessionId, conversationId);
          if (!conversation) return { ok: true, status: "unavailable" };
        }
        return sessionPresence.update({
          ...actor,
          ...(conversationId ? { conversationId } : {}),
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
  // Automatic save: once Auto's completing turn ends, Main chat's autoSave
  // preference runs the ordinary Save. Returns the short chat note.
  terminals.setPlanCompleted?.(async (sessionId, { submittedBy = null } = {}) => {
    const runtime = await project.createRuntime({ inspectSource: false });
    const session = await runtime.getSession(sessionId, { inspectSource: false });
    const preferences = assistantRoutingFromMetadata(session.metadata);
    if (preferences?.mode !== "auto" || !preferences.autoSave) return "";
    const skipped = reason => `Automatic save didn't run: ${reason}`;
    // Connected Save needs the person's authenticated request to each project.
    if (sessionConnectedSources(session).length) return skipped("this session has connected repositories. Choose Save yourself.");
    const work = await service.inspectSessionWork(sessionId, {}, { includeConnected: false });
    if (work?.ok === false) return skipped(text(work.error) || "this session's work could not be inspected.");
    if (!work.unsaved) return "Automatic save: nothing new to save.";
    const saved = await service.saveSessionWork(sessionId, { destinationReview: work.destination, vibe64User: submittedBy });
    return saved?.ok === false ? skipped(text(saved.error) || "Save was refused.") : "Saved automatically after completing the plan.";
  });
  terminals.setConnectedPreparation?.(async ({ mode, runtime, session, onProgress = null }) => {
    const requestContext = { requestMeta: currentProjectActionRequestMeta() };
    // Each progress label is saved by workspace setup, then published so the
    // open session shows which connected projects are still being prepared.
    const progress = typeof onProgress === "function" ? async label => {
      await onProgress(label);
      await publishSessionChanged(session.sessionId, {
        operation: "updated", reason: "workspace-setup-progress",
        session: await runtime.getSession(session.sessionId, { inspectSource: false })
      });
    } : null;
    return mode === "prepare"
      ? prepareConnectedSourcesInsideAgentWrite({ runtime, session }, {}, requestContext, { onProgress: progress })
      : service.inspectConnectedDevelopmentInputs(session.sessionId, {}, requestContext);
  });
  return service;
}

export { createService };
