import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

import { createRepositoryUpdateWatchActions, createSessionActions } from "./actions.js";
import { createRepositoryUpdateProbe, registerRepositoryUpdateWatch } from "./repositoryUpdateProbe.js";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { registerApprovalCountReader } from "@local/vibe64-core/server/studioProjectContext";
import { createVibe64ProjectChangedPublisher } from "@local/vibe64-project/server/actions";
import { countWaitingMainChatApprovals } from "./mainChatApprovals.js";
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
      accounts: "vibe64.accounts",
      events: "runtime.events",
      http: "runtime.http",
      project: "vibe64.project",
      sourceEditor: "vibe64.source-editor",
      terminals: "vibe64.terminals"
    },
    provides: {
      sessions: "vibe64.sessions"
    },
    actionDefaults: {
      channels: ["api", "automation", "internal"],
      surfaces: ["app"]
    },
    setup({ accounts, events, http, project, sourceEditor, terminals }, { actionCatalogue }) {
      const sessionPresence = createSessionPresenceService({
        onPublishError: (error) => {
          vibe64SessionDebugLog("server.sessions.presence.publish.error", {
            error: vibe64SessionDebugError(error)
          });
        },
        publishPresence: createSessionPresencePublisher(events)
      });
      const sessions = createService({
        actions: actionCatalogue,
        initializeModelRouting: (input) => accounts.initializeModelRouting(input),
        project,
        publishProjectChanged: createVibe64ProjectChangedPublisher({ events }),
        publishSessionChanged: createSessionChangedPublisher(events),
        sessionPresence,
        sourceEditor,
        terminals
      });
      registerApprovalCountReader(countWaitingMainChatApprovals);
      project.setTemplateApplicationObserver(({ sessionId }) => sessions.prepareStarterWorkspace(sessionId));
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
      const closing = sessions.closeSessionRenewalWork();
      const task = recoveryTasks.get(sessions);
      const operations = [
        Promise.resolve(closing),
        Promise.resolve(sessions.closeSessionPresence()),
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

// The terminals publish these when an agent turn starts in a session.
const TURN_ACTIVE_REASONS = new Set([
  "claude-stream-turn-active",
  "codex-app-server-turn-active",
  "opencode-server-turn-active"
]);

// The project update probe runs while a browser watches the project over
// realtime or an agent turn runs in it. Authenticated realtime may be composed
// on top of sessions, so it attaches only after both owners exist.
const Vibe64RepositoryUpdatesProvider = defineFeature({
  id: "vibe64.sessions.repository-updates",
  domain: "vibe64-sessions",
  requires: { events: "runtime.events", realtime: "runtime.realtime", sessions: "vibe64.sessions" },
  provides: { repositoryUpdates: "vibe64.sessions.repository-updates" },
  actionDefaults: { channels: ["api"], surfaces: ["app"] },
  setup({ events, realtime, sessions }, { actionCatalogue }) {
    const probe = createRepositoryUpdateProbe({
      probe: (slug, state) => sessions.probeRepositoryUpdates(slug, state),
      onError: (error, projectSlug) => {
        vibe64SessionDebugLog("server.sessions.repositoryUpdates.probe.error", {
          error: vibe64SessionDebugError(error),
          projectSlug
        });
      }
    });
    events.register({
      id: "vibe64.sessions.repository-updates.turn-active",
      matches: (event) => event?.entity === "session" && TURN_ACTIVE_REASONS.has(event.realtime?.payload?.reason),
      handle: (event) => probe.wake(event.realtime.payload.projectSlug)
    });
    const closeWatches = registerRepositoryUpdateWatch({ actions: actionCatalogue, realtime });
    return { repositoryUpdates: { probe, close() {
      closeWatches();
      probe.close();
    } } };
  },
  actions: ({ repositoryUpdates }) => createRepositoryUpdateWatchActions({ probe: repositoryUpdates.probe }),
  shutdown(_deps, { outputs }) {
    outputs.repositoryUpdates.close();
  }
});

export { Vibe64RepositoryUpdatesProvider, Vibe64SessionsProvider };
