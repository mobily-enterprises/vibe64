import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import { AI_TASK_ACTIONS } from "./aiTaskActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

function sessionInput(request) {
  return { sessionId: request.params.sessionId };
}

function taskInput(request) {
  return { sessionId: request.params.sessionId, taskId: request.params.taskId };
}

function withoutUser(body) {
  const { vibe64User: _vibe64User, ...input } = body;
  return input;
}

/**
 * @param {RuntimeHttp} http
 * @param {object} capabilities
 * @param {boolean} capabilities.localhostCheckBypassed
 * @param {StudioProjectContext} capabilities.projectContext
 */
function registerRoutes(http, { localhostCheckBypassed, projectContext }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-ai-tasks"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Vibe64 AI task routes only accept requests from this computer.",
      projectContext
    })
  });
  routes.actionRoute("GET", "/sessions/:sessionId/ai-tasks", {
    actionId: AI_TASK_ACTIONS.LIST,
    buildInput: sessionInput,
    summary: "List this session's AI tasks."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/ai-tasks", {
    actionId: AI_TASK_ACTIONS.START,
    buildInput: request => ({ ...withoutUser(requestBody(request)), ...sessionInput(request) }),
    summary: "Start an AI task, or reopen the one open for this problem."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/ai-tasks/:taskId", {
    actionId: AI_TASK_ACTIONS.READ,
    buildInput: taskInput,
    summary: "Read one AI task."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/ai-tasks/:taskId/cancel", {
    actionId: AI_TASK_ACTIONS.CANCEL,
    buildInput: taskInput,
    summary: "Cancel an AI task."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/ai-tasks/:taskId/check", {
    actionId: AI_TASK_ACTIONS.CHECK,
    buildInput: request => ({ ...withoutUser(requestBody(request)), ...taskInput(request) }),
    summary: "Run an AI task's check now."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/ai-tasks/:taskId/continue", {
    actionId: AI_TASK_ACTIONS.CONTINUE,
    buildInput: taskInput,
    summary: "Send an AI task back to its AI."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/ai-tasks/:taskId/finish", {
    actionId: AI_TASK_ACTIONS.FINISH,
    buildInput: taskInput,
    summary: "Finish an AI task a person decides."
  });
  routes.actionRoute("DELETE", "/sessions/:sessionId/ai-tasks/:taskId", {
    actionId: AI_TASK_ACTIONS.CLOSE,
    buildInput: taskInput,
    summary: "Close an AI task that has ended."
  });
}

export {
  registerRoutes
};
