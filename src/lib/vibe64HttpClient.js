import { createHttpClient, isGenericHttpErrorMessage } from "@jskit-ai/http-runtime/client";
import { isTransientQueryError, markTransientRetriesSpent } from "@jskit-ai/kernel/shared/support";
import { editorReconnect as pageEditorReconnect } from "./vibe64EditorReconnect.js";
import { resolveStudioRequestUrl } from "./studioUrls.js";

// The page's one HTTP client, which src/main.js configures for every request the page makes. It carries the page
// through an editor restart: a workspace's editor restarts for each release, and for a while nothing answers (the
// hosted edge says 502 or 503, or the connection is refused) until the next server does.
//
// - A read (GET, HEAD) that finds the editor unreachable (no answer, or 502, 503 or 504) is sent again quietly, after
//   RETRY_DELAYS_MS, for up to RECONNECT_WINDOW_MS from its start (or its own timeoutMs, when shorter). Reading
//   twice changes nothing.
// - A write is sent again only when the editor cannot have done it:
//   - while the page already knows the editor is unreachable, a write waits and is not sent. It goes out once the
//     editor answers (a GET of HEALTH_PATH watches for that), or fails after RECONNECT_WINDOW_MS saying it was not
//     done;
//   - a write the stopping editor refused before any handler ran (503 with STOPPING_HEADER, which the server sends
//     to a request that arrives while it stops) is sent again in the same way.
//   Any other failure of a write (no answer, or the edge's 502, 503 or 504) may come after the editor did it: it is
//   never sent again. Its error keeps the transport's status and code, so a caller that follows its own lost
//   answers (a Main chat send, a Preview start, Create pull request) still does, and it says in words that Vibe64
//   cannot tell whether it was done.
// A failure the page reports in the end says so in words, never as a status code, and is marked as retried, so a
// query does not repeat the whole wait.

const SAFE_METHODS = Object.freeze(new Set(["GET", "HEAD", "OPTIONS"]));
// The edge's gap in a restart is 7-30 s today; a minute covers it with room, and a person who waited a minute is
// better told than kept waiting.
const RECONNECT_WINDOW_MS = 60_000;
const RETRY_DELAYS_MS = Object.freeze([250, 500, 1_000, 2_000, 3_000]);
const HEALTH_PATH = "/api/health";
// How often the editor is checked once it has not answered for RECONNECT_WINDOW_MS.
const LONG_OUTAGE_PROBE_MS = 10_000;
// The stopping editor's answer to a request it did not start (server.js's stop).
const STOPPING_HEADER = "x-vibe64-stopping";
// Each attempt's record of what came back, which the client's fetch fills in: a symbol in the request's options,
// which JSKIT's client passes on to fetch with the rest of them and fetch itself ignores.
const ATTEMPT = Symbol("vibe64.httpAttempt");

const READ_UNREACHABLE = "Vibe64 can't reach the editor. It may be updating; try again in a moment.";
const WRITE_NOT_DONE = "Vibe64 couldn't reach the editor, so this wasn't done. Try again in a moment.";
const WRITE_OUTCOME_UNKNOWN = "Vibe64 lost contact with the editor while doing this, so it can't tell whether it " +
  "was done. Check, then try again if it wasn't.";

function abortError(signal) {
  return signal?.reason ?? Object.assign(new Error("The request was stopped."), { name: "AbortError" });
}

/** Waits `ms`, or rejects as soon as `signal` aborts. */
function pause(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) return reject(abortError(signal));
    const timer = globalThis.setTimeout(() => {
      signal?.removeEventListener("abort", stop);
      resolve();
    }, ms);
    function stop() {
      globalThis.clearTimeout(timer);
      reject(abortError(signal));
    }
    signal?.addEventListener("abort", stop, { once: true });
  });
}

function retryDelay(attempt) {
  return RETRY_DELAYS_MS[Math.min(attempt, RETRY_DELAYS_MS.length - 1)];
}

function stoppedByCaller(error, signal) {
  return Boolean(signal?.aborted) || error?.name === "AbortError" || error?.name === "TimeoutError";
}

/**
 * The failure the page reports, in words: the transport's own text (a status-only message or a network failure)
 * becomes `message`, and its status and code stay. A failure the editor explained itself keeps its words, unless
 * the stopping editor gave it.
 */
function reportedFailure(error, message, { stopping = false } = {}) {
  if (stopping || isGenericHttpErrorMessage(error)) {
    error.message = message;
    delete error.messageCode;
    delete error.messageParams;
  }
  return markTransientRetriesSpent(error);
}

/**
 * @param {object} [options]
 * @param {typeof fetch} [options.fetchImpl] the page's fetch unless given
 * @param {(url: string) => string} [options.resolveRequestUrl]
 * @param {ReturnType<typeof import("./vibe64EditorReconnect.js").createEditorReconnect>} [options.reconnect]
 */
function createVibe64HttpClient({
  fetchImpl = (url, config) => globalThis.fetch(url, config),
  resolveRequestUrl = resolveStudioRequestUrl,
  reconnect = pageEditorReconnect
} = {}) {
  async function recordingFetch(url, config = {}) {
    const attempt = config[ATTEMPT];
    const response = await fetchImpl(url, config);
    if (attempt) {
      attempt.answered = true;
      attempt.stopping = Number(response.status) === 503 && response.headers.get(STOPPING_HEADER) === "1";
    }
    return response;
  }

  const base = createHttpClient({
    credentials: "include",
    csrf: {
      enabled: false,
      sessionPath: "/api/session"
    },
    fetchImpl: recordingFetch,
    resolveRequestUrl(url) {
      return resolveRequestUrl(url);
    }
  });

  // While the editor is unreachable, one GET of HEALTH_PATH at a time watches for its answer, so the "Updating…"
  // notice clears and waiting writes go out as soon as it answers, whether or not a read is retrying meanwhile.
  let watch = null;

  function watchEditor() {
    watch ||= (async () => {
      const startedAt = Date.now();
      for (let attempt = 0; reconnect.unreachable(); attempt += 1) {
        const wait = Date.now() - startedAt < RECONNECT_WINDOW_MS ? retryDelay(attempt) : LONG_OUTAGE_PROBE_MS;
        await answerWithin(wait);
        if (!reconnect.unreachable()) return;
        try {
          await base.request(HEALTH_PATH, { method: "GET" });
          reconnect.answered();
        } catch (error) {
          if (!isTransientQueryError(error) && Number(error?.status) > 0) reconnect.answered();
        }
      }
    })().finally(() => {
      watch = null;
    });
  }

  /**
   * Resolves true when the editor answers within `ms`, false when it does not, and rejects as soon as `signal`
   * aborts.
   */
  function answerWithin(ms, signal = null) {
    return new Promise((resolve, reject) => {
      if (signal?.aborted) return reject(abortError(signal));
      let settled = false;
      const timer = globalThis.setTimeout(() => settle(resolve, false), ms);
      function settle(next, value) {
        if (settled) return;
        settled = true;
        globalThis.clearTimeout(timer);
        signal?.removeEventListener("abort", stop);
        next(value);
      }
      function stop() {
        settle(reject, abortError(signal));
      }
      signal?.addEventListener("abort", stop, { once: true });
      reconnect.whenAnswered().then(() => settle(resolve, true));
    });
  }

  /** Whether the editor answers before `deadline`. */
  async function editorAnswersBy(deadline, signal) {
    watchEditor();
    while (reconnect.unreachable()) {
      const left = deadline - Date.now();
      if (left <= 0 || !await answerWithin(left, signal)) return false;
    }
    return true;
  }

  async function sendThroughRestart(send, requestOptions = {}) {
    const method = String(requestOptions.method || "GET").trim().toUpperCase();
    const write = !SAFE_METHODS.has(method);
    const signal = requestOptions.signal || null;
    // A request's own time limit bounds its whole wait, as it bounded its one attempt before.
    const ownLimit = Number(requestOptions.timeoutMs);
    const deadline = Date.now() + (Number.isSafeInteger(ownLimit) && ownLimit > 0
      ? Math.min(ownLimit, RECONNECT_WINDOW_MS)
      : RECONNECT_WINDOW_MS);
    for (let retry = 0; ; retry += 1) {
      signal?.throwIfAborted();
      if (write && reconnect.unreachable() && !await editorAnswersBy(deadline, signal)) {
        throw markTransientRetriesSpent(Object.assign(new Error(WRITE_NOT_DONE), { status: 0, code: null }));
      }
      const attempt = { answered: false, stopping: false };
      try {
        const value = await send({ ...requestOptions, [ATTEMPT]: attempt });
        reconnect.answered();
        return value;
      } catch (error) {
        if (stoppedByCaller(error, signal)) throw error;
        // An answer the client could not read (a decoding failure) is the editor's, not a lost connection.
        const unreachable = isTransientQueryError(error) && (Number(error?.status) > 0 || !attempt.answered);
        if (!unreachable) {
          if (attempt.answered) reconnect.answered();
          throw error;
        }
        reconnect.failed();
        watchEditor();
        if (write && !attempt.stopping) {
          throw reportedFailure(error, WRITE_OUTCOME_UNKNOWN);
        }
        const wait = retryDelay(retry);
        if (Date.now() + wait > deadline) {
          throw reportedFailure(error, write ? WRITE_NOT_DONE : READ_UNREACHABLE, { stopping: attempt.stopping });
        }
        await pause(wait, signal);
      }
    }
  }

  function request(url, requestOptions = {}, state = null) {
    return sendThroughRestart((options) => base.request(url, options, state), requestOptions);
  }

  function requestStream(url, requestOptions = {}, handlers = {}, state = null) {
    return sendThroughRestart((options) => base.requestStream(url, options, handlers, state), requestOptions);
  }

  return Object.freeze({
    request,
    requestStream,
    ensureCsrfToken: base.ensureCsrfToken,
    clearCsrfTokenCache: base.clearCsrfTokenCache
  });
}

export {
  createVibe64HttpClient,
  RECONNECT_WINDOW_MS,
  STOPPING_HEADER
};
