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
import { createAiStudioFeatureRoutes } from "@local/ai-studio-core/server/featureRoutes";

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createAiStudioFeatureRoutes(app, {
    localRequestMessage: "AI Studio account routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
    tags: ["studio", "ai-studio-accounts"]
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_ACCOUNTS,
    buildInput: queryInput,
    query: accountsReadInputValidator,
    summary: "Read AI Studio account readiness."
  });

  routes.actionRoute("POST", "/auth", {
    actionId: ACTION_START_ACCOUNT_AUTH,
    body: accountAuthStartInputValidator,
    buildInput: routes.requestBody,
    summary: "Start an AI Studio account login flow."
  });

  routes.actionRoute("POST", "/logout", {
    actionId: ACTION_LOGOUT_ACCOUNT,
    body: accountIdInputValidator,
    buildInput: routes.requestBody,
    summary: "Log out an AI Studio account."
  });

  routes.actionRoute("GET", "/auth/:sessionId", {
    actionId: ACTION_READ_ACCOUNT_AUTH_SESSION,
    buildInput: sessionInput,
    params: accountAuthSessionInputValidator,
    summary: "Read an AI Studio account login session."
  });

  routes.actionRoute("DELETE", "/auth/:sessionId", {
    actionId: ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
    buildInput: sessionInput,
    params: accountAuthSessionInputValidator,
    summary: "Cancel an AI Studio account login session."
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
