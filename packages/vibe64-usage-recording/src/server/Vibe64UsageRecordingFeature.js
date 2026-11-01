import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createUsageRecordingActions } from "./usageRecordingActions.js";
import { USAGE_RECORDING_ADMISSION_TOKEN, admitUsageRecording } from "./admission.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * The usage recording capability: the service and the admission decision it uses.
 * @param {object} dependencies
 * @param {typeof admitUsageRecording} dependencies.admission
 * @param {RuntimeEvents} dependencies.events
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.projectService
 * @param {TerminalsService} dependencies.terminals
 */
function createUsageRecording({
  admission,
  events,
  logger,
  projectService,
  terminals
}) {
  const {
    readTargets,
    start,
    readCurrent,
    stop,
    dismiss,
    list,
    readRequests,
    readRequestFunctions,
    recordInteraction,
    delete: deleteRecording
  } = createService({
    admission,
    events,
    logger,
    projectService,
    terminals
  });
  return Object.freeze({
    admit: admission,
    readTargets,
    start,
    readCurrent,
    stop,
    dismiss,
    list,
    readRequests,
    readRequestFunctions,
    recordInteraction,
    delete: deleteRecording
  });
}

const Vibe64UsageRecordingFeature = defineFeature({
  id: "vibe64.usage-recording",
  domain: "vibe64-usage-recording",
  requires: {
    events: "runtime.events",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    terminals: "vibe64.terminals"
  },
  // A composed host may replace the admission decision; the default admits.
  optional: { admission: USAGE_RECORDING_ADMISSION_TOKEN },
  provides: { usageRecording: "vibe64.usage-recording" },
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  /**
   * @param {object} capabilities
   * @param {typeof admitUsageRecording | null} capabilities.admission
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {TerminalsService} capabilities.terminals
   */
  setup({
    admission,
    events,
    http,
    logger,
    project,
    terminals
  }) {
    const admit = admission || admitUsageRecording;
    const usageRecording = createUsageRecording({
      admission: admit,
      events,
      logger,
      projectService: project,
      terminals
    });
    registerRoutes(http);
    return { usageRecording };
  },
  actions: createUsageRecordingActions
});

export { Vibe64UsageRecordingFeature, createUsageRecording };
