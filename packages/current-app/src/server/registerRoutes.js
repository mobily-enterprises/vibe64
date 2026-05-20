import {
  currentAppQueryInputValidator,
  targetScriptTerminalInputValidator,
  starredTargetScriptsInputValidator
} from "./inputSchemas.js";
import {
  ACTION_LIST_TARGET_SCRIPTS,
  ACTION_READ_CURRENT_APP,
  ACTION_READ_SETUP_READINESS,
  ACTION_RESET_STARRED_TARGET_SCRIPTS,
  ACTION_SAVE_STARRED_TARGET_SCRIPTS
} from "./actions.js";
import { createAiStudioFeatureRoutes } from "../../../../server/lib/aiStudio/featureRoutes.js";
import { sendDoctorEventStream } from "../../../../server/lib/doctorStream.js";

function getCurrentAppService(app) {
  return app.make("feature.current-app.service");
}

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createAiStudioFeatureRoutes(app, {
    localRequestMessage: "Current-app Studio routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
    tags: ["studio", "current-app"]
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_CURRENT_APP,
    buildInput: queryInput,
    query: currentAppQueryInputValidator,
    summary: "Inspect the current app."
  });

  routes.actionRoute("GET", "/target-scripts", {
    actionId: ACTION_LIST_TARGET_SCRIPTS,
    summary: "List target scripts for the current app."
  });

  routes.actionRoute("GET", "/setup-readiness", {
    actionId: ACTION_READ_SETUP_READINESS,
    summary: "Read AI Studio setup readiness for protected current-app routes."
  });

  routes.serviceRoute("GET", "/setup-readiness/stream", {
    summary: "Stream AI Studio setup readiness for protected current-app routes."
  }, async (_request, reply) => {
    await sendDoctorEventStream(reply, ({ emit }) => {
      return getCurrentAppService(app).streamSetupReadiness({
        emit
      });
    });
  });

  routes.actionRoute("PUT", "/target-scripts/starred", {
    actionId: ACTION_SAVE_STARRED_TARGET_SCRIPTS,
    body: starredTargetScriptsInputValidator,
    buildInput: routes.requestBody,
    summary: "Persist starred target script shortcuts for the current app."
  });

  routes.actionRoute("DELETE", "/target-scripts/starred", {
    actionId: ACTION_RESET_STARRED_TARGET_SCRIPTS,
    summary: "Reset starred target script shortcuts to the default set."
  });

  routes.serviceRoute("POST", "/target-script-terminal", {
    body: targetScriptTerminalInputValidator,
    summary: "Start a target script terminal for the current app."
  }, (request) => {
    return getCurrentAppService(app).startTargetScriptTerminal(routes.requestBody(request));
  });

  routes.serviceRoute("DELETE", "/target-script-terminal/:terminalSessionId", {
    statusCode: 200,
    summary: "Close a target script terminal for the current app."
  }, (request) => {
    return getCurrentAppService(app).closeTargetScriptTerminal(
      request.params.terminalSessionId
    );
  });
}

function queryInput(request) {
  return request.input.query || {};
}

export { registerRoutes };
