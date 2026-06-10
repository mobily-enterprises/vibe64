import {
  projectConfigInputValidator,
  projectConfigReadInputValidator,
  projectCreateInputValidator,
  projectSelectInputValidator,
  projectTypeInputValidator
} from "./inputSchemas.js";
import {
  ACTION_CREATE_PROJECT,
  ACTION_LIST_PROJECTS,
  ACTION_LIST_PROJECT_TOOLS,
  ACTION_READ_PROJECT_CONFIG,
  ACTION_READ_PROJECT_CONFIG_DEFAULTS,
  ACTION_READ_PROJECT_TYPE,
  ACTION_SELECT_PROJECT,
  ACTION_SAVE_PROJECT_CONFIG,
  ACTION_SAVE_PROJECT_TYPE
} from "./actions.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(
  app,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 project routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-project"]
  });

  routes.actionRoute("GET", "/projects", {
    actionId: ACTION_LIST_PROJECTS,
    summary: "List selectable Vibe64 projects."
  });

  routes.actionRoute("POST", "/projects", {
    actionId: ACTION_CREATE_PROJECT,
    body: projectCreateInputValidator,
    buildInput: routes.requestBody,
    summary: "Create and select a Vibe64 project."
  });

  routes.actionRoute("POST", "/projects/select", {
    actionId: ACTION_SELECT_PROJECT,
    body: projectSelectInputValidator,
    buildInput: routes.requestBody,
    summary: "Select an existing Vibe64 project."
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
    buildInput: queryInput,
    query: projectConfigReadInputValidator,
    summary: "Read the Vibe64 project configuration."
  });

  routes.actionRoute("GET", "/project-config/defaults", {
    actionId: ACTION_READ_PROJECT_CONFIG_DEFAULTS,
    buildInput: queryInput,
    query: projectConfigReadInputValidator,
    summary: "Read default Vibe64 project configuration values."
  });

  routes.actionRoute("PUT", "/project-config", {
    actionId: ACTION_SAVE_PROJECT_CONFIG,
    body: projectConfigInputValidator,
    buildInput: routes.requestBody,
    summary: "Save the Vibe64 project configuration."
  });
}

function queryInput(request) {
  return request.input.query || {};
}

export { registerRoutes };
