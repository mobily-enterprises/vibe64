import {
  ACTION_ABANDON_SESSION,
  ACTION_ADVANCE_SESSION,
  ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_INSPECT_SESSION,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RECOVER_STUCK_SESSION_STEP,
  ACTION_REWIND_SESSION,
  ACTION_RUN_SESSION_ACTION,
  ACTION_RUN_SESSION_INTENT
} from "./actions.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 session routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-sessions"]
  });

  routes.actionRoute("GET", "/sessions", {
    actionId: ACTION_LIST_SESSIONS,
    buildInput: sessionsQueryInput,
    summary: "List Vibe64 sessions."
  });

  routes.actionRoute("POST", "/sessions", {
    actionId: ACTION_CREATE_SESSION,
    buildInput: routes.requestBody,
    summary: "Create an Vibe64 session."
  });

  routes.actionRoute("GET", "/sessions/:sessionId", {
    actionId: ACTION_INSPECT_SESSION,
    buildInput: sessionInput,
    summary: "Inspect an Vibe64 session."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/diff", {
    actionId: ACTION_INSPECT_SESSION_DIFF,
    buildInput: sessionInput,
    summary: "Inspect an Vibe64 session worktree diff."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/conversation-log", {
    actionId: ACTION_READ_SESSION_CONVERSATION_LOG,
    buildInput: sessionInput,
    summary: "Read an Vibe64 session conversation log."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/terminal-failure-fix-request", {
    actionId: ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST,
    buildInput(request) {
      return {
        ...routes.requestBody(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Build an Vibe64 terminal failure repair prompt."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/actions/:actionId", {
    actionId: ACTION_RUN_SESSION_ACTION,
    buildInput(request) {
      return {
        actionId: request.params.actionId,
        input: routes.requestBody(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Run an Vibe64 session action."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/intents/:intentId", {
    actionId: ACTION_RUN_SESSION_INTENT,
    buildInput(request) {
      const body = routes.requestBody(request);
      return {
        fields: body.fields || body.input || {},
        intentId: request.params.intentId,
        sessionId: request.params.sessionId,
        stepId: body.stepId,
        stepStatus: body.stepStatus
      };
    },
    summary: "Run an Vibe64 session intent."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/advance", {
    actionId: ACTION_ADVANCE_SESSION,
    buildInput: sessionInput,
    summary: "Advance an Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/rewind", {
    actionId: ACTION_REWIND_SESSION,
    buildInput(request) {
      return {
        sessionId: request.params.sessionId,
        stepId: routes.requestBody(request).stepId
      };
    },
    summary: "Rewind an Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/recover-stuck-step", {
    actionId: ACTION_RECOVER_STUCK_SESSION_STEP,
    buildInput: sessionInput,
    summary: "Recover an Vibe64 session step stuck in command execution."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/abandon", {
    actionId: ACTION_ABANDON_SESSION,
    buildInput: sessionInput,
    summary: "Abandon an Vibe64 session."
  });
}

function sessionInput(request) {
  return {
    sessionId: request.params.sessionId
  };
}

function sessionsQueryInput(request) {
  return {
    archive: request.query?.archive || request.input?.query?.archive || ""
  };
}

export { registerRoutes };
