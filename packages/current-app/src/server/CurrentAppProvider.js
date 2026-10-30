import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

const CurrentAppProvider = defineFeature({
  id: "vibe64.current-app",
  domain: "vibe64-current-app",
  requires: {
    env: "runtime.env",
    http: "runtime.http",
    project: "vibe64.project"
  },
  provides: {
    currentApp: "vibe64.current-app"
  },
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  setup({ env, http, project }) {
    const currentApp = createService({
      env,
      projectService: project
    });
    registerRoutes(http);
    return { currentApp };
  },
  actions({ currentApp }) {
    return createActions({ currentApp });
  }
});

export { CurrentAppProvider };
