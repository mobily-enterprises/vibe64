import { resolveScopedApiBasePath, normalizeSurfaceId } from "@jskit-ai/kernel/shared/surface";

import { requireLocalStudioRequest } from "./localStudioRequest.js";
import {
  vibe64StatusCode,
  requestBodyObject,
  requestQueryObject
} from "./serverResponses.js";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  runWithResolvedProjectRequestContext,
  projectRequestErrorStatusCode
} from "./projectRequestContext.js";

function createVibe64FeatureRoutes(
  http,
  {
    localRequestMessage = "Vibe64 routes only accept loopback Studio requests.",
    projectContext = null,
    routeRelativePath = "",
    routeSurface = "",
    projectScoped: requestedProjectScoped = true,
    learningActions = null,
    tags = []
  } = {}
) {
  requireHttpCapability(http);

  // A lesson registration serves the same adapters under the saved attempt's
  // URL, and only for actions whose definition declares learningAccess. That
  // declaration is the single allowlist; every other operation has no lesson URL.
  const learningScoped = learningActions !== null;
  const learningAllowed = learningScoped ? new Set([...learningActions]
    .filter(action => action?.extensions?.vibe64?.learningAccess).map(action => action.id)) : null;
  const projectScoped = learningScoped ? false : requestedProjectScoped;
  const router = http.router;
  const routeBase = resolveScopedApiBasePath({
    routeBase: projectScoped ? VIBE64_PROJECT_ROUTE_BASE : "/",
    relativePath: routeRelativePath || (learningScoped ? "learning/:learningAttemptId/vibe64" : ""),
    strictParams: false
  });
  const surface = normalizeSurfaceId(routeSurface);

  // Ordinary product operations belong to named actions: input, business access
  // and execution must be shared by HTTP and automation. Keep serviceRoute for
  // transport adapters (streams, multipart, sockets), not a second operation.
  // Conversation dispatch parity is exercised in vibe64ConversationActionDispatch.
  function actionRoute(method, pathSuffix, options) {
    const {
      actionId,
      buildInput = () => ({}),
      learning = {}
    } = options;
    if (learningScoped) {
      // `learning: false` keeps a declared internal operation off HTTP;
      // `learning: { path, ...options }` adapts only the lesson URL shape.
      if (!learningAllowed.has(actionId) || learning === false) return;
      const { path: learningPath = pathSuffix, ...learningOptions } = learning;
      registerRoute(method, learningPath, { ...options, ...learningOptions }, (request) => request.executeAction({
        actionId,
        input: actionInput(request, buildInput(request))
      }));
      return;
    }

    registerRoute(method, pathSuffix, options, (request) => {
      return request.executeAction({
        actionId,
        input: buildInput(request)
      });
    });
  }

  // Transport adapters (downloads, streams) join a lesson registration only
  // with `learning: true`; their action still checks its own learningAccess.
  function serviceRoute(method, pathSuffix, options, handler) {
    if (learningScoped && options?.learning !== true) return;
    registerRoute(method, pathSuffix, options, handler);
  }

  // Lesson input carries identity only from the URL: the saved attempt and the
  // session. Browser-sent user, project and attempt fields are dropped.
  function actionInput(request, input = {}) {
    if (!learningScoped) return input;
    const learningAttemptId = request.params?.learningAttemptId;
    if (!learningAttemptId) {
      throw Object.assign(new Error("Use the exact saved lesson URL."), {
        code: "vibe64_learning_attempt_required", statusCode: 400
      });
    }
    const { vibe64User: _user, projectSlug: _project, learningAttemptId: _attempt, ...rest } = input || {};
    void _user; void _project; void _attempt;
    return { ...rest, ...(request.params.sessionId ? { sessionId: request.params.sessionId } : {}), learningAttemptId };
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
          return reply;
        }

        let response;
        try {
          response = projectScoped
            ? await runWithResolvedProjectRequestContext({
                projectContext,
                request
              }, () => handler(request, reply))
            : await handler(request, reply);
        } catch (error) {
          if (isProjectRequestError(error)) {
            return reply.code(projectRequestErrorStatusCode(error)).send({
              ok: false,
              errors: [
                {
                  code: error?.code || "vibe64_project_request_failed",
                  message: String(error?.message || error || "Vibe64 project request failed.")
                }
              ]
            });
          }
          throw error;
        }
        if (response === undefined) {
          return reply;
        }

        return reply.code(responseStatusCode(response, options)).send(response);
      }
    );
  }

  return {
    actionInput,
    actionRoute,
    learningScoped,
    requestBody: requestBodyObject,
    requestQuery: requestQueryObject,
    routeBase,
    serviceRoute
  };
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

function requireHttpCapability(http) {
  if (!http?.router || typeof http.router.register !== "function") {
    throw new Error("createVibe64FeatureRoutes requires runtime.http with router.register().");
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
  if (Number.isInteger(response?.statusCode)) {
    return response.statusCode;
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
