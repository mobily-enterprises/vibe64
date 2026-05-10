import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService,
  resolveStudioRoot
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class BootstrapDoctorProvider {
  static id = "feature.bootstrap-doctor";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("BootstrapDoctorProvider requires application singleton()/service()/actions().");
    }

    const studioRoot = resolveStudioRoot();

    app.service(
      "feature.bootstrap-doctor.service",
      () => {
        return createService({
          studioRoot
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.bootstrap-doctor.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "studio/bootstrap",
      routeSurface: "home"
    });
  }
}

export { BootstrapDoctorProvider };
