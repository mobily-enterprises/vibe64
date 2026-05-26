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
import { createAiStudioFeatureRoutes } from "@local/ai-studio-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/ai-studio-core/server/terminalWebSocketRoutes";

const AI_STUDIO_TERMINALS_SERVICE = "feature.ai-studio-terminals.service";
const AI_STUDIO_TERMINALS_UNAVAILABLE = "AI Studio terminal service is unavailable.";

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

  registerAiStudioTerminalWebSocketRoutes(app, routes);
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

function registerAiStudioTerminalWebSocketRoutes(app, routes) {
  registerTerminalWebSocketRoute(app, {
    routePath: `${routes.routeBase}/sessions/:sessionId/codex-terminal/:terminalSessionId/ws`,
    serviceId: AI_STUDIO_TERMINALS_SERVICE,
    serviceUnavailableMessage: AI_STUDIO_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeCodexTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId }) {
      return service.resizeCodexTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeCodexTerminal(sessionId, terminalSessionId, data);
    }
  });

  registerTerminalWebSocketRoute(app, {
    routePath: `${routes.routeBase}/sessions/:sessionId/command-terminal/:terminalSessionId/ws`,
    serviceId: AI_STUDIO_TERMINALS_SERVICE,
    serviceUnavailableMessage: AI_STUDIO_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeCommandTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId }) {
      return service.resizeCommandTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeCommandTerminal(sessionId, terminalSessionId, data);
    }
  });

  registerTerminalWebSocketRoute(app, {
    routePath: `${routes.routeBase}/sessions/:sessionId/launch-terminal/:terminalSessionId/ws`,
    serviceId: AI_STUDIO_TERMINALS_SERVICE,
    serviceUnavailableMessage: AI_STUDIO_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeLaunchTargetTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId }) {
      return service.resizeLaunchTargetTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeLaunchTargetTerminal(sessionId, terminalSessionId, data);
    }
  });

  registerTerminalWebSocketRoute(app, {
    routePath: `${routes.routeBase}/sessions/:sessionId/shell-terminal/:terminalSessionId/ws`,
    serviceId: AI_STUDIO_TERMINALS_SERVICE,
    serviceUnavailableMessage: AI_STUDIO_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeShellTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId }) {
      return service.resizeShellTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeShellTerminal(sessionId, terminalSessionId, data);
    }
  });
}

export { registerRoutes };
