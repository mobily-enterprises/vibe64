import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import {
  currentAppQueryInputValidator
} from "./inputSchemas.js";

function registerRoutes(http, {
  projectContext = null
} = {}) {
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
    actionId: "vibe64.current-app.read",
    buildInput: requestQuery,
    query: currentAppQueryInputValidator,
    summary: "Inspect the current project's Vibe64 output targets."
  });
}

export { registerRoutes };
