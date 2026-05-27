import {
  STEP_STATUS,
  VIBE64_SESSION_STATUS,
  workflowDefinitionCreationOptions
} from "@local/vibe64-runtime/server";
import {
  VIBE64_CLIENT_CONTROL_ACTIONS
} from "@local/vibe64-core/shared";
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
  assertVibe64SetupReady
} from "@local/vibe64-runtime/server/setupReadiness";
import {
  terminalFailureFixRequestForSession
} from "@local/vibe64-runtime/server/terminalFailureFixRequest";
import { inspectSessionDiff } from "./sessionDiff.js";

const MAX_OPEN_VIBE64_SESSIONS = 5;
const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);
const SESSION_ARCHIVE_QUERY = Object.freeze({
  ABANDONED: "abandoned",
  COMPLETED: "completed",
  FINISHED: "finished"
});

function sessionResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_session_request_failed",
    fallbackMessage: "Vibe64 session request failed."
  });
}

function isOpenVibe64Session(session = {}) {
  return !CLOSED_SESSION_STATUSES.has(String(session.status || ""));
}

function normalizedInputText(value = "") {
  return String(value || "").trim();
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

function objectValue(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
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

function shouldRecordConversationUserMessage(actionResult = {}) {
  return actionResult?.recordsConversationTurn === true;
}

async function recordConversationUserMessage(runtime, sessionId, {
  actionResult = {},
  input = {}
} = {}) {
  if (!shouldRecordConversationUserMessage(actionResult)) {
    return null;
  }
  const text = conversationRequestText(input);
  if (!text || typeof runtime?.store?.writeConversationUserMessage !== "function") {
    return null;
  }
  return runtime.store.writeConversationUserMessage(sessionId, {
    text
  });
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

const CODEX_TERMINAL_ACTIVITY_PREVIEW_MS = 2500;
const CODEX_WAIT_RECOVERY_DELAY_MS = 30000;

function timeMs(value = "") {
  const time = Date.parse(String(value || ""));
  return Number.isFinite(time) ? time : 0;
}

function nextFutureIso(timestamps = [], nowMs = Date.now()) {
  const nextTimestamp = timestamps
    .filter((timestamp) => Number.isFinite(timestamp) && timestamp > nowMs)
    .sort((left, right) => left - right)[0];
  return nextTimestamp ? new Date(nextTimestamp).toISOString() : "";
}

function latestCodexTerminalInputActivity(terminal = {}) {
  const inputAt = timeMs(terminal.lastInputAt);
  if (!inputAt) {
    return null;
  }
  return {
    activityAt: inputAt,
    visibleUntil: new Date(inputAt + CODEX_TERMINAL_ACTIVITY_PREVIEW_MS).toISOString()
  };
}

function codexTerminalPresentation(codexTerminal = null) {
  const terminal = objectValue(codexTerminal);
  const terminalSessionId = String(terminal.id || "").trim();
  const latestActivity = latestCodexTerminalInputActivity(terminal);
  const visibleUntilMs = timeMs(latestActivity?.visibleUntil);
  const visible = Boolean(
    terminalSessionId &&
    terminal.status !== "exited" &&
    latestActivity &&
    Date.now() <= visibleUntilMs
  );
  return {
    label: visible ? terminal.activityLabel || "Terminal is transmitting..." : "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId,
    visible,
    visibleUntil: latestActivity?.visibleUntil || ""
  };
}

function codexWaitStepStartedAt(session = {}) {
  return timeMs(session.stepMachine?.at);
}

function terminalInputMs(terminal = {}) {
  return timeMs(terminal.lastInputAt);
}

function terminalTurnStartedAt(terminal = {}) {
  return timeMs(terminal.activityStartedAt);
}

function promptHandoffSignatureStartedAt(session = {}) {
  const signature = String(session.metadata?.codex_prompt_handoff_signature || "").trim();
  const timestamp = Number(signature.split(":").at(-1));
  return Number.isSafeInteger(timestamp) && timestamp > 0 ? timestamp : 0;
}

function codexWaitReferenceAt(session = {}, terminal = {}) {
  const stepStartedAt = codexWaitStepStartedAt(session);
  const candidates = [
    terminalTurnStartedAt(terminal),
    promptHandoffSignatureStartedAt(session),
    stepStartedAt
  ].filter((timestamp) => timestamp && (!stepStartedAt || timestamp >= stepStartedAt));
  return candidates.length ? Math.max(...candidates) : stepStartedAt;
}

function waitAgeMs(session = {}, terminal = {}, nowMs = Date.now()) {
  const reference = codexWaitReferenceAt(session, terminal);
  return reference ? Math.max(0, nowMs - reference) : Number.POSITIVE_INFINITY;
}

function terminalHasRecentVibe64InputForTurn(terminal = {}, nowMs = Date.now()) {
  const startedAt = terminalTurnStartedAt(terminal);
  const inputAt = timeMs(terminal.lastInputAt);
  return Boolean(
    startedAt &&
    inputAt >= startedAt &&
    nowMs - inputAt <= CODEX_TERMINAL_ACTIVITY_PREVIEW_MS
  );
}

function codexWaitRefreshAt(session = {}, terminal = {}, nowMs = Date.now()) {
  const inputAt = terminalInputMs(terminal);
  const referenceAt = codexWaitReferenceAt(session, terminal);
  const ageMs = waitAgeMs(session, terminal, nowMs);
  const candidates = [];

  if (ageMs < CODEX_WAIT_RECOVERY_DELAY_MS) {
    if (terminalHasRecentVibe64InputForTurn(terminal, nowMs)) {
      candidates.push(inputAt + CODEX_TERMINAL_ACTIVITY_PREVIEW_MS);
    }
    candidates.push(referenceAt + CODEX_WAIT_RECOVERY_DELAY_MS);
  }

  return nextFutureIso(candidates, nowMs);
}

function codexRecoveryControlIntent({
  id = "continue_codex_turn",
  label = "Ask Codex to continue",
  style = "primary"
} = {}) {
  return {
    actionId: "",
    control: {
      action: VIBE64_CLIENT_CONTROL_ACTIONS.CONTINUE_CODEX_TURN,
      disabledWhen: [],
      icon: "",
      loadingWhen: []
    },
    disabledReason: "",
    enabled: true,
    id,
    inputFields: [],
    label,
    style
  };
}

function sessionWaitsForCodex(session = {}) {
  return String(session.stepMachine?.status || "").trim() === STEP_STATUS.AWAITING_AGENT_RESULT;
}

function codexWaitPresentationOverlay(session = {}, terminalState = {}) {
  if (!sessionWaitsForCodex(session)) {
    return null;
  }
  const terminal = objectValue(terminalState.codexTerminal);
  const terminalSessionId = String(terminal.id || "").trim();
  const terminalRunning = Boolean(terminalSessionId && terminal.status !== "exited");
  const nowMs = Date.now();
  const ageMs = waitAgeMs(session, terminal);
  const refreshAt = codexWaitRefreshAt(session, terminal, nowMs);

  if (!terminalRunning) {
    return {
      intents: [codexRecoveryControlIntent()],
      screen: {
        icon: "warning",
        kind: "codex_attention",
        message: "Codex is not running for the current step.",
        sections: [],
        showProgress: false,
        title: "Codex needs attention"
      }
    };
  }

  if (ageMs < CODEX_WAIT_RECOVERY_DELAY_MS && terminalHasRecentVibe64InputForTurn(terminal, nowMs)) {
    return {
      refreshAt
    };
  }

  if (ageMs < CODEX_WAIT_RECOVERY_DELAY_MS) {
    return {
      intents: [],
      refreshAt,
      screen: {
        icon: "progress",
        kind: "codex_running",
        message: "Wait for Codex to finish the current step.",
        sections: [],
        showProgress: true,
        title: "Waiting for Codex..."
      }
    };
  }

  return {
    intents: [codexRecoveryControlIntent()],
    screen: {
      icon: "warning",
      kind: "codex_attention",
      message: "Codex has not reported progress for the current step.",
      sections: [],
      showProgress: false,
      title: "Codex needs attention"
    }
  };
}

function withCodexWaitPresentation(session = {}, terminalState = {}) {
  const overlay = codexWaitPresentationOverlay(session, terminalState);
  const presentation = objectValue(session.presentation);
  if (!overlay) {
    return presentation;
  }
  const nextPresentation = {
    ...presentation,
    refreshAt: overlay.refreshAt || presentation.refreshAt || "",
    refreshReason: overlay.refreshAt ? "codex_wait" : presentation.refreshReason || ""
  };
  if (Array.isArray(overlay.intents)) {
    nextPresentation.intents = overlay.intents;
  }
  if (overlay.screen) {
    nextPresentation.screen = {
      ...objectValue(presentation.screen),
      ...overlay.screen
    };
  }
  return nextPresentation;
}

function withCodexTerminalState(session = {}, terminalState = {}) {
  if (!session || session.ok === false || !session.sessionId) {
    return session;
  }
  const presentation = withCodexWaitPresentation(session, terminalState);
  return {
    ...session,
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

async function enrichSessionWithCodexTerminal(terminalService, session = {}) {
  if (!session || session.ok === false || !session.sessionId) {
    return session;
  }
  if (typeof terminalService?.codexTerminalState !== "function") {
    vibe64SessionDebugLog("server.service.codexTerminalState.skipped", {
      reason: "service_unavailable",
      sessionId: session.sessionId
    });
    return withCodexTerminalState(session, {});
  }
  const startedAtMs = Date.now();
  vibe64SessionDebugLog("server.service.codexTerminalState.start", {
    sessionId: session.sessionId
  });
  const terminalState = await terminalService.codexTerminalState(session.sessionId);
  if (terminalState?.ok === false) {
    vibe64SessionDebugLog("server.service.codexTerminalState.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: String(terminalState.error || "Vibe64 Codex terminal state could not be read."),
      sessionId: session.sessionId
    });
    throw new Error(terminalState.error || "Vibe64 Codex terminal state could not be read.");
  }
  const enrichedSession = withCodexTerminalState(session, terminalState || {});
  vibe64SessionDebugLog("server.service.codexTerminalState.done", {
    ...vibe64SessionDebugSummary(enrichedSession),
    codexTerminalId: String(enrichedSession.codexTerminal?.id || ""),
    codexTerminalStatus: String(enrichedSession.codexTerminal?.status || ""),
    durationMs: vibe64SessionDebugDurationMs(startedAtMs)
  });
  return enrichedSession;
}

async function deliverCodexPromptIfNeeded(terminalService, session = {}) {
  const handoff = codexPromptHandoffFromSession(session);
  if (!handoff) {
    vibe64SessionDebugLog("server.service.deliverCodexPrompt.skipped", {
      reason: "no_handoff",
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
  const delivery = await terminalService.injectCodexPrompt(session.sessionId, handoff);
  if (delivery?.ok === false) {
    vibe64SessionDebugLog("server.service.deliverCodexPrompt.error", {
      durationMs: vibe64SessionDebugDurationMs(startedAtMs),
      error: String(delivery.error || "Vibe64 Codex prompt delivery failed."),
      promptId: String(handoff.promptId || ""),
      sessionId: session.sessionId
    });
    throw new Error(delivery.error || "Vibe64 Codex prompt delivery failed.");
  }
  vibe64SessionDebugLog("server.service.deliverCodexPrompt.done", {
    durationMs: vibe64SessionDebugDurationMs(startedAtMs),
    promptId: String(handoff.promptId || ""),
    sessionId: session.sessionId,
    terminalSessionId: String(delivery?.terminalSessionId || "")
  });
  return {
    ...session,
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

function createService({
  projectService,
  setupServices = {},
  terminalService
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.vibe64-project.service.");
  }

  return Object.freeze({
    async advanceSession(sessionId) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.advanceSession.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime();
          const session = await runtime.advance(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session);
          vibe64SessionDebugLog("server.service.advanceSession.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
          vibe64SessionDebugLog("server.service.advanceSession.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async abandonSession(sessionId) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.abandonSession.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime();
          await runtime.store.writeStatus(sessionId, VIBE64_SESSION_STATUS.ABANDONED);
          await terminalService?.closeSessionTerminals?.(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, await runtime.getSession(sessionId));
          vibe64SessionDebugLog("server.service.abandonSession.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
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
          await assertVibe64SetupReady(setupServices);
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
                  message: `Session ${syncBlocker.sessionId} has merged a pull request but has not synced the main checkout. Run Sync main checkout there before starting another session.`
                }
              ],
              creation: {
                ...creation,
                canCreate: false,
                disabledReason: `Session ${syncBlocker.sessionId} has merged a pull request but has not synced the main checkout. Run Sync main checkout there before starting another session.`
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
          const session = await runtime.createSession({
            metadata: {
              adapter_id: projectType.adapter?.id || projectType.projectType,
              project_type: projectType.projectType
            },
            workflowDefinition: definitionSelection.definitionId
          });
          vibe64SessionDebugLog("server.service.createSession.runtimeCreate.done", {
            ...sessionServiceDebugResponse(session),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            workflowDefinition: definitionSelection.definitionId
          });
          vibe64SessionDebugLog("server.service.createSession.initialAdvance.start", {
            currentStep: session.currentStep,
            sessionId: session.sessionId,
            workflowDefinition: definitionSelection.definitionId
          });
          const advancedSession = await runtime.advance(session.sessionId);
          vibe64SessionDebugLog("server.service.createSession.initialAdvance.done", {
            ...sessionServiceDebugResponse(advancedSession),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            fromStepId: session.currentStep,
            workflowDefinition: definitionSelection.definitionId
          });
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, advancedSession);
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

    async inspectSession(sessionId) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.inspectSession.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime();
          const session = await enrichSessionWithCodexTerminal(terminalService, await runtime.getSession(sessionId));
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
      });
    },

    async readSessionConversationLog(sessionId) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.readSessionConversationLog.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime();
          const session = await runtime.getSession(sessionId);
          const conversationLog = typeof runtime.store?.readConversationLog === "function"
            ? await runtime.store.readConversationLog(sessionId)
            : [];
          const response = {
            conversationLog,
            ok: true,
            revision: session.revision,
            sessionId: session.sessionId
          };
          vibe64SessionDebugLog("server.service.readSessionConversationLog.done", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            sessionId,
            turnCount: conversationLog.length
          });
          return response;
        } catch (error) {
          vibe64SessionDebugLog("server.service.readSessionConversationLog.error", {
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            error: vibe64SessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async inspectSessionDiff(sessionId) {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        return inspectSessionDiff(await runtime.getSession(sessionId));
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
      });
    },

    async recoverStuckSessionStep(sessionId) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.recoverStuckSessionStep.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          await assertVibe64SetupReady(setupServices);
          const runtime = await projectService.createRuntime();
          await terminalService?.closeSessionNonCodexTerminals?.(sessionId);
          const session = await runtime.recoverStuckStep(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session);
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
          const openSessions = options.runtimeOptions.statusGroup === "open" &&
            !Array.isArray(options.runtimeOptions.statuses)
            ? sessions
            : await listOpenSessionSummaries(runtime);
          const response = sessionListResponse(sessions, await sessionCreationState(runtime, openSessions));
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
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.runSessionAction.start", {
        actionId,
        sessionId
      });
      return sessionResult(async () => {
        try {
          await assertVibe64SetupReady(setupServices);
          const runtime = await projectService.createRuntime();
          let session = await runtime.runAction(sessionId, actionId, input);
          const conversationTurn = await recordConversationUserMessage(runtime, sessionId, {
            actionResult: session.actionResult,
            input
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
            return session;
          }
          const enrichedSession = await enrichSessionWithCodexTerminal(
            terminalService,
            await deliverCodexPromptIfNeeded(terminalService, session)
          );
          vibe64SessionDebugLog("server.service.runSessionAction.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            actionId,
            actionResultStatus: String(enrichedSession.actionResult?.status || ""),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
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
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.runSessionIntent.start", {
        intentId,
        sessionId,
        stepId: String(input?.stepId || ""),
        stepStatus: String(input?.stepStatus || "")
      });
      return sessionResult(async () => {
        try {
          await assertVibe64SetupReady(setupServices);
          const runtime = await projectService.createRuntime();
          let session = await runtime.runIntent(sessionId, intentId, input);
          const conversationTurn = await recordConversationUserMessage(runtime, sessionId, {
            actionResult: session.actionResult,
            input
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
            return session;
          }
          const enrichedSession = await enrichSessionWithCodexTerminal(
            terminalService,
            await deliverCodexPromptIfNeeded(terminalService, session)
          );
          vibe64SessionDebugLog("server.service.runSessionIntent.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            actionResultStatus: String(enrichedSession.actionResult?.status || ""),
            durationMs: vibe64SessionDebugDurationMs(startedAtMs),
            intentId
          });
          return enrichedSession;
        } catch (error) {
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

    async rewindSession(sessionId, stepId) {
      const startedAtMs = Date.now();
      vibe64SessionDebugLog("server.service.rewindSession.start", {
        sessionId,
        stepId
      });
      return sessionResult(async () => {
        try {
          await assertVibe64SetupReady(setupServices);
          const runtime = await projectService.createRuntime();
          const session = await runtime.rewind(sessionId, stepId);
          await terminalService?.closeSessionNonCodexTerminals?.(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session);
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

export { createService };
