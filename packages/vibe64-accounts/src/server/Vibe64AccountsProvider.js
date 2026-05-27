import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

import {
  createService,
  resolveVibe64AccountsRoot
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";

class Vibe64AccountsProvider {
  static id = "feature.vibe64-accounts";

  static dependsOn = ["runtime.actions"];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64AccountsProvider requires application service()/actions().");
    }

    const targetRoot = resolveVibe64AccountsRoot();

    app.service(
      "feature.vibe64-accounts.service",
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
          featureService: "feature.vibe64-accounts.service"
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64/accounts",
      routeSurface: "home"
    });
  }
}

export { Vibe64AccountsProvider };
