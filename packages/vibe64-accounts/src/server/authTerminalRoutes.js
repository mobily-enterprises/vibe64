import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeFastify} RuntimeFastify */
/** @typedef {import("./types.js").AccountsService} AccountsService */
/** @typedef {import("./types.js").StudioProjectContext} StudioProjectContext */

/**
 * A sign-in terminal's input as the socket's signed-in person.
 * @param {object} request
 * @param {string} terminalSessionId
 */
function authTerminalInput(request, terminalSessionId) {
  if (!request.vibe64User) {
    return { sessionId: terminalSessionId };
  }
  return {
    sessionId: terminalSessionId,
    vibe64User: request.vibe64User
  };
}

/**
 * One scope's sign-in terminal socket: it streams the terminal and passes keystrokes and size changes back.
 * @param {RuntimeFastify} fastify
 * @param {object} options
 * @param {AccountsService} options.accounts
 * @param {StudioProjectContext} options.projectContext
 * @param {boolean} options.projectScoped
 * @param {string} options.routePath
 */
function registerAuthTerminalSocket(fastify, { accounts, projectContext, projectScoped, routePath }) {
  registerTerminalWebSocketRoute(fastify, {
    projectContext,
    projectScoped,
    resize(service, { cols, request, rows, terminalSessionId }) {
      return service.resizeAuthTerminal(authTerminalInput(request, terminalSessionId), {
        cols,
        rows
      });
    },
    routePath,
    service: accounts,
    subscribe(service, { request, subscriber, terminalSessionId }) {
      return service.subscribeAuthTerminal(authTerminalInput(request, terminalSessionId), subscriber);
    },
    write(service, { data, request, terminalSessionId }) {
      return service.writeAuthTerminal(authTerminalInput(request, terminalSessionId), data);
    }
  });
}

/**
 * The sign-in terminal sockets, in the project scope and outside any project.
 * @param {RuntimeFastify} fastify
 * @param {object} capabilities
 * @param {AccountsService} capabilities.accounts
 * @param {StudioProjectContext} capabilities.projectContext
 */
function registerAuthTerminalRoutes(fastify, { accounts, projectContext }) {
  registerAuthTerminalSocket(fastify, {
    accounts,
    projectContext,
    projectScoped: true,
    routePath: "/api/app/:slug/vibe64/accounts/auth/:terminalSessionId/ws"
  });
  registerAuthTerminalSocket(fastify, {
    accounts,
    projectContext,
    projectScoped: false,
    routePath: "/api/vibe64/accounts/auth/:terminalSessionId/ws"
  });
}

export { registerAuthTerminalRoutes };
