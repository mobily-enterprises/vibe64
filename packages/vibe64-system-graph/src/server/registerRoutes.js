import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

const SYSTEM_GRAPH_SERVICE_ID = "feature.vibe64-system-graph.service";

function systemGraphService(app) {
  return app.make(SYSTEM_GRAPH_SERVICE_ID);
}

function writeSystemSseEvent(rawReply, payload = {}) {
  const eventType = String(payload.type || "system-update.progress").replace(/[^A-Za-z0-9._-]/gu, "-");
  rawReply.write(`event: ${eventType}\n`);
  rawReply.write(`data: ${JSON.stringify(payload)}\n\n`);
}

async function sendSystemUpdateStream(reply, run) {
  if (!reply?.raw) {
    throw new Error("System update streams require a Fastify reply with raw stream access.");
  }
  reply.hijack?.();
  const rawReply = reply.raw;
  let closed = false;
  const markClosed = () => {
    closed = true;
  };
  rawReply.on?.("close", markClosed);
  rawReply.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });
  const heartbeat = setInterval(() => {
    if (!closed) {
      rawReply.write(": heartbeat\n\n");
    }
  }, 15000);
  heartbeat.unref?.();
  try {
    await run({
      emit: (payload) => {
        if (!closed) {
          writeSystemSseEvent(rawReply, payload);
        }
      },
      isClosed: () => closed
    });
  } catch (error) {
    if (!closed) {
      writeSystemSseEvent(rawReply, {
        error: {
          code: String(error?.code || "vibe64_system_update_stream_failed"),
          message: String(error?.message || error)
        },
        type: "system-update.stream-failed"
      });
    }
  } finally {
    clearInterval(heartbeat);
    rawReply.off?.("close", markClosed);
    if (!closed) {
      rawReply.end();
    }
  }
}

function registerRoutes(
  app,
  {
    projectContext = null,
    routeSurface = "",
    routeRelativePath = ""
  } = {}
) {
  const routes = createVibe64FeatureRoutes(app, {
    localRequestMessage: "Vibe64 System routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-system-graph"]
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/status", {
    summary: "Read current-state System availability and freshness for an active session."
  }, (request) => {
    return systemGraphService(app).readStatus({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/overview", {
    summary: "Read the current semantic System overview for an active session."
  }, (request) => {
    return systemGraphService(app).readOverview({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/entities/:entityKey", {
    summary: "Read one focused System entity and its immediate relationships."
  }, (request) => {
    return systemGraphService(app).readEntity({
      entityKey: request.params.entityKey,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/entities/:entityKey/evidence", {
    summary: "Read source evidence for one focused System entity."
  }, (request) => {
    return systemGraphService(app).readEntityEvidence({
      entityKey: request.params.entityKey,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/files/:fileKey/constellation", {
    summary: "Read a one-hop file, directory, import, and subsystem constellation."
  }, (request) => {
    return systemGraphService(app).readFileConstellation({
      fileKey: request.params.fileKey,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/findings", {
    summary: "Read spatial architecture findings for the current System model."
  }, (request) => {
    return systemGraphService(app).readFindings({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/system-graph/sessions/:sessionId/updates", {
    bodyLimit: 16 * 1024,
    summary: "Start a manual current-state System update."
  }, (request) => {
    return systemGraphService(app).startUpdate({
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/system-graph/sessions/:sessionId/updates/:updateId/stream", {
    summary: "Stream runtime-local progress for one manual System update."
  }, async (request, reply) => {
    await sendSystemUpdateStream(reply, ({ emit, isClosed }) => {
      return systemGraphService(app).streamUpdate({
        sessionId: request.params.sessionId,
        updateId: request.params.updateId
      }, {
        emit,
        isClosed
      });
    });
  });

  routes.serviceRoute("POST", "/system-graph/sessions/:sessionId/findings/:findingId/accept", {
    bodyLimit: 16 * 1024,
    summary: "Record an evidence-bound acceptance declaration for one current finding."
  }, (request) => {
    const body = routes.requestBody(request);
    return systemGraphService(app).acceptFinding({
      findingId: request.params.findingId,
      reason: body.reason,
      sessionId: request.params.sessionId
    });
  });
}

export {
  SYSTEM_GRAPH_SERVICE_ID,
  registerRoutes
};
