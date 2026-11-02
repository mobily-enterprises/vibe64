import { defineFeature } from "@jskit-ai/kernel/server/features";

import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";
import { resolveStudioAppRoot } from "@local/vibe64-core/server/studioRoots";

import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import { createStudioHealthActions } from "./studioHealthActions.js";

/** @typedef {import("@local/vibe64-accounts/server/types").ConnectionsService} ConnectionsService */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("./types.js").StudioHealthService} StudioHealthService */

const StudioHealthFeature = defineFeature({
  id: "vibe64.studio-health",
  domain: "vibe64-studio-health",
  requires: {
    connections: "vibe64.connections",
    env: "runtime.env",
    http: "runtime.http",
    project: "vibe64.project"
  },
  provides: {
    studioHealth: "vibe64.studio-health"
  },
  /**
   * @param {object} capabilities
   * @param {ConnectionsService} capabilities.connections
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeHttp} capabilities.http
   * @param {ProjectService} capabilities.project
   */
  setup({
    connections,
    env,
    http,
    project
  }) {
    const studioHealth = createService({
      connections,
      env,
      project,
      studioRoot: resolveStudioAppRoot({ env })
    });
    registerRoutes(http, { localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }) });
    return { studioHealth };
  },
  /**
   * @param {object} capabilities
   * @param {StudioHealthService} capabilities.studioHealth
   */
  actions({ studioHealth }) {
    return createStudioHealthActions({ studioHealth });
  }
});

export { StudioHealthFeature };
