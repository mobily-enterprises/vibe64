import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import { projectTypeInputValidator } from "./inputSchemas.js";
import {
  ACTION_READ_PROJECT_TYPE,
  ACTION_SAVE_PROJECT_TYPE
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
    message: "AI Studio project routes only accept loopback Studio requests."
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
    `${routeBase}/project-type`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-project"],
        summary: "Read the AI Studio project type."
      }
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_READ_PROJECT_TYPE,
        input: {}
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "PUT",
    `${routeBase}/project-type`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "ai-studio-project"],
        summary: "Set the AI Studio project type."
      },
      body: projectTypeInputValidator
    },
    async function (request, reply) {
      if (!requireLocalAiStudioRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_SAVE_PROJECT_TYPE,
        input: requestBodyObject(request)
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );
}

export { registerRoutes };
