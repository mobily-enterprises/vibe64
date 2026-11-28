import { randomUUID } from "node:crypto";
import { NO_SERVER_RUN, interruptionNotice, nextTurnInterruptions } from "./turnInterruptions.js";

/** @typedef {import("./types.js").PublishAgentSessionChanged} PublishAgentSessionChanged */

/**
 * What a restart does with a goal an earlier server ran (turnInterruptions.js): it waits while that server still runs
 * it, then writes the goal's entry in the Main chat's history and continues it once in the same conversation, or
 * pauses it when the loop rule stops it; a goal no attempt could continue stops with its reason.
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

  /** What ended the server that ran the goal's intent. */
  async function interruptionOf(intent) {
    const ended = await serverRun.endOf(intent.daemonId || "");
    return { key: `goal:${intent.id}`, cause: "restart", at: serverRun.startedAt || new Date().toISOString(), ...ended };
  }

  /**
   * Continues a goal whose server ended while it ran, once per interrupted intent, with its entry first: one
   * informational line for a planned restart, red for an unexpected one.
   * @param {string} sessionId
   * @param {object} context the session's assistant context, authorized for actor
   * @param {{ intent: object, native: object, observed: object, actor: object, newConnection?: boolean }} goal the
   *   goal's saved intent, its native goal and its canonical read, who it continues for, and whether it continues on
   *   an AI account other than the one it ran on
   */
  async function continueInterruptedGoal(sessionId, context, { intent, native, observed, actor, newConnection = false }) {
    const interruption = await interruptionOf(intent);
    const decision = nextTurnInterruptions(intent.interruptions, interruption, Date.now());
    const counted = resumed => interruption.crashId ? serverRun.countCrashTurn(interruption.crashId, resumed) : undefined;
    if (!decision.resume) {
      // A goal the loop rule stops (the third unexpected end in a row, or the planned-stop backstop) is paused, which
      // also ends its intent, so no later server resumes it and Resume goal continues it when the person chooses.
      const paused = await updateAgentGoal(sessionId, {
        vibe64User: actor,
        action: "pause",
        threadId: native.threadId,
        createdAt: native.goal.createdAt,
        objective: native.goal.objective
      });
      if (paused?.ok === false) {
        throw Object.assign(new Error(paused.error || "The goal could not be paused after the loop rule stopped it."), paused);
      }
      await writeGoalInterruptionNotice(sessionId, context, interruptionNotice(interruption, "loop", { goal: true }));
      await counted(false);
      return { sessionId, stoppedLoop: true, cause: interruption.cause };
    }
    const history = decision.history;
    const result = await resumeGoal(sessionId, context, { intent, observed, actor, interruption, history, newConnection });
    if (result?.code === "vibe64_goal_main_ai_changed") return { sessionId, cancelled: true };
    if (result?.ok === false) {
      await counted(false);
      throw Object.assign(new Error(result.error || "Goal continuation failed."), result);
    }
    await counted(true);
    return { sessionId, resumed: true, cause: interruption.cause };
  }

  /**
   * The one continuation of an interrupted goal, a restart's or an account set's (serviceGoalAccountWait.js): its
   * "Resumed" entry, then Resume goal's own resume as the person who set it, on the AI connection connected now, its new
   * intent keeping the interruptions `history` for the loop rule; a resume that could not be sent gets its red line.
   * @param {string} sessionId
   * @param {object} context
   * @param {{ intent: object, observed: object, actor: object, interruption: object, history: object[],
   *   newConnection?: boolean }} goal
   * @returns {Promise<Record<string, any>>} the resume's result
   */
  async function resumeGoal(sessionId, context, { intent, observed, actor, interruption, history, newConnection = false }) {
    await writeGoalInterruptionNotice(sessionId, context, interruptionNotice(interruption, "resumed", { goal: true, newConnection }));
    const result = await writeAgentGoal(sessionId, {
      action: "resume",
      vibe64User: actor,
      expectedSegmentId: observed.target.segmentId,
      expectedGoalId: observed.goal.id,
      messageId: `goal-restart-${randomUUID()}`
    }, { canonical: true, restartIntentId: intent.id, interruption: history, followConnection: true });
    if (result?.ok === false && result.code !== "vibe64_goal_main_ai_changed") {
      const error = result.error || "the goal could not continue";
      await writeGoalInterruptionNotice(sessionId, context, interruptionNotice(interruption, "failed", { goal: true, error }));
    }
    return result;
  }

  /**
   * A goal no attempt after this restart could continue (goal recovery's last pass failed), whose intent recovery has
   * just ended: Main chat's history says why in red, once, and what to do.
   * @param {string} sessionId
   * @param {object} context
   * @param {object} intent the goal's intent as it ran
   * @param {string} error why it could not continue
   */
  async function stopUnrecoverableGoal(sessionId, context, intent, error) {
    const interruption = await interruptionOf(intent);
    await writeGoalInterruptionNotice(sessionId, context, interruptionNotice(interruption, "not-resumed", { goal: true, error }));
    if (interruption.crashId) await serverRun.countCrashTurn(interruption.crashId, false);
  }

  /** Counts a crash's goal that was not resumed (one now waiting for an account) into its crash record. */
  function countUnresumed(interruption) {
    return interruption.crashId ? serverRun.countCrashTurn(interruption.crashId, false) : undefined;
  }

  return Object.freeze({
    requirePreviousServerStopped,
    continueInterruptedGoal,
    countUnresumed,
    interruptionOf,
    resumeGoal,
    stopUnrecoverableGoal,
    writeGoalInterruptionNotice
  });
}

export {
  createServiceGoalInterruptions
};
