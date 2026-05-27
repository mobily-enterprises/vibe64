import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { createService } from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  resolveStudioAppRoot,
  resolveStudioTargetRoot
} from "@local/vibe64-core/server/studioRoots";

class AdapterSetupDoctorProvider {
  static id = "feature.adapter-setup-doctor";

  static dependsOn = ["runtime.actions", "feature.vibe64-project"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("AdapterSetupDoctorProvider requires application singleton()/service()/actions().");
    }

    const studioRoot = resolveStudioAppRoot();
    const targetRoot = resolveStudioTargetRoot({
      studioAppRoot: studioRoot
    });

    app.service(
      "feature.adapter-setup-doctor.service",
      () => {
        return createService({
          projectService: app.make("feature.vibe64-project.service"),
          studioRoot,
          targetRoot
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.adapter-setup-doctor.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "studio/adapter-setup",
      routeSurface: "home"
    });
  }
}

export { AdapterSetupDoctorProvider };
