import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { requestBody, requestQuery, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { createColleagueActions, colleagueConversationDataSchema, colleagueConversationSelectionSchema } from "./colleagueActions.js";
import { createColleagueService } from "./service.js";
import { COLLEAGUE_NAME_RESOLVER_TOKEN, nameColleague } from "./colleagueName.js";
import { registerColleagueFocus } from "./registerColleagueFocus.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/realtime/server/types").RuntimeRealtime} RuntimeRealtime */
/** @typedef {import("@local/vibe64-accounts/server/types").AccountsService} AccountsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").ColleagueService} ColleagueService */
/** @typedef {import("./types.js").ColleagueBrowserFocus} ColleagueBrowserFocus */
/** @typedef {import("./types.js").ColleagueNameResolver} ColleagueNameResolver */

/** @param {RuntimeHttp} http */
function registerColleagueRoutes(http) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["vibe64-colleague"] }), {
    relativePath: "vibe64/colleague", surface: "app", wrapHandler: vibe64RouteHandler({ projectScoped: false })
  });
  routes.actionRoute("GET", "", { actionId: "vibe64.colleague.state.read", buildInput: requestQuery, summary: "Read your Colleague conversation." });
  routes.actionRoute("POST", "/conversations/fresh", { actionId: "vibe64.colleague.conversation.start-fresh", buildInput: requestBody, summary: "Retain this conversation and start fresh without retrying its requests." });
  routes.actionRoute("GET", "/conversations/history", { actionId: "vibe64.colleague.conversation.history.read", buildInput: requestQuery, summary: "List your previous Colleague conversations." });
  routes.actionRoute("GET", "/conversations/history/page", { actionId: "vibe64.colleague.conversation.history-page.read", buildInput: requestQuery, summary: "Read a page of your retained Colleague history without opening an assistant." });
  routes.actionRoute("GET", "/models", { actionId: "vibe64.assistants.capabilities.list", buildInput: requestQuery, summary: "Read the existing actor-aware model catalogue for Colleague." });
  routes.actionRoute("GET", "/usage/topics", { actionId: "vibe64.colleague.usage.topics.read", buildInput: requestQuery, summary: "Find Vibe64 usage topics shipped in this release." });
  routes.actionRoute("GET", "/usage/guide", { actionId: "vibe64.colleague.usage.guide.read", buildInput: requestQuery, summary: "Read a shipped Vibe64 usage guide." });
  for (const [route, operation] of [["/messages", "message.send"], ["/focus", "focus.update"], ["/stop", "turn.stop"],
    ["/watches/cancel", "watch.cancel"], ["/watches/pause", "watch.pause"], ["/watches/resume", "watch.resume"],
    ["/navigation/ack", "navigation.acknowledge"]]) {
    routes.actionRoute("POST", route, {
      actionId: `vibe64.colleague.${operation}`, buildInput: requestBody, summary: `Colleague ${operation}.`
    });
  }
}

/**
 * The Colleague capability: the service, with its browser conversations
 * carrying the schemas their actions validate.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {AccountsService} dependencies.accounts
 * @param {TerminalsService} dependencies.terminals
 * @param {RuntimeEvents} dependencies.events
 * @param {ColleagueNameResolver} dependencies.resolveName
 * @param {string} dependencies.systemRoot
 */
function createColleague({ actions, accounts, terminals, events, resolveName, systemRoot }) {
  const colleague = createColleagueService({ actions, accounts, terminals, events, resolveName, systemRoot });
  return { ...colleague,
    browserConversations: { ...colleague.browserConversations,
      conversationDataSchema: colleagueConversationDataSchema,
      conversationSelectionSchema: colleagueConversationSelectionSchema }
  };
}

/**
 * Colleague's browser focus: closing it stops following the browser.
 * @param {object} dependencies
 * @param {RuntimeRealtime} dependencies.realtime
 * @param {ActionCatalogue} dependencies.actions
 */
function createColleagueBrowserFocus({ realtime, actions }) {
  return { close: registerColleagueFocus({ realtime, actions }) };
}

const Vibe64ColleagueProvider = defineFeature({
  id: "vibe64.colleague", domain: "vibe64-colleague",
  requires: { accounts: "vibe64.accounts", http: "runtime.http", terminals: "vibe64.terminals", events: "runtime.events" },
  // A composed host's own project views for navigation.open: [{ pane, meaning }],
  // and the name it gives Colleague.
  optional: { navigationPanes: "vibe64.colleague.navigation-panes", resolveName: COLLEAGUE_NAME_RESOLVER_TOKEN },
  provides: { colleague: "vibe64.colleague" },
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  /**
   * @param {object} capabilities
   * @param {AccountsService} capabilities.accounts
   * @param {RuntimeHttp} capabilities.http
   * @param {TerminalsService} capabilities.terminals
   * @param {RuntimeEvents} capabilities.events
   * @param {ColleagueNameResolver | null} capabilities.resolveName
   * @param {{ actionCatalogue: ActionCatalogue }} context
   */
  setup({ accounts, http, terminals, events, resolveName }, { actionCatalogue }) {
    if (resolveName && typeof resolveName !== "function") throw new TypeError("Colleague name resolver must be a function.");
    const colleague = createColleague({ actions: actionCatalogue, accounts, terminals, events, resolveName: resolveName ?? nameColleague,
      systemRoot: getStudioProjectContext().systemRoot });
    registerColleagueRoutes(http);
    return { colleague };
  },
  actions: ({ colleague, navigationPanes }) => createColleagueActions({ colleague, navigationPanes: navigationPanes || [] }),
  /**
   * @param {object} _deps
   * @param {{ outputs: { colleague: ColleagueService } }} context
   */
  shutdown(_deps, { outputs }) { return outputs.colleague.close(); }
});

// An authentication layer composed on top may consume Colleague, so the service
// does not depend on authenticated realtime. This adapter attaches only after
// both owners exist.
const Vibe64ColleagueFocusProvider = defineFeature({
  id: "vibe64.colleague.browser-focus",
  requires: { colleague: "vibe64.colleague", realtime: "runtime.realtime" },
  provides: { browserFocus: "vibe64.colleague.browser-focus" },
  /**
   * @param {object} capabilities
   * @param {RuntimeRealtime} capabilities.realtime
   * @param {{ actionCatalogue: ActionCatalogue }} context
   */
  setup({ realtime }, { actionCatalogue }) {
    return { browserFocus: createColleagueBrowserFocus({ realtime, actions: actionCatalogue }) };
  },
  /**
   * @param {object} _deps
   * @param {{ outputs: { browserFocus: ColleagueBrowserFocus } }} context
   */
  shutdown(_deps, { outputs }) { outputs.browserFocus.close(); }
});

export { Vibe64ColleagueProvider, Vibe64ColleagueFocusProvider, createColleague, createColleagueBrowserFocus, registerColleagueRoutes };
