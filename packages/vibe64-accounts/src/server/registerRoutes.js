import {
  aiConnectionInputValidators,
  modelRoutingInputValidator,
  modelRoutingReadInputValidator,
  codexProviderInputValidator,
  accountIdInputValidator,
  accountAuthSessionParamsValidator,
  accountAuthStartInputValidator,
  accountsReadInputValidator,
  gitIdentityInputValidator,
  personalAiProfileInputValidator
} from "./inputSchemas.js";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { vibe64ErrorResponse } from "@local/vibe64-core/server/serverResponses";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";

const ACCOUNT_ROUTE_TAGS = Object.freeze(["studio", "vibe64-accounts"]);
const LOCAL_REQUEST_MESSAGE = "Vibe64 account routes only accept loopback Studio requests.";

// Accounts are reached both inside a project and outside any project, so every
// route is registered under both scopes.
function registerRoutes(
  http,
  {
    accounts = null,
    aiConnectionService = null,
    fastify = null,
    projectContext = null
  } = {}
) {
  if (!accounts || typeof accounts.subscribeAuthTerminal !== "function") {
    throw new TypeError("registerRoutes requires the Vibe64 Accounts API.");
  }

  const projectRoutes = createActionRouteScope(vibe64RouteHttp(http, { tags: ACCOUNT_ROUTE_TAGS }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64/accounts",
    surface: "app",
    wrapHandler: vibe64RouteHandler({ localRequestMessage: LOCAL_REQUEST_MESSAGE, projectContext })
  });
  const workspaceRoutes = createActionRouteScope(vibe64RouteHttp(http, { tags: ACCOUNT_ROUTE_TAGS }), {
    relativePath: "vibe64/accounts",
    surface: "app",
    wrapHandler: vibe64RouteHandler({ localRequestMessage: LOCAL_REQUEST_MESSAGE, projectScoped: false })
  });

  const bodyInput = (request) => withoutVibe64User(requestBody(request));
  const queryInput = (request) => withoutVibe64User(requestQuery(request));
  const operationOptions = {
    read: { buildInput: queryInput, query: accountsReadInputValidator,
      summary: "Read Vibe64 account readiness." },
    "codex-providers.read": { buildInput: () => withoutVibe64User(),
      summary: "Read curated Codex provider connections." },
    "codex-providers.save": { body: codexProviderInputValidator, buildInput: bodyInput,
      summary: "Check and connect a curated Codex provider." },
    "codex-providers.remove": { body: codexProviderInputValidator, buildInput: bodyInput,
      summary: "Disconnect a curated Codex provider." },
    "model-routing.read": { query: modelRoutingReadInputValidator, buildInput: queryInput,
      summary: "Read model roles, availability, and recommendations." },
    "model-routing.save": { body: modelRoutingInputValidator, buildInput: bodyInput,
      summary: "Save the workspace's owner and team AI setups." },
    "model-routing.preview": { body: modelRoutingInputValidator, buildInput: bodyInput,
      summary: "Preview the owner and team AI setups without saving or running AI." },
    "auth.start": { body: accountAuthStartInputValidator, buildInput: bodyInput,
      summary: "Start an Vibe64 account login flow." },
    logout: { body: accountIdInputValidator, buildInput: bodyInput,
      summary: "Log out an Vibe64 account." },
    "git-identity.save": { body: gitIdentityInputValidator, buildInput: bodyInput,
      summary: "Save the Git identity used for Vibe64 GitHub operations." },
    "personal-ai-profile.save": { body: personalAiProfileInputValidator, buildInput: bodyInput,
      summary: "Save the standalone Vibe64 personal AI profile." },
    "auth-session.read": { buildInput: sessionInput, params: accountAuthSessionParamsValidator,
      summary: "Read an Vibe64 account login session." },
    "auth-session.cancel": { buildInput: sessionInput, params: accountAuthSessionParamsValidator,
      summary: "Cancel an Vibe64 account login session." }
  };
  for (const [method, suffix, operation] of [
    ["GET", "", "read"],
    ["GET", "/codex-providers", "codex-providers.read"],
    ["PATCH", "/codex-providers", "codex-providers.save"],
    ["POST", "/codex-providers/remove", "codex-providers.remove"],
    ["GET", "/model-routing", "model-routing.read"],
    ["PATCH", "/model-routing", "model-routing.save"],
    ["POST", "/model-routing/preview", "model-routing.preview"],
    ["POST", "/auth", "auth.start"],
    ["POST", "/logout", "logout"],
    ["POST", "/git-identity", "git-identity.save"],
    ["PATCH", "/personal-ai-profile", "personal-ai-profile.save"],
    ["GET", "/auth/:sessionId", "auth-session.read"],
    ["DELETE", "/auth/:sessionId", "auth-session.cancel"]
  ]) {
    projectRoutes.actionRoute(method, suffix, { ...operationOptions[operation], actionId: `vibe64.accounts.${operation}` });
    workspaceRoutes.actionRoute(method, suffix, { ...operationOptions[operation], actionId: `vibe64.accounts.${operation}` });
  }

  for (const [routes, projectScoped] of [[projectRoutes, true], [workspaceRoutes, false]]) {
    if (aiConnectionService) {
      registerAiConnectionRoutes((method, suffix, handler) => {
        routes.serviceRoute(method, `/ai-connections${suffix}`, {
          summary: "Manage AI provider connections."
        }, async (request) => {
          try {
            return await handler({
              body: requestBody(request),
              query: requestQuery(request),
              params: request.params,
              executeAction: request.executeAction
            });
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
}

function registerAiConnectionRoutes(register) {
  for (const [method, suffix, operation] of [
    ["GET", "", "list"],
    ["GET", "/catalog", "catalog"],
    ["PATCH", "/:providerId", "save"],
    ["POST", "/:providerId/remove", "remove"],
    ["PATCH", "/:providerId/model-access", "modelAccess"]
  ]) {
    const fields = Object.keys(aiConnectionInputValidators[operation].schema.getFieldDefinitions());
    register(method, suffix, (request) => {
      const source = method === "GET" ? request.query || {} : request.body || {};
      return request.executeAction({
        actionId: `vibe64.accounts.ai-connections.${operation}`,
        input: {
          ...Object.fromEntries(fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]])),
          ...(request.params?.providerId ? { modelProviderId: request.params.providerId } : {})
        }
      });
    });
  }
}

function sessionInput(request) {
  return withoutVibe64User({
    sessionId: request.params.sessionId
  });
}

function withoutVibe64User(input = {}) {
  const { vibe64User: _ignored, ...safeInput } = input || {};
  void _ignored;
  return safeInput;
}

function withVibe64User(request, input = {}) {
  const safeInput = withoutVibe64User(input);
  if (!request.vibe64User) {
    return safeInput;
  }
  return {
    ...safeInput,
    vibe64User: request.vibe64User
  };
}

export { registerRoutes, registerAiConnectionRoutes };
