// The editor's planned restart reader, configured from the host's notice path as the terminals service starts, and
// the steering of every chat of every open session (plannedRestartSteering.js) through each chat's own steer: Main
// chat's noteMainChat, a temporary chat's turn start with submissionKind "steer", each shown as Vibe64's note.

import { randomUUID } from "node:crypto";
import path from "node:path";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { configurePlannedRestart } from "@local/vibe64-core/server/plannedRestart";
import { PLANNED_RESTART_NOTICE_FILE_SETTING } from "@local/vibe64-core/server/plannedRestartNotice";
import { assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { MAIN_CHAT_NOTE_TURN_METADATA_KEY, createMainChatNote } from "./mainChatNote.js";
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
 * @param {object} workspace
 * @param {import("@jskit-ai/kernel/server/types").RuntimeEnv} workspace.env
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} workspace.logger
 * @param {import("./types.js").ServiceState} workspace.state
 * @param {import("./types.js").ProjectService} workspace.project
 * @param {object} workspace.sessionAccess the service's session access (serviceSessionAccess.js)
 * @param {string} workspace.systemRoot the editor's own state, where each notice's record is kept
 * @param {object} chats
 * @param {object} chats.assistantContext the service's assistant context (serviceAssistantContext.js)
 * @param {import("./types.js").SessionAgentManager} chats.sessionAgent
 * @param {{ sendAgentMessage: Function, startTemporaryConversationTurn: Function }} chats.assistant
 * @param {{ decideOwed: (sessionId: string) => Promise<void> }} chats.assistantRouting Main chat's step a planned
 *   restart paused, decided again
 */
function createServicePlannedRestart(
  { env, logger, state, project, sessionAccess, systemRoot },
  { assistantContext, sessionAgent, assistant, assistantRouting }
) {
  const noteMainChat = createMainChatNote({ assistantContext, logger, sendAgentMessage: assistant.sendAgentMessage, sessionAgent });
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
      reopen: () => assistantRouting.decideOwed(sessionId)
    });
    for (const record of await context.runtime.store.listSessionConversations(sessionId)) {
      if (record.state === "closing") continue;
      const options = await actorOptions(record.routingMetadata);
      const steer = message => steerOutcome(assistant.startTemporaryConversationTurn(sessionId, {
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
      const projectSlug = projectRecord.slug;
      await project.runInProjectContext(projectSlug, async () => {
        for (const session of await sessionAccess.listOpenProjectRuntimeSessions()) {
          const fields = { projectSlug, sessionId: session.sessionId };
          await visitSession(session, visit).catch(error => warn(error, fields, "A session's chats could not be told about the planned restart."));
        }
      }).catch(error => warn(error, { projectSlug }, "A project's chats could not be told about the planned restart."));
    }
  }

  const steering = createPlannedRestartSteering({ reader, forEachChat, logger });
  void reader.start();

  /**
   * The server's recovery of the turns it found, which starts before any chat is told about a notice.
   * @param {() => Promise<unknown>} recover
   */
  function afterRecoveryStarts(recover) {
    return () => {
      const recovering = recover();
      serverReady.resolve();
      return recovering;
    };
  }

  /** As the editor stops: what it stops, in the notice's record. */
  function recordStop() {
    reader.recordStop();
  }

  function close() {
    steering.close();
    void reader.stop();
  }

  return Object.freeze({
    reader,
    afterRecoveryStarts,
    recordStop,
    close
  });
}

export { createServicePlannedRestart };
