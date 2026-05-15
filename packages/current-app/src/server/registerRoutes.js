import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import {
  codexAttachmentInputValidator,
  codexPromptHandoffInputValidator,
  codexThreadInputValidator,
  currentAppQueryInputValidator,
  npmScriptTerminalInputValidator,
  rewindIssueSessionInputValidator,
  starredNpmScriptsInputValidator
} from "./inputSchemas.js";
import { ACTION_READ_CURRENT_APP } from "./actions.js";
import {
  requireLocalStudioRequest
} from "../../../../server/lib/localStudioRequest.js";

function getCurrentAppService(app) {
  return app.make("feature.current-app.service");
}

function sessionStatusCode(response, { missingStatus = 404 } = {}) {
  const code = response?.errors?.[0]?.code || "";
  if (code === "invalid_session_id") {
    return 400;
  }
  if (code === "session_missing") {
    return missingStatus;
  }
  return 200;
}

function requireLocalCurrentAppRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "Current-app Studio routes only accept loopback Studio requests."
  });
}

function requestBodyObject(request) {
  const body = request.input?.body || request.body || {};
  return body && typeof body === "object" && !Array.isArray(body) ? body : {};
}

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerRoutes requires application make().");
  }

  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/",
    relativePath: routeRelativePath,
    strictParams: false
  });

  router.register(
    "GET",
    routeBase,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Inspect the current JSKIT app."
      },
      query: currentAppQueryInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_READ_CURRENT_APP,
        input: request.input.query || {}
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/npm-scripts`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "List npm scripts for the current target app."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).listNpmScripts();
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "PUT",
    `${routeBase}/npm-scripts/starred`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Persist starred npm script shortcuts for the current target app."
      },
      body: starredNpmScriptsInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).saveStarredNpmScripts(requestBodyObject(request));
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/npm-scripts/starred`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Reset starred npm script shortcuts to the default set."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).resetStarredNpmScripts();
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/npm-script-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Start an npm script terminal for the current target app."
      },
      body: npmScriptTerminalInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).startNpmScriptTerminal(requestBodyObject(request));
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/npm-script-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Close an npm script terminal for the current target app."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).closeNpmScriptTerminal(
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/issue-sessions`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "List JSKIT issue sessions."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      reply.code(200).send(await getCurrentAppService(app).listIssueSessions(request.query || {}));
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Create a JSKIT issue session."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).createIssueSession();
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/issue-sessions/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Inspect a JSKIT issue session."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).inspectIssueSession(request.params.sessionId);
      reply.code(sessionStatusCode(response)).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/issue-sessions/:sessionId/diff`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Inspect a JSKIT issue session worktree diff."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).inspectIssueSessionDiff(request.params.sessionId);
      reply.code(sessionStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions/:sessionId/step`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Run the next JSKIT issue-session step."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).runIssueSessionStep(
        request.params.sessionId,
        requestBodyObject(request)
      );
      reply.code(sessionStatusCode(response, { missingStatus: 404 })).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions/:sessionId/abandon`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Abandon a JSKIT issue session."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).abandonIssueSession(request.params.sessionId);
      reply.code(sessionStatusCode(response, { missingStatus: 404 })).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions/:sessionId/rewind`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Rewind a JSKIT issue session to a completed step."
      },
      body: rewindIssueSessionInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).rewindIssueSession(
        request.params.sessionId,
        requestBodyObject(request)
      );
      reply.code(sessionStatusCode(response, { missingStatus: 404 })).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions/:sessionId/codex-attachments`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Upload a temporary attachment for a Codex terminal."
      },
      body: codexAttachmentInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).uploadCodexAttachment(
        request.params.sessionId,
        request.input.body || {}
      );
      const status = response?.ok === false
        ? response.errors ? sessionStatusCode(response, { missingStatus: 404 }) : 400
        : 200;
      reply.code(status).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/app-test-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Start an app-test terminal for the current target app."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).startAppTestTerminal();
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/app-test-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Close an app-test terminal for the current target app."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).closeAppTestTerminal(
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions/:sessionId/codex-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Start a Codex terminal for a JSKIT issue session."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).startCodexTerminal(request.params.sessionId);
      reply.code(sessionStatusCode(response, { missingStatus: 404 })).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions/:sessionId/step-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Start a setup terminal for a JSKIT issue-session step."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).startSessionStepTerminal(request.params.sessionId);
      reply.code(sessionStatusCode(response, { missingStatus: 404 })).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions/:sessionId/app-test-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Start an app-test terminal for a JSKIT issue session worktree."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).startIssueSessionAppTestTerminal(request.params.sessionId);
      reply.code(sessionStatusCode(response, { missingStatus: 404 })).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions/:sessionId/codex-thread`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Persist the Codex thread id for a JSKIT issue session."
      },
      body: codexThreadInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).saveCodexThread(
        request.params.sessionId,
        request.input.body || {}
      );
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/issue-sessions/:sessionId/codex-prompt-handoff`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Persist the active Codex prompt handoff for a JSKIT issue session."
      },
      body: codexPromptHandoffInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).saveCodexPromptHandoff(
        request.params.sessionId,
        request.input.body || {}
      );
      reply.code(response?.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/issue-sessions/:sessionId/app-test-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Close an app-test terminal for a JSKIT issue session worktree."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).closeIssueSessionAppTestTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/issue-sessions/:sessionId/codex-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Read a Codex terminal snapshot for a JSKIT issue session."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).readCodexTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(response?.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/issue-sessions/:sessionId/codex-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Close a Codex terminal for a JSKIT issue session."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).closeCodexTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/issue-sessions/:sessionId/step-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Close a setup terminal for a JSKIT issue session."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).closeSessionStepTerminal(
        request.params.sessionId,
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
