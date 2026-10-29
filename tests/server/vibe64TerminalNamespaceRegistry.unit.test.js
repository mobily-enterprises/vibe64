import assert from "node:assert/strict";
import test from "node:test";
import v8 from "node:v8";
import vm from "node:vm";

import {
  closeTerminalSessionsForNamespace,
  listTerminalSessions,
  readTerminalSession,
  stopTerminalSession,
  subscribeTerminalSession,
  updateTerminalSessionMetadata
} from "@local/vibe64-execution/server/terminalSessions";

v8.setFlagsFromString("--expose-gc");
const collectGarbage = vm.runInNewContext("gc");

function retainedHeapBytes() {
  collectGarbage();
  collectGarbage();
  return process.memoryUsage().heapUsed;
}

// Claude chat polling, output-terminal reads and session close all name a
// per-session namespace. Asking about one must not leave a record of it.
test("reading, stopping and closing a session's terminal namespaces retains nothing", async () => {
  const touch = async (index) => {
    for (const kind of ["claude", "output", "codex", "launch"]) {
      const namespace = `${kind}:project-scope:session-${index}`;
      listTerminalSessions({ namespace, runningOnly: true });
      readTerminalSession("missing", { namespace });
      updateTerminalSessionMetadata("missing", {}, { namespace });
      subscribeTerminalSession("missing", () => {}, { namespace });
      stopTerminalSession("missing", { namespace });
      await closeTerminalSessionsForNamespace(namespace);
    }
  };
  await touch("warm-up");
  const before = retainedHeapBytes();
  for (let index = 0; index < 20_000; index += 1) await touch(index);
  const retained = retainedHeapBytes() - before;
  // Before the fix every namespace kept an empty map: about 27 MB here.
  assert.ok(retained < 4 * 1024 * 1024, `terminal namespaces retained ${retained} bytes`);
});
