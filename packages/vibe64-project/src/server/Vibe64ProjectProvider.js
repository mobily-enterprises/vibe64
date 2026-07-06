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
          adapterServices: () => ({
            managedAppAuth: optionalScopeService(scope, VIBE64_MANAGED_APP_AUTH_SERVICE)
          }),
          adapterSettingsComponentHandlers: () => ({
            "jskit-managed-app-auth": managedAppAuthComponentHandler(scope),
            "jskit.supabase-auth-settings": managedAppAuthComponentHandler(scope)
          }),
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

function optionalScopeService(scope, token = "") {
  if (
    !scope ||
    typeof scope.has !== "function" ||
    typeof scope.make !== "function" ||
    !scope.has(token)
  ) {
    return null;
  }
  return scope.make(token);
}

function managedAppAuthComponentHandler(scope) {
  function service() {
    return optionalScopeService(scope, VIBE64_MANAGED_APP_AUTH_SERVICE);
  }

  return {
    async connect(input = {}) {
      return service()?.connect(input) || managedAppAuthUnavailable();
    },
    async disconnect(input = {}) {
      return service()?.disconnect(input) || managedAppAuthUnavailable();
    },
    async disconnectSmtpLogin(input = {}) {
      return service()?.disconnectSmtpLogin(input) || managedAppAuthUnavailable();
    },
    async read(input = {}) {
      return service()?.getStatus(input) || managedAppAuthUnavailable();
    },
    async saveSmtpLogin(input = {}) {
      return service()?.saveSmtpLogin(input) || managedAppAuthUnavailable();
    },
    async setup(input = {}) {
      return service()?.setup(input) || managedAppAuthUnavailable();
    },
    async sync(input = {}) {
      return service()?.sync(input) || managedAppAuthUnavailable();
    }
  };
}

function managedAppAuthUnavailable() {
  return {
    errors: [
      {
        code: "vibe64_managed_app_auth_unavailable",
        message: "Managed Supabase auth service is not available."
      }
    ],
    ok: false
  };
}

export { Vibe64ProjectProvider };
