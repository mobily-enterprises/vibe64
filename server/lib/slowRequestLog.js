import { logOperationalEvent } from "@local/vibe64-core/server/logging";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

// The edge in front of a hosted editor ends a request after a minute; an answer later than this is already close
// enough to it to name.
const SLOW_ANSWER_MS = 5_000;
const STARTED = Symbol("vibe64.request.startedAt");

/**
 * Every request's wait is visible from its arrival. An answer that starts later than `slowMs` after its request
 * arrived is logged at warn with its method, route template, status and elapsed time; a request whose client
 * closed before its answer (the edge's minute, a closed page) is logged at warn the same way. Neither names the
 * request's query, which can carry a key, nor its concrete path, only its route template. On 24 Nov 2026 a chat send
 * waited inside its request for the workspace preparation, the edge ended it with a 504, and the editor's log had no
 * line about it.
 * @param {import("fastify").FastifyInstance} fastify
 * @param {{ logger?: RuntimeLogger, slowMs?: number }} [options]
 */
function registerSlowRequestLog(fastify, { logger = fastify.log, slowMs = SLOW_ANSWER_MS } = {}) {
  const log = (event, request, fields, message) => {
    try {
      logOperationalEvent(logger, "warn", {
        component: "http",
        event,
        method: request.method,
        route: request.routeOptions?.url || "(no route)",
        ...fields
      }, message);
    } catch {
      // Timing is diagnostic only.
    }
  };
  fastify.addHook("onRequest", async (request, reply) => {
    request[STARTED] = performance.now();
    // A WebSocket upgrade has no HTTP answer to wait for.
    if (request.raw.headers.upgrade) return;
    // The answer's own connection says when its client left: Fastify's onRequestAbort follows the request stream,
    // which may not report it once the body was read, as for every POST.
    reply.raw.once("close", () => {
      if (reply.raw.headersSent) return;
      log(
        "vibe64.server.request_abandoned",
        request,
        { elapsedMs: Math.round(performance.now() - request[STARTED]) },
        "A request's client closed before its answer, measured from its arrival."
      );
    });
  });
  fastify.addHook("onSend", async (request, reply, payload) => {
    const elapsedMs = Math.round(performance.now() - (request[STARTED] ?? performance.now()));
    if (elapsedMs >= slowMs) {
      log(
        "vibe64.server.slow_answer",
        request,
        { statusCode: reply.statusCode, elapsedMs },
        "A request was answered late, measured from its arrival."
      );
    }
    return payload;
  });
}

export { registerSlowRequestLog, SLOW_ANSWER_MS };
