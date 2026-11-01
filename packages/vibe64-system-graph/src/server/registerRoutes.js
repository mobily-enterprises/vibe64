import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

import {
  ACTION_SYSTEM_GRAPH_ARCHITECTURE_READ,
  ACTION_SYSTEM_GRAPH_REFRESH,
  ACTION_SYSTEM_GRAPH_REFRESH_CANCEL,
  ACTION_SYSTEM_GRAPH_REFRESH_STATUS,
  ACTION_SYSTEM_GRAPH_STATUS_READ
} from "./systemGraphActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

function sessionInput(request) {
  return {
    sessionId: request.params.sessionId
  };
}

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {StudioProjectContext} options.projectContext
 */
function registerRoutes(http, { projectContext }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-system-graph"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 City routes only accept loopback Studio requests.",
      projectContext
    })
  });

  routes.actionRoute("GET", "/system-graph/sessions/:sessionId/architecture", {
    actionId: ACTION_SYSTEM_GRAPH_ARCHITECTURE_READ,
    buildInput: sessionInput,
    summary: "Read the compact neutral architecture snapshot for an active session."
  });

  routes.actionRoute("GET", "/system-graph/sessions/:sessionId/status", {
    actionId: ACTION_SYSTEM_GRAPH_STATUS_READ,
    buildInput: sessionInput,
    summary: "Read Genesis Machine and Program City availability for an active session."
  });

  routes.actionRoute("POST", "/system-graph/sessions/:sessionId/refresh/cancel", {
    actionId: ACTION_SYSTEM_GRAPH_REFRESH_CANCEL,
    buildInput: sessionInput,
    bodyLimit: 16 * 1024,
    summary: "Cancel this source architecture analysis and await cleanup."
  });

  routes.actionRoute("GET", "/system-graph/sessions/:sessionId/refresh/status", {
    actionId: ACTION_SYSTEM_GRAPH_REFRESH_STATUS,
    buildInput: sessionInput,
    summary: "Read the running analysis stage without loading the project index."
  });

  routes.actionRoute("POST", "/system-graph/sessions/:sessionId/refresh", {
    actionId: ACTION_SYSTEM_GRAPH_REFRESH,
    buildInput: sessionInput,
    bodyLimit: 16 * 1024,
    summary: "Synchronously refresh both Genesis Cities for an active session."
  });
}

export {
  registerRoutes
};
