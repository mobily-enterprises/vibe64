import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService,
  resolveCurrentAppRoot
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class CurrentAppProvider {
  static id = "feature.current-app";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.singleton !== "function" ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("CurrentAppProvider requires application singleton()/service()/actions().");
    }

    const appRoot = resolveCurrentAppRoot();

    app.service(
      "feature.current-app.service",
      () => {
        return createService({
          appRoot
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
      routeSurface: "home"
    });
  }
}

export { CurrentAppProvider };
