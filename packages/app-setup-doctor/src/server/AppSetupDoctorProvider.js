import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import {
  resolveStudioAppRoot,
  resolveStudioTargetRoot
} from "../../../../server/lib/studioRoots.js";

class AppSetupDoctorProvider {
  static id = "feature.app-setup-doctor";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AppSetupDoctorProvider requires application singleton()/service()/actions().");
    }

    const studioRoot = resolveStudioAppRoot();
    const targetRoot = resolveStudioTargetRoot({
      studioAppRoot: studioRoot
    });

    app.service(
      "feature.app-setup-doctor.service",
      () => {
        return createService({
          targetRoot
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.app-setup-doctor.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "studio/app-setup",
      routeSurface: "home"
    });
  }
}

export { AppSetupDoctorProvider };
