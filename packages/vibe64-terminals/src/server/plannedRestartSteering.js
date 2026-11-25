// What every AI in the workspace hears about a planned restart (@local/vibe64-core/server/plannedRestart). When a
// notice comes, each chat whose turn is running, Main chat and temporary chats in every open session, is steered with
// Vibe64's note through the chat's ordinary steer, shown as Vibe64's and never as the person's; its subagents hear it
// through that turn. A chat with no running turn is left alone: a turn that starts in the window gets the note
// leading its message instead (assistantRoutingDelivery.js). When the restart does not happen, every chat that was
// told hears so: a running turn is steered, and Main chat's next message carries it otherwise.

import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { PLANNED_RESTART_CANCELLED_NOTE } from "@local/vibe64-core/server/plannedRestartNotice";

const chatKey = chat => `${chat.sessionId}\n${chat.conversationId || ""}`;

/**
 * @param {object} dependencies
 * @param {ReturnType<typeof import("@local/vibe64-core/server/plannedRestart").createPlannedRestart>} dependencies.reader
 * @param {(visit: (chat: PlannedRestartChat) => Promise<void>) => Promise<void>} dependencies.forEachChat visits every
 *   chat of every open session, inside its project
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @typedef {object} PlannedRestartChat
 * @property {string} sessionId
 * @property {string} conversationId "" for Main chat
 * @property {string} sessionName
 * @property {boolean} running whether its turn is running
 * @property {(message: string) => Promise<"delivered" | "uncertain" | "not-sent">} steer the chat's steer
 * @property {(message: string) => Promise<unknown>} tell steers a running turn, or leaves the note for the next one
 */
function createPlannedRestartSteering({ reader, forEachChat, logger }) {
  const log = (level, fields, message) => logOperationalEvent(logger, level, {
    component: "vibe64.planned_restart",
    ...fields,
    event: `vibe64.planned_restart.${fields.event}`
  }, message);

  /** Steers every running turn with the note, and records each chat told. */
  async function steerRunningTurns() {
    let steered = 0;
    await forEachChat(async (chat) => {
      if (!chat.running) return;
      const message = reader.warning();
      if (!message) return;
      const outcome = await chat.steer(message).catch(error => {
        log("warn", { event: "steer_failed", sessionId: chat.sessionId, conversationId: chat.conversationId, error: error?.message },
          "A running turn could not be told about the planned restart.");
        return "not-sent";
      });
      // A steer that may have arrived counts as told: the restart's resume and its cancellation reach it too.
      if (outcome === "not-sent") return;
      steered += 1;
      reader.noteTold({ ...chat, steered: true });
    });
    log("warn", { event: "steered", steered }, "The running AI turns were told about the planned restart.");
    return steered;
  }

  /** Tells every chat that heard about the notice that the restart did not happen. */
  async function tellNotHappened(record) {
    const told = new Set((record?.chats || []).map(chatKey));
    if (!told.size) return 0;
    let reached = 0;
    await forEachChat(async (chat) => {
      if (!told.has(chatKey(chat))) return;
      reached += 1;
      await chat.tell(PLANNED_RESTART_CANCELLED_NOTE).catch(error => log("warn", {
        event: "cancel_note_failed",
        sessionId: chat.sessionId,
        conversationId: chat.conversationId,
        error: error?.message
      }, "A chat could not be told that the planned restart didn't happen."));
    });
    return reached;
  }

  const unsubscribe = reader.onChange((event) => {
    const work = event.type === "started" ? steerRunningTurns()
      : event.type === "ended" ? tellNotHappened(event.record) : null;
    void work?.catch(error => log("warn", { event: "notes_failed", error: error?.message },
      "The AI turns could not be told about the planned restart."));
  });

  return Object.freeze({ steerRunningTurns, tellNotHappened, close: unsubscribe });
}

export { createPlannedRestartSteering };
