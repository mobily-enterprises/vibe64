import { vibe64Error } from "@local/vibe64-core/server/core";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { vibe64ProjectSessionsRoom, vibe64SessionViewersRoom } from "@local/vibe64-core/server/sessionRealtimeEvents";

/** @typedef {import("./types.js").RepositoryUpdateProbe} RepositoryUpdateProbe */
/** @typedef {import("./types.js").WatchBinding} WatchBinding */

/**
 * The repository updates capability: the update probe, the browser page
 * watches that keep it running, and close(), which stops the project watches
 * and the probe.
 * @param {object} dependencies
 * @param {() => void} dependencies.closeWatches
 * @param {RepositoryUpdateProbe} dependencies.probe
 */
function createRepositoryUpdates({ closeWatches, probe }) {
  /**
   * What one watch holds: the viewers room of the session it shows, or its
   * project's sessions room and update probe. A watch without its realtime
   * connection's binding in the context is refused.
   * @param {{ sessionId?: string }} input
   * @param {{ watchBinding?: WatchBinding }} context
   */
  function watchProject(input, context) {
    const binding = context.watchBinding;
    // readable-check: allow method-probe - input validation: the binding comes from the caller that executes the action
    if (typeof binding?.current !== "function" || typeof binding.hold !== "function" || typeof binding.join !== "function") {
      throw vibe64Error("Watching a project requires a realtime connection.", "vibe64_project_watch_connection_required", { status: 400 });
    }
    if (!binding.current()) return { ok: true };
    const slug = currentProjectRequestContext()?.slug;
    const { sessionId = "" } = input;
    if (sessionId) {
      binding.join(vibe64SessionViewersRoom(slug, sessionId));
    } else {
      binding.join(vibe64ProjectSessionsRoom(slug));
      binding.hold(probe.watch(slug));
    }
    return { ok: true };
  }

  function close() {
    closeWatches();
    probe.close();
  }

  return Object.freeze({
    probe,
    watchProject,
    close
  });
}

export { createRepositoryUpdates };
