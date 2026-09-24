import { defineFeature } from "@jskit-ai/kernel/server/features";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";

import {
  createSourceEditorFileChangedPublisher
} from "./events.js";
import { createService } from "./service.js";
import { registerRoutes } from "./registerRoutes.js";

const Vibe64SourceEditorProvider = defineFeature({
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
  setup({ events, http, logger, project, terminals }) {
    const sourceEditor = createService({
      logger,
      projectService: project,
      publishSessionChanged: createSessionChangedPublisher(events),
      terminalService: terminals
    });
    registerRoutes(http, {
      publishFileChanged: createSourceEditorFileChangedPublisher(events),
      routeRelativePath: "vibe64",
      routeSurface: "app",
      sourceEditor
    });
    terminals.setSourceEditorProvider(sourceEditor);
    return { sourceEditor };
  },
  shutdown({ terminals }, { outputs }) {
    terminals.setSourceEditorProvider(null);
    return outputs.sourceEditor.close();
  }
});

export { Vibe64SourceEditorProvider };
