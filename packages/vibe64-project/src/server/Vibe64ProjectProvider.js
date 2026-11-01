import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createProjectActions, createVibe64ProjectChangedPublisher } from "./projectActions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import { NO_SAVED_ENV_VALUES, SAVED_ENV_VALUES_TOKEN, assertSavedEnvValueProvider } from "./savedEnvValues.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").SavedEnvValueProvider} SavedEnvValueProvider */

const Vibe64ProjectProvider = defineFeature({
  id: "vibe64.project",
  domain: "vibe64-project",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    logger: "runtime.logger",
    http: "runtime.http"
  },
  // A composed host's saved values for the Development Env.
  optional: {
    savedEnvValueProvider: SAVED_ENV_VALUES_TOKEN
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
   * @param {SavedEnvValueProvider | null} capabilities.savedEnvValueProvider
   */
  setup({ env, events, http, logger, savedEnvValueProvider }) {
    assertSavedEnvValueProvider(savedEnvValueProvider);
    const project = createService({
      env,
      logger,
      publishProjectChanged: createVibe64ProjectChangedPublisher({ events }),
      projectContext: getStudioProjectContext(),
      savedEnvValueProvider: savedEnvValueProvider ?? NO_SAVED_ENV_VALUES
    });
    registerRoutes(http);
    return { project };
  },
  actions({ project }) {
    return createProjectActions({ project });
  }
});

export { Vibe64ProjectProvider };
