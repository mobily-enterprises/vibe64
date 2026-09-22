import {
  ACTION_READ_CODEX_PROVIDERS, ACTION_SAVE_CODEX_PROVIDER, ACTION_REMOVE_CODEX_PROVIDER,
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
  codexProviderInputValidator,
  helperModelInputValidator,
  accountIdInputValidator,
  accountAuthSessionParamsValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  gitIdentityInputValidator,
  personalAiProfileInputValidator
} from "./inputSchemas.js";
import { vibe64ErrorResponse } from "@local/vibe64-core/server/serverResponses";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";

function registerRoutes(
  http,
  {
    accounts = null,
    aiConnectionService = null,
    requireAiManagement = () => null,
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

  if (aiConnectionService) {
    registerAiConnectionRoutes(aiConnectionService, (method, suffix, handler) => {
      routes.serviceRoute(method, `/ai-connections${suffix}`, {
        summary: "Manage AI provider connections."
      }, async (request) => {
        const vibe64User = request.vibe64User || null;
        const denied = await requireAiManagement({ vibe64User });
        if (denied) return { ...denied, statusCode: 403 };
        try {
          return await handler({
            body: routes.requestBody(request),
            query: routes.requestQuery(request),
            params: request.params
          }, vibe64User);
        } catch (error) {
          return {
            ...vibe64ErrorResponse(error),
            statusCode: error.statusCode || 500,
            ...(error.fieldErrors ? { fieldErrors: error.fieldErrors } : {})
          };
        }
      });
    });
  }

  routes.actionRoute("GET", "/codex-providers", {
    actionId: ACTION_READ_CODEX_PROVIDERS,
    buildInput: (request) => withVibe64User(request),
    summary: "Read curated Codex provider connections."
  });
  routes.actionRoute("PATCH", "/codex-providers", {
    actionId: ACTION_SAVE_CODEX_PROVIDER, body: codexProviderInputValidator,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Check and connect a curated Codex provider."
  });
  routes.actionRoute("POST", "/codex-providers/remove", {
    actionId: ACTION_REMOVE_CODEX_PROVIDER, body: codexProviderInputValidator,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Disconnect a curated Codex provider."
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
    projectScoped,
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

function registerAiConnectionRoutes(service, register) {
  for (const [method, suffix, operation] of [
    ["GET", "", "list"],
    ["GET", "/catalog", "catalog"],
    ["PATCH", "/:providerId", "save"],
    ["POST", "/:providerId/remove", "remove"],
    ["GET", "/:providerId/helper-model", "helperModel"],
    ["PATCH", "/:providerId/helper-model", "helperModel"],
    ["PATCH", "/:providerId/model-access", "modelAccess"]
  ]) {
    register(method, suffix, (request, vibe64User) => service[operation]({
      ...(method === "GET" ? (operation === "catalog" ? request.query : {}) : request.body),
      ...(request.params?.providerId ? { modelProviderId: request.params.providerId } : {}),
      ...(method === "PATCH" && operation === "helperModel" ? { modelId: request.body?.modelId } : {}),
      vibe64User
    }));
  }
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

export { registerRoutes, registerAiConnectionRoutes };
