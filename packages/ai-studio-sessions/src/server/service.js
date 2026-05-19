import {
  AI_STUDIO_SESSION_STATUS
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

function sessionLimits(sessions = []) {
  return {
    maxOpenSessions: MAX_OPEN_AI_STUDIO_SESSIONS,
    openSessionCount: sessions.filter(isOpenAiStudioSession).length
  };
}

function sessionListResponse(sessions = []) {
  return {
    limits: sessionLimits(sessions),
    ok: true,
    sessions
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
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        return runtime.advance(sessionId);
      });
    },

    async abandonSession(sessionId) {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        await runtime.store.writeStatus(sessionId, AI_STUDIO_SESSION_STATUS.ABANDONED);
        await terminalService?.closeSessionTerminals?.(sessionId);
        return runtime.getSession(sessionId);
      });
    },

    async createSession() {
      return sessionResult(async () => {
        const projectType = await projectService.requireProjectType();
        await assertAiStudioSetupReady(setupServices);
        const runtime = await projectService.createRuntime();
        const existingSessions = await runtime.listSessions();
        const limits = sessionLimits(existingSessions);
        if (limits.openSessionCount >= limits.maxOpenSessions) {
          return {
            errors: [
              {
                code: "open_session_limit",
                message: `Studio allows up to ${limits.maxOpenSessions} active sessions at once. Finish or abandon one before creating another.`
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
          }
        });
        return runtime.advance(session.sessionId);
      });
    },

    async inspectSession(sessionId) {
      return sessionResult(async () => {
        const runtime = await projectService.createRuntime();
        return runtime.getSession(sessionId);
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
        return sessionListResponse(await runtime.listSessions());
      });
    },

    async runSessionAction(sessionId, actionId, input = {}) {
      return sessionResult(async () => {
        await assertAiStudioSetupReady(setupServices);
        const runtime = await projectService.createRuntime();
        return runtime.runAction(sessionId, actionId, input);
      });
    },

    async rewindSession(sessionId, stepId) {
      return sessionResult(async () => {
        await assertAiStudioSetupReady(setupServices);
        const runtime = await projectService.createRuntime();
        const session = await runtime.rewind(sessionId, stepId);
        await terminalService?.closeSessionNonCodexTerminals?.(sessionId);
        return session;
      });
    }
  });
}

export { createService };
