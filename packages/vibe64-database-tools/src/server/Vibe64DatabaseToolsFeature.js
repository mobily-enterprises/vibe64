import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createDatabaseLayoutChangedPublisher } from "./events.js";

import {
  createDatabaseActions
} from "./databaseActions.js";
import {
  registerRoutes
} from "./registerRoutes.js";
import {
  createService
} from "./service.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").DatabaseToolsService} DatabaseToolsService */

const Vibe64DatabaseToolsFeature = defineFeature({
  actions({ databaseTools }) {
    return createDatabaseActions({ databaseTools });
  },
  domain: "vibe64-database-tools",
  id: "vibe64.database-tools",
  provides: {
    databaseTools: "vibe64.database-tools"
  },
  requires: {
    events: "runtime.events",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    sourceEditor: "vibe64.source-editor",
    terminals: "vibe64.terminals"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {SourceEditorService} capabilities.sourceEditor
   * @param {TerminalsService} capabilities.terminals
   */
  setup({
    events,
    http,
    logger,
    project,
    sourceEditor,
    terminals
  }) {
    const databaseTools = createService({
      logger,
      projectService: project,
      sourceEditor,
      publishLayoutChanged: createDatabaseLayoutChangedPublisher(events),
      terminalService: terminals
    });
    registerRoutes(http);
    // readable-check: allow setter-seam - cycle: vibe64.database-tools requires vibe64.terminals
    terminals.setDatabaseToolsProvider(databaseTools);
    return { databaseTools };
  },
  /**
   * @param {{ terminals: TerminalsService }} capabilities
   * @param {{ outputs: { databaseTools: DatabaseToolsService } }} context
   */
  shutdown({ terminals }, { outputs }) {
    // readable-check: allow setter-seam - cycle: vibe64.database-tools requires vibe64.terminals
    terminals.setDatabaseToolsProvider(null);
    return outputs.databaseTools.close();
  }
});

export {
  Vibe64DatabaseToolsFeature
};
