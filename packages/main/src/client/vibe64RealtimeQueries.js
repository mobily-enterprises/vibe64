import { reconnectSocketIoClient } from "@jskit-ai/realtime/client/runtime";
import { editorReconnect } from "/src/lib/vibe64EditorReconnect.js";
import {
  invalidateVibe64LiveQueries
} from "/src/lib/vibe64LiveQueryRecovery.js";

/**
 * Refreshes the live Vibe64 queries each time the realtime socket connects again, and catches realtime up as soon
 * as the editor answers the page's requests again after it did not (it restarted): a socket that lost the editor
 * reconnects at once instead of after the rest of its backoff, and its connect refreshes the queries; a socket that
 * stayed connected through a longer gap refreshes them now. Returns the detach.
 * @param {{
 *   queryClient: import("@jskit-ai/kernel/client/types").ClientQueryClient,
 *   realtime: import("@jskit-ai/realtime/client/types").RealtimeClient,
 *   reconnect?: typeof editorReconnect
 * }} options
 */
function attachVibe64RealtimeQueryRecovery({ queryClient, realtime, reconnect = editorReconnect }) {
  const socket = realtime.socket;
  const recoverQueries = () => invalidateVibe64LiveQueries(queryClient);
  socket.on("connect", recoverQueries);
  const stopFollowingEditor = reconnect.subscribe((event) => {
    if (event.type !== "answered") return;
    if (!socket.connected) {
      reconnectSocketIoClient(socket);
    } else if (event.wasUpdating) {
      void recoverQueries();
    }
  });
  return () => {
    socket.off("connect", recoverQueries);
    stopFollowingEditor();
  };
}

export {
  attachVibe64RealtimeQueryRecovery,
  invalidateVibe64LiveQueries
};
