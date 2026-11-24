import { serverStopBegun, VIBE64_SERVER_STOPPING_CODE } from "@local/vibe64-execution/server/serverStop";
import { endCaptures } from "@local/vibe64-execution/server";

// The editor's answers while its stop runs. The listener closes as the stop begins (stopAcceptingConnections), but a
// browser's kept-alive connection can still carry a request: it is answered at once, before any route runs or its
// body is read, with 503, `Connection: close` and the header below, which tells the page that nothing of it ran, so it
// may send it again, writes included, once the next server answers. An answer the stop lets finish closes its
// connection too, so the page's next request reaches the next server.

const STOPPING_HEADER = "x-vibe64-stopping";
// How long requests in flight, and the commands running as the stop began, have before they are ended.
const STOP_DRAIN_MS = 600;
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
  return endCaptures({
    startedBefore,
    termTimeoutMs: STOP_COMMAND_GRACE_MS,
    killTimeoutMs: STOP_COMMAND_GRACE_MS
  });
}

export {
  STOPPING_HEADER,
  STOP_DRAIN_MS,
  endRunningCommands,
  registerStopGate,
  stopAcceptingConnections
};
