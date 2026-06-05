import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import { requireLocalStudioRequest } from "./localStudioRequest.js";
import {
  vibe64StatusCode,
  requestBodyObject
} from "./serverResponses.js";
import {
  VIBE64_WORKSPACE_ROUTE_BASE,
  runWithResolvedWorkspaceRequestContext,
  workspaceRequestErrorStatusCode
} from "./workspaceRequestContext.js";

function createVibe64FeatureRoutes(
  app,
  {
    localRequestMessage = "Vibe64 routes only accept loopback Studio requests.",
    projectContext = null,
    routeRelativePath = "",
    routeSurface = "",
    workspaceScoped = true,
    tags = []
  } = {}
) {
  requireApplication(app);

  const router = app.make("jskit.http.router");
  const routeBase = resolveScopedApiBasePath({
    routeBase: workspaceScoped ? VIBE64_WORKSPACE_ROUTE_BASE : "/",
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
      async function handleVibe64FeatureRoute(request, reply) {
        if (!requireLocalStudioRequest(request, reply, { message: localRequestMessage })) {
          return;
        }

        let response;
        try {
          response = workspaceScoped
            ? await runWithResolvedWorkspaceRequestContext({
                projectContext,
                request
              }, () => handler(request, reply))
            : await handler(request, reply);
        } catch (error) {
          if (isWorkspaceRequestError(error)) {
            reply.code(workspaceRequestErrorStatusCode(error)).send({
              ok: false,
              errors: [
                {
                  code: error?.code || "vibe64_workspace_request_failed",
                  message: String(error?.message || error || "Vibe64 workspace request failed.")
                }
              ]
            });
            return;
          }
          throw error;
        }
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

function isWorkspaceRequestError(error = {}) {
  return [
    "vibe64_invalid_workspace_slug",
    "vibe64_project_path_not_accessible",
    "vibe64_project_path_not_directory",
    "vibe64_project_path_symlink"
  ].includes(error?.code);
}

function requireApplication(app) {
  if (!app || typeof app.make !== "function") {
    throw new Error("createVibe64FeatureRoutes requires application make().");
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
  return vibe64StatusCode(response, { missingStatus });
}

export { createVibe64FeatureRoutes };
