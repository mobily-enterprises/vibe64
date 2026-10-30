import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createUsageRecordingActions } from "./actions.js";
import { USAGE_RECORDING_ADMISSION_TOKEN, admitUsageRecording } from "./admission.js";
import { registerRoutes } from "./registerRoutes.js";

const Vibe64UsageRecordingProvider = defineFeature({
  id: "vibe64.usage-recording",
  domain: "vibe64-usage-recording",
  requires: { http: "runtime.http" },
  // A composed host may replace the admission decision; the default admits.
  optional: { admission: USAGE_RECORDING_ADMISSION_TOKEN },
  provides: { usageRecording: "vibe64.usage-recording" },
  actionDefaults: { channels: ["api", "automation", "internal"], surfaces: ["app"] },
  setup({ http, admission }) {
    registerRoutes(http, { routeRelativePath: "vibe64", routeSurface: "app" });
    return { usageRecording: Object.freeze({ admit: admission || admitUsageRecording }) };
  },
  actions: createUsageRecordingActions
});

export { Vibe64UsageRecordingProvider };
