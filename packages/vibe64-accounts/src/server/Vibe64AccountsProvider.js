import { withActionDefaults } from "@jskit-ai/kernel/shared/actions";

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
  vibe64ConnectionsChangedServiceEvent,
  vibe64ManagedAppAuthChangedServiceEvent
} from "./accountRealtimeEvents.js";
import {
  createManagedAppAuthService,
  VIBE64_MANAGED_APP_AUTH_SERVICE
} from "./managedAppAuthService.js";
import {
  registerManagedAppAuthRoutes
} from "./registerManagedAppAuthRoutes.js";
import {
  VIBE64_CONNECTIONS_SERVICE
} from "@local/vibe64-runtime/server/connectionReadiness";
import {
  VIBE64_PROVIDER_HOMES_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  jskitRuntimeEnv
} from "@local/vibe64-core/server/jskitRuntimeEnv";

const VIBE64_TERMINALS_SERVICE = "feature.vibe64-terminals.service";

function createDefaultAccountRuntime({
  accountRuntime = null,
  providerHomesRoot = "",
  projectService = null,
  systemRoot = "",
  targetRoot = ""
} = {}) {
  return accountRuntime || createAccountsRuntime({
    githubAccountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    projectService,
    providerHomesRoot,
    requireExplicitRoots: true,
    systemRoot,
    targetRoot
  });
}

function firstBlockedConnectionMessage(connections = []) {
  const firstMissing = connections.find((connection) => connection.required && connection.connected !== true);
  return firstMissing ? String(firstMissing.message || "") : "";
}

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

    const providerEnv = jskitRuntimeEnv(app);
    const providerHomesRoot = String(providerEnv[VIBE64_PROVIDER_HOMES_ROOT_ENV] || "");
    const systemRoot = String(providerEnv[VIBE64_SYSTEM_ROOT_ENV] || "");
    const targetRoot = String(providerEnv[VIBE64_TARGET_ROOT_ENV] || "");

    app.service(
      VIBE64_ACCOUNTS_SERVICE,
      (scope) => {
        const domainEvents = typeof scope.has === "function" && scope.has("domainEvents")
          ? scope.make("domainEvents")
          : null;
        const projectService = scope.make("feature.vibe64-project.service");
        const terminalService = typeof scope.has === "function" && scope.has(VIBE64_TERMINALS_SERVICE)
          ? scope.make(VIBE64_TERMINALS_SERVICE)
          : null;
        const accountRuntime = typeof scope.has === "function" && scope.has(VIBE64_ACCOUNTS_RUNTIME_SERVICE)
          ? scope.make(VIBE64_ACCOUNTS_RUNTIME_SERVICE)
          : null;
        return createService({
          accountRuntime: createDefaultAccountRuntime({
            accountRuntime,
            providerHomesRoot,
            projectService,
            systemRoot,
            targetRoot
          }),
          invalidateAgentRuntimes: async (input = {}) => {
            if (typeof terminalService?.invalidateAgentRuntimes === "function") {
              return terminalService.invalidateAgentRuntimes(input);
            }
            return null;
          },
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
          saveGitIdentity: [vibe64AccountsChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          startAuth: [vibe64AccountsChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()]
        }
      }
    );
    app.service(
      VIBE64_MANAGED_APP_AUTH_SERVICE,
      (scope) => {
        const projectService = scope.make("feature.vibe64-project.service");
        const accountRuntime = typeof scope.has === "function" && scope.has(VIBE64_ACCOUNTS_RUNTIME_SERVICE)
          ? scope.make(VIBE64_ACCOUNTS_RUNTIME_SERVICE)
          : null;
        return createManagedAppAuthService({
          accountRuntime: createDefaultAccountRuntime({
            accountRuntime,
            providerHomesRoot,
            projectService,
            systemRoot,
            targetRoot
          }),
          projectService
        });
      },
      {
        events: {
          disconnect: [vibe64ManagedAppAuthChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          setup: [vibe64ManagedAppAuthChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          sync: [vibe64ManagedAppAuthChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()]
        }
      }
    );
    app.service(
      VIBE64_CONNECTIONS_SERVICE,
      (scope) => {
        const accountService = scope.make(VIBE64_ACCOUNTS_SERVICE);
        const appAuthService = typeof scope.has === "function" && scope.has(VIBE64_MANAGED_APP_AUTH_SERVICE)
          ? scope.make(VIBE64_MANAGED_APP_AUTH_SERVICE)
          : null;
        return {
          async getStatus(input = {}) {
            const status = await accountService.getStatus(input);
            if (status?.ok === false) {
              return status;
            }
            const accountConnections = Array.isArray(status?.accounts) ? status.accounts : [];
            const appAuthConnection = appAuthService
              ? await appAuthService.getConnectionStatus(input)
              : null;
            const connections = [
              ...accountConnections,
              ...(appAuthConnection && appAuthConnection.ok !== false && appAuthConnection.required === true
                ? [appAuthConnection]
                : [])
            ];
            const ready = connections.every((connection) => connection.required !== true || connection.connected === true);
            return {
              ...status,
              blockedReason: ready ? "" : firstBlockedConnectionMessage(connections),
              connections,
              ready
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
    registerManagedAppAuthRoutes(app, {
      routeRelativePath: "vibe64/managed-app-auth",
      routeSurface: "app"
    });
    registerManagedAppAuthRoutes(app, {
      routeRelativePath: "vibe64/managed-app-auth",
      routeSurface: "app",
      projectScoped: false
    });
  }
}

export { Vibe64AccountsProvider };
