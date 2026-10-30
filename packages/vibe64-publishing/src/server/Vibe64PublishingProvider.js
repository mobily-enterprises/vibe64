import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createPublishingActions } from "./actions.js";
import { publicationWatchSource } from "./publicationWatch.js";
import { registerRoutes } from "./registerRoutes.js";
import { createPublishingService } from "./service.js";

// The local publishing experience: release orchestration, targets, history,
// keys and confirmation on this computer, built from @local/vibe64-packaging.
const Vibe64PublishingProvider = defineFeature({
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  actions: ({ publishing }) => createPublishingActions({ publishing }),
  id: "vibe64.publishing",
  domain: "vibe64-publishing",
  requires: {
    colleague: "vibe64.colleague",
    http: "runtime.http",
    project: "vibe64.project",
    sourceEditor: "vibe64.source-editor"
  },
  provides: {
    publishing: "vibe64.publishing"
  },
  setup({ colleague, http, project, sourceEditor }, { actionCatalogue }) {
    const publishing = createPublishingService({ project, sourceEditor });
    registerRoutes(http, { publishing });
    colleague.registerWatchSource(publicationWatchSource({ actions: actionCatalogue }));
    return { publishing };
  },
  shutdown(_dependencies, { outputs }) {
    outputs.publishing.keys.lock();
    return outputs.publishing.lanShare.stop();
  }
});

export { Vibe64PublishingProvider };
