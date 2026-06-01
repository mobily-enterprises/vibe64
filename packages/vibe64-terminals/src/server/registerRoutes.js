import {
  codexAttachmentInputValidator,
  commandTerminalInputValidator,
  fixCodexReportInputValidator,
  launchTargetInputValidator,
  projectToolFixInputValidator,
  projectToolRunInputValidator,
  sessionTerminalFixInputValidator,
  shellTerminalInputValidator,
  terminalControlKeyInputValidator,
  terminalControlTextInputValidator
} from "./inputSchemas.js";
import {
  ACTION_RUN_PROJECT_TOOL,
  ACTION_START_PROJECT_TOOL_FIX,
  ACTION_START_SESSION_TERMINAL_FIX,
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
import {
  terminalKeyInput,
  terminalSessionContainsText,
  terminalSessionControlSnapshot
} from "@local/studio-terminal-core/server/terminalSessions";

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

  routes.serviceRoute("GET", "/codex-terminal", {
    summary: "Read global Vibe64 Codex terminal status."
  }, () => {
    return terminalService().globalCodexTerminalState();
  });

  routes.serviceRoute("POST", "/codex-terminal", {
    summary: "Start a global Vibe64 Codex terminal."
  }, () => {
    return terminalService().startGlobalCodexTerminal();
  });

  routes.actionRoute("POST", "/tools/:toolId/run", {
    actionId: ACTION_RUN_PROJECT_TOOL,
    body: projectToolRunInputValidator,
    buildInput(request) {
      return {
        ...routes.requestBody(request),
        toolId: request.params.toolId
      };
    },
    summary: "Run a Vibe64 project tool."
  });

  routes.actionRoute("POST", "/tools/:toolId/fix", {
    actionId: ACTION_START_PROJECT_TOOL_FIX,
    body: projectToolFixInputValidator,
    buildInput(request) {
      return {
        ...routes.requestBody(request),
        toolId: request.params.toolId
      };
    },
    summary: "Start an ephemeral Fix Codex job for a Vibe64 project tool failure."
  });

  routes.serviceRoute("POST", "/fix-codex-jobs/:jobId/report", {
    body: fixCodexReportInputValidator,
    summary: "Report an ephemeral Fix Codex job result."
  }, (request) => {
    return terminalService().reportFixCodexJob(request.params.jobId, routes.requestBody(request));
  });

  routes.actionRoute("POST", "/sessions/:sessionId/terminal-failure-fix", {
    actionId: ACTION_START_SESSION_TERMINAL_FIX,
    body: sessionTerminalFixInputValidator,
    buildInput(request) {
      return {
        ...routes.requestBody(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Start an ephemeral Fix Codex job for a Vibe64 session terminal failure."
  });

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
    closeSummary: "Close an Vibe64 launch target terminal.",
    write: (sessionId, terminalSessionId, data) => terminalService().writeLaunchTargetTerminal(sessionId, terminalSessionId, data)
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
    control: true,
    path: "/sessions/:sessionId/codex-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readCodexTerminal(sessionId, terminalSessionId),
    readSummary: "Read an Vibe64 Codex terminal snapshot.",
    closeSummary: "Close an Vibe64 Codex terminal.",
    write: (sessionId, terminalSessionId, data) => terminalService().writeCodexTerminal(sessionId, terminalSessionId, data)
  });

  registerGlobalTerminalSnapshotRoutes(routes, {
    close: (terminalSessionId) => terminalService().closeGlobalCodexTerminal(terminalSessionId),
    control: true,
    path: "/codex-terminal/:terminalSessionId",
    read: (terminalSessionId) => terminalService().readGlobalCodexTerminal(terminalSessionId),
    readSummary: "Read a global Vibe64 Codex terminal snapshot.",
    closeSummary: "Close a global Vibe64 Codex terminal.",
    write: (terminalSessionId, data) => terminalService().writeGlobalCodexTerminal(terminalSessionId, data)
  });

  registerToolTerminalSnapshotRoutes(routes, {
    close: (toolId, terminalSessionId) => terminalService().closeProjectToolTerminal(toolId, terminalSessionId),
    path: "/tools/:toolId/terminal/:terminalSessionId",
    read: (toolId, terminalSessionId) => terminalService().readProjectToolTerminal(toolId, terminalSessionId),
    readSummary: "Read a Vibe64 project tool terminal snapshot.",
    closeSummary: "Close a Vibe64 project tool terminal.",
    write: (toolId, terminalSessionId, data) => terminalService().writeProjectToolTerminal(toolId, terminalSessionId, data)
  });

  registerFixTerminalSnapshotRoutes(routes, {
    close: (jobId, terminalSessionId) => terminalService().closeFixCodexTerminal(jobId, terminalSessionId),
    control: true,
    path: "/fix-codex-jobs/:jobId/terminal/:terminalSessionId",
    read: (jobId, terminalSessionId) => terminalService().readFixCodexTerminal(jobId, terminalSessionId),
    readSummary: "Read a Fix Codex terminal snapshot.",
    closeSummary: "Close a Fix Codex terminal.",
    write: (jobId, terminalSessionId, data) => terminalService().writeFixCodexTerminal(jobId, terminalSessionId, data)
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeCommandTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/command-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readCommandTerminal(sessionId, terminalSessionId),
    readSummary: "Read an Vibe64 command terminal snapshot.",
    closeSummary: "Close an Vibe64 command terminal.",
    write: (sessionId, terminalSessionId, data) => terminalService().writeCommandTerminal(sessionId, terminalSessionId, data)
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeShellTerminal(sessionId, terminalSessionId),
    control: true,
    path: "/sessions/:sessionId/shell-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readShellTerminal(sessionId, terminalSessionId),
    readSummary: "Read an Vibe64 shell terminal snapshot.",
    closeSummary: "Close an Vibe64 shell terminal.",
    write: (sessionId, terminalSessionId, data) => terminalService().writeShellTerminal(sessionId, terminalSessionId, data)
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

function globalTerminalRouteInput(request) {
  return {
    terminalSessionId: request.params.terminalSessionId
  };
}

function toolTerminalRouteInput(request) {
  return {
    terminalSessionId: request.params.terminalSessionId,
    toolId: request.params.toolId
  };
}

function fixTerminalRouteInput(request) {
  return {
    jobId: request.params.jobId,
    terminalSessionId: request.params.terminalSessionId
  };
}

function registerTerminalSnapshotRoutes(routes, {
  close,
  closeSummary,
  control = false,
  path,
  read,
  readSummary,
  write = null
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

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: terminalRouteInput,
      path,
      read: (input) => read(input.sessionId, input.terminalSessionId),
      write: write
        ? (input, data) => write(input.sessionId, input.terminalSessionId, data)
        : null
    });
  }
}

function registerGlobalTerminalSnapshotRoutes(routes, {
  close,
  closeSummary,
  control = false,
  path,
  read,
  readSummary,
  write = null
}) {
  routes.serviceRoute("GET", path, {
    failureStatus: 404,
    successStatus: 200,
    summary: readSummary
  }, (request) => {
    const input = globalTerminalRouteInput(request);
    return read(input.terminalSessionId);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = globalTerminalRouteInput(request);
    return close(input.terminalSessionId);
  });

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: globalTerminalRouteInput,
      path,
      read: (input) => read(input.terminalSessionId),
      write: write
        ? (input, data) => write(input.terminalSessionId, data)
        : null
    });
  }
}

function registerToolTerminalSnapshotRoutes(routes, {
  close,
  closeSummary,
  control = false,
  path,
  read,
  readSummary,
  write = null
}) {
  routes.serviceRoute("GET", path, {
    failureStatus: 404,
    successStatus: 200,
    summary: readSummary
  }, (request) => {
    const input = toolTerminalRouteInput(request);
    return read(input.toolId, input.terminalSessionId);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = toolTerminalRouteInput(request);
    return close(input.toolId, input.terminalSessionId);
  });

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: toolTerminalRouteInput,
      path,
      read: (input) => read(input.toolId, input.terminalSessionId),
      write: write
        ? (input, data) => write(input.toolId, input.terminalSessionId, data)
        : null
    });
  }
}

function registerFixTerminalSnapshotRoutes(routes, {
  close,
  closeSummary,
  control = false,
  path,
  read,
  readSummary,
  write = null
}) {
  routes.serviceRoute("GET", path, {
    failureStatus: 404,
    successStatus: 200,
    summary: readSummary
  }, (request) => {
    const input = fixTerminalRouteInput(request);
    return read(input.jobId, input.terminalSessionId);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = fixTerminalRouteInput(request);
    return close(input.jobId, input.terminalSessionId);
  });

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: fixTerminalRouteInput,
      path,
      read: (input) => read(input.jobId, input.terminalSessionId),
      write: write
        ? (input, data) => write(input.jobId, input.terminalSessionId, data)
        : null
    });
  }
}

function registerTerminalControlRoutes(routes, {
  inputForRequest,
  path,
  read,
  write
}) {
  routes.serviceRoute("GET", `${path}/control/snapshot`, {
    failureStatus: 404,
    successStatus: 200,
    summary: "Read a terminal control snapshot."
  }, async (request) => {
    return terminalSessionControlSnapshot(await read(inputForRequest(request)));
  });

  routes.serviceRoute("GET", `${path}/control/quiet`, {
    failureStatus: 404,
    successStatus: 200,
    summary: "Read whether a terminal has been quiet recently."
  }, async (request) => {
    return terminalSessionControlSnapshot(await read(inputForRequest(request)));
  });

  routes.serviceRoute("POST", `${path}/control/check-text`, {
    body: terminalControlTextInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Check whether a terminal snapshot contains literal text."
  }, async (request) => {
    return terminalSessionContainsText(
      await read(inputForRequest(request)),
      routes.requestBody(request).text
    );
  });

  if (!write) {
    return;
  }

  routes.serviceRoute("POST", `${path}/control/text`, {
    body: terminalControlTextInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Send exact text to a terminal."
  }, async (request) => {
    return terminalSessionControlSnapshot(
      await write(inputForRequest(request), routes.requestBody(request).text)
    );
  });

  routes.serviceRoute("POST", `${path}/control/key`, {
    body: terminalControlKeyInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Send a narrow supported key to a terminal."
  }, async (request) => {
    const key = routes.requestBody(request).key;
    const input = terminalKeyInput(key);
    if (!input) {
      return {
        ok: false,
        error: `Unsupported terminal key: ${String(key || "")}`
      };
    }
    return terminalSessionControlSnapshot(await write(inputForRequest(request), input));
  });
}

function registerVibe64TerminalWebSocketRoutes(app, routes) {
  registerTerminalWebSocketRoute(app, {
    routePath: `${routes.routeBase}/codex-terminal/:terminalSessionId/ws`,
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { subscriber, terminalSessionId }) {
      return service.subscribeGlobalCodexTerminal(terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, terminalSessionId }) {
      return service.resizeGlobalCodexTerminal(terminalSessionId, { cols, rows });
    },
    write(service, { data, terminalSessionId }) {
      return service.writeGlobalCodexTerminal(terminalSessionId, data);
    }
  });

  registerTerminalWebSocketRoute(app, {
    routePath: `${routes.routeBase}/fix-codex-jobs/:jobId/terminal/:terminalSessionId/ws`,
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { jobId, subscriber, terminalSessionId }) {
      return service.subscribeFixCodexTerminal(jobId, terminalSessionId, subscriber);
    },
    resize(service, { cols, jobId, rows, terminalSessionId }) {
      return service.resizeFixCodexTerminal(jobId, terminalSessionId, { cols, rows });
    },
    write(service, { data, jobId, terminalSessionId }) {
      return service.writeFixCodexTerminal(jobId, terminalSessionId, data);
    }
  });

  registerTerminalWebSocketRoute(app, {
    routePath: `${routes.routeBase}/tools/:toolId/terminal/:terminalSessionId/ws`,
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { subscriber, terminalSessionId, toolId }) {
      return service.subscribeProjectToolTerminal(toolId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, terminalSessionId, toolId }) {
      return service.resizeProjectToolTerminal(toolId, terminalSessionId, { cols, rows });
    },
    write(service, { data, terminalSessionId, toolId }) {
      return service.writeProjectToolTerminal(toolId, terminalSessionId, data);
    }
  });

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
