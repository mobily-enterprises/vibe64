import { createService } from "./service.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  vibe64SourceEditorFileChangedServiceEvent,
  vibe64SourceEditorFileOpenedServiceEvent
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";

class Vibe64SourceEditorProvider {
  static id = "feature.vibe64-source-editor";

  static dependsOn = [
    "feature.vibe64-project",
    "feature.vibe64-terminals"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function"
    ) {
      throw new Error("Vibe64SourceEditorProvider requires application service().");
    }

    app.service(
      "feature.vibe64-source-editor.service",
      (scope) => {
        return createService({
          projectService: scope.make("feature.vibe64-project.service"),
          terminalService: scope.make("feature.vibe64-terminals.service")
        });
      },
      {
        events: {
          broadcastOpenFile: [vibe64SourceEditorFileOpenedServiceEvent()],
          saveFile: [vibe64SourceEditorFileChangedServiceEvent()]
        }
      }
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
  }
}

export { Vibe64SourceEditorProvider };
