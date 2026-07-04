import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import {
  VIBE64_SYSTEM_ROOT_ENV,
  resolveStudioAppRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  jskitRuntimeEnv
} from "@local/vibe64-core/server/jskitRuntimeEnv";
import {
  GITHUB_ACCOUNT_MODE_LOCAL,
  VIBE64_GITHUB_ACCOUNT_MODE_ENV,
  normalizeGithubAccountMode
} from "@local/studio-terminal-core/server/credentialHomes";

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

    const providerEnv = jskitRuntimeEnv(app);
    const studioRoot = resolveStudioAppRoot({
      env: providerEnv
    });
    const githubAccountMode = normalizeGithubAccountMode(
      providerEnv[VIBE64_GITHUB_ACCOUNT_MODE_ENV],
      GITHUB_ACCOUNT_MODE_LOCAL
    );
    const systemRoot = String(providerEnv[VIBE64_SYSTEM_ROOT_ENV] || "");

    app.service(
      "feature.project-setup-doctor.service",
      (scope) => {
        return createService({
          githubAccountMode,
          logger: app.logger || console,
          projectService: scope.make("feature.vibe64-project.service"),
          studioRoot,
          systemRoot
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
      routeSurface: "app"
    });
  }
}

export { ProjectSetupDoctorProvider };
