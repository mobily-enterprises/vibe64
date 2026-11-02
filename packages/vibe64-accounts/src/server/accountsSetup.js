import { createAiConnectionActions } from "./accountsActions.js";
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
import { createAccountsRuntime } from "./accountsRuntime.js";
import { createConnections } from "./connections.js";
import { createPersonalProfile, NO_PERSONAL_PROFILE } from "./personalProfile.js";
import { warnMissingOperatorClis } from "./operatorCliWarning.js";
import { configureSignInStatusRuntime } from "./signInStatusRuntime.js";
import { createService } from "./service.js";
import {
  VIBE64_SYSTEM_ROOT_ENV,
  VIBE64_TARGET_ROOT_ENV,
  runtimeProfileIsLocal
} from "@local/vibe64-core/server/studioRoots";
import {
  createPersonalAiProfileStore
} from "@local/vibe64-core/server/personalAiProfile";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createAssistantRoutingStore } from "@local/vibe64-core/server/assistantRoutingStore";
import { registerTeamAiReadiness } from "@local/vibe64-core/server/teamAiGate";
import { doNothing } from "@local/vibe64-core/shared/doNothing";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * Builds the accounts and connections services and registers the accounts routes, actions and team AI readiness.
 * A host-supplied account runtime replaces the local one and owns its own AI connection wiring.
 * @param {object} dependencies
 * @param {AccountsRuntime} [dependencies.accountRuntime]
 * @param {ActionCatalogue} dependencies.actionCatalogue
 * @param {RuntimeEnv} dependencies.env
 * @param {RuntimeEvents} dependencies.events
 * @param {RuntimeFastify} dependencies.fastify
 * @param {RuntimeHttp} dependencies.http
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectService} dependencies.project
 * @param {TerminalsService} dependencies.terminals
 */
function setupAccounts({
  accountRuntime,
  actionCatalogue,
  env,
  events,
  fastify,
  http,
  logger,
  project,
  terminals
}) {
  warnMissingOperatorClis(env);
  const systemRoot = String(env[VIBE64_SYSTEM_ROOT_ENV] || "");
  const targetRoot = String(env[VIBE64_TARGET_ROOT_ENV] || "");
  const projectContext = getStudioProjectContext();
  const localRuntime = runtimeProfileIsLocal(projectContext.runtimeProfile);
  const resolvedAccountRuntime = accountRuntime ?? createAccountsRuntime({
    env: process.env,
    project,
    systemRoot,
    targetRoot
  });
  const accounts = createService({
    accountRuntime: resolvedAccountRuntime,
    env: process.env,
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
  let releaseTeamAiReadiness = doNothing;
  if (resolvedAccountRuntime.systemRoot) {
    const teamAi = createTeamAiReadiness({
      routingStore: createAssistantRoutingStore({ systemRoot: resolvedAccountRuntime.systemRoot }),
      terminals
    });
    releaseTeamAiReadiness = registerTeamAiReadiness(teamAi.ready);
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
    outputs: {
      accounts,
      connections
    },
    releaseTeamAiReadiness
  };
}

export {
  setupAccounts
};
