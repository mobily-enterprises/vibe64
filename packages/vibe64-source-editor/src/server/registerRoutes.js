import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { sendVibe64EventStream } from "@local/vibe64-core/server/eventStream";
import {
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";

function writeSourceEditorStreamEvent(rawReply, payload = {}) {
  rawReply.write(`${JSON.stringify({
    ...payload,
    at: payload.at || new Date().toISOString()
  })}\n`);
}

function withVibe64User(request, input = {}) {
  const {
    vibe64User: _ignoredVibe64User,
    ...safeInput
  } = input || {};
  void _ignoredVibe64User;
  return request.vibe64User
    ? {
        ...safeInput,
        vibe64User: request.vibe64User
      }
    : safeInput;
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

async function sendFileDownload(reply, result) {
  if (!result.ok) {
    return result;
  }
  const encodedName = encodeURIComponent(result.name).replace(/[!'()*]/gu, (character) =>
    `%${character.codePointAt(0).toString(16).toUpperCase()}`);
  try {
    // An async handler must stay pending until Fastify has sent the file stream.
    await reply.header("Content-Type", "application/octet-stream")
      .header("Content-Disposition", `attachment; filename*=UTF-8''${encodedName}`)
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .send(result.fileHandle.createReadStream({ autoClose: true }));
  } catch (error) {
    await result.fileHandle.close();
    throw error;
  }
}

function registerRoutes(
  http,
  {
    publishFileChanged = async () => null,
    projectContext = null,
    routeSurface = "",
    routeRelativePath = "",
    sourceEditor
  } = {}
) {
  if (!sourceEditor || typeof sourceEditor.readTree !== "function") {
    throw new TypeError("registerRoutes requires the Vibe64 Source Editor API.");
  }
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 source editor routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-source-editor"]
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/files", {
    summary: "Read the file areas available to this caller for this session."
  }, (request) => sourceEditor.fileArea({ sessionId: request.params.sessionId }, "areas"));

  // One registration boundary for all areas: select only relative paths and
  // operation data; identity/project/root are resolved by the trusted context.
  for (const [method, suffix, operation] of [
    ["GET", "tree", "tree"],
    ["GET", "file", "file"],
    ["GET", "download", "download"],
    ["GET", "archive", "archive"],
    ["POST", "upload", "upload"],
    ["PUT", "file", "save"],
    ["POST", "rename", "rename"],
    ["POST", "directory", "mkdir"],
    ["DELETE", "file", "delete"]
  ]) {
    routes.serviceRoute(method, `/sessions/:sessionId/files/:area/${suffix}`, {
      bodyLimit: operation === "upload" ? 101 * 1024 * 1024 : 2 * 1024 * 1024,
      summary: "Access files within an authorized session area."
    }, async (request, reply) => {
      const data = method === "GET" || operation === "upload"
        ? routes.requestQuery(request)
        : routes.requestBody(request);
      const result = await sourceEditor.fileArea({
        area: request.params.area,
        sessionId: request.params.sessionId,
        path: data.path,
        offset: data.offset,
        destination: data.destination,
        baseHash: data.baseHash,
        text: data.text
      }, operation, {
        readUpload: () => request.parts({
          throwFileSizeLimit: true,
          limits: { files: 1, fields: 0, parts: 1, fileSize: 100 * 1024 * 1024 }
        })
      });
      if (operation === "download" || operation === "archive") return sendFileDownload(reply, result);
      return result;
    });
  }

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/tree", {
    summary: "Read the editable source tree for a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditor.readTree({
      limit: query.limit,
      offset: query.offset,
      path: query.path,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/changes/stream", {
    summary: "Stream changes to the source file currently open in a Vibe64 session."
  }, async (request, reply) => {
    const query = routes.requestQuery(request);
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

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/files", {
    summary: "Find editable source files in a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditor.listFiles({
      limit: query.limit,
      query: query.q,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/download", {
    summary: "Download a file from the selected session source."
  }, async (request, reply) => {
    const result = await sourceEditor.downloadFile({
      sessionId: request.params.sessionId,
      path: routes.requestQuery(request).path
    });
    return sendFileDownload(reply, result);
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/stars", {
    summary: "Read this account's starred files for the current project."
  }, (request) => sourceEditor.readStarredFiles(withVibe64User(request, { sessionId: request.params.sessionId })));

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/stars", {
    bodyLimit: 16 * 1024,
    summary: "Star or unstar one file for this account and project."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditor.setStarredFile(withVibe64User(request, {
      sessionId: request.params.sessionId,
      path: body.path,
      starred: body.starred
    }));
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/search", {
    summary: "Search editable source files in a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditor.search({
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
    return sourceEditor.resolvePath({
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
    return sourceEditor.explainSelection(withVibe64User(request, {
      endColumn: body.endColumn,
      endLine: body.endLine,
      force: body.force === true,
      originId: body.originId,
      path: body.path,
      sessionId: request.params.sessionId,
      startColumn: body.startColumn,
      startLine: body.startLine
    }));
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/stream", {
    bodyLimit: 256 * 1024,
    summary: "Stream a source explanation chat in a Vibe64 session."
  }, async (request, reply) => {
    const body = routes.requestBody(request);
    await sendSourceEditorNdjsonStream(reply, ({ emit, isClosed }) => {
      return sourceEditor.streamExplanation(withVibe64User(request, {
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
      }), {
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
    return sourceEditor.cleanupExplanations(withVibe64User(request, {
      activeExplanationIds: body.activeExplanationIds,
      originId: body.originId,
      sessionId: request.params.sessionId
    }));
  });

  routes.serviceRoute("DELETE", "/sessions/:sessionId/source-editor/explanations/:explanationId", {
    summary: "Dispose a temporary source explanation chat in a Vibe64 session."
  }, (request) => {
    return sourceEditor.deleteExplanation(withVibe64User(request, {
      explanationId: request.params.explanationId,
      sessionId: request.params.sessionId
    }));
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/:explanationId/stop", {
    summary: "Stop a running temporary source explanation chat."
  }, (request) => {
    return sourceEditor.stopExplanation(withVibe64User(request, {
      explanationId: request.params.explanationId,
      sessionId: request.params.sessionId
    }));
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/:explanationId/followups", {
    bodyLimit: 128 * 1024,
    summary: "Add a follow-up question to a temporary source explanation chat."
  }, (request) => {
    const body = routes.requestBody(request);
    return sourceEditor.addExplanationFollowup(withVibe64User(request, {
      explanationId: request.params.explanationId,
      message: body.message,
      sessionId: request.params.sessionId
    }));
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/explanations/:explanationId/followups/stream", {
    bodyLimit: 128 * 1024,
    summary: "Stream a source explanation follow-up answer."
  }, async (request, reply) => {
    const body = routes.requestBody(request);
    await sendSourceEditorNdjsonStream(reply, ({ emit, isClosed }) => {
      return sourceEditor.streamExplanationFollowup(withVibe64User(request, {
        assistantMessageId: body.assistantMessageId,
        explanationId: request.params.explanationId,
        message: body.message,
        sessionId: request.params.sessionId,
        userMessageId: body.userMessageId
      }), {
        emit,
        isClosed
      });
    });
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/file", {
    summary: "Read an editable source file from a Vibe64 session."
  }, (request) => {
    const query = routes.requestQuery(request);
    return sourceEditor.readFile({
      path: query.path,
      sessionId: request.params.sessionId
    });
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/source-editor/file", {
    bodyLimit: 32 * 1024,
    summary: "Create a new editable source file in a Vibe64 session."
  }, async (request) => {
    const body = routes.requestBody(request);
    const result = await sourceEditor.createFile({
      originId: body.originId,
      path: body.path,
      projectSlug: body.projectSlug,
      sessionId: request.params.sessionId
    });
    await publishFileChanged(result, {
      operation: "created"
    });
    return result;
  });

  routes.serviceRoute("PUT", "/sessions/:sessionId/source-editor/file", {
    bodyLimit: 2 * 1024 * 1024,
    summary: "Autosave an editable source file in a Vibe64 session."
  }, async (request) => {
    const body = routes.requestBody(request);
    const result = await sourceEditor.saveFile({
      baseHash: body.baseHash,
      originId: body.originId,
      path: body.path,
      projectSlug: body.projectSlug,
      sessionId: request.params.sessionId,
      text: body.text
    });
    await publishFileChanged(result);
    return result;
  });
}

export { registerRoutes };
