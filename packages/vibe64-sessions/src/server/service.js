import crypto from "node:crypto";

import {
  vibe64AgentRunStateIsActive,
  VIBE64_SESSION_STATUS,
  VIBE64_WORKFLOW_DEFINITION_IDS,
  workflowDefinitionCreationOptions
} from "@local/vibe64-runtime/server";
import {
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";
import {
  VIBE64_ACTION_DISPATCH_ROUTES
} from "@local/vibe64-core/shared";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  assertSessionWorkflowDriverOrigin,
  claimSessionWorkflowDriver
} from "@local/vibe64-core/server/sessionWorkflowDriver";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  projectRepositoryView,
  workflowRepositoryProfileForMode
} from "@local/vibe64-core/server/projectRepository";
import {
  readSessionUiSyncState,
  writeSessionUiSyncPreviewState,
  writeSessionUiSyncViewState
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  assertVibe64SessionReady,
  normalizeSetupOptions,
  readVibe64SessionReadiness
} from "@local/vibe64-runtime/server/setupReadiness";
import {
  terminalFailureFixRequestForSession
} from "@local/vibe64-runtime/server/terminalFailureFixRequest";
import { inspectSessionDiff } from "./sessionDiff.js";
import {
  createComposerHandoffCoordinator
} from "./composer/handoffCoordinator.js";
import {
  COMPOSER_CONTROL_KINDS,
  COMPOSER_HANDOFF_AGENT_RUN_ID,
  COMPOSER_HANDOFF_STATES,
  acceptComposerControl,
  attachComposerHandoffMessages,
  composerHandoffId,
  composerHandoffRun,
  composerHandoffSnapshot,
  pendingComposerControls,
  settleComposerControl,
  transitionComposerHandoff
} from "./composer/handoffState.js";
import {
  COMPOSER_MESSAGE_AGENT_RUN_ID,
  COMPOSER_MESSAGE_SETTLEMENTS,
  COMPOSER_MESSAGE_STATES,
  acceptComposerMessage,
  cancelComposerMessage,
  composerMessageBatch,
  pendingComposerMessages,
  publicComposerMessages,
  settleComposerMessage
} from "./composer/messageState.js";

const MAX_OPEN_VIBE64_SESSIONS = 3;
const AGENT_SESSION_WORKTREE_UNAVAILABLE_CODE = "vibe64_session_worktree_unavailable";
const AGENT_TURN_ALREADY_RUNNING_CODE = "vibe64_agent_turn_already_running";
const AGENT_TURN_RESULT_MISSING_MESSAGE = "The assistant finished this turn, but Vibe64 did not receive its result text. Retry the step.";
const VIBE64_ACTION_DISABLED_CODE = "vibe64_action_disabled";
const VIBE64_ADVANCE_STATE_CHANGED_CODE = "vibe64_advance_state_changed";
const STEP_STATUS_AWAITING_AGENT_RESULT = "awaiting_agent_result";
const STEP_STATUS_DONE = "done";
const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);
const SESSION_CLOSE_ACTION_IDS = new Set(["finish_session"]);
const SESSION_CLOSE_INTENT_IDS = new Set(["archive_session"]);
const SESSION_ARCHIVE_QUERY = Object.freeze({
  ABANDONED: "abandoned",
  COMPLETED: "completed",
  FINISHED: "finished"
});
const COMPOSER_DRAFT_ARTIFACT_ROOT = "tmp/composer-drafts";
const COMPOSER_DRAFT_KIND = Object.freeze({
  DRAFT: "draft",
  SUBMISSION_REJECTED: "submission_rejected",
  SUBMISSION_START: "submission_start"
});
const COMPOSER_MESSAGE_AUTOMATIC_RETRY_LIMIT = 8;
const COMPOSER_MESSAGE_AUTOMATIC_RETRY_WINDOW_MS = 30_000;
const COMPOSER_MESSAGE_RETRY_EXHAUSTED_ERROR = "The assistant stayed unavailable for this message. Resend it to try again.";

function sessionResult(operation, {
  publicResponse = true,
  publicResponseOptions = {}
} = {}) {
  const resultOperation = publicResponse
    ? async () => publicSessionServiceResponse(await operation(), publicResponseOptions)
    : operation;
  return vibe64Result(resultOperation, {
    fallbackCode: "vibe64_session_request_failed",
    fallbackMessage: "Vibe64 session request failed."
  });
}

function isOpenVibe64Session(session = {}) {
  return !CLOSED_SESSION_STATUSES.has(String(session.status || ""));
}

function sessionWithClientRefreshHint(session = {}) {
  return {
    ...session,
    clientRefresh: {
      ...(isPlainObject(session.clientRefresh) ? session.clientRefresh : {}),
      includeList: true
    }
  };
}

function normalizedInputText(value = "") {
  return String(value || "").trim();
}

function inputFlagEnabled(value = false) {
  if (value === true) {
    return true;
  }
  const text = normalizedInputText(value).toLowerCase();
  return text === "1" || text === "true" || text === "yes" || text === "on";
}

function timestampMs(value = "") {
  const timestamp = Date.parse(normalizedInputText(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function timestampIsAfter(value = "", referenceMs = null) {
  const timestamp = timestampMs(value);
  return timestamp !== null && referenceMs !== null && timestamp >= referenceMs;
}

function composerMessageAutomaticRetryExhausted(batch = {}, now = Date.now()) {
  return (Array.isArray(batch.messages) ? batch.messages : []).some((message) => {
    const submittedAtMs = timestampMs(message.submittedAt);
    return Number(message.attempts || 0) + 1 >= COMPOSER_MESSAGE_AUTOMATIC_RETRY_LIMIT || (
      submittedAtMs !== null && now - submittedAtMs >= COMPOSER_MESSAGE_AUTOMATIC_RETRY_WINDOW_MS
    );
  });
}

function isPlainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value);
}

function sessionListOptions(input = {}) {
  const archive = normalizedInputText(input.archive);
  if (!archive) {
    return {
      runtimeOptions: {
        statusGroup: "open"
      }
    };
  }
  if (archive === SESSION_ARCHIVE_QUERY.ABANDONED) {
    return {
      runtimeOptions: {
        statusGroup: "closed",
        statuses: [VIBE64_SESSION_STATUS.ABANDONED]
      }
    };
  }
  if (archive === SESSION_ARCHIVE_QUERY.COMPLETED || archive === SESSION_ARCHIVE_QUERY.FINISHED) {
    return {
      runtimeOptions: {
        statusGroup: "closed",
        statuses: [VIBE64_SESSION_STATUS.FINISHED]
      }
    };
  }
  throw new Error(`Unknown Vibe64 session archive: ${archive}`);
}

function readinessOptions(input = {}, setupOptions = {}) {
  return {
    ...normalizeSetupOptions(setupOptions),
    input: {
      vibe64User: input?.vibe64User || null,
      refresh: input?.refresh === true
    }
  };
}

function stripInternalInput(input = {}) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return {};
  }
  const {
    agentSettings: _agentSettings,
    composerSubmissionId: _composerSubmissionId,
    displayFields: _displayFields,
    displayInput: _displayInput,
    originId: _originId,
    vibe64User: _vibe64User,
    ...publicInput
  } = input;
  return publicInput;
}

function stepDefinitionById(session = {}, stepId = "") {
  const normalizedStepId = normalizedInputText(stepId);
  if (!normalizedStepId || !Array.isArray(session.stepDefinitions)) {
    return null;
  }
  return session.stepDefinitions.find((step) => normalizedInputText(step?.id) === normalizedStepId) || null;
}

function sessionAlreadyObservedAdvance(session = {}, expected = {}) {
  const expectedStepId = normalizedInputText(expected?.stepId);
  const expectedStepStatus = normalizedInputText(expected?.stepStatus);
  if (!expectedStepId || expectedStepStatus !== STEP_STATUS_DONE) {
    return false;
  }
  const expectedStep = stepDefinitionById(session, expectedStepId);
  const currentStep = stepDefinitionById(session, session.currentStep);
  if (!expectedStep || !currentStep || expectedStep.status !== STEP_STATUS_DONE) {
    return false;
  }
  return Number(currentStep.index) > Number(expectedStep.index);
}

async function observeAlreadyAdvancedSession(runtime, sessionId = "", expected = {}) {
  if (typeof runtime?.getSession !== "function") {
    return null;
  }
  const session = await runtime.getSession(sessionId).catch(() => null);
  return sessionAlreadyObservedAdvance(session, expected) ? session : null;
}

async function closedSessionResponseForCloseRetry(runtime, sessionId = "", closeRequest = false) {
  if (!closeRequest || typeof runtime?.getSession !== "function") {
    return null;
  }
  const session = await runtime.getSession(sessionId).catch((error) => {
    if (normalizedInputText(error?.code) === "vibe64_session_not_found") {
      return null;
    }
    throw error;
  });
  return session && !isOpenVibe64Session(session)
    ? sessionWithClientRefreshHint(session)
    : null;
}

function agentSettingsInput(input = {}) {
  return normalizeVibe64AgentSettings(input?.agentSettings);
}

function composerSubmissionIdInput(input = {}) {
  return normalizedInputText(input?.composerSubmissionId);
}

function conversationDisplayInput(input = {}) {
  const displayInput = objectValue(input?.displayInput);
  if (Object.keys(displayInput).length > 0) {
    return displayInput;
  }
  const displayFields = objectValue(input?.displayFields);
  if (Object.keys(displayFields).length > 0) {
    return {
      fields: displayFields
    };
  }
  return null;
}

async function listSessionSummaries(runtime, options = {}) {
  if (typeof runtime?.listSessionSummaries === "function") {
    return runtime.listSessionSummaries(options);
  }
  return runtime.listSessions(options);
}

async function listOpenSessionSummaries(runtime) {
  return listSessionSummaries(runtime, {
    statusGroup: "open"
  });
}

function agentPromptHandoffFromSession(session = {}) {
  const handoff = session?.actionResult?.agentPromptHandoff;
  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    return null;
  }
  return String(handoff.kind || "") === "agent_prompt_handoff" ? handoff : null;
}

function actionResultsForSession(session = {}) {
  return [
    ...(session?.actionResult ? [session.actionResult] : []),
    ...(Array.isArray(session?.actionResults) ? session.actionResults : [])
  ].filter(isPlainObject);
}

function acceptedPromptActionResult(session = {}, actionId = "") {
  const normalizedActionId = normalizedInputText(actionId);
  if (!normalizedActionId) {
    return null;
  }
  return actionResultsForSession(session).find((result) => (
    normalizedInputText(result?.actionId) === normalizedActionId &&
    normalizedInputText(result?.status) === "prompt_ready" &&
    normalizedInputText(result?.agentPromptHandoff?.kind) === "agent_prompt_handoff"
  )) || null;
}

function sessionHasPromptActionInFlight(session = {}) {
  return sessionAwaitsAgentResult(session) &&
    Boolean(normalizedInputText(session?.stepMachine?.promptActionId));
}

function objectValue(value) {
  return isPlainObject(value) ? value : {};
}

function normalizedComposerDraftKind(value = "") {
  const kind = normalizedInputText(value || COMPOSER_DRAFT_KIND.DRAFT);
  return Object.values(COMPOSER_DRAFT_KIND).includes(kind) ? kind : COMPOSER_DRAFT_KIND.DRAFT;
}

function normalizedComposerDraftFields(fields = {}) {
  return Object.fromEntries(
    Object.entries(objectValue(fields))
      .map(([key, value]) => [normalizedInputText(key), String(value ?? "")])
      .filter(([key]) => Boolean(key))
  );
}

function composerDraftRevision(value = 0) {
  const revision = Number.parseInt(String(value || ""), 10);
  return Number.isFinite(revision) && revision > 0 ? revision : 0;
}

function composerDraftArtifactSegment(value = "") {
  const segment = normalizedInputText(value)
    .replace(/[^A-Za-z0-9_.-]+/gu, "_")
    .replace(/^[^A-Za-z0-9]+/u, "")
    .slice(0, 96);
  return segment || "composer";
}

function composerDraftArtifactPath(controlId = "") {
  return `${COMPOSER_DRAFT_ARTIFACT_ROOT}/${composerDraftArtifactSegment(controlId)}.json`;
}

function parseComposerDraftJson(text = "") {
  if (!normalizedInputText(text)) {
    return null;
  }
  try {
    const draft = JSON.parse(text);
    return isPlainObject(draft) ? draft : null;
  } catch {
    return null;
  }
}

function normalizedStoredComposerDraft(draft = {}) {
  const source = objectValue(draft);
  const sessionId = normalizedInputText(source.sessionId);
  const controlId = normalizedInputText(source.controlId);
  const fieldName = normalizedInputText(source.fieldName);
  const originId = normalizedInputText(source.originId);
  if (!sessionId || !controlId || !fieldName || !originId) {
    return null;
  }
  return {
    baseRevision: composerDraftRevision(source.baseRevision),
    controlId,
    fieldName,
    fields: normalizedComposerDraftFields(source.fields),
    kind: normalizedComposerDraftKind(source.kind),
    originId,
    projectSlug: normalizedInputText(source.projectSlug),
    revision: composerDraftRevision(source.revision),
    sessionId,
    submissionId: normalizedInputText(source.submissionId),
    text: normalizedInputText(source.text),
    updatedAt: normalizedInputText(source.updatedAt)
  };
}

function projectAppRoutePrefix(projectSlug = "") {
  const normalizedProjectSlug = normalizedInputText(projectSlug);
  return normalizedProjectSlug ? `/app/project/${encodeURIComponent(normalizedProjectSlug)}` : "";
}

function normalizedLocalRoute(routeFullPath = "", maxLength = 2048) {
  const route = normalizedInputText(routeFullPath);
  if (
    !route ||
    route.length > maxLength ||
    /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(route) ||
    route.startsWith("//")
  ) {
    return "";
  }
  try {
    const parsed = new URL(route, "http://vibe64.local");
    if (parsed.origin !== "http://vibe64.local") {
      return "";
    }
    const pathname = parsed.pathname.replace(/\/{2,}/gu, "/") || "/";
    return `${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function normalizedSessionViewRoute(routeFullPath = "", projectSlug = "") {
  const route = normalizedLocalRoute(routeFullPath, 1024);
  const projectPrefix = projectAppRoutePrefix(projectSlug);
  if (!route || !projectPrefix) {
    return "";
  }
  try {
    const parsed = new URL(route, "http://vibe64.local");
    const pathname = parsed.pathname.replace(/\/+$/u, "") || "/";
    const dashboardPrefix = `${projectPrefix}/dashboard`;
    if (
      pathname !== projectPrefix &&
      pathname !== dashboardPrefix &&
      !pathname.startsWith(`${dashboardPrefix}/`)
    ) {
      return "";
    }
    return `${pathname}${parsed.search}${parsed.hash}`;
  } catch {
    return "";
  }
}

function sessionViewProjectPane(routeFullPath = "", projectSlug = "") {
  const projectPrefix = projectAppRoutePrefix(projectSlug);
  const route = normalizedSessionViewRoute(routeFullPath, projectSlug);
  if (!route || !projectPrefix) {
    return "";
  }
  const pathname = new URL(route, "http://vibe64.local").pathname.replace(/\/+$/u, "") || "/";
  return pathname === projectPrefix ? "preview" : "dashboard";
}

function emptyComposerDraftFields(fields = {}, fieldName = "") {
  const sourceFields = normalizedComposerDraftFields(fields);
  const emptyFields = Object.fromEntries(
    Object.keys(sourceFields).map((name) => [name, ""])
  );
  const normalizedFieldName = normalizedInputText(fieldName);
  if (!Object.keys(emptyFields).length && normalizedFieldName) {
    emptyFields[normalizedFieldName] = "";
  }
  return emptyFields;
}

function persistedComposerDraftPayload(payload = {}) {
  if (payload.kind === COMPOSER_DRAFT_KIND.SUBMISSION_START) {
    return {
      ...payload,
      fields: emptyComposerDraftFields(payload.fields, payload.fieldName),
      kind: COMPOSER_DRAFT_KIND.DRAFT,
      submissionId: "",
      text: ""
    };
  }
  if (payload.kind === COMPOSER_DRAFT_KIND.SUBMISSION_REJECTED) {
    return {
      ...payload,
      kind: COMPOSER_DRAFT_KIND.DRAFT,
      submissionId: ""
    };
  }
  return payload;
}

function composerDraftInputIsStale(existing = null, input = {}) {
  return Boolean(
    existing &&
    input.kind === COMPOSER_DRAFT_KIND.DRAFT &&
    composerDraftRevision(existing.revision) > composerDraftRevision(input.baseRevision)
  );
}

async function readStoredComposerDraft(runtime, sessionId = "", controlId = "") {
  const text = await runtime.store.readArtifact(sessionId, composerDraftArtifactPath(controlId));
  return normalizedStoredComposerDraft(parseComposerDraftJson(text));
}

async function writeStoredComposerDraft(runtime, draft = {}) {
  await runtime.store.writeArtifact(
    draft.sessionId,
    composerDraftArtifactPath(draft.controlId),
    `${JSON.stringify(draft, null, 2)}\n`
  );
}

function sessionReadinessDisabledReason(readiness = {}) {
  return normalizedInputText(readiness?.message) || "Vibe64 session setup is not ready.";
}

function sessionReadinessActionReadiness(readiness = {}) {
  if (readiness?.ready === true) {
    return undefined;
  }
  const disabledReason = sessionReadinessDisabledReason(readiness);
  return () => ({
    disabledReason,
    enabled: false
  });
}

function disabledBySessionReadiness(control = {}, disabledReason = "") {
  const value = objectValue(control);
  return {
    ...value,
    disabledReason: normalizedInputText(value.disabledReason) || disabledReason,
    enabled: false
  };
}

function blockedSessionOperation(operation = {}, disabledReason = "") {
  const value = objectValue(operation);
  if (value.executable !== true) {
    return operation;
  }
  return {
    executable: false,
    kind: "stop",
    reason: disabledReason
  };
}

function sessionViewWithReadiness(session = {}, readiness = {}) {
  if (readiness?.ready === true || !isPlainObject(session) || session.ok === false) {
    return session;
  }

  const disabledReason = sessionReadinessDisabledReason(readiness);
  const presentation = objectValue(session.presentation);
  const presentationAuto = objectValue(presentation.auto);
  const actions = Array.isArray(session.actions)
    ? session.actions.map((action) => disabledBySessionReadiness(action, disabledReason))
    : session.actions;
  const intents = Array.isArray(session.intents)
    ? session.intents.map((intent) => disabledBySessionReadiness(intent, disabledReason))
    : session.intents;
  const next = isPlainObject(session.next)
    ? disabledBySessionReadiness(session.next, disabledReason)
    : session.next;
  const presentationIntents = Array.isArray(presentation.intents)
    ? presentation.intents.map((intent) => disabledBySessionReadiness(intent, disabledReason))
    : presentation.intents;
  const presentationNext = isPlainObject(presentation.next)
    ? disabledBySessionReadiness(presentation.next, disabledReason)
    : presentation.next;

  return {
    ...session,
    actions,
    intents,
    next,
    presentation: {
      ...presentation,
      auto: {
        ...presentationAuto,
        nextOperation: blockedSessionOperation(presentationAuto.nextOperation, disabledReason)
      },
      intents: presentationIntents,
      next: presentationNext
    }
  };
}

function runtimeReadinessRecord(state = "idle", extra = {}) {
  return {
    ...extra,
    state
  };
}

function backgroundTaskRuntimeState(task = null, {
  idle = "idle",
  running = "restoring"
} = {}) {
  const status = normalizedInputText(task?.status).toLowerCase();
  if (!status) {
    return idle;
  }
  if (status === "ready" || status === "done" || status === "completed" || status === "success") {
    return "ready";
  }
  if (status === "failed" || status === "error") {
    return "failed";
  }
  if (status === "running" || status === "starting" || status === "pending" || status === "queued") {
    return running;
  }
  return idle;
}

function sessionBackgroundTaskById(session = {}, ids = []) {
  const wantedIds = new Set((Array.isArray(ids) ? ids : [ids]).map((id) => normalizedInputText(id)).filter(Boolean));
  if (wantedIds.size < 1) {
    return null;
  }
  return sessionBackgroundTasks(session).find((task) => wantedIds.has(normalizedInputText(task.id))) || null;
}

function agentProviderReadiness(session = {}) {
  const handoff = composerHandoffSnapshot(session);
  if (handoff?.state === COMPOSER_HANDOFF_STATES.FAILED) {
    return runtimeReadinessRecord("failed", {
      reason: handoff.error,
      source: "composer_handoff"
    });
  }
  if (handoff?.pending) {
    return runtimeReadinessRecord("restoring", {
      source: "composer_handoff"
    });
  }
  if (handoff?.state === COMPOSER_HANDOFF_STATES.ACTIVE) {
    return runtimeReadinessRecord("ready", {
      source: "composer_handoff"
    });
  }
  const activeRun = (Array.isArray(session.agentRuns) ? session.agentRuns : []).find((run) => (
    (run?.active === true || vibe64AgentRunStateIsActive(run?.state))
  ));
  return activeRun
    ? runtimeReadinessRecord("restoring", {
        runId: normalizedInputText(activeRun.id),
        source: "agent_run"
      })
    : runtimeReadinessRecord("idle", {
        source: "persisted_session"
      });
}

function terminalReconnectReadiness(session = {}, {
  runtimeEnrichmentRequested = false
} = {}) {
  if (!runtimeEnrichmentRequested) {
    return runtimeReadinessRecord("idle", {
      source: "persisted_session"
    });
  }
  const terminalId = normalizedInputText(
    session.agentSession?.terminal?.id ||
    session.presentation?.terminal?.agent?.terminalSessionId
  );
  return terminalId
    ? runtimeReadinessRecord("ready", {
        source: "runtime_enrichment",
        terminalSessionId: terminalId
      })
    : runtimeReadinessRecord("idle", {
        source: "runtime_enrichment"
      });
}

function previewLaunchReadiness(session = {}) {
  const task = sessionBackgroundTaskById(session, [
    "preview_launch",
    "preview",
    "app_preview"
  ]);
  return runtimeReadinessRecord(backgroundTaskRuntimeState(task, {
    idle: "idle",
    running: "restoring"
  }), {
    ...(task ? { source: "background_task", taskId: normalizedInputText(task.id) } : { source: "persisted_session" })
  });
}

function gitControlReconcileReadiness(session = {}) {
  const task = sessionBackgroundTaskById(session, [
    "git_control_reconcile",
    "codex_context"
  ]);
  const state = backgroundTaskRuntimeState(task, {
    idle: "pending",
    running: "running"
  });
  return runtimeReadinessRecord(state, {
    ...(task ? { source: "background_task", taskId: normalizedInputText(task.id) } : { source: "persisted_session" })
  });
}

function sessionWithRuntimeReadiness(session = {}, readiness = {}, options = {}) {
  if (!isPlainObject(session) || session.ok === false) {
    return session;
  }
  const runtimeEnrichmentRequested = options.runtimeEnrichmentRequested === true;
  return {
    ...session,
    runtimeReadiness: {
      agentProvider: agentProviderReadiness(session),
      gitControlReconcile: gitControlReconcileReadiness(session),
      previewLaunch: previewLaunchReadiness(session),
      sessionSetup: readiness?.ready === false
        ? runtimeReadinessRecord("failed", {
            reason: sessionReadinessDisabledReason(readiness),
            source: "setup_readiness"
          })
        : runtimeReadinessRecord("ready", {
            source: "setup_readiness"
          }),
      terminalReconnect: terminalReconnectReadiness(session, {
        runtimeEnrichmentRequested
      })
    }
  };
}

async function createRuntimeForSessionInspection(projectService, setupServices = {}, input = {}, setupOptions = {}) {
  const readiness = await readVibe64SessionReadiness(setupServices, readinessOptions(input, setupOptions));
  return {
    readiness,
    runtime: await projectService.createRuntime({
      actionReadiness: sessionReadinessActionReadiness(readiness),
      ...runtimeScopeForSession(input?.sessionId)
    })
  };
}

function runtimeScopeForSession(sessionId = "", options = {}) {
  return {
    ...options,
    sessionId: normalizedInputText(sessionId)
  };
}

function conversationRequestText(input = {}) {
  const inputObject = objectValue(input);
  const fields = objectValue(inputObject.fields);
  return normalizedInputText(
    inputObject.conversationRequest ||
    inputObject.feedback ||
    inputObject.message ||
    inputObject.response ||
    fields.conversationRequest ||
    fields.feedback ||
    fields.message ||
    fields.response
  );
}

const DEFAULT_CONVERSATION_LOG_PAGE_LIMIT = 20;

function conversationLogPageOptions(options = {}) {
  const source = objectValue(options);
  return {
    beforeTurnId: normalizedInputText(source.beforeTurnId || source.before),
    limit: normalizeConversationLogLimit(source.limit, DEFAULT_CONVERSATION_LOG_PAGE_LIMIT)
  };
}

function normalizeConversationLogLimit(value = "", fallback = DEFAULT_CONVERSATION_LOG_PAGE_LIMIT) {
  const number = Number.parseInt(String(value || ""), 10);
  if (!Number.isFinite(number) || number < 1) {
    return fallback;
  }
  return Math.min(number, 100);
}

function normalizeConversationLogPageResult(result = {}, fallbackOptions = {}) {
  if (Array.isArray(result)) {
    return {
      conversationLog: result,
      pagination: {
        beforeTurnId: fallbackOptions.beforeTurnId || "",
        count: result.length,
        hasMoreBefore: false,
        limit: fallbackOptions.limit || 0,
        newestTurnId: result.at(-1)?.turnId || "",
        nextBeforeTurnId: "",
        oldestTurnId: result[0]?.turnId || "",
        totalTurnCount: result.length
      }
    };
  }
  const conversationLog = Array.isArray(result?.conversationLog) ? result.conversationLog : [];
  const pagination = objectValue(result?.pagination);
  return {
    conversationLog,
    pagination: {
      beforeTurnId: normalizedInputText(pagination.beforeTurnId || fallbackOptions.beforeTurnId),
      count: Number.isFinite(Number(pagination.count)) ? Number(pagination.count) : conversationLog.length,
      hasMoreBefore: pagination.hasMoreBefore === true,
      limit: Number.isFinite(Number(pagination.limit)) ? Number(pagination.limit) : fallbackOptions.limit || 0,
      newestTurnId: normalizedInputText(pagination.newestTurnId || conversationLog.at(-1)?.turnId),
      nextBeforeTurnId: normalizedInputText(pagination.nextBeforeTurnId),
      oldestTurnId: normalizedInputText(pagination.oldestTurnId || conversationLog[0]?.turnId),
      totalTurnCount: Number.isFinite(Number(pagination.totalTurnCount))
        ? Number(pagination.totalTurnCount)
        : conversationLog.length
    }
  };
}

async function recordConversationMessage(runtime, sessionId, {
  actionResult = {},
  input = {}
} = {}) {
  const inputText = conversationRequestText(input) || conversationRequestText(actionResult?.input);
  const auditText = normalizedInputText(actionResult?.auditMessage);
  const userText = inputText || (actionResult?.recordsConversationTurn === true ? auditText : "");
  if (userText) {
    if (typeof runtime?.store?.writeConversationUserMessage !== "function") {
      return null;
    }
    return runtime.store.writeConversationUserMessage(sessionId, {
      text: userText
    });
  }
  if (
    auditText &&
    typeof runtime?.store?.writeConversationSystemMessage === "function"
  ) {
    return runtime.store.writeConversationSystemMessage(sessionId, {
      text: auditText
    });
  }
  return null;
}

async function recordComposerMessageRequests(runtime, sessionId = "", requests = []) {
  let latestTurn = null;
  for (const request of Array.isArray(requests) ? requests : []) {
    latestTurn = await recordConversationMessage(runtime, sessionId, {
      input: request.displayFields || request.fields || {
        conversationRequest: request.message
      }
    });
  }
  return latestTurn;
}

async function prepareComposerHandoffForQueuedMessages(runtime, session = {}, handoff = {}) {
  const sessionId = normalizedInputText(session?.sessionId);
  const handoffId = composerHandoffId(handoff);
  if (!sessionId || !handoffId || typeof runtime?.getSession !== "function") {
    return handoff;
  }
  const currentSession = await runtime.getSession(sessionId);
  const currentHandoff = composerHandoffSnapshot(currentSession);
  if (!currentHandoff || currentHandoff.id !== handoffId) {
    return handoff;
  }
  const attachedMessageIds = new Set([
    ...(Array.isArray(handoff.clientSubmissionIds) ? handoff.clientSubmissionIds : []),
    ...(Array.isArray(currentHandoff.submissionIds) ? currentHandoff.submissionIds : [])
  ].map((value) => normalizedInputText(value)).filter(Boolean));
  const additionalMessages = pendingComposerMessages(currentSession)
    .filter((request) => !attachedMessageIds.has(request.messageId));
  if (!additionalMessages.length) {
    return {
      ...handoff,
      clientSubmissionIds: [...attachedMessageIds]
    };
  }
  for (const request of additionalMessages) {
    attachedMessageIds.add(request.messageId);
  }
  await recordComposerMessageRequests(runtime, sessionId, additionalMessages);
  await attachComposerHandoffMessages(runtime, sessionId, handoffId, [...attachedMessageIds]);
  const additionalText = additionalMessages
    .map((request) => normalizedInputText(request.message))
    .filter(Boolean)
    .join("\n\n");
  vibe64SessionDebugLog("server.service.composerMessage.delivery.batchAttached", {
    addedMessageIds: additionalMessages.map((request) => request.messageId),
    handoffId,
    messageCount: attachedMessageIds.size,
    messageIds: [...attachedMessageIds],
    sessionId
  });
  return {
    ...handoff,
    clientSubmissionIds: [...attachedMessageIds],
    terminalInput: [
      normalizedInputText(handoff.terminalInput || handoff.prompt),
      "Additional user messages received before this assistant turn started. Treat them as part of the same request, in order:",
      additionalText
    ].filter(Boolean).join("\n\n")
  };
}

async function sessionWithLatestRevision(runtime, session = {}) {
  if (!session?.sessionId || typeof runtime?.getSession !== "function") {
    return session;
  }
  return {
    ...await runtime.getSession(session.sessionId),
    actionResult: session.actionResult
  };
}

function agentTerminalPresentation(agentTerminal = null) {
  const terminal = objectValue(agentTerminal);
  const terminalSessionId = String(terminal.id || "").trim();
  return {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "agent_terminal",
    terminalSessionId,
    visible: false,
    visibleUntil: ""
  };
}

function normalizedAgentSessionState(state = {}) {
  const thread = objectValue(state.thread);
  const turn = isPlainObject(state.turn) ? state.turn : null;
  return {
    identity: isPlainObject(state.identity) ? state.identity : null,
    providerId: normalizedInputText(state.providerId),
    terminal: isPlainObject(state.terminal) ? state.terminal : null,
    thread: {
      id: normalizedInputText(thread.id)
    },
    transportId: normalizedInputText(state.transportId),
    turn,
    workdir: normalizedInputText(state.workdir)
  };
}

function withAgentSessionState(session = {}, state = {}) {
  if (!session || session.ok === false || !session.sessionId) {
    return session;
  }
  const presentation = objectValue(session.presentation);
  const agentSession = normalizedAgentSessionState(state);
  return {
    ...session,
    agentSession,
    intents: Array.isArray(presentation.intents) ? presentation.intents : [],
    presentation: {
      ...presentation,
      terminal: {
        ...objectValue(presentation.terminal),
        agent: agentTerminalPresentation(agentSession.terminal)
      }
    }
  };
}

function sessionAwaitsAgentResult(session = {}) {
  return normalizedInputText(session.stepMachine?.status) === STEP_STATUS_AWAITING_AGENT_RESULT;
}

function sessionBackgroundTasks(session = {}) {
  return [
    ...(Array.isArray(session.backgroundTasks) ? session.backgroundTasks : []),
    ...(Array.isArray(session.presentation?.backgroundTasks) ? session.presentation.backgroundTasks : [])
  ].filter((task) => task && typeof task === "object" && !Array.isArray(task));
}

function composerHandoffFailedAfterAgentWait(session = {}) {
  const waitStartedMs = timestampMs(session?.stepMachine?.at);
  const handoff = composerHandoffSnapshot(session);
  return Boolean(
    waitStartedMs !== null &&
    handoff?.state === COMPOSER_HANDOFF_STATES.FAILED &&
    timestampIsAfter(handoff.failedAt || handoff.updatedAt, waitStartedMs)
  );
}

function sessionHasActiveAgentRun(session = {}) {
  const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
  return runs.some((run) => (
    run?.active === true ||
    vibe64AgentRunStateIsActive(run?.state)
  ));
}

function activeAgentTurnOwnership(session = {}, vibe64User = null) {
  const activeRun = (Array.isArray(session.agentRuns) ? session.agentRuns : []).find((run) => (
    (run?.active === true || vibe64AgentRunStateIsActive(run?.state)) &&
    normalizedInputText(run?.providerTurnId)
  ));
  const ownerUsername = normalizedInputText(session?.metadata?.workflow_driver_username);
  const requesterUsername = normalizedInputText(vibe64User?.username);
  if (!activeRun || !ownerUsername || !requesterUsername) {
    return null;
  }
  return {
    reusable: ownerUsername === requesterUsername,
    threadId: normalizedInputText(activeRun.providerThreadId),
    turnId: normalizedInputText(activeRun.providerTurnId),
    username: ownerUsername
  };
}

function sessionHasActiveAgentWork(session = {}) {
  return sessionHasActiveAgentRun(session) ||
    composerHandoffSnapshot(session)?.pending === true ||
    agentStateHasActiveTurn(session);
}

function agentTurnFromState(state = {}) {
  return objectValue(state.agentSession).turn || state.turn || null;
}

function agentStateHasActiveTurn(state = {}) {
  return agentTurnFromState(state)?.active === true;
}

function agentStateHasCompletedTrackedTurn(state = {}) {
  if (agentStateHasActiveTurn(state)) {
    return false;
  }
  const turn = agentTurnFromState(state) || {};
  const hasTrackedTurn = Boolean(
    normalizedInputText(turn.threadId) ||
    normalizedInputText(turn.id)
  );
  if (!hasTrackedTurn) {
    return false;
  }
  const turnState = normalizedInputText(turn.state);
  const status = normalizedInputText(turn.status);
  return ["completed", "idle"].includes(turnState) &&
    ["completed", "succeeded", "success"].includes(status);
}

function agentWaitRecoveryOptionsForAgentState(state = {}) {
  if (!agentStateHasCompletedTrackedTurn(state)) {
    return {};
  }
  return {
    inputPrompt: AGENT_TURN_RESULT_MISSING_MESSAGE,
    message: AGENT_TURN_RESULT_MISSING_MESSAGE,
    reason: "agent_turn_result_missing"
  };
}

function promptActionStillNeedsStartupProtection(session = {}, agentState = {}) {
  if (!sessionHasPromptActionInFlight(session)) {
    return false;
  }
  if (composerHandoffFailedAfterAgentWait(session)) {
    return false;
  }
  if (!agentStateHasCompletedTrackedTurn(agentState)) {
    return true;
  }

  const actionId = normalizedInputText(session?.stepMachine?.promptActionId);
  const handoffId = normalizedInputText(
    acceptedPromptActionResult(session, actionId)?.agentPromptHandoff?.handoffId
  );
  if (!handoffId) {
    return true;
  }
  return !(Array.isArray(session.agentRuns) ? session.agentRuns : []).some((run) => (
    normalizedInputText(run?.handoffId) === handoffId &&
    !vibe64AgentRunStateIsActive(run?.state)
  ));
}

async function latestSessionForAgentWaitRecovery(runtime, session = {}) {
  if (!session?.sessionId || typeof runtime?.getSession !== "function") {
    return session;
  }
  try {
    return await runtime.getSession(session.sessionId);
  } catch {
    return session;
  }
}

async function recoverAgentWaitWithoutProvider(runtime, session = {}, agentState = {}, {
  inputPrompt = "What would you like to do next?",
  message = "The assistant is no longer running for this turn, so Vibe64 returned control to you.",
  reason = "no_active_agent_turn"
} = {}) {
  if (!sessionAwaitsAgentResult(session)) {
    return session;
  }
  const currentSession = await latestSessionForAgentWaitRecovery(runtime, session);
  if (
    !sessionAwaitsAgentResult(currentSession) ||
    promptActionStillNeedsStartupProtection(currentSession, agentState) ||
    agentStateHasActiveTurn(agentState) ||
    sessionHasActiveAgentRun(currentSession) ||
    composerHandoffSnapshot(currentSession)?.pending === true
  ) {
    return currentSession;
  }
  if (typeof runtime?.returnControlFromAgentWait !== "function") {
    return currentSession;
  }
  vibe64SessionDebugLog("server.service.agentWait.recover.start", {
    reason,
    sessionId: currentSession.sessionId
  });
  const recovered = await runtime.returnControlFromAgentWait(currentSession.sessionId, {
    inputPrompt,
    message
  });
  vibe64SessionDebugLog("server.service.agentWait.recover.done", {
    ...vibe64SessionDebugSummary(recovered),
    reason
  });
  return recovered;
}

function agentDeliveryBlockedByMissingWorktree(delivery = {}) {
  return normalizedInputText(delivery?.code) === AGENT_SESSION_WORKTREE_UNAVAILABLE_CODE;
}

function agentDeliveryBlockedByActiveTurn(delivery = {}) {
  return normalizedInputText(delivery?.code) === AGENT_TURN_ALREADY_RUNNING_CODE;
}

async function recoverAgentWaitForMissingWorktree(runtime, session = {}, delivery = {}) {
  const recoveredSession = await recoverAgentWaitWithoutProvider(runtime, session, {}, {
    inputPrompt: "Recover this session before continuing.",
    message: normalizedInputText(delivery?.error) ||
      "Session clone is unavailable. Recover this session before continuing with the assistant.",
    reason: "session_worktree_unavailable"
  });
  return sessionWithLatestRevision(runtime, recoveredSession);
}

async function observeAcceptedUserMessageSession(runtime, sessionId = "", input = {}) {
  if (!conversationRequestText(input) || typeof runtime?.getSession !== "function") {
    return null;
  }
  const currentSession = await runtime.getSession(sessionId).catch(() => null);
  if (!currentSession) {
    return null;
  }
  if (sessionHasActiveAgentWork(currentSession)) {
    return {
      enrich: true,
      reason: "active_agent_turn",
      session: currentSession
    };
  }
  if (sessionAwaitsAgentResult(currentSession)) {
    return {
      enrich: false,
      reason: "awaiting_agent_result",
      session: currentSession
    };
  }
  return null;
}

async function observedUserMessageSessionResponse(terminalService, runtime, observed = {}) {
  if (observed.enrich) {
    return enrichSessionWithAgentState(terminalService, observed.session, {
      runtime
    });
  }
  return sessionWithLatestRevision(runtime, observed.session);
}

async function observeAcceptedUserMessageAfterStateRejection(runtime, sessionId = "", input = {}, error = {}) {
  if (normalizedInputText(error?.code) !== VIBE64_ACTION_DISABLED_CODE) {
    return null;
  }
  return observeAcceptedUserMessageSession(runtime, sessionId, input);
}

async function observeAcceptedPromptActionSession(runtime, sessionId = "", actionId = "") {
  if (typeof runtime?.getSession !== "function") {
    return null;
  }
  const currentSession = await runtime.getSession(sessionId).catch(() => null);
  if (
    !currentSession ||
    !acceptedPromptActionResult(currentSession, actionId) ||
    !sessionAwaitsAgentResult(currentSession) && !sessionHasActiveAgentWork(currentSession)
  ) {
    return null;
  }
  return {
    enrich: sessionHasActiveAgentWork(currentSession),
    reason: sessionHasActiveAgentWork(currentSession)
      ? "active_agent_turn"
      : "awaiting_agent_result",
    session: currentSession
  };
}

async function observeAcceptedSessionAction(runtime, sessionId = "", actionId = "", input = {}) {
  return await observeAcceptedUserMessageSession(runtime, sessionId, input) ||
    await observeAcceptedPromptActionSession(runtime, sessionId, actionId);
}

async function observeAcceptedSessionActionAfterStateRejection(runtime, sessionId = "", actionId = "", input = {}, error = {}) {
  if (normalizedInputText(error?.code) !== VIBE64_ACTION_DISABLED_CODE) {
    return null;
  }
  return observeAcceptedSessionAction(runtime, sessionId, actionId, input);
}

async function recoverAgentWaitAfterAgentStateFailure(runtime, session = {}) {
  const recoveredSession = await recoverAgentWaitWithoutProvider(runtime, session, {});
  return sessionAwaitsAgentResult(recoveredSession) ? null : recoveredSession;
}

async function enrichSessionWithAgentState(terminalService, session = {}, {
  runtime = null
} = {}) {
  if (!session || session.ok === false || !session.sessionId) {
    return session;
  }
  if (typeof terminalService?.agentSessionState !== "function") {
    vibe64SessionDebugLog("server.service.agentSessionState.skipped", {
      reason: "service_unavailable",
      sessionId: session.sessionId
    });
    const recoveredSession = await recoverAgentWaitWithoutProvider(runtime, session, {});
    return withAgentSessionState(recoveredSession, {});
  }
  const startedAtMs = Date.now();
  vibe64SessionDebugLog("server.service.agentSessionState.start", {
    sessionId: session.sessionId
  });
  let agentState = null;
  try {
    agentState = await terminalService.agentSessionState(session.sessionId, {
      runtime,
      session
    });
  } catch (error) {
    const recoveredSession = await recoverAgentWaitAfterAgentStateFailure(runtime, session);
    if (recoveredSession) {
      vibe64SessionDebugLog("server.service.agentSessionState.recovered", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId: session.sessionId
      });
      return withAgentSessionState(recoveredSession, {});
    }
    throw error;
  }
  if (agentState?.ok === false) {
    const recoveredSession = await recoverAgentWaitAfterAgentStateFailure(runtime, session);
    if (recoveredSession) {
      vibe64SessionDebugLog("server.service.agentSessionState.recovered", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: String(agentState.error || "Vibe64 assistant state could not be read."),
        sessionId: session.sessionId
      });
      return withAgentSessionState(recoveredSession, {});
    }
    vibe64SessionDebugLog("server.service.agentSessionState.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: String(agentState.error || "Vibe64 assistant state could not be read."),
      sessionId: session.sessionId
    });
    throw new Error(agentState.error || "Vibe64 assistant state could not be read.");
  }
  const sessionForRecovery = agentState?.sessionUpdated === true && typeof runtime?.getSession === "function"
    ? await runtime.getSession(session.sessionId).catch(() => session)
    : session;
  const recoveredSession = await recoverAgentWaitWithoutProvider(
    runtime,
    sessionForRecovery,
    agentState || {},
    agentWaitRecoveryOptionsForAgentState(agentState || {})
  );
  const enrichedSession = withAgentSessionState(recoveredSession, agentState || {});
  vibe64SessionDebugLog("server.service.agentSessionState.done", {
    ...vibe64SessionDebugSummary(enrichedSession),
    agentTerminalId: String(enrichedSession.agentSession?.terminal?.id || ""),
    agentTerminalStatus: String(enrichedSession.agentSession?.terminal?.status || ""),
    durationMs: vibe64SessionDebugDurationMs(startedAtMs)
  });
  return enrichedSession;
}

async function describeAgentProvider(terminalService, agentSettings = {}, session = null) {
  if (typeof terminalService?.describeAgentProvider !== "function") {
    const error = new Error("Vibe64 assistant provider service is not available.");
    error.code = "vibe64_agent_provider_service_required";
    throw error;
  }
  const descriptor = await terminalService.describeAgentProvider({
    agentSettings,
    session
  });
  if (!normalizedInputText(descriptor?.providerId) || !normalizedInputText(descriptor?.transportId)) {
    const error = new Error("Vibe64 assistant provider descriptor is invalid.");
    error.code = "vibe64_agent_provider_descriptor_invalid";
    throw error;
  }
  return descriptor;
}

async function acceptComposerHandoff(terminalService, runtime, session = {}, {
  agentSettings = {},
  submissionId = "",
  submissionIds = []
} = {}) {
  const handoff = agentPromptHandoffFromSession(session);
  if (!handoff) {
    return {
      handoff: null,
      session
    };
  }
  const clientSubmissionId = normalizedInputText(submissionId);
  const deliveryHandoff = clientSubmissionId
    ? {
        ...handoff,
        clientSubmissionId,
        clientSubmissionIds: [...new Set([
          clientSubmissionId,
          ...(Array.isArray(submissionIds) ? submissionIds : [])
        ].map((value) => normalizedInputText(value)).filter(Boolean))]
      }
    : handoff;
  const provider = await describeAgentProvider(terminalService, agentSettings, session);
  await transitionComposerHandoff(runtime, session.sessionId, {
    agentSettings,
    handoff: deliveryHandoff,
    providerId: provider.providerId,
    state: COMPOSER_HANDOFF_STATES.ACCEPTED,
    submissionId,
    submissionIds: deliveryHandoff.clientSubmissionIds,
    transportId: provider.transportId
  });
  return {
    handoff: deliveryHandoff,
    provider,
    session: await sessionWithLatestRevision(runtime, session)
  };
}

async function transitionComposerDeliveryLifecycle(runtime, session = {}, handoff = {}, provider = {}, event = {}) {
  const state = normalizedInputText(event.state);
  if (!Object.values(COMPOSER_HANDOFF_STATES).includes(state)) {
    const error = new Error(`Unknown composer handoff lifecycle state: ${state || "(missing)"}.`);
    error.code = "vibe64_composer_handoff_lifecycle_invalid";
    throw error;
  }
  return transitionComposerHandoff(runtime, session.sessionId, {
    connectionReused: event.connectionReused,
    error: event.error,
    handoff,
    providerId: event.providerId || provider.providerId,
    state,
    threadId: event.threadId,
    transportId: event.transportId || provider.transportId,
    turnId: event.turnId
  });
}

async function failComposerHandoff(runtime, session = {}, handoff = {}, provider = {}, error = "") {
  const currentSession = await runtime.getSession(session.sessionId).catch(() => session);
  const current = composerHandoffSnapshot(currentSession);
  if (
    !current ||
    current.id !== composerHandoffId(handoff) ||
    [COMPOSER_HANDOFF_STATES.ACTIVE, COMPOSER_HANDOFF_STATES.FAILED].includes(current.state)
  ) {
    return current;
  }
  return transitionComposerDeliveryLifecycle(runtime, session, handoff, provider, {
    error: normalizedInputText(error) || "Assistant prompt delivery failed.",
    state: COMPOSER_HANDOFF_STATES.FAILED
  });
}

async function finishComposerHandoff(runtime, session = {}, handoff = {}, provider = {}, delivery = {}) {
  let currentSession = await runtime.getSession(session.sessionId);
  let current = composerHandoffSnapshot(currentSession);
  if (
    !current ||
    current.id !== composerHandoffId(handoff) ||
    [COMPOSER_HANDOFF_STATES.ACTIVE, COMPOSER_HANDOFF_STATES.FAILED].includes(current.state)
  ) {
    return current;
  }
  const threadId = normalizedInputText(delivery?.thread?.id);
  const turnId = normalizedInputText(delivery?.turn?.id);
  if (!threadId || !turnId) {
    const error = new Error("Assistant provider accepted a prompt without returning a thread and turn id.");
    error.code = "vibe64_agent_delivery_identity_missing";
    throw error;
  }
  if ([COMPOSER_HANDOFF_STATES.ACCEPTED, COMPOSER_HANDOFF_STATES.CONNECTING].includes(current.state)) {
    await transitionComposerDeliveryLifecycle(runtime, session, handoff, provider, {
      connectionReused: delivery.connectionReused,
      state: COMPOSER_HANDOFF_STATES.DELIVERED,
      threadId,
      turnId
    });
    currentSession = await runtime.getSession(session.sessionId);
    current = composerHandoffSnapshot(currentSession);
  }
  if (current?.state === COMPOSER_HANDOFF_STATES.DELIVERED) {
    return transitionComposerDeliveryLifecycle(runtime, session, handoff, provider, {
      connectionReused: delivery.connectionReused,
      state: COMPOSER_HANDOFF_STATES.ACTIVE,
      threadId,
      turnId
    });
  }
  return current;
}

async function drainComposerControls(terminalService, {
  runtime = null,
  session = null
} = {}) {
  const sessionId = normalizedInputText(session?.sessionId);
  if (!sessionId || typeof runtime?.getSession !== "function") {
    throw new TypeError("Composer control draining requires a runtime session.");
  }

  while (true) {
    const currentSession = await runtime.getSession(sessionId);
    const handoff = composerHandoffSnapshot(currentSession);
    if (handoff?.state !== COMPOSER_HANDOFF_STATES.ACTIVE || !handoff.submissionId) {
      return;
    }
    const queued = pendingComposerControls(
      composerHandoffRun(currentSession),
      handoff.submissionId
    );
    if (!queued.length) {
      return;
    }

    const request = queued[0];
    if (request.kind === COMPOSER_CONTROL_KINDS.LEGACY_STEER) {
      await acceptComposerMessage(runtime, sessionId, {
        afterSubmissionId: request.afterSubmissionId,
        composerSubmissionId: request.controlRequestId,
        displayFields: request.displayFields,
        fields: request.fields,
        message: request.message,
        originId: request.originId
      });
      await settleComposerControl(runtime, sessionId, request.controlRequestId, {
        operationOutcome: "migrated_to_message",
        outcome: "delivered"
      });
      continue;
    }
    let result;
    vibe64SessionDebugLog("server.service.composerControl.delivery.start", {
      afterSubmissionId: request.afterSubmissionId,
      controlRequestId: request.controlRequestId,
      kind: request.kind,
      sessionId
    });
    try {
      const operation = terminalService?.interruptAgentTurn;
      if (typeof operation !== "function") {
        throw new TypeError(`Assistant ${request.kind} control is not available.`);
      }
      const controlInput = {
        controlRequestId: request.controlRequestId,
        originId: request.originId,
        reason: request.reason
      };
      result = await operation.call(terminalService, sessionId, controlInput, {
        runtime,
        session: currentSession
      });
    } catch (error) {
      result = {
        error: error?.message || String(error),
        ok: false,
        operationOutcome: error?.operationOutcome,
        retryable: error?.retryable === true,
        threadId: error?.threadId,
        turnId: error?.turnId
      };
    }
    if (!isPlainObject(result)) {
      result = {
        error: "Assistant control delivery returned no result.",
        ok: false,
        operationOutcome: "control_result_missing",
        retryable: false
      };
    }
    const threadId = normalizedInputText(result?.thread?.id || result?.threadId);
    const turnId = normalizedInputText(result?.turn?.id || result?.turnId);
    if (result?.ok !== true) {
      if (result.retryable === true) {
        await settleComposerControl(runtime, sessionId, request.controlRequestId, {
          error: result.error || "Assistant control delivery is waiting to retry.",
          operationOutcome: result.operationOutcome,
          outcome: "deferred",
          threadId,
          turnId
        });
        vibe64SessionDebugLog("server.service.composerControl.delivery.deferred", {
          controlRequestId: request.controlRequestId,
          error: result.error || "",
          kind: request.kind,
          operationOutcome: normalizedInputText(result.operationOutcome),
          sessionId,
          threadId,
          turnId
        });
        return {
          retry: true
        };
      }
      await settleComposerControl(runtime, sessionId, request.controlRequestId, {
        error: result.error || "Assistant control delivery failed.",
        operationOutcome: result.operationOutcome,
        outcome: "failed",
        threadId,
        turnId
      });
      vibe64SessionDebugLog("server.service.composerControl.delivery.failed", {
        controlRequestId: request.controlRequestId,
        error: result.error || "",
        kind: request.kind,
        operationOutcome: normalizedInputText(result.operationOutcome),
        sessionId,
        threadId,
        turnId
      });
      continue;
    }
    await settleComposerControl(runtime, sessionId, request.controlRequestId, {
      operationOutcome: result?.operationOutcome,
      outcome: "delivered",
      threadId,
      turnId
    });
    vibe64SessionDebugLog("server.service.composerControl.delivery.done", {
      controlRequestId: request.controlRequestId,
      kind: request.kind,
      operationOutcome: normalizedInputText(result?.operationOutcome),
      sessionId,
      threadId,
      turnId
    });
  }
}

async function startComposerMessageTurn(terminalService, coordinator, {
  request = null,
  runtime = null,
  session = null
} = {}) {
  const sessionId = normalizedInputText(session?.sessionId);
  const batch = request?.messageIds ? request : composerMessageBatch([request]);
  const messageId = normalizedInputText(batch?.messageId);
  if (!batch || !messageId) {
    throw new TypeError("Starting an assistant turn requires a composer message batch.");
  }
  const currentSession = await runtime.getSession(sessionId);
  const currentHandoff = composerHandoffSnapshot(currentSession);
  if (
    batch.messageIds.every((id) => currentHandoff?.submissionIds?.includes(id)) &&
    currentHandoff.state !== COMPOSER_HANDOFF_STATES.FAILED
  ) {
    return {
      awaitingHandoff: currentHandoff.state !== COMPOSER_HANDOFF_STATES.ACTIVE,
      delivered: currentHandoff.state === COMPOSER_HANDOFF_STATES.ACTIVE,
      deliveryMode: "new_turn",
      ok: true,
      operationOutcome: currentHandoff.state === COMPOSER_HANDOFF_STATES.ACTIVE
        ? "started_new_turn"
        : "starting_new_turn",
      threadId: currentHandoff.threadId,
      turnId: currentHandoff.turnId
    };
  }
  if (currentHandoff?.pending === true) {
    return {
      awaitingHandoff: true,
      delivered: false,
      deliveryMode: "new_turn",
      ok: true,
      operationOutcome: "waiting_for_current_handoff",
      threadId: currentHandoff.threadId,
      turnId: currentHandoff.turnId
    };
  }

  const currentActions = Array.isArray(currentSession.actions) ? currentSession.actions : [];
  const definedActions = Array.isArray(currentSession.currentStepDefinition?.actions)
    ? currentSession.currentStepDefinition.actions
    : [];
  const messageAction = currentActions.find((action) => (
    normalizedInputText(action?.dispatchRoute) === VIBE64_ACTION_DISPATCH_ROUTES.SESSION_MESSAGE
  )) || definedActions.find((action) => (
    normalizedInputText(action?.dispatchRoute) === VIBE64_ACTION_DISPATCH_ROUTES.SESSION_MESSAGE
  )) || currentActions.find((action) => (
    action?.enabled === true && action?.recordsConversationTurn === true
  ));
  const messageActionId = normalizedInputText(messageAction?.id);
  if (!messageActionId) {
    const error = new Error("The current workflow does not expose an assistant message action.");
    error.code = "vibe64_agent_message_action_missing";
    throw error;
  }
  const actionStartedAtMs = Date.now();
  let actionSession = await runtime.runAction(
    sessionId,
    messageActionId,
    batch.fields
  );
  const conversationTurn = await recordComposerMessageRequests(runtime, sessionId, batch.messages);
  if (conversationTurn) {
    actionSession = await sessionWithLatestRevision(runtime, actionSession);
  }
  const accepted = await acceptComposerHandoff(terminalService, runtime, actionSession, {
    agentSettings: batch.agentSettings,
    submissionId: messageId,
    submissionIds: batch.messageIds
  });
  if (!accepted.handoff) {
    return {
      delivered: false,
      error: "The conversation action did not produce an assistant prompt.",
      ok: false,
      operationOutcome: "new_turn_prompt_missing",
      retryable: false
    };
  }
  vibe64SessionDebugLog("server.service.composerMessage.delivery.newTurnReady", {
    durationMs: vibe64SessionDebugDurationMs(actionStartedAtMs),
    handoffId: composerHandoffId(accepted.handoff),
    messageCount: batch.messageIds.length,
    messageIds: batch.messageIds,
    sessionId
  });
  void coordinator.schedule({
    agentSettings: batch.agentSettings,
    handoff: accepted.handoff,
    runtime,
    session: accepted.session,
    vibe64User: batch.vibe64User
  });
  return {
    awaitingHandoff: true,
    delivered: false,
    deliveryMode: "new_turn",
    ok: true,
    operationOutcome: "starting_new_turn",
    threadId: "",
    turnId: ""
  };
}

async function publishComposerMessageChanged(publishSessionChanged, runtime, sessionId = "", reason = "") {
  if (typeof publishSessionChanged !== "function") {
    return;
  }
  try {
    await publishSessionChanged(sessionId, {
      reason,
      session: await runtime.getSession(sessionId)
    });
  } catch (error) {
    vibe64SessionDebugLog("server.service.composerMessage.publish.error", {
      error: vibe64SessionDebugError(error),
      reason,
      sessionId
    });
  }
}

async function settleComposerMessageRequests(runtime, sessionId = "", requests = [], settlement = {}) {
  const settled = [];
  for (const request of Array.isArray(requests) ? requests : []) {
    const message = await settleComposerMessage(runtime, sessionId, request.messageId, settlement);
    if (message) {
      settled.push(message);
    }
  }
  return settled;
}

async function drainComposerMessages(terminalService, coordinator, publishSessionChanged, {
  assertDeliveryReady = async () => null,
  runtime = null,
  session = null
} = {}) {
  const sessionId = normalizedInputText(session?.sessionId);
  if (!sessionId || typeof runtime?.getSession !== "function") {
    throw new TypeError("Composer message draining requires a runtime session.");
  }

  while (true) {
    const currentSession = await runtime.getSession(sessionId);
    const queuedMessages = pendingComposerMessages(currentSession);
    if (!queuedMessages.length) {
      return null;
    }
    const currentHandoff = composerHandoffSnapshot(currentSession);
    const handoffMessageIds = new Set(currentHandoff?.submissionIds || []);
    const handoffMessages = queuedMessages.filter((request) => handoffMessageIds.has(request.messageId));
    if (handoffMessages.length) {
      if (currentHandoff.state === COMPOSER_HANDOFF_STATES.FAILED) {
        await settleComposerMessageRequests(runtime, sessionId, handoffMessages, {
          error: currentHandoff.error || "The assistant could not start this turn.",
          operationOutcome: "new_turn_failed",
          outcome: COMPOSER_MESSAGE_SETTLEMENTS.FAILED,
          threadId: currentHandoff.threadId,
          turnId: currentHandoff.turnId
        });
        await publishComposerMessageChanged(
          publishSessionChanged,
          runtime,
          sessionId,
          "session-agent-message-failed"
        );
        continue;
      }
      if (currentHandoff.state === COMPOSER_HANDOFF_STATES.ACTIVE) {
        await settleComposerMessageRequests(runtime, sessionId, handoffMessages, {
          operationOutcome: "started_new_turn",
          outcome: COMPOSER_MESSAGE_SETTLEMENTS.DELIVERED,
          threadId: currentHandoff.threadId,
          turnId: currentHandoff.turnId
        });
        await publishComposerMessageChanged(
          publishSessionChanged,
          runtime,
          sessionId,
          "session-agent-message-delivered"
        );
        continue;
      }
      return {
        waitingForHandoff: true
      };
    }
    if (currentHandoff?.pending === true) {
      return {
        waitingForHandoff: true
      };
    }
    let batch = composerMessageBatch(queuedMessages);
    if (!batch) {
      return null;
    }
    const startedAtMs = Date.now();
    vibe64SessionDebugLog("server.service.composerMessage.delivery.start", {
      afterSubmissionId: batch.afterSubmissionId,
      messageCount: batch.messageIds.length,
      messageIds: batch.messageIds,
      queueAgeMs: Math.max(0, Date.now() - (Date.parse(batch.submittedAt) || Date.now())),
      sessionId
    });
    let result;
    try {
      const turnOwnership = activeAgentTurnOwnership(currentSession, batch.vibe64User);
      const readinessStartedAtMs = Date.now();
      await assertDeliveryReady({
        batch,
        session: currentSession,
        sessionId,
        turnOwnership
      });
      vibe64SessionDebugLog("server.service.composerMessage.delivery.readiness", {
        durationMs: vibe64SessionDebugDurationMs(readinessStartedAtMs),
        messageCount: batch.messageIds.length,
        messageIds: batch.messageIds,
        reused: turnOwnership?.reusable === true,
        sessionId
      });
      if (typeof terminalService?.sendAgentMessage !== "function") {
        throw new TypeError("Assistant message delivery is not available.");
      }
      const providerStartedAtMs = Date.now();
      result = await terminalService.sendAgentMessage(sessionId, {
        composerSubmissionId: batch.messageId,
        composerSubmissionIds: batch.messageIds,
        displayFields: batch.displayFields,
        displayMessages: batch.messages.map((request) => normalizedInputText(
          request.displayFields?.conversationRequest || request.message
        )),
        fields: batch.fields,
        message: batch.message,
        messages: batch.messages.map((request) => request.message),
        originId: batch.originId,
        text: batch.message,
        ...(batch.vibe64User ? { vibe64User: batch.vibe64User } : {})
      }, {
        agentSettings: batch.agentSettings,
        runtime,
        session: currentSession,
        turnOwnership,
        vibe64User: batch.vibe64User
      });
      vibe64SessionDebugLog("server.service.composerMessage.delivery.providerState", {
        delivered: result?.delivered === true,
        durationMs: vibe64SessionDebugDurationMs(providerStartedAtMs),
        messageCount: batch.messageIds.length,
        messageIds: batch.messageIds,
        newTurnRequired: result?.newTurnRequired === true,
        operationOutcome: normalizedInputText(result?.operationOutcome),
        sessionId
      });
      if (result?.ok === true && result?.newTurnRequired === true) {
        let latestSession = await runtime.getSession(sessionId);
        batch = composerMessageBatch(pendingComposerMessages(latestSession)) || batch;
        if (composerHandoffSnapshot(latestSession)?.pending === true) {
          return {
            waitingForHandoff: true
          };
        }
        if (
          sessionAwaitsAgentResult(latestSession) &&
          typeof runtime?.returnControlFromAgentWait === "function"
        ) {
          const waitingStepStatus = normalizedInputText(latestSession.stepMachine?.status);
          latestSession = await runtime.returnControlFromAgentWait(sessionId, {
            inputPrompt: "What would you like to do next?",
            message: "The assistant is no longer running for this turn, so Vibe64 returned control to you."
          });
          vibe64SessionDebugLog("server.service.composerMessage.delivery.agentWaitRecovered", {
            fromStepStatus: waitingStepStatus,
            sessionId,
            toStepStatus: normalizedInputText(latestSession.stepMachine?.status)
          });
        }
        const ownershipStartedAtMs = Date.now();
        const driver = await claimSessionWorkflowDriver(runtime, sessionId, {
          originId: batch.originId,
          reason: "agent-message-new-turn",
          vibe64User: batch.vibe64User
        });
        latestSession = driver?.session || latestSession;
        vibe64SessionDebugLog("server.service.composerMessage.delivery.workflowDriverReady", {
          durationMs: vibe64SessionDebugDurationMs(ownershipStartedAtMs),
          messageCount: batch.messageIds.length,
          messageIds: batch.messageIds,
          originId: batch.originId,
          sessionId
        });
        result = await startComposerMessageTurn(terminalService, coordinator, {
          request: batch,
          runtime,
          session: latestSession
        });
      }
    } catch (error) {
      result = {
        error: error?.message || String(error),
        ok: false,
        operationOutcome: error?.code || "message_delivery_failed",
        retryable: normalizedInputText(error?.code) === VIBE64_ACTION_DISABLED_CODE
      };
    }
    if (!isPlainObject(result)) {
      result = {
        error: "Assistant message delivery returned no result.",
        ok: false,
        operationOutcome: "message_result_missing",
        retryable: false
      };
    }
    const threadId = normalizedInputText(result?.thread?.id || result?.threadId);
    const turnId = normalizedInputText(result?.turn?.id || result?.turnId);
    if (result?.ok === true && result?.awaitingHandoff === true) {
      vibe64SessionDebugLog("server.service.composerMessage.delivery.awaitingHandoff", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        messageCount: batch.messageIds.length,
        messageIds: batch.messageIds,
        operationOutcome: normalizedInputText(result.operationOutcome),
        sessionId
      });
      return {
        waitingForHandoff: true
      };
    }
    if (result?.ok !== true || result?.delivered !== true) {
      if (result.retryable === true) {
        if (!composerMessageAutomaticRetryExhausted(batch)) {
          await settleComposerMessageRequests(runtime, sessionId, batch.messages, {
            error: result.error || "Message delivery is waiting to retry.",
            operationOutcome: result.operationOutcome,
            outcome: COMPOSER_MESSAGE_SETTLEMENTS.DEFERRED,
            threadId,
            turnId
          });
          await publishComposerMessageChanged(
            publishSessionChanged,
            runtime,
            sessionId,
            "session-agent-message-deferred"
          );
          vibe64SessionDebugLog("server.service.composerMessage.delivery.deferred", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: normalizedInputText(result.error),
            messageCount: batch.messageIds.length,
            messageIds: batch.messageIds,
            operationOutcome: normalizedInputText(result.operationOutcome),
            sessionId,
            threadId,
            turnId
          });
          return {
            retry: true
          };
        }
        vibe64SessionDebugLog("server.service.composerMessage.delivery.retryExhausted", {
          durationMs: vibe64SessionDebugDurationMs(startedAtMs),
          lastError: normalizedInputText(result.error),
          lastOperationOutcome: normalizedInputText(result.operationOutcome),
          messageCount: batch.messageIds.length,
          messageIds: batch.messageIds,
          sessionId,
          threadId,
          turnId
        });
        result = {
          ...result,
          error: COMPOSER_MESSAGE_RETRY_EXHAUSTED_ERROR,
          operationOutcome: "automatic_retry_exhausted",
          retryable: false
        };
      }
      await settleComposerMessageRequests(runtime, sessionId, batch.messages, {
        error: result.error || "Message delivery failed.",
        operationOutcome: result.operationOutcome,
        outcome: COMPOSER_MESSAGE_SETTLEMENTS.FAILED,
        threadId,
        turnId
      });
      await publishComposerMessageChanged(
        publishSessionChanged,
        runtime,
        sessionId,
        "session-agent-message-failed"
      );
      vibe64SessionDebugLog("server.service.composerMessage.delivery.failed", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: normalizedInputText(result.error),
        messageCount: batch.messageIds.length,
        messageIds: batch.messageIds,
        operationOutcome: normalizedInputText(result.operationOutcome),
        sessionId,
        threadId,
        turnId
      });
      continue;
    }
    await settleComposerMessageRequests(runtime, sessionId, batch.messages, {
      operationOutcome: result.operationOutcome,
      outcome: COMPOSER_MESSAGE_SETTLEMENTS.DELIVERED,
      threadId,
      turnId
    });
    await publishComposerMessageChanged(
      publishSessionChanged,
      runtime,
      sessionId,
      "session-agent-message-delivered"
    );
    vibe64SessionDebugLog("server.service.composerMessage.delivery.done", {
      deliveryMode: normalizedInputText(result.deliveryMode),
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      messageCount: batch.messageIds.length,
      messageIds: batch.messageIds,
      operationOutcome: normalizedInputText(result.operationOutcome),
      sessionId,
      threadId,
      turnId
    });
  }
}

async function deliverAgentPromptHandoff(terminalService, {
  agentSettings = {},
  handoff = null,
  runtime = null,
  session = null,
  vibe64User = null
} = {}) {
  const provider = await describeAgentProvider(terminalService, agentSettings, session);
  if (typeof terminalService?.deliverAgentPrompt !== "function") {
    const error = new Error("Vibe64 assistant prompt delivery service is not available.");
    error.code = "vibe64_agent_prompt_delivery_service_required";
    await failComposerHandoff(runtime, session, handoff, provider, error.message);
    throw error;
  }
  const startedAtMs = Date.now();
  vibe64SessionDebugLog("server.service.deliverAgentPrompt.start", {
    handoffId: String(handoff?.handoffId || ""),
    providerId: provider.providerId,
    sessionId: session.sessionId
  });
  let delivery = null;
  try {
    delivery = await terminalService.deliverAgentPrompt(session.sessionId, handoff, {
      agentSettings,
      lifecycle: (event) => transitionComposerDeliveryLifecycle(
        runtime,
        session,
        handoff,
        provider,
        event
      ),
      prepareHandoff: () => prepareComposerHandoffForQueuedMessages(runtime, session, handoff),
      runtime,
      session,
      vibe64User
    });
  } catch (error) {
    await failComposerHandoff(runtime, session, handoff, provider, error?.message || error);
    await recoverAgentWaitWithoutProvider(runtime, session, {}, {
      reason: "agent_prompt_delivery_exception"
    });
    throw error;
  }
  if (delivery?.ok === false) {
    if (agentDeliveryBlockedByActiveTurn(delivery)) {
      vibe64SessionDebugLog("server.service.deliverAgentPrompt.blocked", {
        code: String(delivery.code || ""),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        handoffId: String(handoff?.handoffId || ""),
        operationOutcome: String(delivery.operationOutcome || ""),
        reason: "active_agent_turn",
        sessionId: session.sessionId
      });
    }
    vibe64SessionDebugLog("server.service.deliverAgentPrompt.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: String(delivery.error || "Vibe64 assistant prompt delivery failed."),
      handoffId: String(handoff?.handoffId || ""),
      sessionId: session.sessionId
    });
    await failComposerHandoff(runtime, session, handoff, provider, delivery?.error);
    if (agentDeliveryBlockedByMissingWorktree(delivery)) {
      await recoverAgentWaitForMissingWorktree(runtime, session, delivery);
      return delivery;
    }
    await recoverAgentWaitWithoutProvider(runtime, session, {}, {
      reason: "agent_prompt_delivery_failed"
    });
    return delivery;
  }
  try {
    await finishComposerHandoff(runtime, session, handoff, provider, delivery);
  } catch (error) {
    await failComposerHandoff(runtime, session, handoff, provider, error?.message || error);
    await recoverAgentWaitWithoutProvider(runtime, session, {}, {
      reason: "agent_prompt_delivery_contract_failed"
    });
    throw error;
  }
  const settledSession = await runtime.getSession(session.sessionId).catch(() => session);
  await recoverAgentWaitWithoutProvider(runtime, settledSession, delivery, {
    reason: "agent_prompt_delivery_settled_without_active_turn"
  });
  vibe64SessionDebugLog("server.service.deliverAgentPrompt.done", {
    durationMs: vibe64SessionDebugDurationMs(startedAtMs),
    handoffId: String(handoff?.handoffId || ""),
    providerId: provider.providerId,
    sessionId: session.sessionId,
    threadId: String(delivery?.thread?.id || ""),
    turnId: String(delivery?.turn?.id || "")
  });
  return delivery;
}

async function recordGitCommandActorForSessionInteraction(
  terminalService,
  sessionId = "",
  input = {},
  reason = "",
  {
    runtime = null,
    session = null
  } = {}
) {
  if (typeof terminalService?.recordSessionGitCommandActor !== "function") {
    const error = new Error("Session Git command actor recording service is not available.");
    error.code = "vibe64_session_git_command_actor_service_required";
    throw error;
  }
  const result = await terminalService.recordSessionGitCommandActor(sessionId, {
    reason,
    runtime,
    session,
    vibe64User: input?.vibe64User || null
  });
  if (result?.ok === false) {
    const error = new Error(result.error || "Git command actor could not be recorded for this session interaction.");
    error.code = result.code || "vibe64_session_git_command_actor_failed";
    throw error;
  }
  return result || {
    ok: true
  };
}

async function claimWorkflowDriverAndRecordGitCommandActor({
  input = {},
  reason = "",
  runtime = null,
  sessionId = "",
  terminalService = null
} = {}) {
  const driver = await claimSessionWorkflowDriver(runtime, sessionId, {
    originId: input?.originId || "",
    reason,
    vibe64User: input?.vibe64User || null
  });
  vibe64SessionDebugLog("server.service.workflowDriver.claimed", {
    claimed: driver?.claimed === true,
    originId: normalizedInputText(input?.originId),
    reason: normalizedInputText(reason),
    sessionId: normalizedInputText(sessionId)
  });
  await recordGitCommandActorForSessionInteraction(terminalService, sessionId, input, reason, {
    runtime,
    session: driver?.session || null
  });
  return driver;
}

function sessionLimits(sessions = [], {
  maxOpenSessions = MAX_OPEN_VIBE64_SESSIONS
} = {}) {
  return {
    maxOpenSessions,
    openSessionCount: sessions.filter(isOpenVibe64Session).length
  };
}

function sessionWorkflowDefinitionId(session = {}) {
  return normalizedInputText(
    session.workflowId ||
    session.workflowDefinition?.id ||
    session.metadata?.workflow_definition
  );
}

function sessionUsesSeedWorkflow(session = {}) {
  return sessionWorkflowDefinitionId(session) === VIBE64_WORKFLOW_DEFINITION_IDS.SEED_APPLICATION ||
    normalizedInputText(session.metadata?.work_source) === "seed";
}

function activeSeedSession(sessions = []) {
  return (Array.isArray(sessions) ? sessions : []).find((session) => (
    isOpenVibe64Session(session) &&
    sessionUsesSeedWorkflow(session)
  )) || null;
}

function firstOpenSession(sessions = []) {
  return (Array.isArray(sessions) ? sessions : []).find(isOpenVibe64Session) || null;
}

function sessionNeedsMainCheckoutSync(session = {}) {
  const metadata = session.metadata || {};
  return isOpenVibe64Session(session) &&
    String(metadata.pr_merged || "").trim() &&
    !String(metadata.main_checkout_synced || "").trim() &&
    !String(metadata.merge_skipped || "").trim();
}

function mainCheckoutSyncBlocker(sessions = []) {
  return sessions.find(sessionNeedsMainCheckoutSync) || null;
}

function sessionListResponse(sessions = [], {
  creation = null,
  limits = sessionLimits(sessions)
} = {}) {
  return {
    creation,
    limits,
    ok: true,
    sessions
  };
}

const PUBLIC_ACTION_RESULT_OMITTED_KEYS = new Set([
  "agentPromptHandoff",
  "prompt",
  "promptContext"
]);
const PUBLIC_SESSION_RESPONSE_FIELDS = new Set([
  "actions",
  "actionResult",
  "actionResults",
  "adapter",
  "agentRuns",
  "backgroundTasks",
  "composerHandoff",
  "composerMessages",
  "config",
  "currentStep",
  "currentStepDefinition",
  "intents",
  "metadata",
  "next",
  "presentation",
  "runtimeReadiness",
  "sessionRoot",
  "status",
  "stepDefinitions",
  "stepMachine",
  "targetRoot",
  "workflowDefinition",
  "workflowId"
]);

function composerMenuSignature(items = []) {
  const payload = JSON.stringify(Array.isArray(items) ? items : []);
  return crypto.createHash("sha256").update(payload).digest("base64url");
}

function safePublicCount(value) {
  const count = Number(value);
  return Number.isSafeInteger(count) && count >= 0 ? count : null;
}

function objectWithoutKeys(source = {}, omittedKeys = new Set()) {
  if (!isPlainObject(source)) {
    return source;
  }
  const publicFields = {};
  for (const [key, value] of Object.entries(source)) {
    if (!omittedKeys.has(key)) {
      publicFields[key] = value;
    }
  }
  return publicFields;
}

function publicEventSummaryRecord(record = {}) {
  if (!isPlainObject(record)) {
    return record;
  }
  const {
    events,
    ...publicRecord
  } = record;
  if (Array.isArray(events)) {
    publicRecord.eventCount = events.length;
    if (events.length > 0) {
      publicRecord.lastEvent = events.at(-1);
    }
  }
  return publicRecord;
}

function publicAgentRun(run = {}) {
  return publicEventSummaryRecord(run);
}

function publicAdapter(adapter = {}) {
  if (!isPlainObject(adapter)) {
    return adapter;
  }
  const {
    composerMenuItems: _composerMenuItems,
    promptContext: _promptContext,
    ...publicAdapterFields
  } = adapter;
  return publicAdapterFields;
}

function publicBackgroundTask(task = {}) {
  return publicEventSummaryRecord(task);
}

function publicBackgroundTaskList(tasks = []) {
  return (Array.isArray(tasks) ? tasks : []).map(publicBackgroundTask);
}

function publicActionResult(result = {}) {
  return objectWithoutKeys(result, PUBLIC_ACTION_RESULT_OMITTED_KEYS);
}

function publicActionResultList(actionResults = []) {
  return (Array.isArray(actionResults) ? actionResults : []).map(publicActionResult);
}

function publicComposerMenu(menu = {}, {
  includeComposerMenu = false
} = {}) {
  if (!isPlainObject(menu)) {
    return menu;
  }
  const hasItems = Array.isArray(menu.items);
  const items = hasItems ? menu.items : [];
  const {
    items: _items,
    ...publicMenu
  } = menu;
  const itemCount = hasItems
    ? items.length
    : safePublicCount(menu.itemCount);
  const signature = hasItems
    ? composerMenuSignature(items)
    : normalizedInputText(menu.signature);
  return {
    ...publicMenu,
    ...(itemCount === null ? {} : { itemCount }),
    ...(signature ? { signature } : {}),
    ...(includeComposerMenu && hasItems ? { items } : {})
  };
}

function publicSessionPresentation(presentation = {}, options = {}) {
  if (!isPlainObject(presentation)) {
    return presentation;
  }
  if (!isPlainObject(presentation.composerMenu)) {
    return presentation;
  }
  return {
    ...presentation,
    composerMenu: publicComposerMenu(presentation.composerMenu, options)
  };
}

function publicSessionList(sessions = []) {
  return (Array.isArray(sessions) ? sessions : []).map(publicSessionResponse);
}

function publicSessionResponseIsSessionRecord(response = {}) {
  if (!isPlainObject(response) || !normalizedInputText(response.sessionId || response.id)) {
    return false;
  }
  return Object.keys(response).some((key) => PUBLIC_SESSION_RESPONSE_FIELDS.has(key));
}

function publicSessionResponse(session = {}, options = {}) {
  if (!isPlainObject(session)) {
    return session;
  }
  const {
    actionAttempts: _actionAttempts,
    actionAttemptsRoot: _actionAttemptsRoot,
    agentRunsRoot: _agentRunsRoot,
    promptContextSnapshot: _promptContextSnapshot,
    ...publicSession
  } = session;
  const composerHandoff = composerHandoffSnapshot(session);
  if (composerHandoff) {
    publicSession.composerHandoff = composerHandoff;
  }
  publicSession.composerMessages = publicComposerMessages(session);
  if (isPlainObject(session.presentation)) {
    publicSession.presentation = publicSessionPresentation(session.presentation, options);
  }
  if (isPlainObject(session.actionResult)) {
    publicSession.actionResult = publicActionResult(session.actionResult);
  }
  if (Array.isArray(session.actionResults)) {
    publicSession.actionResults = publicActionResultList(session.actionResults);
  }
  if (isPlainObject(session.adapter)) {
    publicSession.adapter = publicAdapter(session.adapter);
  }
  if (Array.isArray(session.agentRuns)) {
    publicSession.agentRuns = session.agentRuns
      .filter((run) => ![
        COMPOSER_HANDOFF_AGENT_RUN_ID,
        COMPOSER_MESSAGE_AGENT_RUN_ID
      ].includes(normalizedInputText(run?.id)))
      .map(publicAgentRun);
  }
  if (Array.isArray(session.backgroundTasks)) {
    publicSession.backgroundTasks = publicBackgroundTaskList(session.backgroundTasks);
  }
  return publicSession;
}

function publicSessionServiceResponse(response = {}, options = {}) {
  if (!isPlainObject(response)) {
    return response;
  }
  if (Array.isArray(response.sessions)) {
    return {
      ...response,
      sessions: publicSessionList(response.sessions)
    };
  }
  return publicSessionResponseIsSessionRecord(response)
    ? publicSessionResponse(response, options)
    : response;
}

async function workflowCreationOptions(runtime) {
  if (typeof runtime?.workflowDefinitionCreationOptions === "function") {
    return runtime.workflowDefinitionCreationOptions();
  }
  return workflowDefinitionCreationOptions();
}

async function sessionCreationState(runtime, sessions = []) {
  const workflow = await workflowCreationOptions(runtime);
  const seedSession = activeSeedSession(sessions) || (workflow.seedRequired ? firstOpenSession(sessions) : null);
  const seedSessionId = normalizedInputText(seedSession?.sessionId || seedSession?.id);
  const seedSessionActive = Boolean(seedSession);
  const limits = sessionLimits(sessions, {
    maxOpenSessions: workflow.seedRequired ? 1 : MAX_OPEN_VIBE64_SESSIONS
  });
  const limitReached = limits.openSessionCount >= limits.maxOpenSessions;
  const disabledReason = seedSessionActive
    ? activeSeedSessionMessage(seedSessionId)
    : limitReached
      ? sessionLimitMessage(limits, workflow)
      : "";
  return {
    creation: {
      ...workflow,
      canCreate: !seedSessionActive && !limitReached,
      disabledCode: seedSessionActive ? "seed_session_active" : limitReached ? "open_session_limit" : "",
      disabledReason,
      seedSessionActive,
      seedSessionId
    },
    limits
  };
}

function activeSeedSessionMessage(sessionId = "") {
  const normalizedSessionId = normalizedInputText(sessionId);
  return normalizedSessionId
    ? `Session ${normalizedSessionId} is already seeding this project. Finish or abandon that seed session before creating another session.`
    : "This project is already being seeded. Finish or abandon the seed session before creating another session.";
}

function sessionLimitMessage(limits = {}, workflow = {}) {
  if (workflow.seedRequired) {
    return "The first Vibe64 session must seed the application. Finish or abandon the current seed session before creating another session.";
  }
  return `Studio allows up to ${limits.maxOpenSessions} active sessions at once. Finish or abandon one before creating another.`;
}

function blockedSessionCreationResponse({
  creation = {},
  existingOpenSessions = [],
  limits = {},
  code = "",
  message = ""
} = {}) {
  return {
    creation,
    errors: [
      {
        code,
        message
      }
    ],
    limits,
    ok: false,
    sessions: existingOpenSessions,
    status: "blocked"
  };
}

function selectableWorkflowDefinitionIds(creation = {}) {
  if (creation.seedRequired) {
    return [creation.defaultWorkflowDefinition].filter(Boolean);
  }
  return (Array.isArray(creation.workflowDefinitions) ? creation.workflowDefinitions : [])
    .map((definition) => String(definition.id || "").trim())
    .filter(Boolean);
}

function selectedWorkflowDefinitionId(input = {}, creation = {}) {
  const requestedDefinition = String(input.workflowDefinition || "").trim();
  const definitionId = requestedDefinition || String(creation.defaultWorkflowDefinition || "").trim();
  const allowedDefinitionIds = new Set(selectableWorkflowDefinitionIds(creation));
  if (!definitionId || !allowedDefinitionIds.has(definitionId)) {
    return {
      error: creation.seedRequired
        ? "The first Vibe64 session must seed the application, so no other workflow definition can be selected yet."
        : "Choose one of the available workflow definitions before creating a session.",
      definitionId: ""
    };
  }
  return {
    error: "",
    definitionId
  };
}

function sessionCreationPlan({
  creation = {},
  existingOpenSessions = [],
  input = {},
  limits = {}
} = {}) {
  if (creation.disabledCode === "seed_session_active") {
    return {
      blockedCode: creation.disabledCode,
      response: blockedSessionCreationResponse({
        creation,
        existingOpenSessions,
        limits,
        code: creation.disabledCode,
        message: creation.disabledReason || "This project is already being seeded."
      })
    };
  }
  if (limits.openSessionCount >= limits.maxOpenSessions) {
    return {
      blockedCode: "open_session_limit",
      response: blockedSessionCreationResponse({
        creation,
        existingOpenSessions,
        limits,
        code: "open_session_limit",
        message: sessionLimitMessage(limits, creation)
      })
    };
  }
  if (creation.canCreate !== true) {
    const code = creation.disabledCode || "session_creation_disabled";
    return {
      blockedCode: code,
      response: blockedSessionCreationResponse({
        creation,
        existingOpenSessions,
        limits,
        code,
        message: creation.disabledReason || "A new Vibe64 session cannot be created right now."
      })
    };
  }
  const syncBlocker = mainCheckoutSyncBlocker(existingOpenSessions);
  if (syncBlocker) {
    const message = `Session ${syncBlocker.sessionId} has merged a pull request but has not refreshed the Git cache. Run Refresh Git cache there before starting another session.`;
    return {
      blockedCode: "main_checkout_sync_required",
      response: blockedSessionCreationResponse({
        creation: {
          ...creation,
          canCreate: false,
          disabledReason: message
        },
        existingOpenSessions,
        limits,
        code: "main_checkout_sync_required",
        message
      })
    };
  }
  const definitionSelection = selectedWorkflowDefinitionId(input, creation);
  if (definitionSelection.error) {
    return {
      blockedCode: "workflow_definition_not_available",
      response: blockedSessionCreationResponse({
        creation,
        existingOpenSessions,
        limits,
        code: "workflow_definition_not_available",
        message: definitionSelection.error
      })
    };
  }
  return {
    blockedCode: "",
    definitionSelection,
    response: null
  };
}

function sessionProjectGithubMetadata(project = {}) {
  const repositoryView = projectRepositoryView(project);
  if (repositoryView.repositoryMode && repositoryView.repositoryMode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return {
      github_issue_mode: "skip",
      issue_source: "none",
      pr_source: "none",
      work_anchor_type: "description",
      work_source: "description"
    };
  }
  const repository = isPlainObject(repositoryView.githubRepository)
    ? repositoryView.githubRepository
    : isPlainObject(project?.githubRepository)
      ? project.githubRepository
      : null;
  const fullName = normalizedInputText(repository?.fullName);
  if (!fullName) {
    return {
      github_issue_mode: "skip",
      issue_source: "none",
      pr_source: "none",
      work_anchor_type: "description",
      work_source: "description"
    };
  }
  return {
    github_repository: fullName,
    github_repository_source: normalizedInputText(repository.source),
    github_repository_url: normalizedInputText(repository.url)
  };
}

function sessionProjectRepositoryMetadata(project = {}) {
  const repositoryView = projectRepositoryView(project);
  const repositoryMode = normalizedInputText(project?.repositoryMode || repositoryView.repositoryMode);
  const workflowRepositoryProfile = normalizedInputText(
    project?.workflowRepositoryProfile ||
    repositoryView.workflowRepositoryProfile ||
    workflowRepositoryProfileForMode(repositoryMode)
  );
  return {
    ...(repositoryMode ? { repository_mode: repositoryMode } : {}),
    ...(workflowRepositoryProfile ? { workflow_repository_profile: workflowRepositoryProfile } : {})
  };
}

function sessionProjectMetadata(projectType = {}, project = {}) {
  return {
    adapter_id: projectType.adapter?.id || projectType.projectType,
    project_type: projectType.projectType,
    ...sessionProjectRepositoryMetadata(project),
    ...sessionProjectGithubMetadata(project)
  };
}

function workflowSessionInput(projectType = {}, workflowDefinition = "", project = {}) {
  return {
    metadata: sessionProjectMetadata(projectType, project),
    workflowDefinition
  };
}

async function createAndAdvanceWorkflowSession(runtime, projectType, workflowDefinition, {
  project = {},
  onCreated = null
} = {}) {
  const session = await runtime.createSession(workflowSessionInput(projectType, workflowDefinition, project));
  await onCreated?.(session);
  return {
    advancedSession: await runtime.advance(session.sessionId),
    session
  };
}

async function currentProjectForSession(projectService = {}) {
  if (typeof projectService.listProjects !== "function") {
    return null;
  }
  const projectList = await projectService.listProjects();
  return projectList?.ok === false
    ? null
    : projectList?.currentProject || null;
}

function isOpenSessionList(options = {}) {
  return options.runtimeOptions?.statusGroup === "open" && !Array.isArray(options.runtimeOptions?.statuses);
}

function sessionServiceDebugResponse(response = {}) {
  if (!response || typeof response !== "object" || Array.isArray(response)) {
    return {
      ok: false
    };
  }
  return {
    ...vibe64SessionDebugSummary(response),
    code: String(response.code || response.errors?.[0]?.code || ""),
    ok: response.ok !== false,
    status: String(response.status || "")
  };
}

async function loggedClosedSessionResponseForCloseRetry({
  closeRequest = false,
  debugFields = {},
  eventName = "",
  runtime = null,
  sessionId = ""
} = {}) {
  const alreadyClosedSession = await closedSessionResponseForCloseRetry(runtime, sessionId, closeRequest);
  if (!alreadyClosedSession) {
    return null;
  }
  vibe64SessionDebugLog(eventName, {
    ...sessionServiceDebugResponse(alreadyClosedSession),
    ...debugFields
  });
  return alreadyClosedSession;
}

async function closeSessionTerminalsForSessionClose(terminalService, sessionId = "", {
  eventPrefix = "server.service.sessionTerminalCleanup"
} = {}) {
  if (typeof terminalService?.closeSessionTerminals !== "function") {
    return {
      ok: true
    };
  }
  const cleanupStartedAtMs = Date.now();
  vibe64SessionDebugLog(`${eventPrefix}.start`, {
    sessionId
  });
  try {
    const result = await terminalService.closeSessionTerminals(sessionId);
    vibe64SessionDebugLog(`${eventPrefix}.done`, {
      closed: Number(result?.closed || 0),
      durationMs: vibe64SessionDebugDurationMs(cleanupStartedAtMs),
      ok: result?.ok !== false,
      sessionId
    });
    return result;
  } catch (error) {
    vibe64SessionDebugLog(`${eventPrefix}.error`, {
      durationMs: vibe64SessionDebugDurationMs(cleanupStartedAtMs),
      error: vibe64SessionDebugError(error),
      sessionId
    });
    throw error;
  }
}

async function markSessionClosingForSessionClose(runtime, sessionId = "", {
  eventPrefix = "server.service.sessionClose",
  reason = "finished"
} = {}) {
  if (typeof runtime?.markSessionClosing !== "function") {
    return false;
  }
  const startedAtMs = Date.now();
  await runtime.markSessionClosing(sessionId, {
    reason
  });
  vibe64SessionDebugLog(`${eventPrefix}.markClosing.done`, {
    durationMs: vibe64SessionDebugDurationMs(startedAtMs),
    reason,
    sessionId
  });
  return true;
}

async function clearSessionClosingForFailedSessionClose(runtime, sessionId = "", {
  eventPrefix = "server.service.sessionClose"
} = {}) {
  if (typeof runtime?.clearSessionClosing !== "function") {
    return;
  }
  try {
    await runtime.clearSessionClosing(sessionId);
    vibe64SessionDebugLog(`${eventPrefix}.clearClosing.done`, {
      sessionId
    });
  } catch (clearError) {
    vibe64SessionDebugLog(`${eventPrefix}.clearClosing.error`, {
      error: vibe64SessionDebugError(clearError),
      sessionId
    });
  }
}

function createService({
  projectService,
  publishSessionChanged = async () => null,
  setupOptions = {},
  setupServices = {},
  terminalService
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }
  const normalizedSetupOptions = normalizeSetupOptions(setupOptions);
  const composerHandoffCoordinator = createComposerHandoffCoordinator({
    activate: ({ runtime, session, state }) => transitionComposerHandoff(
      runtime,
      session.sessionId,
      {
        connectionReused: state.connectionReused,
        handoffId: state.id,
        providerId: state.providerId,
        state: COMPOSER_HANDOFF_STATES.ACTIVE,
        threadId: state.threadId,
        transportId: state.transportId,
        turnId: state.turnId
      }
    ),
    deliver: (input) => deliverAgentPromptHandoff(terminalService, input),
    drainControls: (input) => drainComposerControls(terminalService, input),
    drainMessages: (input) => drainComposerMessages(
      terminalService,
      composerHandoffCoordinator,
      publishSessionChanged,
      {
        ...input,
        assertDeliveryReady: ({ batch, turnOwnership }) => {
          if (turnOwnership?.reusable === true) {
            return null;
          }
          return assertVibe64SessionReady(
            setupServices,
            readinessOptions({
              vibe64User: batch.vibe64User
            }, normalizedSetupOptions)
          );
        }
      }
    )
  });

  async function queueComposerInterrupt(sessionId = "", input = {}) {
    const afterSubmissionId = normalizedInputText(input?.afterSubmissionId);
    const controlRequestId = normalizedInputText(
      input?.controlRequestId ||
      (afterSubmissionId ? `interrupt:${afterSubmissionId}` : "")
    );
    if (!afterSubmissionId || !controlRequestId) {
      return {
        code: "vibe64_agent_control_handoff_missing",
        error: "No assistant handoff is available for queued interruption.",
        ok: false
      };
    }
    const runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
    const session = await runtime.getSession(sessionId);

    const request = await acceptComposerControl(runtime, sessionId, {
      ...input,
      afterSubmissionId,
      controlRequestId,
      kind: COMPOSER_CONTROL_KINDS.INTERRUPT
    });
    void composerHandoffCoordinator.drain({
      runtime,
      session
    });
    return {
      accepted: true,
      controlRequestId: request.controlRequestId,
      ok: true,
      queued: true,
      sessionId
    };
  }

  return Object.freeze({
    async cancelAgentMessage(sessionId, messageId, input = {}) {
      const startedAtMs = Date.now();
      const normalizedSessionId = normalizedInputText(sessionId);
      const normalizedMessageId = normalizedInputText(messageId);
      if (!normalizedSessionId || !normalizedMessageId) {
        return {
          code: "vibe64_agent_message_cancel_input_required",
          error: "Assistant message cancellation requires a session and message id.",
          ok: false
        };
      }
      const runtime = await projectService.createRuntime(runtimeScopeForSession(normalizedSessionId));
      const session = await runtime.getSession(normalizedSessionId);
      const exclusive = await composerHandoffCoordinator.runMessagesExclusive({
        runtime,
        session
      }, () => cancelComposerMessage(runtime, normalizedSessionId, normalizedMessageId, input));
      if (!exclusive.acquired) {
        return {
          code: "vibe64_agent_message_cancel_in_progress",
          error: "This message is already being delivered and can no longer be cancelled.",
          messageId: normalizedMessageId,
          ok: false,
          sessionId: normalizedSessionId
        };
      }
      const message = exclusive.value;
      if (!message) {
        return {
          code: "vibe64_agent_message_not_found",
          error: "The assistant message no longer exists.",
          messageId: normalizedMessageId,
          ok: false,
          sessionId: normalizedSessionId
        };
      }
      if (message.state !== COMPOSER_MESSAGE_STATES.CANCELLED) {
        return {
          code: "vibe64_agent_message_cancel_unavailable",
          error: "Only a failed assistant message can be cancelled.",
          messageId: normalizedMessageId,
          ok: false,
          sessionId: normalizedSessionId,
          state: message.state
        };
      }
      vibe64SessionDebugLog("server.service.composerMessage.cancelled", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        messageId: normalizedMessageId,
        originId: normalizedInputText(input?.originId),
        sessionId: normalizedSessionId
      });
      return {
        cancelled: true,
        messageId: normalizedMessageId,
        ok: true,
        sessionId: normalizedSessionId
      };
    },

    async interruptAgentTurn(sessionId, input = {}) {
      const normalizedSessionId = normalizedInputText(sessionId);
      if (!normalizedSessionId) {
        return {
          code: "vibe64_agent_interrupt_session_required",
          error: "Assistant interrupt requires a session.",
          ok: false
        };
      }
      const runtime = await projectService.createRuntime(runtimeScopeForSession(normalizedSessionId));
      const session = await runtime.getSession(normalizedSessionId);
      const queuedMessages = pendingComposerMessages(session);
      for (const message of queuedMessages) {
        await settleComposerMessage(runtime, normalizedSessionId, message.messageId, {
          error: "Message was not sent because the assistant was stopped.",
          operationOutcome: "cancelled_by_user",
          outcome: COMPOSER_MESSAGE_SETTLEMENTS.FAILED
        });
      }
      if (queuedMessages.length) {
        await publishComposerMessageChanged(
          publishSessionChanged,
          runtime,
          normalizedSessionId,
          "session-agent-message-cancelled"
        );
      }
      const currentSession = await runtime.getSession(normalizedSessionId);
      const currentHandoff = composerHandoffSnapshot(currentSession);
      const currentSubmissionId = normalizedInputText(
        currentHandoff?.state === COMPOSER_HANDOFF_STATES.FAILED
          ? ""
          : currentHandoff?.submissionId
      );
      const requestedSubmissionId = normalizedInputText(input?.afterSubmissionId);
      const targetSubmissionIds = [...new Set([
        currentSubmissionId,
        requestedSubmissionId
      ].filter(Boolean))];
      const queuedInterrupts = [];
      for (const targetSubmissionId of targetSubmissionIds) {
        queuedInterrupts.push(await queueComposerInterrupt(normalizedSessionId, {
          ...input,
          afterSubmissionId: targetSubmissionId,
          ...(targetSubmissionIds.length > 1 ? { controlRequestId: "" } : {})
        }));
      }
      if (!currentSubmissionId) {
        const directResult = await terminalService.interruptAgentTurn(normalizedSessionId, input, {
          runtime,
          session: currentSession
        });
        return queuedInterrupts[0]?.ok === true
          ? queuedInterrupts[0]
          : directResult;
      }
      return queuedInterrupts[0];
    },

    async sendAgentMessage(sessionId, input = {}) {
      const startedAtMs = Date.now();
      const normalizedSessionId = normalizedInputText(sessionId);
      const messageId = normalizedInputText(input?.messageId || input?.composerSubmissionId);
      const message = conversationRequestText(input);
      if (!normalizedSessionId) {
        return {
          code: "vibe64_agent_message_session_required",
          error: "Assistant messaging requires a session.",
          ok: false
        };
      }
      if (!messageId || !message) {
        return {
          code: "vibe64_agent_message_input_required",
          error: "Assistant messages require a message id and text.",
          ok: false
        };
      }
      const runtime = await projectService.createRuntime(runtimeScopeForSession(normalizedSessionId));
      const request = await acceptComposerMessage(runtime, normalizedSessionId, {
        afterSubmissionId: input?.afterSubmissionId,
        agentSettings: agentSettingsInput(input),
        composerSubmissionId: messageId,
        displayFields: input?.displayFields,
        fields: {
          ...objectValue(input?.fields),
          conversationRequest: message
        },
        message,
        originId: input?.originId,
        vibe64User: input?.vibe64User
      });
      if (request.state === COMPOSER_MESSAGE_STATES.CANCELLED) {
        return {
          code: "vibe64_agent_message_cancelled",
          error: "This assistant message was cancelled and cannot be resent.",
          messageId: request.messageId,
          ok: false,
          sessionId: normalizedSessionId
        };
      }
      void composerHandoffCoordinator.drainMessages({
        runtime,
        session: await runtime.getSession(normalizedSessionId)
      });
      vibe64SessionDebugLog("server.service.composerMessage.accepted", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        messageId: request.messageId,
        originId: request.originId,
        sessionId: normalizedSessionId,
        state: request.state,
        submittedAt: request.submittedAt
      });
      return {
        accepted: true,
        composerSubmissionId: request.messageId,
        delivered: request.state === "delivered",
        messageId: request.messageId,
        ok: true,
        queued: request.state === "accepted",
        sessionId: normalizedSessionId
      };
    },

    async readComposerDraft(sessionId, input = {}) {
      const normalizedSessionId = normalizedInputText(sessionId);
      const controlId = normalizedInputText(input?.controlId);
      if (!normalizedSessionId || !controlId) {
        return {
          ok: false,
          error: "Composer draft reads require a session and control."
        };
      }
      const runtime = await projectService.createRuntime(runtimeScopeForSession(normalizedSessionId));
      const draft = await readStoredComposerDraft(runtime, normalizedSessionId, controlId);
      return {
        draft,
        ok: true
      };
    },

    async broadcastComposerDraft(sessionId, input = {}) {
      const draftInput = {
        baseRevision: composerDraftRevision(input?.baseRevision),
        controlId: normalizedInputText(input?.controlId),
        fieldName: normalizedInputText(input?.fieldName),
        fields: normalizedComposerDraftFields(input?.fields),
        kind: normalizedComposerDraftKind(input?.kind),
        originId: normalizedInputText(input?.originId),
        projectSlug: normalizedInputText(input?.projectSlug),
        sessionId: normalizedInputText(sessionId),
        submissionId: normalizedInputText(input?.submissionId),
        text: normalizedInputText(input?.text),
        updatedAt: new Date().toISOString()
      };
      if (!draftInput.sessionId || !draftInput.controlId || !draftInput.fieldName || !draftInput.originId) {
        return {
          ok: false,
          error: "Composer draft updates require a session, control, field, and origin."
        };
      }
      const runtime = await projectService.createRuntime(runtimeScopeForSession(draftInput.sessionId));
      const existing = await readStoredComposerDraft(runtime, draftInput.sessionId, draftInput.controlId);
      if (composerDraftInputIsStale(existing, draftInput)) {
        return {
          currentDraft: existing,
          ok: true,
          stale: true
        };
      }
      const payload = {
        ...draftInput,
        revision: composerDraftRevision(existing?.revision) + 1
      };
      await writeStoredComposerDraft(runtime, persistedComposerDraftPayload(payload));
      return {
        ok: true,
        draft: payload
      };
    },

    async broadcastSessionViewState(sessionId, input = {}) {
      const projectSlug = normalizedInputText(input?.projectSlug);
      const routeFullPath = normalizedSessionViewRoute(input?.routeFullPath, projectSlug);
      const viewState = {
        originId: normalizedInputText(input?.originId),
        projectPane: sessionViewProjectPane(routeFullPath, projectSlug),
        projectSlug,
        routeFullPath,
        sessionId: normalizedInputText(sessionId),
        updatedAt: new Date().toISOString()
      };
      if (!viewState.sessionId || !viewState.projectSlug || !viewState.routeFullPath || !viewState.originId) {
        return {
          ok: false,
          error: "Session view updates require a session, project, route, and origin."
        };
      }
      writeSessionUiSyncViewState(viewState);
      return {
        ok: true,
        viewState
      };
    },

    async broadcastSessionPreviewState(sessionId, input = {}) {
      const route = normalizedLocalRoute(input?.route);
      const preview = {
        originId: normalizedInputText(input?.originId),
        projectSlug: normalizedInputText(input?.projectSlug),
        route,
        sessionId: normalizedInputText(sessionId),
        title: normalizedInputText(input?.title).slice(0, 256),
        updatedAt: new Date().toISOString()
      };
      if (!preview.sessionId || !preview.projectSlug || !preview.route || !preview.originId) {
        return {
          ok: false,
          error: "Preview page updates require a session, project, route, and origin."
        };
      }
      writeSessionUiSyncPreviewState(preview);
      return {
        ok: true,
        preview
      };
    },

    async advanceSession(sessionId, expected = {}) {
      const workflowExpected = stripInternalInput(expected);
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.advanceSession.start", {
        expectedStepId: String(workflowExpected?.stepId || ""),
        expectedStepStatus: String(workflowExpected?.stepStatus || ""),
        sessionId
      });
      return sessionResult(async () => {
        let runtime = null;
        try {
          await assertVibe64SessionReady(setupServices, readinessOptions(expected, normalizedSetupOptions));
          runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
          const alreadyAdvancedSession = await observeAlreadyAdvancedSession(runtime, sessionId, workflowExpected);
          if (alreadyAdvancedSession) {
            const enrichedAlreadyAdvancedSession = await enrichSessionWithAgentState(terminalService, alreadyAdvancedSession, {
              runtime
            });
            vibe64SessionDebugLog("server.service.advanceSession.observedDuplicate", {
              ...sessionServiceDebugResponse(enrichedAlreadyAdvancedSession),
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              expectedStepId: String(workflowExpected?.stepId || ""),
              expectedStepStatus: String(workflowExpected?.stepStatus || ""),
              phase: "before_advance"
            });
            return enrichedAlreadyAdvancedSession;
          }
          await claimWorkflowDriverAndRecordGitCommandActor({
            input: expected,
            reason: "session-advance",
            runtime,
            sessionId,
            terminalService
          });
          const session = await runtime.advance(sessionId, workflowExpected);
          const enrichedSession = await enrichSessionWithAgentState(terminalService, session, {
            runtime
          });
          vibe64SessionDebugLog("server.service.advanceSession.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
          if (normalizedInputText(error?.code) === VIBE64_ADVANCE_STATE_CHANGED_CODE) {
            const observedSession = await observeAlreadyAdvancedSession(runtime, sessionId, workflowExpected);
            if (observedSession) {
              const enrichedObservedSession = await enrichSessionWithAgentState(terminalService, observedSession, {
                runtime
              });
              vibe64SessionDebugLog("server.service.advanceSession.observedDuplicate", {
                ...sessionServiceDebugResponse(enrichedObservedSession),
                durationMs: vibe64SessionDebugDurationMs(startedAtMs),
                expectedStepId: String(workflowExpected?.stepId || ""),
                expectedStepStatus: String(workflowExpected?.stepStatus || ""),
                phase: "after_state_changed"
              });
              return enrichedObservedSession;
            }
          }
          vibe64SessionDebugLog("server.service.advanceSession.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async abandonSession(sessionId, input = {}) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.abandonSession.start", {
        sessionId
      });
      return sessionResult(async () => {
        let runtime = null;
        let archiveStarted = false;
        try {
          runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
          await claimWorkflowDriverAndRecordGitCommandActor({
            input,
            reason: "session-abandon",
            runtime,
            sessionId,
            terminalService
          });
          const closeSession = async () => {
            const session = await runtime.getSession(sessionId);
            if (typeof runtime.markSessionClosing === "function") {
              await runtime.markSessionClosing(sessionId, {
                reason: "abandoned"
              });
            }
            await closeSessionTerminalsForSessionClose(terminalService, sessionId, {
              eventPrefix: "server.service.abandonSession.terminalCleanup"
            });
            archiveStarted = true;
            await runtime.archiveSessionSource(session, {
              reason: "abandoned"
            });
            await runtime.store.writeStatus(sessionId, VIBE64_SESSION_STATUS.ABANDONED);
          };
          if (typeof runtime.store?.mutateSession === "function") {
            await runtime.store.mutateSession(sessionId, closeSession);
          } else {
            await closeSession();
          }
          const abandonedSession = await runtime.getSession(sessionId);
          const closedSession = typeof runtime.compactClosedSessionIfNeeded === "function"
            ? await runtime.compactClosedSessionIfNeeded(abandonedSession) || abandonedSession
            : abandonedSession;
          vibe64SessionDebugLog("server.service.abandonSession.done", {
            ...sessionServiceDebugResponse(closedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return closedSession;
        } catch (error) {
          if (!archiveStarted && typeof runtime?.clearSessionClosing === "function") {
            await runtime.clearSessionClosing(sessionId).catch((clearError) => {
              vibe64SessionDebugLog("server.service.abandonSession.clearClosing.error", {
                error: vibe64SessionDebugError(clearError),
                sessionId
              });
            });
          }
          vibe64SessionDebugLog("server.service.abandonSession.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async createSession(input = {}) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.createSession.start", {
        workflowDefinition: String(input?.workflowDefinition || "")
      });
      return sessionResult(async () => {
        try {
          const projectType = await projectService.requireProjectType();
          await assertVibe64SessionReady(setupServices, readinessOptions(input, normalizedSetupOptions));
          const runtime = await projectService.createRuntime();
          const existingOpenSessions = await listOpenSessionSummaries(runtime);
          const { creation, limits } = await sessionCreationState(runtime, existingOpenSessions);
          vibe64SessionDebugLog("server.service.createSession.creationState", {
            canCreate: creation.canCreate === true,
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            maxOpenSessions: limits.maxOpenSessions,
            openSessionCount: limits.openSessionCount,
            requestedWorkflowDefinition: String(input?.workflowDefinition || ""),
            seedRequired: creation.seedRequired === true
          });
          assertSessionWorkflowDriverOrigin(input?.originId || "");
          const creationPlan = sessionCreationPlan({
            creation,
            existingOpenSessions,
            input,
            limits
          });
          if (creationPlan.response) {
            vibe64SessionDebugLog("server.service.createSession.blocked", {
              code: creationPlan.blockedCode,
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              requestedWorkflowDefinition: String(input?.workflowDefinition || "")
            });
            return creationPlan.response;
          }
          const definitionSelection = creationPlan.definitionSelection;
          vibe64SessionDebugLog("server.service.createSession.runtimeCreate.start", {
            adapterId: projectType.adapter?.id || projectType.projectType,
            projectType: projectType.projectType,
            workflowDefinition: definitionSelection.definitionId
          });
          const currentProject = await currentProjectForSession(projectService);
          const {
            advancedSession,
            session
          } = await createAndAdvanceWorkflowSession(runtime, projectType, definitionSelection.definitionId, {
            project: currentProject,
            onCreated(createdSession) {
              vibe64SessionDebugLog("server.service.createSession.runtimeCreate.done", {
                ...sessionServiceDebugResponse(createdSession),
                durationMs: vibe64SessionDebugDurationMs(startedAtMs),
                workflowDefinition: definitionSelection.definitionId
              });
              vibe64SessionDebugLog("server.service.createSession.initialAdvance.start", {
                currentStep: createdSession.currentStep,
                sessionId: createdSession.sessionId,
                workflowDefinition: definitionSelection.definitionId
              });
            }
          });
          vibe64SessionDebugLog("server.service.createSession.initialAdvance.done", {
            ...sessionServiceDebugResponse(advancedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            fromStepId: session.currentStep,
            workflowDefinition: definitionSelection.definitionId
          });
          await claimWorkflowDriverAndRecordGitCommandActor({
            input,
            reason: "session-create",
            runtime,
            sessionId: advancedSession.sessionId,
            terminalService
          });
          const enrichedSession = await enrichSessionWithAgentState(terminalService, advancedSession, {
            runtime
          });
          vibe64SessionDebugLog("server.service.createSession.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            workflowDefinition: definitionSelection.definitionId
          });
          return enrichedSession;
        } catch (error) {
          vibe64SessionDebugLog("server.service.createSession.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            workflowDefinition: String(input?.workflowDefinition || "")
          });
          throw error;
        }
      });
    },

    async updateCurrentSession(sessionId = "") {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime({
          sourceSetupRequired: false
        });
        const currentSession = await runtime.updateCurrentSession(sessionId);
        return {
          ok: true,
          sessionId: currentSession.sessionId
        };
      });
    },

    async inspectSession(sessionId, input = {}) {
      const startedAtMs = Date.now();
      const includeRuntimeEnrichment = inputFlagEnabled(input?.includeRuntimeEnrichment);
      vibe64SessionDebugLog("server.service.inspectSession.start", {
        includeRuntimeEnrichment,
        sessionId
      });
      return sessionResult(async () => {
        try {
          const {
            readiness,
            runtime
          } = await createRuntimeForSessionInspection(projectService, setupServices, {
            ...input,
            sessionId
          }, normalizedSetupOptions);
          let runtimeSession = await runtime.getSession(sessionId);
          const handoffBeforeResume = composerHandoffSnapshot(runtimeSession);
          const resumeTask = composerHandoffCoordinator.resume({
            runtime,
            session: runtimeSession
          });
          if (resumeTask && handoffBeforeResume?.state === COMPOSER_HANDOFF_STATES.DELIVERED) {
            await resumeTask;
            runtimeSession = await runtime.getSession(sessionId);
          }
          const reconcileAgentState = includeRuntimeEnrichment ||
            sessionAwaitsAgentResult(runtimeSession) ||
            sessionHasActiveAgentWork(runtimeSession);
          const inspectedSession = reconcileAgentState
            ? await enrichSessionWithAgentState(terminalService, runtimeSession, {
                runtime
              })
            : runtimeSession;
          const session = sessionWithRuntimeReadiness(
            sessionViewWithReadiness(inspectedSession, readiness),
            readiness,
            {
              runtimeEnrichmentRequested: reconcileAgentState
            }
          );
          const uiSync = readSessionUiSyncState({
            projectSlug: input?.projectSlug,
            sessionId: session?.sessionId || sessionId
          });
          const publicSession = uiSync ? {
            ...session,
            uiSync
          } : session;
          vibe64SessionDebugLog("server.service.inspectSession.done", {
            ...sessionServiceDebugResponse(publicSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return publicSession;
        } catch (error) {
          vibe64SessionDebugLog("server.service.inspectSession.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      }, {
        publicResponseOptions: {
          includeComposerMenu: inputFlagEnabled(input?.includeComposerMenu)
        }
      });
    },

    async readSessionConversationLog(sessionId, options = {}) {
      const startedAtMs = Date.now();
      const pageOptions = conversationLogPageOptions(options);
      vibe64SessionDebugLog("server.service.readSessionConversationLog.start", {
        beforeTurnId: pageOptions.beforeTurnId,
        limit: pageOptions.limit,
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
          const session = await runtime.getSession(sessionId);
          const pageResult = typeof runtime.store?.readConversationLogPage === "function"
            ? await runtime.store.readConversationLogPage(sessionId, pageOptions)
            : typeof runtime.store?.readConversationLog === "function"
              ? await runtime.store.readConversationLog(sessionId)
              : [];
          const {
            conversationLog,
            pagination
          } = normalizeConversationLogPageResult(pageResult, pageOptions);
          const response = {
            conversationLog,
            ok: true,
            pagination,
            revision: session.revision,
            sessionId: session.sessionId
          };
          vibe64SessionDebugLog("server.service.readSessionConversationLog.done", {
            beforeTurnId: pageOptions.beforeTurnId,
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            hasMoreBefore: pagination.hasMoreBefore,
            limit: pageOptions.limit,
            sessionId,
            turnCount: conversationLog.length
          });
          return response;
        } catch (error) {
          vibe64SessionDebugLog("server.service.readSessionConversationLog.error", {
            beforeTurnId: pageOptions.beforeTurnId,
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            limit: pageOptions.limit,
            sessionId
          });
          throw error;
        }
      }, {
        publicResponse: false
      });
    },

    async inspectSessionDiff(sessionId, options = {}) {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
        return inspectSessionDiff(await runtime.getSession(sessionId), options);
      }, {
        publicResponse: false
      });
    },

    async buildTerminalFailureFixRequest(sessionId, input = {}) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.buildTerminalFailureFixRequest.start", {
        sessionId,
        terminalKind: String(input?.terminalKind || "")
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
          await claimWorkflowDriverAndRecordGitCommandActor({
            input,
            reason: "terminal-failure-fix-request",
            runtime,
            sessionId,
            terminalService
          });
          const session = await runtime.getSession(sessionId);
          const request = terminalFailureFixRequestForSession(session, input);
          vibe64SessionDebugLog("server.service.buildTerminalFailureFixRequest.done", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            outputTailLength: request.outputTail.length,
            sessionId
          });
          return request;
        } catch (error) {
          vibe64SessionDebugLog("server.service.buildTerminalFailureFixRequest.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      }, {
        publicResponse: false
      });
    },

    async recoverStuckSessionStep(sessionId, input = {}) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.recoverStuckSessionStep.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          await assertVibe64SessionReady(setupServices, readinessOptions(input, normalizedSetupOptions));
          const runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
          await claimWorkflowDriverAndRecordGitCommandActor({
            input,
            reason: "session-stuck-step-recover",
            runtime,
            sessionId,
            terminalService
          });
          await terminalService?.closeSessionNonAgentTerminals?.(sessionId);
          const session = await runtime.recoverStuckStep(sessionId);
          const enrichedSession = await enrichSessionWithAgentState(terminalService, session, {
            runtime
          });
          vibe64SessionDebugLog("server.service.recoverStuckSessionStep.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
          vibe64SessionDebugLog("server.service.recoverStuckSessionStep.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async returnAgentControl(sessionId, input = {}) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.returnAgentControl.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
          await claimWorkflowDriverAndRecordGitCommandActor({
            input,
            reason: "session-agent-control-return",
            runtime,
            sessionId,
            terminalService
          });
          const session = await runtime.returnControlFromAgentWait(sessionId);
          const enrichedSession = await enrichSessionWithAgentState(terminalService, session, {
            runtime
          });
          vibe64SessionDebugLog("server.service.returnAgentControl.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
          vibe64SessionDebugLog("server.service.returnAgentControl.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async listSessions(input = {}) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.listSessions.start", {
        archive: String(input?.archive || "")
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime({
            sourceSetupRequired: false
          });
          const options = sessionListOptions(input);
          const sessions = await listSessionSummaries(runtime, options.runtimeOptions);
          const openSessions = isOpenSessionList(options)
            ? sessions
            : await listOpenSessionSummaries(runtime);
          const creationState = await sessionCreationState(runtime, openSessions);
          const response = sessionListResponse(sessions, creationState);
          vibe64SessionDebugLog("server.service.listSessions.done", {
            archive: String(input?.archive || ""),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            openSessionCount: response.limits?.openSessionCount ?? null,
            sessionCount: response.sessions.length
          });
          return response;
        } catch (error) {
          vibe64SessionDebugLog("server.service.listSessions.error", {
            archive: String(input?.archive || ""),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error)
          });
          throw error;
        }
      });
    },

    async runSessionAction(sessionId, actionId, input = {}) {
      const workflowInput = stripInternalInput(input);
      const agentSettings = agentSettingsInput(input);
      const composerSubmissionId = composerSubmissionIdInput(input);
      const displayInput = conversationDisplayInput(input);
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.runSessionAction.start", {
        actionId,
        sessionId
      });
      return sessionResult(async () => {
        let runtime = null;
        let sessionClosingMarked = false;
        try {
          await assertVibe64SessionReady(setupServices, readinessOptions(input, normalizedSetupOptions));
          runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
          await describeAgentProvider(terminalService, agentSettings);
          await claimWorkflowDriverAndRecordGitCommandActor({
            input,
            reason: `session-action:${actionId}`,
            runtime,
            sessionId,
            terminalService
          });
          const observedAcceptedSession = await observeAcceptedSessionAction(
            runtime,
            sessionId,
            actionId,
            displayInput || workflowInput
          );
          if (observedAcceptedSession) {
            vibe64SessionDebugLog("server.service.runSessionAction.blocked", {
              ...sessionServiceDebugResponse(observedAcceptedSession.session),
              actionId,
              reason: observedAcceptedSession.reason,
              durationMs: vibe64SessionDebugDurationMs(startedAtMs)
            });
            return observedUserMessageSessionResponse(terminalService, runtime, observedAcceptedSession);
          }
          const alreadyClosedSession = await loggedClosedSessionResponseForCloseRetry({
            closeRequest: SESSION_CLOSE_ACTION_IDS.has(actionId),
            debugFields: {
              actionId,
              durationMs: vibe64SessionDebugDurationMs(startedAtMs)
            },
            eventName: "server.service.runSessionAction.alreadyClosed",
            runtime,
            sessionId
          });
          if (alreadyClosedSession) {
            return alreadyClosedSession;
          }
          if (SESSION_CLOSE_ACTION_IDS.has(actionId)) {
            sessionClosingMarked = await markSessionClosingForSessionClose(runtime, sessionId, {
              eventPrefix: "server.service.runSessionAction.closeBeforeArchive"
            });
            await closeSessionTerminalsForSessionClose(terminalService, sessionId, {
              eventPrefix: "server.service.runSessionAction.closeBeforeArchive"
            });
          }
          let session = await runtime.runAction(sessionId, actionId, workflowInput);
          const conversationTurn = await recordConversationMessage(runtime, sessionId, {
            actionResult: session.actionResult,
            input: displayInput || session.actionResult?.input || workflowInput
          });
          if (conversationTurn) {
            session = await sessionWithLatestRevision(runtime, session);
          }
          if (!isOpenVibe64Session(session)) {
            await terminalService?.closeSessionTerminals?.(sessionId);
            vibe64SessionDebugLog("server.service.runSessionAction.done", {
              ...sessionServiceDebugResponse(session),
              actionId,
              durationMs: vibe64SessionDebugDurationMs(startedAtMs)
            });
            return sessionWithClientRefreshHint(session);
          }
          const accepted = await acceptComposerHandoff(terminalService, runtime, session, {
            agentSettings,
            submissionId: composerSubmissionId
          });
          const responseSession = accepted.handoff
            ? accepted.session
            : await enrichSessionWithAgentState(terminalService, accepted.session, {
                runtime
              });
          if (accepted.handoff) {
            void composerHandoffCoordinator.schedule({
              agentSettings,
              handoff: accepted.handoff,
              runtime,
              session: accepted.session,
              vibe64User: input?.vibe64User || null
            });
          }
          vibe64SessionDebugLog("server.service.runSessionAction.done", {
            ...sessionServiceDebugResponse(responseSession),
            actionId,
            actionResultStatus: String(responseSession.actionResult?.status || ""),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return responseSession;
        } catch (error) {
          const observedAcceptedSession = await observeAcceptedSessionActionAfterStateRejection(
            runtime,
            sessionId,
            actionId,
            displayInput || workflowInput,
            error
          );
          if (observedAcceptedSession) {
            vibe64SessionDebugLog("server.service.runSessionAction.blocked", {
              ...sessionServiceDebugResponse(observedAcceptedSession.session),
              actionId,
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              reason: observedAcceptedSession.reason,
              rejectedCode: normalizedInputText(error?.code)
            });
            return observedUserMessageSessionResponse(terminalService, runtime, observedAcceptedSession);
          }
          const alreadyClosedSession = await loggedClosedSessionResponseForCloseRetry({
            closeRequest: SESSION_CLOSE_ACTION_IDS.has(actionId),
            debugFields: {
              actionId,
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              rejectedCode: normalizedInputText(error?.code)
            },
            eventName: "server.service.runSessionAction.alreadyClosed",
            runtime,
            sessionId
          });
          if (alreadyClosedSession) {
            return alreadyClosedSession;
          }
          if (sessionClosingMarked) {
            await clearSessionClosingForFailedSessionClose(runtime, sessionId, {
              eventPrefix: "server.service.runSessionAction.closeBeforeArchive"
            });
          }
          vibe64SessionDebugLog("server.service.runSessionAction.error", {
            actionId,
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async runSessionIntent(sessionId, intentId, input = {}) {
      const workflowInput = stripInternalInput(input);
      const agentSettings = agentSettingsInput(input);
      const composerSubmissionId = composerSubmissionIdInput(input);
      const displayInput = conversationDisplayInput(input);
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.runSessionIntent.start", {
        intentId,
        sessionId,
        stepId: String(input?.stepId || ""),
        stepStatus: String(input?.stepStatus || "")
      });
      return sessionResult(async () => {
        let runtime = null;
        let sessionClosingMarked = false;
        try {
          await assertVibe64SessionReady(setupServices, readinessOptions(input, normalizedSetupOptions));
          runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
          await describeAgentProvider(terminalService, agentSettings);
          await claimWorkflowDriverAndRecordGitCommandActor({
            input,
            reason: `session-intent:${intentId}`,
            runtime,
            sessionId,
            terminalService
          });
          const observedUserMessageSession = await observeAcceptedUserMessageSession(runtime, sessionId, displayInput || workflowInput);
          if (observedUserMessageSession) {
            vibe64SessionDebugLog("server.service.runSessionIntent.blocked", {
              ...sessionServiceDebugResponse(observedUserMessageSession.session),
              intentId,
              reason: observedUserMessageSession.reason,
              durationMs: vibe64SessionDebugDurationMs(startedAtMs)
            });
            return observedUserMessageSessionResponse(terminalService, runtime, observedUserMessageSession);
          }
          const alreadyClosedSession = await loggedClosedSessionResponseForCloseRetry({
            closeRequest: SESSION_CLOSE_INTENT_IDS.has(intentId),
            debugFields: {
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              intentId
            },
            eventName: "server.service.runSessionIntent.alreadyClosed",
            runtime,
            sessionId
          });
          if (alreadyClosedSession) {
            return alreadyClosedSession;
          }
          if (SESSION_CLOSE_INTENT_IDS.has(intentId)) {
            sessionClosingMarked = await markSessionClosingForSessionClose(runtime, sessionId, {
              eventPrefix: "server.service.runSessionIntent.closeBeforeArchive"
            });
            await closeSessionTerminalsForSessionClose(terminalService, sessionId, {
              eventPrefix: "server.service.runSessionIntent.closeBeforeArchive"
            });
          }
          let session = await runtime.runIntent(sessionId, intentId, workflowInput);
          const conversationTurn = await recordConversationMessage(runtime, sessionId, {
            actionResult: session.actionResult,
            input: displayInput || session.actionResult?.input || workflowInput
          });
          if (conversationTurn) {
            session = await sessionWithLatestRevision(runtime, session);
          }
          if (!isOpenVibe64Session(session)) {
            await terminalService?.closeSessionTerminals?.(sessionId);
            vibe64SessionDebugLog("server.service.runSessionIntent.done", {
              ...sessionServiceDebugResponse(session),
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              intentId
            });
            return sessionWithClientRefreshHint(session);
          }
          const accepted = await acceptComposerHandoff(terminalService, runtime, session, {
            agentSettings,
            submissionId: composerSubmissionId
          });
          const responseSession = accepted.handoff
            ? accepted.session
            : await enrichSessionWithAgentState(terminalService, accepted.session, {
                runtime
              });
          if (accepted.handoff) {
            void composerHandoffCoordinator.schedule({
              agentSettings,
              handoff: accepted.handoff,
              runtime,
              session: accepted.session,
              vibe64User: input?.vibe64User || null
            });
          }
          vibe64SessionDebugLog("server.service.runSessionIntent.done", {
            ...sessionServiceDebugResponse(responseSession),
            actionResultStatus: String(responseSession.actionResult?.status || ""),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            intentId
          });
          return responseSession;
        } catch (error) {
          const observedUserMessageSession = await observeAcceptedUserMessageAfterStateRejection(
            runtime,
            sessionId,
            displayInput || workflowInput,
            error
          );
          if (observedUserMessageSession) {
            vibe64SessionDebugLog("server.service.runSessionIntent.blocked", {
              ...sessionServiceDebugResponse(observedUserMessageSession.session),
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              intentId,
              reason: observedUserMessageSession.reason,
              rejectedCode: normalizedInputText(error?.code)
            });
            return observedUserMessageSessionResponse(terminalService, runtime, observedUserMessageSession);
          }
          const alreadyClosedSession = await loggedClosedSessionResponseForCloseRetry({
            closeRequest: SESSION_CLOSE_INTENT_IDS.has(intentId),
            debugFields: {
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              intentId,
              rejectedCode: normalizedInputText(error?.code)
            },
            eventName: "server.service.runSessionIntent.alreadyClosed",
            runtime,
            sessionId
          });
          if (alreadyClosedSession) {
            return alreadyClosedSession;
          }
          if (sessionClosingMarked) {
            await clearSessionClosingForFailedSessionClose(runtime, sessionId, {
              eventPrefix: "server.service.runSessionIntent.closeBeforeArchive"
            });
          }
          vibe64SessionDebugLog("server.service.runSessionIntent.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            intentId,
            sessionId
          });
          throw error;
        }
      });
    },

    async rewindSession(sessionId, stepId, input = {}) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.rewindSession.start", {
        sessionId,
        stepId
      });
      return sessionResult(async () => {
        try {
          await assertVibe64SessionReady(setupServices, readinessOptions(input, normalizedSetupOptions));
          const runtime = await projectService.createRuntime(runtimeScopeForSession(sessionId));
          await claimWorkflowDriverAndRecordGitCommandActor({
            input,
            reason: "session-rewind",
            runtime,
            sessionId,
            terminalService
          });
          const session = await runtime.rewind(sessionId, stepId);
          await terminalService?.closeSessionNonAgentTerminals?.(sessionId);
          const enrichedSession = await enrichSessionWithAgentState(terminalService, session, {
            runtime
          });
          vibe64SessionDebugLog("server.service.rewindSession.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            requestedStepId: stepId
          });
          return enrichedSession;
        } catch (error) {
          vibe64SessionDebugLog("server.service.rewindSession.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId,
            stepId
          });
          throw error;
        }
      });
    }
  });
}

export {
  createService,
  publicSessionResponse,
  publicSessionServiceResponse
};
