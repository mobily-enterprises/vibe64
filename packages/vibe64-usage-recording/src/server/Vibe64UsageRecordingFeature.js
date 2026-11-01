import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  USAGE_RECORDING_ADMISSION_TOKEN,
  admitUsageRecording,
  assertUsageRecordingAdmission
} from "./admission.js";
import { registerRoutes } from "./registerRoutes.js";
import { createUsageRecordingActions } from "./usageRecordingActions.js";
import { createUsageRecording } from "./usageRecordingRuntime.js";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./admission.js").UsageRecordingAdmission} UsageRecordingAdmission */
/** @typedef {import("./types.js").UsageRecordingService} UsageRecordingService */

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
  optional: {
    admission: USAGE_RECORDING_ADMISSION_TOKEN
  },
  provides: {
    usageRecording: "vibe64.usage-recording"
  },
  /**
   * @param {object} capabilities
   * @param {UsageRecordingAdmission | null} capabilities.admission
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
    assertUsageRecordingAdmission(admission);
    const usageRecording = createUsageRecording({
      admission: admission ?? admitUsageRecording,
      events,
      logger,
      project,
      terminals
    });
    registerRoutes(http, { projectContext: getStudioProjectContext() });
    return { usageRecording };
  },
  /**
   * @param {object} capabilities
   * @param {UsageRecordingService} capabilities.usageRecording
   */
  actions({ usageRecording }) {
    return createUsageRecordingActions({ usageRecording });
  }
});

export { Vibe64UsageRecordingFeature };
