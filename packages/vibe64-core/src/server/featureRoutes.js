import { resolveScopedApiBasePath } from "@jskit-ai/kernel/shared/surface";

import { requireLocalStudioRequest } from "./localStudioRequest.js";
import {
  vibe64StatusCode,
  requestBodyObject as requestBody,
  requestQueryObject as requestQuery
} from "./serverResponses.js";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  isProjectRequestError,
  runWithResolvedProjectRequestContext,
  projectRequestErrorStatusCode
} from "./projectRequestContext.js";

// Vibe64 routes are JSKIT action route scopes:
//
//   const routes = createActionRouteScope(vibe64RouteHttp(http, { tags }), {
//     routeBase: VIBE64_PROJECT_ROUTE_BASE, relativePath: "vibe64", surface: "app",
//     wrapHandler: vibe64RouteHandler({ projectContext, localRequestMessage })
//   });
//
// Keep the scope options and each actionRoute's method, suffix and actionId
// literal, so the route table and static inspection both know which action a
// route runs. Ordinary product operations belong to named actions: input,
// business access and execution must be shared by HTTP and automation. Keep
// serviceRoute for transport adapters (streams, multipart, sockets), not a
// second operation. Conversation dispatch parity is exercised in
// vibe64ConversationActionDispatch.
const PROJECT_API_BASE = resolveScopedApiBasePath({ routeBase: VIBE64_PROJECT_ROUTE_BASE, strictParams: false });

// The router a Vibe64 scope registers through. Vibe64 checks its own requests
// in the handler, so routes are public at the JSKIT auth layer; they carry the
// scope's documentation tags and only the options the router reads.
function vibe64RouteHttp(http, { tags = [] } = {}) {
  if (!http?.router || typeof http.router.register !== "function") {
    throw new Error("vibe64RouteHttp requires runtime.http with router.register().");
  }
  return {
    router: {
      register(method, path, options, handler) {
        return http.router.register(method, path, routeOptions(options, tags), handler);
      }
    }
  };
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

// The wrapHandler of a Vibe64 scope: only loopback Studio requests, the
// project request context (with its Learn, team AI and practice admission)
// for routes under VIBE64_PROJECT_ROUTE_BASE, project errors as JSON, and the
// route's status code for the response.
function vibe64RouteHandler({
  localRequestMessage = "Vibe64 routes only accept loopback Studio requests.",
  projectContext = null,
  projectScoped = true
} = {}) {
  return function wrapVibe64Route(handler, { method, path, options = {} }) {
    // A project route without its project context would skip that admission.
    if (projectScoped !== isProjectRoutePath(path)) {
      throw new Error(`Vibe64 route ${method} ${path} is ${projectScoped ? "" : "not "}project-scoped, ` +
        `so it must ${projectScoped ? "" : "not "}be under ${PROJECT_API_BASE}.`);
    }
    return async function handleVibe64Route(request, reply) {
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
        throw error;
      }
      if (response === undefined) {
        return reply;
      }

      return reply.code(responseStatusCode(response, options)).send(response);
    };
  };
}

function isProjectRoutePath(path = "") {
  return path === PROJECT_API_BASE || path.startsWith(`${PROJECT_API_BASE}/`);
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

export {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
};
