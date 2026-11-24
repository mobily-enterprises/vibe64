import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  getStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";
import { createTerminalActions } from "./terminalActions.js";
import { prepareCodexAttachmentStorage } from "./codexAttachments.js";
import {
  createConversationTurnPublishers,
  createProjectRuntimeChangedPublisher,
  createTerminalSessionChangedPublishers
} from "./events.js";
import { registerRoutes } from "./registerRoutes.js";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";
import { onServerStopBegins } from "@local/vibe64-execution/server/serverStop";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { configureVibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  NO_STAGING_ENVIRONMENT,
  TERMINALS_STAGING_ENVIRONMENT_TOKEN,
  assertStagingEnvironmentProvider
} from "./stagingEnvironment.js";
import { NO_SAVED_ENV_VALUE_LINKS, TERMINALS_SAVED_ENV_VALUE_LINKS_TOKEN, assertSavedEnvValueLinks } from "./savedEnvValueLinks.js";
import { createService } from "./service.js";
import { createProjectServices } from "./projectServices.js";
import { startProjectRuntimeDormancyCleanupSchedule } from "./projectRuntimeDormancy.js";

/** @typedef {import("@jskit-ai/kernel/server/types").FeatureSetupContext} FeatureSetupContext */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("./types.js").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").StagingEnvironmentProvider} StagingEnvironmentProvider */
/** @typedef {import("./types.js").SavedEnvValueLinks} SavedEnvValueLinks */

// Each terminals service's idle-project sweep, started in setup and stopped at shutdown.
const cleanupSchedules = new WeakMap();
// Each terminals service's subscription to the server's stop, which begins its shutdown the moment the stop signal
// arrives: the planned-stop record the next server reads, and every AI engine's closing fence, come first, before the
// capability runtime's reverse order reaches any provider's shutdown.
const stopSubscriptions = new WeakMap();

const Vibe64TerminalsFeature = defineFeature({
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
  // A composed host's staging Env and saved values for the agent Env command.
  optional: {
    stagingEnvironmentProvider: TERMINALS_STAGING_ENVIRONMENT_TOKEN,
    savedEnvValueLinks: TERMINALS_SAVED_ENV_VALUE_LINKS_TOKEN
  },
  provides: {
    terminals: "vibe64.terminals"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeFastify} capabilities.fastify
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {StagingEnvironmentProvider | null} capabilities.stagingEnvironmentProvider
   * @param {ProjectService} capabilities.project
   * @param {SavedEnvValueLinks | null} capabilities.savedEnvValueLinks
   * @param {FeatureSetupContext} context
   */
  setup({
    env,
    events,
    fastify,
    http,
    logger,
    stagingEnvironmentProvider,
    project,
    savedEnvValueLinks
  }, { actionCatalogue }) {
    assertStagingEnvironmentProvider(stagingEnvironmentProvider);
    assertSavedEnvValueLinks(savedEnvValueLinks);
    // Session debug logging, which the sessions and their agent work share, follows the server's env.
    configureVibe64SessionDebugLog(env);
    const projectContext = getStudioProjectContext();
    const terminals = createService({
      actions: actionCatalogue,
      env,
      logger,
      stagingEnvironmentProvider: stagingEnvironmentProvider ?? NO_STAGING_ENVIRONMENT,
      projectServices: createProjectServices(),
      project,
      publishProjectRuntimeChanged: createProjectRuntimeChangedPublisher(events),
      publishSessionChanged: createTerminalSessionChangedPublishers(events),
      conversationTurns: createConversationTurnPublishers(events),
      runtimeProfile: projectContext.runtimeProfile,
      savedEnvValueLinks: savedEnvValueLinks ?? NO_SAVED_ENV_VALUE_LINKS
    });
    registerRoutes(http, {
      fastify,
      localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }),
      projectContext,
      terminals
    });
    stopSubscriptions.set(terminals, onServerStopBegins(() => {
      terminals.beginShutdown();
    }));
    // The idle-project sweep's timer runs from setup, so shutdown stops it even when boot never ran.
    cleanupSchedules.set(terminals, startProjectRuntimeDormancyCleanupSchedule({
      logger,
      serviceFactory: () => terminals
    }));
    fastify.addHook("onReady", async () => {
      // Every feature's boot hooks, including execution and sign-in configuration,
      // have completed before recovery can admit work.
      // A turn the previous server left working is reconciled and resumed once (serviceTurnRecovery.js).
      setImmediate(() => void terminals.recoverInterruptedTurns().catch(error => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.turn_resume",
          event: "vibe64.turn_resume.recovery_failed",
          code: error.code,
          error: error.message
        }, "Interrupted turns could not be recovered after server restart.");
      }));
      setImmediate(() => void terminals.recoverActiveGoals().catch(error => {
        logOperationalEvent(logger, "warn", {
          component: "vibe64.agent_goal",
          event: "vibe64.agent_goal.recovery_failed",
          code: error.code,
          error: error.message
        }, "Active goals could not be recovered after server restart.");
      }));
    });
    return { terminals };
  },
  actions({ terminals }) {
    return createTerminalActions({ terminals });
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {{ outputs: { terminals: TerminalsService } }} context
   */
  async boot({ env }, { outputs }) {
    await prepareCodexAttachmentStorage({ env });
    await cleanupSchedules.get(outputs.terminals).runNow();
  },
  /**
   * @param {object} _dependencies
   * @param {{ outputs: { terminals: TerminalsService } }} context
   */
  async shutdown(_dependencies, { outputs }) {
    stopSubscriptions.get(outputs.terminals)?.();
    stopSubscriptions.delete(outputs.terminals);
    cleanupSchedules.get(outputs.terminals).stop();
    cleanupSchedules.delete(outputs.terminals);
    await outputs.terminals.close();
  }
});

export { Vibe64TerminalsFeature };
