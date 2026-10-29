import { onScopeDispose, watch } from "vue";
import { useRealtimeSocket } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { PROJECT_WATCH, PROJECT_WATCH_RELEASE } from "@local/vibe64-sessions/shared/project-watch";

// Session changes reach only the pages that watch them: a page watching its
// project receives summaries of every session's changes, and a page watching
// one session receives that session's changes in full (vibe64-core's
// sessionRealtimeEvents.js). The watch lasts as long as the calling scope, in
// a visible or a background tab; a lost connection forgets it, so it is
// renewed on reconnect. With `sessionId`, the watch is of that session only,
// and is held while the session id is known.
function useVibe64ProjectWatch({ projectSlug, sessionId = null } = {}) {
  const socket = useRealtimeSocket();
  const watchId = globalThis.crypto.randomUUID();
  let disposed = false;
  let watchedKey = "";
  function target() {
    const slug = disposed ? "" : String(readRefOrGetterValue(projectSlug) || "").trim();
    if (sessionId === null) {
      return slug ? { projectSlug: slug } : null;
    }
    const session = String(readRefOrGetterValue(sessionId) || "").trim();
    return slug && session ? { projectSlug: slug, sessionId: session } : null;
  }
  function sync({ reconnected = false } = {}) {
    const next = target();
    const key = next ? JSON.stringify(next) : "";
    if (key === watchedKey && !reconnected) {
      return;
    }
    if (watchedKey && !key && socket.connected) {
      socket.emit(PROJECT_WATCH_RELEASE, { watchId });
    }
    watchedKey = key;
    if (next && socket.connected) {
      socket.emit(PROJECT_WATCH, { watchId, ...next });
    }
  }
  const watchAfterReconnect = () => sync({ reconnected: true });
  socket.on("connect", watchAfterReconnect);
  watch(() => target(), () => sync(), { immediate: true });
  onScopeDispose(() => {
    disposed = true;
    socket.off("connect", watchAfterReconnect);
    sync();
  });
}

export { useVibe64ProjectWatch };
