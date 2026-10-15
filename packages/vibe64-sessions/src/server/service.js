import crypto from "node:crypto";
import { createMainBrowserConversations } from "./mainBrowserConversations.js";
import { assertSessionRepositoryReview, sessionConnectedContribution, sessionConnectedSources, sessionConnectedSubmissions, sessionRepositoryDestination, sessionRepositoryProject } from "@local/vibe64-core/server/projectRepository";
import { ASSISTANT_ROUTING_METADATA, assistantRoutingPreferences, assistantRoutingFromMetadata, assistantRoutingStatusIsPending } from "@local/vibe64-runtime/shared/assistantRouting";

import { vibe64Result } from "@local/vibe64-core/server/serverResponses";
import {
  assertProjectEffectAdmission,
  captureProjectRequestContext,
  currentProjectRequestContext,
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
  actions = null,
  initializeModelRouting,
  project,
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
    isPrepared: (sessionId) => typeof terminals.workspaceSetupIsPrepared === "function"
      ? terminals.workspaceSetupIsPrepared(sessionId)
      : undefined,
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
  const activeWorkInspections = new Map();
  let archivePreparation = null;
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

  function executeConnectedAction(projectSlug, actionId, input, requestContext = {}) {
    const origin = currentProjectRequestContext();
    if (!origin?.slug || origin.learningScope || origin.slug === projectSlug ||
        !actions || !requestContext.requestMeta?.request) {
      throw Object.assign(new Error("Use the originating working project's authenticated session for connected work."), {
        code: "vibe64_connected_source_authority_required"
      });
    }
    return actions.execute({
      actionId, input: { ...input, projectSlug },
      context: { surface: "app", channel: "internal", requestMeta: {
        ...requestContext.requestMeta,
        request: { ...requestContext.requestMeta.request, headers: requestContext.requestMeta.request.headers,
          params: { slug: projectSlug } }
      } }
    });
  }

  async function inspectConnectedWork(session, requestContext, bindings = sessionConnectedSources(session), captureSnapshots = false) {
    const submissions = sessionConnectedSubmissions(session);
    const connected = [];
    for (const binding of bindings) {
      const submittedCommit = submissions.find(item => item.contribution.id === binding.contribution.id)?.submittedCommit || "";
      const work = await executeConnectedAction(binding.projectSlug, "vibe64.sessions.connected.work.inspect", {
        contribution: binding.contribution,
        ...(submittedCommit ? { submittedCommit } : {})
      }, requestContext);
      if (work?.ok !== true) throw Object.assign(new Error(work?.error || "The connected source could not be inspected."), {
        code: work?.code || "vibe64_connected_source_unavailable",
        details: { repository: binding.contribution.repository, projectSlug: binding.projectSlug, ...work?.details }
      });
      const publishedCommit = work.publishedCommit === binding.contribution.baseCommit ? "" : text(work.publishedCommit);
      connected.push({
        ...binding, destination: work.destination,
        ...(captureSnapshots ? { snapshot: {
          contribution: binding.contribution,
          sessionId: binding.contribution.id,
          worktreePath: work.worktreePath,
          baseCommit: work.baseCommit,
          canonicalCommit: work.canonicalCommit,
          sessionHead: work.sessionHead,
          worktreeTree: work.worktreeTree
        } } : {}),
        unsaved: work.unsaved === true || work.ahead > 0,
        publishedCommit, submittedCommit,
        needsSave: work.unsaved === true || work.ahead > 0 || Boolean(publishedCommit && publishedCommit !== submittedCommit),
        reconciled: work.operation?.status !== "running" && work.operation?.reconciled !== false
      });
    }
    return connected;
  }

  async function assertConnectedWorkSaved(runtime, sessionId, requestContext) {
    const current = await runtime.getSession(sessionId, { inspectSource: false });
    const connected = await inspectConnectedWork(current, requestContext, sessionConnectedSources(current), true);
    const pending = connected.find(item => item.needsSave || !item.reconciled);
    if (pending) throw Object.assign(new Error(
      pending.needsSave
        ? `Save connected work in ${pending.contribution.repository} before saving the main project.`
        : `Reconcile the published work in ${pending.contribution.repository} before saving the main project.`
    ), { code: "vibe64_connected_save_required", details: {
      repository: pending.contribution.repository, projectSlug: pending.projectSlug,
      sessionId: pending.contribution.id
    } });
    return connected.map(item => item.snapshot);
  }

  async function saveConnectedWork(sessionId, input, requestContext) {
    const saved = [];
    let failedRepository = "";
    const result = await sessionResult(() => terminals.runConnectedSessionSave(sessionId, input, async ({ runtime, session }) => {
      assertProjectEffectAdmission();
      assertSessionRepositoryReview(await project.readCurrentProject(), session, input.destinationReview);
      const connected = await inspectConnectedWork(session, requestContext);
      if (!Array.isArray(input.connectedReview) || input.connectedReview.length !== connected.length ||
          connected.some((item, index) => {
            const review = input.connectedReview[index];
            return review?.projectSlug !== item.projectSlug ||
              Object.entries(item.destination).some(([key, value]) => review.destination?.[key] !== value);
          })) {
        throw Object.assign(new Error("The connected Save destinations changed. Inspect work and review them again."), {
          code: "vibe64_connected_save_review_changed"
        });
      }
      const submissions = sessionConnectedSubmissions(session);
      for (const reviewed of connected) {
        failedRepository = reviewed.contribution.repository;
        // Earlier repositories can take time to publish. Recheck this source
        // at its turn rather than skipping work from the initial review snapshot.
        const [item] = await inspectConnectedWork(
          await runtime.getSession(sessionId, { inspectSource: false }), requestContext, [reviewed]
        );
        if (Object.entries(reviewed.destination).some(([key, value]) => item.destination?.[key] !== value)) {
          throw Object.assign(new Error("The connected Save destination changed. Inspect work and review it again."), {
            code: "vibe64_connected_save_review_changed"
          });
        }
        if (!item.needsSave) continue;
        const publication = item.unsaved
          ? await executeConnectedAction(item.projectSlug, "vibe64.sessions.connected.work.save", {
              contribution: item.contribution, destinationReview: item.destination
            }, requestContext)
          : { ok: true, status: "already_published", saveCommit: item.publishedCommit, reconciled: item.reconciled };
        if (publication?.ok !== true) throw Object.assign(new Error(publication?.error || "Connected Save was not confirmed."), {
          code: publication?.code || "vibe64_connected_save_failed", details: publication?.details
        });
        const entry = { contribution: item.contribution, submittedCommit: publication.saveCommit };
        const previous = submissions.findIndex(value => value.contribution.id === item.contribution.id);
        if (previous < 0) submissions.push(entry);
        else submissions[previous] = entry;
        const serialized = JSON.stringify({ schemaVersion: 1, submissions });
        sessionConnectedSubmissions({ metadata: { connected_submissions: serialized } });
        const completed = { projectSlug: item.projectSlug, repository: item.contribution.repository,
          sessionId: item.contribution.id, saveCommit: publication.saveCommit,
          status: publication.status, reconciled: publication.reconciled, recorded: false };
        saved.push(completed);
        // Persist every confirmed publication before attempting the next repository.
        // If this write fails, the receiving session's normal Save recovery remains
        // authoritative and a retry records that same commit without republishing.
        await runtime.store.writeMetadataValue(sessionId, "connected_submissions", serialized);
        completed.recorded = true;
      }
      return { ok: true, status: "connected_saved", connected: saved };
    }), "Connected work could not be saved.");
    return result?.ok === false
      ? { ...result, details: { ...result.details, connected: saved, failedRepository } }
      : result;
  }

  const renewal = createSessionRenewalController({
    prepareArchive: (context) => archivePreparation?.(context),
    project,
    publishSessionChanged,
    resolveRenewalActor,
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

  async function resolveSessionStart(input = {}, { session = null, vibe64User = null, mode = "senior" } = {}) {
    const explicitSelection = Object.keys(input.assistantSelection || {}).length
      ? await resolveAssistantSelection(input.assistantSelection, vibe64User, { configuredOnly: true })
      : null;
    const previous = session ? assistantRoutingFromMetadata(session.metadata) : null;
    const preferences = assistantRoutingPreferences({ mode, review: false,
      workflowEngineId: input.workflowEngineId || explicitSelection?.engineId || previous?.workflowEngineId || "opencode",
      ...(explicitSelection ? { override: explicitSelection } : {}) });
    if (explicitSelection && explicitSelection.engineId !== preferences.workflowEngineId) {
      throw new Error(`The starting ${mode === "junior" ? "Junior" : "Senior"} model must use the chosen workflow orchestrator.`);
    }
    const routingSetup = await initializeModelRouting({ engineIds: [preferences.workflowEngineId], vibe64User });
    if (routingSetup?.ok === false) throw Object.assign(new Error(routingSetup.error), { code: routingSetup.code, statusCode: routingSetup.statusCode });
    const decision = await terminals.resolveAssistantPurpose({ purpose: mode, workflowEngineId: preferences.workflowEngineId,
      ...(explicitSelection ? { override: { role: mode, selection: explicitSelection } } : {}) }, { vibe64User });
    if (!decision.available) throw Object.assign(new Error(decision.message), { code: decision.reasonCode, statusCode: 403 });
    await terminals.requireAssistantSelectionAccess(decision.effectiveSelection, {
      vibe64User, expectedConnectionIdentity: decision.connectionIdentity
    });
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
    } catch (error) {
      // Preparation cannot turn a completed repository update into a failed rebase.
      vibe64SessionDebugLog("server.sessions.workspaceSetup.afterUpdate.error", {
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
          code: "",
          error: "",
          status: "ready"
        }
      });
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

  async function archiveSession(sessionId, input = {}) {
    // One attempt keeps the same host callback even if configuration changes
    // while terminal shutdown is in progress.
    const prepareArchive = archivePreparation;
    return sessionResult(async () => {
      if (setupRunner.isRunning(sessionId)) {
        const error = new Error("Wait for workspace preparation to finish before archiving this session.");
        error.code = "vibe64_workspace_setup_running";
        throw error;
      }
      const runtime = await project.createRuntime({ inspectSource: false });
      const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
        const currentSession = await runtime.getSession(sessionId, {
          inspectSource: false
        });
        await runtime.store.assertSessionNotPinned(sessionId);
        const conversations = await runtime.store.listSessionConversations(sessionId);
        const routingRequests = [currentSession.metadata, ...conversations.map((record) => record.routingMetadata || {})]
          .map((metadata) => JSON.parse(metadata?.assistant_routing_request || "null"));
        if (routingRequests.some((request) => assistantRoutingStatusIsPending(request) || request?.helper)) {
          throw Object.assign(new Error("Finish or cancel pending chat routing and its cleanup before archiving this session."), {
            code: "vibe64_assistant_routing_pending", retryable: true
          });
        }
        const renewalSessions = await runtime.store.listSessionsForRenewal();
        const reservedSuccessor = renewalSessions.find((session) => (
          ["renewal_pending", "renewal_activating"].includes(text(session.status)) &&
          text(session.metadata?.renewed_from) === sessionId
        ));
        if (reservedSuccessor) {
          const error = new Error("Finish the session renewal using Retry before archiving its original session.");
          error.code = "vibe64_session_renewal_blocks_archive";
          throw error;
        }
        const sourceCreationFailed = currentSession.sourceReady !== true &&
          text(currentSession.metadata?.source_creation_failed).toLowerCase() === "yes";
        const stored = text(currentSession.metadata?.session_archive_operation);
        const previous = stored ? JSON.parse(stored) : {};
        if (stored && (!["running", "failed"].includes(previous.status) ||
          !["stopping", "resources", "source"].includes(previous.phase))) {
          throw new Error("Session archive state is invalid; its recovery evidence was preserved.");
        }
        const operation = {
          phase: previous.status === "failed" && !currentSession.metadata?.session_closing_reason
            ? "stopping"
            : previous.phase || (currentSession.metadata?.source_recovery_saved === "yes" ? "source" : "stopping"),
          startedAt: previous.status === "running" && previous.startedAt || new Date().toISOString(),
          status: "running"
        };
        const persist = () => runtime.store.writeMetadataValue(
          sessionId, "session_archive_operation", JSON.stringify(operation)
        );
        async function advanceArchivePhase(phase) {
          operation.phase = phase;
          await persist();
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-archive-progress",
            payload: { clientRefresh: { includeList: true } }
          });
        }
        await persist();
        try {
          const closingSession = await runtime.markSessionClosing(sessionId, {
            reason: "archived"
          });
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-archiving",
            payload: { clientRefresh: { includeList: true } },
            session: closingSession
          });
          if (operation.phase === "stopping") {
            await terminals.closeSessionTerminals(sessionId, { session: currentSession });
            if (typeof terminals.removeOutputResultsForSession === "function") {
              await terminals.removeOutputResultsForSession(sessionId);
            }
          }
          if (prepareArchive) {
            const prepared = await prepareArchive({
              phase: operation.phase,
              runtime,
              session: await runtime.getSession(sessionId, { inspectSource: false })
            });
            if (prepared?.ok === false) {
              throw Object.assign(new Error(prepared.error || "Session archive preparation failed."), {
                code: prepared.code || "vibe64_session_archive_preparation_failed"
              });
            }
          }
          if (operation.phase === "stopping") {
            await advanceArchivePhase("resources");
          }
          if (operation.phase === "resources") {
            if (!sourceCreationFailed && typeof project.releaseSessionResources === "function") {
              const released = await project.releaseSessionResources({ sessionId });
              if (released?.ok === false) {
                throw new Error(released.error || "Session resources could not be archived.");
              }
            }
            await advanceArchivePhase("source");
          }
          return await runtime.archiveSession(sessionId);
        } catch (error) {
          operation.status = "failed";
          operation.error = text(error?.message) || "Session archive failed. Retry archiving this session.";
          await persist().catch(() => null);
          const restoredSession = await runtime.clearSessionClosing(sessionId).catch(() => null);
          await publishSessionChanged(sessionId, {
            operation: "updated",
            originId: text(input.originId),
            reason: "session-archive-failed",
            payload: { archiveError: operation.error, clientRefresh: { includeList: true } },
            session: restoredSession
          }).catch(() => null);
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
        payload: { clientRefresh: { includeList: true } },
        session
      });
      return publicSession(session);
    }, "Vibe64 could not archive this session.");
  }

  async function prepareConnectedSourcesInsideAgentWrite({ runtime, session }, input = {}, requestContext = {}) {
    const sessionId = session.sessionId;
    const prepared = [];
    const resolvedSources = [];
    let preparingRepository = "";
    const result = await sessionResult(async () => {
      assertProjectEffectAdmission();
      const origin = currentProjectRequestContext();
      if (!origin?.slug || origin.learningScope || !actions || !requestContext.requestMeta?.request) {
        throw Object.assign(new Error("Prepare connected sources from the originating working project's authenticated session."), {
          code: "vibe64_connected_source_authority_required"
        });
      }
      const targets = await project.connectedProjectTargets({ sessionId, vibe64User: trustedAssistantUser(input) });
      const sources = sessionConnectedSources(session);
      for (const target of targets) {
        preparingRepository = target.repository;
        if (target.projectSlug === origin.slug) throw Object.assign(new Error(
          "A project cannot prepare itself as a connected contribution."), { code: "vibe64_connected_source_self_reference" });
        const repository = target.repository.slice("https://github.com/".length);
        const source = await executeConnectedAction(target.projectSlug, "vibe64.sessions.connected.source", {}, requestContext);
        if (source.repository !== repository) throw Object.assign(new Error(
          "The receiving project changed repositories. Review the connection before preparing it."), {
          code: "vibe64_contribution_authority_changed"
        });
        let binding = sources.find(item => item.contribution.repository === repository);
        if (binding && (binding.projectSlug !== target.projectSlug || binding.contribution.integrationBranch !== source.integrationBranch)) {
          throw Object.assign(new Error("This connection already owns a different source binding. Preserve its work and reconcile that binding before changing its project or target."), {
            code: "vibe64_contribution_authority_changed"
          });
        }
        if (!binding) {
          binding = { projectSlug: target.projectSlug, contribution: {
            schemaVersion: 1, id: crypto.randomUUID(), ...source
          } };
          sources.push(binding);
          const serialized = JSON.stringify({ schemaVersion: 1, sources });
          sessionConnectedSources({ metadata: { connected_sources: serialized } });
          // Reserve the exact identity before creation, so a lost response or
          // partial preparation retries the same source instead of cloning again.
          await runtime.store.writeMetadataValue(sessionId, "connected_sources", serialized);
        }
        const result = await executeConnectedAction(binding.projectSlug, "vibe64.sessions.connected.allocate", {
          contribution: binding.contribution,
          workflowEngineId: assistantRoutingFromMetadata(session.metadata).workflowEngineId
        }, requestContext);
        if (result?.ok === false) return { ...result, prepared };
        prepared.push({ repository, projectSlug: binding.projectSlug, sessionId: binding.contribution.id,
          sourceReady: result.sourceReady === true, workspaceSetup: result.workspaceSetup });
        if (result.sourceReady !== true) return {
          ok: false,
          code: "vibe64_connected_source_unavailable",
          error: `The contribution source for ${repository} is not ready. Open its session in ${binding.projectSlug} and recover the source before retrying.`
        };
        resolvedSources.push({ repository: target.repository, projectSlug: binding.projectSlug, session: result });
      }
      preparingRepository = "";
      const development = await project.prepareConnectedDevelopmentInputs({
        session: await runtime.getSession(sessionId, { inspectSource: false }),
        projects: resolvedSources,
        environment: await runtime.resolvePromptEnvironment()
      });
      return { ok: true, prepared, development };
    });
    return result?.ok === false ? {
      ...result, prepared,
      ...(preparingRepository ? { failedRepository: preparingRepository } : {})
    } : result;
  }

  const service = Object.freeze({
    ...renewal,
    async prepareConnectedSources(sessionId, input = {}, requestContext = {}) {
      return sessionResult(() => terminals.runConnectedSourcePreparation(sessionId, input,
        context => prepareConnectedSourcesInsideAgentWrite(context, input, requestContext)));
    },
    inspectConnectedContributionSource(input = {}) {
      return project.connectedContributionSource(input);
    },
    async inspectConnectedDevelopmentInputs(sessionId, input = {}, requestContext = {}) {
      return sessionResult(async () => {
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        const targets = await project.connectedProjectTargets({ sessionId, vibe64User: trustedAssistantUser(input) });
        const bindings = sessionConnectedSources(session);
        const projects = [];
        for (const target of targets) {
          const binding = bindings.find(item => `https://github.com/${item.contribution.repository}` === target.repository);
          if (!binding || binding.projectSlug !== target.projectSlug) throw Object.assign(new Error(
            "The connected project list no longer matches this task. Prepare connected sources again."), {
            code: "vibe64_connected_inputs_required"
          });
          const receiving = await executeConnectedAction(binding.projectSlug, "vibe64.sessions.connected.work.inputs", {
            contribution: binding.contribution
          }, requestContext);
          if (receiving?.ok === false) return receiving;
          projects.push({ repository: target.repository, projectSlug: binding.projectSlug, session: receiving });
        }
        return project.inspectConnectedDevelopmentInputs({ session, projects, environment: await runtime.resolvePromptEnvironment() });
      });
    },
    async connectedContributionWork(operation, input = {}, requestContext = {}) {
      return sessionResult(async () => {
        const contribution = sessionConnectedContribution({ metadata: {
          connected_contribution: JSON.stringify(input.contribution)
        } });
        if (!contribution) throw new TypeError("Connected work requires its exact saved contribution binding.");
        const source = await project.connectedContributionSource(input);
        const runtime = await project.createRuntime({ inspectSource: false });
        const session = await runtime.getSession(contribution.id, { inspectSource: false });
        const saved = sessionConnectedContribution(session);
        if (source.repository !== contribution.repository || source.integrationBranch !== contribution.integrationBranch ||
            !saved || Object.entries(contribution).some(([key, value]) => saved[key] !== value)) {
          throw Object.assign(new Error("The receiving source binding changed. Preserve its checkout and review the connection."), {
            code: "vibe64_contribution_authority_changed"
          });
        }
        if (operation === "inputs") return session;
        if (operation === "save") return service.saveSessionWork(contribution.id, input, requestContext);
        const work = await service.inspectSessionWork(contribution.id, {}, {
          includeConnected: false, inspectContributionPublication: true, knownSubmittedCommit: text(input.submittedCommit)
        });
        if (work.ok === false) return work;
        if (work.operation?.status === "failed" && work.operation.code === "vibe64_session_save_publication_unknown") {
          throw Object.assign(new Error(work.operation.error || "Connected publication is still unknown. Inspect work before retrying."), {
            code: work.operation.code
          });
        }
        return work;
      });
    },
    async allocateConnectedSource(input = {}) {
      return sessionResult(async () => {
        assertProjectEffectAdmission();
        if (currentProjectRequestContext()?.learningScope) throw new TypeError("Learning cannot allocate working contribution sources.");
        const contribution = sessionConnectedContribution({ metadata: { connected_contribution: JSON.stringify(input.contribution) } });
        if (!contribution) throw new TypeError("Contribution allocation requires an exact saved binding.");
        const source = await project.connectedContributionSource(input);
        if (source.repository !== contribution.repository || source.integrationBranch !== contribution.integrationBranch) {
          throw Object.assign(new Error("The receiving repository or integration target changed. Review the source binding."), {
            code: "vibe64_contribution_authority_changed"
          });
        }
        const runtime = await project.createRuntime({ inspectSource: false });
        let existing;
        try { existing = await runtime.getSession(contribution.id, { inspectSource: false }); }
        catch (error) { if (error.code !== "vibe64_session_not_found") throw error; }
        if (existing) {
          const saved = sessionConnectedContribution(existing);
          if (!saved || Object.entries(contribution).some(([key, value]) => saved[key] !== value)) {
            throw Object.assign(new Error("The reserved contribution identity belongs to a different source. Preserve both bindings before retrying."), {
              code: "vibe64_contribution_authority_changed"
            });
          }
          if (!vibe64SessionStatusIsOpen(existing.status)) throw Object.assign(new Error(
            "This contribution session is no longer open. Restore its source through the receiving project's recovery controls."), {
            code: "vibe64_connected_source_unavailable"
          });
          return publicSession(existing);
        }
        return service.createSession({ workflowEngineId: input.workflowEngineId, vibe64User: trustedAssistantUser(input) }, {
          sessionId: contribution.id, expectedCommit: contribution.baseCommit, connectedContribution: contribution
        });
      });
    },
    browserConversations: actions ? createMainBrowserConversations({ actions, terminals }) : null,
    closeSessionPresence() {
      sessionPresence?.close?.();
    },
    setArchivePreparation(prepare = null) {
      if (prepare !== null && typeof prepare !== "function") {
        throw new TypeError("Session archive preparation must be a function or null.");
      }
      archivePreparation = prepare;
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

    archiveSession,
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
    async resumeSessionArchives({ signal = null } = {}) {
      const runtime = await project.createRuntime({ inspectSource: false });
      for (const sessionId of await runtime.store.recoverSessionArchives()) {
        await publishSessionChanged(sessionId, {
          reason: "session-archived",
          payload: { clientRefresh: { includeList: true } }
        });
      }
      const sessions = await runtime.listSessionSummaries({ statusGroup: "open" });
      const failures = [];
      for (const session of sessions) {
        if (signal?.aborted) break;
        if (session.status === "archived") continue;
        const stored = text(session.metadata?.session_archive_operation);
        const operation = stored ? JSON.parse(stored) : null;
        if (operation?.status === "failed") continue;
        if (operation?.status !== "running" && session.metadata?.session_closing_reason !== "archived") continue;
        const result = await archiveSession(session.sessionId);
        if (result?.ok === false) failures.push({ sessionId: session.sessionId, ...result });
      }
      return { failures };
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
          contribution = sessionConnectedContribution({ metadata: { connected_contribution: JSON.stringify(connectedContribution) } });
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
      return sessionResult(() => terminals.inspectIncomingContributions(requiredRepositorySessionId(sessionId), {
        ...input, vibe64User: trustedAssistantUser(input)
      }), "Incoming changes could not be read. Refresh before acting.");
    },

    async changeIncomingContribution(sessionId, input = {}) {
      return sessionResult(async () => {
        const result = await terminals.changeIncomingContribution(requiredRepositorySessionId(sessionId), {
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
      }, "The pull request could not be confirmed. Retry to check GitHub and continue publishing.");
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
            throw Object.assign(new Error(recovered.error || "Inspect the uncertain Save before publishing again."), {
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
          await prepareUpdatedWorkspace(runtime, sessionId, { originId: input.originId });
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
          ...(runtime.learningScope && options.browserAuthority ? { browserAuthority: options.browserAuthority } : {}),
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
        const save = async () => {
          const apply = async ({ deferred = false } = {}) => {
            const session = await runtime.getSession(sessionId, { inspectSource: false });
            const current = vibe64AssistantSelectionFromMetadata(session.metadata);
            let preferences = null;
            let resolved;
            let connectionIdentity;
            if (input.assistantRouting && input.assistantRouting.mode !== "custom") {
              const previous = assistantRoutingFromMetadata(session.metadata);
              const previousWorkflow = previous?.workflowEngineId || current.engineId;
              preferences = assistantRoutingPreferences({ ...input.assistantRouting,
                workflowEngineId: input.assistantRouting.workflowEngineId || previousWorkflow });
              if (["senior", "junior"].includes(preferences.mode) && preferences.override?.engineId &&
                  preferences.override.engineId !== preferences.workflowEngineId) throw new Error("Senior and Junior overrides must use the workflow orchestrator.");
              if (preferences.workflowEngineId === previousWorkflow) {
                const observed = typeof terminals.readAgentGoal === "function"
                  ? await terminals.readAgentGoal(sessionId, { runtime, session, vibe64User }) : null;
                const pinned = JSON.parse(session.metadata.assistant_routing_goal || "null");
                const goal = observed?.status === "available" ? observed.goal : observed?.goal || pinned;
                if (!goal || ["complete", "completed"].includes(goal.status)) {
                  await runtime.store.writeMetadataValue(sessionId, ASSISTANT_ROUTING_METADATA, JSON.stringify(preferences));
                  return { assistantSelection: current, session: await runtime.getSession(sessionId, { inspectSource: false }) };
                }
              }
              const decision = await terminals.resolveAssistantPurpose({
                purpose: preferences.mode, workflowEngineId: preferences.workflowEngineId, reviewEnabled: preferences.review,
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
            const agentSession = typeof terminals.agentSessionState === "function"
              ? await terminals.agentSessionState(sessionId, { runtime, session })
              : null;
            const next = resolved;
            const observedGoal = typeof terminals.readAgentGoal === "function"
              ? await terminals.readAgentGoal(sessionId, { runtime, session, vibe64User }) : null;
            const goal = observedGoal?.status === "available" ? observedGoal.goal
              : observedGoal?.goal || agentSession?.goal || JSON.parse(session.metadata.assistant_routing_goal || "null");
            const nextPreferences = preferences || {
              mode: "custom", review: false, workflowEngineId: next.engineId, override: next
            };
            if (deferred || agentSession?.turn?.active || goal && !["complete", "completed"].includes(goal.status)) {
              await terminals.applyGoalSelection(sessionId, next, nextPreferences, { runtime, session, vibe64User });
              await runtime.store.writeMetadataValue(sessionId, ASSISTANT_ROUTING_METADATA, JSON.stringify(nextPreferences));
              return { assistantSelection: current, session: await runtime.getSession(sessionId, { inspectSource: false }) };
            }
            const routingRequest = JSON.parse(session.metadata.assistant_routing_request || "null");
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
  terminals.setConnectedPreparation?.(async ({ mode, runtime, session }) => {
    const requestContext = { requestMeta: currentProjectActionRequestMeta() };
    return mode === "prepare"
      ? prepareConnectedSourcesInsideAgentWrite({ runtime, session }, {}, requestContext)
      : service.inspectConnectedDevelopmentInputs(session.sessionId, {}, requestContext);
  });
  return service;
}

export { createService };
