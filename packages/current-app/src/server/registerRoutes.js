import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import {
  currentAppQueryInputValidator,
  issueSessionStepInputValidator
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
      reply.code(200).send(await getCurrentAppService(app).listIssueSessions());
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
    "POST",
    `${routeBase}/issue-sessions/:sessionId/step`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "issue-sessions"],
        summary: "Run the next JSKIT issue-session step."
      },
      body: issueSessionStepInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).runIssueSessionStep(
        request.params.sessionId,
        request.input.body || {}
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
}

export { registerRoutes };
