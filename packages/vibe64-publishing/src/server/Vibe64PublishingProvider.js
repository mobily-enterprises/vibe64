import { defineFeature } from "@jskit-ai/kernel/server/features";

// The local publishing experience: release orchestration, targets, history and
// confirmation for this machine, built from @local/vibe64-packaging.
const Vibe64PublishingProvider = defineFeature({
  id: "vibe64.publishing",
  domain: "vibe64-publishing",
  requires: {
    project: "vibe64.project"
  },
  provides: {
    publishing: "vibe64.publishing"
  },
  setup() {
    return { publishing: Object.freeze({}) };
  }
});

export { Vibe64PublishingProvider };
