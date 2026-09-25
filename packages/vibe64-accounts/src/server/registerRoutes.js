import {
  ACTION_READ_MODEL_ROUTING, ACTION_READ_MODEL_ROUTING_WORKFLOWS, ACTION_SAVE_MODEL_ROUTING, ACTION_PREVIEW_MODEL_ROUTING,
  ACTION_READ_CODEX_PROVIDERS, ACTION_SAVE_CODEX_PROVIDER, ACTION_REMOVE_CODEX_PROVIDER,
  ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
  ACTION_LOGOUT_ACCOUNT,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_SAVE_GIT_IDENTITY,
  ACTION_SAVE_PERSONAL_AI_PROFILE,
  ACTION_START_ACCOUNT_AUTH
} from "./actions.js";
import {
  modelRoutingInputValidator,
  codexProviderInputValidator,
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

const retiredHelperModelResponse = Object.freeze({
  ok: false,
  statusCode: 410,
  code: "vibe64_helper_model_retired",
  error: "Helper settings have moved to Model routing. Reload the app and choose Economy there."
});

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

  routes.actionRoute("GET", "/model-routing/workflows", {
    actionId: ACTION_READ_MODEL_ROUTING_WORKFLOWS,
    buildInput: (request) => withVibe64User(request),
    summary: "Read saved workflows and connection access without model discovery."
  });
  routes.actionRoute("GET", "/model-routing", {
    actionId: ACTION_READ_MODEL_ROUTING,
    buildInput: (request) => withVibe64User(request),
    summary: "Read model roles, availability, and recommendations."
  });
  routes.actionRoute("PATCH", "/model-routing", {
    actionId: ACTION_SAVE_MODEL_ROUTING, body: modelRoutingInputValidator,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Save the workspace's model routing assignments."
  });
  routes.actionRoute("POST", "/model-routing/preview", {
    actionId: ACTION_PREVIEW_MODEL_ROUTING, body: modelRoutingInputValidator,
    buildInput: (request) => withVibe64User(request, routes.requestBody(request)),
    summary: "Preview owner and collaborator routing without saving or running AI."
  });
  for (const method of ["GET", "PATCH"]) {
    routes.serviceRoute(method, "/helper-model", {
      summary: "Direct older clients to Model routing."
    }, async () => retiredHelperModelResponse);
  }
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
  for (const method of ["GET", "PATCH"]) {
    register(method, "/:providerId/helper-model", () => {
      throw Object.assign(new Error(retiredHelperModelResponse.error), {
        code: retiredHelperModelResponse.code, statusCode: retiredHelperModelResponse.statusCode
      });
    });
  }
  for (const [method, suffix, operation] of [
    ["GET", "", "list"],
    ["GET", "/catalog", "catalog"],
    ["PATCH", "/:providerId", "save"],
    ["POST", "/:providerId/remove", "remove"],
    ["PATCH", "/:providerId/model-access", "modelAccess"]
  ]) {
    register(method, suffix, (request, vibe64User) => service[operation]({
      ...(method === "GET" ? (operation === "catalog" ? request.query : {}) : request.body),
      ...(request.params?.providerId ? { modelProviderId: request.params.providerId } : {}),
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
  const safeInput = { ...input };
  delete safeInput.vibe64User;
  if (!request.vibe64User) {
    return safeInput;
  }
  return {
    ...safeInput,
    vibe64User: request.vibe64User
  };
}

export { registerRoutes, registerAiConnectionRoutes };
