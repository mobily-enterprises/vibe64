// The editor server's stop, as everything in its process sees it: one moment, when server.js's stop signal handler
// begins, after which nothing starts new work. The command gateway refuses every command from then on, and work that
// runs on its own schedule (a host's resource controller, the AI engines' closing fences, the planned-stop record)
// begins its own stop at that moment instead of when the capability runtime's reverse order reaches its provider.
// On release 10's move of mercmobily (24 Nov 2026) the old editor went on starting helper calls for 1.1 s after
// SIGTERM and took 3.33 s to stop.
//
// One process runs one editor server at a time; each server's start resets the stop (resetServerStop), so a process
// that runs several servers one after another, as tests do, starts each of them unstopped.

const STOPPING_CODE = "vibe64_server_stopping";
const listeners = new Set();
let controller = new AbortController();
let begun = false;

function stoppingError(reason) {
  return Object.assign(new Error("Vibe64 is stopping."), { code: STOPPING_CODE, reason });
}

/**
 * Begins the server's stop: the signal aborts and every listener runs, synchronously, once. Only server.js's stop
 * signal handler calls it. A listener's failure is logged, never thrown.
 * @param {string} [reason] the stop signal, such as SIGTERM
 * @param {{ logger?: { error?: Function } | null }} [options]
 * @returns {boolean} whether this call began it
 */
function beginServerStop(reason = "server-shutdown", { logger = null } = {}) {
  if (begun) return false;
  begun = true;
  controller.abort(stoppingError(String(reason || "server-shutdown")));
  for (const listener of [...listeners]) {
    try {
      listener(reason);
    } catch (error) {
      try {
        logger?.error?.({
          component: "server-lifecycle",
          event: "vibe64.server.stop_listener_failed",
          error
        }, "A listener of the server's stop failed as the stop began.");
      } catch {
        // Diagnostic only.
      }
    }
  }
  return true;
}

/**
 * Calls `listener` once, as the server's stop begins, or at once when it has begun already. Listeners run
 * synchronously and must not wait: they refuse new work or start their own stop and return.
 * @param {(reason: string) => void} listener
 * @returns {() => void} unsubscribes it
 */
function onServerStopBegins(listener) {
  if (typeof listener !== "function") throw new TypeError("A server stop listener must be a function.");
  if (begun) {
    listener(controller.signal.reason?.reason || "server-shutdown");
    return () => {};
  }
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** Whether the server's stop has begun. */
function serverStopBegun() {
  return begun;
}

/** An AbortSignal aborted, with code vibe64_server_stopping, as the server's stop begins. */
function serverStopSignal() {
  return controller.signal;
}

/** A new server starts unstopped; listeners stay subscribed until they unsubscribe. */
function resetServerStop() {
  begun = false;
  controller = new AbortController();
}

export {
  STOPPING_CODE as VIBE64_SERVER_STOPPING_CODE,
  beginServerStop,
  onServerStopBegins,
  resetServerStop,
  serverStopBegun,
  serverStopSignal
};
