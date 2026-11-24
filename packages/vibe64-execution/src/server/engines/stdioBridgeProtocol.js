// What the stdio bridge (stdioBridge.js) and its editor side (stdioBridgeClient.js) say to each other beyond the native
// process's own bytes. The first connection carries only those bytes. A reconnect, which the bridge waits for only
// after a drop with a handover file beside its socket, opens with one line naming the output offset it has; the bridge
// answers with one line, then replays from that offset.

/** The handover file beside the bridge's socket: `{ waitMs }`, written as the editor's planned stop begins. */
const STDIO_BRIDGE_HANDOVER_FILE = "handover";
/** How long a handover may make the bridge wait for its reconnect, at most. */
const STDIO_BRIDGE_MAX_WAIT_MS = 60_000;
/** A reconnect's first line: `vibe64-stdio-resume <offset>`. */
const STDIO_BRIDGE_RESUME = "vibe64-stdio-resume";
/** The bridge's answer when it replays from the offset. */
const STDIO_BRIDGE_RESUMED = "vibe64-stdio-resumed";
/** The bridge's answer when it cannot (`vibe64-stdio-refused <reason>`); it then ends its process group. */
const STDIO_BRIDGE_REFUSED = "vibe64-stdio-refused";
/** The longest first line a reconnect may send. */
const STDIO_BRIDGE_RESUME_LINE_BYTES = 64;

export {
  STDIO_BRIDGE_HANDOVER_FILE,
  STDIO_BRIDGE_MAX_WAIT_MS,
  STDIO_BRIDGE_REFUSED,
  STDIO_BRIDGE_RESUME,
  STDIO_BRIDGE_RESUMED,
  STDIO_BRIDGE_RESUME_LINE_BYTES
};
