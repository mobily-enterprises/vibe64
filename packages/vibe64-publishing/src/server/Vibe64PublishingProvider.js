import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createPublishingActions } from "./publishingActions.js";
import { publicationWatchSource } from "./publicationWatch.js";
import { registerRoutes } from "./registerRoutes.js";
import { createPublishingService } from "./service.js";

/** @typedef {import("./types.js").PublishingService} PublishingService */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@local/vibe64-colleague/server/types").ColleagueService} ColleagueService */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */

// The local publishing experience: release orchestration, targets, history,
// keys and confirmation on this computer, built from @local/vibe64-packaging.
const Vibe64PublishingProvider = defineFeature({
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  actions: ({ publishing }) => createPublishingActions({ publishing }),
  id: "vibe64.publishing",
  domain: "vibe64-publishing",
  requires: {
    colleague: "vibe64.colleague",
    http: "runtime.http",
    project: "vibe64.project",
    sourceEditor: "vibe64.source-editor"
  },
  provides: {
    publishing: "vibe64.publishing"
  },
  /**
   * @param {object} capabilities
   * @param {ColleagueService} capabilities.colleague
   * @param {RuntimeHttp} capabilities.http
   * @param {ProjectService} capabilities.project
   * @param {SourceEditorService} capabilities.sourceEditor
   * @param {{ actionCatalogue: ActionCatalogue }} context
   */
  setup({ colleague, http, project, sourceEditor }, { actionCatalogue }) {
    const publishing = createPublishingService({ project, sourceEditor });
    registerRoutes(http, { publishing });
    colleague.registerWatchSource(publicationWatchSource({ actions: actionCatalogue }));
    return { publishing };
  },
  /**
   * @param {object} _dependencies
   * @param {{ outputs: { publishing: PublishingService } }} context
   */
  shutdown(_dependencies, { outputs }) {
    outputs.publishing.keys.lock();
    return outputs.publishing.lanShare.stop();
  }
});

export { Vibe64PublishingProvider };
