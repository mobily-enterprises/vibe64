import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";

import { requireLocalStudioRequest } from "./localStudioRequest.js";
import {
  vibe64StatusCode,
  requestBodyObject as requestBody,
  requestQueryObject as requestQuery
} from "./serverResponses.js";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  currentProjectRuntimeRoot,
  isProjectRequestError,
  runWithResolvedProjectRequestContext,
  projectRequestErrorStatusCode
} from "./projectRequestContext.js";
import { recordSessionTimelineEvent } from "./sessionTimeline.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

// Vibe64 routes are JSKIT action route scopes:
//
//   const routes = createActionRouteScope(vibe64RouteHttp(http, { tags }), {
//     routeBase: VIBE64_PROJECT_ROUTE_BASE, relativePath: "vibe64", surface: "app",
//     wrapHandler: vibe64RouteHandler({ localhostCheckBypassed, projectContext, localRequestMessage })
//   });
//
// Keep the scope options and each actionRoute's method, suffix and actionId
// literal, so the route table and static inspection both know which action a
// route runs. Ordinary product operations belong to named actions: input,
// business access and execution must be shared by HTTP and automation. Keep
// serviceRoute for transport adapters (streams, multipart, sockets), not a
// second operation.
const PROJECT_API_BASE = resolveScopedApiBasePath({ routeBase: VIBE64_PROJECT_ROUTE_BASE, strictParams: false });

/**
 * The router a Vibe64 scope registers through. Vibe64 checks its own requests
 * in the handler, so routes are public at the JSKIT auth layer; they carry the
 * scope's documentation tags and only the options the router reads.
 * @param {RuntimeHttp} http
 * @param {object} [options]
 * @param {string[]} [options.tags]
 */
function vibe64RouteHttp(http, options = {}) {
  const { tags = [] } = options;

  /**
   * Registers one route with the scope's tags and only the options the router reads.
   * @param {string} method
   * @param {string} path
   * @param {object} routeDefinition
   * @param {Function} handler
   */
  function register(method, path, routeDefinition, handler) {
    return http.router.register(method, path, routeOptions(routeDefinition, tags), handler);
  }

  return Object.freeze({
    router: Object.freeze({ register })
  });
}

function routeOptions({ actionId, body, bodyLimit, meta = {}, params, query, summary, surface = "" }, tags) {
  return {
    ...(actionId ? { actionId } : {}),
    auth: "public",
    surface,
    meta: { ...meta, tags, summary },
    ...(body ? { body } : {}),
    ...(bodyLimit ? { bodyLimit } : {}),
    ...(params ? { params } : {}),
    ...(query ? { query } : {})
  };
}

/**
 * The wrapHandler of a Vibe64 scope: only loopback Studio requests, the
 * project request context (with its Learn, team AI and practice admission)
 * for routes under VIBE64_PROJECT_ROUTE_BASE, project errors as JSON, and the
 * route's status code for the response.
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed whether the server was started with the localhost check bypassed
 * @param {string} [options.localRequestMessage]
 * @param {import("./types.js").StudioProjectContext} [options.projectContext] required for a project-scoped scope
 * @param {boolean} [options.projectScoped]
 */
function vibe64RouteHandler({
  localhostCheckBypassed,
  localRequestMessage = "Vibe64 routes only accept loopback Studio requests.",
  projectContext,
  projectScoped = true
}) {
  if (projectScoped && !projectContext) {
    throw new TypeError("A project-scoped Vibe64 route scope requires the project context its feature resolved.");
  }
  return function wrapVibe64Route(handler, { method, path, options = {} }) {
    // A project route without its project context would skip that admission.
    if (projectScoped !== isProjectRoutePath(path)) {
      throw new Error(`Vibe64 route ${method} ${path} is ${projectScoped ? "" : "not "}project-scoped, so it must ${projectScoped ? "" : "not "}be under ${PROJECT_API_BASE}.`);
    }
    return async function handleVibe64Route(request, reply) {
      if (!requireLocalStudioRequest(request, reply, { localhostCheckBypassed, message: localRequestMessage })) {
        return reply;
      }

      let response;
      let projectRuntimeRoot = "";
      try {
        response = projectScoped
          ? await runWithResolvedProjectRequestContext({
            projectContext,
            request
          }, () => {
            projectRuntimeRoot = currentProjectRuntimeRoot();
            return handler(request, reply);
          })
          : await handler(request, reply);
      } catch (error) {
        if (isProjectRequestError(error)) {
          return reply.code(projectRequestErrorStatusCode(error)).send({
            ok: false,
            code: error?.code || "vibe64_project_request_failed",
            ...(error?.details && typeof error.details === "object" ? { details: error.details } : {}),
            errors: [
              {
                code: error?.code || "vibe64_project_request_failed",
                message: String(error?.message || error || "Vibe64 project request failed.")
              }
            ]
          });
        }
        recordFailedSessionRequest(request, projectRuntimeRoot, Number(error?.statusCode || error?.status) || 500, error?.code);
        throw error;
      }
      // The handler answered itself, or has nothing to answer, which Fastify answers with an empty 200. Returning the
      // reply instead held a request nothing answered until the client went away: the reply is a thenable that
      // settles only once the response ends.
      if (response === undefined) {
        recordFailedSessionRequest(request, projectRuntimeRoot, reply.statusCode);
        return undefined;
      }

      const status = responseStatusCode(response, options);
      recordFailedSessionRequest(request, projectRuntimeRoot, status, response?.code || response?.errors?.[0]?.code);
      return reply.code(status).send(response);
    };
  };
}

// A session route that failed on the server's side (5xx) goes in the
// session's timeline (sessionTimeline.js) with its method, route, status and
// error code; a refusal (4xx) is the person's request, not a failure.
function recordFailedSessionRequest(request, projectRuntimeRoot, status, code = "") {
  if (!projectRuntimeRoot || !(status >= 500)) return;
  recordSessionTimelineEvent(request.params?.sessionId, {
    kind: "request",
    event: "failed",
    method: request.method,
    route: request.routeOptions?.url,
    status,
    code: typeof code === "string" ? code : ""
  }, { projectRuntimeRoot });
}

function isProjectRoutePath(path = "") {
  return path === PROJECT_API_BASE || path.startsWith(`${PROJECT_API_BASE}/`);
}

function responseStatusCode(response, options = {}) {
  const {
    failureStatus,
    missingStatus = 404,
    statusCode,
    successStatus
  } = options;
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

export {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
};
