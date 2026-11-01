import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";

import {
  createSourceEditorFileChangedPublisher
} from "./events.js";
import { createService } from "./service.js";
import { registerRoutes } from "./registerRoutes.js";
import { createSourceEditorActions } from "./sourceEditorActions.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").SourceEditorService} SourceEditorService */

const Vibe64SourceEditorFeature = defineFeature({
  id: "vibe64.source-editor",
  domain: "vibe64-source-editor",
  requires: {
    events: "runtime.events",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    terminals: "vibe64.terminals"
  },
  provides: {
    sourceEditor: "vibe64.source-editor"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {TerminalsService} capabilities.terminals
   */
  setup({
    events,
    http,
    logger,
    project,
    terminals
  }) {
    const sourceEditor = createService({
      logger,
      projectService: project,
      publishSessionChanged: createSessionChangedPublisher(events),
      terminalService: terminals
    });
    registerRoutes(http, {
      sourceEditor
    });
    // readable-check: allow setter-seam - cycle: vibe64.source-editor requires vibe64.terminals
    terminals.setSourceEditorProvider(sourceEditor);
    return { sourceEditor };
  },
  actions({ sourceEditor, events }) {
    return createSourceEditorActions({ sourceEditor, publishFileChanged: createSourceEditorFileChangedPublisher(events) });
  },
  /**
   * @param {{ terminals: TerminalsService }} capabilities
   * @param {{ outputs: { sourceEditor: SourceEditorService } }} context
   */
  shutdown({ terminals }, { outputs }) {
    // readable-check: allow setter-seam - cycle: vibe64.source-editor requires vibe64.terminals
    terminals.setSourceEditorProvider(null);
    return outputs.sourceEditor.close();
  }
});

export { Vibe64SourceEditorFeature };
