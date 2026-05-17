import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class AiStudioSessionsProvider {
  static id = "feature.ai-studio-sessions";

  static dependsOn = [
    "runtime.actions",
    "feature.ai-studio-project",
    "feature.ai-studio-terminals",
    "feature.studio-setup-doctor",
    "feature.adapter-setup-doctor",
    "feature.project-setup-doctor"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AiStudioSessionsProvider requires application service()/actions().");
    }

    app.service(
      "feature.ai-studio-sessions.service",
      (scope) => {
        return createService({
          setupServices: {
            adapterSetupService: scope.make("feature.adapter-setup-doctor.service"),
            projectSetupService: scope.make("feature.project-setup-doctor.service"),
            studioSetupService: scope.make("feature.studio-setup-doctor.service")
          },
          projectService: scope.make("feature.ai-studio-project.service"),
          terminalService: scope.make("feature.ai-studio-terminals.service")
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.ai-studio-sessions.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "ai-studio",
      routeSurface: "home"
    });
  }
}

export { AiStudioSessionsProvider };
