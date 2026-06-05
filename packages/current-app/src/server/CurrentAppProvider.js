import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class CurrentAppProvider {
  static id = "feature.current-app";

  static dependsOn = [
    "runtime.actions",
    "feature.vibe64-project",
    "feature.vibe64-accounts",
    "feature.studio-setup-doctor",
    "feature.project-setup-doctor"
  ];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("CurrentAppProvider requires application singleton()/service()/actions().");
    }

    app.service(
      "feature.current-app.service",
      (scope) => {
        return createService({
          projectService: scope.make("feature.vibe64-project.service"),
          setupServices: {
            accountSetupService: scope.make("feature.vibe64-accounts.service"),
            projectSetupService: scope.make("feature.project-setup-doctor.service"),
            studioSetupService: scope.make("feature.studio-setup-doctor.service")
          }
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.current-app.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "studio/current-app",
      routeSurface: "app"
    });
  }
}

export { CurrentAppProvider };
