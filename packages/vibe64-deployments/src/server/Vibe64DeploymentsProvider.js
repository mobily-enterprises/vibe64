import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";

class Vibe64DeploymentsProvider {
  static id = "feature.vibe64-deployments";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64DeploymentsProvider requires application service()/actions().");
    }

    const projectContext = getStudioProjectContext();

    app.service(
      "feature.vibe64-deployments.service",
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
          featureService: "feature.vibe64-deployments.service"
        }
      })
    );
  }

  boot(app) {
    const projectContext = getStudioProjectContext();
    registerRoutes(app, {
      projectContext,
      routeRelativePath: "vibe64/deployments",
      routeSurface: "app"
    });
  }
}

export { Vibe64DeploymentsProvider };
