import { defineFeature } from "@jskit-ai/kernel/server/features";

import { createAccountsActions, createAiConnectionActions } from "./accountsActions.js";
import {
  createVibe64AccountAuthSessionChangedPublisher,
  createVibe64AccountsChangedPublisher,
  createVibe64ConnectionsChangedPublisher
} from "./accountRealtimeEvents.js";
import { registerLocalAiConnectionRoutes, registerRoutes } from "./registerRoutes.js";
import { registerAuthTerminalRoutes } from "./authTerminalRoutes.js";
import { createAiConnectionRuntime, configureAiConnectionRuntime } from "./aiConnectionRuntime.js";
import { createAiConnectionService, createManagedAiConnections } from "./aiConnectionService.js";
import { createTeamAiReadiness } from "./teamAiReadiness.js";
import { ACCOUNTS_RUNTIME_TOKEN, createAccountsRuntime } from "./accountsRuntime.js";
import { createConnections } from "./connections.js";
import { createPersonalProfile, NO_PERSONAL_PROFILE } from "./personalProfile.js";
import { warnMissingOperatorClis } from "./operatorCliWarning.js";
import { configureSignInStatusRuntime } from "./signInStatusRuntime.js";
import { createService } from "./service.js";
import {
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  createPersonalAiProfileStore
} from "@local/vibe64-core/server/personalAiProfile";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { registerTeamAiReadiness } from "@local/vibe64-core/server/teamAiGate";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {import("./types.js").AccountsService} AccountsService */
/** @typedef {import("@jskit-ai/kernel/server/types").FeatureSetupContext} FeatureSetupContext */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

const Vibe64AccountsFeature = defineFeature({
  id: "vibe64.accounts",
  domain: "vibe64-accounts",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    fastify: "runtime.fastify",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    terminals: "vibe64.terminals"
  },
  optional: {
    accountRuntime: ACCOUNTS_RUNTIME_TOKEN
  },
  provides: {
    accounts: "vibe64.accounts",
    connections: "vibe64.connections"
  },
  /**
   * @param {object} capabilities
   * @param {AccountsRuntime} [capabilities.accountRuntime]
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeFastify} capabilities.fastify
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {TerminalsService} capabilities.terminals
   * @param {FeatureSetupContext} context
   */
  setup({
    accountRuntime,
    env,
    events,
    fastify,
    http,
    logger,
    project,
    terminals
  }, { actionCatalogue }) {
    warnMissingOperatorClis();
    const systemRoot = String(env[VIBE64_SYSTEM_ROOT_ENV] || "");
    const targetRoot = String(env[VIBE64_TARGET_ROOT_ENV] || "");
    const projectContext = getStudioProjectContext();
    const runtimeProfile = projectContext.runtimeProfile || {};
    const localRuntime = runtimeProfile.local === true ||
      ["local", "local-editor"].includes(String(runtimeProfile.mode || "").trim().toLowerCase());
    const resolvedAccountRuntime = accountRuntime ?? createAccountsRuntime({
      project,
      systemRoot,
      targetRoot
    });
    const accounts = createService({
      accountRuntime: resolvedAccountRuntime,
      personalProfile: localRuntime && systemRoot
        ? createPersonalProfile({ store: createPersonalAiProfileStore({ systemRoot }) })
        : NO_PERSONAL_PROFILE,
      inspectRoutingConfiguration: terminals.inspectAssistantRoutingConfiguration,
      invalidateAgentRuntimes: terminals.invalidateAgentRuntimes,
      logger,
      publishAccountChanged: createVibe64AccountsChangedPublisher({ events }),
      publishAuthSessionChanged: createVibe64AccountAuthSessionChangedPublisher({ events }),
      readClaudeAccountStatus: terminals.readClaudeAccountStatus
    });
    const connections = createConnections({
      accounts,
      project,
      terminals
    });

    // Project admission's team AI gate reads the team setup through live access.
    if (resolvedAccountRuntime.systemRoot) {
      const teamAi = createTeamAiReadiness({
        routingStore: createAssistantRoutingStore({ systemRoot: resolvedAccountRuntime.systemRoot }),
        terminals
      });
      registerTeamAiReadiness(teamAi.ready);
      events.register({
        id: "vibe64.accounts.team-ai-readiness",
        matches: (event) => event?.source === "vibe64" && ["account", "connection"].includes(event.entity),
        handle: () => teamAi.invalidate()
      });
    }

    configureSignInStatusRuntime({
      accounts,
      terminals
    });
    registerRoutes(http, { projectContext });

    // A host-supplied account runtime also owns connection wiring. Do not
    // register a second copy of its actions/store.
    if (!accountRuntime && localRuntime && systemRoot) {
      const aiConnections = createAiConnectionRuntime({
        systemRoot: resolvedAccountRuntime.systemRoot,
        terminals,
        publishConnectionChanged: createVibe64ConnectionsChangedPublisher({ events })
      });
      configureAiConnectionRuntime({
        aiConnections,
        terminals,
        requireAiManagement: resolvedAccountRuntime.requireAiManagement
      });
      actionCatalogue.register({
        contributorId: "vibe64.accounts.ai-connections",
        domain: "vibe64-accounts",
        actions: createAiConnectionActions({
          managedAiConnections: createManagedAiConnections({
            aiConnectionService: createAiConnectionService({
              aiConnections,
              initializeModelRouting: accounts.initializeModelRouting,
              logger,
              readAssistantCapabilities: (input, vibe64User) => terminals.listAssistantCapabilities({ ...input, vibe64User })
            }),
            requireAiManagement: resolvedAccountRuntime.requireAiManagement
          })
        })
      });
      registerLocalAiConnectionRoutes(http, { projectContext });
    }
    registerAuthTerminalRoutes(fastify, {
      accounts,
      projectContext
    });

    return {
      accounts,
      connections
    };
  },
  /**
   * @param {object} capabilities
   * @param {AccountsService} capabilities.accounts
   */
  actions({ accounts }) {
    return createAccountsActions({ accounts });
  }
});

export {
  Vibe64AccountsFeature
};
