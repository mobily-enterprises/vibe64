import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createActions } from "./actions.js";
import {
  createVibe64AccountAuthSessionChangedPublisher,
  createVibe64AccountsChangedPublisher
} from "./accountRealtimeEvents.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  createAccountsRuntime,
  createService,
  GITHUB_ACCOUNT_MODE_LOCAL
} from "./service.js";
import {
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  projectRequiresGithubConnection
} from "@local/vibe64-core/server/projectRepository";
import {
  createPersonalAiProfileStore
} from "@local/vibe64-core/server/personalAiProfile";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";

function createDefaultAccountRuntime({
  accountRuntime = null,
  project = null,
  systemRoot = "",
  targetRoot = ""
} = {}) {
  return accountRuntime || createAccountsRuntime({
    githubAccountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    projectService: project,
    requireExplicitRoots: true,
    systemRoot,
    targetRoot
  });
}

function firstBlockedConnectionMessage(connections = []) {
  const firstMissing = connections.find((connection) => connection.required && connection.connected !== true);
  return firstMissing ? String(firstMissing.message || "") : "";
}

function inputHasProviderSelection(input = {}) {
  return Object.hasOwn(input, "providerIds") ||
    Object.hasOwn(input, "providers") ||
    Object.hasOwn(input, "accountIds");
}

async function connectionAccountStatusInput(input = {}, project) {
  if (inputHasProviderSelection(input)) {
    return input;
  }
  const currentProject = await project.readCurrentProject();
  return {
    ...input,
    providerIds: projectRequiresGithubConnection(currentProject || {})
      ? ["codex", "github"]
      : ["codex"]
  };
}

function createConnections({ accounts, project } = {}) {
  if (!accounts || typeof accounts.getStatus !== "function") {
    throw new TypeError("createConnections requires the Vibe64 Accounts API.");
  }
  if (!project || typeof project.readCurrentProject !== "function") {
    throw new TypeError("createConnections requires the Vibe64 Project API.");
  }

  return Object.freeze({
    async getStatus(input = {}) {
      const accountInput = await connectionAccountStatusInput(input, project);
      const status = await accounts.getStatus(accountInput);
      if (status?.ok === false) {
        return status;
      }
      const connections = Array.isArray(status?.accounts) ? status.accounts : [];
      const ready = connections.every((connection) => connection.required !== true || connection.connected === true);
      return {
        ...status,
        blockedReason: ready ? "" : firstBlockedConnectionMessage(connections),
        connections: [...connections],
        ready
      };
    }
  });
}

const Vibe64AccountsFeature = defineFeature({
  id: "vibe64.accounts",
  domain: "vibe64-accounts",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    fastify: "runtime.fastify",
    http: "runtime.http",
    project: "vibe64.project"
  },
  optional: {
    accountRuntime: "vibe64.accounts.runtime",
    terminals: "vibe64.terminals"
  },
  provides: {
    accounts: "vibe64.accounts",
    connections: "vibe64.connections"
  },
  actionDefaults: {
    channels: ["api", "automation", "internal"],
    surfaces: ["app"]
  },
  setup({ accountRuntime, env, events, fastify, http, project, terminals }) {
    const systemRoot = String(env[VIBE64_SYSTEM_ROOT_ENV] || "");
    const targetRoot = String(env[VIBE64_TARGET_ROOT_ENV] || "");
    const projectContext = getStudioProjectContext();
    const runtimeProfile = projectContext.runtimeProfile || {};
    const localRuntime = runtimeProfile.local === true ||
      ["local", "local-editor"].includes(String(runtimeProfile.mode || "").trim().toLowerCase());
    const personalProfileStore = localRuntime && systemRoot
      ? createPersonalAiProfileStore({ systemRoot })
      : null;
    const accounts = createService({
      accountRuntime: createDefaultAccountRuntime({
        accountRuntime,
        project,
        systemRoot,
        targetRoot
      }),
      personalProfileStore,
      listAssistantCapabilities: (input) => terminals.listAssistantCapabilities(input),
      invalidateAgentRuntimes: async (input = {}) => {
        if (typeof terminals?.invalidateAgentRuntimes === "function") {
          return terminals.invalidateAgentRuntimes(input);
        }
        return null;
      },
      projectService: project,
      publishAccountChanged: createVibe64AccountsChangedPublisher({ events }),
      publishAuthSessionChanged: createVibe64AccountAuthSessionChangedPublisher({ events })
    });
    const connections = createConnections({ accounts, project });

    if (typeof terminals?.configureAssistantRuntime === "function") {
      terminals.configureAssistantRuntime({
        async codexConnectionStatus() {
          const status = await accounts.getStatus({ accountIds: ["codex"] });
          return status.ok === true &&
            status.accounts.some((account) => account.id === "codex" && account.connected === true);
        }
      });
    }

    registerRoutes(http, {
      accounts,
      fastify,
      projectContext,
      routeRelativePath: "vibe64/accounts",
      routeSurface: "app"
    });
    registerRoutes(http, {
      accounts,
      fastify,
      projectContext,
      projectScoped: false,
      routeRelativePath: "vibe64/accounts",
      routeSurface: "app"
    });

    return { accounts, connections };
  },
  actions: ({ accounts }) => createActions({ accounts })
});

export {
  Vibe64AccountsFeature,
  createConnections,
  createDefaultAccountRuntime
};
