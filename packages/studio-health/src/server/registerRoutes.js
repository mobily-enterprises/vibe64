import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { requestBody, requestQuery, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";
import {
  crashesAcknowledgeInputValidator,
  studioHealthQueryInputValidator,
  studioToolsQueryInputValidator
} from "./inputSchemas.js";
import {
  ACTION_ACKNOWLEDGE_CRASHES,
  ACTION_CHECK_STUDIO_TOOLS,
  ACTION_LIST_CRASHES,
  ACTION_READ_CRASH_SUMMARY,
  ACTION_READ_STUDIO_HEALTH
} from "./studioHealthActions.js";

/** The acknowledgement's one field; the acting person comes from the action context, never the body. */
function acknowledgeInput(request) {
  return { through: requestBody(request).through };
}

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

/**
 * @param {RuntimeHttp} http
 * @param {object} options
 * @param {boolean} options.localhostCheckBypassed
 */
function registerRoutes(http, { localhostCheckBypassed }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "health"] }), {
    relativePath: "studio/health",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localhostCheckBypassed,
      localRequestMessage: "Studio health is available only to the local Vibe64 editor.",
      projectScoped: false
    })
  });

  routes.actionRoute("GET", "", {
    actionId: ACTION_READ_STUDIO_HEALTH,
    buildInput: requestQuery,
    query: studioHealthQueryInputValidator,
    summary: "Inspect Vibe64 host platform health."
  });

  routes.actionRoute("GET", "/tools", {
    actionId: ACTION_CHECK_STUDIO_TOOLS,
    buildInput: requestQuery,
    query: studioToolsQueryInputValidator,
    summary: "Check whether the named tools run on this computer."
  });

  routes.actionRoute("GET", "/crashes/summary", {
    actionId: ACTION_READ_CRASH_SUMMARY,
    buildInput: requestQuery,
    query: studioHealthQueryInputValidator,
    summary: "Read the crashes nobody has acknowledged yet, for the editor's banner."
  });

  routes.actionRoute("GET", "/crashes", {
    actionId: ACTION_LIST_CRASHES,
    buildInput: requestQuery,
    query: studioHealthQueryInputValidator,
    summary: "Read every recorded crash of the editor server, newest first."
  });

  routes.actionRoute("POST", "/crashes/acknowledge", {
    actionId: ACTION_ACKNOWLEDGE_CRASHES,
    body: crashesAcknowledgeInputValidator,
    bodyLimit: 1024,
    buildInput: acknowledgeInput,
    summary: "Record who acknowledged the crashes, up to the newest they were shown."
  });
}

export { registerRoutes };
