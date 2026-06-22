import {
  ACTION_ABANDON_SESSION,
  ACTION_ADVANCE_SESSION,
  ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION_DIFF,
  ACTION_INSPECT_SESSION,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RECOVER_SESSION_WORKTREE,
  ACTION_RECOVER_STUCK_SESSION_STEP,
  ACTION_RETURN_AGENT_CONTROL,
  ACTION_REWIND_SESSION,
  ACTION_RUN_SESSION_ACTION,
  ACTION_RUN_SESSION_INTENT
} from "./actions.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(
  app,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 session routes only accept loopback Studio requests.",
    projectContext,
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
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
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

  routes.serviceRoute("POST", "/sessions/:sessionId/composer-draft", {
    summary: "Broadcast an ephemeral Vibe64 session composer draft."
  }, (request) => {
    return app.make("feature.vibe64-sessions.service").broadcastComposerDraft(
      request.params.sessionId,
      routes.requestBody(request)
    );
  });

  routes.actionRoute("POST", "/sessions/:sessionId/terminal-failure-fix-request", {
    actionId: ACTION_BUILD_TERMINAL_FAILURE_FIX_REQUEST,
    buildInput(request) {
      return withVibe64User(request, {
        ...routes.requestBody(request),
        sessionId: request.params.sessionId
      });
    },
    summary: "Build an Vibe64 terminal failure repair prompt."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/actions/:actionId", {
    actionId: ACTION_RUN_SESSION_ACTION,
    buildInput(request) {
      return withVibe64User(request, {
        actionId: request.params.actionId,
        input: routes.requestBody(request),
        sessionId: request.params.sessionId
      });
    },
    summary: "Run an Vibe64 session action."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/intents/:intentId", {
    actionId: ACTION_RUN_SESSION_INTENT,
    buildInput(request) {
      const body = routes.requestBody(request);
      const input = {
        displayFields: body.displayFields || {},
        fields: body.fields || body.input || {},
        intentId: request.params.intentId,
        originId: body.originId || "",
        sessionId: request.params.sessionId,
        stepId: body.stepId,
        stepStatus: body.stepStatus
      };
      if (body.agentSettings && typeof body.agentSettings === "object" && !Array.isArray(body.agentSettings)) {
        input.agentSettings = body.agentSettings;
      }
      return withVibe64User(request, input);
    },
    summary: "Run an Vibe64 session intent."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/advance", {
    actionId: ACTION_ADVANCE_SESSION,
    buildInput(request) {
      const body = routes.requestBody(request);
      return withVibe64User(request, {
        originId: body.originId || "",
        sessionId: request.params.sessionId,
        stepId: body.stepId,
        stepStatus: body.stepStatus
      });
    },
    summary: "Advance an Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/rewind", {
    actionId: ACTION_REWIND_SESSION,
    buildInput(request) {
      const body = routes.requestBody(request);
      return withVibe64User(request, {
        originId: body.originId || "",
        sessionId: request.params.sessionId,
        stepId: body.stepId
      });
    },
    summary: "Rewind an Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/recover-stuck-step", {
    actionId: ACTION_RECOVER_STUCK_SESSION_STEP,
    buildInput: sessionInput,
    summary: "Recover an Vibe64 session step stuck in command execution."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/worktree/recover", {
    actionId: ACTION_RECOVER_SESSION_WORKTREE,
    buildInput: sessionInput,
    summary: "Recover an archived Vibe64 session worktree."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-control/return", {
    actionId: ACTION_RETURN_AGENT_CONTROL,
    buildInput: sessionInput,
    summary: "Return a quiet Vibe64 agent turn back to user control."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/abandon", {
    actionId: ACTION_ABANDON_SESSION,
    buildInput: sessionInput,
    summary: "Abandon an Vibe64 session."
  });
}

function sessionInput(request) {
  const body = request.body && typeof request.body === "object" && !Array.isArray(request.body)
    ? request.body
    : {};
  return withVibe64User(request, {
    originId: body.originId || "",
    sessionId: request.params.sessionId
  });
}

function sessionsQueryInput(request) {
  return {
    archive: request.query?.archive || request.input?.query?.archive || ""
  };
}

function withVibe64User(request, input = {}) {
  const vibe64User = request.vibe64User || null;
  const {
    vibe64User: _ignoredVibe64User,
    ...safeInput
  } = input || {};
  void _ignoredVibe64User;
  if (!vibe64User) {
    return safeInput;
  }
  return {
    ...safeInput,
    vibe64User
  };
}

export { registerRoutes };
