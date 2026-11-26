import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import {
  ACTION_COLLECT_PROJECT_PROBLEM_REPORT,
  ACTION_COLLECT_WORKSPACE_PROBLEM_REPORT,
  ACTION_SEND_PROBLEM_REPORT,
  collectProjectInputValidator,
  collectWorkspaceInputValidator,
  sendInputValidator
} from "./problemReportActions.js";

// The page's errors and the note are the largest things a page sends.
const COLLECT_BODY_LIMIT = 256 * 1024;
const SEND_BODY_LIMIT = 32 * 1024;
const LOCAL_ONLY = "Report a problem is available only to the Vibe64 editor.";

/** The body's fields; the reporting person comes from the action context, never the body. */
function bodyWithoutUser(request) {
  const { vibe64User: _user, ...body } = requestBody(request) || {};
  return body;
}

/**
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {{ localhostCheckBypassed: boolean, projectContext: object }} options
 */
function registerProblemReportRoutes(http, { localhostCheckBypassed, projectContext }) {
  const tags = ["studio", "problem-report"];
  const project = createActionRouteScope(vibe64RouteHttp(http, { tags }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({ localhostCheckBypassed, localRequestMessage: LOCAL_ONLY, projectContext })
  });
  project.actionRoute("POST", "/problem-report", {
    actionId: ACTION_COLLECT_PROJECT_PROBLEM_REPORT,
    body: collectProjectInputValidator,
    bodyLimit: COLLECT_BODY_LIMIT,
    buildInput: bodyWithoutUser,
    summary: "Collect a masked report of what the editor saw in this project, for the person to review."
  });

  const workspace = createActionRouteScope(vibe64RouteHttp(http, { tags }), {
    relativePath: "studio/problem-report",
    surface: "app",
    wrapHandler: vibe64RouteHandler({ localhostCheckBypassed, localRequestMessage: LOCAL_ONLY, projectScoped: false })
  });
  workspace.actionRoute("POST", "", {
    actionId: ACTION_COLLECT_WORKSPACE_PROBLEM_REPORT,
    body: collectWorkspaceInputValidator,
    bodyLimit: COLLECT_BODY_LIMIT,
    buildInput: bodyWithoutUser,
    summary: "Collect a masked report of what the editor saw outside a project, for the person to review."
  });
  workspace.actionRoute("POST", "/send", {
    actionId: ACTION_SEND_PROBLEM_REPORT,
    body: sendInputValidator,
    bodyLimit: SEND_BODY_LIMIT,
    buildInput: bodyWithoutUser,
    summary: "Send the report the person reviewed through the host's delivery."
  });
}

export { registerProblemReportRoutes };
