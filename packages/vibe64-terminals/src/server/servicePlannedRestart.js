// The editor's planned restart reader, configured from the host's notice path as the terminals service starts, and
// the steering of every chat of every open session (plannedRestartSteering.js) through each chat's own steer: Main
// chat's noteMainChat, a temporary chat's turn start with submissionKind "steer", each shown as Vibe64's note.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { configurePlannedRestart } from "@local/vibe64-core/server/plannedRestart";
import { PLANNED_RESTART_NOTICE_FILE_SETTING } from "@local/vibe64-core/server/plannedRestartNotice";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { MAIN_CHAT_NOTE_TURN_METADATA_KEY } from "./mainChatNote.js";
import { createPlannedRestartSteering } from "./plannedRestartSteering.js";
import { openProjectRuntimeRecords } from "./serviceSessionAccess.js";
import { requestWasWorking, sessionWasWorking } from "./serviceTurnRecovery.js";

const PLANNED_RESTART_RECORDS_DIR = "planned-restarts";

/** A steer's outcome from its result or refusal. Main chat's note answers only whether it was delivered. */
function steerOutcome(promise) {
  return promise.then(
    (result) => (result?.delivered === true ? "delivered" : "not-sent"),
    (error) => (error?.delivery === "not-sent" || error?.details?.delivery?.status === "not-sent" ? "not-sent" : "uncertain")
  );
}

/**
 * @param {object} dependencies
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} dependencies.env
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {string} dependencies.systemRoot the editor's own state, where each notice's record is kept
 * @param {object} dependencies.state
 * @param {object} dependencies.project
 * @param {object} dependencies.sessionAccess
 * @param {object} dependencies.assistantContext
 * @param {object} dependencies.sessionAgent
 * @param {Function} dependencies.noteMainChat
 * @param {Function} dependencies.startTemporaryConversationTurn
 * @param {(sessionId: string) => Promise<void>} dependencies.decideOwed Main chat's step a planned restart paused,
 *   decided again
 */
function createServicePlannedRestart({
  env,
  logger,
  systemRoot,
  state,
  project,
  sessionAccess,
  assistantContext,
  sessionAgent,
  noteMainChat,
  startTemporaryConversationTurn,
  decideOwed
}) {
  const reader = configurePlannedRestart({
    noticeFile: String(env?.[PLANNED_RESTART_NOTICE_FILE_SETTING] || "").trim(),
    recordsRoot: systemRoot ? path.join(systemRoot, PLANNED_RESTART_RECORDS_DIR) : "",
    logger,
    startedAtMs: Math.round(performance.timeOrigin)
  });
  const warn = (error, fields, message) => logOperationalEvent(logger, "warn", {
    component: "vibe64.planned_restart",
    event: "vibe64.planned_restart.chat_visit_failed",
    code: error?.code,
    error: error?.message,
    ...fields
  }, message);

  /** The person a chat's request ran for, still allowed in the project, as its steer's actor. */
  async function actorOptions(metadata) {
    const sender = assistantRoutingRequestForDisplay(metadata || {})?.submittedBy || null;
    const actor = sender
      ? await state.assistantRuntime.authorizeProjectMessage(sender, sessionAccess.projectRuntimeContext().projectSlug).catch(() => null)
      : null;
    return actor ? { vibe64User: actor } : {};
  }

  async function visitSession(session, visit) {
    const sessionId = session.sessionId;
    const context = await assistantContext.assistantSessionOptions(sessionId);
    const sessionName = String(context.session.sessionName || session.sessionName || "");
    const mainOptions = await actorOptions(context.session.metadata);
    await visit({
      sessionId,
      conversationId: "",
      sessionName,
      // The saved records rule most sessions out; the agent itself says whether a turn runs now.
      running: sessionWasWorking(context.session) &&
        Boolean((await sessionAgent.sessionState(sessionId, context).catch(() => null))?.turn?.active),
      steer: message => steerOutcome(noteMainChat(sessionId, { message }, mainOptions)),
      // The restart did not happen: Main chat hears so, and a step it paused starts now.
      tell: message => noteMainChat(sessionId, { message, nextTurn: true }, mainOptions),
      reopen: () => decideOwed(sessionId)
    });
    for (const record of await context.runtime.store.listSessionConversations(sessionId)) {
      if (record.state === "closing") continue;
      const options = await actorOptions(record.routingMetadata);
      const steer = message => steerOutcome(startTemporaryConversationTurn(sessionId, {
        conversationId: record.conversationId,
        message,
        messageId: randomUUID(),
        submissionKind: "steer",
        turnMetadata: { [MAIN_CHAT_NOTE_TURN_METADATA_KEY]: true },
        ...options
      }, { ...options, purpose: "junior" }));
      // A temporary chat keeps no note for its next message: a steer reaches a running turn, and is refused otherwise.
      await visit({
        sessionId,
        conversationId: record.conversationId,
        sessionName,
        running: requestWasWorking(record.routingMetadata),
        steer,
        tell: steer,
        reopen: async () => {}
      });
    }
  }

  // The chats are reached once the server is ready: its recovery of the turns it found starts first.
  const serverReady = Promise.withResolvers();

  /** Visits every chat of every open session of every open project, inside its project. */
  async function forEachChat(visit) {
    await serverReady.promise;
    const listed = await project.listProjects();
    if (listed?.ok === false) throw new Error(listed.error || "The projects could not be listed.");
    for (const projectRecord of openProjectRuntimeRecords(listed)) {
      if (state.lifecycle.closing) return;
      await project.runInProjectContext(projectRecord.slug, async () => {
        for (const session of await sessionAccess.listOpenProjectRuntimeSessions()) {
          await visitSession(session, visit).catch(error => warn(error, { projectSlug: projectRecord.slug, sessionId: session.sessionId },
            "A session's chats could not be told about the planned restart."));
        }
      }).catch(error => warn(error, { projectSlug: projectRecord.slug }, "A project's chats could not be told about the planned restart."));
    }
  }

  const steering = createPlannedRestartSteering({ reader, forEachChat, logger });
  void reader.start();

  return Object.freeze({
    reader,
    /**
     * The server's recovery of the turns it found, which starts before any chat is told about a notice.
     * @param {() => Promise<unknown>} recover
     */
    afterRecoveryStarts: recover => () => {
      const recovering = recover();
      serverReady.resolve();
      return recovering;
    },
    /** As the editor stops: what it stops, in the notice's record. */
    recordStop: () => reader.recordStop(),
    close() {
      steering.close();
      reader.stop();
    }
  });
}

export { createServicePlannedRestart };
