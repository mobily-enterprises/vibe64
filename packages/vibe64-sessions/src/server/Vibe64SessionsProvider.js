import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

import { createSessionActions } from "./actions.js";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { registerRoutes } from "./registerRoutes.js";
import { createService } from "./service.js";
import {
  createSessionPresencePublisher,
  createSessionPresenceService
} from "./sessionPresence.js";

function createSessionRenewalRecoveryTask({ recover } = {}) {
  if (typeof recover !== "function") {
    throw new TypeError("Session renewal recovery task requires recover().");
  }
  let activeRecovery = null;
  let started = false;
  let stopped = false;

  return Object.freeze({
    start() {
      if (stopped || started) {
        return activeRecovery;
      }
      started = true;
      let result;
      try {
        result = recover();
      } catch (error) {
        result = Promise.reject(error);
      }
      const recovery = Promise.resolve(result)
        .catch((error) => {
          vibe64SessionDebugLog("server.sessions.renewal.resume.error", {
            error: vibe64SessionDebugError(error)
          });
        })
        .finally(() => {
          if (activeRecovery === recovery) {
            activeRecovery = null;
          }
        });
      activeRecovery = recovery;
      return recovery;
    },
    async stop() {
      stopped = true;
      await activeRecovery;
    }
  });
}

function createVibe64SessionsFeature() {
  const recoveryTasks = new WeakMap();
  const stoppedServices = new WeakSet();

  function recoveryTaskFor(sessions) {
    if (stoppedServices.has(sessions)) {
      return null;
    }
    let task = recoveryTasks.get(sessions);
    if (!task) {
      task = createSessionRenewalRecoveryTask({
        recover: async () => {
          await sessions.resumeSessionArchives();
          return sessions.resumeSessionRenewals();
        }
      });
      recoveryTasks.set(sessions, task);
    }
    return task;
  }

  return defineFeature({
    id: "vibe64.sessions",
    domain: "vibe64-sessions",
    requires: {
      events: "runtime.events",
      http: "runtime.http",
      project: "vibe64.project",
      terminals: "vibe64.terminals"
    },
    provides: {
      sessions: "vibe64.sessions"
    },
    actionDefaults: {
      channels: ["api", "automation", "internal"],
      surfaces: ["app"]
    },
    setup({ events, http, project, terminals }) {
      const sessionPresence = createSessionPresenceService({
        onPublishError: (error) => {
          vibe64SessionDebugLog("server.sessions.presence.publish.error", {
            error: vibe64SessionDebugError(error)
          });
        },
        publishPresence: createSessionPresencePublisher(events)
      });
      const sessions = createService({
        project,
        publishSessionChanged: createSessionChangedPublisher(events),
        sessionPresence,
        terminals
      });
      registerRoutes(http, {
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });
      return { sessions };
    },
    actions({ sessions }) {
      return createSessionActions({ sessions });
    },
    boot({ project }, { outputs }) {
      if (!String(project?.targetRoot || "").trim()) {
        return;
      }
      recoveryTaskFor(outputs.sessions)?.start();
    },
    async shutdown({ terminals }, { outputs }) {
      const sessions = outputs.sessions;
      stoppedServices.add(sessions);
      const closing = typeof sessions.closeSessionRenewalWork === "function"
        ? sessions.closeSessionRenewalWork()
        : null;
      const task = recoveryTasks.get(sessions);
      const operations = [
        Promise.resolve(closing),
        Promise.resolve(sessions.closeSessionPresence?.()),
        ...(task ? [task.stop()] : []),
        Promise.resolve().then(async () => {
          const result = await terminals.invalidateAgentRuntimes({
            reason: "server-shutdown"
          });
          if (result?.ok === false) {
            const error = new Error("Assistant runtime shutdown did not complete successfully.");
            error.code = "vibe64_agent_runtime_shutdown_failed";
            error.details = result;
            throw error;
          }
          return result;
        })
      ];
      const results = await Promise.allSettled(operations);
      recoveryTasks.delete(sessions);
      const failures = results.flatMap((result) => (
        result.status === "rejected" ? [result.reason] : []
      ));
      if (failures.length > 0) {
        throw new AggregateError(
          failures,
          "Session renewal work did not stop cleanly."
        );
      }
    }
  });
}

const Vibe64SessionsProvider = createVibe64SessionsFeature();

export { Vibe64SessionsProvider };
