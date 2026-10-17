import { COLLEAGUE_FOCUS_RELEASE, COLLEAGUE_FOCUS_UPDATE } from "../shared/focusRealtime.js";

function createColleagueFocusBinding({ socket, readFocus, onError }) {
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
  socket.on("connect", update);
  socket.on("disconnect", disconnected);
  return { update, release, close() {
    closed = true;
    revision += 1;
    socket.off("connect", update);
    socket.off("disconnect", disconnected);
    release();
  } };
}

export { createColleagueFocusBinding };
