import {
  agentAttachmentInputValidator,
  agentTurnSteerInputValidator,
  commandTerminalInputValidator,
  fixCodexReportInputValidator,
  launchTargetInputValidator,
  projectToolFixInputValidator,
  projectToolRunInputValidator,
  sessionTerminalFixInputValidator,
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
  ACTION_UPLOAD_AGENT_ATTACHMENT
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
} from "@local/vibe64-execution/server/terminalSessions";

const VIBE64_TERMINALS_SERVICE = "feature.vibe64-terminals.service";
const VIBE64_TERMINALS_UNAVAILABLE = "Vibe64 terminal service is unavailable.";

function getTerminalService(app) {
  return app.make("feature.vibe64-terminals.service");
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
    localRequestMessage: "Vibe64 terminal routes only accept loopback Studio requests.",
    projectContext,
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

  routes.serviceRoute("POST", "/agent-sessions/reconcile", {
    summary: "Reconnect assistant sessions for the current project."
  }, () => {
    return terminalService().reconcileOpenAgentSessions();
  });

  routes.serviceRoute("POST", "/project-runtime/open", {
    summary: "Mark the current Vibe64 project runtime open."
  }, (request) => {
    return terminalService().openProjectRuntime(routes.requestBody(request));
  });

  routes.serviceRoute("POST", "/project-runtime/close", {
    summary: "Close all Vibe64 runtime processes for the current project."
  }, (request) => {
    return terminalService().closeProjectRuntime(routes.requestBody(request));
  });

  routes.actionRoute("POST", "/tools/:toolId/run", {
    actionId: ACTION_RUN_PROJECT_TOOL,
    body: projectToolRunInputValidator,
    buildInput(request) {
      return withVibe64User(request, {
        ...routes.requestBody(request),
        toolId: request.params.toolId
      });
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
    return terminalService().launchTargetStatus(request.params.sessionId, {
      publicHost: firstForwardedHeader(request.headers?.["x-forwarded-host"]) || request.headers?.host || "",
      publicProtocol: firstForwardedHeader(request.headers?.["x-forwarded-proto"]) || request.protocol || ""
    });
  });

  routes.actionRoute("POST", "/sessions/:sessionId/launch-terminal", {
    actionId: ACTION_START_LAUNCH_TARGET_TERMINAL,
    body: launchTargetInputValidator,
    buildInput: (request) => withVibe64User(request, bodyWithSessionId(routes)(request)),
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
    buildInput: (request) => withVibe64User(request, bodyWithSessionId(routes)(request)),
    summary: "Start an Vibe64 command terminal."
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-terminal", {
    summary: "Start a Vibe64 AI terminal."
  }, (request) => {
    return terminalService().startAgentTerminal(
      request.params.sessionId,
      withVibe64User(request, routes.requestBody(request))
    );
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-session", {
    summary: "Prepare the Vibe64 assistant session."
  }, (request) => {
    return terminalService().ensureAgentSession(
      request.params.sessionId,
      withVibe64User(request, routes.requestBody(request))
    );
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-turn/interrupt", {
    summary: "Interrupt the active Vibe64 assistant turn."
  }, (request) => {
    return terminalService().interruptAgentTurn(
      request.params.sessionId,
      withVibe64User(request, routes.requestBody(request))
    );
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-turn/steer", {
    body: agentTurnSteerInputValidator,
    summary: "Steer the active Vibe64 assistant turn."
  }, (request) => {
    return terminalService().steerAgentTurn(
      request.params.sessionId,
      withVibe64User(request, routes.requestBody(request))
    );
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-attachments", {
    actionId: ACTION_UPLOAD_AGENT_ATTACHMENT,
    body: agentAttachmentInputValidator,
    bodyLimit: CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES,
    buildInput: bodyWithSessionId(routes),
    summary: "Upload a temporary assistant attachment for a Vibe64 session."
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
    close: (sessionId, terminalSessionId) => terminalService().closeAgentTerminal(sessionId, terminalSessionId),
    control: true,
    path: "/sessions/:sessionId/agent-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readAgentTerminal(sessionId, terminalSessionId),
    readSummary: "Read a Vibe64 AI terminal snapshot.",
    closeSummary: "Close a Vibe64 AI terminal.",
    write: (sessionId, terminalSessionId, data, input) => terminalService().writeAgentTerminal(sessionId, terminalSessionId, data, input)
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
    close: (toolId, terminalSessionId, input) => terminalService().closeProjectToolTerminal(toolId, terminalSessionId, input),
    path: "/tools/:toolId/terminal/:terminalSessionId",
    read: (toolId, terminalSessionId, input) => terminalService().readProjectToolTerminal(toolId, terminalSessionId, input),
    readSummary: "Read a Vibe64 project tool terminal snapshot.",
    closeSummary: "Close a Vibe64 project tool terminal.",
    write: (toolId, terminalSessionId, data, input) => terminalService().writeProjectToolTerminal(toolId, terminalSessionId, data, input)
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
    close: (sessionId, terminalSessionId, input) => terminalService().closeCommandTerminal(sessionId, terminalSessionId, input),
    path: "/sessions/:sessionId/command-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId, input) => terminalService().readCommandTerminal(sessionId, terminalSessionId, input),
    readSummary: "Read an Vibe64 command terminal snapshot.",
    closeSummary: "Close an Vibe64 command terminal.",
    write: (sessionId, terminalSessionId, data, input) => terminalService().writeCommandTerminal(sessionId, terminalSessionId, data, input)
  });

  registerVibe64TerminalWebSocketRoutes(app, routes, {
    projectContext
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

function withVibe64User(request, input = {}) {
  const vibe64User = request.vibe64User || null;
  const {
    vibe64User: _ignoredVibe64User,
    ...safeInput
  } = input || {};
  void _ignoredVibe64User;
  if (!vibe64User) {
    return safeInput;
  }
  return {
    ...safeInput,
    vibe64User
  };
}

function firstForwardedHeader(value = "") {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").split(",")[0]?.trim() || "";
}

function firstRequestValue(value = "") {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function requestQueryValue(request, key) {
  return firstRequestValue(request?.query?.[key] ?? request?.input?.query?.[key] ?? "");
}

function terminalControlInputFields(body = {}) {
  const originId = firstRequestValue(body?.originId);
  return {
    ...(originId ? { originId } : {}),
    trackGitActor: true
  };
}

function terminalRouteInput(request, input = {}) {
  return withVibe64User(request, {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
    sessionId: request.params.sessionId,
    terminalSessionId: request.params.terminalSessionId
  });
}

function globalTerminalRouteInput(request, input = {}) {
  return {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
    terminalSessionId: request.params.terminalSessionId
  };
}

function toolTerminalRouteInput(request, input = {}) {
  return withVibe64User(request, {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
    terminalSessionId: request.params.terminalSessionId,
    toolId: request.params.toolId
  });
}

function fixTerminalRouteInput(request, input = {}) {
  return {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
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
    return read(input.sessionId, input.terminalSessionId, input);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = terminalRouteInput(request);
    return close(input.sessionId, input.terminalSessionId, input);
  });

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: terminalRouteInput,
      path,
      read: (input) => read(input.sessionId, input.terminalSessionId, input),
      write: write
        ? (input, data) => write(input.sessionId, input.terminalSessionId, data, input)
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
    return read(input.toolId, input.terminalSessionId, input);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = toolTerminalRouteInput(request);
    return close(input.toolId, input.terminalSessionId, input);
  });

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: toolTerminalRouteInput,
      path,
      read: (input) => read(input.toolId, input.terminalSessionId, input),
      write: write
        ? (input, data) => write(input.toolId, input.terminalSessionId, data, input)
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
    const body = routes.requestBody(request);
    return terminalSessionControlSnapshot(
      await write(inputForRequest(request, terminalControlInputFields(body)), body.text)
    );
  });

  routes.serviceRoute("POST", `${path}/control/key`, {
    body: terminalControlKeyInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Send a narrow supported key to a terminal."
  }, async (request) => {
    const body = routes.requestBody(request);
    const key = body.key;
    const input = terminalKeyInput(key);
    if (!input) {
      return {
        ok: false,
        error: `Unsupported terminal key: ${String(key || "")}`
      };
    }
    return terminalSessionControlSnapshot(await write(inputForRequest(request, terminalControlInputFields(body)), input));
  });
}

function registerVibe64TerminalWebSocketRoutes(app, routes, {
  projectContext = null
} = {}) {
  registerTerminalWebSocketRoute(app, {
    projectContext,
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
    projectContext,
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
    projectContext,
    routePath: `${routes.routeBase}/tools/:toolId/terminal/:terminalSessionId/ws`,
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { request, subscriber, terminalSessionId, toolId }) {
      return service.subscribeProjectToolTerminal(toolId, terminalSessionId, subscriber, {
        request
      });
    },
    resize(service, { cols, request, rows, terminalSessionId, toolId }) {
      return service.resizeProjectToolTerminal(toolId, terminalSessionId, { cols, rows }, {
        request
      });
    },
    write(service, { data, request, terminalSessionId, toolId }) {
      return service.writeProjectToolTerminal(toolId, terminalSessionId, data, {
        request
      });
    }
  });

  registerTerminalWebSocketRoute(app, {
    projectContext,
    routePath: `${routes.routeBase}/sessions/:sessionId/agent-terminal/:terminalSessionId/ws`,
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeAgentTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId }) {
      return service.resizeAgentTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, request, sessionId, terminalSessionId }) {
      return service.writeAgentTerminal(sessionId, terminalSessionId, data, {
        originId: requestQueryValue(request, "originId"),
        request
      });
    }
  });

  registerTerminalWebSocketRoute(app, {
    projectContext,
    routePath: `${routes.routeBase}/sessions/:sessionId/command-terminal/:terminalSessionId/ws`,
    serviceId: VIBE64_TERMINALS_SERVICE,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { request, sessionId, subscriber, terminalSessionId }) {
      return service.subscribeCommandTerminal(sessionId, terminalSessionId, subscriber, {
        request
      });
    },
    resize(service, { cols, request, rows, sessionId, terminalSessionId }) {
      return service.resizeCommandTerminal(sessionId, terminalSessionId, { cols, rows }, {
        request
      });
    },
    write(service, { data, request, sessionId, terminalSessionId }) {
      return service.writeCommandTerminal(sessionId, terminalSessionId, data, {
        request
      });
    }
  });

  registerTerminalWebSocketRoute(app, {
    projectContext,
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

}

export { registerRoutes };
