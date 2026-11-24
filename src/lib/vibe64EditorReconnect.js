// Whether the editor answers the page. A workspace's editor restarts for each release: its server stops, nothing
// answers for a while (the hosted edge says 502 or 503, or the connection is refused), and then the next server
// answers. The page's HTTP client (vibe64HttpClient.js) tells this when a request finds the editor unreachable and
// when the editor answers again. After UPDATING_AFTER_MS without an answer the page says "Updating…" (src/error.js),
// and once the editor answers it clears that and realtime catches up (packages/main's vibe64RealtimeQueries.js).

// Long enough that a single dropped request or a quick blip says nothing, short enough that a person who just
// clicked sees at once why nothing happened yet.
const UPDATING_AFTER_MS = 1_500;
const UPDATING_MESSAGE = "Updating…";

/**
 * @typedef {{ type: "updating" } | { type: "answered", wasUpdating: boolean }} EditorReconnectEvent
 */

function createEditorReconnect() {
  // When requests began to find the editor unreachable, or 0 while it answers.
  let failingSince = 0;
  let updating = false;
  /** @type {ReturnType<typeof setTimeout> | null} */
  let updatingTimer = null;
  /** @type {Set<(event: EditorReconnectEvent) => void>} */
  const listeners = new Set();
  /** @type {Set<() => void>} */
  const answerWaiters = new Set();

  function emit(event) {
    for (const listener of [...listeners]) {
      try {
        listener(event);
      } catch {
        // A listener's failure must never change what the page's requests do.
      }
    }
  }

  /** A request found the editor unreachable. */
  function failed() {
    if (failingSince) return;
    failingSince = Date.now();
    updatingTimer = globalThis.setTimeout(() => {
      updatingTimer = null;
      if (!failingSince || updating) return;
      updating = true;
      emit({ type: "updating" });
    }, UPDATING_AFTER_MS);
  }

  /** The editor answered a request. */
  function answered() {
    if (!failingSince) return;
    failingSince = 0;
    if (updatingTimer !== null) {
      globalThis.clearTimeout(updatingTimer);
      updatingTimer = null;
    }
    const wasUpdating = updating;
    updating = false;
    for (const resolve of [...answerWaiters]) resolve();
    answerWaiters.clear();
    emit({ type: "answered", wasUpdating });
  }

  /** Resolves when the editor next answers, at once while it answers. */
  function whenAnswered() {
    if (!failingSince) return Promise.resolve();
    return new Promise((resolve) => answerWaiters.add(resolve));
  }

  /** Whether requests find the editor unreachable now. */
  function unreachable() {
    return failingSince !== 0;
  }

  /**
   * @param {(event: EditorReconnectEvent) => void} listener
   * @returns {() => void} the unsubscribe
   */
  function subscribe(listener) {
    listeners.add(listener);
    return () => listeners.delete(listener);
  }

  return Object.freeze({
    answered,
    failed,
    subscribe,
    unreachable,
    whenAnswered
  });
}

// readable-check: allow module-state - shared resource: the page has one editor, and every request, the "Updating…" notice and realtime read the one view of whether it answers
const editorReconnect = createEditorReconnect();

export {
  createEditorReconnect,
  editorReconnect,
  UPDATING_AFTER_MS,
  UPDATING_MESSAGE
};
