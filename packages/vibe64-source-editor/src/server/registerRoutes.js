import { VIBE64_UPLOAD_MAX_BYTES, VIBE64_UPLOAD_BODY_LIMIT_BYTES } from "@local/vibe64-core/shared";
import { validateSchemaPayload } from "@jskit-ai/kernel/shared/validators";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import { sendVibe64EventStream } from "@local/vibe64-core/server/eventStream";
import {
  VIBE64_SOURCE_EDITOR_SYNC_ERROR_EVENT
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";
import { explanationFollowupStreamSchema, explanationStreamSchema } from "./actions.js";
import { filePreviewImageType } from "../shared/fileTypes.js";

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

// An inline image keeps its real type so the browser can show it in place;
// the policy stops an SVG opened directly from running script or loading anything.
async function sendFileDownload(reply, result, { inline = false } = {}) {
  if (!result.ok) {
    return result;
  }
  const encodedName = encodeURIComponent(result.name).replace(/[!'()*]/gu, (character) =>
    `%${character.codePointAt(0).toString(16).toUpperCase()}`);
  const imageType = inline ? filePreviewImageType(result.name) : "";
  try {
    // An async handler must stay pending until Fastify has sent the file stream.
    await reply.header("Content-Type", imageType || "application/octet-stream")
      .header("Content-Disposition", imageType ? "inline" : `attachment; filename*=UTF-8''${encodedName}`)
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
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
  projectContext = null, sourceEditor
} = {}) {
  if (!sourceEditor || typeof sourceEditor.readTree !== "function") {
    throw new TypeError("registerRoutes requires the Vibe64 Source Editor API.");
  }
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-source-editor"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 source editor routes only accept loopback Studio requests.",
      projectContext
    })
  });
  const session = (request) => sourceInput(request);
  const body = (request) => sourceInput(request, requestBody(request));
  const query = (request) => sourceInput(request, requestQuery(request));
  const searched = (request) => {
    const query = requestQuery(request);
    const { q, ...rest } = query;
    return sourceInput(request, { ...rest, ...(Object.hasOwn(query, "q") ? { query: q } : {}) });
  };
  // Files areas: session routes reach every area, so project areas can be
  // destinations; project routes reach only the project's areas. Identity,
  // area and session come from the authenticated request and route.
  const areaInput = (request, data = {}) => {
    const { vibe64User: _ignoredUser, sessionId: _ignoredSession, ...rest } = data;
    return { ...rest, area: request.params.area, ...(request.params.sessionId ? { sessionId: request.params.sessionId } : {}) };
  };
  const areaQuery = (request, operation) => {
    const query = requestQuery(request);
    // As with the original Files boundary, only operation fields enter the action.
    return areaInput(request, {
      ...(Object.hasOwn(query, "path") ? { path: query.path } : {}),
      ...(operation === "tree" && Object.hasOwn(query, "offset") ? { offset: query.offset } : {})
    });
  };
  routes.actionRoute("GET", "/sessions/:sessionId/files", {
    actionId: "vibe64.source-editor.file-areas.read", buildInput: session,
    summary: "Read the session file areas available to this caller."
  });
  for (const prefix of ["/sessions/:sessionId/files", "/project-files"]) {
    for (const [method, suffix, operation] of [
      ["GET", "tree", "tree"], ["GET", "file", "file"], ["PUT", "file", "save"], ["POST", "file", "create"],
      ["POST", "rename", "rename"], ["POST", "directory", "mkdir"], ["DELETE", "file", "delete"],
      ["POST", "conflicts", "conflicts"], ["POST", "transfer", "transfer"]
    ]) routes.actionRoute(method, `${prefix}/:area/${suffix}`, {
      actionId: `vibe64.source-editor.file-area.${operation}`, bodyLimit: 2 * 1024 * 1024,
      summary: operation === "transfer" ? "Move or copy an item between authorized file areas without downloading it."
        : "Access files within an authorized file area.",
      buildInput: (request) => method === "GET" ? areaQuery(request, operation) : areaInput(request, requestBody(request))
    });

    // Binary and multipart framing stays at HTTP; the domain operation is shared.
    for (const operation of ["download", "archive"]) routes.serviceRoute("GET", `${prefix}/:area/${operation}`, {
      summary: "Download original bytes, or show an image in place, from an authorized file area."
    }, async (request, reply) => sendFileDownload(reply, await request.executeAction({
      actionId: `vibe64.source-editor.file-area.${operation}`,
      input: areaQuery(request, operation)
    }), { inline: requestQuery(request).inline === "1" }));
    routes.serviceRoute("POST", `${prefix}/:area/upload`, {
      bodyLimit: VIBE64_UPLOAD_BODY_LIMIT_BYTES, summary: "Upload one file into an authorized writable file area."
    }, (request) => request.executeAction({
      actionId: "vibe64.source-editor.file-area.upload",
      input: areaInput(request, requestQuery(request)),
      context: { sourceEditorUpload: { readUpload: () => request.parts({
        throwFileSizeLimit: true, limits: { files: 1, fields: 0, parts: 1, fileSize: VIBE64_UPLOAD_MAX_BYTES }
      }) } }
    }));
  }

  routes.actionRoute("GET", "/sessions/:sessionId/integrations", {
    actionId: "vibe64.source-editor.integrations.read", buildInput: session,
    summary: "Read portable integration configuration."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/integrations/providers", {
    actionId: "vibe64.source-editor.integrations.providers.read", buildInput: query,
    summary: "Search available integration providers."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/integrations/n8n/discovery", {
    actionId: "vibe64.source-editor.integrations.n8n.discover", buildInput: body,
    bodyLimit: 4096, summary: "Discover public n8n OAuth metadata."
  });
  routes.actionRoute("PUT", "/sessions/:sessionId/integrations", {
    actionId: "vibe64.source-editor.integrations.save", buildInput: body,
    bodyLimit: 2 * 1024 * 1024, summary: "Validate and save integration configuration."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/integrations/:integrationId/oauth-client", {
    actionId: "vibe64.source-editor.integrations.oauth-client.register",
    buildInput: (request) => ({ ...body(request), integrationId: request.params.integrationId }),
    bodyLimit: 2 * 1024 * 1024, summary: "Register a supported OAuth client and save its project configuration and private Env."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/integrations/:integrationId/setup", {
    actionId: "vibe64.source-editor.integrations.setup",
    buildInput: (request) => ({ ...body(request), integrationId: request.params.integrationId }),
    bodyLimit: 32768, summary: "Run the application's declared development integration setup operation."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/tree", {
    actionId: "vibe64.source-editor.tree.read", buildInput: query, summary: "Read the editable source tree."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/files", {
    actionId: "vibe64.source-editor.files.find", buildInput: searched, summary: "Find editable source files."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/search", {
    actionId: "vibe64.source-editor.search", buildInput: searched, summary: "Search editable source files."
  });
  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/download", {
    summary: "Download an original source file."
  }, async (request, reply) => {
    const { inline, ...input } = query(request);
    return sendFileDownload(reply, await request.executeAction({
      actionId: "vibe64.source-editor.file.download", input }), { inline: inline === "1" });
  });
  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/stars", {
    actionId: "vibe64.source-editor.stars.read", buildInput: session, summary: "Read this account's starred files."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/source-editor/stars", {
    actionId: "vibe64.source-editor.star.set", buildInput: body, bodyLimit: 16 * 1024, summary: "Star or unstar a file."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/source-editor/resolve-path", {
    actionId: "vibe64.source-editor.path.resolve", buildInput: body, bodyLimit: 32 * 1024, summary: "Resolve a source path reference."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/source-editor/explanations/cleanup", {
    actionId: "vibe64.source-editor.explanations.cleanup", buildInput: body, bodyLimit: 16 * 1024,
    summary: "Clean abandoned source explanation chats."
  });
  for (const [method, suffix, operation] of [
    ["DELETE", "", "delete"], ["POST", "/stop", "stop"]
  ]) routes.actionRoute(method, `/sessions/:sessionId/source-editor/explanations/:explanationId${suffix}`, {
    actionId: `vibe64.source-editor.explanation.${operation}`,
    buildInput: (request) => ({ ...body(request), explanationId: request.params.explanationId }),
    bodyLimit: 128 * 1024, summary: "Operate the selected temporary source explanation."
  });
  routes.actionRoute("GET", "/sessions/:sessionId/source-editor/file", {
    actionId: "vibe64.source-editor.file.read", buildInput: query, summary: "Read an editable source file."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/source-editor/file", {
    actionId: "vibe64.source-editor.file.create", buildInput: body, bodyLimit: 32 * 1024, summary: "Create an editable source file."
  });
  routes.actionRoute("PUT", "/sessions/:sessionId/source-editor/file", {
    actionId: "vibe64.source-editor.file.save", buildInput: body, bodyLimit: 2 * 1024 * 1024, summary: "Autosave an editable source file."
  });

  // Existing live subscriptions retain their transport-owned callbacks/lifetime.
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


  // Streams validate the same selection fields an action would, before the
  // reply is hijacked, so a malformed request is an ordinary 400 response.
  const streamInput = (request, schema, input) => ({
    ...validateSchemaPayload({ schema, mode: "create" }, sourceInput(request, input), {
      context: "Source explanation stream", statusCode: 400
    }),
    vibe64User: request.vibe64User
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

export { registerRoutes };
