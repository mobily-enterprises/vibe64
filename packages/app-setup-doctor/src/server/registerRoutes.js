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
import {
  requireLocalStudioRequest
} from "../../../../server/lib/localStudioRequest.js";
import {
  requestBodyObject
} from "../../../../server/lib/aiStudio/serverResponses.js";

function getAppSetupDoctorService(app) {
  return app.make("feature.app-setup-doctor.service");
}

function requireLocalDoctorRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "App Setup Doctor routes only accept loopback Studio requests."
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
        tags: ["studio", "app-setup-doctor"],
        summary: "Read App Setup Doctor status."
      },
      query: statusQueryInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
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
        tags: ["studio", "app-setup-doctor"],
        summary: "Stream App Setup Doctor status progress."
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
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
        tags: ["studio", "app-setup-doctor"],
        summary: "Start an App Setup Doctor terminal session."
      },
      body: terminalStartInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = getAppSetupDoctorService(app).startTerminal(requestBodyObject(request));
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
        tags: ["studio", "app-setup-doctor"],
        summary: "Read an App Setup Doctor terminal session."
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
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
        tags: ["studio", "app-setup-doctor"],
        summary: "Write to an App Setup Doctor terminal session."
      },
      body: terminalInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = getAppSetupDoctorService(app).writeTerminal(
        request.params.sessionId,
        requestBodyObject(request).data || ""
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
        tags: ["studio", "app-setup-doctor"],
        summary: "Close an App Setup Doctor terminal session."
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = await getAppSetupDoctorService(app).closeTerminal(request.params.sessionId);
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
