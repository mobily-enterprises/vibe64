import { attachDirectRequestActionExecutor } from "@jskit-ai/kernel/server/http";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { vibe64ProjectSessionsRoom, vibe64SessionViewersRoom } from "@local/vibe64-core/server/sessionRealtimeEvents";
import { PROJECT_WATCH, PROJECT_WATCH_RELEASE } from "../shared/projectWatch.js";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/realtime/server/types").RuntimeRealtime} RuntimeRealtime */
/** @typedef {import("./types.js").RepositoryUpdateProbe} RepositoryUpdateProbe */
/** @typedef {{ current: () => boolean, hold: (detach: () => void) => void, join: (room: string) => void }} WatchBinding */

const PROJECT_WATCH_ACTION = "vibe64.sessions.project.watch";

/**
 * A watch belongs to one authenticated browser connection. The action checks
 * the person's access to the project and decides what the watch holds: realtime
 * rooms and the project's update probe. The socket supplies only its lifetime.
 * @param {object} dependencies
 * @param {ActionCatalogue} dependencies.actions
 * @param {RuntimeRealtime} dependencies.realtime
 */
function registerProjectWatch({ actions, realtime }) {
  return realtime.onConnection(({ socket, readRequest }) => {
    const watches = new Map();
    // Several watches of one page may share a room, such as two views of one
    // session; the socket leaves it with the last of them.
    const roomHolders = new Map();
    let closed = false;
    function joinRoom(room) {
      roomHolders.set(room, (roomHolders.get(room) || 0) + 1);
      socket.join(room);
      return () => {
        const holders = roomHolders.get(room) - 1;
        if (holders > 0) {
          roomHolders.set(room, holders);
          return;
        }
        roomHolders.delete(room);
        socket.leave(room);
      };
    }
    function release(watchId) {
      const binding = watches.get(watchId);
      watches.delete(watchId);
      for (const detach of binding?.holds || []) detach();
    }
    async function watch(input, acknowledge) {
      const reply = typeof acknowledge === "function" ? acknowledge : () => {};
      if (closed) return;
      const watchId = typeof input?.watchId === "string" ? input.watchId : "";
      if (!watchId || watchId.length > 200) {
        reply({ ok: false, error: "A project watch needs an identity." });
        return;
      }
      release(watchId);
      const binding = { holds: [] };
      watches.set(watchId, binding);
      const current = () => !closed && socket.connected && watches.get(watchId) === binding;
      function hold(detach) {
        if (current()) binding.holds.push(detach);
        else detach();
      }
      try {
        const request = await readRequest();
        if (!current()) return;
        attachDirectRequestActionExecutor({ actions, request });
        const result = await request.executeAction({
          actionId: PROJECT_WATCH_ACTION,
          channel: "api",
          surface: "app",
          input: { projectSlug: input.projectSlug, ...(input.sessionId ? { sessionId: input.sessionId } : {}) },
          deps: { watchBinding: { current, hold, join: (room) => hold(joinRoom(room)) } }
        });
        if (current()) reply(result);
      } catch (error) {
        if (watches.get(watchId) === binding) release(watchId);
        if (!closed && socket.connected) {
          reply({ ok: false, error: Number(error?.statusCode || error?.status || 500) < 500
            ? error.message
            : "Vibe64 could not watch this project." });
        }
      }
    }
    function leave(input) {
      release(input?.watchId);
    }
    socket.on(PROJECT_WATCH, watch);
    socket.on(PROJECT_WATCH_RELEASE, leave);
    return () => {
      closed = true;
      socket.off(PROJECT_WATCH, watch);
      socket.off(PROJECT_WATCH_RELEASE, leave);
      for (const watchId of [...watches.keys()]) release(watchId);
    };
  });
}

/**
 * What one watch holds: the viewers room of the session it shows, or its
 * project's sessions room and update probe. A watch without a realtime
 * connection's binding is refused.
 * @param {RepositoryUpdateProbe} probe
 * @param {{ sessionId?: string }} input
 * @param {WatchBinding | undefined} binding
 */
function watchProject(probe, input, binding) {
  // readable-check: allow method-probe - input validation: the binding comes from the caller that executes the action
  if (typeof binding?.current !== "function" || typeof binding.hold !== "function" || typeof binding.join !== "function") {
    throw Object.assign(new Error("Watching a project requires a realtime connection."), {
      code: "vibe64_project_watch_connection_required", statusCode: 400
    });
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

export {
  PROJECT_WATCH_ACTION,
  registerProjectWatch,
  watchProject
};
