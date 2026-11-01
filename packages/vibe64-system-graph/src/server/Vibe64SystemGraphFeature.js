import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { defineFeature } from "@jskit-ai/kernel/server/features";

import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import { createSystemGraphActions } from "./systemGraphActions.js";
import { registerUsageRoutes } from "./usageRoutes.js";
import { createUsageService } from "./usageService.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * One System Graph capability: Architecture reads and refresh, plus the
 * usage queries over the same session's Genesis snapshot.
 * @param {object} dependencies
 * @param {RuntimeEvents} dependencies.events
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 */
function createSystemGraph({
  events,
  logger,
  project
}) {
  const { readStatus, readArchitecture, readRefreshStatus, cancelRefresh, refresh } = createService({
    project,
    logger,
    publishSessionChanged: createSessionChangedPublisher(events)
  });
  const { readUsageEntries, readUsageWeb, readUsageFunction, joinUsage } = createUsageService({ project });
  return Object.freeze({
    readStatus,
    readArchitecture,
    readRefreshStatus,
    cancelRefresh,
    refresh,
    readUsageEntries,
    readUsageWeb,
    readUsageFunction,
    joinUsage
  });
}

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
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
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
  actions: createSystemGraphActions
});

export {
  Vibe64SystemGraphFeature,
  createSystemGraph
};
