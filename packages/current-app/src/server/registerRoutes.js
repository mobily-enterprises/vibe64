import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

import { ACTION_READ_CURRENT_APP } from "./currentAppActions.js";
import { currentAppQueryInputValidator } from "./inputSchemas.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {StudioProjectContext} options.projectContext
 */
function registerRoutes(http, { projectContext }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "current-app"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "studio/current-app",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Current-app Studio routes only accept loopback Studio requests.",
      projectContext
    })
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_CURRENT_APP,
    buildInput: requestQuery,
    query: currentAppQueryInputValidator,
    summary: "Inspect the current project's Vibe64 output targets."
  });
}

export { registerRoutes };
