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
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 account routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
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
    buildInput: routes.requestBody,
    summary: "Start an Vibe64 account login flow."
  });

  routes.actionRoute("POST", "/logout", {
    actionId: ACTION_LOGOUT_ACCOUNT,
    body: accountIdInputValidator,
    buildInput: routes.requestBody,
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
  return request.input.query || {};
}

function sessionInput(request) {
  return {
    sessionId: request.params.sessionId
  };
}

export { registerRoutes };
