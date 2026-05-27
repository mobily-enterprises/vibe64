import {
  projectConfigInputValidator,
  projectTypeInputValidator
} from "./inputSchemas.js";
import {
  ACTION_LIST_PROJECT_TOOLS,
  ACTION_READ_PROJECT_CONFIG,
  ACTION_READ_PROJECT_CONFIG_DEFAULTS,
  ACTION_READ_PROJECT_TYPE,
  ACTION_SAVE_PROJECT_CONFIG,
  ACTION_SAVE_PROJECT_TYPE
} from "./actions.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 project routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-project"]
  });

  routes.actionRoute("GET", "/tools", {
    actionId: ACTION_LIST_PROJECT_TOOLS,
    summary: "List Vibe64 project tools."
  });

  routes.actionRoute("GET", "/project-type", {
    actionId: ACTION_READ_PROJECT_TYPE,
    summary: "Read the Vibe64 project type."
  });

  routes.actionRoute("PUT", "/project-type", {
    actionId: ACTION_SAVE_PROJECT_TYPE,
    body: projectTypeInputValidator,
    buildInput: routes.requestBody,
    summary: "Set the Vibe64 project type."
  });

  routes.actionRoute("GET", "/project-config", {
    actionId: ACTION_READ_PROJECT_CONFIG,
    summary: "Read the Vibe64 project configuration."
  });

  routes.actionRoute("GET", "/project-config/defaults", {
    actionId: ACTION_READ_PROJECT_CONFIG_DEFAULTS,
    summary: "Read default Vibe64 project configuration values."
  });

  routes.actionRoute("PUT", "/project-config", {
    actionId: ACTION_SAVE_PROJECT_CONFIG,
    body: projectConfigInputValidator,
    buildInput: routes.requestBody,
    summary: "Save the Vibe64 project configuration."
  });
}

export { registerRoutes };
