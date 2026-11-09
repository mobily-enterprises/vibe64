import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

import {
  ACTION_SYSTEM_GRAPH_USAGE_ENTRIES_READ,
  ACTION_SYSTEM_GRAPH_USAGE_FUNCTION_READ,
  ACTION_SYSTEM_GRAPH_USAGE_JOIN,
  ACTION_SYSTEM_GRAPH_USAGE_ROUTES_MATCH,
  ACTION_SYSTEM_GRAPH_USAGE_WEB_READ
} from "./usageActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

/**
 * The URL's session plus the named request fields that are present. Anything else in the request is ignored rather
 * than passed to the action.
 */
function usageInput(request, source, fields) {
  return {
    sessionId: request.params.sessionId,
    ...Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]))
  };
}

function usageEntriesInput(request) {
  return usageInput(request, requestQuery(request), ["kind", "q", "file", "cursor", "limit"]);
}

function usageWebInput(request) {
  return usageInput(request, requestQuery(request), ["entryId", "mode", "certainty", "subsystemId", "maxNodes"]);
}

function usageFunctionInput(request) {
  return usageInput(request, requestQuery(request), ["functionId"]);
}

function usageJoinInput(request) {
  return usageInput(request, requestBody(request), ["functions"]);
}

function usageRoutesInput(request) {
  return usageInput(request, requestBody(request), ["requests"]);
}

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 * @param {StudioProjectContext} options.projectContext
 */
function registerUsageRoutes(http, { localhostCheckBypassed, projectContext }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-system-graph"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Vibe64 City routes only accept loopback Studio requests.",
      projectContext
    })
  });

  routes.actionRoute("GET", "/system-graph/sessions/:sessionId/usage/entries", {
    actionId: ACTION_SYSTEM_GRAPH_USAGE_ENTRIES_READ,
    buildInput: usageEntriesInput,
    summary: "List the entry points a usage map can start from."
  });

  routes.actionRoute("GET", "/system-graph/sessions/:sessionId/usage/web", {
    actionId: ACTION_SYSTEM_GRAPH_USAGE_WEB_READ,
    buildInput: usageWebInput,
    summary: "Read the subsystems, files or functions one entry point reaches."
  });

  routes.actionRoute("GET", "/system-graph/sessions/:sessionId/usage/function", {
    actionId: ACTION_SYSTEM_GRAPH_USAGE_FUNCTION_READ,
    buildInput: usageFunctionInput,
    summary: "Read one function's calls and callers."
  });

  routes.actionRoute("POST", "/system-graph/sessions/:sessionId/usage/join", {
    actionId: ACTION_SYSTEM_GRAPH_USAGE_JOIN,
    buildInput: usageJoinInput,
    bodyLimit: 1024 * 1024,
    summary: "Join recorded functions to the current call web."
  });

  routes.actionRoute("POST", "/system-graph/sessions/:sessionId/usage/routes", {
    actionId: ACTION_SYSTEM_GRAPH_USAGE_ROUTES_MATCH,
    buildInput: usageRoutesInput,
    bodyLimit: 256 * 1024,
    summary: "Name each recorded request's route template from the current scan."
  });
}

export {
  registerUsageRoutes
};
