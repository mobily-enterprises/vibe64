import { isDeepStrictEqual } from "node:util";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";
import { readLearningModeFor } from "@local/vibe64-core/server/learningMode";
import { stateWatchInput } from "./watchSources.js";
import { suspendAssignment } from "./assignments.js";
import { failure } from "./colleagueFailure.js";
import { publicWatch } from "./colleaguePresentation.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */
/** @typedef {import("./types.js").WatchSources} WatchSources */
/** @typedef {import("./types.js").ColleagueServiceState} ColleagueServiceState */
/** @typedef {import("./types.js").ColleagueRecords} ColleagueRecords */
/** @typedef {import("./types.js").ColleagueThreads} ColleagueThreads */
/** @typedef {import("./types.js").ColleagueWorker} ColleagueWorker */

const LEARN_WATCH_REFUSAL = "In Learn mode Colleague watches only this lesson's practice project.";

/**
 * What a person asks Colleague to watch and the assignments it watches:
 * creating, pausing, resuming and cancelling watches one at a time per thread,
 * the sources owners register, and the change events that make a watch look
 * again.
 * @param {object} dependencies
 * @param {RuntimeEvents} dependencies.events
 * @param {WatchSources} dependencies.watchSources
 * @param {number} dependencies.watchDebounceMs
 * @param {ColleagueServiceState} dependencies.serviceState
 * @param {ColleagueRecords} dependencies.records
 * @param {ColleagueThreads} dependencies.threads
 * @param {ColleagueWorker} dependencies.worker
 */
function createColleagueWatches({ events, watchSources, watchDebounceMs, serviceState, records, threads, worker }) {
  function changeWatches(state, operation) {
    const admitted = state.watchAdmission.then(operation);
    state.watchAdmission = admitted.catch(() => {});
    return admitted;
  }

  // A teacher watches only the practice project of its own lesson attempt;
  // the watch ends with the attempt (its thread is released).
  async function assertLearnWatchTarget(state, context, projectSlug) {
    const mode = await readLearningModeFor(authenticatedVibe64User(context), { thread: "learn" });
    if (!state.thread.attemptId || mode?.currentAttemptId !== state.thread.attemptId || !mode.practiceSlug ||
        projectSlug !== mode.practiceSlug) throw failure(LEARN_WATCH_REFUSAL, "vibe64_colleague_learn_watch", 403);
  }

  async function suppressWatchObservation(state, watchId) {
    state.record.observations = state.record.observations.filter(item => item.watchId !== watchId);
    await records.persist(state);
    if (!state.observationIds.length || state.record.observations.some(item => state.observationIds.includes(item.id))) return;
    // Only the notification belongs to this watch. The watched coding
    // conversation keeps running, and the accepted wake remains in history.
    state.generation += 1;
    state.workerAbort?.abort();
    await state.conversation?.cancel();
    await state.running;
    state.streamingReply = null;
    state.interimReply = null;
    state.record.status = "ready";
    state.record.error = "";
    await records.persist(state);
    records.publishReply(state);
    if (state.pendingMessages.length) void worker.startWorker(state, state.nextConnection, null, true).catch(() => {});
    else worker.wakeForObservations(state);
  }

  events?.register({
    id: "vibe64.colleague.attention",
    matches: (event) => !serviceState.lifecycle.closed && event.type === "entity.changed" &&
      (event.source === "vibe64" && event.entity === "session" || watchSources.readsEntity(event.entity)),
    handle(event) {
      // Publishers may still hold a session write lock. Never await a read here.
      // A thread that fails to load reports to its own request, not here.
      const session = event.source === "vibe64" && event.entity === "session";
      for (const pending of serviceState.users.values()) void pending.then((state) => {
        const payload = event.realtime?.payload || {};
        const relevant = watch => watch.status === "active" && (session
          ? !watch.input && watch.sessionId === event.entityId && (!payload.projectSlug || watch.projectSlug === payload.projectSlug)
          : watchSources.get(watch.source)?.entity === event.entity && watch.projectSlug === event.entityId);
        if (state.record.watches.some(relevant)) worker.scheduleWatches(state, watchDebounceMs);
      }, () => {});
    }
  });

  const watches = Object.freeze({
    changeWatches,
    // Owners extend what Colleague can watch (watchSources.js).
    registerConversationSource(name, read) { watchSources.registerConversation(name, read); },
    registerWatchSource(source) { watchSources.register(source); },
    listWatchSources() { return { ok: true, sources: watchSources.list() }; },
    // The assistant's watch.source.create: registered state sources only.
    async watchState(input, context) {
      if (watchSources.get(input.source)?.kind !== "state") {
        throw failure("Colleague cannot watch that. watch.sources.read lists what it can watch here.", "vibe64_colleague_failed", 422);
      }
      return watches.watch(input, context);
    },
    async listWatches(_input, context) { return { ok: true, watches: (await records.snapshot(await threads.stateFor(context))).watches }; },
    async assignment(operation, input, context) {
      const state = await threads.stateFor(context);
      if (operation === "read") return records.assignments.read(state, input, context);
      return changeWatches(state, async () => {
        if (serviceState.lifecycle.closed || state.stopping) throw failure("Colleague is stopping.");
        const result = await records.assignments[operation](state, input, context);
        worker.scheduleWatches(state, watchDebounceMs);
        return result;
      });
    },
    // A conversation watch names its project, session and conversation (and
    // an owner's conversation source); a state watch names its registered
    // source and that source's input.
    async watch(input, context) {
      const state = await threads.stateFor(context);
      return changeWatches(state, async () => {
        if (serviceState.lifecycle.closed) throw failure("Colleague is shutting down.");
        const source = input.source ? watchSources.get(input.source) : null;
        const watchedInput = source?.kind === "state" ? stateWatchInput(source, input.input) : null;
        if (watchedInput && !Object.hasOwn(source.conditions, input.condition)) {
          throw failure(`A ${source.label} watch reports ${Object.keys(source.conditions).join(", ")}.`, "vibe64_colleague_failed", 422);
        }
        const target = watchedInput ? { source: input.source, input: watchedInput, projectSlug: watchedInput.projectSlug || "" }
          : { ...(input.source ? { source: input.source } : {}), projectSlug: input.projectSlug, sessionId: input.sessionId,
            conversationId: input.conversationId || "" };
        const existing = state.record.watches.find((watch) => watch.watchId === input.watchId);
        if (existing) {
          if (["source", "projectSlug", "sessionId", "conversationId"].some(key => (existing[key] || "") !== (target[key] || "")) ||
              !isDeepStrictEqual(existing.input || null, target.input || null) ||
              ["condition", "question"].some(key => (existing[key] || "") !== (input[key] || "")) ||
              (existing.once !== false) !== (input.once !== false)) throw failure("This watch ID belongs to a different request. Use a new watch ID.");
          return { ok: true, watch: publicWatch(existing) };
        }
        if (input.source && !source) throw failure("Colleague cannot watch that here.", "vibe64_colleague_failed", 422);
        if (state.thread.kind === "learn") await assertLearnWatchTarget(state, context, target.projectSlug);
        if (state.record.watches.filter((watch) => ["active", "pending", "paused"].includes(watch.status)).length >= 16) throw failure("Cancel an existing watch before adding another; up to 16 can be retained.");
        state.requestContext = context;
        const watch = { watchId: input.watchId, ...target, condition: input.condition, question: input.question,
          once: input.once !== false, status: "active", error: "" };
        // Verify access before retaining the target or admitting a notification.
        await worker.observeWatch(state, watch);
        state.record.watches = state.record.watches.filter((item) => !["delivered", "cancelled"].includes(item.status)).concat(watch);
        await records.persist(state);
        worker.scheduleWatches(state);
        worker.wakeForObservations(state);
        return { ok: true, watch: publicWatch(watch) };
      });
    },
    async cancelWatch(input, context) {
      const state = await threads.stateFor(context);
      return changeWatches(state, async () => {
        const watch = state.record.watches.find((item) => item.watchId === input.watchId);
        if (watch) {
          watch.status = "cancelled";
          suspendAssignment(state.record, watch.assignmentId, "Assignment watching was cancelled. Ask Colleague to resume or cancel the assignment.");
        }
        await suppressWatchObservation(state, input.watchId);
        return { ok: true };
      });
    },
    async pauseWatch(input, context) {
      const state = await threads.stateFor(context);
      return changeWatches(state, async () => {
        const watch = state.record.watches.find(item => item.watchId === input.watchId);
        if (!watch || !["active", "pending"].includes(watch.status)) throw failure("Only an active watch can be paused.");
        if (watch.assignmentId) throw failure("Pause the assignment through its retained assignment controls.");
        watch.status = "paused";
        watch.error = "Watching paused.";
        await suppressWatchObservation(state, input.watchId);
        return { ok: true, watch: publicWatch(watch) };
      });
    },
    async resumeWatch(input, context) {
      const state = await threads.stateFor(context);
      return changeWatches(state, async () => {
        const watch = state.record.watches.find((item) => item.watchId === input.watchId);
        if (!watch || watch.status !== "paused") throw failure("Only a paused watch can be resumed.");
        if (watch.assignmentId) throw failure("Resume the assignment through assignment.update after a new user instruction.");
        state.requestContext = context;
        watch.status = "active";
        try { await worker.observeWatch(state, watch); }
        catch (error) {
          watch.status = "paused";
          watch.error = error.message;
          throw error;
        }
        await records.persist(state);
        worker.scheduleWatches(state);
        worker.wakeForObservations(state);
        return { ok: true };
      });
    }
  });
  return watches;
}

export { createColleagueWatches };
