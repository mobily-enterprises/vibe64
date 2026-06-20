import { normalizeSurfaceId, resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";

import { requestBodyObject } from "@local/vibe64-core/server/serverResponses";
import { sendDoctorEventStream } from "./doctorStream.js";
import { requireLocalStudioRequest } from "@local/vibe64-core/server/localStudioRequest";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  runWithResolvedProjectRequestContext,
  projectRequestErrorStatusCode
} from "@local/vibe64-core/server/projectRequestContext";

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
    includeVibe64User = false,
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
    projectScoped = true,
    writeTerminalSummary
  } = {}
) {
  requireApplication(app);

  const router = app.make("jskit.http.router");
  const normalizedRouteSurface = normalizeSurfaceId(routeSurface);
  const routeBase = resolveScopedApiBasePath({
    routeBase: projectScoped ? VIBE64_PROJECT_ROUTE_BASE : "/",
    relativePath: routeRelativePath,
    strictParams: false
  });
  const service = () => app.make(serviceToken);
  const withDoctorRequest = projectScoped ? withProjectDoctorRequest : withGlobalDoctorRequest;
  const inputForRequest = (request, input = {}) => includeVibe64User
    ? withVibe64User(request, input)
    : input;

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
      await withDoctorRequest(request, reply, async () => {
        const response = await request.executeAction({
          actionId,
          input: inputForRequest(request, requestQuery(request))
        });
        reply.code(200).send(response);
      });
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
      await withDoctorRequest(request, reply, async () => {
        await sendDoctorEventStream(reply, ({ emit }) => {
          return service().streamStatus(inputForRequest(request, {
            ...requestQuery(request),
            emit
          }));
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
      await withDoctorRequest(request, reply, async () => {
        const response = await service().startTerminal(inputForRequest(request, requestBodyObject(request)));
        sendServiceResponse(reply, response);
      });
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
      await withDoctorRequest(request, reply, async () => {
        const response = await service().readTerminal(
          request.params.sessionId,
          inputForRequest(request)
        );
        sendServiceResponse(reply, response, {
          failureStatus: 404
        });
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
      await withDoctorRequest(request, reply, async () => {
        const response = await service().writeTerminal(
          request.params.sessionId,
          requestBodyObject(request).data || "",
          inputForRequest(request)
        );
        sendServiceResponse(reply, response, {
          failureStatus: 404
        });
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
      await withDoctorRequest(request, reply, async () => {
        const response = await service().closeTerminal(
          request.params.sessionId,
          inputForRequest(request)
        );
        reply.code(200).send(response);
      });
    }
  );
}

function withVibe64User(request, input = {}) {
  const vibe64User = request.vibe64User || null;
  if (!vibe64User) {
    return {
      ...input
    };
  }
  return {
    ...input,
    vibe64User
  };
}

async function withGlobalDoctorRequest(_request, _reply, operation) {
  return operation();
}

async function withProjectDoctorRequest(request, reply, operation) {
  try {
    return await runWithResolvedProjectRequestContext({
      request
    }, operation);
  } catch (error) {
    if (isProjectRequestError(error)) {
      reply.code(projectRequestErrorStatusCode(error)).send({
        ok: false,
        errors: [
          {
            code: error?.code || "vibe64_project_request_failed",
            message: String(error?.message || error || "Vibe64 project request failed.")
          }
        ]
      });
      return undefined;
    }
    throw error;
  }
}

function isProjectRequestError(error = {}) {
  return [
    "vibe64_invalid_project_slug",
    "vibe64_project_route_unavailable",
    "vibe64_project_path_not_accessible",
    "vibe64_project_path_not_directory",
    "vibe64_project_path_symlink"
  ].includes(error?.code);
}

export {
  registerDoctorRoutes
};
