import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createPublishingActions } from "./publishingActions.js";
import { publicationWatchSource } from "./publicationWatch.js";
import { registerRoutes } from "./registerRoutes.js";
import { createPublishingService } from "./service.js";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";

/** @typedef {import("./types.js").PublishingService} PublishingService */
/** @typedef {import("@jskit-ai/kernel/server/types").FeatureSetupContext} FeatureSetupContext */
/** @typedef {import("@local/vibe64-colleague/server/types").ColleagueService} ColleagueService */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * The local publishing experience: release orchestration, targets, history,
 * keys and confirmation on this computer, built from @local/vibe64-packaging.
 */
const Vibe64PublishingFeature = defineFeature({
  id: "vibe64.publishing",
  domain: "vibe64-publishing",
  requires: {
    colleague: "vibe64.colleague",
    http: "runtime.http",
    logger: "runtime.logger",
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
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {SourceEditorService} capabilities.sourceEditor
   * @param {FeatureSetupContext} context
   */
  setup({
    colleague,
    http,
    logger,
    project,
    sourceEditor
  }, { actionCatalogue }) {
    const publishing = createPublishingService({ logger, project, sourceEditor });
    registerRoutes(http, {
      projectContext: getStudioProjectContext(),
      publishing
    });
    colleague.registerWatchSource(publicationWatchSource({ actionCatalogue }));
    return { publishing };
  },
  /**
   * @param {object} capabilities
   * @param {PublishingService} capabilities.publishing
   */
  actions({ publishing }) {
    return createPublishingActions({ publishing });
  },
  /**
   * @param {object} _dependencies
   * @param {{ outputs: { publishing: PublishingService } }} context
   */
  shutdown(_capabilities, { outputs }) {
    outputs.publishing.keys.lock();
    return outputs.publishing.lanShare.stop();
  }
});

export { Vibe64PublishingFeature };
