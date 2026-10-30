import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createUsageRecordingActions } from "./actions.js";
import { USAGE_RECORDING_ADMISSION_TOKEN, admitUsageRecording } from "./admission.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";

const Vibe64UsageRecordingProvider = defineFeature({
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
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  setup({ admission, events, http, logger, project, terminals }) {
    const admit = admission || admitUsageRecording;
    const service = createService({ admission: admit, events, logger, projectService: project, terminals });
    registerRoutes(http, { routeRelativePath: "vibe64", routeSurface: "app" });
    return { usageRecording: Object.freeze({ admit, ...service }) };
  },
  actions: createUsageRecordingActions
});

export { Vibe64UsageRecordingProvider };
