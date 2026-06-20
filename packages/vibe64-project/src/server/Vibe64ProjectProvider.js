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
import {
  VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE,
  vibe64ProjectAppAuthConfig
} from "@local/vibe64-core/shared";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

const VIBE64_PROJECT_SERVICE = "feature.vibe64-project.service";
const VIBE64_MANAGED_APP_AUTH_SERVICE = "feature.vibe64-managed-app-auth.service";

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
      (scope) => {
        return createService({
          projectConfigSavedHooks: [
            async (context = {}) => {
              if (
                vibe64ProjectAppAuthConfig(context.projectConfig).mode !== VIBE64_APP_AUTH_MODE_MANAGED_SUPABASE ||
                !scope ||
                typeof scope.has !== "function" ||
                typeof scope.make !== "function" ||
                !scope.has(VIBE64_MANAGED_APP_AUTH_SERVICE)
              ) {
                return null;
              }
              const service = scope.make(VIBE64_MANAGED_APP_AUTH_SERVICE);
              return typeof service?.syncSystem === "function"
                ? service.syncSystem({
                    projectConfig: context.projectConfig,
                    reason: "project_config_saved",
                    targetRoot: context.targetRoot
                  })
                : null;
            }
          ],
          projectConfigEnvironmentResolvers: [
            async (context = {}) => {
              if (
                !scope ||
                typeof scope.has !== "function" ||
                typeof scope.make !== "function" ||
                !scope.has(VIBE64_MANAGED_APP_AUTH_SERVICE)
              ) {
                return {};
              }
              const service = scope.make(VIBE64_MANAGED_APP_AUTH_SERVICE);
              return typeof service?.projectEnvironment === "function"
                ? service.projectEnvironment(context)
                : {};
            }
          ],
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
