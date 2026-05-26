import {
  AI_STUDIO_SESSION_STATUS,
  workflowDefinitionCreationOptions
} from "../../../../server/lib/aiStudio/index.js";
import {
  aiStudioResult
} from "@local/ai-studio-core/server/serverResponses";
import {
  aiStudioSessionDebugDurationMs,
  aiStudioSessionDebugError,
  aiStudioSessionDebugLog,
  aiStudioSessionDebugSummary
} from "../../../../server/lib/aiStudio/sessionDebugLog.js";
import {
  assertAiStudioSetupReady
} from "../../../../server/lib/aiStudio/setupReadiness.js";
import { inspectSessionDiff } from "./sessionDiff.js";

const MAX_OPEN_AI_STUDIO_SESSIONS = 5;
const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);
const SESSION_ARCHIVE_QUERY = Object.freeze({
  ABANDONED: "abandoned",
  COMPLETED: "completed",
  FINISHED: "finished"
});

function sessionResult(operation) {
  return aiStudioResult(operation, {
    fallbackCode: "ai_studio_session_request_failed",
    fallbackMessage: "AI Studio session request failed."
  });
}

function isOpenAiStudioSession(session = {}) {
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
        statuses: [AI_STUDIO_SESSION_STATUS.ABANDONED]
      }
    };
  }
  if (archive === SESSION_ARCHIVE_QUERY.COMPLETED || archive === SESSION_ARCHIVE_QUERY.FINISHED) {
    return {
      runtimeOptions: {
        statusGroup: "closed",
        statuses: [AI_STUDIO_SESSION_STATUS.FINISHED]
      }
    };
  }
  throw new Error(`Unknown AI Studio session archive: ${archive}`);
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

function codexTerminalPresentation(codexTerminal = null) {
  const terminal = objectValue(codexTerminal);
  const terminalSessionId = String(terminal.id || "").trim();
  const visible = Boolean(
    terminalSessionId &&
    terminal.status !== "exited" &&
    terminal.transmitting === true
  );
  return {
    label: visible ? terminal.activityLabel || "Terminal is transmitting..." : "",
    readOnlyInAutopilot: true,
    renderer: "codex_terminal",
    terminalSessionId,
    visible
  };
}

function withCodexTerminalState(session = {}, terminalState = {}) {
  if (!session || session.ok === false || !session.sessionId) {
    return session;
  }
  const presentation = objectValue(session.presentation);
  return {
    ...session,
    codexTerminal: terminalState.codexTerminal || null,
    codexWorkdir: terminalState.codexWorkdir || session.codexWorkdir || "",
    codexPromptHandoffOutputStart: terminalState.codexPromptHandoffOutputStart ?? session.codexPromptHandoffOutputStart,
    codexPromptHandoffSignature: terminalState.codexPromptHandoffSignature || session.codexPromptHandoffSignature || "",
    codexThreadId: terminalState.codexThreadId || session.codexThreadId || "",
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
    aiStudioSessionDebugLog("server.service.codexTerminalState.skipped", {
      reason: "service_unavailable",
      sessionId: session.sessionId
    });
    return withCodexTerminalState(session, {});
  }
  const startedAtMs = Date.now();
  aiStudioSessionDebugLog("server.service.codexTerminalState.start", {
    sessionId: session.sessionId
  });
  const terminalState = await terminalService.codexTerminalState(session.sessionId);
  if (terminalState?.ok === false) {
    aiStudioSessionDebugLog("server.service.codexTerminalState.error", {
      durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
      error: String(terminalState.error || "AI Studio Codex terminal state could not be read."),
      sessionId: session.sessionId
    });
    throw new Error(terminalState.error || "AI Studio Codex terminal state could not be read.");
  }
  const enrichedSession = withCodexTerminalState(session, terminalState || {});
  aiStudioSessionDebugLog("server.service.codexTerminalState.done", {
    ...aiStudioSessionDebugSummary(enrichedSession),
    codexTerminalId: String(enrichedSession.codexTerminal?.id || ""),
    codexTerminalStatus: String(enrichedSession.codexTerminal?.status || ""),
    durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
  });
  return enrichedSession;
}

async function deliverCodexPromptIfNeeded(terminalService, session = {}) {
  const handoff = codexPromptHandoffFromSession(session);
  if (!handoff) {
    aiStudioSessionDebugLog("server.service.deliverCodexPrompt.skipped", {
      reason: "no_handoff",
      sessionId: String(session?.sessionId || "")
    });
    return session;
  }
  if (typeof terminalService?.injectCodexPrompt !== "function") {
    aiStudioSessionDebugLog("server.service.deliverCodexPrompt.error", {
      error: "AI Studio Codex prompt delivery service is not available.",
      sessionId: String(session?.sessionId || "")
    });
    throw new Error("AI Studio Codex prompt delivery service is not available.");
  }
  const startedAtMs = Date.now();
  aiStudioSessionDebugLog("server.service.deliverCodexPrompt.start", {
    promptId: String(handoff.promptId || ""),
    sessionId: session.sessionId
  });
  const delivery = await terminalService.injectCodexPrompt(session.sessionId, handoff);
  if (delivery?.ok === false) {
    aiStudioSessionDebugLog("server.service.deliverCodexPrompt.error", {
      durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
      error: String(delivery.error || "AI Studio Codex prompt delivery failed."),
      promptId: String(handoff.promptId || ""),
      sessionId: session.sessionId
    });
    throw new Error(delivery.error || "AI Studio Codex prompt delivery failed.");
  }
  aiStudioSessionDebugLog("server.service.deliverCodexPrompt.done", {
    durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
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
  maxOpenSessions = MAX_OPEN_AI_STUDIO_SESSIONS
} = {}) {
  return {
    maxOpenSessions,
    openSessionCount: sessions.filter(isOpenAiStudioSession).length
  };
}

function sessionNeedsMainCheckoutSync(session = {}) {
  const metadata = session.metadata || {};
  return isOpenAiStudioSession(session) &&
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
    maxOpenSessions: workflow.seedRequired ? 1 : MAX_OPEN_AI_STUDIO_SESSIONS
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
    return "The first AI Studio session must seed the application. Finish or abandon the current seed session before creating another session.";
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
        ? "The first AI Studio session must seed the application, so no other workflow definition can be selected yet."
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
    ...aiStudioSessionDebugSummary(response),
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
    throw new TypeError("createService requires feature.ai-studio-project.service.");
  }

  return Object.freeze({
    async advanceSession(sessionId) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.advanceSession.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime();
          const session = await runtime.advance(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session);
          aiStudioSessionDebugLog("server.service.advanceSession.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.advanceSession.error", {
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async abandonSession(sessionId) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.abandonSession.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime();
          await runtime.store.writeStatus(sessionId, AI_STUDIO_SESSION_STATUS.ABANDONED);
          await terminalService?.closeSessionTerminals?.(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, await runtime.getSession(sessionId));
          aiStudioSessionDebugLog("server.service.abandonSession.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.abandonSession.error", {
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async createSession(input = {}) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.createSession.start", {
        workflowDefinition: String(input?.workflowDefinition || "")
      });
      return sessionResult(async () => {
        try {
          const projectType = await projectService.requireProjectType();
          await assertAiStudioSetupReady(setupServices);
          const runtime = await projectService.createRuntime();
          const existingOpenSessions = await listOpenSessionSummaries(runtime);
          const { creation, limits } = await sessionCreationState(runtime, existingOpenSessions);
          aiStudioSessionDebugLog("server.service.createSession.creationState", {
            canCreate: creation.canCreate === true,
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            maxOpenSessions: limits.maxOpenSessions,
            openSessionCount: limits.openSessionCount,
            requestedWorkflowDefinition: String(input?.workflowDefinition || ""),
            seedRequired: creation.seedRequired === true
          });
          if (limits.openSessionCount >= limits.maxOpenSessions) {
            aiStudioSessionDebugLog("server.service.createSession.blocked", {
              code: "open_session_limit",
              durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
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
            aiStudioSessionDebugLog("server.service.createSession.blocked", {
              blockerSessionId: syncBlocker.sessionId,
              code: "main_checkout_sync_required",
              durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
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
            aiStudioSessionDebugLog("server.service.createSession.blocked", {
              code: "workflow_definition_not_available",
              durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
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
          aiStudioSessionDebugLog("server.service.createSession.runtimeCreate.start", {
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
          aiStudioSessionDebugLog("server.service.createSession.runtimeCreate.done", {
            ...sessionServiceDebugResponse(session),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            workflowDefinition: definitionSelection.definitionId
          });
          aiStudioSessionDebugLog("server.service.createSession.initialAdvance.start", {
            currentStep: session.currentStep,
            sessionId: session.sessionId,
            workflowDefinition: definitionSelection.definitionId
          });
          const advancedSession = await runtime.advance(session.sessionId);
          aiStudioSessionDebugLog("server.service.createSession.initialAdvance.done", {
            ...sessionServiceDebugResponse(advancedSession),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            fromStepId: session.currentStep,
            workflowDefinition: definitionSelection.definitionId
          });
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, advancedSession);
          aiStudioSessionDebugLog("server.service.createSession.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            workflowDefinition: definitionSelection.definitionId
          });
          return enrichedSession;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.createSession.error", {
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
            workflowDefinition: String(input?.workflowDefinition || "")
          });
          throw error;
        }
      });
    },

    async inspectSession(sessionId) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.inspectSession.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          const runtime = await projectService.createRuntime();
          const session = await enrichSessionWithCodexTerminal(terminalService, await runtime.getSession(sessionId));
          aiStudioSessionDebugLog("server.service.inspectSession.done", {
            ...sessionServiceDebugResponse(session),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
          });
          return session;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.inspectSession.error", {
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async readSessionConversationLog(sessionId) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.readSessionConversationLog.start", {
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
          aiStudioSessionDebugLog("server.service.readSessionConversationLog.done", {
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            sessionId,
            turnCount: conversationLog.length
          });
          return response;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.readSessionConversationLog.error", {
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
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

    async recoverStuckSessionStep(sessionId) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.recoverStuckSessionStep.start", {
        sessionId
      });
      return sessionResult(async () => {
        try {
          await assertAiStudioSetupReady(setupServices);
          const runtime = await projectService.createRuntime();
          await terminalService?.closeSessionNonCodexTerminals?.(sessionId);
          const session = await runtime.recoverStuckStep(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session);
          aiStudioSessionDebugLog("server.service.recoverStuckSessionStep.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.recoverStuckSessionStep.error", {
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async listSessions(input = {}) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.listSessions.start", {
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
          aiStudioSessionDebugLog("server.service.listSessions.done", {
            archive: String(input?.archive || ""),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            openSessionCount: response.limits?.openSessionCount ?? null,
            sessionCount: response.sessions.length
          });
          return response;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.listSessions.error", {
            archive: String(input?.archive || ""),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error)
          });
          throw error;
        }
      });
    },

    async runSessionAction(sessionId, actionId, input = {}) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.runSessionAction.start", {
        actionId,
        sessionId
      });
      return sessionResult(async () => {
        try {
          await assertAiStudioSetupReady(setupServices);
          const runtime = await projectService.createRuntime();
          let session = await runtime.runAction(sessionId, actionId, input);
          const conversationTurn = await recordConversationUserMessage(runtime, sessionId, {
            actionResult: session.actionResult,
            input
          });
          if (conversationTurn) {
            session = await sessionWithLatestRevision(runtime, session);
          }
          if (!isOpenAiStudioSession(session)) {
            await terminalService?.closeSessionTerminals?.(sessionId);
            aiStudioSessionDebugLog("server.service.runSessionAction.done", {
              ...sessionServiceDebugResponse(session),
              actionId,
              durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
            });
            return session;
          }
          const enrichedSession = await enrichSessionWithCodexTerminal(
            terminalService,
            await deliverCodexPromptIfNeeded(terminalService, session)
          );
          aiStudioSessionDebugLog("server.service.runSessionAction.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            actionId,
            actionResultStatus: String(enrichedSession.actionResult?.status || ""),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs)
          });
          return enrichedSession;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.runSessionAction.error", {
            actionId,
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
            sessionId
          });
          throw error;
        }
      });
    },

    async runSessionIntent(sessionId, intentId, input = {}) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.runSessionIntent.start", {
        intentId,
        sessionId,
        stepId: String(input?.stepId || ""),
        stepStatus: String(input?.stepStatus || "")
      });
      return sessionResult(async () => {
        try {
          await assertAiStudioSetupReady(setupServices);
          const runtime = await projectService.createRuntime();
          let session = await runtime.runIntent(sessionId, intentId, input);
          const conversationTurn = await recordConversationUserMessage(runtime, sessionId, {
            actionResult: session.actionResult,
            input
          });
          if (conversationTurn) {
            session = await sessionWithLatestRevision(runtime, session);
          }
          if (!isOpenAiStudioSession(session)) {
            await terminalService?.closeSessionTerminals?.(sessionId);
            aiStudioSessionDebugLog("server.service.runSessionIntent.done", {
              ...sessionServiceDebugResponse(session),
              durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
              intentId
            });
            return session;
          }
          const enrichedSession = await enrichSessionWithCodexTerminal(
            terminalService,
            await deliverCodexPromptIfNeeded(terminalService, session)
          );
          aiStudioSessionDebugLog("server.service.runSessionIntent.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            actionResultStatus: String(enrichedSession.actionResult?.status || ""),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            intentId
          });
          return enrichedSession;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.runSessionIntent.error", {
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
            intentId,
            sessionId
          });
          throw error;
        }
      });
    },

    async rewindSession(sessionId, stepId) {
      const startedAtMs = Date.now();
      aiStudioSessionDebugLog("server.service.rewindSession.start", {
        sessionId,
        stepId
      });
      return sessionResult(async () => {
        try {
          await assertAiStudioSetupReady(setupServices);
          const runtime = await projectService.createRuntime();
          const session = await runtime.rewind(sessionId, stepId);
          await terminalService?.closeSessionNonCodexTerminals?.(sessionId);
          const enrichedSession = await enrichSessionWithCodexTerminal(terminalService, session);
          aiStudioSessionDebugLog("server.service.rewindSession.done", {
            ...sessionServiceDebugResponse(enrichedSession),
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            requestedStepId: stepId
          });
          return enrichedSession;
        } catch (error) {
          aiStudioSessionDebugLog("server.service.rewindSession.error", {
            durationMs: aiStudioSessionDebugDurationMs(startedAtMs),
            error: aiStudioSessionDebugError(error),
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
