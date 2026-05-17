import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import {
  currentAppQueryInputValidator,
  targetScriptTerminalInputValidator,
  starredTargetScriptsInputValidator
} from "./inputSchemas.js";
import {
  ACTION_LIST_TARGET_SCRIPTS,
  ACTION_READ_CURRENT_APP,
  ACTION_RESET_STARRED_TARGET_SCRIPTS,
  ACTION_SAVE_STARRED_TARGET_SCRIPTS
} from "./actions.js";
import {
  requireLocalStudioRequest
} from "../../../../server/lib/localStudioRequest.js";
import {
  aiStudioStatusCode,
  requestBodyObject
} from "../../../../server/lib/aiStudio/serverResponses.js";

function getCurrentAppService(app) {
  return app.make("feature.current-app.service");
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
        summary: "Inspect the current app."
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

      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/target-scripts`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "List target scripts for the current app."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_LIST_TARGET_SCRIPTS,
        input: {}
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "PUT",
    `${routeBase}/target-scripts/starred`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Persist starred target script shortcuts for the current app."
      },
      body: starredTargetScriptsInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_SAVE_STARRED_TARGET_SCRIPTS,
        input: requestBodyObject(request)
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/target-scripts/starred`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Reset starred target script shortcuts to the default set."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_RESET_STARRED_TARGET_SCRIPTS,
        input: {}
      });
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/target-script-terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Start a target script terminal for the current app."
      },
      body: targetScriptTerminalInputValidator
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).startTargetScriptTerminal(requestBodyObject(request));
      reply.code(aiStudioStatusCode(response)).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/target-script-terminal/:terminalSessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["studio", "current-app"],
        summary: "Close a target script terminal for the current app."
      }
    },
    async function (request, reply) {
      if (!requireLocalCurrentAppRequest(request, reply)) {
        return;
      }
      const response = await getCurrentAppService(app).closeTargetScriptTerminal(
        request.params.terminalSessionId
      );
      reply.code(200).send(response);
    }
  );

}

export { registerRoutes };
