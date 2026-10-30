import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { defineFeature } from "@jskit-ai/kernel/server/features";

import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import { createSystemGraphActions } from "./actions.js";
import { registerUsageRoutes } from "./usageRoutes.js";
import { createUsageService } from "./usageWeb.js";

const Vibe64SystemGraphProvider = defineFeature({
  id: "vibe64.system-graph",
  domain: "vibe64-system-graph",
  requires: {
    events: "runtime.events",
    logger: "runtime.logger",
    http: "runtime.http",
    project: "vibe64.project"
  },
  provides: {
    systemGraph: "vibe64.system-graph"
  },
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  setup({ events, logger, http, project }) {
    // One System Graph capability: Architecture reads and refresh, plus the
    // usage queries over the same session's Genesis snapshot.
    const systemGraph = Object.freeze({
      ...createService({
        projectService: project,
        logger,
        publishSessionChanged: createSessionChangedPublisher(events)
      }),
      ...createUsageService({ projectService: project })
    });
    registerRoutes(http, {
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
    registerUsageRoutes(http, {
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
    return { systemGraph };
  },
  actions: createSystemGraphActions
});

export {
  Vibe64SystemGraphProvider
};
