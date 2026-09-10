import {
  createVibe64FeatureRoutes
} from "@local/vibe64-core/server/featureRoutes";

function withUser(request, input = {}) {
  const {
    vibe64User: _ignoredUser,
    ...safeInput
  } = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  void _ignoredUser;
  return {
    ...safeInput,
    sessionId: request.params.sessionId,
    ...(request.vibe64User ? { vibe64User: request.vibe64User } : {})
  };
}

function databaseStatusCode(response = {}) {
  if (response?.ok !== false) {
    return 200;
  }
  if (response?.code === "vibe64_owner_required") {
    return 403;
  }
  if (response?.code === "vibe64_session_not_found") {
    return 404;
  }
  if ([
    "vibe64_database_edit_conflict",
    "vibe64_database_delete_conflict",
    "vibe64_database_query_id_active",
    "vibe64_database_overview_conflict"
  ].includes(response?.code)) {
    return 409;
  }
  return 400;
}

function registerRoutes(http, {
  databaseTools,
  projectContext = null,
  routeRelativePath = "",
  routeSurface = ""
} = {}) {
  if (!databaseTools || typeof databaseTools.readState !== "function") {
    throw new TypeError("registerRoutes requires the Vibe64 Database Tools API.");
  }
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 database routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-database-tools"]
  });
  const sessionRoute = "/database/sessions/:sessionId";
  const route = (method, suffix, options, handler) => routes.serviceRoute(
    method,
    `${sessionRoute}${suffix}`,
    {
      statusCode: databaseStatusCode,
      ...options
    },
    handler
  );

  route("GET", "", {
    summary: "Read the selected session database workspace and current refreshed schema."
  }, (request) => databaseTools.readState(withUser(request)));

  route("POST", "/schema/refresh", {
    bodyLimit: 16 * 1024,
    summary: "Explicitly refresh the selected session database schema."
  }, (request) => databaseTools.refreshSchema(withUser(request, {
    ...routes.requestBody(request),
    source: "user"
  })));

  route("POST", "/queries", {
    bodyLimit: 768 * 1024,
    summary: "Run one SQL statement against the selected session database."
  }, (request) => databaseTools.runQuery(withUser(request, routes.requestBody(request))));

  route("POST", "/queries/:queryId/cancel", {
    bodyLimit: 16 * 1024,
    summary: "Cancel an active selected-session database query."
  }, (request) => databaseTools.cancelQuery(withUser(request, {
    queryId: request.params.queryId
  })));

  route("PATCH", "/cells", {
    bodyLimit: 256 * 1024,
    summary: "Update one editable physical cell identified by query provenance."
  }, (request) => databaseTools.updateCell(withUser(request, routes.requestBody(request))));

  route("POST", "/rows", {
    bodyLimit: 512 * 1024,
    summary: "Insert one row into a selected physical table."
  }, (request) => databaseTools.insertRow(withUser(request, routes.requestBody(request))));

  route("POST", "/rows/delete", {
    bodyLimit: 256 * 1024,
    summary: "Delete one confirmed physical source row."
  }, (request) => databaseTools.deleteRow(withUser(request, routes.requestBody(request))));

  route("POST", "/lookups/search", {
    bodyLimit: 64 * 1024,
    summary: "Search a real foreign-key target table for inline autocomplete."
  }, (request) => databaseTools.searchLookup(withUser(request, routes.requestBody(request))));

  route("PUT", "/layout", {
    bodyLimit: 512 * 1024,
    summary: "Persist the shared selected-session ERD layout and notify its viewers."
  }, (request) => databaseTools.saveLayout(withUser(request, routes.requestBody(request))));

  route("PUT", "/overview", {
    bodyLimit: 512 * 1024,
    summary: "Save main actors and their explicit table memberships in project source."
  }, (request) => databaseTools.saveOverview(withUser(request, routes.requestBody(request))));

  route("PUT", "/snippets", {
    bodyLimit: 768 * 1024,
    summary: "Save a selected-session SQL snippet."
  }, (request) => databaseTools.saveSnippet(withUser(request, routes.requestBody(request))));

  route("DELETE", "/snippets/:snippetId", {
    bodyLimit: 16 * 1024,
    summary: "Delete a selected-session SQL snippet."
  }, (request) => databaseTools.deleteSnippet(withUser(request, {
    snippetId: request.params.snippetId
  })));

  route("POST", "/assistant", {
    bodyLimit: 2 * 1024 * 1024,
    summary: "Ask the focused database copilot with bounded on-demand access to the refreshed schema."
  }, (request) => databaseTools.askAssistant(withUser(request, routes.requestBody(request))));
}

export {
  databaseStatusCode,
  registerRoutes,
  withUser
};
