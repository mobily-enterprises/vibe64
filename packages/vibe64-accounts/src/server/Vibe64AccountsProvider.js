import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  createVibe64AccountsChangedPublisher,
  vibe64AccountsChangedServiceEvent
} from "@local/vibe64-core/server/accountRealtimeEvents";

const VIBE64_ACCOUNTS_SERVICE = "feature.vibe64-accounts.service";

class Vibe64AccountsProvider {
  static id = "feature.vibe64-accounts";

  static dependsOn = ["runtime.actions", "feature.vibe64-project"];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64AccountsProvider requires application service()/actions().");
    }

    app.service(
      VIBE64_ACCOUNTS_SERVICE,
      (scope) => {
        const domainEvents = typeof scope.has === "function" && scope.has("domainEvents")
          ? scope.make("domainEvents")
          : null;
        return createService({
          projectService: scope.make("feature.vibe64-project.service"),
          publishAccountChanged: createVibe64AccountsChangedPublisher({
            domainEvents,
            methodName: "readAuthSession",
            serviceToken: VIBE64_ACCOUNTS_SERVICE
          })
        });
      },
      {
        events: {
          logout: [vibe64AccountsChangedServiceEvent()],
          readAuthSession: [vibe64AccountsChangedServiceEvent()],
          startAuth: [vibe64AccountsChangedServiceEvent()]
        }
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: VIBE64_ACCOUNTS_SERVICE
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64/accounts",
      routeSurface: "app"
    });
    registerRoutes(app, {
      routeRelativePath: "vibe64/accounts",
      routeSurface: "app",
      projectScoped: false
    });
  }
}

export { Vibe64AccountsProvider };
