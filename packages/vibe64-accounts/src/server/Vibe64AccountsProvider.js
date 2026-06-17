import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";
import process from "node:process";

import {
  createAccountsRuntime,
  createService,
  GITHUB_ACCOUNT_MODE_LOCAL,
  VIBE64_ACCOUNTS_SERVICE,
  VIBE64_ACCOUNTS_RUNTIME_SERVICE
} from "./service.js";
import { featureActions } from "./actions.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  createVibe64AccountsChangedPublisher,
  vibe64AccountsChangedServiceEvent,
  vibe64ConnectionsChangedServiceEvent
} from "./accountRealtimeEvents.js";
import {
  VIBE64_CONNECTIONS_SERVICE
} from "@local/vibe64-runtime/server/connectionReadiness";
import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";

class Vibe64AccountsProvider {
  static id = "feature.vibe64-accounts";

  static dependsOn = ["runtime.actions", "feature.vibe64-project"];

  register(app) {
    if (
      !app ||
      typeof app.service !== "function" ||
      typeof app.actions !== "function"
    ) {
      throw new Error("Vibe64AccountsProvider requires application service()/actions().");
    }

    const providerHomesRoot = String(process.env[VIBE64_PROVIDER_HOMES_ROOT_ENV] || "");
    const systemRoot = String(process.env[VIBE64_SYSTEM_ROOT_ENV] || "");
    const targetRoot = String(process.env[VIBE64_TARGET_ROOT_ENV] || "");

    app.service(
      VIBE64_ACCOUNTS_SERVICE,
      (scope) => {
        const domainEvents = typeof scope.has === "function" && scope.has("domainEvents")
          ? scope.make("domainEvents")
          : null;
        const projectService = scope.make("feature.vibe64-project.service");
        const accountRuntime = typeof scope.has === "function" && scope.has(VIBE64_ACCOUNTS_RUNTIME_SERVICE)
          ? scope.make(VIBE64_ACCOUNTS_RUNTIME_SERVICE)
          : createAccountsRuntime({
              githubAccountMode: GITHUB_ACCOUNT_MODE_LOCAL,
              projectService,
              providerHomesRoot,
              requireExplicitRoots: true,
              systemRoot,
              targetRoot
            });
        return createService({
          accountRuntime,
          projectService,
          publishAccountChanged: createVibe64AccountsChangedPublisher({
            domainEvents,
            methodName: "readAuthSession",
            serviceToken: VIBE64_ACCOUNTS_SERVICE
          })
        });
      },
      {
        events: {
          logout: [vibe64AccountsChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          readAuthSession: [vibe64AccountsChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          startAuth: [vibe64AccountsChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()]
        }
      }
    );
    app.service(
      VIBE64_CONNECTIONS_SERVICE,
      (scope) => {
        const accountService = scope.make(VIBE64_ACCOUNTS_SERVICE);
        return {
          async getStatus(input = {}) {
            const status = await accountService.getStatus(input);
            return {
              ...status,
              connections: Array.isArray(status?.accounts) ? status.accounts : []
            };
          }
        };
      }
    );

    app.actions(
      withActionDefaults(featureActions, {
        domain: "feature",
        dependencies: {
          featureService: VIBE64_ACCOUNTS_SERVICE
        }
      })
    );
  }

  boot(app) {
    registerRoutes(app, {
      routeRelativePath: "vibe64/accounts",
      routeSurface: "app"
    });
    registerRoutes(app, {
      routeRelativePath: "vibe64/accounts",
      routeSurface: "app",
      projectScoped: false
    });
  }
}

export { Vibe64AccountsProvider };
