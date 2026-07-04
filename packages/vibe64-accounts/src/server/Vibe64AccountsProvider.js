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
  createVibe64AccountAuthSessionChangedPublisher,
  createVibe64AccountsChangedPublisher,
  vibe64AccountAuthSessionChangedServiceEvent,
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
  VIBE64_CONNECTION_PURPOSE_SESSION,
  VIBE64_CONNECTIONS_SERVICE
} from "@local/vibe64-runtime/server/connectionReadiness";
import {
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  normalizeRepositoryMode,
  normalizeWorkflowRepositoryProfile
} from "@local/vibe64-core/server/projectRepository";
import {
  jskitRuntimeEnv
} from "@local/vibe64-core/server/jskitRuntimeEnv";

const VIBE64_TERMINALS_SERVICE = "feature.vibe64-terminals.service";

function createDefaultAccountRuntime({
  accountRuntime = null,
  projectService = null,
  systemRoot = "",
  targetRoot = ""
} = {}) {
  return accountRuntime || createAccountsRuntime({
    githubAccountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    projectService,
    requireExplicitRoots: true,
    systemRoot,
    targetRoot
  });
}

function firstBlockedConnectionMessage(connections = []) {
  const firstMissing = connections.find((connection) => connection.required && connection.connected !== true);
  return firstMissing ? String(firstMissing.message || "") : "";
}

function connectionPurpose(input = {}) {
  return String(input?.connectionPurpose || "").trim();
}

function shouldIncludeAppAuthConnection(input = {}) {
  return connectionPurpose(input) !== VIBE64_CONNECTION_PURPOSE_SESSION;
}

function inputHasProviderSelection(input = {}) {
  return Object.hasOwn(input, "providerIds") ||
    Object.hasOwn(input, "providers") ||
    Object.hasOwn(input, "accountIds");
}

function projectRequiresGithubAccount(project = {}) {
  const workflowRepositoryProfile = normalizeWorkflowRepositoryProfile(project.workflowRepositoryProfile);
  if (workflowRepositoryProfile) {
    return workflowRepositoryProfile === WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR;
  }
  const repositoryMode = normalizeRepositoryMode(project.repositoryMode || project.repository?.mode);
  if (repositoryMode) {
    return repositoryMode === PROJECT_REPOSITORY_MODE_GITHUB;
  }
  return Boolean(project.githubRepository || project.repository?.github);
}

async function selectedProjectForConnections(projectService = null) {
  if (typeof projectService?.listProjects === "function") {
    const listed = await projectService.listProjects();
    if (listed?.ok === false) {
      return null;
    }
    return listed?.currentProject || (Array.isArray(listed?.projects)
      ? listed.projects.find((project) => project?.selected) || null
      : null);
  }
  return projectService?.selectedProject || null;
}

async function connectionAccountStatusInput(input = {}, projectService = null) {
  if (inputHasProviderSelection(input)) {
    return input;
  }
  const project = await selectedProjectForConnections(projectService);
  return {
    ...input,
    providerIds: projectRequiresGithubAccount(project || {})
      ? ["codex", "github"]
      : ["codex"]
  };
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
          }),
          publishAuthSessionChanged: createVibe64AccountAuthSessionChangedPublisher({
            domainEvents,
            methodName: "startAuth",
            serviceToken: VIBE64_ACCOUNTS_SERVICE
          })
        });
      },
      {
        events: {
          logout: [vibe64AccountsChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          saveGitIdentity: [vibe64AccountsChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          startAuth: [
            vibe64AccountsChangedServiceEvent(),
            vibe64ConnectionsChangedServiceEvent(),
            vibe64AccountAuthSessionChangedServiceEvent()
          ]
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
          disconnectSmtpLogin: [vibe64ManagedAppAuthChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          saveSmtpLogin: [vibe64ManagedAppAuthChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          setup: [vibe64ManagedAppAuthChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()],
          sync: [vibe64ManagedAppAuthChangedServiceEvent(), vibe64ConnectionsChangedServiceEvent()]
        }
      }
    );
    app.service(
      VIBE64_CONNECTIONS_SERVICE,
      (scope) => {
        const projectService = typeof scope.has === "function" && scope.has("feature.vibe64-project.service")
          ? scope.make("feature.vibe64-project.service")
          : null;
        const accountService = scope.make(VIBE64_ACCOUNTS_SERVICE);
        const appAuthService = typeof scope.has === "function" && scope.has(VIBE64_MANAGED_APP_AUTH_SERVICE)
          ? scope.make(VIBE64_MANAGED_APP_AUTH_SERVICE)
          : null;
        return {
          async getStatus(input = {}) {
            const accountInput = await connectionAccountStatusInput(input, projectService);
            const status = await accountService.getStatus(accountInput);
            if (status?.ok === false) {
              return status;
            }
            const accountConnections = Array.isArray(status?.accounts) ? status.accounts : [];
            const appAuthConnection = appAuthService && shouldIncludeAppAuthConnection(input)
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
