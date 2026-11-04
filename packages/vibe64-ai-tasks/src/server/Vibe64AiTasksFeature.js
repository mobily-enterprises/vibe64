import { defineFeature } from "@jskit-ai/kernel/server/features";
import { isLocalhostCheckBypassEnabled } from "@local/vibe64-core/server/localhostCheckBypass";
import { createSessionChangedPublisher } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { getStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";
import {
  VIBE64_CONVERSATION_TURN_SETTLED_EVENT,
  VIBE64_CONVERSATION_TURN_STARTING_EVENT
} from "@local/vibe64-terminals/server/events";
import { createAiTaskActions } from "./aiTaskActions.js";
import { registerRoutes } from "./registerRoutes.js";
import { createAiTasksService } from "./service.js";

/** @typedef {import("./types.js").AiTasksService} AiTasksService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

const SESSION_ARCHIVING_REASON = "session-archiving";

/**
 * A task follows the session's conversations and its archive through events, so
 * those owners never learn what a task is.
 * @param {RuntimeEvents} events
 * @param {AiTasksService} aiTasks
 */
function followSessionEvents(events, aiTasks) {
  events.register({
    id: "vibe64.ai-tasks.turn-starting",
    matches: event => event.type === VIBE64_CONVERSATION_TURN_STARTING_EVENT,
    handle: event => aiTasks.onTurnStarting(event)
  });
  events.register({
    id: "vibe64.ai-tasks.turn-settled",
    matches: event => event.type === VIBE64_CONVERSATION_TURN_SETTLED_EVENT,
    handle: event => aiTasks.onTurnSettled(event)
  });
  events.register({
    id: "vibe64.ai-tasks.session-archiving",
    matches: event => event.type === "entity.changed" && event.realtime?.payload?.reason === SESSION_ARCHIVING_REASON,
    handle: event => aiTasks.onSessionArchiving(event.entityId)
  });
}

/** One job for an agent, held by the server from its problem to Done or Not done. */
const Vibe64AiTasksFeature = defineFeature({
  id: "vibe64.ai-tasks",
  domain: "vibe64-ai-tasks",
  requires: {
    env: "runtime.env",
    events: "runtime.events",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    sessions: "vibe64.sessions",
    terminals: "vibe64.terminals"
  },
  provides: {
    aiTasks: "vibe64.ai-tasks"
  },
  /**
   * @param {object} capabilities
   * @param {RuntimeEnv} capabilities.env
   * @param {RuntimeEvents} capabilities.events
   * @param {RuntimeHttp} capabilities.http
   * @param {RuntimeLogger} capabilities.logger
   * @param {ProjectService} capabilities.project
   * @param {SessionsService} capabilities.sessions
   * @param {TerminalsService} capabilities.terminals
   */
  setup({ env, events, http, logger, project, sessions, terminals }) {
    const aiTasks = createAiTasksService({
      logger,
      project,
      publishSessionChanged: createSessionChangedPublisher({ events }),
      sessions,
      terminals
    });
    followSessionEvents(events, aiTasks);
    registerRoutes(http, {
      localhostCheckBypassed: isLocalhostCheckBypassEnabled({ env }),
      projectContext: getStudioProjectContext()
    });
    return { aiTasks };
  },
  /**
   * @param {object} capabilities
   * @param {AiTasksService} capabilities.aiTasks
   */
  actions({ aiTasks }) {
    return createAiTaskActions({ aiTasks });
  },
  /**
   * A server that holds one project picks up its tasks at boot; any other
   * finds them when a person next reads them.
   * @param {object} capabilities
   * @param {ProjectService} capabilities.project
   * @param {{ outputs: { aiTasks: AiTasksService } }} context
   */
  boot({ project }, { outputs }) {
    if (!project.targetRoot) return;
    void project.runInProjectContext(project.currentProjectSlug(), () => outputs.aiTasks.resumeInterruptedTasks());
  },
  /**
   * @param {object} _capabilities
   * @param {{ outputs: { aiTasks: AiTasksService } }} context
   */
  shutdown(_capabilities, { outputs }) {
    outputs.aiTasks.closeRunner();
  }
});

export {
  Vibe64AiTasksFeature
};
