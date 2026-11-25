import { assistantGoalIsActive } from "@local/vibe64-runtime/shared/assistantRouting";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { read, activeMessage } from "./assistantRoutingRequests.js";
import {
  INTERRUPTION_CAUSE,
  TURN_RESUME_BACKOFF_MS,
  interruptionLoopError,
  interruptionNotice,
  neverResumedOutcome,
  nextTurnInterruptions,
  resumeNoteForAi,
  resumePolicy,
  turnEnding
} from "./turnInterruptions.js";

/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDelivery} AssistantRoutingDelivery */
/** @typedef {import("./types.js").AssistantRoutingAdmission} AssistantRoutingAdmission */

/**
 * What follows a chat turn that an interruption ended (turnInterruptions.js): what ended it, its red entry in the
 * chat's history, and its resume once in the same conversation, now or after a short wait, or why not. A request an
 * earlier server left before its message reached the AI is sent now under the same loop rule.
 * @param {object} dependencies
 * @param {AssistantRoutingState} dependencies.routingState
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDelivery} dependencies.delivery
 * @param {AssistantRoutingAdmission} dependencies.admission
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>) => Promise<object>}
 *   dependencies.exclusiveAfterWrites The lock for what a turn leaves behind, which waits out a Save or Update.
 * @param {(context: object, state: object, error: any) => Promise<boolean>} dependencies.oweRefusedStep Leaves a
 *   resume another turn came before owed until a turn ends, instead of failed (assistantRoutingOwedSteps.js).
 * @param {import("./types.js").ServerRun} dependencies.serverRun This editor process's run, against which a turn an
 *   earlier run sent is told apart, with how that run ended.
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger Where each interrupted turn's
 *   outcome is recorded.
 */
function createAssistantRoutingInterruptions({
  routingState,
  records,
  delivery,
  admission,
  exclusiveAfterWrites,
  oweRefusedStep,
  serverRun,
  logger
}) {
  /**
   * What ended a turn that did not complete, or null when nothing did (it completed, was cancelled, or ended without
   * an error): the run that sent it ended (a crash, a stop or an update) or, while this run sent it, its engine died,
   * its connection was lost, or the AI service failed.
   * @param {Record<string, any>} state the request
   * @param {Record<string, any>} run the ended agent run
   */
  async function interruptionOf(state, run) {
    if (["completed", "cancelled"].includes(String(run.state || ""))) return null;
    const key = `${activeMessage(state).messageId || state.messageId}:${state.turnId || ""}`;
    const ended = await serverRun.endOf(state.serverRunId || "");
    if (ended) return { key, ...ended };
    const ending = turnEnding(run);
    return ending ? { key, ...ending, at: new Date().toISOString() } : null;
  }

  /** One recovery outcome in the operational log, which production keeps at warn: the next incident is visible. */
  function logOutcome(sessionId, context, interruption, outcome, extra = {}) {
    logOperationalEvent(logger, "warn", {
      component: "vibe64.turn_resume",
      event: `vibe64.turn_resume.${outcome}`,
      sessionId,
      ...(context.routingConversationId ? { conversationId: context.routingConversationId } : {}),
      cause: interruption.cause,
      interruptedAt: interruption.at,
      ...(interruption.crashId ? { crashId: interruption.crashId } : {}),
      ...extra
    }, `An interrupted AI turn: ${outcome.replace(/_/gu, " ")}.`);
  }

  /** Counts a crash's interrupted turn, resumed or not, into its crash record. */
  function countCrashTurn(interruption, resumed) {
    if (interruption.crashId) return serverRun.countCrashTurn(interruption.crashId, resumed);
    return undefined;
  }

  /**
   * Sends the request's prepared resume now, as the person it ran for; a failure leaves it waiting for Continue and
   * says so in red. Another turn that came first leaves it owed, to go ahead once a turn ends.
   */
  async function resumeNow(sessionId, context, state, interruption) {
    state.status = "working";
    delete state.error;
    delete state.resumeAt;
    await records.save(context, state);
    await records.writeNotice(context, state, interruptionNotice(interruption, "resumed"));
    try {
      await delivery.deliver(sessionId, { ...context, vibe64User: state.submittedBy }, state, Boolean(state.followup));
      logOutcome(sessionId, context, interruption, "resumed");
      await countCrashTurn(interruption, true);
    } catch (error) {
      if (await oweRefusedStep(context, state, error)) {
        // Not resumed yet: it goes ahead once the turn that came first ends.
        logOutcome(sessionId, context, interruption, "resume_owed", { code: error.code });
        await countCrashTurn(interruption, false);
        return;
      }
      state.status = "waiting";
      state.delivery = state.attemptedMessageId ? "uncertain" : state.followup ? "pending" : "failed";
      state.error = error.message;
      await records.save(context, state);
      await records.writeNotice(context, state, interruptionNotice(interruption, "failed", { error: error.message }));
      logOutcome(sessionId, context, interruption, "resume_failed", { code: error.code, error: error.message });
      await countCrashTurn(interruption, false);
    }
  }

  /**
   * The loop rule, then the resume: what the interruption decides for a request whose resume is prepared. The
   * loop stops it with Continue offered, in red; otherwise it is resumed now or, after a lost connection or an
   * overloaded AI service, after the backoff.
   * @returns {Promise<void>}
   */
  async function decideResume(sessionId, context, state, interruption, routingOptions) {
    const policy = resumePolicy(interruption.cause);
    const decision = nextTurnInterruptions(state.interruptions, interruption, Date.now());
    if (decision.repeated) return;
    state.interruptions = decision.history;
    if (!decision.resume) {
      state.status = "waiting";
      state.error = interruptionLoopError(interruption.cause);
      await records.save(context, state);
      await records.writeNotice(context, state, interruptionNotice(interruption, "loop"));
      logOutcome(sessionId, context, interruption, "stopped_by_loop_rule");
      await countCrashTurn(interruption, false);
      return;
    }
    if (policy === "later") {
      state.status = "waiting";
      state.resumeAt = new Date(Date.now() + TURN_RESUME_BACKOFF_MS).toISOString();
      state.error = "Vibe64 resumes this turn shortly. Choose Continue to resume it now, or Cancel to leave it.";
      await records.save(context, state);
      await records.writeNotice(context, state, interruptionNotice(interruption, "resuming", { resumeAt: state.resumeAt }));
      logOutcome(sessionId, context, interruption, "resume_scheduled", { resumeAt: state.resumeAt });
      scheduleResume(sessionId, state, routingOptions);
      return;
    }
    await resumeNow(sessionId, context, state, interruption);
  }

  /**
   * An ended turn the person did not complete: the chat's history gets the red entry, and the request continues in
   * the same conversation with Vibe64's note leading its follow-up (decideResume). A turn the person stopped, or one
   * an account problem or the AI's own error ended, is not resumed: its entry says why. A Main chat goal's turn is the
   * goal's own recovery's; this leaves it.
   * @returns {Promise<boolean>} whether the request was settled here
   */
  async function afterInterruption(sessionId, context, state, interruption, routingOptions) {
    if (context.routingConversationTask) return false;
    if (!context.routingConversationId) {
      const { goal } = await records.currentGoal(sessionId, context);
      if (assistantGoalIsActive(goal)) return false;
    }
    if (state.stopped) {
      // A Stop the person made, which the server's end overtook, is still theirs; their Stop alone needs no entry.
      if ([INTERRUPTION_CAUSE.CRASH, INTERRUPTION_CAUSE.RESTART, INTERRUPTION_CAUSE.UPDATE].includes(interruption.cause)) {
        await records.writeNotice(context, state, interruptionNotice(interruption, "stopped"));
        logOutcome(sessionId, context, interruption, "skipped", { reason: "stopped-by-person" });
        await countCrashTurn(interruption, false);
      }
      return false;
    }
    if (resumePolicy(interruption.cause) === "never") {
      await records.writeNotice(context, state, interruptionNotice(interruption, neverResumedOutcome(interruption.cause)));
      logOutcome(sessionId, context, interruption, "skipped", { reason: interruption.cause });
      return false;
    }
    if (nextTurnInterruptions(state.interruptions, interruption, Date.now()).repeated) return true;
    await records.prepareFollowup(context, state, state.stage ?? null, { resumeNote: resumeNoteForAi(interruption) });
    await decideResume(sessionId, context, state, interruption, routingOptions);
    return true;
  }

  /**
   * Resumes a request waiting out its backoff once its time comes, in this process: under the session's lock, and
   * only while it still waits with the same prepared resume, so a Continue, a new message or another process that
   * resumed it first leaves nothing to do.
   */
  function scheduleResume(sessionId, state, routingOptions) {
    const messageId = state.followup?.messageId;
    const resumeAt = state.resumeAt;
    const key = `${sessionId}:${routingOptions?.conversationId || ""}`;
    if (!messageId || !resumeAt || admission.isClosing()) return;
    clearTimeout(routingState.resumeTimers.get(key));
    const timer = setTimeout(() => {
      routingState.resumeTimers.delete(key);
      if (admission.isClosing()) return;
      void exclusiveAfterWrites(sessionId, routingOptions, async context => {
        const latest = await read(context.runtime.store, sessionId);
        if (!latest || latest.status !== "waiting" || latest.stopped || latest.resumeAt !== resumeAt ||
            latest.followup?.messageId !== messageId) return;
        const entry = latest.interruptions?.at(-1);
        const interruption = {
          key: entry?.key || messageId,
          cause: entry?.cause || INTERRUPTION_CAUSE.CONNECTION,
          at: entry?.at || resumeAt
        };
        await resumeNow(sessionId, context, latest, interruption);
      }).catch(error => logOperationalEvent(logger, "warn", {
        component: "vibe64.turn_resume",
        event: "vibe64.turn_resume.resume_failed",
        sessionId,
        code: error?.code,
        error: error?.message
      }, "A turn waiting to be resumed could not be resumed; Continue resumes it."));
    }, Math.max(0, Date.parse(resumeAt) - Date.now()));
    timer.unref();
    routingState.resumeTimers.set(key, timer);
  }

  /**
   * A request an earlier run left before its message reached the AI (preparing, sending, or a resume saved to send):
   * nothing duplicates it, so it is sent now under the loop rule, with its red entry. One whose send may have arrived
   * is checked first: an accepted one is adopted (its turn's end is then read like any other), and one the AI cannot
   * confirm either way waits for the person's Retry, which checks again.
   * @returns {Promise<boolean>} whether the request was settled here
   */
  async function resumeUnsent(sessionId, context, state) {
    const userContext = { ...context, vibe64User: state.submittedBy };
    if (state.attemptedMessageId) {
      const seen = await delivery.deliver(sessionId, userContext, state, Boolean(state.followup), true).catch(() => null);
      if (seen?.delivered) return false;
      if (seen?.status !== "not-sent") {
        const ended = await serverRun.endOf(state.serverRunId || "");
        const interruption = {
          key: `${state.attemptedMessageId}:send`,
          ...(ended || { cause: INTERRUPTION_CAUSE.RESTART, at: new Date().toISOString() })
        };
        await records.writeNotice(context, state, interruptionNotice(interruption, "uncertain"));
        logOutcome(sessionId, context, interruption, "skipped", { reason: "delivery-uncertain" });
        return true;
      }
    }
    const ended = await serverRun.endOf(state.serverRunId || "");
    const interruption = {
      key: `${activeMessage(state).messageId || state.messageId}:unsent`,
      ...(ended || { cause: INTERRUPTION_CAUSE.RESTART, at: new Date().toISOString() })
    };
    await decideResume(sessionId, context, state, interruption, { conversationId: context.routingConversationId });
    return true;
  }

  return Object.freeze({
    interruptionOf,
    afterInterruption,
    resumeUnsent,
    scheduleResume
  });
}

export {
  createAssistantRoutingInterruptions
};
