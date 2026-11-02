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
import {
  ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
  ACTION_LIST_AI_CONNECTIONS,
  ACTION_LOGOUT_ACCOUNT,
  ACTION_PREVIEW_MODEL_ROUTING,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_READ_ACCOUNTS,
  ACTION_READ_AI_CONNECTION_CATALOG,
  ACTION_READ_CODEX_PROVIDERS,
  ACTION_READ_MODEL_ROUTING,
  ACTION_REMOVE_AI_CONNECTION,
  ACTION_REMOVE_CODEX_PROVIDER,
  ACTION_SAVE_AI_CONNECTION,
  ACTION_SAVE_AI_CONNECTION_MODEL_ACCESS,
  ACTION_SAVE_CODEX_PROVIDER,
  ACTION_SAVE_GIT_IDENTITY,
  ACTION_SAVE_MODEL_ROUTING,
  ACTION_SAVE_PERSONAL_AI_PROFILE,
  ACTION_START_ACCOUNT_AUTH
} from "./accountsActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {ReturnType<typeof createActionRouteScope>} AccountRouteScope */
/** @typedef {import("./types.js").StudioProjectContext} StudioProjectContext */

const ACCOUNT_ROUTE_TAGS = Object.freeze(["studio", "vibe64-accounts"]);
const LOCAL_REQUEST_MESSAGE = "Vibe64 account routes only accept loopback Studio requests.";

/**
 * Accounts are reached both inside a project and outside any project, so every account route is registered in both
 * scopes.
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 * @param {StudioProjectContext} options.projectContext resolves the project of a project-scoped request
 */
function createAccountRouteScopes(http, { localhostCheckBypassed, projectContext }) {
  return Object.freeze({
    projectRoutes: createActionRouteScope(vibe64RouteHttp(http, { tags: ACCOUNT_ROUTE_TAGS }), {
      routeBase: VIBE64_PROJECT_ROUTE_BASE,
      relativePath: "vibe64/accounts",
      surface: "app",
      wrapHandler: vibe64RouteHandler({ localhostCheckBypassed, localRequestMessage: LOCAL_REQUEST_MESSAGE, projectContext })
    }),
    workspaceRoutes: createActionRouteScope(vibe64RouteHttp(http, { tags: ACCOUNT_ROUTE_TAGS }), {
      relativePath: "vibe64/accounts",
      surface: "app",
      wrapHandler: vibe64RouteHandler({ localhostCheckBypassed, localRequestMessage: LOCAL_REQUEST_MESSAGE, projectScoped: false })
    })
  });
}

/**
 * @param {object} request
 */
function authSessionInput(request) {
  return {
    sessionId: request.params.sessionId
  };
}

/**
 * The account routes of one scope.
 * @param {AccountRouteScope} routes
 */
function registerAccountRoutes(routes) {
  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_ACCOUNTS,
    buildInput: requestQuery,
    query: accountsReadInputValidator,
    summary: "Read Vibe64 account readiness."
  });
  routes.actionRoute("GET", "/codex-providers", {
    actionId: ACTION_READ_CODEX_PROVIDERS,
    summary: "Read curated Codex provider connections."
  });
  routes.actionRoute("PATCH", "/codex-providers", {
    actionId: ACTION_SAVE_CODEX_PROVIDER,
    body: codexProviderInputValidator,
    buildInput: requestBody,
    summary: "Check and connect a curated Codex provider."
  });
  routes.actionRoute("POST", "/codex-providers/remove", {
    actionId: ACTION_REMOVE_CODEX_PROVIDER,
    body: codexProviderInputValidator,
    buildInput: requestBody,
    summary: "Disconnect a curated Codex provider."
  });
  routes.actionRoute("GET", "/model-routing", {
    actionId: ACTION_READ_MODEL_ROUTING,
    buildInput: requestQuery,
    query: modelRoutingReadInputValidator,
    summary: "Read model roles, availability, and recommendations."
  });
  routes.actionRoute("PATCH", "/model-routing", {
    actionId: ACTION_SAVE_MODEL_ROUTING,
    body: modelRoutingInputValidator,
    buildInput: requestBody,
    summary: "Save the workspace's owner and team AI setups."
  });
  routes.actionRoute("POST", "/model-routing/preview", {
    actionId: ACTION_PREVIEW_MODEL_ROUTING,
    body: modelRoutingInputValidator,
    buildInput: requestBody,
    summary: "Preview the owner and team AI setups without saving or running AI."
  });
  routes.actionRoute("POST", "/auth", {
    actionId: ACTION_START_ACCOUNT_AUTH,
    body: accountAuthStartInputValidator,
    buildInput: requestBody,
    summary: "Start an Vibe64 account login flow."
  });
  routes.actionRoute("POST", "/logout", {
    actionId: ACTION_LOGOUT_ACCOUNT,
    body: accountIdInputValidator,
    buildInput: requestBody,
    summary: "Log out an Vibe64 account."
  });
  routes.actionRoute("POST", "/git-identity", {
    actionId: ACTION_SAVE_GIT_IDENTITY,
    body: gitIdentityInputValidator,
    buildInput: requestBody,
    summary: "Save the Git identity used for Vibe64 GitHub operations."
  });
  routes.actionRoute("PATCH", "/personal-ai-profile", {
    actionId: ACTION_SAVE_PERSONAL_AI_PROFILE,
    body: personalAiProfileInputValidator,
    buildInput: requestBody,
    summary: "Save the standalone Vibe64 personal AI profile."
  });
  routes.actionRoute("GET", "/auth/:sessionId", {
    actionId: ACTION_READ_ACCOUNT_AUTH_SESSION,
    buildInput: authSessionInput,
    params: accountAuthSessionParamsValidator,
    summary: "Read an Vibe64 account login session."
  });
  routes.actionRoute("DELETE", "/auth/:sessionId", {
    actionId: ACTION_CANCEL_ACCOUNT_AUTH_SESSION,
    buildInput: authSessionInput,
    params: accountAuthSessionParamsValidator,
    summary: "Cancel an Vibe64 account login session."
  });
}

/**
 * The account routes, in the project scope and outside any project.
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 * @param {StudioProjectContext} options.projectContext
 */
function registerRoutes(http, options) {
  const { projectRoutes, workspaceRoutes } = createAccountRouteScopes(http, options);
  registerAccountRoutes(projectRoutes);
  registerAccountRoutes(workspaceRoutes);
}

/**
 * Runs an AI connection action with only the request values its input declares, and the provider from the path.
 * @param {object} request
 * @param {string} actionId
 * @param {object} validator the action's input validator
 * @param {object} [values] the request's query or body
 */
function runAiConnectionAction(request, actionId, validator, values) {
  const source = values || {};
  const fields = Object.keys(validator.schema.getFieldDefinitions());
  return request.executeAction({
    actionId,
    input: {
      ...Object.fromEntries(fields.filter((field) => Object.hasOwn(source, field)).map((field) => [field, source[field]])),
      ...(request.params?.providerId ? { modelProviderId: request.params.providerId } : {})
    }
  });
}

/**
 * The AI connection routes, for a host to serve under its own scope and checks: register(method, suffix, handler) adds
 * one route, whose handler reads the request's query, body and params and runs its action.
 * @param {(method: string, suffix: string, handler: (request: object) => Promise<object>) => void} register
 */
function registerAiConnectionRoutes(register) {
  register("GET", "", (request) =>
    runAiConnectionAction(request, ACTION_LIST_AI_CONNECTIONS, aiConnectionInputValidators.list, request.query));
  register("GET", "/catalog", (request) =>
    runAiConnectionAction(request, ACTION_READ_AI_CONNECTION_CATALOG, aiConnectionInputValidators.catalog, request.query));
  register("PATCH", "/:providerId", (request) =>
    runAiConnectionAction(request, ACTION_SAVE_AI_CONNECTION, aiConnectionInputValidators.save, request.body));
  register("POST", "/:providerId/remove", (request) =>
    runAiConnectionAction(request, ACTION_REMOVE_AI_CONNECTION, aiConnectionInputValidators.remove, request.body));
  register("PATCH", "/:providerId/model-access", (request) =>
    runAiConnectionAction(request, ACTION_SAVE_AI_CONNECTION_MODEL_ACCESS, aiConnectionInputValidators.modelAccess, request.body));
}

/**
 * One scope's AI connection routes, under /ai-connections. A failure is answered as JSON with its status, field errors
 * included, rather than thrown.
 * @param {AccountRouteScope} routes
 */
function registerScopeAiConnectionRoutes(routes) {
  registerAiConnectionRoutes(function serveAiConnectionRoute(method, suffix, handler) {
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

/**
 * The local runtime's AI connection routes, in the project scope and outside any project.
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 * @param {StudioProjectContext} options.projectContext
 */
function registerLocalAiConnectionRoutes(http, options) {
  const { projectRoutes, workspaceRoutes } = createAccountRouteScopes(http, options);
  registerScopeAiConnectionRoutes(projectRoutes);
  registerScopeAiConnectionRoutes(workspaceRoutes);
}

export { registerAiConnectionRoutes, registerLocalAiConnectionRoutes, registerRoutes };
