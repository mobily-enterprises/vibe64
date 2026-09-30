import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import { createColleagueActions } from "./actions.js";
import { createColleagueService } from "./service.js";

const Vibe64ColleagueProvider = defineFeature({
  id: "vibe64.colleague", domain: "vibe64-colleague",
  requires: { accounts: "vibe64.accounts", http: "runtime.http", terminals: "vibe64.terminals", events: "runtime.events" },
  provides: { colleague: "vibe64.colleague" },
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  setup({ accounts, http, terminals, events }, { actionCatalogue }) {
    const colleague = createColleagueService({ actions: actionCatalogue, accounts, terminals, events, systemRoot: getStudioProjectContext().systemRoot });
    const routes = createVibe64FeatureRoutes(http, {
      projectScoped: false, routeRelativePath: "vibe64/colleague", routeSurface: "app", tags: ["vibe64-colleague"]
    });
    routes.actionRoute("GET", "", { actionId: "vibe64.colleague.state.read", buildInput: routes.requestQuery, summary: "Read your Colleague conversation." });
    routes.actionRoute("GET", "/models", { actionId: "vibe64.assistants.capabilities.list", buildInput: routes.requestQuery, summary: "Read the existing actor-aware model catalogue for Colleague." });
    routes.actionRoute("GET", "/usage/topics", { actionId: "vibe64.colleague.usage.topics.read", buildInput: routes.requestQuery, summary: "Find Vibe64 usage topics shipped in this release." });
    routes.actionRoute("GET", "/usage/guide", { actionId: "vibe64.colleague.usage.guide.read", buildInput: routes.requestQuery, summary: "Read a shipped Vibe64 usage guide." });
    for (const [route, operation] of [["/messages", "message.send"], ["/focus", "focus.update"], ["/stop", "turn.stop"], ["/model", "model.select"], ["/watches/cancel", "watch.cancel"], ["/watches/resume", "watch.resume"], ["/navigation/ack", "navigation.acknowledge"]]) {
      routes.actionRoute("POST", route, {
        actionId: `vibe64.colleague.${operation}`, buildInput: routes.requestBody, summary: `Colleague ${operation}.`
      });
    }
    return { colleague };
  },
  actions: ({ colleague }) => createColleagueActions(colleague),
  shutdown(_deps, { outputs }) { return outputs.colleague.close(); }
});

export { Vibe64ColleagueProvider };
