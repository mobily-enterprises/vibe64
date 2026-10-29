import { computed, onScopeDispose, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import {
  VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  vibe64SessionCheckUpdatesPath,
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  DEFAULT_VISIBLE_SESSION_LIMIT,
  visibleVibe64ToolbarSessions
} from "@/lib/vibe64SessionToolbarVisibility.js";
import {
  REPOSITORY_UPDATE_CHECK_FAILED_REASON,
  repositoryStatusRealtimeNeedsCanonicalCheck,
  repositoryStatusRealtimeShouldRefresh,
  repositoryStatusSessionId
} from "@/lib/vibe64RepositoryRealtime.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { useVibe64ProjectWatch } from "@/composables/useVibe64ProjectWatch.js";

const DEFAULT_MAX_CONCURRENCY = 2;
const DEFAULT_STALE_AFTER_MS = 5 * 60_000;
const DEFAULT_STALE_CHECK_INTERVAL_MS = 60_000;
// One change reaches a session as a burst: a turn's checkpoint and idle state,
// observed file changes, a check's result, and the runtime host's refresh of
// the same task revision. A change's inspection starts once its session's
// burst has been quiet this long, and never later than the cap after the
// burst's first request, so a steady stream of changes cannot postpone it.
const DEFAULT_SETTLE_MS = 1_000;
const DEFAULT_MAX_SETTLE_MS = 5_000;

// Inspects each session's work, at most `maxConcurrency` sessions at a time.
// A session has at most one inspection running and one requested: requests
// made while it runs become exactly one follow-up, because the running read
// may predate their change. A request with `settle` waits for its burst to
// settle; one without starts as soon as a slot frees and takes the burst's
// settling requests with it.
function createVibe64SessionRepositoryStatusQueue({
  clearTimer = (timer) => clearTimeout(timer),
  maxConcurrency = DEFAULT_MAX_CONCURRENCY,
  maxSettleMs = DEFAULT_MAX_SETTLE_MS,
  now = () => Date.now(),
  onInspected = () => null,
  onState = () => null,
  prioritized = () => false,
  requestWork,
  setTimer = (callback, delay) => setTimeout(callback, delay),
  settleMs = DEFAULT_SETTLE_MS,
  staleAfterMs = DEFAULT_STALE_AFTER_MS
} = {}) {
  if (typeof requestWork !== "function") {
    throw new TypeError("Session repository status requires a work inspector.");
  }
  const concurrency = Math.max(1, Number(maxConcurrency || 0));
  const records = new Map();
  // Each session's requested inspection that has not started:
  // { firstAt, lastAt, ready, settle, timer, waiters }.
  const requested = new Map();
  const activeSessions = new Set();
  const canonicalUpdatePending = new Map();
  const idleWaiters = new Set();
  let active = 0;
  let disposed = false;

  function settled() {
    if (active || requested.size) {
      return;
    }
    for (const resolve of idleWaiters) {
      resolve();
    }
    idleWaiters.clear();
  }

  function observe(sessionId = "", workState = null) {
    const id = String(sessionId || "").trim();
    if (!id) {
      return;
    }
    const state = workState && typeof workState === "object" ? { ...workState } : {};
    if (canonicalUpdatePending.has(id)) {
      const expectedCommit = canonicalUpdatePending.get(id);
      if (expectedCommit && state.canonicalCommit === expectedCommit && state.updateStatusPending !== true) {
        canonicalUpdatePending.delete(id);
      } else {
        state.updateAvailable = true;
        state.updateStatusPending = true;
      }
    }
    const checkedAt = String(state.checkedAt || "").trim();
    records.set(id, {
      checkedAtMs: checkedAt ? Date.parse(checkedAt) || now() : now(),
      workState: state
    });
    onState({ sessionId: id, workState: state });
  }

  function markUpdatePending(sessionId = "", canonicalCommit = "") {
    const id = String(sessionId || "").trim();
    if (!id) {
      return;
    }
    const prior = records.get(id)?.workState || {};
    canonicalUpdatePending.set(id, String(canonicalCommit || "").trim());
    observe(id, {
      ...prior,
      checkedAt: "",
      error: "",
      loading: false,
      updateAvailable: true,
      updateStatusPending: true
    });
  }

  function confirmCanonical(sessionId = "", { canonicalCommit = "", updateAvailable = false } = {}) {
    const id = String(sessionId || "").trim();
    const commit = String(canonicalCommit || "").trim();
    const expectedCommit = canonicalUpdatePending.get(id);
    if (updateAvailable && (!expectedCommit || expectedCommit === commit)) {
      markUpdatePending(id, commit);
    } else if (expectedCommit === "") {
      canonicalUpdatePending.set(id, commit);
    }
  }

  function markCanonicalCheckUnavailable(sessionId = "", error = "") {
    const id = String(sessionId || "").trim();
    if (!id) {
      return;
    }
    const prior = records.get(id)?.workState || {};
    observe(id, {
      ...prior,
      checkedAt: new Date(now()).toISOString(),
      error: String(error || "Repository update status is unavailable."),
      loading: false
    });
  }

  function fresh(sessionId) {
    const checkedAtMs = records.get(sessionId)?.checkedAtMs || 0;
    return checkedAtMs > 0 && now() - checkedAtMs < staleAfterMs;
  }

  async function inspect(sessionId, waiters) {
    active += 1;
    activeSessions.add(sessionId);
    const prior = records.get(sessionId)?.workState || null;
    if (!prior) {
      observe(sessionId, {
        checkedAt: "",
        error: "",
        loading: true,
        operation: null,
        unsaved: null
      });
    }
    let workState = null;
    try {
      const result = await requestWork(sessionId);
      if (disposed) {
        return;
      }
      if (result?.ok === false) {
        throw new Error(vibe64ApiResponseError(result, "Session work could not be inspected."));
      }
      workState = {
        ...result,
        checkedAt: new Date(now()).toISOString(),
        error: "",
        loading: false
      };
      observe(sessionId, workState);
    } catch (error) {
      if (disposed) {
        return;
      }
      workState = {
        checkedAt: new Date(now()).toISOString(),
        error: error instanceof Error ? error.message : String(error || "Session work could not be inspected."),
        loading: false,
        operation: null,
        unsaved: null
      };
      observe(sessionId, workState);
    } finally {
      active -= 1;
      activeSessions.delete(sessionId);
      if (workState) {
        onInspected({ sessionId, workState });
      }
      for (const resolve of waiters) {
        resolve(workState);
      }
      const followUp = requested.get(sessionId);
      if (followUp) {
        arm(sessionId, followUp);
      }
      drain();
      settled();
    }
  }

  function start(next) {
    next.timer = null;
    next.ready = true;
    drain();
  }

  // Schedules a session's requested inspection; a running one keeps it waiting.
  function arm(sessionId, next) {
    if (disposed || next.ready || activeSessions.has(sessionId)) {
      return;
    }
    if (next.timer !== null) {
      clearTimer(next.timer);
      next.timer = null;
    }
    const delay = next.settle
      ? Math.min(next.lastAt + settleMs, next.firstAt + maxSettleMs) - now()
      : 0;
    if (delay > 0) {
      next.timer = setTimer(() => start(next), delay);
    } else {
      start(next);
    }
  }

  function drain() {
    while (!disposed && active < concurrency) {
      let sessionId = "";
      for (const [id, next] of requested) {
        if (!next.ready) continue;
        if (prioritized(id)) {
          sessionId = id;
          break;
        }
        sessionId ||= id;
      }
      if (!sessionId) {
        return;
      }
      const next = requested.get(sessionId);
      requested.delete(sessionId);
      void inspect(sessionId, next.waiters);
    }
  }

  function request(sessionId, { settle = false, waiter = null } = {}) {
    const at = now();
    let next = requested.get(sessionId);
    if (next) {
      next.lastAt = at;
      next.settle &&= settle;
    } else {
      next = { firstAt: at, lastAt: at, ready: false, settle, timer: null, waiters: [] };
      requested.set(sessionId, next);
    }
    if (waiter) {
      next.waiters.push(waiter);
    }
    arm(sessionId, next);
  }

  // Requests an inspection of every listed session that needs one: with
  // `force`, after a change, otherwise only one whose state is not fresh.
  function enqueue(sessionIds = [], { force = false, settle = false } = {}) {
    if (disposed) {
      return;
    }
    for (const rawSessionId of sessionIds) {
      const sessionId = String(rawSessionId || "").trim();
      if (!sessionId || (!force && (requested.has(sessionId) || activeSessions.has(sessionId) || fresh(sessionId)))) {
        continue;
      }
      request(sessionId, { settle: force && settle });
    }
  }

  // Resolves with the work state of the session's next inspection, or null
  // when there is none.
  function inspectSession(sessionId = "", { settle = false } = {}) {
    const id = String(sessionId || "").trim();
    if (disposed || !id) {
      return Promise.resolve(null);
    }
    return new Promise((resolve) => request(id, { settle, waiter: resolve }));
  }

  function cancel(sessionId) {
    const next = requested.get(sessionId);
    requested.delete(sessionId);
    if (next?.timer != null) {
      clearTimer(next.timer);
    }
    for (const resolve of next?.waiters || []) {
      resolve(null);
    }
  }

  // Forgets sessions that left the toolbar. A requested inspection that a
  // runtime host still waits for runs anyway.
  function removeExcept(sessionIds = []) {
    const retained = new Set(sessionIds.map((sessionId) => String(sessionId || "").trim()).filter(Boolean));
    for (const sessionId of new Set([...records.keys(), ...requested.keys()])) {
      if (retained.has(sessionId)) {
        continue;
      }
      records.delete(sessionId);
      canonicalUpdatePending.delete(sessionId);
      if (!requested.get(sessionId)?.waiters.length) {
        cancel(sessionId);
      }
    }
    settled();
  }

  function dispose() {
    disposed = true;
    for (const sessionId of [...requested.keys()]) {
      cancel(sessionId);
    }
    canonicalUpdatePending.clear();
    settled();
  }

  function waitForIdle() {
    if (!active && !requested.size) {
      return Promise.resolve();
    }
    return new Promise((resolve) => idleWaiters.add(resolve));
  }

  return {
    dispose,
    confirmCanonical,
    enqueue,
    inspect: inspectSession,
    markCanonicalCheckUnavailable,
    markUpdatePending,
    observe,
    removeExcept,
    waitForIdle
  };
}

function useVibe64SessionRepositoryStatusRegistry({
  maxVisibleSessions = DEFAULT_VISIBLE_SESSION_LIMIT,
  onState = () => null,
  projectSlug = "",
  selectedSessionId,
  sessionSourceOperationsSuspended = () => false,
  sessions,
  sessionsApiPath
} = {}) {
  const visibleSessions = computed(() => visibleVibe64ToolbarSessions({
    limit: maxVisibleSessions,
    selectedSessionId: readRefOrGetterValue(selectedSessionId),
    sessions: readRefOrGetterValue(sessions) || []
  }));
  const visibleSessionIds = computed(() => visibleSessions.value
    .map((session) => String(session?.sessionId || "").trim())
    .filter(Boolean));
  const selectedId = computed(() => String(readRefOrGetterValue(selectedSessionId) || "").trim());
  const apiPath = computed(() => String(readRefOrGetterValue(sessionsApiPath) || "").trim());
  const suspendedVisibleSessionIds = computed(() => visibleSessionIds.value.filter((sessionId) => (
    sessionSourceOperationsSuspended(sessionId) === true
  )));
  const canonicalChecks = new Map();
  const canonicalCheckedAt = new Map();
  const canonicalAccessRevisions = new Map();
  const forcedCanonicalFollowups = new Set();
  // How many work inspections each session's check results have requested.
  const canonicalCheckInspections = new Map();
  const workListeners = new Map();
  let disposed = false;

  function sourceOperationsSuspended(sessionId = "") {
    const id = String(sessionId || "").trim();
    return Boolean(id && sessionSourceOperationsSuspended(id) === true);
  }

  function canonicalAccessRevision(sessionId = "") {
    return Number(canonicalAccessRevisions.get(sessionId) || 0);
  }

  function advanceCanonicalAccessRevision(sessionId = "") {
    const id = String(sessionId || "").trim();
    if (!id) {
      return 0;
    }
    const revision = canonicalAccessRevision(id) + 1;
    canonicalAccessRevisions.set(id, revision);
    return revision;
  }
  const queue = createVibe64SessionRepositoryStatusQueue({
    onInspected({ sessionId, workState }) {
      for (const listener of workListeners.get(sessionId) || []) {
        listener(workState);
      }
    },
    onState,
    prioritized: (sessionId) => sessionId === selectedId.value,
    async requestWork(sessionId) {
      // Match the selected session's budget for connected Git inspections.
      return getHttpWebClient().request(vibe64SessionPath(
        apiPath.value,
        sessionId,
        "/work"
      ), { method: "GET", timeoutMs: 120_000 });
    }
  });

  // `settle` marks a realtime change, which usually arrives in a burst.
  function inspectVisible({ force = false, includeSelected = false, sessionId = "", settle = false } = {}) {
    if (!apiPath.value) {
      return;
    }
    const requestedId = String(sessionId || "").trim();
    const ids = visibleSessionIds.value.filter((id) => (
      !sourceOperationsSuspended(id) &&
      (includeSelected || id !== selectedId.value) && (!requestedId || id === requestedId)
    ));
    queue.enqueue(ids, { force, settle });
  }

  // A runtime host's work for its own session: it joins this registry's
  // inspection of that session, and every inspection of it reaches the host,
  // so one change reads the session's work once for its tab and its host.
  const sessionWork = Object.freeze({
    inspect(sessionId = "", { settle = false } = {}) {
      const id = String(sessionId || "").trim();
      if (disposed || !id || !apiPath.value || sourceOperationsSuspended(id)) {
        return Promise.resolve(null);
      }
      return queue.inspect(id, { settle });
    },
    subscribe(sessionId = "", listener) {
      const id = String(sessionId || "").trim();
      if (!id || typeof listener !== "function") {
        return () => {};
      }
      const listeners = workListeners.get(id) || new Set();
      listeners.add(listener);
      workListeners.set(id, listeners);
      return () => {
        listeners.delete(listener);
        if (!listeners.size && workListeners.get(id) === listeners) {
          workListeners.delete(id);
        }
      };
    }
  });

  function observeCanonicalCheck(sessionId, result, { settle = false } = {}) {
    if (forcedCanonicalFollowups.has(sessionId)) {
      return;
    }
    const checkedAt = String(result.checkedAt || "");
    if (checkedAt && checkedAt <= (canonicalCheckedAt.get(sessionId) || "")) {
      return;
    }
    if (checkedAt) {
      canonicalCheckedAt.set(sessionId, checkedAt);
    }
    queue.confirmCanonical(sessionId, result);
    canonicalCheckInspections.set(sessionId, (canonicalCheckInspections.get(sessionId) || 0) + 1);
    inspectVisible({ force: true, includeSelected: true, sessionId, settle });
  }

  async function checkCanonical(sessionId = "", { force = false } = {}) {
    const id = String(sessionId || "").trim();
    if (disposed || !id || !apiPath.value || sourceOperationsSuspended(id)) {
      return null;
    }
    const accessRevision = canonicalAccessRevision(id);
    if (canonicalChecks.has(id)) {
      const active = canonicalChecks.get(id);
      if (active.accessRevision === accessRevision) {
        if (force) {
          forcedCanonicalFollowups.add(id);
        }
        return active.promise;
      }
    }
    let request;
    const requestIsCurrent = () => Boolean(
      !disposed &&
      !sourceOperationsSuspended(id) &&
      canonicalAccessRevision(id) === accessRevision &&
      canonicalChecks.get(id)?.promise === request
    );
    request = getHttpWebClient().request(vibe64SessionCheckUpdatesPath(
      apiPath.value,
      id
    ), {
      body: { force },
      method: "POST"
    }).then((result) => {
      if (!requestIsCurrent()) {
        return null;
      }
      if (result?.ok === false) {
        throw new Error(vibe64ApiResponseError(result, "Repository update status is unavailable."));
      }
      observeCanonicalCheck(id, result);
      return result;
    }).catch((error) => {
      if (requestIsCurrent()) {
        queue.markCanonicalCheckUnavailable(id, error instanceof Error
          ? error.message
          : String(error || "Repository update status is unavailable."));
      }
      return null;
    }).finally(() => {
      if (canonicalChecks.get(id)?.promise !== request) {
        return;
      }
      canonicalChecks.delete(id);
      if (
        !disposed &&
        !sourceOperationsSuspended(id) &&
        forcedCanonicalFollowups.delete(id)
      ) {
        return checkCanonical(id, { force: true });
      }
    });
    canonicalChecks.set(id, { accessRevision, promise: request });
    return request;
  }

  async function refresh(sessionId) {
    await checkCanonical(sessionId, { force: true });
    await queue.waitForIdle();
  }

  watch(() => [apiPath.value, selectedId.value, ...visibleSessionIds.value], () => {
    queue.removeExcept(visibleSessionIds.value);
    for (const id of canonicalCheckedAt.keys()) {
      if (!visibleSessionIds.value.includes(id)) canonicalCheckedAt.delete(id);
    }
    inspectVisible();
    if (!canonicalCheckedAt.has(selectedId.value)) {
      void checkCanonical(selectedId.value);
    }
  }, { immediate: true });

  let priorSuspendedSessionIds = new Set();
  watch(suspendedVisibleSessionIds, (sessionIds) => {
    const nextSuspendedSessionIds = new Set(sessionIds);
    for (const sessionId of new Set([
      ...priorSuspendedSessionIds,
      ...nextSuspendedSessionIds
    ])) {
      const wasSuspended = priorSuspendedSessionIds.has(sessionId);
      const suspended = nextSuspendedSessionIds.has(sessionId);
      if (wasSuspended === suspended) {
        continue;
      }
      advanceCanonicalAccessRevision(sessionId);
      forcedCanonicalFollowups.delete(sessionId);
      if (!suspended && visibleSessionIds.value.includes(sessionId)) {
        void checkCanonical(sessionId, { force: true });
      }
    }
    priorSuspendedSessionIds = nextSuspendedSessionIds;
  }, {
    flush: "sync",
    immediate: true
  });

  useRealtimeEvent({
    enabled: computed(() => visibleSessionIds.value.length > 0),
    event: VIBE64_SESSION_SUMMARY_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => Boolean(
      visibleSessionIds.value.includes(repositoryStatusSessionId(payload)) &&
      !sourceOperationsSuspended(repositoryStatusSessionId(payload)) &&
      (repositoryStatusRealtimeShouldRefresh(payload) || payload.reason === REPOSITORY_UPDATE_CHECK_FAILED_REASON)
    ),
    onEvent: ({ payload = {} } = {}) => {
      const sessionId = repositoryStatusSessionId(payload);
      if (sourceOperationsSuspended(sessionId)) {
        return;
      }
      if (payload.reason === "session-pull-request") {
        advanceCanonicalAccessRevision(sessionId);
        canonicalCheckedAt.delete(sessionId);
      }
      if (payload.reason === "session-repository-checked") {
        observeCanonicalCheck(sessionId, payload.repositoryUpdateCheck, { settle: true });
        return;
      }
      if (payload.reason === REPOSITORY_UPDATE_CHECK_FAILED_REASON) {
        queue.markCanonicalCheckUnavailable(sessionId, payload.repositoryUpdateCheckError?.message);
        return;
      }
      const inspectChange = () => inspectVisible({
        force: true,
        includeSelected: true,
        sessionId,
        settle: true
      });
      if (repositoryStatusRealtimeNeedsCanonicalCheck(payload)) {
        // The forced check's result inspects the session's work, so the change
        // is inspected once, after the check. When no check result requests
        // that inspection (the check failed, or it joined a running check whose
        // forced recheck failed), the change requests it itself.
        queue.markUpdatePending(sessionId, payload.canonicalCommit);
        const checkInspections = canonicalCheckInspections.get(sessionId) || 0;
        void checkCanonical(sessionId, { force: true }).then(() => {
          if ((canonicalCheckInspections.get(sessionId) || 0) === checkInspections) inspectChange();
        });
        return;
      }
      inspectChange();
    }
  });

  useRealtimeEvent({
    enabled: computed(() => visibleSessionIds.value.length > 0),
    event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => visibleSessionIds.value.includes(
      repositoryStatusSessionId(payload)
    ) && !sourceOperationsSuspended(repositoryStatusSessionId(payload)),
    onEvent: ({ payload = {} } = {}) => inspectVisible({
      force: true,
      includeSelected: true,
      sessionId: repositoryStatusSessionId(payload),
      settle: true
    })
  });

  const browserDocument = typeof document === "undefined" ? null : document;
  const interval = typeof window === "undefined"
    ? null
    : window.setInterval(() => {
        if (browserDocument?.visibilityState === "hidden") {
          return;
        }
        inspectVisible();
      }, DEFAULT_STALE_CHECK_INTERVAL_MS);

  // While this page has the project open, visible or in a background tab, it
  // watches the project: the server checks every session for updates every
  // 30 s and publishes each result (vibe64-sessions' repositoryUpdateProbe.js)
  // as a session summary, so this registry only reacts to those events. Only
  // leaving the project or the page, or a lost connection, ends the watch: a
  // person returning to a hidden tab must find its state already current.
  useVibe64ProjectWatch({ projectSlug });

  const refreshWhenVisible = () => {
    if (browserDocument?.visibilityState !== "visible") {
      return;
    }
    inspectVisible({ force: true });
  };
  browserDocument?.addEventListener("visibilitychange", refreshWhenVisible);

  onScopeDispose(() => {
    disposed = true;
    browserDocument?.removeEventListener("visibilitychange", refreshWhenVisible);
    if (interval !== null) {
      window.clearInterval(interval);
    }
    canonicalChecks.clear();
    canonicalCheckedAt.clear();
    canonicalAccessRevisions.clear();
    forcedCanonicalFollowups.clear();
    canonicalCheckInspections.clear();
    workListeners.clear();
    queue.dispose();
  });

  return {
    inspectVisible,
    observe: queue.observe,
    refresh,
    sessionWork,
    visibleSessionIds
  };
}

export {
  createVibe64SessionRepositoryStatusQueue,
  useVibe64SessionRepositoryStatusRegistry
};
