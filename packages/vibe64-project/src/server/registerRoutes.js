import {
  adapterSettingsActionInputValidator,
  adapterSettingsActionParamsValidator,
  adapterSettingsActionStepParamsValidator,
  adapterSettingsComponentInputValidator,
  adapterSettingsComponentParamsValidator,
  adapterSettingsComponentReadInputValidator,
  projectConfigInputValidator,
  projectConfigReadInputValidator,
  projectCreateInputValidator,
  projectEnvMaterializeInputValidator,
  projectEnvReadInputValidator,
  projectEnvUserValuesInputValidator,
  projectSelectInputValidator,
  projectTypeInputValidator,
  projectTypeReadInputValidator
} from "./inputSchemas.js";
import {
  ACTION_CREATE_PROJECT,
  ACTION_LIST_PROJECTS,
  ACTION_LIST_PROJECT_TOOLS,
  ACTION_MATERIALIZE_ENV,
  ACTION_READ_PROJECT_CONFIG,
  ACTION_READ_PROJECT_CONFIG_DEFAULTS,
  ACTION_READ_PROJECT_TYPE,
  ACTION_READ_ENV,
  ACTION_SELECT_PROJECT,
  ACTION_SAVE_PROJECT_CONFIG,
  ACTION_SAVE_ENV_USER_VALUES,
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
    buildInput: routes.requestQuery,
    query: projectConfigReadInputValidator,
    summary: "List Vibe64 project tools."
  });

  routes.actionRoute("GET", "/project-type", {
    actionId: ACTION_READ_PROJECT_TYPE,
    buildInput: routes.requestQuery,
    query: projectTypeReadInputValidator,
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
    buildInput: routes.requestQuery,
    query: projectConfigReadInputValidator,
    summary: "Read the Vibe64 project configuration."
  });

  routes.actionRoute("GET", "/project-config/defaults", {
    actionId: ACTION_READ_PROJECT_CONFIG_DEFAULTS,
    buildInput: routes.requestQuery,
    query: projectConfigReadInputValidator,
    summary: "Read default Vibe64 project configuration values."
  });

  routes.actionRoute("PUT", "/project-config", {
    actionId: ACTION_SAVE_PROJECT_CONFIG,
    body: projectConfigInputValidator,
    buildInput: routes.requestBody,
    summary: "Save the Vibe64 project configuration."
  });

  routes.serviceRoute("GET", "/adapter-settings", {
    query: projectConfigReadInputValidator,
    summary: "Read adapter-owned Vibe64 project settings."
  }, (request) => service(app).readAdapterSettings(withVibe64User(request, routes.requestQuery(request))));

  routes.serviceRoute("GET", "/adapter-settings/components/:componentId", {
    params: adapterSettingsComponentParamsValidator,
    query: adapterSettingsComponentReadInputValidator,
    summary: "Read an adapter-owned settings component."
  }, (request) => service(app).readAdapterSettingsComponent(
    request.params?.componentId,
    withVibe64User(request, routes.requestQuery(request))
  ));

  routes.serviceRoute("POST", "/adapter-settings/components/:componentId/connect", {
    body: adapterSettingsComponentInputValidator,
    bodyLimit: 1024 * 32,
    params: adapterSettingsComponentParamsValidator,
    summary: "Connect an adapter-owned settings component."
  }, (request) => service(app).runAdapterSettingsComponentOperation(
    request.params?.componentId,
    "connect",
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("POST", "/adapter-settings/components/:componentId/setup", {
    body: adapterSettingsComponentInputValidator,
    bodyLimit: 1024 * 32,
    params: adapterSettingsComponentParamsValidator,
    summary: "Run adapter-owned settings component setup."
  }, (request) => service(app).runAdapterSettingsComponentOperation(
    request.params?.componentId,
    "setup",
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("POST", "/adapter-settings/components/:componentId/sync", {
    body: adapterSettingsComponentInputValidator,
    params: adapterSettingsComponentParamsValidator,
    summary: "Sync an adapter-owned settings component."
  }, (request) => service(app).runAdapterSettingsComponentOperation(
    request.params?.componentId,
    "sync",
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("POST", "/adapter-settings/components/:componentId/smtp-login", {
    body: adapterSettingsComponentInputValidator,
    bodyLimit: 1024 * 16,
    params: adapterSettingsComponentParamsValidator,
    summary: "Save SMTP login for an adapter-owned settings component."
  }, (request) => service(app).runAdapterSettingsComponentOperation(
    request.params?.componentId,
    "smtp-login",
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("POST", "/adapter-settings/components/:componentId/smtp-login/disconnect", {
    body: adapterSettingsComponentInputValidator,
    params: adapterSettingsComponentParamsValidator,
    summary: "Remove SMTP login from an adapter-owned settings component."
  }, (request) => service(app).runAdapterSettingsComponentOperation(
    request.params?.componentId,
    "smtp-login/disconnect",
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("POST", "/adapter-settings/components/:componentId/disconnect", {
    body: adapterSettingsComponentInputValidator,
    params: adapterSettingsComponentParamsValidator,
    summary: "Disconnect an adapter-owned settings component."
  }, (request) => service(app).runAdapterSettingsComponentOperation(
    request.params?.componentId,
    "disconnect",
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("GET", "/adapter-settings/actions/:actionId/status", {
    params: adapterSettingsActionParamsValidator,
    query: projectConfigReadInputValidator,
    summary: "Read an adapter-owned settings action status."
  }, (request) => service(app).adapterSettingsActionStatus(
    request.params?.actionId,
    withVibe64User(request, routes.requestQuery(request))
  ));

  routes.serviceRoute("POST", "/adapter-settings/actions/:actionId/start", {
    body: adapterSettingsActionInputValidator,
    params: adapterSettingsActionParamsValidator,
    summary: "Start an adapter-owned settings action."
  }, (request) => service(app).startAdapterSettingsAction(
    request.params?.actionId,
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("POST", "/adapter-settings/actions/:actionId/steps/:stepId", {
    body: adapterSettingsActionInputValidator,
    params: adapterSettingsActionStepParamsValidator,
    summary: "Submit an adapter-owned settings action step."
  }, (request) => service(app).submitAdapterSettingsAction(
    request.params?.actionId,
    request.params?.stepId,
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.serviceRoute("POST", "/adapter-settings/actions/:actionId/cancel", {
    body: adapterSettingsActionInputValidator,
    params: adapterSettingsActionParamsValidator,
    summary: "Cancel an adapter-owned settings action."
  }, (request) => service(app).cancelAdapterSettingsAction(
    request.params?.actionId,
    withVibe64User(request, routes.requestBody(request))
  ));

  routes.actionRoute("GET", "/env", {
    actionId: ACTION_READ_ENV,
    buildInput: routes.requestQuery,
    query: projectEnvReadInputValidator,
    summary: "Read the Vibe64 Env view model."
  });

  routes.actionRoute("PUT", "/env/user-values", {
    actionId: ACTION_SAVE_ENV_USER_VALUES,
    body: projectEnvUserValuesInputValidator,
    buildInput: routes.requestBody,
    summary: "Save user-owned Vibe64 Env values."
  });

  routes.actionRoute("POST", "/env/materialize", {
    actionId: ACTION_MATERIALIZE_ENV,
    body: projectEnvMaterializeInputValidator,
    buildInput: routes.requestBody,
    summary: "Regenerate local Env files."
  });
}

function service(app) {
  return app.make("feature.vibe64-project.service");
}

function withVibe64User(request, input = {}) {
  if (!request.vibe64User) {
    return {
      ...input
    };
  }
  return {
    ...input,
    vibe64User: request.vibe64User
  };
}

export { registerRoutes };
