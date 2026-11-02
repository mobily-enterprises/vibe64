import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { requestQuery, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";
import { studioHealthQueryInputValidator, studioToolsQueryInputValidator } from "./inputSchemas.js";
import { ACTION_CHECK_STUDIO_TOOLS, ACTION_READ_STUDIO_HEALTH } from "./studioHealthActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 */
function registerRoutes(http, { localhostCheckBypassed }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "health"] }), {
    relativePath: "studio/health",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Studio health is available only to the local Vibe64 editor.",
      projectScoped: false
    })
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_STUDIO_HEALTH,
    buildInput: requestQuery,
    query: studioHealthQueryInputValidator,
    summary: "Inspect Vibe64 host platform health."
  });

  routes.actionRoute("GET", "/tools", {
    actionId: ACTION_CHECK_STUDIO_TOOLS,
    buildInput: requestQuery,
    query: studioToolsQueryInputValidator,
    summary: "Check whether the named tools run on this computer."
  });
}

export { registerRoutes };
