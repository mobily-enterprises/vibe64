import {
  projectConfigInputValidator,
  projectTypeInputValidator
} from "./inputSchemas.js";
import {
  ACTION_READ_PROJECT_CONFIG,
  ACTION_READ_PROJECT_CONFIG_DEFAULTS,
  ACTION_READ_PROJECT_TYPE,
  ACTION_SAVE_PROJECT_CONFIG,
  ACTION_SAVE_PROJECT_TYPE
} from "./actions.js";
import { createAiStudioFeatureRoutes } from "@local/ai-studio-core/server/featureRoutes";

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createAiStudioFeatureRoutes(app, {
    localRequestMessage: "AI Studio project routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
    tags: ["studio", "ai-studio-project"]
  });

  routes.actionRoute("GET", "/project-type", {
    actionId: ACTION_READ_PROJECT_TYPE,
    summary: "Read the AI Studio project type."
  });

  routes.actionRoute("PUT", "/project-type", {
    actionId: ACTION_SAVE_PROJECT_TYPE,
    body: projectTypeInputValidator,
    buildInput: routes.requestBody,
    summary: "Set the AI Studio project type."
  });

  routes.actionRoute("GET", "/project-config", {
    actionId: ACTION_READ_PROJECT_CONFIG,
    summary: "Read the AI Studio project configuration."
  });

  routes.actionRoute("GET", "/project-config/defaults", {
    actionId: ACTION_READ_PROJECT_CONFIG_DEFAULTS,
    summary: "Read default AI Studio project configuration values."
  });

  routes.actionRoute("PUT", "/project-config", {
    actionId: ACTION_SAVE_PROJECT_CONFIG,
    body: projectConfigInputValidator,
    buildInput: routes.requestBody,
    summary: "Save the AI Studio project configuration."
  });
}

export { registerRoutes };
