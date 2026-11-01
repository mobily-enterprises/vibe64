import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import { ERD_LAYOUT_MAX_BYTES } from "../shared/erdModel.js";
import {
  ACTION_DATABASE_ASSISTANT_ASK,
  ACTION_DATABASE_CELL_UPDATE,
  ACTION_DATABASE_LAYOUT_SAVE,
  ACTION_DATABASE_LOOKUP_SEARCH,
  ACTION_DATABASE_OVERVIEW_SAVE,
  ACTION_DATABASE_QUERY_CANCEL,
  ACTION_DATABASE_QUERY_RUN,
  ACTION_DATABASE_ROW_DELETE,
  ACTION_DATABASE_ROW_INSERT,
  ACTION_DATABASE_SCHEMA_REFRESH,
  ACTION_DATABASE_SERVER_CHECK,
  ACTION_DATABASE_SNIPPET_DELETE,
  ACTION_DATABASE_SNIPPET_SAVE,
  ACTION_DATABASE_STATE_READ
} from "./databaseActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

function sessionInput(request) {
  return {
    sessionId: request.params.sessionId
  };
}

/**
 * The body for the URL's session. A body vibe64User is dropped: the action
 * policy sets the trusted user, and its schema has no vibe64User field.
 */
function sessionBodyInput(request) {
  const {
    vibe64User: _ignoredUser,
    ...body
  } = requestBody(request);
  void _ignoredUser;
  return {
    ...body,
    sessionId: request.params.sessionId
  };
}

function schemaRefreshInput(request) {
  return {
    ...sessionBodyInput(request),
    source: "user"
  };
}

function queryCancelInput(request) {
  return {
    queryId: request.params.queryId,
    sessionId: request.params.sessionId
  };
}

function snippetDeleteInput(request) {
  return {
    snippetId: request.params.snippetId,
    sessionId: request.params.sessionId
  };
}

function databaseStatusCode(response) {
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

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {StudioProjectContext} options.projectContext
 */
function registerRoutes(http, { projectContext }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-database-tools"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 database routes only accept loopback Studio requests.",
      projectContext
    })
  });

  routes.actionRoute("GET", "/database/sessions/:sessionId", {
    actionId: ACTION_DATABASE_STATE_READ,
    summary: "Read the selected session database workspace and current refreshed schema.",
    buildInput: sessionInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("GET", "/database/sessions/:sessionId/server", {
    actionId: ACTION_DATABASE_SERVER_CHECK,
    summary: "Sign in to the database server the session's project needs, with the values from its Env.",
    buildInput: sessionInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/schema/refresh", {
    actionId: ACTION_DATABASE_SCHEMA_REFRESH,
    bodyLimit: 16 * 1024,
    summary: "Explicitly refresh the selected session database schema.",
    buildInput: schemaRefreshInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/queries", {
    actionId: ACTION_DATABASE_QUERY_RUN,
    bodyLimit: 768 * 1024,
    summary: "Run one SQL statement against the selected session database.",
    buildInput: sessionBodyInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/queries/:queryId/cancel", {
    actionId: ACTION_DATABASE_QUERY_CANCEL,
    bodyLimit: 16 * 1024,
    summary: "Cancel an active selected-session database query.",
    buildInput: queryCancelInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("PATCH", "/database/sessions/:sessionId/cells", {
    actionId: ACTION_DATABASE_CELL_UPDATE,
    bodyLimit: 256 * 1024,
    summary: "Update one editable physical cell identified by query provenance.",
    buildInput: sessionBodyInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/rows", {
    actionId: ACTION_DATABASE_ROW_INSERT,
    bodyLimit: 512 * 1024,
    summary: "Insert one row into a selected physical table.",
    buildInput: sessionBodyInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/rows/delete", {
    actionId: ACTION_DATABASE_ROW_DELETE,
    bodyLimit: 256 * 1024,
    summary: "Delete one confirmed physical source row.",
    buildInput: sessionBodyInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/lookups/search", {
    actionId: ACTION_DATABASE_LOOKUP_SEARCH,
    bodyLimit: 64 * 1024,
    summary: "Search a real foreign-key target table for inline autocomplete.",
    buildInput: sessionBodyInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("PUT", "/database/sessions/:sessionId/layout", {
    actionId: ACTION_DATABASE_LAYOUT_SAVE,
    bodyLimit: ERD_LAYOUT_MAX_BYTES + 16 * 1024,
    summary: "Persist the shared selected-session ERD layout and notify its viewers.",
    buildInput: sessionBodyInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("PUT", "/database/sessions/:sessionId/overview", {
    actionId: ACTION_DATABASE_OVERVIEW_SAVE,
    bodyLimit: 512 * 1024,
    summary: "Save main actors and their explicit table memberships in project source.",
    buildInput: sessionBodyInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("PUT", "/database/sessions/:sessionId/snippets", {
    actionId: ACTION_DATABASE_SNIPPET_SAVE,
    bodyLimit: 768 * 1024,
    summary: "Save a selected-session SQL snippet.",
    buildInput: sessionBodyInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("DELETE", "/database/sessions/:sessionId/snippets/:snippetId", {
    actionId: ACTION_DATABASE_SNIPPET_DELETE,
    bodyLimit: 16 * 1024,
    summary: "Delete a selected-session SQL snippet.",
    buildInput: snippetDeleteInput,
    statusCode: databaseStatusCode
  });

  routes.actionRoute("POST", "/database/sessions/:sessionId/assistant", {
    actionId: ACTION_DATABASE_ASSISTANT_ASK,
    bodyLimit: 2 * 1024 * 1024,
    summary: "Ask the focused database copilot with bounded on-demand access to the refreshed schema.",
    buildInput: sessionBodyInput,
    statusCode: databaseStatusCode
  });
}

export {
  registerRoutes
};
