import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  vibe64SessionChangedServiceEvent
} from "@local/vibe64-core/server/sessionRealtimeEvents";

const VIBE64_ARTIFACTS_SERVICE = "feature.vibe64-artifacts.service";

class Vibe64ArtifactsProvider {
  static id = "feature.vibe64-artifacts";

  static dependsOn = [
    "runtime.actions",
    "feature.vibe64-project"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64ArtifactsProvider requires application service()/actions().");
    }

    app.service(
      VIBE64_ARTIFACTS_SERVICE,
      (scope) => {
        return createService({
          projectService: scope.make("feature.vibe64-project.service")
        });
      },
      {
        events: {
          submitCurrentStepInput: [vibe64SessionChangedServiceEvent()]
        }
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.vibe64-artifacts.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64",
      routeSurface: "app"
    });
  }
}

export { Vibe64ArtifactsProvider };
