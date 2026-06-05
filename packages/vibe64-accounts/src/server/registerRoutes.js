import {
  ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
  ACTION_LOGOUT_ACCOUNT,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_START_ACCOUNT_AUTH
} from "./actions.js";
import {
  accountIdInputValidator,
  accountAuthSessionInputValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator
} from "./inputSchemas.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

function registerRoutes(
  app,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = "",
    workspaceScoped = true
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 account routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    workspaceScoped,
    tags: ["studio", "vibe64-accounts"]
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_ACCOUNTS,
    buildInput: queryInput,
    query: accountsReadInputValidator,
    summary: "Read Vibe64 account readiness."
  });

  routes.actionRoute("POST", "/auth", {
    actionId: ACTION_START_ACCOUNT_AUTH,
    body: accountAuthStartInputValidator,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Start an Vibe64 account login flow."
  });

  routes.actionRoute("POST", "/logout", {
    actionId: ACTION_LOGOUT_ACCOUNT,
    body: accountIdInputValidator,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Log out an Vibe64 account."
  });

  routes.actionRoute("GET", "/auth/:sessionId", {
    actionId: ACTION_READ_ACCOUNT_AUTH_SESSION,
    buildInput: sessionInput,
    params: accountAuthSessionInputValidator,
    summary: "Read an Vibe64 account login session."
  });

  routes.actionRoute("DELETE", "/auth/:sessionId", {
    actionId: ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
    buildInput: sessionInput,
    params: accountAuthSessionInputValidator,
    summary: "Cancel an Vibe64 account login session."
  });
}

function queryInput(request) {
  return withVibe64User(request, request.input.query || {});
}

function sessionInput(request) {
  return withVibe64User(request, {
    sessionId: request.params.sessionId
  });
}

function withVibe64User(request, input = {}) {
  return {
    ...input,
    vibe64User: request.vibe64User || null
  };
}

export { registerRoutes };
