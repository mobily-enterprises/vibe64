import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

import {
  ACTION_USAGE_RECORDING_CURRENT_READ,
  ACTION_USAGE_RECORDING_DELETE,
  ACTION_USAGE_RECORDING_DISMISS,
  ACTION_USAGE_RECORDING_INTERACTION_RECORD,
  ACTION_USAGE_RECORDING_LIST,
  ACTION_USAGE_RECORDING_REQUESTS_READ,
  ACTION_USAGE_RECORDING_REQUEST_FUNCTIONS_READ,
  ACTION_USAGE_RECORDING_START,
  ACTION_USAGE_RECORDING_STOP,
  ACTION_USAGE_RECORDING_TARGETS_READ
} from "./usageRecordingActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

/** The URL's session, and its recording when the path names one. */
function recordingInput(request) {
  return {
    sessionId: request.params.sessionId,
    ...(request.params.recordingId ? { recordingId: request.params.recordingId } : {})
  };
}

function pageQuery(query) {
  return {
    ...(query.cursor !== undefined ? { cursor: String(query.cursor) } : {}),
    ...(query.limit !== undefined ? { limit: Number(query.limit) } : {})
  };
}

function startInput(request) {
  const body = requestBody(request);
  return {
    ...recordingInput(request),
    targetId: body.targetId,
    ...(body.parameters !== undefined ? { parameters: body.parameters } : {})
  };
}

function requestsInput(request) {
  const query = requestQuery(request);
  return {
    ...recordingInput(request),
    ...pageQuery(query),
    ...(query.q !== undefined ? { q: String(query.q) } : {}),
    ...(query.includeEmpty !== undefined ? { includeEmpty: ["1", "true"].includes(String(query.includeEmpty)) } : {}),
    ...(query.order !== undefined ? { order: String(query.order) } : {}),
    ...(query.requestId !== undefined ? { requestId: String(query.requestId) } : {})
  };
}

function requestFunctionsInput(request) {
  return {
    ...recordingInput(request),
    requestId: request.params.requestId,
    ...pageQuery(requestQuery(request))
  };
}

function interactionInput(request) {
  const {
    id,
    at,
    label,
    kind,
    componentFile
  } = requestBody(request);
  return {
    ...recordingInput(request),
    id,
    at,
    label,
    ...(kind !== undefined ? { kind } : {}),
    ...(componentFile !== undefined ? { componentFile } : {})
  };
}

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 * @param {StudioProjectContext} options.projectContext
 */
function registerRoutes(http, { localhostCheckBypassed, projectContext }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-usage-recording"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Vibe64 usage recording routes only accept loopback Studio requests.",
      projectContext
    })
  });

  routes.actionRoute("GET", "/usage-recordings/sessions/:sessionId/targets", {
    actionId: ACTION_USAGE_RECORDING_TARGETS_READ,
    buildInput: recordingInput,
    summary: "List the session's Output targets and whether each can be recorded."
  });

  routes.actionRoute("POST", "/usage-recordings/sessions/:sessionId", {
    actionId: ACTION_USAGE_RECORDING_START,
    buildInput: startInput,
    bodyLimit: 16 * 1024,
    summary: "Start recording which project functions run in an Output target."
  });

  routes.actionRoute("GET", "/usage-recordings/sessions/:sessionId/current", {
    actionId: ACTION_USAGE_RECORDING_CURRENT_READ,
    buildInput: recordingInput,
    summary: "Read the session's running or just finished recording."
  });

  routes.actionRoute("GET", "/usage-recordings/sessions/:sessionId", {
    actionId: ACTION_USAGE_RECORDING_LIST,
    buildInput: recordingInput,
    summary: "List the session's recent recordings."
  });

  routes.actionRoute("POST", "/usage-recordings/sessions/:sessionId/:recordingId/stop", {
    actionId: ACTION_USAGE_RECORDING_STOP,
    buildInput: recordingInput,
    bodyLimit: 16 * 1024,
    summary: "Stop a recording; always agrees."
  });

  routes.actionRoute("POST", "/usage-recordings/sessions/:sessionId/:recordingId/dismiss", {
    actionId: ACTION_USAGE_RECORDING_DISMISS,
    buildInput: recordingInput,
    bodyLimit: 16 * 1024,
    summary: "Hide a finished recording from the recording indicator."
  });

  routes.actionRoute("GET", "/usage-recordings/sessions/:sessionId/:recordingId/requests", {
    actionId: ACTION_USAGE_RECORDING_REQUESTS_READ,
    buildInput: requestsInput,
    summary: "List a recording's requests with what each one ran."
  });

  routes.actionRoute("GET", "/usage-recordings/sessions/:sessionId/:recordingId/requests/:requestId/functions", {
    actionId: ACTION_USAGE_RECORDING_REQUEST_FUNCTIONS_READ,
    buildInput: requestFunctionsInput,
    summary: "List the project functions one request ran."
  });

  routes.actionRoute("POST", "/usage-recordings/sessions/:sessionId/:recordingId/interactions", {
    actionId: ACTION_USAGE_RECORDING_INTERACTION_RECORD,
    buildInput: interactionInput,
    bodyLimit: 16 * 1024,
    summary: "Record a Preview interaction during a recording."
  });

  routes.actionRoute("DELETE", "/usage-recordings/sessions/:sessionId/:recordingId", {
    actionId: ACTION_USAGE_RECORDING_DELETE,
    buildInput: recordingInput,
    summary: "Delete a recording, stopping it first."
  });
}

export { registerRoutes };
