import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import { sendDoctorEventStream } from "../../../../server/lib/doctorStream.js";
import {
  statusQueryInputValidator,
  terminalInputValidator,
  terminalStartInputValidator
} from "./inputSchemas.js";
import {
  ACTION_GET_STATUS
} from "./actions.js";

function getAppSetupDoctorService(app) {
  return app.make("feature.app-setup-doctor.service");
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
        tags: ["feature"],
        summary: "Read App Setup Doctor status."
      },
      query: statusQueryInputValidator
    },
    async function (request, reply) {
      const response = await request.executeAction({
        actionId: ACTION_GET_STATUS,
        input: request.input.query || {}
      });

      reply.code(200).send(response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/stream`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["feature"],
        summary: "Stream App Setup Doctor status progress."
      }
    },
    async function (_request, reply) {
      await sendDoctorEventStream(reply, ({ emit }) => {
        return getAppSetupDoctorService(app).streamStatus({
          emit
        });
      });
    }
  );

  router.register(
    "POST",
    `${routeBase}/terminal`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags: ["feature"],
        summary: "Start an App Setup Doctor terminal session."
      },
      body: terminalStartInputValidator
    },
    async function (request, reply) {
      const response = getAppSetupDoctorService(app).startTerminal(request.input.body || {});
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
        tags: ["feature"],
        summary: "Read an App Setup Doctor terminal session."
      }
    },
    async function (request, reply) {
      const response = getAppSetupDoctorService(app).readTerminal(request.params.sessionId);
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
        tags: ["feature"],
        summary: "Write to an App Setup Doctor terminal session."
      },
      body: terminalInputValidator
    },
    async function (request, reply) {
      const response = getAppSetupDoctorService(app).writeTerminal(
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
        tags: ["feature"],
        summary: "Close an App Setup Doctor terminal session."
      }
    },
    async function (request, reply) {
      const response = getAppSetupDoctorService(app).closeTerminal(request.params.sessionId);
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
