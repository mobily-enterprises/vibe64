import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  resolveStudioAppRoot,
  resolveStudioTargetRoot
} from "../../../../server/lib/studioRoots.js";

class TargetAppDoctorProvider {
  static id = "feature.target-app-doctor";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("TargetAppDoctorProvider requires application singleton()/service()/actions().");
    }

    const studioRoot = resolveStudioAppRoot();
    const targetRoot = resolveStudioTargetRoot({
      studioAppRoot: studioRoot
    });

    app.service(
      "feature.target-app-doctor.service",
      () => {
        return createService({
          studioRoot,
          targetRoot
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.target-app-doctor.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "studio/target-app",
      routeSurface: "home"
    });
  }
}

export { TargetAppDoctorProvider };
