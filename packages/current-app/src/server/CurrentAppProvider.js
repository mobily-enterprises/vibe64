import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService,
  resolveCurrentAppRoot
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class CurrentAppProvider {
  static id = "feature.current-app";

  static dependsOn = [
    "runtime.actions",
    "feature.ai-studio-project",
    "feature.studio-setup-doctor",
    "feature.adapter-setup-doctor",
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

    const appRoot = resolveCurrentAppRoot();

    app.service(
      "feature.current-app.service",
      () => {
        return createService({
          appRoot,
          projectService: app.make("feature.ai-studio-project.service"),
          setupServices: {
            adapterSetupService: app.make("feature.adapter-setup-doctor.service"),
            projectSetupService: app.make("feature.project-setup-doctor.service"),
            studioSetupService: app.make("feature.studio-setup-doctor.service")
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
      routeSurface: "home"
    });
  }
}

export { CurrentAppProvider };
