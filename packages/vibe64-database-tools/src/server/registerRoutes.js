import {
  isPlainObject
} from "@local/vibe64-core/server/core";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import { ERD_LAYOUT_MAX_BYTES } from "../shared/erdModel.js";

function withSession(request, input = {}) {
  const {
    vibe64User: _ignoredUser,
    ...safeInput
  } = isPlainObject(input) ? input : {};
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
  projectContext = null
} = {}) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-database-tools"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 database routes only accept loopback Studio requests.",
      projectContext
    })
  });
  const options = { statusCode: databaseStatusCode };

  routes.actionRoute("GET", "/database/sessions/:sessionId", {
    ...options,
    actionId: "vibe64.database.state.read",
    summary: "Read the selected session database workspace and current refreshed schema.",
    buildInput: (request) => withSession(request)
  });

  routes.actionRoute("GET", "/database/sessions/:sessionId/server", {
    ...options,
    actionId: "vibe64.database.server.check",
    summary: "Sign in to the database server the session's project needs, with the values from its Env.",
    buildInput: (request) => withSession(request)
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/schema/refresh", {
    ...options,
    actionId: "vibe64.database.schema.refresh",
    bodyLimit: 16 * 1024,
    summary: "Explicitly refresh the selected session database schema.",
    buildInput: (request) => withSession(request, {
      ...requestBody(request),
      source: "user"
    })
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/queries", {
    ...options,
    actionId: "vibe64.database.query.run",
    bodyLimit: 768 * 1024,
    summary: "Run one SQL statement against the selected session database.",
    buildInput: (request) => withSession(request, requestBody(request))
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/queries/:queryId/cancel", {
    ...options,
    actionId: "vibe64.database.query.cancel",
    bodyLimit: 16 * 1024,
    summary: "Cancel an active selected-session database query.",
    buildInput: (request) => withSession(request, {
      queryId: request.params.queryId
    })
  });

  routes.actionRoute("PATCH", "/database/sessions/:sessionId/cells", {
    ...options,
    actionId: "vibe64.database.cell.update",
    bodyLimit: 256 * 1024,
    summary: "Update one editable physical cell identified by query provenance.",
    buildInput: (request) => withSession(request, requestBody(request))
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/rows", {
    ...options,
    actionId: "vibe64.database.row.insert",
    bodyLimit: 512 * 1024,
    summary: "Insert one row into a selected physical table.",
    buildInput: (request) => withSession(request, requestBody(request))
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/rows/delete", {
    ...options,
    actionId: "vibe64.database.row.delete",
    bodyLimit: 256 * 1024,
    summary: "Delete one confirmed physical source row.",
    buildInput: (request) => withSession(request, requestBody(request))
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/lookups/search", {
    ...options,
    actionId: "vibe64.database.lookup.search",
    bodyLimit: 64 * 1024,
    summary: "Search a real foreign-key target table for inline autocomplete.",
    buildInput: (request) => withSession(request, requestBody(request))
  });

  routes.actionRoute("PUT", "/database/sessions/:sessionId/layout", {
    ...options,
    actionId: "vibe64.database.layout.save",
    bodyLimit: ERD_LAYOUT_MAX_BYTES + 16 * 1024,
    summary: "Persist the shared selected-session ERD layout and notify its viewers.",
    buildInput: (request) => withSession(request, requestBody(request))
  });

  routes.actionRoute("PUT", "/database/sessions/:sessionId/overview", {
    ...options,
    actionId: "vibe64.database.overview.save",
    bodyLimit: 512 * 1024,
    summary: "Save main actors and their explicit table memberships in project source.",
    buildInput: (request) => withSession(request, requestBody(request))
  });

  routes.actionRoute("PUT", "/database/sessions/:sessionId/snippets", {
    ...options,
    actionId: "vibe64.database.snippet.save",
    bodyLimit: 768 * 1024,
    summary: "Save a selected-session SQL snippet.",
    buildInput: (request) => withSession(request, requestBody(request))
  });

  routes.actionRoute("DELETE", "/database/sessions/:sessionId/snippets/:snippetId", {
    ...options,
    actionId: "vibe64.database.snippet.delete",
    bodyLimit: 16 * 1024,
    summary: "Delete a selected-session SQL snippet.",
    buildInput: (request) => withSession(request, {
      snippetId: request.params.snippetId
    })
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/assistant", {
    ...options,
    actionId: "vibe64.database.assistant.ask",
    bodyLimit: 2 * 1024 * 1024,
    summary: "Ask the focused database copilot with bounded on-demand access to the refreshed schema.",
    buildInput: (request) => withSession(request, requestBody(request))
  });
}

export {
  databaseStatusCode,
  registerRoutes,
  withSession
};
