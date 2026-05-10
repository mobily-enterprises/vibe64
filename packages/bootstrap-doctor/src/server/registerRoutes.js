import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import {
  ACTION_READ_BOOTSTRAP,
  ACTION_REPAIR_BOOTSTRAP
} from "./actions.js";
import {
  bootstrapQueryInputValidator,
  repairInputValidator,
  terminalInputValidator,
  terminalStartInputValidator
} from "./inputSchemas.js";

function getBootstrapService(app) {
  return app.make("feature.bootstrap-doctor.service");
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
        tags: ["bootstrap"],
        summary: "Read Bootstrap Doctor status."
      },
      query: bootstrapQueryInputValidator
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: ACTION_READ_BOOTSTRAP,
        input: request.input.query || {}
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/repair`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["bootstrap"],
        summary: "Run a Bootstrap Doctor repair action."
      },
      body: repairInputValidator
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: ACTION_REPAIR_BOOTSTRAP,
        input: request.input.body || {}
      });

      reply.code(response.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["bootstrap"],
        summary: "Start a Bootstrap Doctor terminal session."
      },
      body: terminalStartInputValidator
    },
    async function (request, reply) {
      const response = getBootstrapService(app).startTerminal(request.input.body || {});
      reply.code(response.ok === false ? 400 : 200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/terminal/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["bootstrap"],
        summary: "Read a Bootstrap Doctor terminal session."
      }
    },
    async function (request, reply) {
      const response = getBootstrapService(app).readTerminal(request.params.sessionId);
      reply.code(response.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "POST",
    `${routeBase}/terminal/:sessionId/input`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["bootstrap"],
        summary: "Write to a Bootstrap Doctor terminal session."
      },
      body: terminalInputValidator
    },
    async function (request, reply) {
      const response = getBootstrapService(app).writeTerminal(
        request.params.sessionId,
        request.input.body?.data || ""
      );
      reply.code(response.ok === false ? 404 : 200).send(response);
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/terminal/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["bootstrap"],
        summary: "Close a Bootstrap Doctor terminal session."
      }
    },
    async function (request, reply) {
      const response = getBootstrapService(app).closeTerminal(request.params.sessionId);
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
