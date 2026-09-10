import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createDatabaseLayoutChangedPublisher } from "./events.js";

import {
  createDatabaseActions
} from "./actions.js";
import {
  registerRoutes
} from "./registerRoutes.js";
import {
  createService
} from "./service.js";

const Vibe64DatabaseToolsProvider = defineFeature({
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  actions: ({ databaseTools }) => createDatabaseActions({ databaseTools }),
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
  setup({ events, http, logger, project, sourceEditor, terminals }) {
    const databaseTools = createService({
      logger,
      projectService: project,
      sourceEditor,
      publishLayoutChanged: createDatabaseLayoutChangedPublisher(events),
      terminalService: terminals
    });
    registerRoutes(http, {
      databaseTools,
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
    terminals.setDatabaseToolsProvider(databaseTools);
    return { databaseTools };
  },
  shutdown({ terminals }, { outputs }) {
    terminals.setDatabaseToolsProvider(null);
    return outputs.databaseTools.close();
  }
});

export {
  Vibe64DatabaseToolsProvider
};
