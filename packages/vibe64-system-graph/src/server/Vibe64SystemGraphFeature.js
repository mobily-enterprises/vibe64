import { defineFeature } from "@jskit-ai/kernel/server/features";

import { registerRoutes } from "./registerRoutes.js";
import { createSystemGraph } from "./systemGraphRuntime.js";
import { createSystemGraphActions } from "./systemGraphActions.js";
import { registerUsageRoutes } from "./usageRoutes.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").SystemGraphService} SystemGraphService */

const Vibe64SystemGraphFeature = defineFeature({
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
  /**
   * @param {object} capabilities
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeLogger} capabilities.logger
   * @param {RuntimeHttp} capabilities.http
   * @param {ProjectService} capabilities.project
   */
  setup({
    events,
    logger,
    http,
    project
  }) {
    const systemGraph = createSystemGraph({
      events,
      logger,
      project
    });
    registerRoutes(http);
    registerUsageRoutes(http);
    return { systemGraph };
  },
  /**
   * @param {object} capabilities
   * @param {SystemGraphService} capabilities.systemGraph
   */
  actions({ systemGraph }) {
    return createSystemGraphActions({ systemGraph });
  }
});

export { Vibe64SystemGraphFeature };
