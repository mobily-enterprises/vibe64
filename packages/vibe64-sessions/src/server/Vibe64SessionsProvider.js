import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { vibe64SessionChangedServiceEvent } from "@local/vibe64-core/server/sessionRealtimeEvents";

const VIBE64_SESSIONS_SERVICE = "feature.vibe64-sessions.service";

class Vibe64SessionsProvider {
  static id = "feature.vibe64-sessions";

  static dependsOn = [
    "runtime.actions",
    "feature.vibe64-project",
    "feature.vibe64-accounts",
    "feature.vibe64-terminals",
    "feature.studio-setup-doctor",
    "feature.project-setup-doctor"
  ];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64SessionsProvider requires application service()/actions().");
    }

    app.service(
      VIBE64_SESSIONS_SERVICE,
      (scope) => {
        return createService({
          setupServices: {
            accountSetupService: scope.make("feature.vibe64-accounts.service"),
            projectSetupService: scope.make("feature.project-setup-doctor.service"),
            studioSetupService: scope.make("feature.studio-setup-doctor.service")
          },
          projectService: scope.make("feature.vibe64-project.service"),
          terminalService: scope.make("feature.vibe64-terminals.service")
        });
      },
      {
        events: {
          abandonSession: [vibe64SessionChangedServiceEvent()],
          advanceSession: [vibe64SessionChangedServiceEvent()],
          createSession: [vibe64SessionChangedServiceEvent({
            operation: "created"
          })],
          rewindSession: [vibe64SessionChangedServiceEvent()],
          runSessionAction: [vibe64SessionChangedServiceEvent()],
          runSessionIntent: [vibe64SessionChangedServiceEvent()]
        }
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.vibe64-sessions.service"
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

export { Vibe64SessionsProvider };
