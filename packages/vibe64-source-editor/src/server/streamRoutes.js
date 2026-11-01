import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { requestBody, requestQuery } from "@local/vibe64-core/server/featureRoutes";
import { sendVibe64EventStream } from "@local/vibe64-core/server/eventStream";
import { VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT } from "@local/vibe64-core/server/sourceEditorRealtimeEvents";
import { explanationFollowupStreamSchema, explanationStreamSchema } from "./inputSchemas.js";
import { sourceInput } from "./routeInputs.js";

/** @typedef {import("./types.js").ActionRouteScope} ActionRouteScope */
/** @typedef {import("./types.js").SourceEditorService} SourceEditorService */

function writeSourceEditorStreamEvent(rawReply, payload = {}) {
  rawReply.write(`${JSON.stringify({
    ...payload,
    at: payload.at || new Date().toISOString()
  })}\n`);
}

async function sendSourceEditorNdjsonStream(reply, run) {
  if (!reply?.raw) {
    throw new Error("Source editor streams require a Fastify reply with raw stream access.");
  }

  // readable-check: allow optional-call - platform object: a reply stand-in without hijack() streams through raw directly
  reply.hijack?.();

  const rawReply = reply.raw;
  let closed = false;
  const markClosed = () => {
    closed = true;
  };

  // readable-check: allow optional-call - platform object: a raw reply stand-in may not emit close
  rawReply.on?.("close", markClosed);
  rawReply.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "X-Accel-Buffering": "no"
  });

  const heartbeat = setInterval(() => {
    if (!closed) {
      rawReply.write("\n");
    }
  }, 15000);
  heartbeat.unref();

  const emit = (payload = {}) => {
    if (!closed) {
      writeSourceEditorStreamEvent(rawReply, payload);
    }
  };

  try {
    await run({
      emit,
      isClosed: () => closed
    });
  } finally {
    clearInterval(heartbeat);
    // readable-check: allow optional-call - platform object: a raw reply stand-in may not emit close
    rawReply.off?.("close", markClosed);
    if (!closed) {
      rawReply.end();
    }
  }
}

/**
 * Streams validate the same selection fields an action would, before the
 * reply is hijacked, so a malformed request is an ordinary 400 response.
 * @param {object} request
 * @param {object} schema
 * @param {object} input
 */
function streamInput(request, schema, input) {
  return {
    ...validateSchemaPayload({ schema, mode: "create" }, sourceInput(request, input), {
      context: "Source explanation stream",
      statusCode: 400
    }),
    vibe64User: request.vibe64User
  };
}

/**
 * The open file's change stream and the explanation chat streams. Each stream
 * owns its callbacks and lifetime and calls one service stream method.
 * @param {ActionRouteScope} routes
 * @param {object} capabilities
 * @param {SourceEditorService} capabilities.sourceEditor
 */
function registerStreamRoutes(routes, { sourceEditor }) {
  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/changes/stream", {
    summary: "Stream changes to the source file currently open in a Vibe64 session."
  }, async (request, reply) => {
    const query = requestQuery(request);
    await sendVibe64EventStream(reply, ({ emit, isClosed, onClose }) => {
      return sourceEditor.streamFileChanges({
        path: query.path,
        sessionId: request.params.sessionId
      }, {
        emit,
        isClosed,
        onClose
      });
    }, {
      errorEvent: VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT,
      errorPayload: (error) => ({
        error: String(error?.message || error || "Source file observation failed."),
        fatal: true,
        path: String(query.path || ""),
        sessionId: request.params.sessionId
      })
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/stream", {
    bodyLimit: 256 * 1024,
    summary: "Stream a source explanation chat in a Vibe64 session."
  }, async (request, reply) => {
    const input = streamInput(request, explanationStreamSchema, requestBody(request));
    await sendSourceEditorNdjsonStream(reply, ({ emit, isClosed }) => (
      sourceEditor.streamExplanation(input, { emit, isClosed })
    ));
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/:explanationId/followups/stream", {
    bodyLimit: 128 * 1024,
    summary: "Stream a source explanation follow-up answer."
  }, async (request, reply) => {
    const input = streamInput(request, explanationFollowupStreamSchema, {
      ...requestBody(request),
      explanationId: request.params.explanationId
    });
    await sendSourceEditorNdjsonStream(reply, ({ emit, isClosed }) => (
      sourceEditor.streamExplanationFollowup(input, { emit, isClosed })
    ));
  });
}

export { registerStreamRoutes };
