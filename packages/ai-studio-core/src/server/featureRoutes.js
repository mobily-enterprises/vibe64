import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import { requireLocalStudioRequest } from "./localStudioRequest.js";
import {
  aiStudioStatusCode,
  requestBodyObject
} from "./serverResponses.js";

function createAiStudioFeatureRoutes(
  app,
  {
    localRequestMessage = "AI Studio routes only accept loopback Studio requests.",
    routeRelativePath = "",
    routeSurface = "",
    tags = []
  } = {}
) {
  requireApplication(app);

  const router = app.make("jskit.http.router");
  const routeBase = resolveScopedApiBasePath({
    routeBase: "/",
    relativePath: routeRelativePath,
    strictParams: false
  });
  const surface = normalizeSurfaceId(routeSurface);

  function actionRoute(method, pathSuffix, options) {
    const {
      actionId,
      buildInput = () => ({})
    } = options;

    registerRoute(method, pathSuffix, options, (request) => {
      return request.executeAction({
        actionId,
        input: buildInput(request)
      });
    });
  }

  function serviceRoute(method, pathSuffix, options, handler) {
    registerRoute(method, pathSuffix, options, handler);
  }

  function registerRoute(method, pathSuffix, options, handler) {
    router.register(
      method,
      fullRoutePath(routeBase, pathSuffix),
      routeOptions({
        ...options,
        surface,
        tags
      }),
      async function handleAiStudioFeatureRoute(request, reply) {
        if (!requireLocalStudioRequest(request, reply, { message: localRequestMessage })) {
          return;
        }

        const response = await handler(request, reply);
        if (response === undefined) {
          return;
        }

        reply.code(responseStatusCode(response, options)).send(response);
      }
    );
  }

  return {
    actionRoute,
    requestBody: requestBodyObject,
    routeBase,
    serviceRoute
  };
}

function requireApplication(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("createAiStudioFeatureRoutes requires application make().");
  }
}

function fullRoutePath(routeBase, pathSuffix = "") {
  return `${routeBase}${pathSuffix}`;
}

function routeOptions({
  body,
  bodyLimit,
  meta = {},
  params,
  query,
  summary,
  surface,
  tags
}) {
  const options = {
    auth: "public",
    surface,
    meta: {
      ...meta,
      tags,
      summary
    }
  };

  if (body) {
    options.body = body;
  }
  if (bodyLimit) {
    options.bodyLimit = bodyLimit;
  }
  if (params) {
    options.params = params;
  }
  if (query) {
    options.query = query;
  }

  return options;
}

function responseStatusCode(response, {
  failureStatus,
  missingStatus = 404,
  statusCode,
  successStatus
} = {}) {
  if (typeof statusCode === "function") {
    return statusCode(response);
  }
  if (Number.isInteger(statusCode)) {
    return statusCode;
  }
  if (response?.ok === false && Number.isInteger(failureStatus)) {
    return failureStatus;
  }
  if (response?.ok !== false && Number.isInteger(successStatus)) {
    return successStatus;
  }
  return aiStudioStatusCode(response, { missingStatus });
}

export { createAiStudioFeatureRoutes };
