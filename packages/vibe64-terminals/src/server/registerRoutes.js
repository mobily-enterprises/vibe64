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
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";

const VIBE64_TERMINALS_SERVICE = "feature.vibe64-terminals.service";
const VIBE64_TERMINALS_UNAVAILABLE = "Vibe64 terminal service is unavailable.";

function getTerminalService(app) {
  return app.make("feature.vibe64-terminals.service");
}

function registerRoutes(
  app,
  {
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 terminal routes only accept loopback Studio requests.",
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-terminals"]
  });
  const terminalService = () => getTerminalService(app);

  routes.serviceRoute("GET", "/sessions/:sessionId/launch-targets", {
    summary: "Read Vibe64 launch target status."
  }, (request) => {
    return terminalService().launchTargetStatus(request.params.sessionId);
  });

  routes.actionRoute("POST", "/sessions/:sessionId/launch-terminal", {
    actionId: ACTION_START_LAUNCH_TARGET_TERMINAL,
    body: launchTargetInputValidator,
    buildInput: bodyWithSessionId(routes),
    summary: "Start an Vibe64 launch target terminal."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/launch-target/open", {
    actionId: ACTION_OPEN_LAUNCH_TARGET,
    buildInput: sessionInput,
    summary: "Open the latest Vibe64 launch target."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/command-terminal", {
    actionId: ACTION_START_COMMAND_TERMINAL,
    body: commandTerminalInputValidator,
    buildInput: bodyWithSessionId(routes),
    summary: "Start an Vibe64 command terminal."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/shell-terminal", {
    actionId: ACTION_START_SHELL_TERMINAL,
    body: shellTerminalInputValidator,
    buildInput: bodyWithSessionId(routes),
    summary: "Start an Vibe64 shell terminal."
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/codex-terminal", {
    summary: "Start an Vibe64 Codex terminal."
  }, (request) => {
    return terminalService().startCodexTerminal(request.params.sessionId);
  });

  routes.actionRoute("POST", "/sessions/:sessionId/codex-attachments", {
    actionId: ACTION_UPLOAD_CODEX_ATTACHMENT,
    body: codexAttachmentInputValidator,
    bodyLimit: CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES,
    buildInput: bodyWithSessionId(routes),
    summary: "Upload a temporary Codex attachment for an Vibe64 session."
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeLaunchTargetTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/launch-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readLaunchTargetTerminal(sessionId, terminalSessionId),
    readSummary: "Read an Vibe64 launch target terminal snapshot.",
    closeSummary: "Close an Vibe64 launch target terminal."
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/launch-terminal/:terminalSessionId/stop", {
    statusCode: 200,
    summary: "Stop an Vibe64 launch target terminal without deleting its log."
  }, (request) => {
    const input = terminalRouteInput(request);
    return terminalService().stopLaunchTargetTerminal(input.sessionId, input.terminalSessionId);
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeCodexTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/codex-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readCodexTerminal(sessionId, terminalSessionId),
    readSummary: "Read an Vibe64 Codex terminal snapshot.",
    closeSummary: "Close an Vibe64 Codex terminal."
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeCommandTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/command-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readCommandTerminal(sessionId, terminalSessionId),
    readSummary: "Read an Vibe64 command terminal snapshot.",
    closeSummary: "Close an Vibe64 command terminal."
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeShellTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/shell-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readShellTerminal(sessionId, terminalSessionId),
    readSummary: "Read an Vibe64 shell terminal snapshot.",
    closeSummary: "Close an Vibe64 shell terminal."
  });

  registerVibe64TerminalWebSocketRoutes(app, routes);
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

function registerVibe64TerminalWebSocketRoutes(app, routes) {
  registerTerminalWebSocketRoute(app, {
    routePath: `${routes.routeBase}/sessions/:sessionId/codex-terminal/:terminalSessionId/ws`,
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
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
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
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
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
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
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
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
