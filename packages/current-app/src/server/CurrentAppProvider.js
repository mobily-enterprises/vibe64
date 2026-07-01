import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  resolveConnectionSetupService
} from "@local/vibe64-runtime/server/connectionReadiness";
import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  jskitRuntimeEnv
} from "@local/vibe64-core/server/jskitRuntimeEnv";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import {
  setupOptionsForRuntimeProfile
} from "@local/vibe64-runtime/server/setupReadiness";

class CurrentAppProvider {
  static id = "feature.current-app";

  static dependsOn = [
    "runtime.actions",
    "feature.vibe64-project",
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

    const providerEnv = jskitRuntimeEnv(app);
    const providerHomesRoot = String(providerEnv[VIBE64_PROVIDER_HOMES_ROOT_ENV] || "");
    const systemRoot = String(providerEnv[VIBE64_SYSTEM_ROOT_ENV] || "");
    const targetRoot = String(providerEnv[VIBE64_TARGET_ROOT_ENV] || "");
    const connectionSetupOptions = {
      providerHomesRoot,
      systemRoot,
      targetRoot
    };
    const studioProjectContext = getStudioProjectContext();
    const setupOptions = setupOptionsForRuntimeProfile(studioProjectContext.runtimeProfile);

    app.service(
      "feature.current-app.service",
      (scope) => {
        return createService({
          projectService: scope.make("feature.vibe64-project.service"),
          setupServices: {
            connectionSetupService: resolveConnectionSetupService(scope, connectionSetupOptions),
            projectSetupService: scope.make("feature.project-setup-doctor.service"),
            studioSetupService: scope.make("feature.studio-setup-doctor.service")
          },
          setupOptions
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
