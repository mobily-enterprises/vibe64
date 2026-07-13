import {
  createService
} from "./service.js";
import {
  registerRoutes,
  SYSTEM_GRAPH_SERVICE_ID
} from "./registerRoutes.js";

class Vibe64SystemGraphProvider {
  static id = "feature.vibe64-system-graph";

  static dependsOn = [
    "feature.vibe64-project"
  ];

  register(app) {
    if (!app || typeof app.service !== "function") {
      throw new Error("Vibe64SystemGraphProvider requires application service().");
    }
    app.service(SYSTEM_GRAPH_SERVICE_ID, (scope) => {
      return createService({
        projectService: scope.make("feature.vibe64-project.service")
      });
    });
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
  }
}

export {
  Vibe64SystemGraphProvider
};
