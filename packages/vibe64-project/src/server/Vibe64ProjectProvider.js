import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createProjectActions, createVibe64ProjectChangedPublisher } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

const Vibe64ProjectProvider = defineFeature({
  id: "vibe64.project",
  domain: "vibe64-project",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    logger: "runtime.logger",
    http: "runtime.http"
  },
  provides: {
    project: "vibe64.project"
  },
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  setup({ env, events, http, logger }) {
    const project = createService({
      env,
      logger,
      publishProjectChanged: createVibe64ProjectChangedPublisher({ events }),
      projectContext: getStudioProjectContext()
    });
    registerRoutes(http, {
      project,
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
    return { project };
  },
  actions({ project }) {
    return createProjectActions({ project });
  }
});

export { Vibe64ProjectProvider };
