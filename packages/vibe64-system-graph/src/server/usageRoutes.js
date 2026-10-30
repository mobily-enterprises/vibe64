import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

// Query fields each usage route accepts; anything else in the request is
// ignored rather than passed to the action.
const USAGE_ROUTES = Object.freeze([
  ["GET", "entries", "usage.entries.read", ["kind", "q", "cursor", "limit"], "List the entry points a usage map can start from."],
  ["GET", "web", "usage.web.read", ["entryId", "mode", "certainty", "subsystemId", "maxNodes"], "Read the subsystems, files or functions one entry point reaches."],
  ["GET", "function", "usage.function.read", ["functionId"], "Read one function's calls and callers."],
  ["POST", "join", "usage.join", ["functions"], "Join recorded functions to the current call web."]
]);

function picked(source, fields) {
  return Object.fromEntries(fields.filter((field) => source[field] !== undefined).map((field) => [field, source[field]]));
}

function registerUsageRoutes(
  http,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 City routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-system-graph"]
  });
  for (const [method, suffix, operation, fields, summary] of USAGE_ROUTES) {
    routes.actionRoute(method, `/system-graph/sessions/:sessionId/usage/${suffix}`, {
      actionId: `vibe64.system-graph.${operation}`,
      buildInput: (request) => ({
        sessionId: request.params.sessionId,
        ...picked(method === "GET" ? routes.requestQuery(request) : routes.requestBody(request), fields)
      }),
      ...(method === "POST" ? { bodyLimit: 1024 * 1024 } : {}),
      summary
    });
  }
}

export {
  registerUsageRoutes
};
