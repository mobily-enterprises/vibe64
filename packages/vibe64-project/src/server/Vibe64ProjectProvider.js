import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService
} from "./service.js";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class Vibe64ProjectProvider {
  static id = "feature.vibe64-project";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64ProjectProvider requires application service()/actions().");
    }

    const projectContext = getStudioProjectContext();

    app.service(
      "feature.vibe64-project.service",
      () => {
        return createService({
          projectContext
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.vibe64-project.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64",
      routeSurface: "home"
    });
  }
}

export { Vibe64ProjectProvider };
