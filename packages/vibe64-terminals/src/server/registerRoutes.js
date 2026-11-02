import {
  outputTargetInputValidator,
  previewIdentityInputValidator,
  previewDiagnosticInputValidator,
  terminalControlKeyInputValidator,
  terminalControlTextInputValidator
} from "./inputSchemas.js";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";
import {
  ACTION_ARCHIVE_WORK_PLAN,
  ACTION_CANCEL_SESSION_PROMPT_HINTS,
  ACTION_CHECK_AGENT_TERMINAL_TEXT,
  ACTION_CHECK_GLOBAL_TERMINAL_TEXT,
  ACTION_CLOSE_AGENT_TERMINAL,
  ACTION_CLOSE_GLOBAL_TERMINAL,
  ACTION_CLOSE_OUTPUT_TERMINAL,
  ACTION_CLOSE_PROJECT_RUNTIME,
  ACTION_CREATE_TEMPORARY_CONVERSATION,
  ACTION_DELETE_AGENT_ATTACHMENT,
  ACTION_DELETE_TEMPORARY_CONVERSATION,
  ACTION_GENERATE_SESSION_PROMPT_HINTS,
  ACTION_LIST_TEMPORARY_CONVERSATIONS,
  ACTION_OPEN_OUTPUT_TARGET,
  ACTION_OPEN_PROJECT_RUNTIME,
  ACTION_PREPARE_AGENT_SESSION,
  ACTION_READ_AGENT_GOAL,
  ACTION_READ_AGENT_PLAN_USAGE,
  ACTION_READ_AGENT_TERMINAL,
  ACTION_READ_AGENT_TERMINAL_CONTROL,
  ACTION_READ_GLOBAL_TERMINAL,
  ACTION_READ_GLOBAL_TERMINAL_CONTROL,
  ACTION_READ_GLOBAL_TERMINAL_STATUS,
  ACTION_READ_OUTPUTS,
  ACTION_READ_OUTPUT_TERMINAL,
  ACTION_READ_TEMPORARY_CONVERSATION,
  ACTION_READ_WORK_PLAN,
  ACTION_RECONCILE_AGENT_SESSIONS,
  ACTION_RECORD_PREVIEW_DIAGNOSTIC,
  ACTION_RESTORE_WORK_PLAN,
  ACTION_SELECT_PREVIEW_IDENTITY,
  ACTION_START_AGENT_TERMINAL,
  ACTION_START_GLOBAL_TERMINAL,
  ACTION_START_OUTPUT_TARGET,
  ACTION_START_TEMPORARY_CONVERSATION_TURN,
  ACTION_STOP_OUTPUT_TARGET,
  ACTION_STOP_TEMPORARY_CONVERSATION,
  ACTION_UPDATE_AGENT_GOAL,
  ACTION_UPDATE_TEMPORARY_CONVERSATION,
  ACTION_WRITE_AGENT_TERMINAL_KEY,
  ACTION_WRITE_AGENT_TERMINAL_TEXT,
  ACTION_WRITE_GLOBAL_TERMINAL_KEY,
  ACTION_WRITE_GLOBAL_TERMINAL_TEXT
} from "./terminalActions.js";
import { registerTerminalTransferRoutes } from "./terminalTransferRoutes.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */
/** @typedef {import("./types.js").TerminalsService} TerminalsService */

const VIBE64_TERMINALS_UNAVAILABLE = "Vibe64 terminal service is unavailable.";

const OUTPUT_TERMINAL_ROUTES = Object.freeze({
  path: "/sessions/:sessionId/output-runs/:terminalSessionId/terminal",
  buildInput: terminalRouteInput,
  readActionId: ACTION_READ_OUTPUT_TERMINAL,
  readSummary: "Read a Vibe64 output terminal snapshot.",
  closeActionId: ACTION_CLOSE_OUTPUT_TERMINAL,
  closeSummary: "Close a Vibe64 output terminal."
});
const AGENT_TERMINAL_ROUTES = Object.freeze({
  path: "/sessions/:sessionId/agent-terminal/:terminalSessionId",
  buildInput: terminalRouteInput,
  readActionId: ACTION_READ_AGENT_TERMINAL,
  readSummary: "Read a Vibe64 AI terminal snapshot.",
  closeActionId: ACTION_CLOSE_AGENT_TERMINAL,
  closeSummary: "Close a Vibe64 AI terminal.",
  control: Object.freeze({
    snapshotActionId: ACTION_READ_AGENT_TERMINAL_CONTROL,
    checkTextActionId: ACTION_CHECK_AGENT_TERMINAL_TEXT,
    textActionId: ACTION_WRITE_AGENT_TERMINAL_TEXT,
    keyActionId: ACTION_WRITE_AGENT_TERMINAL_KEY
  })
});
const GLOBAL_TERMINAL_ROUTES = Object.freeze({
  path: "/codex-terminal/:terminalSessionId",
  buildInput: globalTerminalRouteInput,
  readActionId: ACTION_READ_GLOBAL_TERMINAL,
  readSummary: "Read a global Vibe64 Codex terminal snapshot.",
  closeActionId: ACTION_CLOSE_GLOBAL_TERMINAL,
  closeSummary: "Close a global Vibe64 Codex terminal.",
  control: Object.freeze({
    snapshotActionId: ACTION_READ_GLOBAL_TERMINAL_CONTROL,
    checkTextActionId: ACTION_CHECK_GLOBAL_TERMINAL_TEXT,
    textActionId: ACTION_WRITE_GLOBAL_TERMINAL_TEXT,
    keyActionId: ACTION_WRITE_GLOBAL_TERMINAL_KEY
  })
});

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {RuntimeFastify} options.fastify
 * @param {boolean} options.localhostCheckBypassed
 * @param {StudioProjectContext} options.projectContext
 * @param {TerminalsService} options.terminals
 */
function registerRoutes(http, { fastify, localhostCheckBypassed, projectContext, terminals }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-terminals"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Vibe64 terminal routes only accept loopback Studio requests.",
      projectContext
    })
  });
  routes.actionRoute("GET", "/codex-terminal", {
    actionId: ACTION_READ_GLOBAL_TERMINAL_STATUS,
    summary: "Read global Vibe64 Codex terminal status."
  });

  routes.actionRoute("POST", "/codex-terminal", {
    actionId: ACTION_START_GLOBAL_TERMINAL,
    summary: "Start a global Vibe64 Codex terminal."
  });

  routes.actionRoute("POST", "/agent-sessions/reconcile", {
    actionId: ACTION_RECONCILE_AGENT_SESSIONS,
    summary: "Reconnect assistant sessions for the current project."
  });

  routes.actionRoute("POST", "/project-runtime/open", {
    actionId: ACTION_OPEN_PROJECT_RUNTIME,
    buildInput: (request) => withoutVibe64User(requestBody(request)),
    summary: "Mark the current Vibe64 project runtime open."
  });

  routes.actionRoute("POST", "/project-runtime/close", {
    actionId: ACTION_CLOSE_PROJECT_RUNTIME,
    buildInput: (request) => withoutVibe64User(requestBody(request)),
    summary: "Close all Vibe64 runtime processes for the current project."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/preview-diagnostics", {
    actionId: ACTION_RECORD_PREVIEW_DIAGNOSTIC,
    body: previewDiagnosticInputValidator,
    buildInput: request => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Record opt-in, bounded Preview resource diagnostics."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/outputs", {
    actionId: ACTION_READ_OUTPUTS,
    buildInput: (request) => ({ ...requestQuery(request), ...sessionInput(request), ...requestPublicRouting(request) }),
    summary: "Read Vibe64 output target and run status."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/output-runs", {
    actionId: ACTION_START_OUTPUT_TARGET,
    body: outputTargetInputValidator,
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Start a Vibe64 output target."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/output-runs/open", {
    actionId: ACTION_OPEN_OUTPUT_TARGET,
    buildInput: sessionInput,
    summary: "Open the latest Vibe64 web output."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/preview-identity", {
    actionId: ACTION_SELECT_PREVIEW_IDENTITY,
    body: previewIdentityInputValidator,
    buildInput(request) {
      const body = requestBody(request);
      return {
        identityName: String(body.identityName || ""),
        mode: body.mode,
        ...requestPublicRouting(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Select the application identity for this preview browser."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-terminal", {
    actionId: ACTION_START_AGENT_TERMINAL,
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Start a Vibe64 AI terminal."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/agent-goal", {
    actionId: ACTION_READ_AGENT_GOAL,
    buildInput: sessionInput,
    summary: "Read the selected assistant conversation goal."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-goal", {
    actionId: ACTION_UPDATE_AGENT_GOAL,
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Set, pause, resume, or cancel the selected assistant conversation goal."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/agent-plan-usage", {
    actionId: ACTION_READ_AGENT_PLAN_USAGE,
    buildInput: sessionInput,
    summary: "Read the selected assistant account's remaining plan allowance."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/work-plan", {
    actionId: ACTION_READ_WORK_PLAN,
    buildInput: (request) => ({ ...requestQuery(request), ...sessionInput(request) }),
    summary: "Read one exact-revision page of Main's Auto work plan."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/work-plan/archive", {
    actionId: ACTION_ARCHIVE_WORK_PLAN,
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Archive the current plan at the reviewed revision, preserving it in history."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/work-plan/restore", {
    actionId: ACTION_RESTORE_WORK_PLAN,
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Reopen an archived plan as active when there is no current plan."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-session", {
    actionId: ACTION_PREPARE_AGENT_SESSION,
    buildInput: sessionInput,
    summary: "Prepare the Vibe64 assistant session."
  });

  routes.actionRoute("DELETE", "/sessions/:sessionId/agent-attachments/:attachmentId", {
    actionId: ACTION_DELETE_AGENT_ATTACHMENT,
    buildInput: (request) => ({
      attachmentId: request.params.attachmentId,
      sessionId: request.params.sessionId
    }),
    summary: "Delete one temporary assistant attachment."
  });

  registerTerminalTransferRoutes(routes);

  routes.actionRoute("GET", "/sessions/:sessionId/temporary-conversations", {
    actionId: ACTION_LIST_TEMPORARY_CONVERSATIONS,
    buildInput: (request) => ({ sessionId: request.params.sessionId }),
    summary: "Restore Vibe64 temporary conversations."
  });
  routes.actionRoute("PATCH", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: ACTION_UPDATE_TEMPORARY_CONVERSATION,
    buildInput: (request) => ({ ...requestBody(request), ...temporaryConversationInput(request) }),
    summary: "Save a Vibe64 temporary conversation draft and settings."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations", {
    actionId: ACTION_CREATE_TEMPORARY_CONVERSATION,
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Create a Vibe64 temporary conversation."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: ACTION_READ_TEMPORARY_CONVERSATION,
    buildInput: (request) => ({ ...requestQuery(request), ...temporaryConversationInput(request) }),
    summary: "Read a Vibe64 temporary conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations/:conversationId/turns", {
    actionId: ACTION_START_TEMPORARY_CONVERSATION_TURN,
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      ...temporaryConversationInput(request)
    }),
    summary: "Start a turn in a Vibe64 temporary conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations/:conversationId/stop", {
    actionId: ACTION_STOP_TEMPORARY_CONVERSATION,
    buildInput: (request) => ({
      ...requestBody(request),
      ...temporaryConversationInput(request)
    }),
    summary: "Stop a Vibe64 temporary conversation."
  });

  routes.actionRoute("DELETE", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: ACTION_DELETE_TEMPORARY_CONVERSATION,
    buildInput: temporaryConversationInput,
    summary: "Delete a Vibe64 temporary conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/prompt-hints", {
    actionId: ACTION_GENERATE_SESSION_PROMPT_HINTS,
    buildInput: promptHintRouteInput,
    summary: "Suggest useful next prompts for a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/prompt-hints/cancel", {
    actionId: ACTION_CANCEL_SESSION_PROMPT_HINTS,
    buildInput: promptHintRouteInput,
    summary: "Cancel prompt suggestions that are no longer relevant."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/output-runs/:terminalSessionId/stop", {
    actionId: ACTION_STOP_OUTPUT_TARGET,
    buildInput: terminalRouteInput,
    statusCode: 200,
    summary: "Stop a Vibe64 output target without deleting its log."
  });

  // Every terminal has a snapshot and close; AI and global terminals are also controllable.
  for (const terminal of [OUTPUT_TERMINAL_ROUTES, AGENT_TERMINAL_ROUTES, GLOBAL_TERMINAL_ROUTES]) {
    routes.actionRoute("GET", terminal.path, {
      actionId: terminal.readActionId,
      buildInput: terminal.buildInput,
      failureStatus: 404,
      successStatus: 200,
      summary: terminal.readSummary
    });
    routes.actionRoute("DELETE", terminal.path, {
      actionId: terminal.closeActionId,
      buildInput: terminal.buildInput,
      statusCode: 200,
      summary: terminal.closeSummary
    });
  }
  for (const terminal of [AGENT_TERMINAL_ROUTES, GLOBAL_TERMINAL_ROUTES]) {
    const { control } = terminal;
    for (const suffix of ["snapshot", "quiet"]) {
      routes.actionRoute("GET", `${terminal.path}/control/${suffix}`, {
        actionId: control.snapshotActionId,
        buildInput: terminal.buildInput,
        failureStatus: 404,
        successStatus: 200,
        summary: "Read a terminal control snapshot and quiet state."
      });
    }
    for (const [operation, actionId, body, summary] of [
      ["check-text", control.checkTextActionId, terminalControlTextInputValidator,
        "Check whether a terminal snapshot contains literal text."],
      ["text", control.textActionId, terminalControlTextInputValidator, "Send exact text to a terminal."],
      ["key", control.keyActionId, terminalControlKeyInputValidator, "Send a narrow supported key to a terminal."]
    ]) {
      routes.actionRoute("POST", `${terminal.path}/control/${operation}`, {
        actionId,
        body,
        buildInput: (request) => ({ ...withoutVibe64User(requestBody(request)), ...terminal.buildInput(request) }),
        failureStatus: 404,
        successStatus: 200,
        summary
      });
    }
  }

  registerVibe64TerminalWebSocketRoutes(fastify, routes, terminals, { localhostCheckBypassed, projectContext });
}

function bodyWithSessionId(request) {
  return {
    ...requestBody(request),
    sessionId: request.params.sessionId
  };
}

function promptHintRouteInput(request) {
  const body = requestBody(request);
  return withoutVibe64User({
    ...(Object.hasOwn(body, "draft") ? { draft: body.draft } : {}),
    operationId: body.operationId,
    ...(Object.hasOwn(body, "originId") ? { originId: body.originId } : {}),
    sessionId: request.params.sessionId
  });
}

function sessionInput(request) {
  return {
    sessionId: request.params.sessionId
  };
}

function temporaryConversationInput(request) {
  return {
    conversationId: request.params.conversationId,
    sessionId: request.params.sessionId
  };
}

/**
 * Transport never names the acting user: the action's input refuses the field, so a body's copy is dropped here.
 * @param {Record<string, unknown>} input
 */
function withoutVibe64User(input) {
  const { vibe64User: _ignored, ...safeInput } = input;
  void _ignored;
  return safeInput;
}

/**
 * The authenticated user a global terminal write runs as.
 * @param {{ vibe64User?: object }} request
 */
function vibe64UserOptions(request) {
  return request.vibe64User ? { vibe64User: request.vibe64User } : {};
}

function firstForwardedHeader(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").split(",")[0]?.trim() || "";
}

function requestPublicRouting(request) {
  return {
    publicHost: firstForwardedHeader(request.headers?.["x-forwarded-host"]) || request.headers?.host || "",
    publicProtocol: firstForwardedHeader(request.headers?.["x-forwarded-proto"]) || request.protocol || ""
  };
}

function firstRequestValue(value) {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function requestQueryValue(request, key) {
  return firstRequestValue(request?.query?.[key] ?? request?.input?.query?.[key] ?? "");
}

function terminalRouteInput(request) {
  return { ...sessionInput(request), terminalSessionId: request.params.terminalSessionId };
}

/** Global terminals belong to no session. */
function globalTerminalRouteInput(request) {
  return { terminalSessionId: request.params.terminalSessionId };
}

function registerVibe64TerminalWebSocketRoutes(fastify, routes, terminals, { localhostCheckBypassed, projectContext }) {
  registerTerminalWebSocketRoute(fastify, {
    localhostCheckBypassed,
    projectContext,
    routePath: `${routes.routeBase}/codex-terminal/:terminalSessionId/ws`,
    service: terminals,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { subscriber, terminalSessionId }) {
      return service.subscribeGlobalCodexTerminal(terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, terminalSessionId }) {
      return service.resizeGlobalCodexTerminal(terminalSessionId, { cols, rows });
    },
    write(service, { data, request, terminalSessionId }) {
      return service.writeGlobalCodexTerminal(
        terminalSessionId,
        data,
        vibe64UserOptions(request)
      );
    }
  });

  registerTerminalWebSocketRoute(fastify, {
    localhostCheckBypassed,
    projectContext,
    routePath: `${routes.routeBase}/sessions/:sessionId/agent-terminal/:terminalSessionId/ws`,
    service: terminals,
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

  registerTerminalWebSocketRoute(fastify, {
    localhostCheckBypassed,
    projectContext,
    routePath: `${routes.routeBase}/sessions/:sessionId/output-runs/:terminalSessionId/terminal/ws`,
    service: terminals,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId, isClosed }) {
      return isClosed() ? { ok: true } : service.subscribeOutputTargetTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId, isClosed }) {
      return isClosed() ? { ok: true } : service.resizeOutputTargetTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeOutputTargetTerminal(sessionId, terminalSessionId, data);
    }
  });
}

export { registerRoutes };
