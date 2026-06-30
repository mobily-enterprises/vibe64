import { createService } from "./service.js";
import { registerRoutes } from "./registerRoutes.js";

class Vibe64SourceEditorProvider {
  static id = "feature.vibe64-source-editor";

  static dependsOn = ["feature.vibe64-project"];

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
          projectService: scope.make("feature.vibe64-project.service")
        });
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
