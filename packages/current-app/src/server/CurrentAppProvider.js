import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import process from "node:process";

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

    const providerHomesRoot = String(process.env[VIBE64_PROVIDER_HOMES_ROOT_ENV] || "");
    const systemRoot = String(process.env[VIBE64_SYSTEM_ROOT_ENV] || "");
    const targetRoot = String(process.env[VIBE64_TARGET_ROOT_ENV] || "");
    const connectionSetupOptions = {
      providerHomesRoot,
      systemRoot,
      targetRoot
    };

    app.service(
      "feature.current-app.service",
      (scope) => {
        return createService({
          projectService: scope.make("feature.vibe64-project.service"),
          setupServices: {
            connectionSetupService: resolveConnectionSetupService(scope, connectionSetupOptions),
            projectSetupService: scope.make("feature.project-setup-doctor.service"),
            studioSetupService: scope.make("feature.studio-setup-doctor.service")
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
      routeSurface: "app"
    });
  }
}

export { CurrentAppProvider };
