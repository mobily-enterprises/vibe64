import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import { artifactsInputValidator } from "./inputSchemas.js";
import {
  ACTION_READ_ARTIFACTS,
  ACTION_SAVE_ARTIFACTS
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
    message: "AI Studio artifact routes only accept loopback Studio requests."
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
    `${routeBase}/sessions/:sessionId/artifacts`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-artifacts"],
        summary: "Read editable AI Studio artifacts."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_READ_ARTIFACTS,
        input: {
          actionId: request.query?.actionId,
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "PUT",
    `${routeBase}/sessions/:sessionId/artifacts`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-artifacts"],
        summary: "Save editable AI Studio artifacts."
      },
      body: artifactsInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_SAVE_ARTIFACTS,
        input: {
          ...requestBodyObject(request),
          sessionId: request.params.sessionId
        }
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );
}

export { registerRoutes };
