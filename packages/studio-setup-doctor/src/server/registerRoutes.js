import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";
import { sendDoctorEventStream } from "../../../../server/lib/doctorStream.js";

import {
  ACTION_READ_STUDIO_SETUP
} from "./actions.js";
import {
  studioSetupQueryInputValidator,
  terminalInputValidator,
  terminalStartInputValidator
} from "./inputSchemas.js";
import {
  requireLocalStudioRequest
} from "../../../../server/lib/localStudioRequest.js";
import {
  requestBodyObject
} from "../../../../server/lib/aiStudio/serverResponses.js";

function getStudioSetupService(app) {
  return app.make("feature.studio-setup-doctor.service");
}

function requireLocalDoctorRequest(request, reply) {
  return requireLocalStudioRequest(request, reply, {
    message: "Studio Setup Doctor routes only accept loopback Studio requests."
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
        tags: ["studio-setup"],
        summary: "Read Studio Setup Doctor status."
      },
      query: studioSetupQueryInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = await request.executeAction({
        actionId: ACTION_READ_STUDIO_SETUP,
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
        tags: ["studio-setup"],
        summary: "Stream Studio Setup Doctor status progress."
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      await sendDoctorEventStream(reply, ({ emit }) => {
        return getStudioSetupService(app).streamStatus({
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
        tags: ["studio-setup"],
        summary: "Start a Studio Setup Doctor terminal session."
      },
      body: terminalStartInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = await getStudioSetupService(app).startTerminal(requestBodyObject(request));
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
        tags: ["studio-setup"],
        summary: "Read a Studio Setup Doctor terminal session."
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = getStudioSetupService(app).readTerminal(request.params.sessionId);
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
        tags: ["studio-setup"],
        summary: "Write to a Studio Setup Doctor terminal session."
      },
      body: terminalInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = getStudioSetupService(app).writeTerminal(
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
        tags: ["studio-setup"],
        summary: "Close a Studio Setup Doctor terminal session."
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply)) {
        return;
      }
      const response = await getStudioSetupService(app).closeTerminal(request.params.sessionId);
      reply.code(200).send(response);
    }
  );
}

export { registerRoutes };
