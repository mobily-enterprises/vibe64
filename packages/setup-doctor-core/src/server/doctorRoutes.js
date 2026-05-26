import { normalizeSurfaceId, resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";

import { requestBodyObject } from "@local/ai-studio-core/server/serverResponses";
import { sendDoctorEventStream } from "./doctorStream.js";
import { requireLocalStudioRequest } from "@local/ai-studio-core/server/localStudioRequest";

function requireApplication(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("registerDoctorRoutes requires application make().");
  }
}

function requireLocalDoctorRequest(request, reply, message) {
  return requireLocalStudioRequest(request, reply, {
    message
  });
}

function sendServiceResponse(reply, response, {
  failureStatus = 400
} = {}) {
  reply.code(response?.ok === false ? failureStatus : 200).send(response);
}

function requestQuery(request) {
  return request?.input?.query || request?.query || {};
}

function registerDoctorRoutes(
  app,
  {
    actionId,
    closeTerminalSummary,
    localRequestMessage,
    queryValidator,
    readTerminalSummary,
    routeRelativePath = "",
    routeSurface = "",
    serviceToken,
    startTerminalSummary,
    statusSummary,
    streamSummary,
    tags = [],
    terminalInputValidator,
    terminalStartInputValidator,
    writeTerminalSummary
  } = {}
) {
  requireApplication(app);

  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/",
    relativePath: routeRelativePath,
    strictParams: false
  });
  const service = () => app.make(serviceToken);

  router.register(
    "GET",
    routeBase,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags,
        summary: statusSummary
      },
      query: queryValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply, localRequestMessage)) {
        return;
      }
      const response = await request.executeAction({
        actionId,
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
        tags,
        summary: streamSummary
      },
      query: queryValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply, localRequestMessage)) {
        return;
      }
      await sendDoctorEventStream(reply, ({ emit }) => {
        return service().streamStatus({
          ...requestQuery(request),
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
        tags,
        summary: startTerminalSummary
      },
      body: terminalStartInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply, localRequestMessage)) {
        return;
      }
      const response = await service().startTerminal(requestBodyObject(request));
      sendServiceResponse(reply, response);
    }
  );

  router.register(
    "GET",
    `${routeBase}/terminal/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags,
        summary: readTerminalSummary
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply, localRequestMessage)) {
        return;
      }
      const response = await service().readTerminal(request.params.sessionId);
      sendServiceResponse(reply, response, {
        failureStatus: 404
      });
    }
  );

  router.register(
    "POST",
    `${routeBase}/terminal/:sessionId/input`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags,
        summary: writeTerminalSummary
      },
      body: terminalInputValidator
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply, localRequestMessage)) {
        return;
      }
      const response = await service().writeTerminal(
        request.params.sessionId,
        requestBodyObject(request).data || ""
      );
      sendServiceResponse(reply, response, {
        failureStatus: 404
      });
    }
  );

  router.register(
    "DELETE",
    `${routeBase}/terminal/:sessionId`,
    {
      auth: "public",
      surface: normalizedRouteSurface,
      meta: {
        tags,
        summary: closeTerminalSummary
      }
    },
    async function (request, reply) {
      if (!requireLocalDoctorRequest(request, reply, localRequestMessage)) {
        return;
      }
      const response = await service().closeTerminal(request.params.sessionId);
      reply.code(200).send(response);
    }
  );
}

export {
  registerDoctorRoutes
};
