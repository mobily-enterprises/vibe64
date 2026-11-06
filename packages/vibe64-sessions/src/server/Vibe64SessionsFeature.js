import { defineFeature } from "@jskit-ai/kernel/server/features";

import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";

import { createProjectWatchActions, createSessionActions } from "./sessionActions.js";
import { registerProjectWatch } from "./projectWatch.js";
import { createRepositoryUpdateProbe } from "./repositoryUpdateProbe.js";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { getStudioProjectContext, registerApprovalCountReader } from "@local/vibe64-core/server/studioProjectContext";
import { createVibe64ProjectChangedPublisher } from "@local/vibe64-project/server/actions";
import { countWaitingMainChatApprovals } from "./mainChatApprovals.js";
import { registerRoutes } from "./registerRoutes.js";
import { createRepositoryUpdates } from "./repositoryUpdates.js";
import { createService } from "./service.js";
import { stopSessionWork } from "./sessionShutdown.js";
import { SESSION_ARCHIVE_PREPARATION_TOKEN, assertArchivePreparation, prepareNothingForArchive } from "./sessionArchive.js";
import {
  SESSION_RENEWAL_ACTOR_RESOLVER_TOKEN,
  assertRenewalActorResolver,
  restoreRenewalActorWith,
  restoreStandaloneRenewalActor
} from "./sessionRenewalActors.js";
import { createTerminalsSetupRunner } from "./sessionWorkspaceSetup.js";
import {
  createSessionPresencePublisher,
  createSessionPresenceService
} from "./sessionPresence.js";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./types.js").SessionsService} SessionsService */
/** @typedef {import("./types.js").SessionRepositoryUpdates} SessionRepositoryUpdates */
/** @typedef {import("@local/vibe64-accounts/server/types").AccountsService} AccountsService */
/** @typedef {import("@jskit-ai/kernel/server/types").FeatureSetupContext} FeatureSetupContext */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@jskit-ai/realtime/server/types").RuntimeRealtime} RuntimeRealtime */
/** @typedef {import("@local/vibe64-source-editor/server/types").SourceEditorService} SourceEditorService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").SessionArchivePreparation} SessionArchivePreparation */
/** @typedef {import("./types.js").RenewalActorResolver} RenewalActorResolver */

// Each runtime's core slot registration, released at its shutdown. A feature's outputs hold only its declared
// capabilities, so the release is kept beside the sessions service it belongs to.
const slotReleases = new WeakMap();

const Vibe64SessionsFeature = defineFeature({
  id: "vibe64.sessions",
  domain: "vibe64-sessions",
  requires: {
    accounts: "vibe64.accounts",
    env: "runtime.env",
    events: "runtime.events",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    sourceEditor: "vibe64.source-editor",
    terminals: "vibe64.terminals"
  },
  // A composed host's preparation of each archive, and its people's resolver
  // for renewals that continue without them.
  optional: {
    archivePreparation: SESSION_ARCHIVE_PREPARATION_TOKEN,
    renewalActorResolver: SESSION_RENEWAL_ACTOR_RESOLVER_TOKEN
  },
  provides: {
    sessions: "vibe64.sessions"
  },
  /**
   * @param {object} capabilities
   * @param {AccountsService} capabilities.accounts
   * @param {SessionArchivePreparation | null} capabilities.archivePreparation
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {RenewalActorResolver | null} capabilities.renewalActorResolver
   * @param {SourceEditorService} capabilities.sourceEditor
   * @param {TerminalsService} capabilities.terminals
   * @param {FeatureSetupContext} context
   */
  setup({
    accounts,
    archivePreparation,
    env,
    events,
    http,
    logger,
    project,
    renewalActorResolver,
    sourceEditor,
    terminals
  }, { actionCatalogue }) {
    assertArchivePreparation(archivePreparation);
    assertRenewalActorResolver(renewalActorResolver);
    const localhostCheckBypassed = isLocalhostCheckBypassEnabled({ env });
    const sessionPresence = createSessionPresenceService({
      onPublishError: (error) => {
        vibe64SessionDebugLog("server.sessions.presence.publish.error", {
          error: vibe64SessionDebugError(error)
        });
      },
      publishPresence: createSessionPresencePublisher({ events })
    });
    const sessions = createService({
      actions: actionCatalogue,
      archivePreparation: archivePreparation ?? prepareNothingForArchive,
      initializeModelRouting: (input) => accounts.initializeModelRouting(input),
      localhostCheckBypassed,
      logger,
      project,
      publishProjectChanged: createVibe64ProjectChangedPublisher({ events }),
      publishSessionChanged: createSessionChangedPublisher({ events }),
      restoreRenewalActor: renewalActorResolver ? restoreRenewalActorWith(renewalActorResolver) : restoreStandaloneRenewalActor,
      sessionPresence,
      setupRunner: createTerminalsSetupRunner({ terminals }),
      sourceEditor,
      terminals
    });
    slotReleases.set(sessions, registerApprovalCountReader(countWaitingMainChatApprovals));
    // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.project
    project.setTemplateApplicationObserver(({ sessionId }) => sessions.prepareStarterWorkspace(sessionId));
    registerRoutes(http, { localhostCheckBypassed, projectContext: getStudioProjectContext() });
    return { sessions };
  },
  actions({ sessions }) {
    return createSessionActions({ sessions });
  },
  /**
   * When the server has a target project, boot resumes that project's
   * interrupted archives and renewals without waiting for them; otherwise
   * boot does nothing.
   * @param {object} capabilities
   * @param {ProjectService} capabilities.project
   * @param {{ outputs: { sessions: SessionsService } }} context
   */
  boot({ project }, { outputs }) {
    if (project.targetRoot) {
      outputs.sessions.resumeInterruptedWork();
    }
  },
  /**
   * Setup always fills the same slots, so shutdown always clears them: the approval count reader and the
   * template observer first, then the sessions' work stops, and then the terminals' plan completion and
   * connected preparation, which that work may still use while it stops.
   * @param {object} capabilities
   * @param {ProjectService} capabilities.project
   * @param {TerminalsService} capabilities.terminals
   * @param {{ outputs: { sessions: SessionsService } }} context
   */
  async shutdown({ project, terminals }, { outputs }) {
    slotReleases.get(outputs.sessions)();
    // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.project
    project.setTemplateApplicationObserver(null);
    try {
      await stopSessionWork({ sessions: outputs.sessions, terminals });
    } finally {
      // readable-check: allow setter-seam - cycle: vibe64.sessions requires vibe64.terminals
      terminals.setPlanCompleted(null);
    }
  }
});

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
const Vibe64RepositoryUpdatesFeature = defineFeature({
  id: "vibe64.sessions.repository-updates",
  domain: "vibe64-sessions",
  requires: {
    events: "runtime.events",
    realtime: "runtime.realtime",
    sessions: "vibe64.sessions"
  },
  provides: {
    repositoryUpdates: "vibe64.sessions.repository-updates"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeRealtime} capabilities.realtime
   * @param {SessionsService} capabilities.sessions
   * @param {FeatureSetupContext} context
   */
  setup({
    events,
    realtime,
    sessions
  }, { actionCatalogue }) {
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
    return { repositoryUpdates: createRepositoryUpdates({ probe, closeWatches }) };
  },
  actions({ repositoryUpdates }) {
    return createProjectWatchActions({ repositoryUpdates });
  },
  /**
   * @param {object} _deps
   * @param {{ outputs: { repositoryUpdates: SessionRepositoryUpdates } }} context
   */
  shutdown(_deps, { outputs }) {
    outputs.repositoryUpdates.close();
  }
});

export {
  Vibe64RepositoryUpdatesFeature,
  Vibe64SessionsFeature
};
