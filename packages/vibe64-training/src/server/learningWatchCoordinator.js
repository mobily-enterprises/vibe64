import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { conversationObservation, watchUpdate } from "@local/vibe64-core/server/watch-observations";

const LEARNING_WATCH_SOURCE = "learning-task";

function failure(message, code = "vibe64_colleague_failed", statusCode = 409) {
  return Object.assign(new Error(message), { code, statusCode });
}

function requireResult(result) {
  if (result?.ok === false) throw failure(result.error || "The learning watch operation failed.", result.code);
  return result;
}

function learningFocusMatches(watch, focus) {
  return focus?.learningAttemptId === watch.learningTask?.attemptId &&
    (focus.projectSlug || "") === (watch.projectSlug || "") && focus.sessionId === watch.sessionId;
}

function learningBindingMatches(watch, connection, learningClientId) {
  const task = connection?.learningTask;
  if (!learningFocusMatches(watch, connection?.focus)) return false;
  if (!task) return Boolean(learningClientId);
  return task.attemptId === watch.learningTask?.attemptId && (task.projectSlug || "") === (watch.projectSlug || "") &&
    task.sessionId === watch.sessionId && task.conversationId === watch.conversationId && task.learningClientId === learningClientId;
}

function isLearningWatch(watch) {
  return watch?.source === LEARNING_WATCH_SOURCE;
}

function publicLearningWatch({ cursor, eventIds, browserClientId, learningClientId, pendingGuidance, lastGuidanceEvidenceKey, ...watch }) {
  const latest = watch.learningTask?.progress?.latest;
  return { ...watch, assessmentEvidence: {
    available: Boolean(latest), supportsRequestedOutcome: latest?.outcome === "passed",
    ...(latest ? Object.fromEntries(["assessmentId", "outcome", "recordedAt"]
      .filter(key => latest[key] !== undefined).map(key => [key, latest[key]])) : {})
  } };
}

function normalizeSource(source) {
  const normalized = typeof source === "function" ? { read: source } : source;
  if (typeof normalized?.read !== "function" || normalized.notify !== undefined && typeof normalized.notify !== "function") {
    throw new TypeError("A Learning watch source needs an authorized reader and optional Main notifier.");
  }
  return Object.freeze({ read: normalized.read, ...(normalized.notify ? { notify: normalized.notify } : {}) });
}

function createTrainingLearningWatchSource(actions) {
  if (typeof actions?.execute !== "function") throw new TypeError("The Learning watch source requires the shared action catalogue.");
  const learningInput = watch => {
    const { pin: _pin, progress: _progress, projectSlug: _projectSlug, ...input } = watch.learningTask;
    const pin = watch.learningTask.pin;
    return { ...input, targetProjectSlug: watch.projectSlug,
      ...(pin ? { topicHash: pin.topicHash, lessonHash: pin.lessonHash } : {}) };
  };
  return Object.freeze({
    async read(watch, context) {
      const result = await actions.execute({ actionId: "vibe64.training.polling.read",
        input: learningInput(watch), context });
      const task = result.task;
      watch.learningTask = task;
      const latest = watch.latestObservation || null;
      const revision = `${task.progress.revision}:${latest?.eventId || ""}`;
      const summary = latest
        ? `Learning task update: ${latest.control} was observed in ${latest.workspace.learningView} view (${latest.workspace.pane || "no pane"}).`
        : `Learning task update: saved progress revision ${task.progress.revision}; no new learner gesture was observed.`;
      return { status: "working", runId: task.attemptId, revision,
        messages: [{ id: `learning:${revision}`, role: "assistant", text: summary }],
        details: { task, latestObservation: latest } };
    },
    notify(watch, pending, context) {
      return actions.execute({ actionId: "vibe64.training.polling.guide",
        input: { ...learningInput(watch), guidanceId: pending.guidanceId, evidence: pending.evidence }, context });
    }
  });
}

function createLearningWatchCoordinator({ host, pollMs = 30000, debounceMs = 250 } = {}) {
  if (typeof host?.persist !== "function" || typeof host?.actionContext !== "function" || typeof host?.closed !== "function") {
    throw new TypeError("Learning watches require persistence, request-context and lifecycle host facilities.");
  }
  const runtimes = new Map();
  let source = null;

  const watches = state => state.record.watches.filter(isLearningWatch);
  const runtimeFor = state => {
    if (!runtimes.has(state)) runtimes.set(state, { timer: null, polling: null, dirty: false });
    return runtimes.get(state);
  };
  const authorizedSource = () => {
    if (!source) throw failure("The Learning watch source is unavailable in this runtime.");
    return source;
  };

  async function read(state, watch, connection) {
    const result = requireResult(await authorizedSource().read(watch, host.actionContext(state, connection)));
    const observation = conversationObservation({ ...result, replyDuringWork: true });
    watch.cursor = watchUpdate(watch, observation).cursor;
    watch.error = "";
    return observation;
  }

  async function deliverGuidance(state, watch) {
    const pending = watch.pendingGuidance;
    if (!pending || watch.status !== "active") return;
    const notify = authorizedSource().notify;
    if (typeof notify !== "function") throw failure("This Learning watch cannot notify its Main teacher.");
    const result = requireResult(await notify(watch, structuredClone(pending),
      host.actionContext(state, { clientId: watch.browserClientId, focus: watch })));
    if (result.status === "deferred") return;
    if (!["accepted", "duplicate"].includes(result.status)) {
      throw failure("The Main teacher returned an invalid learning guidance receipt.");
    }
    if (watch.status !== "active" || watch.pendingGuidance?.guidanceId !== pending.guidanceId) return;
    watch.lastGuidanceEvidenceKey = pending.evidenceKey;
    watch.lastGuidance = { status: result.status, deliveredAt: new Date().toISOString(),
      outcome: pending.evidence.outcome, control: pending.evidence.control };
    delete watch.pendingGuidance;
  }

  function schedule(state, delay = pollMs) {
    const runtime = runtimeFor(state);
    if (host.closed() || state.rotating || !state.requestContext || !watches(state).some(watch => watch.status === "active")) return;
    if (runtime.timer && delay === pollMs) return;
    clearTimeout(runtime.timer);
    runtime.timer = setTimeout(() => {
      runtime.timer = null;
      void poll(state).catch(() => {});
    }, delay);
    runtime.timer.unref?.();
  }

  async function poll(state) {
    const runtime = runtimeFor(state);
    if (state.rotating) { runtime.dirty = true; return; }
    if (runtime.polling) { runtime.dirty = true; return runtime.polling; }
    runtime.polling = (async () => {
      for (const watch of watches(state)) {
        if (host.closed() || !state.requestContext) break;
        if (watch.status !== "active") continue;
        try {
          await read(state, watch, { clientId: "", focus: watch });
          await deliverGuidance(state, watch);
        } catch (error) {
          if (watch.status !== "active") continue;
          watch.status = "paused";
          watch.availability = "unavailable";
          watch.error = `Watching paused: ${error.message}`.slice(0, 512);
        }
      }
      await host.persist(state);
    })().finally(() => {
      runtime.polling = null;
      const delay = runtime.dirty ? debounceMs : pollMs;
      runtime.dirty = false;
      schedule(state, delay);
    });
    return runtime.polling;
  }

  async function clearPending(state, watch) {
    delete watch.pendingGuidance;
    state.record.observations = state.record.observations.filter(item => item.watchId !== watch.watchId);
    await host.persist(state);
  }

  async function restore(state) {
    const interrupted = new Set();
    for (const watch of watches(state)) {
      if (!["active", "pending"].includes(watch.status)) continue;
      watch.status = "paused";
      watch.availability = "unavailable";
      watch.error = "Watching paused after the server restarted. Return to this Learning task and choose Resume.";
      delete watch.pendingGuidance;
      interrupted.add(watch.watchId);
    }
    if (!interrupted.size) return;
    state.record.observations = state.record.observations.filter(item => !interrupted.has(item.watchId));
    await host.persist(state);
  }

  async function start(state, input, context) {
    if (host.closed()) throw failure("Colleague is shutting down.");
    const invokingClientId = context.colleague?.clientId || "";
    const invokingConnection = invokingClientId ? state.connections.get(invokingClientId) : null;
    if (invokingClientId && !invokingConnection?.learningTask) {
      throw failure("Open the exact Learning task in this browser before asking Colleague to watch it.");
    }
    const boundTask = invokingConnection?.learningTask;
    const request = boundTask ? {
      ...structuredClone(boundTask), watchId: input.watchId, browserClientId: invokingClientId,
      ...(String(input.criterion || "").trim() ? { criterion: String(input.criterion).trim() } : {})
    } : input;
    const existing = state.record.watches.find(watch => watch.watchId === request.watchId);
    if (existing) {
      if (!isLearningWatch(existing) || existing.learningTask?.attemptId !== request.attemptId ||
          existing.projectSlug !== request.projectSlug || existing.sessionId !== request.sessionId ||
          existing.conversationId !== request.conversationId) {
        throw failure("This watch ID belongs to a different request. Use a new watch ID.");
      }
      return { ok: true, watch: publicLearningWatch(existing) };
    }
    if (state.record.watches.filter(watch => ["active", "pending", "paused"].includes(watch.status)).length >= 16) {
      throw failure("Cancel an existing watch before adding another; up to 16 can be retained.");
    }
    const connection = state.connections.get(request.browserClientId);
    const provisional = { learningTask: { attemptId: request.attemptId }, projectSlug: request.projectSlug,
      sessionId: request.sessionId };
    if (!connection || !learningFocusMatches(provisional, connection.focus)) {
      throw failure("Open this exact Learning task in the initiating browser before starting its watch.");
    }
    if (!request.reference && !String(request.criterion || "").trim()) {
      throw failure("Name the current learning task or start from its delivered lesson question.", "ACTION_VALIDATION_FAILED", 400);
    }
    state.requestContext = context;
    const learningTask = Object.fromEntries(["attemptId", "sessionId", "conversationId", "topicHash", "lessonHash", "reference", "criterion"]
      .filter(key => request[key] !== undefined && request[key] !== "").map(key => [key, structuredClone(request[key])]));
    learningTask.targetProjectSlug = request.projectSlug;
    const watch = { watchId: request.watchId, source: LEARNING_WATCH_SOURCE, projectSlug: request.projectSlug,
      sessionId: request.sessionId, conversationId: request.conversationId, condition: "reply",
      question: request.reference ? "Report meaningful progress on the current delivered learning question."
        : String(request.criterion).trim(), once: false, status: "active", error: "", learningTask,
      availability: "active", browserClientId: request.browserClientId,
      learningClientId: request.learningClientId, eventIds: [] };
    await read(state, watch, { clientId: "", focus: watch });
    state.record.watches = state.record.watches.filter(item => !["delivered", "cancelled"].includes(item.status)).concat(watch);
    await host.persist(state);
    schedule(state);
    return { ok: true, watch: publicLearningWatch(watch) };
  }

  async function observe(state, input, origin = "learner") {
    state.requestContext ||= {};
    const watch = state.record.watches.find(item => item.watchId === input.watchId);
    if (!isLearningWatch(watch)) throw failure("This learning-task watch is unavailable.", "conversation_forbidden", 403);
    if (watch.status !== "active") throw failure("This learning-task watch is not active.");
    const connection = state.connections.get(watch.browserClientId);
    if (!connection || !learningFocusMatches(watch, connection.focus)) {
      throw failure("Return to this exact Learning task before recording an observation.");
    }
    if ((input.workspace.projectSlug || "") !== (connection.focus.projectSlug || "") ||
        input.workspace.sessionId !== connection.focus.sessionId ||
        input.workspace.learningView !== connection.focus.learningView) {
      throw failure("The learning workspace changed before this observation settled.");
    }
    if (input.learningClientId && input.learningClientId !== watch.learningClientId) {
      throw failure("This learning presentation no longer owns the watch.", "conversation_forbidden", 403);
    }
    const payload = { eventId: input.eventId, outcome: input.outcome || "confirmed", control: input.control,
      workspace: structuredClone(input.workspace), origin,
      ...(input.failure ? { failure: input.failure } : {}) };
    const duplicate = (watch.eventIds || []).find(value => value.eventId === input.eventId);
    if (duplicate) {
      if (!isDeepStrictEqual(duplicate, payload)) throw failure("This learning observation ID belongs to a different event.");
      return { ok: true, duplicate: true, watch: publicLearningWatch(watch) };
    }
    await read(state, watch, { clientId: watch.browserClientId, focus: connection.focus });
    watch.eventIds = [...(watch.eventIds || []).slice(-15), payload];
    watch.latestObservation = { ...payload, observedAt: new Date().toISOString() };
    const evidenceKey = JSON.stringify({ outcome: payload.outcome, control: payload.control, workspace: payload.workspace,
      failure: payload.failure || "", progressRevision: watch.learningTask?.progress?.revision });
    if (watch.lastGuidanceEvidenceKey !== evidenceKey && watch.pendingGuidance?.evidenceKey !== evidenceKey) {
      watch.pendingGuidance = { guidanceId: `learning-guidance-${randomUUID()}`, evidenceKey,
        evidence: structuredClone(payload) };
    }
    await read(state, watch, { clientId: watch.browserClientId, focus: connection.focus });
    await host.persist(state);
    schedule(state, debounceMs);
    return { ok: true, duplicate: false, watch: publicLearningWatch(watch) };
  }

  async function pause(state, watch) {
    if (!watch || !["active", "pending"].includes(watch.status)) throw failure("Only an active watch can be paused.");
    watch.status = "paused";
    watch.availability = "paused";
    watch.error = "Watching paused by the learner.";
    await clearPending(state, watch);
    return { ok: true, watch: publicLearningWatch(watch) };
  }

  async function resume(state, watch, input, context) {
    if (!watch || watch.status !== "paused") throw failure("Only a paused watch can be resumed.");
    state.requestContext = context;
    const browserClientId = context.colleague?.clientId || input.browserClientId;
    const connection = browserClientId ? state.connections.get(browserClientId) : null;
    const learningClientId = context.colleague?.clientId ? connection?.learningTask?.learningClientId : input.learningClientId;
    if (!browserClientId || !learningClientId) throw failure("Return to this Learning task before resuming its watch.");
    watch.browserClientId = browserClientId;
    watch.learningClientId = learningClientId;
    if (!learningBindingMatches(watch, connection, learningClientId)) {
      throw failure("Return to this exact Learning task before resuming its watch.");
    }
    watch.status = "active";
    watch.availability = "active";
    try { await read(state, watch, { clientId: "", focus: watch }); }
    catch (error) {
      watch.status = "paused";
      watch.availability = "unavailable";
      watch.error = error.message;
      throw error;
    }
    await host.persist(state);
    schedule(state);
    return { ok: true };
  }

  async function cancel(state, watch) {
    if (watch) watch.status = "cancelled";
    if (isLearningWatch(watch)) await clearPending(state, watch);
    else await host.persist(state);
    return { ok: true };
  }

  async function focusChanged(state, connection, previousFocus, demonstration) {
    for (const watch of watches(state).filter(item => item.browserClientId === connection.clientId &&
      ["active", "pending"].includes(item.status))) {
      if (!learningFocusMatches(watch, connection.focus)) {
        watch.status = "paused";
        watch.availability = "paused";
        watch.error = "Watching paused because the browser left this Learning task.";
        await clearPending(state, watch);
        continue;
      }
      if (watch.status === "active" && previousFocus?.learningView && previousFocus.learningView !== connection.focus.learningView) {
        await observe(state, {
          watchId: watch.watchId, eventId: randomUUID(), control: "view-change",
          workspace: { projectSlug: connection.focus.projectSlug || "", sessionId: connection.focus.sessionId,
            pane: connection.focus.pane || "", ready: true, learningView: connection.focus.learningView }
        }, demonstration ? "demonstration" : "view");
      }
    }
  }

  async function close() {
    for (const runtime of runtimes.values()) clearTimeout(runtime.timer);
    await Promise.all([...runtimes.values()].map(runtime => runtime.polling));
    runtimes.clear();
  }

  return Object.freeze({
    cancel, close, focusChanged, isWatch: isLearningWatch, observe, pause, publicWatch: publicLearningWatch,
    registerSource(value) {
      if (source) throw new TypeError("The Learning watch source is already registered.");
      source = normalizeSource(value);
    },
    restore, resume, schedule, start
  });
}

export { createLearningWatchCoordinator, createTrainingLearningWatchSource, isLearningWatch, learningFocusMatches,
  publicLearningWatch };
