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
import { createTerminalActions } from "./actions.js";
import { prepareCodexAttachmentStorage } from "./codexAttachments.js";
import {
  createProjectRuntimeChangedPublisher
} from "./events.js";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { registerRoutes } from "./registerRoutes.js";
import {
  createService,
  startProjectRuntimeDormancyCleanupSchedule
} from "./service.js";

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

function createVibe64TerminalsFeature({
  codexTerminalController = {},
  opencodeTerminalController = {},
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
      uploads: "runtime.uploads",
      project: "vibe64.project"
    },
    provides: {
      terminals: "vibe64.terminals"
    },
    actionDefaults: {
      channels: ["api", "automation", "internal"],
      surfaces: ["app"]
    },
    setup({ env, events, fastify, http, logger, project, uploads }, { actionCatalogue }) {
      const sessionChanged = createSessionChangedPublisher(events);
      const terminals = createService({
        actions: actionCatalogue,
        codexTerminalController,
        env: terminalsProviderEnv(env),
        logger,
        opencodeTerminalController,
        projectServices,
        projectService: project,
        publishProjectRuntimeChanged: createProjectRuntimeChangedPublisher(events),
        publishSessionChanged: {
          agentTerminal: sessionChanged,
          agentTerminalClosed: sessionChanged,
          outputTarget: sessionChanged,
          outputTargetClosed: sessionChanged,
          outputTargetStopped: sessionChanged
        }
      });
      registerRoutes(http, {
        fastify,
        projectContext: getStudioProjectContext(),
        routeRelativePath: "vibe64",
        routeSurface: "app",
        terminals,
        uploads
      });
      registerRoutes(http, {
        fastify, actions: actionCatalogue, learningScoped: true,
        routeSurface: "app", terminals
      });
      fastify.addHook("onReady", async () => {
        // All feature boot hooks (including hosted execution/auth configuration)
        // have completed before recovery can admit work.
        setImmediate(() => void terminals.recoverActiveGoals().catch(error => {
          logger?.warn({ code: error.code, error: error.message }, "Active goals could not be recovered after server restart.");
        }));
      });
      return { terminals };
    },
    actions: ({ terminals }) => createTerminalActions({ terminals }),
    async boot({ env, logger }, { outputs }) {
      await prepareCodexAttachmentStorage({ env });
      const schedule = startProjectRuntimeDormancyCleanupSchedule({
        logger,
        serviceFactory: () => outputs.terminals
      });
      cleanupSchedules.set(outputs.terminals, schedule);
      await schedule.runNow();
    },
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
