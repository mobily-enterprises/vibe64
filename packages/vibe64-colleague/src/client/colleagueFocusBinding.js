import { COLLEAGUE_FOCUS_RELEASE, COLLEAGUE_FOCUS_UPDATE } from "../shared/focusRealtime.js";

/**
 * Keeps the server's record of this browser's Colleague focus current over the
 * realtime socket: sent on every connect and on demand, released on close.
 * @param {object} options
 * @param {import("@jskit-ai/realtime/client/types").RealtimeSocket} options.socket
 * @param {() => { clientId: string, focus: object }} options.readFocus
 * @param {(message: string) => void} options.onError
 */
function createColleagueFocusBinding({
  socket,
  readFocus,
  onError
}) {
  let closed = false;
  let revision = 0;
  function update() {
    const expected = ++revision;
    if (closed || !socket.connected) return;
    socket.timeout(10_000).emit(COLLEAGUE_FOCUS_UPDATE, readFocus(), (error, result) => {
      if (closed || expected !== revision) return;
      if (error || result?.ok !== true) onError(error?.message || result?.error || "Colleague could not update this browser's focus.");
    });
  }
  function disconnected() { revision += 1; }
  function release() {
    revision += 1;
    if (socket.connected) socket.emit(COLLEAGUE_FOCUS_RELEASE, { clientId: readFocus().clientId });
  }
  function close() {
    closed = true;
    revision += 1;
    socket.off("connect", update);
    socket.off("disconnect", disconnected);
    release();
  }
  socket.on("connect", update);
  socket.on("disconnect", disconnected);
  return Object.freeze({
    update,
    release,
    close
  });
}

export { createColleagueFocusBinding };
