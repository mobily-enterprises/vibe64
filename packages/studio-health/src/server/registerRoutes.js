import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { ACTION_READ_STUDIO_HEALTH } from "./actions.js";
import { studioHealthQueryInputValidator } from "./inputSchemas.js";

function registerRoutes(http, {
  routeRelativePath = "studio/health",
  routeSurface = "app"
} = {}) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Studio health is available only to the local Vibe64 editor.",
    projectScoped: false,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "health"]
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_STUDIO_HEALTH,
    buildInput: routes.requestQuery,
    query: studioHealthQueryInputValidator,
    summary: "Inspect Vibe64 host platform health."
  });
}

export { registerRoutes };
