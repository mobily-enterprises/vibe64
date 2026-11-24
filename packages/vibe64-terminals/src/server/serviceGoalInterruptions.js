import { randomUUID } from "node:crypto";
import { NO_SERVER_RUN, interruptionNotice, nextTurnInterruptions } from "./turnInterruptions.js";

/** @typedef {import("./types.js").PublishAgentSessionChanged} PublishAgentSessionChanged */

/**
 * What a restart does with a goal an earlier server ran (turnInterruptions.js): it waits while that server still runs
 * it, then writes the goal's red entry in the Main chat's history and continues it once in the same conversation, or
 * pauses it when the crash-loop rule stops it.
 * @param {object} dependencies
 * @param {import("./types.js").ServerRun} [dependencies.serverRun] This process's run, which tells how the goal's
 *   server ended.
 * @param {PublishAgentSessionChanged} dependencies.publishAgentSessionChanged
 * @param {(sessionId: string, input: object) => Promise<object>} dependencies.updateAgentGoal Pauses the goal.
 * @param {(sessionId: string, input: object, options: object) => Promise<object>} dependencies.writeAgentGoal
 *   Continues it as Resume goal does.
 */
function createServiceGoalInterruptions({
  serverRun = NO_SERVER_RUN,
  publishAgentSessionChanged,
  updateAgentGoal,
  writeAgentGoal
}) {
  /** An earlier server still running (a brief overlap at restart) still runs this goal: recovery tries again later. */
  async function requirePreviousServerStopped(intent) {
    if (await serverRun.isRunning(intent.daemonId || "")) {
      throw Object.assign(
        new Error("The server that ran this goal is still stopping; Vibe64 tries again shortly."),
        { code: "vibe64_goal_previous_server_running" }
      );
    }
  }

  /** A goal's interruption entry in the Main chat's history, published to its open chats. */
  async function writeGoalInterruptionNotice(sessionId, context, notice) {
    const turn = await context.runtime.store.writeConversationSystemMessage(sessionId, notice);
    if (turn) {
      await publishAgentSessionChanged(sessionId, {
        reason: "assistant-routing-changed",
        payload: { conversationLogPatch: { type: "upsert-turn", turn } }
      });
    }
  }

  /**
   * Continues a goal whose server ended while it ran, once per interrupted intent, with its red entry first.
   * @param {string} sessionId
   * @param {object} context the session's assistant context, authorized for actor
   * @param {{ intent: object, native: object, observed: object, actor: object }} goal the goal's saved intent, its
   *   native goal and its canonical read, and who it continues for
   */
  async function continueInterruptedGoal(sessionId, context, { intent, native, observed, actor }) {
    const ended = await serverRun.endOf(intent.daemonId || "");
    const interruption = {
      key: `goal:${intent.id}`,
      cause: "restart",
      at: serverRun.startedAt || new Date().toISOString(),
      ...ended
    };
    const decision = nextTurnInterruptions(intent.interruptions, interruption, Date.now());
    const counted = resumed => interruption.crashId ? serverRun.countCrashTurn(interruption.crashId, resumed) : undefined;
    if (!decision.resume) {
      // A goal Vibe64 continued after an interruption that was interrupted again within the loop window stops here:
      // it is paused, which also ends its intent, so no later server resumes it and Resume goal continues it when the
      // person chooses.
      const paused = await updateAgentGoal(sessionId, {
        vibe64User: actor,
        action: "pause",
        threadId: native.threadId,
        createdAt: native.goal.createdAt,
        objective: native.goal.objective
      });
      if (paused?.ok === false) {
        throw Object.assign(new Error(paused.error || "The goal could not be paused after a crash loop."), paused);
      }
      await writeGoalInterruptionNotice(sessionId, context, interruptionNotice(interruption, "loop", { goal: true }));
      await counted(false);
      return { sessionId, stoppedLoop: true, cause: interruption.cause };
    }
    await writeGoalInterruptionNotice(sessionId, context, interruptionNotice(interruption, "resumed", { goal: true }));
    const result = await writeAgentGoal(sessionId, {
      action: "resume",
      vibe64User: actor,
      expectedSegmentId: observed.target.segmentId,
      expectedGoalId: observed.goal.id,
      messageId: `goal-restart-${randomUUID()}`
    }, { canonical: true, restartIntentId: intent.id, interruption: decision.history });
    if (result?.code === "vibe64_goal_main_ai_changed") return { sessionId, cancelled: true };
    if (result?.ok === false) {
      const error = result.error || "the goal could not continue";
      await writeGoalInterruptionNotice(sessionId, context, interruptionNotice(interruption, "failed", { goal: true, error }));
      await counted(false);
      throw Object.assign(new Error(result.error || "Goal continuation failed."), result);
    }
    await counted(true);
    return { sessionId, resumed: true, cause: interruption.cause };
  }

  return Object.freeze({
    requirePreviousServerStopped,
    continueInterruptedGoal
  });
}

export {
  createServiceGoalInterruptions
};
