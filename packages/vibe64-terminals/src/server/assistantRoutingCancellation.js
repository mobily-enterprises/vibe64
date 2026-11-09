import { vibe64AgentRunStateIsActive } from "@local/vibe64-runtime/server/sessionStore";
import { sameVibe64AssistantSelection, vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";
import { assistantGoalIsActive, assistantWorkflowMessageIds } from "@local/vibe64-runtime/shared/assistantRouting";
import {
  read,
  activeMessage,
  failure,
  readCancelled,
  CANCELLED_KEY,
  MAX_CANCELLED_MESSAGES,
  STATE_KEY
} from "./assistantRoutingRequests.js";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { doNothing } from "@local/vibe64-core/shared/doNothing";

/** @typedef {import("./types.js").SessionAgentManager} SessionAgentManager */
/** @typedef {import("./types.js").AssistantRoutingState} AssistantRoutingState */
/** @typedef {import("./types.js").AssistantRoutingRecords} AssistantRoutingRecords */
/** @typedef {import("./types.js").AssistantRoutingDecisions} AssistantRoutingDecisions */
/** @typedef {import("./types.js").AssistantRoutingDelivery} AssistantRoutingDelivery */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * Stop and Cancel: the inspection of an uncertain delivery, stopping a request's routing, cancelling
 * one message without the agent-write lock, and the cleanup that settles afterwards.
 * @param {object} dependencies
 * @param {RuntimeLogger} dependencies.logger
 * @param {AssistantRoutingState} dependencies.routingState
 * @param {AssistantRoutingRecords} dependencies.records
 * @param {AssistantRoutingDecisions} dependencies.decisions
 * @param {AssistantRoutingDelivery} dependencies.delivery
 * @param {SessionAgentManager} dependencies.agent
 * @param {(sessionId: string, options: object, operation: (context: object) => Promise<unknown>) => Promise<object>} dependencies.exclusive
 * @param {(sessionId: string, options: object) => Promise<object>} dependencies.open
 * @param {(sessionId: string, context: object) => Promise<object>} dependencies.interrupt
 * @param {typeof import("./assistantChangeover.js").discardAssistantChangeoverMessage} dependencies.discardPending
 * @param {import("./types.js").WritesWhileAssistantWorks} dependencies.writesWhileAssistantWorks
 */
function createAssistantRoutingCancellation({
  routingState,
  records,
  decisions,
  delivery,
  agent,
  exclusive,
  open,
  interrupt,
  discardPending,
  writesWhileAssistantWorks,
  logger
}) {
  function inspectDelivery(sessionId, { messageId }, options) {
    return exclusive(sessionId, options, async context => {
      const state = await read(context.runtime.store, sessionId);
      if (state?.messageId === messageId && (activeMessage(state).messageId || state.messageId) === messageId &&
          state.delivery === "failed" && !state.followup && !state.stopped && !state.attemptedMessageId && !state.helper &&
          !routingState.running.has(records.keyFor(sessionId, context))) {
        // Failed is the original coordinator's persisted pre-dispatch or
        // definite-rejection conclusion. Missing request metadata is not proof.
        if (await context.runtime.store.conversationMessageIdExists(sessionId, messageId)) return null;
        const actor = state.submittedBy;
        if (actor ? (actor.id !== undefined ? actor.id !== context.vibe64User?.id
          : !actor.username || actor.username !== context.vibe64User?.username) : context.vibe64User) return null;
        // A message sent without a signed-in actor has none to compare. The original decision
        // still rechecks access below; the configured actor resolver must reject an unavailable actor.
        const selection = vibe64AssistantSelectionFromMetadata(context.session.metadata);
        const { goal, pinned } = await records.currentGoal(sessionId, context);
        const workflow = assistantGoalIsActive(goal) && pinned?.workflowEngineId;
        if (workflow && workflow !== state.workflowEngineId ||
            !sameVibe64AssistantSelection(selection, state.observedSelection) &&
              !sameVibe64AssistantSelection(selection, state.deliverySelection)) return null;
        await decisions.validateDecision(context, state);
        const native = await agent.sessionState(sessionId, context);
        if (!native || native.ok === false || native.status === "working" || native.turn?.active || native.turn?.waitingForInput ||
            native.pendingRequests?.length || native.terminal?.status === "running" ||
            context.session.agentRuns?.some(run => run.active || vibe64AgentRunStateIsActive(run.state) ||
              run.providerGoalStatus === "active" &&
                run.providerGoalThreadId &&
                run.providerGoalThreadId === run.providerThreadId)) return null;
        return { status: "not-sent", messageId, error: state.error || "This request was not sent." };
      }
      if (!state || activeMessage(state).messageId !== messageId && state.messageId !== messageId ||
          !["sending", "uncertain"].includes(state.delivery)) return null;
      return delivery.deliver(sessionId, context, state, Boolean(state.followup), true);
    });
  }

  async function cancel(sessionId, routingOptions, options = {}) {
    const { waitForCleanup = false, expectedMessageId, cleanupTimeoutMs = 30_000, superseded = () => false } = options;
    async function cancelRouting() {
      let stop;
      let finished;
      const result = await exclusive(sessionId, routingOptions, async context => {
        if (superseded()) return false;
        const state = await read(context.runtime.store, sessionId);
        if (expectedMessageId !== undefined && state?.messageId !== expectedMessageId) {
          throw failure("The routing request changed. Retry the assistant selection.", "vibe64_assistant_routing_request_changed");
        }
        const task = routingState.running.get(records.keyFor(sessionId, context));
        routingState.liveFollowupRequests.delete(records.keyFor(sessionId, context));
        if (task) {
          task.cancelled = true;
          stop = task.stop;
          finished = task.finished.promise;
        }
        if (!state) return false;
        const pending = ["routing", "pending", "failed"].includes(state.delivery) && !state.attemptedMessageId;
        state.stopped = true;
        state.status = "waiting";
        delete state.outcome;
        if (pending) delete state.error;
        await records.save(context, state);
        if (!task && state.helper) {
          await records.releaseHelper(context, state);
        }
        return pending;
      });
      await stop?.();
      if (waitForCleanup) await finished;
      if (waitForCleanup) {
        await exclusive(sessionId, routingOptions, async context => {
          if ((await read(context.runtime.store, sessionId))?.helper) {
            throw failure("The routing helper could not be closed. Retry after reconnecting the assistant.", "vibe64_assistant_routing_helper_close_failed");
          }
        });
      }
      return result;
    }
    if (!waitForCleanup) return cancelRouting();
    let timer;
    try {
      return await Promise.race([
        cancelRouting(),
        new Promise((resolve, reject) => {
          timer = setTimeout(() => reject(Object.assign(failure(
            "Chat routing cleanup is still pending. Retry Close or Stop to finish cleanup before continuing.",
            "vibe64_assistant_routing_cleanup_pending"
          ), { retryable: true })), cleanupTimeoutMs);
        })
      ]);
    } finally {
      clearTimeout(timer);
    }
  }

  function logHelperStopFailure(sessionId, error) {
    logOperationalEvent(logger, "warn", {
      component: "vibe64.assistant_routing",
      event: "vibe64.assistant_routing.helper_stop_failed",
      sessionId: sessionId,
      code: error?.code,
      error: error?.message
    }, "A stopped or cancelled request's routing helper could not be stopped.");
  }

  /**
   * Stop's routing half, true when it stopped a request not yet sent, which leaves no turn to interrupt. Stop
   * queues for the agent-write lock as `cancel` does, except while a Save or Update holds it, now or once it takes
   * it while Stop waits: Stop never waits for that write, and stops the request without the lock.
   */
  async function stop(sessionId, routingOptions) {
    // How this Stop is applied, once: under the lock by its queued cancel, or without it.
    let applied = "";
    const withoutLock = () => applied ? null : writesWhileAssistantWorks.withoutLock(sessionId, () => {
      applied = "without the lock";
      return stopWithoutLock(sessionId, routingOptions);
    });
    const now = withoutLock();
    if (now) return now;
    const giveUp = new AbortController();
    const queued = cancel(sessionId, routingOptions, {
      superseded: () => {
        applied ||= "under the lock";
        return applied !== "under the lock";
      }
    });
    try {
      return await Promise.race([
        queued,
        writesWhileAssistantWorks.nextHold(sessionId, giveUp.signal).then(() => withoutLock() || queued)
      ]);
    } finally {
      giveUp.abort();
      // A Stop that went ahead without the lock leaves its queued cancel nothing to do once the lock frees.
      queued.catch(doNothing);
    }
  }

  /**
   * Like Cancel, it stops the request's routing task and records the request as stopped at once. The Save or Update
   * holding the lock lets it go only once this has finished, and until the next locked admission or settle any save of
   * the request keeps it stopped, so nothing continues it once the lock frees. Only releasing a routing helper no task
   * is closing waits for the lock.
   */
  async function stopWithoutLock(sessionId, routingOptions) {
    const context = await open(sessionId, routingOptions);
    const store = context.runtime.store;
    const key = records.keyFor(sessionId, context);
    const task = routingState.running.get(key);
    routingState.liveFollowupRequests.delete(key);
    if (task) {
      task.cancelled = true;
      // readable-check: allow optional-call - optional operation: a routing task has a stop once its helper has started
      void Promise.resolve(task.stop?.()).catch(error => logHelperStopFailure(sessionId, error));
    }
    let state = null;
    let pending = false;
    await store.mutateSession(sessionId, async () => {
      state = await read(store, sessionId);
      if (!state) return;
      pending = ["routing", "pending", "failed"].includes(state.delivery) && !state.attemptedMessageId;
      state.stopped = true;
      state.status = "waiting";
      delete state.outcome;
      if (pending) delete state.error;
      for (const messageId of assistantWorkflowMessageIds(state)) {
        routingState.stopping.add(records.cancelKey(sessionId, context, messageId));
      }
      await store.writeMetadataValue(sessionId, STATE_KEY, JSON.stringify(state));
    });
    if (!state) return false;
    await records.announce(context, state);
    if (!task && state.helper) {
      const releasing = exclusive(sessionId, routingOptions, async current => {
        const latest = await read(current.runtime.store, sessionId);
        if (latest?.messageId === state.messageId && latest.stopped && latest.helper &&
            !routingState.running.has(records.keyFor(sessionId, current))) await records.releaseHelper(current, latest);
      }).catch(error => logHelperStopFailure(sessionId, error));
      routingState.settling.add(releasing);
      void releasing.then(() => routingState.settling.delete(releasing));
    }
    return pending;
  }

  /**
   * Cancel means cancel, and it never waits for the agent-write lock. It records
   * the message as cancelled, stops its routing and classifier, interrupts a
   * turn the message may own through Stop's interrupt, and answers. The cleanup
   * that needs the lock (the routing helper and the native attempt) settles
   * afterwards, or at the next admission.
   */
  async function cancelMessage(sessionId, { messageId }, options) {
    const context = await open(sessionId, options);
    const store = context.runtime.store;
    const key = records.keyFor(sessionId, context);
    routingState.cancelling.add(records.cancelKey(sessionId, context, messageId));
    let route = null;
    await store.mutateSession(sessionId, async () => {
      const saved = (await readCancelled(store, sessionId)).filter(entry => entry.messageId !== messageId);
      await store.writeMetadataValue(sessionId, CANCELLED_KEY, JSON.stringify([...saved,
        { messageId, cancelledAt: new Date().toISOString(), settled: false }].slice(-MAX_CANCELLED_MESSAGES)));
      const state = await read(store, sessionId).catch(() => null);
      if (!assistantWorkflowMessageIds(state).includes(messageId)) return;
      route = state;
      const unsent = ["routing", "pending", "failed"].includes(route.delivery) && !route.attemptedMessageId;
      // Cancelled, unlike Stop, never returns the message to the draft.
      route.stopped = true;
      route.cancelled = true;
      route.status = "waiting";
      delete route.outcome;
      if (unsent) delete route.error;
      await store.writeMetadataValue(sessionId, STATE_KEY, JSON.stringify(route));
    });
    if (route) {
      routingState.liveFollowupRequests.delete(key);
      await records.announce(context, route);
    }
    const task = routingState.running.get(key);
    if (task?.messageId === messageId) {
      task.cancelled = true;
      // readable-check: allow optional-call - optional operation: a routing task has a stop once its helper has started
      void Promise.resolve(task.stop?.()).catch(error => logHelperStopFailure(sessionId, error));
    }
    // The running turn may be this message's when its routed delivery was
    // attempted or accepted, or when it is the chat's newest message.
    const owned = route ? Boolean(route.attemptedMessageId || route.delivery === "accepted")
      : (await store.readConversationTail(sessionId, { userLimit: 1 })).findLast(turn => turn.user)?.user?.messageId === messageId;
    let interrupted = false;
    if (owned) interrupted = await interrupt(sessionId, context).then(result => result?.ok !== false, () => false);
    const settling = exclusive(sessionId, options, current => settle(sessionId, current)).catch((error) => logOperationalEvent(logger, "warn", {
      component: "vibe64.assistant_routing",
      event: "vibe64.assistant_routing.settle_failed",
      sessionId: sessionId,
      code: error?.code,
      error: error?.message
    }, "Settling a cancelled message failed; the next send settles it."));
    routingState.settling.add(settling);
    void settling.then(() => routingState.settling.delete(settling));
    return { ok: true, cancelled: true, messageId, interrupted };
  }

  /**
   * Cancel's lock-held cleanup: the native attempt, and the routing helper
   * unless the message's own routing task is still closing it. Holding the lock,
   * it also lets go of the marks of requests Stop recorded without it.
   */
  async function settle(sessionId, context) {
    const store = context.runtime.store;
    const key = records.keyFor(sessionId, context);
    for (const entry of routingState.stopping) {
      if (entry.startsWith(`${key}\0`)) routingState.stopping.delete(entry);
    }
    const unsettled = (await readCancelled(store, sessionId)).filter(entry => !entry.settled);
    if (!unsettled.length) return;
    const state = await read(store, sessionId).catch(() => null);
    for (const { messageId } of unsettled) {
      if (state?.helper &&
          assistantWorkflowMessageIds(state).includes(messageId) &&
          routingState.running.get(key)?.messageId !== messageId) {
        await records.releaseHelper(context, state);
      }
      await discardPending(sessionId, messageId, context);
      routingState.cancelling.delete(records.cancelKey(sessionId, context, messageId));
    }
    const settled = new Set(unsettled.map(entry => entry.messageId));
    await store.mutateSession(sessionId, async () => {
      const current = await readCancelled(store, sessionId);
      await store.writeMetadataValue(
        sessionId,
        CANCELLED_KEY,
        JSON.stringify(current.map(entry => settled.has(entry.messageId) ? { ...entry, settled: true } : entry))
      );
    });
  }

  async function isCancelled(sessionId, messageId, options) {
    const context = await open(sessionId, options);
    return (await readCancelled(context.runtime.store, sessionId)).some(entry => entry.messageId === messageId);
  }

  return Object.freeze({
    inspectDelivery,
    cancel,
    stop,
    cancelMessage,
    settle,
    isCancelled
  });
}

export {
  createAssistantRoutingCancellation
};
