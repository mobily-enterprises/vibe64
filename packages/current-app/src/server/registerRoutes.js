import {
  currentAppQueryInputValidator,
  targetScriptTerminalInputValidator,
  starredTargetScriptsInputValidator
} from "./inputSchemas.js";
import {
  ACTION_LIST_TARGET_SCRIPTS,
  ACTION_READ_CAPABILITIES,
  ACTION_READ_CURRENT_APP,
  ACTION_READ_SETUP_READINESS,
  ACTION_RESET_STARRED_TARGET_SCRIPTS,
  ACTION_SAVE_STARRED_TARGET_SCRIPTS
} from "./actions.js";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";
import { sendDoctorEventStream } from "@local/setup-doctor-core/server/doctorStream";

const CURRENT_APP_SERVICE = "feature.current-app.service";

function getCurrentAppService(app) {
  return app.make("feature.current-app.service");
}

function registerRoutes(
  app,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Current-app Studio routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "current-app"]
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_CURRENT_APP,
    buildInput: (request) => queryInput(routes, request),
    query: currentAppQueryInputValidator,
    summary: "Inspect the current app."
  });

  routes.actionRoute("GET", "/capabilities", {
    actionId: ACTION_READ_CAPABILITIES,
    buildInput: withVibe64User,
    summary: "Read Studio capability state for the current app."
  });

  routes.actionRoute("GET", "/target-scripts", {
    actionId: ACTION_LIST_TARGET_SCRIPTS,
    buildInput: (request) => queryInput(routes, request),
    statusCode: 200,
    summary: "List target scripts for the current app."
  });

  routes.actionRoute("GET", "/setup-readiness", {
    actionId: ACTION_READ_SETUP_READINESS,
    buildInput: withVibe64User,
    summary: "Read Vibe64 setup readiness for protected current-app routes."
  });

  routes.serviceRoute("GET", "/setup-readiness/stream", {
    summary: "Stream Vibe64 setup readiness for protected current-app routes."
  }, async (request, reply) => {
    await sendDoctorEventStream(reply, ({ emit }) => {
      return getCurrentAppService(app).streamSetupReadiness({
        emit,
        vibe64User: request.vibe64User || null
      });
    });
  });

  routes.actionRoute("PUT", "/target-scripts/starred", {
    actionId: ACTION_SAVE_STARRED_TARGET_SCRIPTS,
    body: starredTargetScriptsInputValidator,
    buildInput: (request) => bodyAndQueryInput(routes, request),
    summary: "Persist starred target script shortcuts for the current app."
  });

  routes.actionRoute("DELETE", "/target-scripts/starred", {
    actionId: ACTION_RESET_STARRED_TARGET_SCRIPTS,
    buildInput: (request) => queryInput(routes, request),
    summary: "Reset starred target script shortcuts to the default set."
  });

  routes.serviceRoute("POST", "/target-script-terminal", {
    body: targetScriptTerminalInputValidator,
    summary: "Start a target script terminal for the current app."
  }, (request) => {
    return getCurrentAppService(app).startTargetScriptTerminal(
      bodyAndQueryInput(routes, request)
    );
  });

  routes.serviceRoute("DELETE", "/target-script-terminal/:terminalSessionId", {
    statusCode: 200,
    summary: "Close a target script terminal for the current app."
  }, (request) => {
    return getCurrentAppService(app).closeTargetScriptTerminal(
      request.params.terminalSessionId
    );
  });

  registerTargetScriptTerminalWebSocketRoute(app, routes, {
    projectContext
  });
}

function queryInput(routes, request) {
  return withVibe64User(request, routes.requestQuery(request));
}

function bodyAndQueryInput(routes, request) {
  return withVibe64User(request, {
    ...routes.requestQuery(request),
    ...routes.requestBody(request)
  });
}

function withVibe64User(request, input = {}) {
  const vibe64User = request.vibe64User || null;
  if (!vibe64User) {
    return {
      ...input
    };
  }
  return {
    ...input,
    vibe64User
  };
}

function registerTargetScriptTerminalWebSocketRoute(app, routes, {
  projectContext = null
} = {}) {
  registerTerminalWebSocketRoute(app, {
    projectContext,
    routePath: `${routes.routeBase}/target-script-terminal/:terminalSessionId/ws`,
    serviceId: CURRENT_APP_SERVICE,
    serviceUnavailableMessage: "Current app service is unavailable.",
    subscribe(service, { subscriber, terminalSessionId }) {
      return service.subscribeTargetScriptTerminal(terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, terminalSessionId }) {
      return service.resizeTargetScriptTerminal(terminalSessionId, { cols, rows });
    },
    write(service, { data, terminalSessionId }) {
      return service.writeTargetScriptTerminal(terminalSessionId, data);
    }
  });
}

export { registerRoutes };
