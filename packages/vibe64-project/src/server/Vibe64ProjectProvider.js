import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService
} from "./service.js";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  vibe64ProjectChangedServiceEvent
} from "@local/vibe64-core/server/projectRealtimeEvents";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

const VIBE64_PROJECT_SERVICE = "feature.vibe64-project.service";

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
      VIBE64_PROJECT_SERVICE,
      () => {
        return createService({
          projectContext
        });
      },
      {
        events: {
          createProject: [vibe64ProjectChangedServiceEvent({
            operation: "created"
          })],
          saveProjectConfig: [vibe64ProjectChangedServiceEvent()],
          saveProjectType: [vibe64ProjectChangedServiceEvent()],
          selectProject: [vibe64ProjectChangedServiceEvent({
            operation: "updated"
          })]
        }
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
      routeSurface: "app"
    });
  }
}

export { Vibe64ProjectProvider };
