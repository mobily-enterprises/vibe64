import { serverStopBegun, VIBE64_SERVER_STOPPING_CODE } from "@local/vibe64-execution/server/serverStop";
import { endCommands } from "@local/vibe64-execution/server/commandSpawner";
import { killTerminalSessionsForNamespacePrefix } from "@local/vibe64-execution/server/terminalSessions";

// The editor's answers while its stop runs. The listener closes as the stop begins (stopAcceptingConnections), but a
// browser's kept-alive connection can still carry a request: it is answered at once, before any route runs or its
// body is read, with 503, `Connection: close` and the header below, which tells the page that nothing of it ran, so it
// may send it again, writes included, once the next server answers. An answer the stop lets finish closes its
// connection too, so the page's next request reaches the next server.

const STOPPING_HEADER = "x-vibe64-stopping";
// How long requests in flight, and the commands running as the stop began, have before they are ended. With the
// commands' grace after it the stop's own schedule takes about 440 ms of its one second, leaving the rest for a loaded
// machine: with 600 a busy editor stopped in about 690 ms alone and in over a second on a starved CPU.
const STOP_DRAIN_MS = 350;
// How long an ended command's process group has after SIGTERM before SIGKILL, and after SIGKILL.
const STOP_COMMAND_GRACE_MS = 75;

/**
 * Registers the gate on the server's root Fastify instance before any plugin or route, so it covers every route.
 * @param {import("fastify").FastifyInstance} app
 */
function registerStopGate(app) {
  app.addHook("onRequest", async (request, reply) => {
    if (!serverStopBegun()) return;
    reply.code(503)
      .header("connection", "close")
      .header("retry-after", "1")
      .header(STOPPING_HEADER, "1")
      .send({ ok: false, code: VIBE64_SERVER_STOPPING_CODE, error: "Vibe64 is restarting. It will answer again in a moment." });
    return reply;
  });
  app.addHook("onSend", async (request, reply, payload) => {
    if (serverStopBegun()) reply.header("connection", "close");
    return payload;
  });
}

/**
 * Stops the listener taking new connections and closes the idle kept-alive ones; requests in flight go on.
 * @param {import("node:http").Server | null | undefined} server
 */
function stopAcceptingConnections(server) {
  if (!server) return;
  try {
    // Node's close also closes the idle connections; its callback waits for the rest, which the stop's drain ends.
    server.close();
  } catch {
    // Not listening: nothing to stop.
  }
}

/** Ends the commands this process started that are still running (those started before `startedBefore`). */
function endRunningCommands(startedBefore = Infinity) {
  return endCommands({
    startedBefore,
    termTimeoutMs: STOP_COMMAND_GRACE_MS,
    killTimeoutMs: STOP_COMMAND_GRACE_MS
  });
}

/**
 * SIGKILL now to every runtime terminal's process group, as the stop's drain ends. Their closes begin with the stop,
 * with SIGTERM, but a close's own SIGKILL waits 3 s, which held two hosted editors' restarts past the stop's deadline
 * (26 Nov 2026), each recorded as a crash. Sent from the drain's own timer, it always comes before the deadline's, on
 * a starved CPU too. Returns how many it signalled.
 */
function killRuntimeTerminals() {
  return killTerminalSessionsForNamespacePrefix("");
}

export {
  STOPPING_HEADER,
  STOP_DRAIN_MS,
  endRunningCommands,
  killRuntimeTerminals,
  registerStopGate,
  stopAcceptingConnections
};
