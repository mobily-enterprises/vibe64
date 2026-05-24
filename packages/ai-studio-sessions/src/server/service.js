import {
  AI_STUDIO_SESSION_STATUS,
  workflowProfileCreationOptions
} from "../../../../server/lib/aiStudio/index.js";
import {
  aiStudioResult
} from "../../../../server/lib/aiStudio/serverResponses.js";
import {
  assertAiStudioSetupReady
} from "../../../../server/lib/aiStudio/setupReadiness.js";
import { inspectSessionDiff } from "./sessionDiff.js";

const MAX_OPEN_AI_STUDIO_SESSIONS = 5;
const CLOSED_SESSION_STATUSES = new Set(["abandoned", "finished"]);

function sessionResult(operation) {
  return aiStudioResult(operation, {
    fallbackCode: "ai_studio_session_request_failed",
    fallbackMessage: "AI Studio session request failed."
  });
}

function isOpenAiStudioSession(session = {}) {
  return !CLOSED_SESSION_STATUSES.has(String(session.status || ""));
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

function codexTerminalPresentation(session = {}, codexTerminal = null) {
  const terminal = objectValue(codexTerminal);
  const terminalSessionId = String(terminal.id || "").trim();
  const screenKind = String(session.presentation?.screen?.kind || "").trim();
  const visible = Boolean(
    terminalSessionId &&
    terminal.status !== "exited" &&
    screenKind === "codex_running"
  );
  return {
    label: visible ? "Terminal is transmitting..." : "",
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
        codex: codexTerminalPresentation(session, terminalState.codexTerminal || null)
      }
    }
  };
}

async function enrichSessionWithCodexTerminal(terminalService, session = {}) {
  if (!session || session.ok === false || !session.sessionId) {
    return session;
  }
  if (typeof terminalService?.codexTerminalState !== "function") {
    return withCodexTerminalState(session, {});
  }
  const terminalState = await terminalService.codexTerminalState(session.sessionId);
  if (terminalState?.ok === false) {
    throw new Error(terminalState.error || "AI Studio Codex terminal state could not be read.");
  }
  return withCodexTerminalState(session, terminalState || {});
}

async function enrichSessionsWithCodexTerminal(terminalService, sessions = []) {
  return Promise.all((Array.isArray(sessions) ? sessions : [])
    .map((session) => enrichSessionWithCodexTerminal(terminalService, session)));
}

async function deliverCodexPromptIfNeeded(terminalService, session = {}) {
  const handoff = codexPromptHandoffFromSession(session);
  if (!handoff) {
    return session;
  }
  if (typeof terminalService?.injectCodexPrompt !== "function") {
    throw new Error("AI Studio Codex prompt delivery service is not available.");
  }
  const delivery = await terminalService.injectCodexPrompt(session.sessionId, handoff);
  if (delivery?.ok === false) {
    throw new Error(delivery.error || "AI Studio Codex prompt delivery failed.");
  }
  return {
    ...session,
    codexPromptDelivery: delivery
  };
}

async function publishPromptStateChangedIfNeeded(publishSessionChanged, session = {}, {
  reason = ""
} = {}) {
  if (!codexPromptHandoffFromSession(session) || typeof publishSessionChanged !== "function") {
    return;
  }
  await publishSessionChanged(session.sessionId, {
    reason
  });
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
  if (typeof runtime?.workflowProfileCreationOptions === "function") {
    return runtime.workflowProfileCreationOptions();
  }
  return workflowProfileCreationOptions();
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

function selectableWorkflowProfileIds(creation = {}) {
  if (creation.seedRequired) {
    return [creation.defaultWorkflowProfile].filter(Boolean);
  }
  return (Array.isArray(creation.workflowProfiles) ? creation.workflowProfiles : [])
    .map((profile) => String(profile.id || "").trim())
    .filter(Boolean);
}

function selectedWorkflowProfile(input = {}, creation = {}) {
  const requestedProfile = String(input.workflowProfile || "").trim();
  const profile = requestedProfile || String(creation.defaultWorkflowProfile || "").trim();
  const allowedProfileIds = new Set(selectableWorkflowProfileIds(creation));
  if (!profile || !allowedProfileIds.has(profile)) {
    return {
      error: creation.seedRequired
        ? "The first AI Studio session must seed the application, so no other workflow profile can be selected yet."
        : "Choose one of the available workflow profiles before creating a session.",
      profile: ""
    };
  }
  return {
    error: "",
    profile
  };
}

function createService({
  projectService,
  publishSessionChanged = {},
  setupServices = {},
  terminalService
} = {}) {
  if (!projectService) {
    throw new TypeError("createService requires feature.ai-studio-project.service.");
  }

  return Object.freeze({
    async advanceSession(sessionId) {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        return enrichSessionWithCodexTerminal(terminalService, await runtime.advance(sessionId));
      });
    },

    async abandonSession(sessionId) {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        await runtime.store.writeStatus(sessionId, AI_STUDIO_SESSION_STATUS.ABANDONED);
        await terminalService?.closeSessionTerminals?.(sessionId);
        return enrichSessionWithCodexTerminal(terminalService, await runtime.getSession(sessionId));
      });
    },

    async createSession(input = {}) {
      return sessionResult(async () => {
        const projectType = await projectService.requireProjectType();
        await assertAiStudioSetupReady(setupServices);
        const runtime = await projectService.createRuntime();
        const existingSessions = await runtime.listSessions();
        const { creation, limits } = await sessionCreationState(runtime, existingSessions);
        if (limits.openSessionCount >= limits.maxOpenSessions) {
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
            sessions: existingSessions,
            status: "blocked"
          };
        }
        const syncBlocker = mainCheckoutSyncBlocker(existingSessions);
        if (syncBlocker) {
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
            sessions: existingSessions,
            status: "blocked"
          };
        }
        const profileSelection = selectedWorkflowProfile(input, creation);
        if (profileSelection.error) {
          return {
            creation,
            errors: [
              {
                code: "workflow_profile_not_available",
                message: profileSelection.error
              }
            ],
            limits,
            ok: false,
            sessions: existingSessions,
            status: "blocked"
          };
        }
        const session = await runtime.createSession({
          metadata: {
            adapter_id: projectType.adapter?.id || projectType.projectType,
            project_type: projectType.projectType
          },
          workflowProfile: profileSelection.profile
        });
        return enrichSessionWithCodexTerminal(terminalService, await runtime.advance(session.sessionId));
      });
    },

    async inspectSession(sessionId) {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        return enrichSessionWithCodexTerminal(terminalService, await runtime.getSession(sessionId));
      });
    },

    async inspectSessionDiff(sessionId) {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        return inspectSessionDiff(await runtime.getSession(sessionId));
      });
    },

    async listSessions() {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        const sessions = await runtime.listSessions();
        const enrichedSessions = await enrichSessionsWithCodexTerminal(terminalService, sessions);
        return sessionListResponse(enrichedSessions, await sessionCreationState(runtime, sessions));
      });
    },

    async runSessionAction(sessionId, actionId, input = {}) {
      return sessionResult(async () => {
        await assertAiStudioSetupReady(setupServices);
        const runtime = await projectService.createRuntime();
        const session = await runtime.runAction(sessionId, actionId, input);
        if (!isOpenAiStudioSession(session)) {
          await terminalService?.closeSessionTerminals?.(sessionId);
          return session;
        }
        await publishPromptStateChangedIfNeeded(publishSessionChanged.action, session, {
          reason: "codex-prompt-state-updated"
        });
        return enrichSessionWithCodexTerminal(terminalService, await deliverCodexPromptIfNeeded(terminalService, session));
      });
    },

    async runSessionIntent(sessionId, intentId, input = {}) {
      return sessionResult(async () => {
        await assertAiStudioSetupReady(setupServices);
        const runtime = await projectService.createRuntime();
        const session = await runtime.runIntent(sessionId, intentId, input);
        if (!isOpenAiStudioSession(session)) {
          await terminalService?.closeSessionTerminals?.(sessionId);
          return session;
        }
        await publishPromptStateChangedIfNeeded(publishSessionChanged.intent, session, {
          reason: "codex-prompt-state-updated"
        });
        return enrichSessionWithCodexTerminal(terminalService, await deliverCodexPromptIfNeeded(terminalService, session));
      });
    },

    async rewindSession(sessionId, stepId) {
      return sessionResult(async () => {
        await assertAiStudioSetupReady(setupServices);
        const runtime = await projectService.createRuntime();
        const session = await runtime.rewind(sessionId, stepId);
        await terminalService?.closeSessionNonCodexTerminals?.(sessionId);
        return enrichSessionWithCodexTerminal(terminalService, session);
      });
    }
  });
}

export { createService };
