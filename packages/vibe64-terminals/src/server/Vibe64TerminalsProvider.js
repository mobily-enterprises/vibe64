import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createTerminalActions } from "./terminalActions.js";
import { prepareCodexAttachmentStorage } from "./codexAttachments.js";
import {
  createProjectRuntimeChangedPublisher,
  createTerminalSessionChangedPublishers
} from "./events.js";
import { registerRoutes } from "./registerRoutes.js";
import {
  NO_PRODUCTION_ENVIRONMENT,
  TERMINALS_PRODUCTION_ENVIRONMENT_TOKEN,
  assertProductionEnvironmentProvider
} from "./productionEnvironment.js";
import { NO_SAVED_ENV_VALUE_LINKS, TERMINALS_SAVED_ENV_VALUE_LINKS_TOKEN, assertSavedEnvValueLinks } from "./savedEnvValueLinks.js";
import {
  createService,
  startProjectRuntimeDormancyCleanupSchedule
} from "./service.js";

/** @typedef {import("./types.js").ProjectServices} ProjectServices */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").ProductionEnvironmentProvider} ProductionEnvironmentProvider */
/** @typedef {import("./types.js").SavedEnvValueLinks} SavedEnvValueLinks */

const LIVE_HOST_ENV_KEYS = Object.freeze([
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV,
  "VIBE64_PREVIEW_PROXY_SOCKET_DIR",
  "VIBE64_HOST_AGENT_GUIDANCE",
  "VIBE64_CLAUDE_COMMAND"
]);

function terminalsProviderEnv(runtimeEnv = {}, liveEnv = process.env) {
  const env = {
    ...(runtimeEnv && typeof runtimeEnv === "object" && !Array.isArray(runtimeEnv) ? runtimeEnv : {})
  };
  for (const key of LIVE_HOST_ENV_KEYS) {
    const value = String(liveEnv?.[key] || "").trim();
    if (value) {
      env[key] = value;
    }
  }
  return env;
}

/**
 * @param {object} dependencies
 * @param {object} [dependencies.codexTerminalController] a host's Codex terminal settings
 * @param {object} [dependencies.opencodeTerminalController] a host's OpenCode terminal settings
 * @param {ProjectServices | null} [dependencies.projectServices]
 */
function createVibe64TerminalsFeature({
  // readable-check: allow dependency-default - data: a host's Codex terminal settings, none by default
  codexTerminalController = {},
  // readable-check: allow dependency-default - data: a host's OpenCode terminal settings, none by default
  opencodeTerminalController = {},
  // readable-check: allow dependency-default - optional operation: without supplied project services the terminals service creates its own
  projectServices = null
} = {}) {
  const cleanupSchedules = new WeakMap();
  return defineFeature({
    id: "vibe64.terminals",
    domain: "vibe64-terminals",
    requires: {
      env: "runtime.env",
      events: "runtime.events",
      fastify: "runtime.fastify",
      http: "runtime.http",
      logger: "runtime.logger",
      // Its provider registers the multipart parser that the attachment routes read.
      uploads: "runtime.uploads",
      project: "vibe64.project"
    },
    // A composed host's production Env and saved values for the agent Env command.
    optional: {
      productionEnvironmentProvider: TERMINALS_PRODUCTION_ENVIRONMENT_TOKEN,
      savedEnvValueLinks: TERMINALS_SAVED_ENV_VALUE_LINKS_TOKEN
    },
    provides: {
      terminals: "vibe64.terminals"
    },
    actionDefaults: {
      channels: ["api", "automation", "internal"],
      surfaces: ["app"]
    },
    /**
     * @param {object} capabilities
     * @param {RuntimeEnv} capabilities.env
     * @param {RuntimeEvents} capabilities.events
     * @param {RuntimeFastify} capabilities.fastify
     * @param {RuntimeHttp} capabilities.http
     * @param {RuntimeLogger} capabilities.logger
     * @param {ProductionEnvironmentProvider | null} capabilities.productionEnvironmentProvider
     * @param {ProjectService} capabilities.project
     * @param {SavedEnvValueLinks | null} capabilities.savedEnvValueLinks
     * @param {{ actionCatalogue: ActionCatalogue }} context
     */
    setup({ env, events, fastify, http, logger, productionEnvironmentProvider, project, savedEnvValueLinks }, { actionCatalogue }) {
      assertProductionEnvironmentProvider(productionEnvironmentProvider);
      assertSavedEnvValueLinks(savedEnvValueLinks);
      const terminals = createService({
        actions: actionCatalogue,
        codexTerminalController,
        env: terminalsProviderEnv(env),
        logger,
        opencodeTerminalController,
        productionEnvironmentProvider: productionEnvironmentProvider ?? NO_PRODUCTION_ENVIRONMENT,
        projectServices,
        projectService: project,
        publishProjectRuntimeChanged: createProjectRuntimeChangedPublisher(events),
        publishSessionChanged: createTerminalSessionChangedPublishers(events),
        savedEnvValueLinks: savedEnvValueLinks ?? NO_SAVED_ENV_VALUE_LINKS
      });
      registerRoutes(http, {
        fastify,
        projectContext: getStudioProjectContext(),
        terminals
      });
      fastify.addHook("onReady", async () => {
        // All feature boot hooks (including hosted execution/auth configuration)
        // have completed before recovery can admit work.
        setImmediate(() => void terminals.recoverActiveGoals().catch(error => {
          logger.warn({ code: error.code, error: error.message }, "Active goals could not be recovered after server restart.");
        }));
      });
      return { terminals };
    },
    actions: ({ terminals }) => createTerminalActions({ terminals }),
    /**
     * @param {object} capabilities
     * @param {RuntimeEnv} capabilities.env
     * @param {RuntimeLogger} capabilities.logger
     * @param {{ outputs: { terminals: TerminalsService } }} context
     */
    async boot({ env, logger }, { outputs }) {
      await prepareCodexAttachmentStorage({ env });
      const schedule = startProjectRuntimeDormancyCleanupSchedule({
        logger,
        serviceFactory: () => outputs.terminals
      });
      cleanupSchedules.set(outputs.terminals, schedule);
      await schedule.runNow();
    },
    /**
     * @param {object} _dependencies
     * @param {{ outputs: { terminals: TerminalsService } }} context
     */
    async shutdown(_dependencies, { outputs }) {
      cleanupSchedules.get(outputs.terminals)?.stop();
      cleanupSchedules.delete(outputs.terminals);
      await outputs.terminals.close();
    }
  });
}

const Vibe64TerminalsProvider = createVibe64TerminalsFeature();

export {
  Vibe64TerminalsProvider,
  createVibe64TerminalsFeature,
  terminalsProviderEnv
};
