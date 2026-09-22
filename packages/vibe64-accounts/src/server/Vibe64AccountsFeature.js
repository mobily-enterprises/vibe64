import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createActions } from "./actions.js";
import {
  createVibe64AccountAuthSessionChangedPublisher,
  createVibe64AccountsChangedPublisher,
  createVibe64ConnectionsChangedPublisher
} from "./accountRealtimeEvents.js";
import { registerRoutes } from "./registerRoutes.js";
import { createAiConnectionRuntime, configureAiConnectionRuntime } from "./aiConnectionRuntime.js";
import { createAiConnectionService } from "./aiConnectionService.js";
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

function createConnections({ accounts, project, listAssistantCapabilities = null } = {}) {
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
      const connections = Array.isArray(status?.accounts) ? [...status.accounts] : [];
      if (!inputHasProviderSelection(input) && listAssistantCapabilities) {
        const catalog = await listAssistantCapabilities({ configuredOnly: "true", vibe64User: input.vibe64User });
        if (catalog?.ok === false) return catalog;
        const connected = (catalog.engines || []).some((engine) =>
          (engine.modelProviders || []).some((provider) => provider.connected === true));
        const codexIndex = connections.findIndex((account) => account.id === "codex");
        if (codexIndex >= 0) connections.splice(codexIndex, 1);
        connections.unshift({
          id: "ai", label: "AI connection", connected, required: true,
          message: connected ? "An AI provider is connected." : "Connect an AI provider in AI Accounts."
        });
      }
      const ready = connections.every((connection) => connection.required !== true || connection.connected === true);
      return {
        ...status,
        blockedReason: ready ? "" : firstBlockedConnectionMessage(connections),
        connections,
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
    const resolvedAccountRuntime = createDefaultAccountRuntime({ accountRuntime, project, systemRoot, targetRoot });
    const listAssistantCapabilities = typeof terminals?.listAssistantCapabilities === "function"
      ? (input) => terminals.listAssistantCapabilities(input)
      : null;
    const accounts = createService({
      accountRuntime: resolvedAccountRuntime,
      personalProfileStore,
      listAssistantCapabilities,
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
    const connections = createConnections({
      accounts, project,
      listAssistantCapabilities
    });

    if (typeof terminals?.configureAssistantRuntime === "function") {
      terminals.configureAssistantRuntime({
        async codexConnectionStatus() {
          const status = await accounts.getStatus({ accountIds: ["codex"] });
          return status.ok === true &&
            status.accounts.some((account) => account.id === "codex" && account.connected === true);
        }
      });
    }

    const aiConnections = localRuntime && terminals && systemRoot
      ? createAiConnectionRuntime({
          systemRoot: resolvedAccountRuntime.systemRoot,
          terminals,
          publishConnectionChanged: createVibe64ConnectionsChangedPublisher({ events })
        })
      : null;
    const aiConnectionService = aiConnections
      ? createAiConnectionService({
          aiConnections,
          readAssistantCapabilities: (input, vibe64User) => terminals.listAssistantCapabilities({ ...input, vibe64User })
        })
      : null;
    if (aiConnections) {
      configureAiConnectionRuntime({
        accountService: accounts, aiConnections, terminals,
        requireManagement: (input) => resolvedAccountRuntime.requireCodexManagement(input)
      });
    }

    registerRoutes(http, {
      accounts,
      aiConnectionService,
      requireAiManagement: (input) => resolvedAccountRuntime.requireCodexManagement(input),
      fastify,
      projectContext,
      routeRelativePath: "vibe64/accounts",
      routeSurface: "app"
    });
    registerRoutes(http, {
      accounts,
      aiConnectionService,
      requireAiManagement: (input) => resolvedAccountRuntime.requireCodexManagement(input),
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
