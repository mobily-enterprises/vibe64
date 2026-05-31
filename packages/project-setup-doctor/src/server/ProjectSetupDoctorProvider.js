import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import {
  resolveStudioAppRoot
} from "@local/vibe64-core/server/studioRoots";

class ProjectSetupDoctorProvider {
  static id = "feature.project-setup-doctor";

  static dependsOn = ["runtime.actions", "feature.vibe64-project"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("ProjectSetupDoctorProvider requires application singleton()/service()/actions().");
    }

    const studioRoot = resolveStudioAppRoot();

    app.service(
      "feature.project-setup-doctor.service",
      (scope) => {
        return createService({
          projectService: scope.make("feature.vibe64-project.service"),
          studioRoot
        });
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: "feature.project-setup-doctor.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "studio/project-setup",
      routeSurface: "home"
    });
  }
}

export { ProjectSetupDoctorProvider };
