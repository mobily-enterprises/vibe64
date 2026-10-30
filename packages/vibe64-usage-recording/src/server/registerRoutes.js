import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

const sessionRoute = "/usage-recordings/sessions/:sessionId";
const pageQuery = (query = {}) => ({
  ...(query.cursor !== undefined ? { cursor: String(query.cursor) } : {}),
  ...(query.limit !== undefined ? { limit: Number(query.limit) } : {})
});

function registerRoutes(http, { projectContext = null } = {}) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-usage-recording"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 usage recording routes only accept loopback Studio requests.",
      projectContext
    })
  });
  const ids = (request) => ({ sessionId: request.params.sessionId, ...(request.params.recordingId ? { recordingId: request.params.recordingId } : {}) });
  const body = (request) => requestBody(request);
  for (const [method, suffix, operation, summary, buildInput = ids] of [
    ["GET", "/targets", "targets.read", "List the session's Output targets and whether each can be recorded."],
    ["POST", "", "start", "Start recording which project functions run in an Output target.",
      (request) => ({ ...ids(request), targetId: body(request).targetId, ...(body(request).parameters !== undefined ? { parameters: body(request).parameters } : {}) })],
    ["GET", "/current", "current.read", "Read the session's running or just finished recording."],
    ["GET", "", "list", "List the session's recent recordings."],
    ["POST", "/:recordingId/stop", "stop", "Stop a recording; always agrees."],
    ["POST", "/:recordingId/dismiss", "dismiss", "Hide a finished recording from the recording indicator."],
    ["GET", "/:recordingId/requests", "requests.read", "List a recording's requests with what each one ran.",
      (request) => {
        const query = requestQuery(request);
        return {
          ...ids(request), ...pageQuery(query),
          ...(query.q !== undefined ? { q: String(query.q) } : {}),
          ...(query.includeEmpty !== undefined ? { includeEmpty: ["1", "true"].includes(String(query.includeEmpty)) } : {})
        };
      }],
    ["GET", "/:recordingId/requests/:requestId/functions", "request-functions.read", "List the project functions one request ran.",
      (request) => ({ ...ids(request), requestId: request.params.requestId, ...pageQuery(requestQuery(request)) })],
    ["POST", "/:recordingId/interactions", "interaction.record", "Record a Preview interaction during a recording.",
      (request) => {
        const { id, at, label, kind, componentFile } = body(request);
        return { ...ids(request), id, at, label, ...(kind !== undefined ? { kind } : {}), ...(componentFile !== undefined ? { componentFile } : {}) };
      }],
    ["DELETE", "/:recordingId", "delete", "Delete a recording, stopping it first."]
  ]) routes.actionRoute(method, `${sessionRoute}${suffix}`, {
    actionId: `vibe64.usage-recording.${operation}`,
    buildInput,
    ...(method === "POST" ? { bodyLimit: 16 * 1024 } : {}),
    summary
  });
}

export { registerRoutes };
