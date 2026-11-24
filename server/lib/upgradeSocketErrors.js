import { logOperationalEvent } from "@local/vibe64-core/server/logging";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

/**
 * Node takes its own error listener off a connection before it emits `upgrade`, and the connection has none until the
 * handler that takes it adds one. A WebSocket route's handler (ws) does so only at its handshake, after every Fastify
 * hook has run, a host's sign-in check among them, which waits on its store. A peer that resets the connection
 * meanwhile raises an `error` nobody handles, and that ends the whole editor (`read ECONNRESET`, "Unhandled 'error'
 * event" on a Socket). Every upgrade's connection gets this listener before any handler sees it: while no handler has
 * taken the connection its error is logged at warn, and the connection is destroyed either way.
 * @param {import("node:http").Server} server
 * @param {{ logger: RuntimeLogger }} options
 */
function handleUpgradeSocketErrors(server, { logger }) {
  server.prependListener("upgrade", (request, socket) => {
    // The path only: a query can carry a key, and the address is never parsed here, so no address throws.
    const path = String(request.url || "").split("?")[0];
    socket.on("error", (error) => {
      // A handler that took the connection added its own listener and handles the error itself.
      if (socket.listenerCount("error") === 1) {
        logOperationalEvent(logger, "warn", {
          component: "http-upgrade",
          event: "vibe64.server.upgrade_socket_error",
          error,
          path
        }, "A WebSocket connection failed before the editor took it; it was closed.");
      }
      socket.destroy();
    });
  });
}

export { handleUpgradeSocketErrors };
