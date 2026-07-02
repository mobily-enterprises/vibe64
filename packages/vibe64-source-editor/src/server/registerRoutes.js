import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

const SOURCE_EDITOR_SERVICE_ID = "feature.vibe64-source-editor.service";

function sourceEditorService(app) {
  return app.make(SOURCE_EDITOR_SERVICE_ID);
}

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
    "Content-Type": "application/x-ndjson; charset=utf-8",
    "X-Accel-Buffering": "no"
  });

  const heartbeat = setInterval(() => {
    if (!closed) {
      rawReply.write("\n");
    }
  }, 15000);
  heartbeat.unref?.();

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
    localRequestMessage: "Vibe64 source editor routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-source-editor"]
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/tree", {
    summary: "Read the editable source tree for a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditorService(app).readTree({
      limit: query.limit,
      offset: query.offset,
      path: query.path,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/files", {
    summary: "Find editable source files in a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditorService(app).listFiles({
      limit: query.limit,
      query: query.q,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/search", {
    summary: "Search editable source files in a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditorService(app).search({
      limit: query.limit,
      query: query.q,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/resolve-path", {
    bodyLimit: 32 * 1024,
    summary: "Resolve a source path reference relative to an editable session file."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).resolvePath({
      fromPath: body.fromPath,
      sessionId: request.params.sessionId,
      target: body.target
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations", {
    bodyLimit: 256 * 1024,
    summary: "Explain a selected source range in a Vibe64 session."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).explainSelection({
      agentSettings: body.agentSettings,
      endColumn: body.endColumn,
      endLine: body.endLine,
      force: body.force === true,
      originId: body.originId,
      path: body.path,
      sessionId: request.params.sessionId,
      startColumn: body.startColumn,
      startLine: body.startLine
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/stream", {
    bodyLimit: 256 * 1024,
    summary: "Stream a source explanation chat in a Vibe64 session."
  }, async (request, reply) => {
    const body = routes.requestBody(request);
    await sendSourceEditorNdjsonStream(reply, ({ emit, isClosed }) => {
      return sourceEditorService(app).streamExplanation({
        agentSettings: body.agentSettings,
        assistantMessageId: body.assistantMessageId,
        endColumn: body.endColumn,
        endLine: body.endLine,
        explanationId: body.explanationId,
        force: body.force === true,
        originId: body.originId,
        path: body.path,
        scope: body.scope,
        sessionId: request.params.sessionId,
        startColumn: body.startColumn,
        startLine: body.startLine,
        userMessageId: body.userMessageId
      }, {
        emit,
        isClosed
      });
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/cleanup", {
    bodyLimit: 16 * 1024,
    summary: "Clean abandoned temporary source explanation chats in a Vibe64 session."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).cleanupExplanations({
      activeExplanationIds: body.activeExplanationIds,
      originId: body.originId,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("DELETE", "/sessions/:sessionId/source-editor/explanations/:explanationId", {
    summary: "Dispose a temporary source explanation chat in a Vibe64 session."
  }, (request) => {
    return sourceEditorService(app).deleteExplanation({
      explanationId: request.params.explanationId,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/:explanationId/stop", {
    summary: "Stop a running temporary source explanation chat."
  }, (request) => {
    return sourceEditorService(app).stopExplanation({
      explanationId: request.params.explanationId,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/:explanationId/followups", {
    bodyLimit: 128 * 1024,
    summary: "Add a follow-up question to a temporary source explanation chat."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).addExplanationFollowup({
      agentSettings: body.agentSettings,
      explanationId: request.params.explanationId,
      message: body.message,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/:explanationId/followups/stream", {
    bodyLimit: 128 * 1024,
    summary: "Stream a source explanation follow-up answer."
  }, async (request, reply) => {
    const body = routes.requestBody(request);
    await sendSourceEditorNdjsonStream(reply, ({ emit, isClosed }) => {
      return sourceEditorService(app).streamExplanationFollowup({
        agentSettings: body.agentSettings,
        assistantMessageId: body.assistantMessageId,
        explanationId: request.params.explanationId,
        message: body.message,
        sessionId: request.params.sessionId,
        userMessageId: body.userMessageId
      }, {
        emit,
        isClosed
      });
    });
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/file", {
    summary: "Read an editable source file from a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditorService(app).readFile({
      path: query.path,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/file", {
    bodyLimit: 32 * 1024,
    summary: "Create a new editable source file in a Vibe64 session."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).createFile({
      originId: body.originId,
      path: body.path,
      projectSlug: body.projectSlug,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/open-file", {
    bodyLimit: 32 * 1024,
    summary: "Broadcast the selected source file for a Vibe64 session."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).broadcastOpenFile({
      originId: body.originId,
      path: body.path,
      projectSlug: body.projectSlug,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("PUT", "/sessions/:sessionId/source-editor/file", {
    bodyLimit: 2 * 1024 * 1024,
    summary: "Autosave an editable source file in a Vibe64 session."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditorService(app).saveFile({
      baseHash: body.baseHash,
      originId: body.originId,
      path: body.path,
      projectSlug: body.projectSlug,
      sessionId: request.params.sessionId,
      text: body.text
    });
  });
}

export { registerRoutes };
