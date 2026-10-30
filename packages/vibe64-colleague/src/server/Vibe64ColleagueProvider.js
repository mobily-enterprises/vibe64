import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import { requestBody, requestQuery, vibe64RouteHandler, vibe64RouteHttp } from "@local/vibe64-core/server/featureRoutes";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { createColleagueActions, colleagueConversationDataSchema, colleagueConversationSelectionSchema } from "./actions.js";
import { createColleagueService } from "./service.js";
import { registerColleagueFocus } from "./registerColleagueFocus.js";

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

const Vibe64ColleagueProvider = defineFeature({
  id: "vibe64.colleague", domain: "vibe64-colleague",
  requires: { accounts: "vibe64.accounts", http: "runtime.http", terminals: "vibe64.terminals", events: "runtime.events" },
  // A composed host's own project views for navigation.open: [{ pane, meaning }].
  optional: { navigationPanes: "vibe64.colleague.navigation-panes" },
  provides: { colleague: "vibe64.colleague" },
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  setup({ accounts, http, terminals, events }, { actionCatalogue }) {
    const colleague = createColleagueService({ actions: actionCatalogue, accounts, terminals, events, systemRoot: getStudioProjectContext().systemRoot });
    registerColleagueRoutes(http);
    return { colleague: { ...colleague,
      browserConversations: { ...colleague.browserConversations,
        conversationDataSchema: colleagueConversationDataSchema,
        conversationSelectionSchema: colleagueConversationSelectionSchema }
    } };
  },
  actions: ({ colleague, navigationPanes }) => createColleagueActions(colleague, { navigationPanes: navigationPanes || [] }),
  shutdown(_deps, { outputs }) { return outputs.colleague.close(); }
});

// An authentication layer composed on top may consume Colleague, so the service
// does not depend on authenticated realtime. This adapter attaches only after
// both owners exist.
const Vibe64ColleagueFocusProvider = defineFeature({
  id: "vibe64.colleague.browser-focus",
  requires: { colleague: "vibe64.colleague", realtime: "runtime.realtime" },
  provides: { browserFocus: "vibe64.colleague.browser-focus" },
  setup({ realtime }, { actionCatalogue }) {
    return { browserFocus: { close: registerColleagueFocus({ realtime, actions: actionCatalogue }) } };
  },
  shutdown(_deps, { outputs }) { outputs.browserFocus.close(); }
});

export { Vibe64ColleagueProvider, Vibe64ColleagueFocusProvider, registerColleagueRoutes };
