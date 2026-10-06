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

function sourceInput(request, input = {}) {
  const { vibe64User: _ignoredUser, ...data } = input;
  return { ...data, sessionId: request.params.sessionId };
}

function registerRoutes(http, {
  projectContext = null, routeSurface = "", routeRelativePath = "", sourceEditor
} = {}) {
  if (!sourceEditor || typeof sourceEditor.readTree !== "function") {
    throw new TypeError("registerRoutes requires the Vibe64 Source Editor API.");
  }
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 source editor routes only accept loopback Studio requests.",
    projectContext, routeRelativePath, routeSurface, tags: ["studio", "vibe64-source-editor"]
  });
  const route = (method, suffix, operation, options = {}, buildInput = (request) => sourceInput(request)) => routes.actionRoute(
    method, `/sessions/:sessionId${suffix}`, { ...options, actionId: `vibe64.source-editor.${operation}`, buildInput }
  );
  const body = (request) => sourceInput(request, routes.requestBody(request));
  const query = (request) => sourceInput(request, routes.requestQuery(request));
  const searched = (request) => {
    const query = routes.requestQuery(request);
    const { q, ...rest } = query;
    return sourceInput(request, { ...rest, ...(Object.hasOwn(query, "q") ? { query: q } : {}) });
  };
  const areaQuery = (request, operation) => {
    const query = routes.requestQuery(request);
    // As with the original Files boundary, only operation fields enter the action.
    // Identity and area come from the authenticated request and route.
    return sourceInput(request, {
      area: request.params.area,
      ...(Object.hasOwn(query, "path") ? { path: query.path } : {}),
      ...(operation === "tree" && Object.hasOwn(query, "offset") ? { offset: query.offset } : {})
    });
  };
  route("GET", "/files", "file-areas.read", { summary: "Read the session file areas available to this caller." });
  for (const [method, suffix, operation] of [
    ["GET", "tree", "tree"], ["GET", "file", "file"], ["PUT", "file", "save"],
    ["POST", "rename", "rename"], ["POST", "directory", "mkdir"], ["DELETE", "file", "delete"]
  ]) route(method, `/files/:area/${suffix}`, `file-area.${operation}`, {
    bodyLimit: 2 * 1024 * 1024, summary: "Access files within an authorized session area."
  }, (request) => method === "GET" ? areaQuery(request, operation)
    : sourceInput(request, { ...routes.requestBody(request), area: request.params.area }));

  // Binary and multipart framing stays at HTTP; the domain operation is shared.
  for (const operation of ["download", "archive"]) routes.serviceRoute("GET", `/sessions/:sessionId/files/:area/${operation}`, {
    summary: "Download original bytes from an authorized session area."
  }, async (request, reply) => sendFileDownload(reply, await request.executeAction({
    actionId: `vibe64.source-editor.file-area.${operation}`,
    input: areaQuery(request, operation)
  })));
  routes.serviceRoute("POST", "/sessions/:sessionId/files/:area/upload", {
    bodyLimit: 101 * 1024 * 1024, summary: "Upload one file into the authorized Drop Zone."
  }, (request) => request.executeAction({
    actionId: "vibe64.source-editor.file-area.upload",
    input: sourceInput(request, { ...routes.requestQuery(request), area: request.params.area }),
    context: { sourceEditorUpload: { readUpload: () => request.parts({
      throwFileSizeLimit: true, limits: { files: 1, fields: 0, parts: 1, fileSize: 100 * 1024 * 1024 }
    }) } }
  }));

  route("GET", "/integrations", "integrations.read", { summary: "Read portable integration configuration." });
  route("GET", "/integrations/providers", "integrations.providers.read", { summary: "Search available integration providers." }, query);
  route("POST", "/integrations/n8n/discovery", "integrations.n8n.discover", { bodyLimit: 4096, summary: "Discover public n8n OAuth metadata." }, body);
  route("PUT", "/integrations", "integrations.save", { bodyLimit: 2 * 1024 * 1024, summary: "Validate and save integration configuration." }, body);
  route("POST", "/integrations/:integrationId/oauth-client", "integrations.oauth-client.register", {
    bodyLimit: 2 * 1024 * 1024, summary: "Register a supported OAuth client and save its project configuration and private Env."
  }, (request) => ({ ...body(request), integrationId: request.params.integrationId }));
  route("POST", "/integrations/:integrationId/setup", "integrations.setup", {
    bodyLimit: 32768, summary: "Run the application's declared development integration setup operation."
  }, (request) => ({ ...body(request), integrationId: request.params.integrationId }));

  route("GET", "/source-editor/tree", "tree.read", { summary: "Read the editable source tree." }, query);
  route("GET", "/source-editor/files", "files.find", { summary: "Find editable source files." }, searched);
  route("GET", "/source-editor/search", "search", { summary: "Search editable source files." }, searched);
  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/download", {
    summary: "Download an original source file."
  }, async (request, reply) => sendFileDownload(reply, await request.executeAction({ actionId: "vibe64.source-editor.file.download", input: query(request) })));
  route("GET", "/source-editor/stars", "stars.read", { summary: "Read this account's starred files." });
  route("POST", "/source-editor/stars", "star.set", { bodyLimit: 16 * 1024, summary: "Star or unstar a file." }, body);
  route("POST", "/source-editor/resolve-path", "path.resolve", { bodyLimit: 32 * 1024, summary: "Resolve a source path reference." }, body);
  route("POST", "/source-editor/explanations", "explanation.create", { bodyLimit: 256 * 1024, summary: "Explain a selected source range." }, body);
  route("POST", "/source-editor/explanations/cleanup", "explanations.cleanup", { bodyLimit: 16 * 1024, summary: "Clean abandoned source explanation chats." }, body);
  for (const [method, suffix, operation] of [
    ["DELETE", "", "delete"], ["POST", "/stop", "stop"], ["POST", "/followups", "followup"]
  ]) route(method, `/source-editor/explanations/:explanationId${suffix}`, `explanation.${operation}`, {
    bodyLimit: 128 * 1024, summary: "Operate the selected temporary source explanation."
  }, (request) => ({ ...body(request), explanationId: request.params.explanationId }));
  route("GET", "/source-editor/file", "file.read", { summary: "Read an editable source file." }, query);
  route("POST", "/source-editor/file", "file.create", { bodyLimit: 32 * 1024, summary: "Create an editable source file." }, body);
  route("PUT", "/source-editor/file", "file.save", { bodyLimit: 2 * 1024 * 1024, summary: "Autosave an editable source file." }, body);

  // Existing live subscriptions retain their transport-owned callbacks/lifetime.
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

}

export { registerRoutes };
