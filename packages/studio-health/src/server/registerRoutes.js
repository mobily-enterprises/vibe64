import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { requestQuery, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";
import { studioHealthQueryInputValidator, studioToolsQueryInputValidator } from "./inputSchemas.js";

function registerRoutes(http) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "health"] }), {
    relativePath: "studio/health",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Studio health is available only to the local Vibe64 editor.",
      projectScoped: false
    })
  });

  routes.actionRoute("GET", "", {
    actionId: "vibe64.studio-health.read",
    buildInput: requestQuery,
    query: studioHealthQueryInputValidator,
    summary: "Inspect Vibe64 host platform health."
  });

  routes.actionRoute("GET", "/tools", {
    actionId: "vibe64.studio-health.tools",
    buildInput: requestQuery,
    query: studioToolsQueryInputValidator,
    summary: "Check whether the named tools run on this computer."
  });
}

export { registerRoutes };
