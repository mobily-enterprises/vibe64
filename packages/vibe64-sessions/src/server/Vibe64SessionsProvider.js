import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

import { createProjectWatchActions, createSessionActions } from "./actions.js";
import { registerProjectWatch } from "./projectWatch.js";
import { createRepositoryUpdateProbe } from "./repositoryUpdateProbe.js";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
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

// Startup resumes interrupted archives, then interrupted renewals. Each step
// runs even when the other fails, and every failure is logged with its
// session. Shutdown stops the archive loop between sessions.
function createSessionRenewalRecoveryTask({ recover, logger = null } = {}) {
  if (typeof recover !== "function") {
    throw new TypeError("Session renewal recovery task requires recover().");
  }
  let activeRecovery = null;
  let started = false;
  let stopped = false;
  const stopping = new AbortController();

  function reportFailure(failure = {}) {
    logOperationalEvent(logger, "warn", {
      code: String(failure.code || "vibe64_session_recovery_failed"),
      component: "vibe64.sessions",
      error: String(failure.error || "Session recovery failed."),
      event: "vibe64.sessions.recovery.session_failed",
      ...(failure.sessionId ? { sessionId: String(failure.sessionId) } : {})
    }, "An interrupted session archive or renewal could not resume.");
  }

  return Object.freeze({
    start() {
      if (stopped || started) {
        return activeRecovery;
      }
      started = true;
      let result;
      try {
        result = recover({ signal: stopping.signal });
      } catch (error) {
        result = Promise.reject(error);
      }
      const recovery = Promise.resolve(result)
        .then((report) => {
          for (const failure of Array.isArray(report?.failures) ? report.failures : []) reportFailure(failure);
        })
        .catch((error) => {
          reportFailure({ code: error?.code, error: error?.message });
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
      stopping.abort();
      await activeRecovery;
    }
  });
}

async function resumeInterruptedSessionWork(sessions, { signal } = {}) {
  const failures = [];
  for (const [step, resume] of [
    ["archive", () => sessions.resumeSessionArchives({ signal })],
    ["renewal", () => sessions.resumeSessionRenewals()]
  ]) {
    if (signal?.aborted) break;
    try {
      failures.push(...((await resume())?.failures || []));
    } catch (error) {
      failures.push({
        code: String(error?.code || `vibe64_session_${step}_recovery_failed`),
        error: String(error?.message || `Session ${step} recovery failed.`)
      });
    }
  }
  return { failures };
}

function createVibe64SessionsFeature() {
  const recoveryTasks = new WeakMap();
  const stoppedServices = new WeakSet();

  function recoveryTaskFor(sessions, logger) {
    if (stoppedServices.has(sessions)) {
      return null;
    }
    let task = recoveryTasks.get(sessions);
    if (!task) {
      task = createSessionRenewalRecoveryTask({
        logger,
        recover: (options) => resumeInterruptedSessionWork(sessions, options)
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
      logger: "runtime.logger",
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
    boot({ logger, project }, { outputs }) {
      if (!String(project?.targetRoot || "").trim()) {
        return;
      }
      recoveryTaskFor(outputs.sessions, logger)?.start();
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

// Browser pages watch the projects and sessions they show over realtime
// (projectWatch.js); the project update probe runs while a page watches the
// project or an agent turn runs in it. Authenticated realtime may be composed
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
      matches: (event) => event?.type === "entity.changed" && event.entity === "session" &&
        TURN_ACTIVE_REASONS.has(event.realtime?.payload?.reason),
      handle: (event) => probe.wake(event.realtime.payload.projectSlug)
    });
    const closeWatches = registerProjectWatch({ actions: actionCatalogue, realtime });
    return { repositoryUpdates: { probe, close() {
      closeWatches();
      probe.close();
    } } };
  },
  actions: ({ repositoryUpdates }) => createProjectWatchActions({ probe: repositoryUpdates.probe }),
  shutdown(_deps, { outputs }) {
    outputs.repositoryUpdates.close();
  }
});

export { Vibe64RepositoryUpdatesProvider, Vibe64SessionsProvider };
