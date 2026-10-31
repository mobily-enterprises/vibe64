import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createAccountsActions, createAiConnectionActions } from "./accountsActions.js";
import {
  createVibe64AccountAuthSessionChangedPublisher,
  createVibe64AccountsChangedPublisher,
  createVibe64ConnectionsChangedPublisher
} from "./accountRealtimeEvents.js";
import { registerRoutes } from "./registerRoutes.js";
import { createAiConnectionRuntime, configureAiConnectionRuntime } from "./aiConnectionRuntime.js";
import { createAiConnectionService } from "./aiConnectionService.js";
import { createTeamAiReadiness } from "./teamAiReadiness.js";
import { createAccountsRuntime } from "./accountsRuntime.js";
import {
  blockedReason,
  createService,
  GITHUB_ACCOUNT_MODE_LOCAL,
  hasAccountSelection
} from "./service.js";
import {
  OPERATOR_CLIS,
  operatorCliInstall,
  resolveOperatorCli
} from "@local/vibe64-execution/server";
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
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { registerTeamAiReadiness } from "@local/vibe64-core/server/teamAiGate";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").AccountsService} AccountsService */
/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * @param {object} dependencies
 * @param {AccountsRuntime | null} dependencies.accountRuntime
 * @param {ProjectService} dependencies.project
 * @param {string} [dependencies.systemRoot]
 * @param {string} [dependencies.targetRoot]
 */
function createDefaultAccountRuntime({
  accountRuntime,
  project,
  systemRoot = "",
  targetRoot = ""
}) {
  return accountRuntime || createAccountsRuntime({
    githubAccountMode: GITHUB_ACCOUNT_MODE_LOCAL,
    projectService: project,
    requireExplicitRoots: true,
    systemRoot,
    targetRoot
  });
}

/**
 * @param {object} [input]
 * @param {ProjectService} project
 */
async function connectionAccountStatusInput(input = {}, project) {
  if (hasAccountSelection(input)) {
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

/**
 * @param {object} dependencies
 * @param {AccountsService} dependencies.accounts
 * @param {ProjectService} dependencies.project
 * @param {((input: object) => ReturnType<TerminalsService["listAssistantCapabilities"]>) | null} dependencies.listAssistantCapabilities
 */
function createConnections({
  accounts,
  project,
  listAssistantCapabilities
}) {
  return Object.freeze({
    async getStatus(input = {}) {
      const accountInput = await connectionAccountStatusInput(input, project);
      // Readiness needs only whether GitHub is connected, not the Git name
      // the Account card reads for the person.
      const status = await accounts.getStatus({ ...accountInput, readGitIdentity: false });
      if (status?.ok === false) {
        return status;
      }
      const connections = Array.isArray(status?.accounts) ? [...status.accounts] : [];
      if (!hasAccountSelection(input) && listAssistantCapabilities) {
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
        blockedReason: ready ? "" : blockedReason(connections),
        connections,
        ready
      };
    }
  });
}

// Plain words in the terminal, and only when no AI tool runs Vibe64 at all:
// one tool is enough, so a missing second one is not worth a warning.
function warnMissingOperatorClis(write = (line) => process.stderr.write(`${line}\n`)) {
  if (Object.keys(OPERATOR_CLIS).some((tool) => resolveOperatorCli(tool).installed)) return;
  write([
    "No AI tool is installed on this computer yet. Vibe64 needs one.",
    `To install Claude Code, run: ${operatorCliInstall("claude")}`,
    "Codex and opencode work too: open Vibe64 and choose AI setup."
  ].join("\n"));
}

const Vibe64AccountsFeature = defineFeature({
  id: "vibe64.accounts",
  domain: "vibe64-accounts",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    fastify: "runtime.fastify",
    http: "runtime.http",
    logger: "runtime.logger",
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
  /**
   * @param {object} capabilities
   * @param {AccountsRuntime | null} capabilities.accountRuntime
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeFastify} capabilities.fastify
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {TerminalsService | null} capabilities.terminals
   * @param {{ actionCatalogue: ActionCatalogue }} context
   */
  setup({ accountRuntime, env, events, fastify, http, logger, project, terminals }, { actionCatalogue }) {
    warnMissingOperatorClis();
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
    // readable-check: allow method-probe - optional operation: each use of the optional vibe64.terminals checks the operation it needs
    const listAssistantCapabilities = typeof terminals?.listAssistantCapabilities === "function"
      // The reader's user is the authority option, not catalogue input: a page
      // outside a project (Studio Health) has no project user to fall back on.
      ? (input) => terminals.listAssistantCapabilities(input, { vibe64User: input.vibe64User || null })
      : null;
    const accounts = createService({
      accountRuntime: resolvedAccountRuntime,
      personalProfileStore,
      // readable-check: allow method-probe - optional operation: each use of the optional vibe64.terminals checks the operation it needs
      inspectRoutingConfiguration: typeof terminals?.inspectAssistantRoutingConfiguration === "function"
        ? (configuration, options) => terminals.inspectAssistantRoutingConfiguration(configuration, options) : null,
      invalidateAgentRuntimes: async (input = {}) => {
        // readable-check: allow method-probe - optional operation: each use of the optional vibe64.terminals checks the operation it needs
        if (typeof terminals?.invalidateAgentRuntimes === "function") {
          return terminals.invalidateAgentRuntimes(input);
        }
        return null;
      },
      logger,
      publishAccountChanged: createVibe64AccountsChangedPublisher({ events }),
      publishAuthSessionChanged: createVibe64AccountAuthSessionChangedPublisher({ events }),
      // readable-check: allow method-probe - optional operation: each use of the optional vibe64.terminals checks the operation it needs
      readClaudeAccountStatus: typeof terminals?.readClaudeAccountStatus === "function"
        ? () => terminals.readClaudeAccountStatus() : null
    });
    const connections = createConnections({
      accounts, project,
      listAssistantCapabilities
    });

    // Project admission's team AI gate reads the team setup through live access.
    // readable-check: allow method-probe - optional operation: each use of the optional vibe64.terminals checks the operation it needs
    if (resolvedAccountRuntime.systemRoot && typeof terminals?.requireAssistantSelectionAccess === "function") {
      const teamAi = createTeamAiReadiness({
        readRoutingConfiguration: () => createAssistantRoutingStore({ systemRoot: resolvedAccountRuntime.systemRoot }).read(),
        readSelectionAccess: (selection, options) => terminals.requireAssistantSelectionAccess(selection, options)
      });
      registerTeamAiReadiness(teamAi.ready);
      events.register({
        id: "vibe64.accounts.team-ai-readiness",
        matches: (event) => event?.source === "vibe64" && ["account", "connection"].includes(event.entity),
        handle: () => teamAi.invalidate()
      });
    }

    // readable-check: allow method-probe - optional operation: each use of the optional vibe64.terminals checks the operation it needs
    if (typeof terminals?.configureAssistantRuntime === "function") {
      terminals.configureAssistantRuntime({
        async claudeConnectionStatus() {
          return (await accounts.getClaudeStatus()).account?.connected === true;
        },
        async codexConnectionStatus() {
          const status = await accounts.getStatus({ accountIds: ["codex"] });
          return status.ok === true &&
            status.accounts.some((account) => account.id === "codex" && account.connected === true);
        }
      });
    }

    // A host-supplied account runtime also owns connection wiring. Do not
    // register a second copy of its actions/store.
    const aiConnections = !accountRuntime && localRuntime && terminals && systemRoot
      ? createAiConnectionRuntime({
          systemRoot: resolvedAccountRuntime.systemRoot,
          terminals,
          publishConnectionChanged: createVibe64ConnectionsChangedPublisher({ events })
        })
      : null;
    const aiConnectionService = aiConnections
      ? createAiConnectionService({
          aiConnections,
          initializeModelRouting: accounts.initializeModelRouting,
          logger,
          readAssistantCapabilities: (input, vibe64User) => terminals.listAssistantCapabilities({ ...input, vibe64User })
        })
      : null;
    if (aiConnections) {
      configureAiConnectionRuntime({ aiConnections, terminals,
        requireAiManagement: resolvedAccountRuntime.requireAiManagement });
    }
    if (aiConnectionService) {
      actionCatalogue.register({
        contributorId: "vibe64.accounts.ai-connections", domain: "vibe64-accounts",
        actions: createAiConnectionActions({ aiConnectionService,
          requireAiManagement: resolvedAccountRuntime.requireAiManagement
        }).map((action) => ({ channels: ["api", "automation", "internal"], surfaces: ["app"], ...action }))
      });
    }

    registerRoutes(http, {
      accounts,
      aiConnectionService,
      fastify,
      projectContext
    });

    return { accounts, connections };
  },
  actions: ({ accounts }) => createAccountsActions({ accounts })
});

export {
  Vibe64AccountsFeature,
  createConnections,
  createDefaultAccountRuntime,
  warnMissingOperatorClis
};
