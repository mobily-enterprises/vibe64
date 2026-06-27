import crypto from "node:crypto";

import {
  VIBE64_AGENT_RUN_STATE,
  vibe64AgentRunStateIsActive,
  VIBE64_SESSION_STATUS,
  workflowDefinitionCreationOptions
} from "@local/vibe64-runtime/server";
import {
  normalizeVibe64AgentSettings
} from "@local/vibe64-runtime/shared";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  vibe64SessionDebugDurationMs,
  vibe64SessionDebugError,
  vibe64SessionDebugLog,
  vibe64SessionDebugSummary
} from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  assertVibe64SessionReady,
  readVibe64SessionReadiness
} from "@local/vibe64-runtime/server/setupReadiness";
import {
  sessionIsClosing
} from "@local/vibe64-runtime/server/sessionLifecycle";
import {
  terminalFailureFixRequestForSession
} from "@local/vibe64-runtime/server/terminalFailureFixRequest";
import { inspectSessionDiff } from "./sessionDiff.js";

const MAX_OPEN_VIBE64_SESSIONS = 3;
const CODEX_PROMPT_HANDOFF_DELIVERY_ENABLED = true;
const CODEX_APP_SERVER_TASK_ID = "codex_app_server";
const CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE = "vibe64_session_worktree_unavailable";
const CODEX_AGENT_TURN_ALREADY_RUNNING_CODE = "vibe64_agent_turn_already_running";
const CODEX_AGENT_TURN_RESULT_MISSING_MESSAGE = "Codex finished this turn, but Vibe64 did not receive the assistant result text. Retry the step.";
const VIBE64_ACTION_DISABLED_CODE = "vibe64_action_disabled";
const VIBE64_ADVANCE_STATE_CHANGED_CODE = "vibe64_advance_state_changed";
const STEP_STATUS_AWAITING_AGENT_RESULT = "awaiting_agent_result";
const STEP_STATUS_DONE = "done";
const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);
const CODEX_THREAD_RECONCILE_REFRESH_MS = 15000;
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

function sessionCanReconcileCodexThread(session = {}) {
  return !sessionIsClosing(session);
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

function timestampMs(value = "") {
  const timestamp = Date.parse(normalizedInputText(value));
  return Number.isFinite(timestamp) ? timestamp : null;
}

function timestampIsAfter(value = "", referenceMs = null) {
  const timestamp = timestampMs(value);
  return timestamp !== null && referenceMs !== null && timestamp >= referenceMs;
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

function readinessOptions(input = {}) {
  return {
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

function codexPromptHandoffFromSession(session = {}) {
  const handoff = session?.actionResult?.codexPromptHandoff;
  if (!handoff || typeof handoff !== "object" || Array.isArray(handoff)) {
    return null;
  }
  return String(handoff.kind || "") === "codex_prompt_handoff" ? handoff : null;
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
    normalizedInputText(result?.codexPromptHandoff?.kind) === "codex_prompt_handoff"
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
    text: normalizedInputText(source.text),
    updatedAt: normalizedInputText(source.updatedAt)
  };
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
      text: ""
    };
  }
  if (payload.kind === COMPOSER_DRAFT_KIND.SUBMISSION_REJECTED) {
    return {
      ...payload,
      kind: COMPOSER_DRAFT_KIND.DRAFT
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

async function createRuntimeForSessionInspection(projectService, setupServices = {}, input = {}) {
  const readiness = await readVibe64SessionReadiness(setupServices, readinessOptions(input));
  return {
    readiness,
    runtime: await projectService.createRuntime({
      actionReadiness: sessionReadinessActionReadiness(readiness)
    })
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

const DEFAULT_CONVERSATION_LOG_PAGE_LIMIT = 5;

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

async function sessionWithLatestRevision(runtime, session = {}) {
  if (!session?.sessionId || typeof runtime?.getSession !== "function") {
    return session;
  }
  return {
    ...await runtime.getSession(session.sessionId),
    actionResult: session.actionResult,
    codexPromptDelivery: session.codexPromptDelivery
  };
}

function codexTerminalPresentation(codexTerminal = null) {
  const terminal = objectValue(codexTerminal);
  const terminalSessionId = String(terminal.id || "").trim();
  return {
    label: "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId,
    visible: false,
    visibleUntil: ""
  };
}

function withCodexTerminalState(session = {}, terminalState = {}) {
  if (!session || session.ok === false || !session.sessionId) {
    return session;
  }
  const presentation = objectValue(session.presentation);
  return {
    ...session,
    agentConversationId: terminalState.agentConversationId || session.agentConversationId || "",
    agentIdentity: terminalState.agentIdentity || session.agentIdentity || null,
    agentIdentityProvider: terminalState.agentIdentityProvider || session.agentIdentityProvider || "",
    agentIdentityStatus: terminalState.agentIdentityStatus || session.agentIdentityStatus || "",
    agentResumeStrategy: terminalState.agentResumeStrategy || session.agentResumeStrategy || "",
    agentWorkdir: terminalState.agentWorkdir || session.agentWorkdir || "",
    codexAgentTurn: terminalState.codexAgentTurn || session.codexAgentTurn || null,
    codexAgentTurnActive: terminalState.codexAgentTurnActive ?? session.codexAgentTurnActive ?? false,
    codexTerminal: terminalState.codexTerminal || null,
    codexWorkdir: terminalState.codexWorkdir || session.codexWorkdir || "",
    codexPromptHandoffOutputStart: terminalState.codexPromptHandoffOutputStart ?? session.codexPromptHandoffOutputStart,
    codexPromptHandoffSignature: terminalState.codexPromptHandoffSignature || session.codexPromptHandoffSignature || "",
    codexThreadId: terminalState.codexThreadId || session.codexThreadId || "",
    intents: Array.isArray(presentation.intents) ? presentation.intents : [],
    presentation: {
      ...presentation,
      terminal: {
        ...objectValue(presentation.terminal),
        codex: codexTerminalPresentation(terminalState.codexTerminal || null)
      }
    }
  };
}

const CODEX_PROMPT_DELIVERY_SESSION_FIELDS = Object.freeze([
  "agentConversationId",
  "agentIdentity",
  "agentIdentityProvider",
  "agentIdentityStatus",
  "agentResumeStrategy",
  "agentWorkdir",
  "codexAgentTurn",
  "codexAgentTurnActive",
  "codexPromptHandoffOutputStart",
  "codexPromptHandoffSignature",
  "codexTerminal",
  "codexThreadId",
  "codexWorkdir"
]);

function codexPromptDeliverySessionState(delivery = {}) {
  const state = {};
  if (!delivery || typeof delivery !== "object" || Array.isArray(delivery)) {
    return state;
  }
  for (const field of CODEX_PROMPT_DELIVERY_SESSION_FIELDS) {
    if (delivery[field] !== undefined) {
      state[field] = delivery[field];
    }
  }
  return state;
}

async function markCodexPromptDeliveryFailed(runtime, session = {}, error = "") {
  if (
    !session?.sessionId ||
    typeof runtime?.store?.writeAgentRunEvent !== "function"
  ) {
    return null;
  }
  const updatedAt = new Date().toISOString();
  return runtime.store.writeAgentRunEvent(session.sessionId, CODEX_APP_SERVER_TASK_ID, {
    event: {
      kind: "codex-prompt-handoff-delivery-failed",
      message: normalizedInputText(error),
      state: VIBE64_AGENT_RUN_STATE.FAILED
    },
    patch: {
      error: normalizedInputText(error),
      provider: "codex",
      providerInterface: "app-server",
      providerStatus: "delivery_failed",
      providerThreadId: normalizedInputText(session.codexThreadId),
      providerTurnId: "",
      state: VIBE64_AGENT_RUN_STATE.FAILED,
      stepId: normalizedInputText(session.currentStep),
      stepStatus: normalizedInputText(session.stepMachine?.status),
      updatedAt
    }
  });
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

function codexAppServerDeliveryRunning(session = {}) {
  return sessionBackgroundTasks(session).some((task) => (
    normalizedInputText(task.id) === CODEX_APP_SERVER_TASK_ID &&
    normalizedInputText(task.status) === "running"
  ));
}

function codexAppServerWorkFailedAfterAgentWait(session = {}) {
  const waitStartedMs = timestampMs(session?.stepMachine?.at);
  if (waitStartedMs === null) {
    return false;
  }
  const taskFailed = sessionBackgroundTasks(session).some((task) => (
    normalizedInputText(task.id) === CODEX_APP_SERVER_TASK_ID &&
    normalizedInputText(task.status) === "failed" &&
    timestampIsAfter(task.updatedAt || task.finishedAt || task.at, waitStartedMs)
  ));
  if (taskFailed) {
    return true;
  }
  const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
  return runs.some((run) => (
    normalizedInputText(run?.id) === CODEX_APP_SERVER_TASK_ID &&
    (
      normalizedInputText(run?.state) === VIBE64_AGENT_RUN_STATE.FAILED ||
      normalizedInputText(run?.providerStatus) === "delivery_failed"
    ) &&
    timestampIsAfter(run?.updatedAt || run?.finishedAt || run?.at, waitStartedMs)
  ));
}

function codexAppServerTaskNewerThanRun(session = {}, run = {}) {
  const runUpdatedAt = run?.updatedAt || run?.startedAt || run?.at;
  const runUpdatedMs = timestampMs(runUpdatedAt);
  if (runUpdatedMs === null) {
    return false;
  }
  return sessionBackgroundTasks(session).some((task) => (
    normalizedInputText(task.id) === CODEX_APP_SERVER_TASK_ID &&
    ["failed", "ready"].includes(normalizedInputText(task.status)) &&
    timestampIsAfter(task.updatedAt || task.finishedAt || task.at, runUpdatedMs)
  ));
}

function abandonedCodexAppServerPromptClaim(session = {}) {
  const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
  return runs.find((run) => (
    normalizedInputText(run?.id) === CODEX_APP_SERVER_TASK_ID &&
    (
      run?.active === true ||
      vibe64AgentRunStateIsActive(run?.state)
    ) &&
    normalizedInputText(run?.state) === VIBE64_AGENT_RUN_STATE.STARTING &&
    !normalizedInputText(run?.providerThreadId) &&
    !normalizedInputText(run?.providerTurnId) &&
    codexAppServerTaskNewerThanRun(session, run)
  )) || null;
}

async function recoverAbandonedCodexAppServerPromptClaim(runtime, session = {}) {
  const abandonedRun = abandonedCodexAppServerPromptClaim(session);
  if (
    !abandonedRun ||
    !session?.sessionId ||
    typeof runtime?.store?.writeAgentRunEvent !== "function" ||
    typeof runtime?.getSession !== "function"
  ) {
    return session;
  }
  const updatedAt = new Date().toISOString();
  await runtime.store.writeAgentRunEvent(session.sessionId, CODEX_APP_SERVER_TASK_ID, {
    event: {
      kind: "codex-prompt-handoff-abandoned",
      message: "Codex app-server prompt handoff was abandoned before a provider turn was created.",
      state: VIBE64_AGENT_RUN_STATE.FAILED
    },
    patch: {
      error: "Codex app-server prompt handoff was abandoned before a provider turn was created.",
      provider: "codex",
      providerInterface: "app-server",
      providerStatus: "delivery_failed",
      providerThreadId: "",
      providerTurnId: "",
      state: VIBE64_AGENT_RUN_STATE.FAILED,
      stepId: normalizedInputText(session.currentStep),
      stepStatus: normalizedInputText(session.stepMachine?.status),
      updatedAt
    }
  });
  vibe64SessionDebugLog("server.service.agentWait.abandonedPromptClaim", {
    runUpdatedAt: normalizedInputText(abandonedRun.updatedAt),
    sessionId: session.sessionId
  });
  return runtime.getSession(session.sessionId);
}

function sessionHasActiveAgentRun(session = {}) {
  const runs = Array.isArray(session.agentRuns) ? session.agentRuns : [];
  return runs.some((run) => (
    run?.active === true ||
    vibe64AgentRunStateIsActive(run?.state)
  ));
}

function sessionHasActiveAgentWork(session = {}) {
  return sessionHasActiveAgentRun(session) ||
    codexAppServerDeliveryRunning(session) ||
    terminalStateHasActiveCodexTurn(session);
}

function terminalStateHasActiveCodexTurn(terminalState = {}) {
  return terminalState.codexAgentTurnActive === true ||
    terminalState.codexAgentTurn?.active === true;
}

function terminalStateHasCompletedTrackedCodexTurn(terminalState = {}) {
  if (terminalStateHasActiveCodexTurn(terminalState)) {
    return false;
  }
  const turn = terminalState.codexAgentTurn || {};
  const hasTrackedTurn = Boolean(
    normalizedInputText(turn.threadId) ||
    normalizedInputText(turn.turnId)
  );
  if (!hasTrackedTurn) {
    return false;
  }
  const state = normalizedInputText(turn.state);
  const status = normalizedInputText(turn.status);
  return ["completed", "idle"].includes(state) &&
    ["completed", "succeeded", "success"].includes(status);
}

function agentWaitRecoveryOptionsForTerminalState(terminalState = {}) {
  if (!terminalStateHasCompletedTrackedCodexTurn(terminalState)) {
    return {};
  }
  return {
    inputPrompt: CODEX_AGENT_TURN_RESULT_MISSING_MESSAGE,
    message: CODEX_AGENT_TURN_RESULT_MISSING_MESSAGE,
    reason: "codex_turn_result_missing"
  };
}

function promptActionStillNeedsStartupProtection(session = {}, terminalState = {}) {
  if (!sessionHasPromptActionInFlight(session)) {
    return false;
  }
  if (
    codexAppServerWorkFailedAfterAgentWait(session) ||
    terminalStateHasCompletedTrackedCodexTurn(terminalState)
  ) {
    return false;
  }
  return true;
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

async function recoverAgentWaitWithoutCodex(runtime, session = {}, terminalState = {}, {
  inputPrompt = "What would you like to do next?",
  message = "Codex is no longer running for this turn, so Vibe64 returned control to you.",
  reason = "no_active_codex_turn"
} = {}) {
  if (!sessionAwaitsAgentResult(session)) {
    return session;
  }
  const currentSession = await recoverAbandonedCodexAppServerPromptClaim(
    runtime,
    await latestSessionForAgentWaitRecovery(runtime, session)
  );
  if (
    !sessionAwaitsAgentResult(currentSession) ||
    promptActionStillNeedsStartupProtection(currentSession, terminalState) ||
    terminalStateHasActiveCodexTurn(terminalState) ||
    sessionHasActiveAgentRun(currentSession) ||
    codexAppServerDeliveryRunning(currentSession)
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

function codexDeliveryBlockedByMissingWorktree(delivery = {}) {
  return normalizedInputText(delivery?.code) === CODEX_SESSION_WORKTREE_UNAVAILABLE_CODE;
}

function codexDeliveryBlockedByActiveAgentTurn(delivery = {}) {
  return normalizedInputText(delivery?.code) === CODEX_AGENT_TURN_ALREADY_RUNNING_CODE;
}

async function recoverAgentWaitForMissingWorktree(runtime, session = {}, delivery = {}) {
  const recoveredSession = await recoverAgentWaitWithoutCodex(runtime, session, {}, {
    inputPrompt: "Recover this session before continuing.",
    message: normalizedInputText(delivery?.error) ||
      "Session clone is unavailable. Recover this session before continuing with Codex.",
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
    return enrichSessionWithCodexTerminal(terminalService, observed.session, {
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

async function recoverAgentWaitAfterCodexTerminalStateFailure(runtime, session = {}) {
  const recoveredSession = await recoverAgentWaitWithoutCodex(runtime, session, {});
  return sessionAwaitsAgentResult(recoveredSession) ? null : recoveredSession;
}

async function enrichSessionWithCodexTerminal(terminalService, session = {}, {
  runtime = null
} = {}) {
  if (!session || session.ok === false || !session.sessionId) {
    return session;
  }
  if (typeof terminalService?.codexTerminalState !== "function") {
    vibe64SessionDebugLog("server.service.codexTerminalState.skipped", {
      reason: "service_unavailable",
      sessionId: session.sessionId
    });
    const recoveredSession = await recoverAgentWaitWithoutCodex(runtime, session, {});
    return withCodexTerminalState(recoveredSession, {});
  }
  const startedAtMs = Date.now();
  vibe64SessionDebugLog("server.service.codexTerminalState.start", {
    sessionId: session.sessionId
  });
  let terminalState = null;
  try {
    terminalState = await terminalService.codexTerminalState(session.sessionId);
  } catch (error) {
    const recoveredSession = await recoverAgentWaitAfterCodexTerminalStateFailure(runtime, session);
    if (recoveredSession) {
      vibe64SessionDebugLog("server.service.codexTerminalState.recovered", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: vibe64SessionDebugError(error),
        sessionId: session.sessionId
      });
      return withCodexTerminalState(recoveredSession, {});
    }
    throw error;
  }
  if (terminalState?.ok === false) {
    const recoveredSession = await recoverAgentWaitAfterCodexTerminalStateFailure(runtime, session);
    if (recoveredSession) {
      vibe64SessionDebugLog("server.service.codexTerminalState.recovered", {
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        error: String(terminalState.error || "Vibe64 Codex terminal state could not be read."),
        sessionId: session.sessionId
      });
      return withCodexTerminalState(recoveredSession, {});
    }
    vibe64SessionDebugLog("server.service.codexTerminalState.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: String(terminalState.error || "Vibe64 Codex terminal state could not be read."),
      sessionId: session.sessionId
    });
    throw new Error(terminalState.error || "Vibe64 Codex terminal state could not be read.");
  }
  const sessionForRecovery = terminalState?.sessionUpdated === true && typeof runtime?.getSession === "function"
    ? await runtime.getSession(session.sessionId).catch(() => session)
    : session;
  const recoveredSession = await recoverAgentWaitWithoutCodex(
    runtime,
    sessionForRecovery,
    terminalState || {},
    agentWaitRecoveryOptionsForTerminalState(terminalState || {})
  );
  const enrichedSession = withCodexTerminalState(recoveredSession, terminalState || {});
  vibe64SessionDebugLog("server.service.codexTerminalState.done", {
    ...vibe64SessionDebugSummary(enrichedSession),
    codexTerminalId: String(enrichedSession.codexTerminal?.id || ""),
    codexTerminalStatus: String(enrichedSession.codexTerminal?.status || ""),
    durationMs: vibe64SessionDebugDurationMs(startedAtMs)
  });
  return enrichedSession;
}

async function prepareCodexThreadForSession(terminalService, session = {}) {
  if (!session || session.ok === false || !session.sessionId) {
    return session;
  }
  if (!codexThreadReconcileWorkdir(session)) {
    vibe64SessionDebugLog("server.service.ensureCodexThread.skipped", {
      reason: "worktree_unavailable",
      sessionId: session.sessionId
    });
    return session;
  }
  if (typeof terminalService?.ensureCodexThread !== "function") {
    vibe64SessionDebugLog("server.service.ensureCodexThread.skipped", {
      reason: "service_unavailable",
      sessionId: session.sessionId
    });
    return session;
  }
  const startedAtMs = Date.now();
  vibe64SessionDebugLog("server.service.ensureCodexThread.start", {
    sessionId: session.sessionId
  });
  const result = await terminalService.ensureCodexThread(session.sessionId);
  if (result?.ok === false) {
    vibe64SessionDebugLog("server.service.ensureCodexThread.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: String(result.error || "Vibe64 Codex app-server thread could not be prepared."),
      sessionId: session.sessionId
    });
    return session;
  }
  vibe64SessionDebugLog("server.service.ensureCodexThread.done", {
    durationMs: vibe64SessionDebugDurationMs(startedAtMs),
    sessionId: session.sessionId
  });
  return session;
}

async function deliverCodexPromptIfNeeded(terminalService, session = {}, {
  agentSettings = {},
  runtime = null,
  vibe64User = null
} = {}) {
  const handoff = codexPromptHandoffFromSession(session);
  if (!handoff) {
    vibe64SessionDebugLog("server.service.deliverCodexPrompt.skipped", {
      reason: "no_handoff",
      sessionId: String(session?.sessionId || "")
    });
    return session;
  }
  if (!CODEX_PROMPT_HANDOFF_DELIVERY_ENABLED) {
    vibe64SessionDebugLog("server.service.deliverCodexPrompt.skipped", {
      promptId: String(handoff.promptId || ""),
      reason: "delivery_disabled",
      sessionId: String(session?.sessionId || "")
    });
    return session;
  }
  if (typeof terminalService?.injectCodexPrompt !== "function") {
    vibe64SessionDebugLog("server.service.deliverCodexPrompt.error", {
      error: "Vibe64 Codex prompt delivery service is not available.",
      sessionId: String(session?.sessionId || "")
    });
    throw new Error("Vibe64 Codex prompt delivery service is not available.");
  }
  const startedAtMs = Date.now();
  vibe64SessionDebugLog("server.service.deliverCodexPrompt.start", {
    promptId: String(handoff.promptId || ""),
    sessionId: session.sessionId
  });
  let delivery = null;
  try {
    delivery = await terminalService.injectCodexPrompt(session.sessionId, handoff, {
      agentSettings,
      vibe64User
    });
  } catch (error) {
    await markCodexPromptDeliveryFailed(runtime, session, error?.message || error);
    await recoverAgentWaitWithoutCodex(runtime, session, {}, {
      reason: "codex_prompt_delivery_exception"
    });
    throw error;
  }
  if (delivery?.ok === false) {
    if (codexDeliveryBlockedByActiveAgentTurn(delivery)) {
      vibe64SessionDebugLog("server.service.deliverCodexPrompt.blocked", {
        code: String(delivery.code || ""),
        durationMs: vibe64SessionDebugDurationMs(startedAtMs),
        operationOutcome: String(delivery.operationOutcome || ""),
        promptId: String(handoff.promptId || ""),
        reason: "active_agent_turn",
        sessionId: session.sessionId
      });
      return sessionWithLatestRevision(runtime, session);
    }
    vibe64SessionDebugLog("server.service.deliverCodexPrompt.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: String(delivery.error || "Vibe64 Codex prompt delivery failed."),
      promptId: String(handoff.promptId || ""),
      sessionId: session.sessionId
    });
    if (codexDeliveryBlockedByMissingWorktree(delivery)) {
      await markCodexPromptDeliveryFailed(runtime, session, delivery?.error);
      return recoverAgentWaitForMissingWorktree(runtime, session, delivery);
    }
    await markCodexPromptDeliveryFailed(runtime, session, delivery?.error);
    await recoverAgentWaitWithoutCodex(runtime, session, {}, {
      reason: "codex_prompt_delivery_failed"
    });
    throw new Error(delivery.error || "Vibe64 Codex prompt delivery failed.");
  }
  vibe64SessionDebugLog("server.service.deliverCodexPrompt.done", {
    durationMs: vibe64SessionDebugDurationMs(startedAtMs),
    promptId: String(handoff.promptId || ""),
    sessionId: session.sessionId,
    terminalSessionId: String(delivery?.terminalSessionId || "")
  });
  const latestSession = runtime
    ? await sessionWithLatestRevision(runtime, session)
    : session;
  return {
    ...latestSession,
    ...codexPromptDeliverySessionState(delivery),
    codexPromptDelivery: delivery
  };
}

function sessionLimits(sessions = [], {
  maxOpenSessions = MAX_OPEN_VIBE64_SESSIONS
} = {}) {
  return {
    maxOpenSessions,
    openSessionCount: sessions.filter(isOpenVibe64Session).length
  };
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

const PUBLIC_SESSION_METADATA_OMITTED_KEYS = new Set([
  "codex_prompt_handoff_echo_input",
  "codex_session_briefing_echo_input"
]);

const PUBLIC_ACTION_RESULT_OMITTED_KEYS = new Set([
  "codexPromptHandoff",
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
  "config",
  "currentStep",
  "currentStepDefinition",
  "intents",
  "metadata",
  "next",
  "presentation",
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

function publicSessionMetadata(metadata = {}) {
  return objectWithoutKeys(metadata, PUBLIC_SESSION_METADATA_OMITTED_KEYS);
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
  if (isPlainObject(session.metadata)) {
    publicSession.metadata = publicSessionMetadata(session.metadata);
  }
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
    publicSession.agentRuns = session.agentRuns.map(publicAgentRun);
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
  const limits = sessionLimits(sessions, {
    maxOpenSessions: workflow.seedRequired ? 1 : MAX_OPEN_VIBE64_SESSIONS
  });
  return {
    creation: {
      ...workflow,
      canCreate: limits.openSessionCount < limits.maxOpenSessions,
      disabledReason: limits.openSessionCount >= limits.maxOpenSessions
        ? sessionLimitMessage(limits, workflow)
        : ""
    },
    limits
  };
}

function sessionLimitMessage(limits = {}, workflow = {}) {
  if (workflow.seedRequired) {
    return "The first Vibe64 session must seed the application. Finish or abandon the current seed session before creating another session.";
  }
  return `Studio allows up to ${limits.maxOpenSessions} active sessions at once. Finish or abandon one before creating another.`;
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

function sessionProjectGithubMetadata(project = {}) {
  const repository = isPlainObject(project?.githubRepository)
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

function sessionProjectMetadata(projectType = {}, project = {}) {
  return {
    adapter_id: projectType.adapter?.id || projectType.projectType,
    project_type: projectType.projectType,
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

function codexThreadReconcileWorkdir(session = {}) {
  const metadata = objectValue(session?.metadata);
  return normalizedInputText(metadata.worktree_path || session?.worktreePath || session?.worktree);
}

function codexThreadReconcileReadySessions(sessions = []) {
  return (Array.isArray(sessions) ? sessions : [])
    .filter((session) => normalizedInputText(session?.sessionId || session?.id || session) &&
      sessionCanReconcileCodexThread(session) &&
      codexThreadReconcileWorkdir(session));
}

function reconcileCodexThreadsInBackground(terminalService, sessions = [], {
  eventPrefix = "server.service.codexThreadReconcile"
} = {}) {
  const readySessions = codexThreadReconcileReadySessions(sessions);
  if (typeof terminalService?.reconcileCodexThreads !== "function" || readySessions.length < 1) {
    return;
  }
  const sessionIds = readySessions
    .map((session) => normalizedInputText(session?.sessionId || session?.id || session))
    .filter(Boolean);
  if (sessionIds.length < 1) {
    return;
  }
  const reconcileStartedAtMs = Date.now();
  vibe64SessionDebugLog(`${eventPrefix}.start`, {
    sessionCount: sessionIds.length,
    sessionIds
  });
  const reconciliation = terminalService.reconcileCodexThreads(readySessions);
  void Promise.resolve(reconciliation)
    .then((result = {}) => {
      vibe64SessionDebugLog(`${eventPrefix}.done`, {
        durationMs: vibe64SessionDebugDurationMs(reconcileStartedAtMs),
        failedCount: Array.isArray(result.failed) ? result.failed.length : 0,
        ok: result.ok !== false,
        sessionCount: Number(result.sessionCount || sessionIds.length)
      });
    })
    .catch((error) => {
      vibe64SessionDebugLog(`${eventPrefix}.error`, {
        durationMs: vibe64SessionDebugDurationMs(reconcileStartedAtMs),
        error: vibe64SessionDebugError(error),
        sessionCount: sessionIds.length
      });
    });
}

function codexThreadReconcileSessionSignature(session = {}) {
  const workdir = codexThreadReconcileWorkdir(session);
  if (!workdir) {
    return "";
  }
  return [
    normalizedInputText(session?.sessionId || session?.id || session),
    normalizedInputText(session?.status),
    normalizedInputText(session?.targetRoot),
    normalizedInputText(session?.sessionRoot),
    workdir
  ].join("\u001f");
}

function codexThreadReconcileSignature(sessions = []) {
  return (Array.isArray(sessions) ? sessions : [])
    .map((session) => codexThreadReconcileSessionSignature(session))
    .filter(Boolean)
    .sort()
    .join("\u001e");
}

function normalizedCodexThreadReconcileRefreshMs(value) {
  const number = Number(value);
  return Number.isFinite(number) && number >= 0
    ? number
    : CODEX_THREAD_RECONCILE_REFRESH_MS;
}

function currentTimeMs(now = Date.now) {
  try {
    const value = Number(now());
    return Number.isFinite(value) ? value : Date.now();
  } catch {
    return Date.now();
  }
}

function createService({
  codexThreadReconcileRefreshMs = CODEX_THREAD_RECONCILE_REFRESH_MS,
  now = Date.now,
  projectService,
  setupServices = {},
  terminalService
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }
  let lastAutomaticCodexThreadReconcileSignature = "";
  let lastAutomaticCodexThreadReconcileAtMs = null;
  const automaticCodexThreadReconcileRefreshMs =
    normalizedCodexThreadReconcileRefreshMs(codexThreadReconcileRefreshMs);

  function reconcileCodexThreadsWhenOpenSessionsChange(openSessions = []) {
    const signature = codexThreadReconcileSignature(openSessions);
    if (!signature) {
      return;
    }
    const nowMs = currentTimeMs(now);
    const elapsedMs = lastAutomaticCodexThreadReconcileAtMs === null
      ? null
      : nowMs - lastAutomaticCodexThreadReconcileAtMs;
    const refreshDue = elapsedMs === null ||
      elapsedMs < 0 ||
      elapsedMs >= automaticCodexThreadReconcileRefreshMs;
    if (signature === lastAutomaticCodexThreadReconcileSignature && !refreshDue) {
      return;
    }
    lastAutomaticCodexThreadReconcileSignature = signature;
    lastAutomaticCodexThreadReconcileAtMs = nowMs;
    reconcileCodexThreadsInBackground(terminalService, openSessions);
  }

  return Object.freeze({
    async readComposerDraft(sessionId, input = {}) {
      const normalizedSessionId = normalizedInputText(sessionId);
      const controlId = normalizedInputText(input?.controlId);
      if (!normalizedSessionId || !controlId) {
        return {
          ok: false,
          error: "Composer draft reads require a session and control."
        };
      }
      const runtime = await projectService.createRuntime();
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
        text: normalizedInputText(input?.text),
        updatedAt: new Date().toISOString()
      };
      if (!draftInput.sessionId || !draftInput.controlId || !draftInput.fieldName || !draftInput.originId) {
        return {
          ok: false,
          error: "Composer draft updates require a session, control, field, and origin."
        };
      }
      const runtime = await projectService.createRuntime();
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
          await assertVibe64SessionReady(setupServices, readinessOptions(expected));
          runtime = await projectService.createRuntime();
          const alreadyAdvancedSession = await observeAlreadyAdvancedSession(runtime, sessionId, workflowExpected);
          if (alreadyAdvancedSession) {
            const enrichedAlreadyAdvancedSession = await enrichSessionWithCodexTerminal(terminalService, alreadyAdvancedSession, {
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
          const session = await runtime.advance(sessionId, workflowExpected);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session, {
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
              const enrichedObservedSession = await enrichSessionWithCodexTerminal(terminalService, observedSession, {
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
      void input;
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.abandonSession.start", {
        sessionId
      });
      return sessionResult(async () => {
        let runtime = null;
        let archiveStarted = false;
        try {
          runtime = await projectService.createRuntime();
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
            await runtime.archiveSessionWorktree(session, {
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

    async recoverSessionWorktree(sessionId, input = {}) {
      void input;
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.recoverSessionWorktree.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime();
          const recoveredSession = await runtime.recoverSessionWorktree(sessionId);
          vibe64SessionDebugLog("server.service.recoverSessionWorktree.done", {
            ...sessionServiceDebugResponse(recoveredSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return recoveredSession;
        } catch (error) {
          vibe64SessionDebugLog("server.service.recoverSessionWorktree.error", {
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
          await assertVibe64SessionReady(setupServices, readinessOptions(input));
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
          if (limits.openSessionCount >= limits.maxOpenSessions) {
            vibe64SessionDebugLog("server.service.createSession.blocked", {
              code: "open_session_limit",
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              maxOpenSessions: limits.maxOpenSessions,
              openSessionCount: limits.openSessionCount
            });
            return {
              errors: [
                {
                  code: "open_session_limit",
                  message: sessionLimitMessage(limits, creation)
                }
              ],
              creation,
              limits,
              ok: false,
              sessions: existingOpenSessions,
              status: "blocked"
            };
          }
          const syncBlocker = mainCheckoutSyncBlocker(existingOpenSessions);
          if (syncBlocker) {
            vibe64SessionDebugLog("server.service.createSession.blocked", {
              blockerSessionId: syncBlocker.sessionId,
              code: "main_checkout_sync_required",
              durationMs: vibe64SessionDebugDurationMs(startedAtMs)
            });
            return {
              errors: [
                {
                  code: "main_checkout_sync_required",
                  message: `Session ${syncBlocker.sessionId} has merged a pull request but has not refreshed the Git cache. Run Refresh Git cache there before starting another session.`
                }
              ],
              creation: {
                ...creation,
                canCreate: false,
                disabledReason: `Session ${syncBlocker.sessionId} has merged a pull request but has not refreshed the Git cache. Run Refresh Git cache there before starting another session.`
              },
              limits,
              ok: false,
              sessions: existingOpenSessions,
              status: "blocked"
            };
          }
          const definitionSelection = selectedWorkflowDefinitionId(input, creation);
          if (definitionSelection.error) {
            vibe64SessionDebugLog("server.service.createSession.blocked", {
              code: "workflow_definition_not_available",
              durationMs: vibe64SessionDebugDurationMs(startedAtMs),
              requestedWorkflowDefinition: String(input?.workflowDefinition || "")
            });
            return {
              creation,
              errors: [
                {
                  code: "workflow_definition_not_available",
                  message: definitionSelection.error
                }
              ],
              limits,
              ok: false,
              sessions: existingOpenSessions,
              status: "blocked"
            };
          }
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
          await prepareCodexThreadForSession(terminalService, advancedSession);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, advancedSession, {
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

    async inspectSession(sessionId, input = {}) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.inspectSession.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const {
            readiness,
            runtime
          } = await createRuntimeForSessionInspection(projectService, setupServices, input);
          const runtimeSession = await runtime.getSession(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, runtimeSession, {
            runtime
          });
          const session = sessionViewWithReadiness(enrichedSession, readiness);
          vibe64SessionDebugLog("server.service.inspectSession.done", {
            ...sessionServiceDebugResponse(session),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return session;
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
          includeComposerMenu: input?.includeComposerMenu === true ||
            normalizedInputText(input?.includeComposerMenu) === "1"
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
          const runtime = await projectService.createRuntime();
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

    async inspectSessionDiff(sessionId) {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        return inspectSessionDiff(await runtime.getSession(sessionId));
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
          const runtime = await projectService.createRuntime();
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
          await assertVibe64SessionReady(setupServices, readinessOptions(input));
          const runtime = await projectService.createRuntime();
          await terminalService?.closeSessionNonCodexTerminals?.(sessionId);
          const session = await runtime.recoverStuckStep(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session, {
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
      void input;
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.returnAgentControl.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime();
          const session = await runtime.returnControlFromAgentWait(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session, {
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
          const runtime = await projectService.createRuntime();
          const options = sessionListOptions(input);
          const sessions = await listSessionSummaries(runtime, options.runtimeOptions);
          const openSessions = isOpenSessionList(options)
            ? sessions
            : await listOpenSessionSummaries(runtime);
          const creationState = await sessionCreationState(runtime, openSessions);
          const response = sessionListResponse(sessions, creationState);
          reconcileCodexThreadsWhenOpenSessionsChange(openSessions);
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
      const displayInput = conversationDisplayInput(input);
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.runSessionAction.start", {
        actionId,
        sessionId
      });
      return sessionResult(async () => {
        let runtime = null;
        try {
          await assertVibe64SessionReady(setupServices, readinessOptions(input));
          runtime = await projectService.createRuntime();
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
          const enrichedSession = await enrichSessionWithCodexTerminal(
            terminalService,
            await deliverCodexPromptIfNeeded(terminalService, session, {
              agentSettings,
              runtime,
              vibe64User: input?.vibe64User || null
            }),
            {
              runtime
            }
          );
          vibe64SessionDebugLog("server.service.runSessionAction.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            actionId,
            actionResultStatus: String(enrichedSession.actionResult?.status || ""),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
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
        try {
          await assertVibe64SessionReady(setupServices, readinessOptions(input));
          runtime = await projectService.createRuntime();
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
          const enrichedSession = await enrichSessionWithCodexTerminal(
            terminalService,
            await deliverCodexPromptIfNeeded(terminalService, session, {
              agentSettings,
              runtime,
              vibe64User: input?.vibe64User || null
            }),
            {
              runtime
            }
          );
          vibe64SessionDebugLog("server.service.runSessionIntent.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            actionResultStatus: String(enrichedSession.actionResult?.status || ""),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            intentId
          });
          return enrichedSession;
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
          await assertVibe64SessionReady(setupServices, readinessOptions(input));
          const runtime = await projectService.createRuntime();
          const session = await runtime.rewind(sessionId, stepId);
          await terminalService?.closeSessionNonCodexTerminals?.(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session, {
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
