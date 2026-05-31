import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService,
  resolveStudioRoot
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class StudioSetupDoctorProvider {
  static id = "feature.studio-setup-doctor";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("StudioSetupDoctorProvider requires application singleton()/service()/actions().");
    }

    const studioRoot = resolveStudioRoot();

    app.service(
      "feature.studio-setup-doctor.service",
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
          featureService: "feature.studio-setup-doctor.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "studio/studio-setup",
      routeSurface: "home"
    });
  }
}

export { StudioSetupDoctorProvider };
