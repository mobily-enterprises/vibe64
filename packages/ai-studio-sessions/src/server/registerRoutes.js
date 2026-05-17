import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import {
  ACTION_ABANDON_SESSION,
  ACTION_ADVANCE_SESSION,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_LIST_SESSIONS,
  ACTION_RUN_SESSION_ACTION
} from "./actions.js";
import {
  requireLocalStudioRequest
} from "../../../../server/lib/localStudioRequest.js";
import {
  aiStudioStatusCode,
  requestBodyObject
} from "../../../../server/lib/aiStudio/serverResponses.js";

function requireLocalAiStudioRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "AI Studio session routes only accept loopback Studio requests."
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
    `${routeBase}/sessions`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-sessions"],
        summary: "List AI Studio sessions."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_LIST_SESSIONS,
        input: {}
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-sessions"],
        summary: "Create an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_CREATE_SESSION,
        input: {}
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/sessions/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-sessions"],
        summary: "Inspect an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_INSPECT_SESSION,
        input: {
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/actions/:actionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-sessions"],
        summary: "Run an AI Studio session action."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_RUN_SESSION_ACTION,
        input: {
          actionId: request.params.actionId,
          input: requestBodyObject(request),
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/advance`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-sessions"],
        summary: "Advance an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_ADVANCE_SESSION,
        input: {
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/sessions/:sessionId/abandon`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-sessions"],
        summary: "Abandon an AI Studio session."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_ABANDON_SESSION,
        input: {
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );
}

export { registerRoutes };
