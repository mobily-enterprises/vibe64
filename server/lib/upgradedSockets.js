// Node's closeAllConnections() closes only the connections its HTTP parser still owns. A connection upgraded to a
// WebSocket (a terminal, the realtime socket, a Preview socket a host proxies, any owner's) has left the parser, yet
// server.close() still waits for it, and a WebSocket's own close waits for its peer's answer, up to 30 seconds. On the
// FINAL canary's restart one open browser kept Fastify's close running past the 8-second stop deadline.
// Every upgraded connection is kept here from its upgrade, so the stop's drain ends it with the rest.

const UPGRADED_SOCKETS = Symbol("vibe64.upgradedSockets");

/**
 * Keeps each connection the server upgrades until it closes. Registered before any upgrade handler, so none is missed.
 * @param {import("node:http").Server} server
 */
function trackUpgradedSockets(server) {
  const sockets = new Set();
  Object.defineProperty(server, UPGRADED_SOCKETS, { value: sockets });
  server.prependListener("upgrade", (request, socket) => {
    sockets.add(socket);
    socket.once("close", () => sockets.delete(socket));
  });
}

/**
 * Ends every upgraded connection still open, whoever owns it.
 * @param {import("node:http").Server | null | undefined} server
 */
function destroyUpgradedSockets(server) {
  for (const socket of server?.[UPGRADED_SOCKETS] || []) socket.destroy();
}

export { destroyUpgradedSockets, trackUpgradedSockets };
