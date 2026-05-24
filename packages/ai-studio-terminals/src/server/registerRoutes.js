import {
  codexAttachmentInputValidator,
  commandTerminalInputValidator,
  launchTargetInputValidator,
  shellTerminalInputValidator
} from "./inputSchemas.js";
import {
  ACTION_OPEN_LAUNCH_TARGET,
  ACTION_START_COMMAND_TERMINAL,
  ACTION_START_LAUNCH_TARGET_TERMINAL,
  ACTION_START_SHELL_TERMINAL,
  ACTION_UPLOAD_CODEX_ATTACHMENT
} from "./actions.js";
import {
  CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES
} from "./codexAttachments.js";
import { createAiStudioFeatureRoutes } from "../../../../server/lib/aiStudio/featureRoutes.js";

function getTerminalService(app) {
  return app.make("feature.ai-studio-terminals.service");
}

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createAiStudioFeatureRoutes(app, {
    localRequestMessage: "AI Studio terminal routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
    tags: ["studio", "ai-studio-terminals"]
  });
  const terminalService = () => getTerminalService(app);

  routes.serviceRoute("GET", "/sessions/:sessionId/launch-targets", {
    summary: "Read AI Studio launch target status."
  }, (request) => {
    return terminalService().launchTargetStatus(request.params.sessionId);
  });

  routes.actionRoute("POST", "/sessions/:sessionId/launch-terminal", {
    actionId: ACTION_START_LAUNCH_TARGET_TERMINAL,
    body: launchTargetInputValidator,
    buildInput: bodyWithSessionId(routes),
    summary: "Start an AI Studio launch target terminal."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/launch-target/open", {
    actionId: ACTION_OPEN_LAUNCH_TARGET,
    buildInput: sessionInput,
    summary: "Open the latest AI Studio launch target."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/command-terminal", {
    actionId: ACTION_START_COMMAND_TERMINAL,
    body: commandTerminalInputValidator,
    buildInput: bodyWithSessionId(routes),
    summary: "Start an AI Studio command terminal."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/shell-terminal", {
    actionId: ACTION_START_SHELL_TERMINAL,
    body: shellTerminalInputValidator,
    buildInput: bodyWithSessionId(routes),
    summary: "Start an AI Studio shell terminal."
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/codex-terminal", {
    summary: "Start an AI Studio Codex terminal."
  }, (request) => {
    return terminalService().startCodexTerminal(request.params.sessionId);
  });

  routes.actionRoute("POST", "/sessions/:sessionId/codex-attachments", {
    actionId: ACTION_UPLOAD_CODEX_ATTACHMENT,
    body: codexAttachmentInputValidator,
    bodyLimit: CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES,
    buildInput: bodyWithSessionId(routes),
    summary: "Upload a temporary Codex attachment for an AI Studio session."
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeLaunchTargetTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/launch-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readLaunchTargetTerminal(sessionId, terminalSessionId),
    readSummary: "Read an AI Studio launch target terminal snapshot.",
    closeSummary: "Close an AI Studio launch target terminal."
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/launch-terminal/:terminalSessionId/stop", {
    statusCode: 200,
    summary: "Stop an AI Studio launch target terminal without deleting its log."
  }, (request) => {
    const input = terminalRouteInput(request);
    return terminalService().stopLaunchTargetTerminal(input.sessionId, input.terminalSessionId);
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeCodexTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/codex-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readCodexTerminal(sessionId, terminalSessionId),
    readSummary: "Read an AI Studio Codex terminal snapshot.",
    closeSummary: "Close an AI Studio Codex terminal."
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeCommandTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/command-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readCommandTerminal(sessionId, terminalSessionId),
    readSummary: "Read an AI Studio command terminal snapshot.",
    closeSummary: "Close an AI Studio command terminal."
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeShellTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/shell-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readShellTerminal(sessionId, terminalSessionId),
    readSummary: "Read an AI Studio shell terminal snapshot.",
    closeSummary: "Close an AI Studio shell terminal."
  });
}

function bodyWithSessionId(routes) {
  return function buildBodyWithSessionId(request) {
    return {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    };
  };
}

function sessionInput(request) {
  return {
    sessionId: request.params.sessionId
  };
}

function terminalRouteInput(request) {
  return {
    sessionId: request.params.sessionId,
    terminalSessionId: request.params.terminalSessionId
  };
}

function registerTerminalSnapshotRoutes(routes, {
  close,
  closeSummary,
  path,
  read,
  readSummary
}) {
  routes.serviceRoute("GET", path, {
    failureStatus: 404,
    successStatus: 200,
    summary: readSummary
  }, (request) => {
    const input = terminalRouteInput(request);
    return read(input.sessionId, input.terminalSessionId);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = terminalRouteInput(request);
    return close(input.sessionId, input.terminalSessionId);
  });
}

export { registerRoutes };
