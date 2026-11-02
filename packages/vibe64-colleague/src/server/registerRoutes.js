import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { requestBody, requestQuery, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";
import {
  ACTION_COLLEAGUE_CONVERSATION_HISTORY_PAGE_READ,
  ACTION_COLLEAGUE_CONVERSATION_HISTORY_READ,
  ACTION_COLLEAGUE_CONVERSATION_START_FRESH,
  ACTION_COLLEAGUE_FOCUS_UPDATE,
  ACTION_COLLEAGUE_MESSAGE_SEND,
  ACTION_COLLEAGUE_NAVIGATION_ACKNOWLEDGE,
  ACTION_COLLEAGUE_STATE_READ,
  ACTION_COLLEAGUE_TURN_STOP,
  ACTION_COLLEAGUE_USAGE_GUIDE_READ,
  ACTION_COLLEAGUE_USAGE_TOPICS_READ,
  ACTION_COLLEAGUE_WATCH_CANCEL,
  ACTION_COLLEAGUE_WATCH_PAUSE,
  ACTION_COLLEAGUE_WATCH_RESUME
} from "./colleagueActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

// The sessions package's assistant model catalogue, which Colleague's model picker reads.
const ACTION_ASSISTANT_CAPABILITIES_LIST = "vibe64.assistants.capabilities.list";

/**
 * Colleague's HTTP routes: one action route per Colleague operation the browser calls.
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 */
function registerRoutes(http, { localhostCheckBypassed }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["vibe64-colleague"] }), {
    relativePath: "vibe64/colleague",
    surface: "app",
    wrapHandler: vibe64RouteHandler({ localhostCheckBypassed, projectScoped: false })
  });
  routes.actionRoute("GET", "", {
    actionId: ACTION_COLLEAGUE_STATE_READ,
    buildInput: requestQuery,
    summary: "Read your Colleague conversation."
  });
  routes.actionRoute("POST", "/conversations/fresh", {
    actionId: ACTION_COLLEAGUE_CONVERSATION_START_FRESH,
    buildInput: requestBody,
    summary: "Retain this conversation and start fresh without retrying its requests."
  });
  routes.actionRoute("GET", "/conversations/history", {
    actionId: ACTION_COLLEAGUE_CONVERSATION_HISTORY_READ,
    buildInput: requestQuery,
    summary: "List your previous Colleague conversations."
  });
  routes.actionRoute("GET", "/conversations/history/page", {
    actionId: ACTION_COLLEAGUE_CONVERSATION_HISTORY_PAGE_READ,
    buildInput: requestQuery,
    summary: "Read a page of your retained Colleague history without opening an assistant."
  });
  routes.actionRoute("GET", "/models", {
    actionId: ACTION_ASSISTANT_CAPABILITIES_LIST,
    buildInput: requestQuery,
    summary: "Read the existing actor-aware model catalogue for Colleague."
  });
  routes.actionRoute("GET", "/usage/topics", {
    actionId: ACTION_COLLEAGUE_USAGE_TOPICS_READ,
    buildInput: requestQuery,
    summary: "Find Vibe64 usage topics shipped in this release."
  });
  routes.actionRoute("GET", "/usage/guide", {
    actionId: ACTION_COLLEAGUE_USAGE_GUIDE_READ,
    buildInput: requestQuery,
    summary: "Read a shipped Vibe64 usage guide."
  });
  routes.actionRoute("POST", "/messages", {
    actionId: ACTION_COLLEAGUE_MESSAGE_SEND,
    buildInput: requestBody,
    summary: "Send a message to Colleague."
  });
  routes.actionRoute("POST", "/focus", {
    actionId: ACTION_COLLEAGUE_FOCUS_UPDATE,
    buildInput: requestBody,
    summary: "Tell Colleague what this browser shows."
  });
  routes.actionRoute("POST", "/stop", {
    actionId: ACTION_COLLEAGUE_TURN_STOP,
    buildInput: requestBody,
    summary: "Stop Colleague's current turn."
  });
  routes.actionRoute("POST", "/watches/cancel", {
    actionId: ACTION_COLLEAGUE_WATCH_CANCEL,
    buildInput: requestBody,
    summary: "Cancel one of your Colleague watches."
  });
  routes.actionRoute("POST", "/watches/pause", {
    actionId: ACTION_COLLEAGUE_WATCH_PAUSE,
    buildInput: requestBody,
    summary: "Pause one of your Colleague watches."
  });
  routes.actionRoute("POST", "/watches/resume", {
    actionId: ACTION_COLLEAGUE_WATCH_RESUME,
    buildInput: requestBody,
    summary: "Resume one of your paused Colleague watches."
  });
  routes.actionRoute("POST", "/navigation/ack", {
    actionId: ACTION_COLLEAGUE_NAVIGATION_ACKNOWLEDGE,
    buildInput: requestBody,
    summary: "Report how this browser carried out a Colleague navigation command."
  });
}

export { registerRoutes };
