import {
  ACTION_READ_HELPER_MODEL,
  ACTION_SAVE_HELPER_MODEL,
  ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
  ACTION_LOGOUT_ACCOUNT,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_SAVE_GIT_IDENTITY,
  ACTION_SAVE_PERSONAL_AI_PROFILE,
  ACTION_START_ACCOUNT_AUTH
} from "./actions.js";
import {
  helperModelInputValidator,
  accountIdInputValidator,
  accountAuthSessionParamsValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  gitIdentityInputValidator,
  personalAiProfileInputValidator
} from "./inputSchemas.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";

function registerRoutes(
  http,
  {
    accounts = null,
    fastify = null,
    projectContext = null,
    routeSurface = "",
    routeRelativePath = "",
    projectScoped = true
  } = {}
) {
  if (!accounts || typeof accounts.subscribeAuthTerminal !== "function") {
    throw new TypeError("registerRoutes requires the Vibe64 Accounts API.");
  }

  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 account routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    projectScoped,
    tags: ["studio", "vibe64-accounts"]
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_ACCOUNTS,
    buildInput: (request) => queryInput(routes, request),
    query: accountsReadInputValidator,
    summary: "Read Vibe64 account readiness."
  });

  routes.actionRoute("GET", "/helper-model", {
    actionId: ACTION_READ_HELPER_MODEL,
    buildInput: (request) => withVibe64User(request, { providerId: request.query?.providerId || "codex" }),
    query: accountsReadInputValidator,
    summary: "Read the native assistant helper model preference and available models."
  });
  routes.actionRoute("PATCH", "/helper-model", {
    actionId: ACTION_SAVE_HELPER_MODEL,
    body: helperModelInputValidator,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Save the native assistant helper model preference."
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

  routes.actionRoute("POST", "/git-identity", {
    actionId: ACTION_SAVE_GIT_IDENTITY,
    body: gitIdentityInputValidator,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Save the Git identity used for Vibe64 GitHub operations."
  });

  routes.actionRoute("PATCH", "/personal-ai-profile", {
    actionId: ACTION_SAVE_PERSONAL_AI_PROFILE,
    body: personalAiProfileInputValidator,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Save the standalone Vibe64 personal AI profile."
  });

  routes.actionRoute("GET", "/auth/:sessionId", {
    actionId: ACTION_READ_ACCOUNT_AUTH_SESSION,
    buildInput: sessionInput,
    params: accountAuthSessionParamsValidator,
    summary: "Read an Vibe64 account login session."
  });

  routes.actionRoute("DELETE", "/auth/:sessionId", {
    actionId: ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
    buildInput: sessionInput,
    params: accountAuthSessionParamsValidator,
    summary: "Cancel an Vibe64 account login session."
  });

  registerTerminalWebSocketRoute(fastify, {
    projectContext,
    resize(service, { cols, request, rows, terminalSessionId }) {
      return service.resizeAuthTerminal(withVibe64User(request, {
        sessionId: terminalSessionId
      }), {
        cols,
        rows
      });
    },
    routePath: `${routes.routeBase}/auth/:terminalSessionId/ws`,
    service: accounts,
    subscribe(service, { request, subscriber, terminalSessionId }) {
      return service.subscribeAuthTerminal(withVibe64User(request, {
        sessionId: terminalSessionId
      }), subscriber);
    },
    write(service, { data, request, terminalSessionId }) {
      return service.writeAuthTerminal(withVibe64User(request, {
        sessionId: terminalSessionId
      }), data);
    }
  });
}

function queryInput(routes, request) {
  return withVibe64User(request, routes.requestQuery(request));
}

function sessionInput(request) {
  return withVibe64User(request, {
    sessionId: request.params.sessionId
  });
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
