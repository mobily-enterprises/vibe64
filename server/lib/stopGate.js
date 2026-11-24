import { serverStopBegun, VIBE64_SERVER_STOPPING_CODE } from "@local/vibe64-execution/server/serverStop";

// The editor's answers while its stop runs. The listener closes as the stop begins (stopAcceptingConnections), but a
// browser's kept-alive connection can still carry a request: it is answered at once, before any other hook, route or
// body is read, with 503, `Connection: close` and the header below, which tells the page that nothing of it ran, so it
// may send it again, writes included, once the next server answers. An answer the stop lets finish closes its
// connection too, so the page's next request reaches the next server.

const STOPPING_HEADER = "x-vibe64-stopping";

/**
 * Registers the gate. Called first on the server's root Fastify instance, so it covers every route.
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

export {
  STOPPING_HEADER,
  registerStopGate,
  stopAcceptingConnections
};
