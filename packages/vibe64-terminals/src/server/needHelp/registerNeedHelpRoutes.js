import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import {
  ACTION_ANSWER_NEED_HELP,
  ACTION_CLEAR_NEED_HELP,
  ACTION_RAISE_NEED_HELP,
  needHelpMessageBodyValidator
} from "./needHelpActions.js";

const BODY_LIMIT = 16 * 1024;

/** The message the page sent, for the session its path names; the person comes from the action context, never the body. */
function messageInput(request) {
  return { text: requestBody(request)?.text, sessionId: request.params.sessionId };
}

/**
 * @param {import("@jskit-ai/kernel/server/types").RuntimeHttp} http
 * @param {{ localhostCheckBypassed: boolean, projectContext: object }} options
 */
function registerNeedHelpRoutes(http, { localhostCheckBypassed, projectContext }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-sessions", "need-help"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Vibe64 session routes only accept loopback Studio requests.",
      projectContext
    })
  });
  routes.actionRoute("POST", "/sessions/:sessionId/need-help", {
    actionId: ACTION_RAISE_NEED_HELP,
    body: needHelpMessageBodyValidator,
    bodyLimit: BODY_LIMIT,
    buildInput: messageInput,
    summary: "Raise this session's Need help, or add to the one it has."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/need-help/answer", {
    actionId: ACTION_ANSWER_NEED_HELP,
    body: needHelpMessageBodyValidator,
    bodyLimit: BODY_LIMIT,
    buildInput: messageInput,
    summary: "Answer this session's Need help; its AI is told."
  });
  routes.actionRoute("DELETE", "/sessions/:sessionId/need-help", {
    actionId: ACTION_CLEAR_NEED_HELP,
    buildInput: (request) => ({ sessionId: request.params.sessionId }),
    summary: "Clear this session's Need help."
  });
}

export { registerNeedHelpRoutes };
