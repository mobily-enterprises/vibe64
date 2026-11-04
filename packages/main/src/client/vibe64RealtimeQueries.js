import {
  invalidateVibe64LiveQueries
} from "/src/lib/vibe64LiveQueryRecovery.js";

/**
 * Refreshes the live Vibe64 queries each time the realtime socket connects again; returns the detach.
 * @param {{
 *   queryClient: import("@jskit-ai/kernel/client/types").ClientQueryClient,
 *   realtime: import("@jskit-ai/realtime/client/types").RealtimeClient
 * }} options
 */
function attachVibe64RealtimeQueryRecovery({ queryClient, realtime }) {
  const socket = realtime.socket;
  const recoverQueries = () => invalidateVibe64LiveQueries(queryClient);
  socket.on("connect", recoverQueries);
  return () => socket.off("connect", recoverQueries);
}

export {
  attachVibe64RealtimeQueryRecovery,
  invalidateVibe64LiveQueries
};
