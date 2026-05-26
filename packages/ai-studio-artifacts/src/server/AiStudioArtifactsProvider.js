import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  aiStudioSessionChangedServiceEvent
} from "@local/ai-studio-core/server/sessionRealtimeEvents";

const AI_STUDIO_ARTIFACTS_SERVICE = "feature.ai-studio-artifacts.service";

class AiStudioArtifactsProvider {
  static id = "feature.ai-studio-artifacts";

  static dependsOn = [
    "runtime.actions",
    "feature.ai-studio-project"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AiStudioArtifactsProvider requires application service()/actions().");
    }

    app.service(
      AI_STUDIO_ARTIFACTS_SERVICE,
      (scope) => {
        return createService({
          projectService: scope.make("feature.ai-studio-project.service")
        });
      },
      {
        events: {
          submitCurrentStepInput: [aiStudioSessionChangedServiceEvent()]
        }
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.ai-studio-artifacts.service"
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

export { AiStudioArtifactsProvider };
