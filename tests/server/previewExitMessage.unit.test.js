// A Preview whose process exits says why in its own message, the one the Preview pane and `preview status` show: its
// exit code and the last error line it printed, so a port already in use reads as that, not as a bare exit code.
import assert from "node:assert/strict";
import test from "node:test";

import { previewExitMessage } from "../../packages/vibe64-terminals/src/server/launchPreviewStatus.js";

// What Node prints when a server's port is taken: the error line, then its stack, the emitter and the error's fields.
const NODE_PORT_TAKEN = `node:events:486
      throw er; // Unhandled 'error' event
      ^

Error: listen EADDRINUSE: address already in use 127.0.0.1:4103
    at Server.setupListenHandle [as _listen2] (node:net:1940:16)
    at listenInCluster (node:net:1997:12)
Emitted 'error' event on Server instance at:
    at emitErrorNT (node:net:1976:8) {
  code: 'EADDRINUSE',
  errno: -98,
  syscall: 'listen',
  address: '127.0.0.1',
  port: 4103
}

Node.js v26.5.0
`;

test("a failed Preview's message quotes the last error line its process printed, in one short sentence", () => {
  assert.equal(previewExitMessage(1, NODE_PORT_TAKEN),
    "The preview process exited with code 1: listen EADDRINUSE: address already in use 127.0.0.1:4103.");
  // The latest error is the one quoted, its colours removed and any other label kept.
  assert.equal(previewExitMessage(1, "Error: first\nstarting\n\u001b[31mTypeError: config.port is not a function\u001b[39m\n"),
    "The preview process exited with code 1: TypeError: config.port is not a function.");
  assert.equal(previewExitMessage(2, "vite v6\nerror: Cannot find module 'vue'.\n"),
    "The preview process exited with code 2: error: Cannot find module 'vue'.");
  assert.equal(previewExitMessage(1, `Error: ${"x".repeat(300)}`), `The preview process exited with code 1: ${"x".repeat(200)}.`);
  // Without an error line, or output, the exit code alone.
  assert.equal(previewExitMessage(1, "Server starting\nErrors found: 0\nEmitted 'error' event\n"),
    "The preview process exited with code 1.");
  assert.equal(previewExitMessage(null, ""), "The preview process exited with code unknown.");
});
