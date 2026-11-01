import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createProjectActions, createVibe64ProjectChangedPublisher } from "./projectActions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import { NO_SAVED_ENV_VALUES, PROJECT_SAVED_ENV_VALUES_TOKEN, assertSavedEnvValues } from "./savedEnvValues.js";
import {
  LOCAL_PROJECT_RESOURCES,
  PROJECT_RESOURCE_ENVIRONMENT_TOKEN,
  assertResourceEnvironmentProvider
} from "./resourceEnvironment.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").SavedEnvValues} SavedEnvValues */
/** @typedef {import("./types.js").ProjectResourceEnvironment} ProjectResourceEnvironment */

const Vibe64ProjectFeature = defineFeature({
  id: "vibe64.project",
  domain: "vibe64-project",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    logger: "runtime.logger",
    http: "runtime.http"
  },
  // A composed host's managed resources and saved values for the Development Env.
  optional: {
    resourceEnvironmentProvider: PROJECT_RESOURCE_ENVIRONMENT_TOKEN,
    savedEnvValues: PROJECT_SAVED_ENV_VALUES_TOKEN
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
   * @param {ProjectResourceEnvironment | null} capabilities.resourceEnvironmentProvider
   * @param {SavedEnvValues | null} capabilities.savedEnvValues
   */
  setup({
    env,
    events,
    http,
    logger,
    resourceEnvironmentProvider,
    savedEnvValues
  }) {
    assertResourceEnvironmentProvider(resourceEnvironmentProvider);
    assertSavedEnvValues(savedEnvValues);
    const project = createService({
      env,
      logger,
      publishProjectChanged: createVibe64ProjectChangedPublisher({ events }),
      projectContext: getStudioProjectContext(),
      resourceEnvironmentProvider: resourceEnvironmentProvider ?? LOCAL_PROJECT_RESOURCES,
      savedEnvValues: savedEnvValues ?? NO_SAVED_ENV_VALUES
    });
    registerRoutes(http);
    return { project };
  },
  actions({ project }) {
    return createProjectActions({ project });
  }
});

export { Vibe64ProjectFeature };
