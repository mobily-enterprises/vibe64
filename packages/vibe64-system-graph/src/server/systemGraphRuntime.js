import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";

import { createService } from "./service.js";
import { createUsageService } from "./usageService.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

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
  const {
    readStatus,
    readArchitecture,
    readRefreshStatus,
    cancelRefresh,
    refresh
  } = createService({
    project,
    logger,
    publishSessionChanged: createSessionChangedPublisher({ events })
  });
  const {
    readUsageEntries,
    readUsageWeb,
    readUsageFunction,
    joinUsage,
    matchUsageRoutes
  } = createUsageService({ project });
  return Object.freeze({
    readStatus,
    readArchitecture,
    readRefreshStatus,
    cancelRefresh,
    refresh,
    readUsageEntries,
    readUsageWeb,
    readUsageFunction,
    joinUsage,
    matchUsageRoutes
  });
}

export { createSystemGraph };
