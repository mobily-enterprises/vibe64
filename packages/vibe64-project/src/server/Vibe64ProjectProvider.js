import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createProjectActions, createVibe64ProjectChangedPublisher } from "./projectActions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

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
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   */
  setup({ env, events, http, logger }) {
    const project = createService({
      env,
      logger,
      publishProjectChanged: createVibe64ProjectChangedPublisher({ events }),
      projectContext: getStudioProjectContext()
    });
    registerRoutes(http);
    return { project };
  },
  actions({ project }) {
    return createProjectActions({ project });
  }
});

export { Vibe64ProjectProvider };
