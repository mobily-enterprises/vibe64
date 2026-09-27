import {
  createVibe64FeatureRoutes
} from "@local/vibe64-core/server/featureRoutes";
import {
  ACTION_DATABASE_STATE_READ,
  ACTION_DATABASE_SCHEMA_REFRESH,
  ACTION_DATABASE_QUERY_RUN,
  ACTION_DATABASE_QUERY_CANCEL,
  ACTION_DATABASE_CELL_UPDATE,
  ACTION_DATABASE_ROW_INSERT,
  ACTION_DATABASE_ROW_DELETE,
  ACTION_DATABASE_LOOKUP_SEARCH,
  ACTION_DATABASE_LAYOUT_SAVE,
  ACTION_DATABASE_OVERVIEW_SAVE,
  ACTION_DATABASE_SNIPPET_SAVE,
  ACTION_DATABASE_SNIPPET_DELETE,
  ACTION_DATABASE_ASSISTANT_ASK
} from "./actions.js";
import { ERD_LAYOUT_MAX_BYTES } from "../shared/erdModel.js";

function withSession(request, input = {}) {
  const {
    vibe64User: _ignoredUser,
    ...safeInput
  } = input && typeof input === "object" && !Array.isArray(input) ? input : {};
  void _ignoredUser;
  return {
    ...safeInput,
    sessionId: request.params.sessionId
  };
}

function databaseStatusCode(response = {}) {
  if (response?.ok !== false) {
    return 200;
  }
  if (response?.code === "vibe64_assistant_owner_required") {
    return 403;
  }
  if (response?.code === "vibe64_session_not_found") {
    return 404;
  }
  if ([
    "vibe64_database_edit_conflict",
    "vibe64_database_delete_conflict",
    "vibe64_database_query_id_active",
    "vibe64_database_erd_layout_conflict",
    "vibe64_database_overview_conflict"
  ].includes(response?.code)) {
    return 409;
  }
  return 400;
}

function registerRoutes(http, {
  projectContext = null,
  routeRelativePath = "",
  routeSurface = ""
} = {}) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 database routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-database-tools"]
  });
  const sessionRoute = "/database/sessions/:sessionId";
  const route = (method, suffix, actionId, options, buildInput) => routes.actionRoute(
    method,
    `${sessionRoute}${suffix}`,
    {
      statusCode: databaseStatusCode,
      ...options,
      actionId,
      buildInput
    }
  );

  route("GET", "", ACTION_DATABASE_STATE_READ, {
    summary: "Read the selected session database workspace and current refreshed schema."
  }, (request) => withSession(request));

  route("POST", "/schema/refresh", ACTION_DATABASE_SCHEMA_REFRESH, {
    bodyLimit: 16 * 1024,
    summary: "Explicitly refresh the selected session database schema."
  }, (request) => withSession(request, {
    ...routes.requestBody(request),
    source: "user"
  }));

  route("POST", "/queries", ACTION_DATABASE_QUERY_RUN, {
    bodyLimit: 768 * 1024,
    summary: "Run one SQL statement against the selected session database."
  }, (request) => withSession(request, routes.requestBody(request)));

  route("POST", "/queries/:queryId/cancel", ACTION_DATABASE_QUERY_CANCEL, {
    bodyLimit: 16 * 1024,
    summary: "Cancel an active selected-session database query."
  }, (request) => withSession(request, {
    queryId: request.params.queryId
  }));

  route("PATCH", "/cells", ACTION_DATABASE_CELL_UPDATE, {
    bodyLimit: 256 * 1024,
    summary: "Update one editable physical cell identified by query provenance."
  }, (request) => withSession(request, routes.requestBody(request)));

  route("POST", "/rows", ACTION_DATABASE_ROW_INSERT, {
    bodyLimit: 512 * 1024,
    summary: "Insert one row into a selected physical table."
  }, (request) => withSession(request, routes.requestBody(request)));

  route("POST", "/rows/delete", ACTION_DATABASE_ROW_DELETE, {
    bodyLimit: 256 * 1024,
    summary: "Delete one confirmed physical source row."
  }, (request) => withSession(request, routes.requestBody(request)));

  route("POST", "/lookups/search", ACTION_DATABASE_LOOKUP_SEARCH, {
    bodyLimit: 64 * 1024,
    summary: "Search a real foreign-key target table for inline autocomplete."
  }, (request) => withSession(request, routes.requestBody(request)));

  route("PUT", "/layout", ACTION_DATABASE_LAYOUT_SAVE, {
    bodyLimit: ERD_LAYOUT_MAX_BYTES + 16 * 1024,
    summary: "Persist the shared selected-session ERD layout and notify its viewers."
  }, (request) => withSession(request, routes.requestBody(request)));

  route("PUT", "/overview", ACTION_DATABASE_OVERVIEW_SAVE, {
    bodyLimit: 512 * 1024,
    summary: "Save main actors and their explicit table memberships in project source."
  }, (request) => withSession(request, routes.requestBody(request)));

  route("PUT", "/snippets", ACTION_DATABASE_SNIPPET_SAVE, {
    bodyLimit: 768 * 1024,
    summary: "Save a selected-session SQL snippet."
  }, (request) => withSession(request, routes.requestBody(request)));

  route("DELETE", "/snippets/:snippetId", ACTION_DATABASE_SNIPPET_DELETE, {
    bodyLimit: 16 * 1024,
    summary: "Delete a selected-session SQL snippet."
  }, (request) => withSession(request, {
    snippetId: request.params.snippetId
  }));

  route("POST", "/assistant", ACTION_DATABASE_ASSISTANT_ASK, {
    bodyLimit: 2 * 1024 * 1024,
    summary: "Ask the focused database copilot with bounded on-demand access to the refreshed schema."
  }, (request) => withSession(request, routes.requestBody(request)));
}

export {
  databaseStatusCode,
  registerRoutes,
  withSession
};
