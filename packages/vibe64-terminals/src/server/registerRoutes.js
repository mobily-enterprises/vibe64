import {
  outputTargetInputValidator,
  previewIdentityInputValidator,
  previewDiagnosticInputValidator,
  terminalControlKeyInputValidator,
  terminalControlTextInputValidator
} from "./inputSchemas.js";
import {
  CODEX_ATTACHMENT_MAX_BYTES,
  CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES
} from "./codexAttachments.js";
import {
  createUploadFieldError
} from "@jskit-ai/uploads-runtime/server/policy/uploadPolicy";
import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";

import { VIBE64_UPLOAD_MAX_LABEL } from "@local/vibe64-core/shared";

const VIBE64_TERMINALS_UNAVAILABLE = "Vibe64 terminal service is unavailable.";

function outputResultContentDisposition(name = "download") {
  const normalizedName = String(name || "download").trim() || "download";
  const fallbackName = normalizedName
    .replace(/[^\x20-\x7e]/gu, "_")
    .replace(/["\\]/gu, "_")
    .slice(0, 180) || "download";
  const encodedName = encodeURIComponent(normalizedName).replace(/[!'()*]/gu, (character) => (
    `%${character.codePointAt(0).toString(16).toUpperCase()}`
  ));
  return `attachment; filename="${fallbackName}"; filename*=UTF-8''${encodedName}`;
}

function isMultipartError(error, code) {
  return String(error?.code || "").trim().toUpperCase() === String(code || "").trim().toUpperCase();
}

function attachmentMultipartError(message) {
  return createUploadFieldError("file", message);
}

function normalizeMultipartFilePart(part = {}) {
  const fieldName = String(part.fieldname || "").trim();
  if (part.type !== "file" || !part.file || typeof part.file.pipe !== "function") {
    throw attachmentMultipartError("Attachment upload accepts exactly one file and no other fields.");
  }
  if (fieldName !== "file") {
    part.file.resume?.();
    throw attachmentMultipartError(`Attachment field "${fieldName}" is not allowed.`);
  }
  return Object.freeze({
    contentType: String(part.mimetype || "").trim().toLowerCase(),
    fileName: String(part.filename || "").trim(),
    stream: part.file
  });
}

function multipartIterator(request) {
  if (typeof request?.parts !== "function") {
    throw new TypeError("Attachment uploads require strict multipart iteration support.");
  }
  return request.parts({
    throwFileSizeLimit: true,
    limits: {
      fileSize: CODEX_ATTACHMENT_MAX_BYTES,
      files: 2,
      parts: 2
    }
  });
}

async function nextMultipartPart(parts) {
  try {
    return await parts.next();
  } catch (error) {
    throw normalizeAttachmentMultipartError(error);
  }
}

async function drainMultipartFileStream(stream) {
  if (!stream || stream.readableEnded || stream.destroyed) {
    return;
  }
  await new Promise((resolve, reject) => {
    let settled = false;
    const finish = (error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      stream.off("end", onEnd);
      stream.off("close", onEnd);
      stream.off("error", onError);
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const onEnd = () => finish();
    const onError = (error) => finish(error);
    stream.once("end", onEnd);
    stream.once("close", onEnd);
    stream.once("error", onError);
    stream.resume();
    if (stream.readableEnded || stream.destroyed) {
      finish();
    }
  });
}

async function drainMultipartParts(parts, firstPart = null) {
  let part = firstPart;
  while (part && !part.done) {
    await drainMultipartFileStream(part.value?.file);
    part = await parts.next();
  }
}

async function withExactlyOneAttachment(request, consume) {
  const parts = multipartIterator(request);
  const firstPart = await nextMultipartPart(parts);
  if (firstPart.done) {
    throw attachmentMultipartError("Attachment file is required.");
  }

  let file;
  try {
    file = normalizeMultipartFilePart(firstPart.value);
  } catch (error) {
    await drainMultipartParts(parts, firstPart).catch(() => null);
    throw error;
  }

  let result;
  let consumeError = null;
  try {
    result = await consume(file);
  } catch (error) {
    consumeError = error;
  }

  let streamError = null;
  try {
    await drainMultipartFileStream(file.stream);
  } catch (error) {
    streamError = normalizeAttachmentMultipartError(error);
  }

  if (consumeError || streamError) {
    await drainMultipartParts(parts).catch(() => null);
    throw consumeError || streamError;
  }

  const nextPart = await nextMultipartPart(parts);
  if (!nextPart.done) {
    await drainMultipartParts(parts, nextPart).catch(() => null);
    throw attachmentMultipartError("Attachment upload allows exactly one file and no other fields.");
  }
  return result;
}

function normalizeAttachmentMultipartError(error) {
  if (isMultipartError(error, "FST_REQ_FILE_TOO_LARGE")) {
    return attachmentMultipartError(`Attachment file is too large. Maximum allowed size is ${VIBE64_UPLOAD_MAX_LABEL}.`);
  }
  if (isMultipartError(error, "FST_FILES_LIMIT") || isMultipartError(error, "FST_PARTS_LIMIT")) {
    return attachmentMultipartError("Attachment upload allows exactly one file and no other fields.");
  }
  return error;
}

function registerRoutes(
  http,
  {
    fastify,
    projectContext = null,
    terminals,
    uploads
  } = {}
) {
  if (!terminals || typeof terminals !== "object") {
    throw new TypeError(VIBE64_TERMINALS_UNAVAILABLE);
  }
  if (!uploads || typeof uploads.readSingleMultipartFile !== "function") {
    throw new TypeError("Vibe64 terminal routes require runtime.uploads.");
  }
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-terminals"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 terminal routes only accept loopback Studio requests.",
      projectContext
    })
  });
  routes.actionRoute("GET", "/codex-terminal", {
    actionId: "vibe64.terminals.global-terminal.status",
    summary: "Read global Vibe64 Codex terminal status."
  });

  routes.actionRoute("POST", "/codex-terminal", {
    actionId: "vibe64.terminals.global-terminal.start",
    summary: "Start a global Vibe64 Codex terminal."
  });

  routes.actionRoute("POST", "/agent-sessions/reconcile", {
    actionId: "vibe64.terminals.agent-sessions.reconcile",
    summary: "Reconnect assistant sessions for the current project."
  });

  routes.actionRoute("POST", "/project-runtime/open", {
    actionId: "vibe64.terminals.project-runtime.open",
    buildInput: (request) => withoutVibe64User(requestBody(request)),
    summary: "Mark the current Vibe64 project runtime open."
  });

  routes.actionRoute("POST", "/project-runtime/close", {
    actionId: "vibe64.terminals.project-runtime.close",
    buildInput: (request) => withoutVibe64User(requestBody(request)),
    summary: "Close all Vibe64 runtime processes for the current project."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/preview-diagnostics", {
    actionId: "vibe64.terminals.preview-diagnostics.record",
    body: previewDiagnosticInputValidator,
    buildInput: request => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Record opt-in, bounded Preview resource diagnostics."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/outputs", {
    actionId: "vibe64.terminals.outputs.read",
    buildInput: (request) => ({ ...requestQuery(request), ...sessionInput(request), ...requestPublicRouting(request) }),
    summary: "Read Vibe64 output target and run status."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/output-runs", {
    actionId: "vibe64.terminals.output-target.start",
    body: outputTargetInputValidator,
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Start a Vibe64 output target."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/output-runs/open", {
    actionId: "vibe64.terminals.output-target.open",
    buildInput: sessionInput,
    summary: "Open the latest Vibe64 web output."
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/output-results/:resultId", {
    summary: "Download one immutable Vibe64 output result."
  }, async (request, reply) => {
    const opened = await request.executeAction({
      actionId: "vibe64.terminals.output-result.read",
      input: { ...sessionInput(request), resultId: request.params.resultId }
    });
    const { fileHandle, result } = opened;
    try {
      const digest = Buffer.from(result.sha256, "hex").toString("base64");
      const stream = fileHandle.createReadStream({ autoClose: true });
      await reply
        .header("Cache-Control", "private, no-store")
        .header("Content-Disposition", outputResultContentDisposition(result.name))
        .header("Content-Length", String(result.size))
        .header("Content-Type", result.mediaType)
        .header("Digest", `sha-256=${digest}`)
        .header("X-Content-Type-Options", "nosniff")
        .code(200)
        .send(stream);
    } catch (error) {
      await fileHandle.close().catch(() => null);
      throw error;
    }
  });

  routes.actionRoute("POST", "/sessions/:sessionId/preview-identity", {
    actionId: "vibe64.terminals.preview-identity.select",
    body: previewIdentityInputValidator,
    buildInput(request) {
      const body = requestBody(request);
      return {
        identityName: String(body.identityName || ""),
        mode: body.mode,
        ...requestPublicRouting(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Select the application identity for this preview browser."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-terminal", {
    actionId: "vibe64.terminals.agent-terminal.start",
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Start a Vibe64 AI terminal."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/agent-goal", {
    actionId: "vibe64.terminals.agent-goal.read",
    buildInput: sessionInput,
    summary: "Read the selected assistant conversation goal."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-goal", {
    actionId: "vibe64.terminals.agent-goal.update",
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Set, pause, resume, or cancel the selected assistant conversation goal."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/agent-plan-usage", {
    actionId: "vibe64.terminals.agent-plan-usage.read", buildInput: sessionInput,
    summary: "Read the selected assistant account's remaining plan allowance."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/work-plan", {
    actionId: "vibe64.terminals.work-plan.read",
    buildInput: (request) => ({ ...request.query, ...sessionInput(request) }),
    summary: "Read one exact-revision page of Main's Auto work plan."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/work-plan/archive", {
    actionId: "vibe64.terminals.work-plan.archive",
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Archive the current plan at the reviewed revision, preserving it in history."
  });
  routes.actionRoute("POST", "/sessions/:sessionId/work-plan/restore", {
    actionId: "vibe64.terminals.work-plan.restore",
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Reopen an archived plan as active when there is no current plan."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/agent-session", {
    actionId: "vibe64.terminals.agent-session.prepare", buildInput: sessionInput,
    summary: "Prepare the Vibe64 assistant session."
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-attachments", {
    bodyLimit: CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES,
    summary: "Upload a temporary assistant attachment for a Vibe64 session."
  }, async (request) => {
    let result = null;
    try {
      return await withExactlyOneAttachment(request, async (file) => {
        result = await request.executeAction({
          actionId: "vibe64.terminals.agent-attachment.upload",
          input: {
            contentType: file.contentType,
            fileName: file.fileName,
            sessionId: request.params.sessionId,
            stream: file.stream
          }
        });
        return result;
      });
    } catch (error) {
      if (result?.attachmentId) {
        await request.executeAction({
          actionId: "vibe64.terminals.agent-attachment.delete",
          input: {
            attachmentId: result.attachmentId,
            sessionId: request.params.sessionId
          }
        }).catch(() => null);
      }
      throw error;
    }
  });

  routes.actionRoute("DELETE", "/sessions/:sessionId/agent-attachments/:attachmentId", {
    actionId: "vibe64.terminals.agent-attachment.delete",
    buildInput: (request) => ({
      attachmentId: request.params.attachmentId,
      sessionId: request.params.sessionId
    }),
    summary: "Delete one temporary assistant attachment."
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/agent-attachments/:attachmentId", {
    summary: "Read an attachment belonging to this conversation."
  }, async (request, reply) => {
    const { attachment, fileHandle } = await request.executeAction({
      actionId: "vibe64.terminals.agent-attachment.read",
      input: { ...sessionInput(request), attachmentId: request.params.attachmentId }
    });
    try {
      const inline = request.query?.inline === "1" && attachment.contentType.startsWith("image/");
      await reply
        .header("Cache-Control", "private, no-store")
        .header("Content-Disposition", inline ? "inline" : outputResultContentDisposition(attachment.fileName))
        .header("Content-Type", attachment.contentType)
        .header("Content-Security-Policy", "default-src 'none'; sandbox")
        .header("X-Content-Type-Options", "nosniff")
        .send(fileHandle.createReadStream({ autoClose: true }));
    } catch (error) {
      await fileHandle.close().catch(() => null);
      throw error;
    }
  });

  routes.actionRoute("GET", "/sessions/:sessionId/temporary-conversations", {
    actionId: "vibe64.terminals.temporary-conversation.list",
    buildInput: (request) => ({ sessionId: request.params.sessionId }),
    summary: "Restore Vibe64 temporary conversations."
  });
  routes.actionRoute("PATCH", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: "vibe64.terminals.temporary-conversation.update",
    buildInput: (request) => ({ ...requestBody(request), ...temporaryConversationInput(request) }),
    summary: "Save a Vibe64 temporary conversation draft and settings."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations", {
    actionId: "vibe64.terminals.temporary-conversation.create",
    buildInput: (request) => withoutVibe64User(bodyWithSessionId(request)),
    summary: "Create a Vibe64 temporary conversation."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: "vibe64.terminals.temporary-conversation.read",
    buildInput: (request) => ({ ...requestQuery(request), ...temporaryConversationInput(request) }),
    summary: "Read a Vibe64 temporary conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations/:conversationId/turns", {
    actionId: "vibe64.terminals.temporary-conversation.turn.start",
    buildInput: (request) => withoutVibe64User({
      ...requestBody(request),
      ...temporaryConversationInput(request)
    }),
    summary: "Start a turn in a Vibe64 temporary conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations/:conversationId/stop", {
    actionId: "vibe64.terminals.temporary-conversation.stop",
    buildInput: (request) => ({
      ...requestBody(request),
      ...temporaryConversationInput(request)
    }),
    summary: "Stop a Vibe64 temporary conversation."
  });

  routes.actionRoute("DELETE", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: "vibe64.terminals.temporary-conversation.delete",
    buildInput: temporaryConversationInput,
    summary: "Delete a Vibe64 temporary conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/prompt-hints", {
    actionId: "vibe64.terminals.prompt-hints.generate",
    buildInput: promptHintRouteInput,
    summary: "Suggest useful next prompts for a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/prompt-hints/cancel", {
    actionId: "vibe64.terminals.prompt-hints.cancel",
    buildInput: promptHintRouteInput,
    summary: "Cancel prompt suggestions that are no longer relevant."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/output-runs/:terminalSessionId/stop", {
    actionId: "vibe64.terminals.output-target.stop", buildInput: terminalRouteInput,
    statusCode: 200,
    summary: "Stop a Vibe64 output target without deleting its log."
  });

  // Every terminal has a snapshot and close; AI and global terminals are also controllable.
  for (const [prefix, path, readSummary, closeSummary] of [
    ["output-terminal", "/sessions/:sessionId/output-runs/:terminalSessionId/terminal",
      "Read a Vibe64 output terminal snapshot.", "Close a Vibe64 output terminal."],
    ["agent-terminal", "/sessions/:sessionId/agent-terminal/:terminalSessionId",
      "Read a Vibe64 AI terminal snapshot.", "Close a Vibe64 AI terminal."],
    ["global-terminal", "/codex-terminal/:terminalSessionId",
      "Read a global Vibe64 Codex terminal snapshot.", "Close a global Vibe64 Codex terminal."]
  ]) {
    const buildInput = terminalInputFor(prefix);
    routes.actionRoute("GET", path, {
      actionId: `vibe64.terminals.${prefix}.read`, buildInput,
      failureStatus: 404, successStatus: 200, summary: readSummary
    });
    routes.actionRoute("DELETE", path, {
      actionId: `vibe64.terminals.${prefix}.close`, buildInput,
      statusCode: 200, summary: closeSummary
    });
  }
  for (const [prefix, path] of [
    ["agent-terminal", "/sessions/:sessionId/agent-terminal/:terminalSessionId"],
    ["global-terminal", "/codex-terminal/:terminalSessionId"]
  ]) {
    const terminalInput = terminalInputFor(prefix);
    for (const suffix of ["snapshot", "quiet"]) {
      routes.actionRoute("GET", `${path}/control/${suffix}`, {
        actionId: `vibe64.terminals.${prefix}.control.snapshot`, buildInput: terminalInput,
        failureStatus: 404, successStatus: 200, summary: "Read a terminal control snapshot and quiet state."
      });
    }
    for (const [operation, summary] of [
      ["check-text", "Check whether a terminal snapshot contains literal text."],
      ["text", "Send exact text to a terminal."],
      ["key", "Send a narrow supported key to a terminal."]
    ]) {
      routes.actionRoute("POST", `${path}/control/${operation}`, {
        actionId: `vibe64.terminals.${prefix}.control.${operation}`,
        body: operation === "key" ? terminalControlKeyInputValidator : terminalControlTextInputValidator,
        buildInput: (request) => ({ ...withoutVibe64User(requestBody(request)), ...terminalInput(request) }),
        failureStatus: 404, successStatus: 200, summary
      });
    }
  }

  registerVibe64TerminalWebSocketRoutes(fastify, routes, terminals, { projectContext });
}

function bodyWithSessionId(request) {
  return {
    ...requestBody(request),
    sessionId: request.params.sessionId
  };
}

function promptHintRouteInput(request) {
  const body = requestBody(request);
  return withoutVibe64User({
    ...(Object.hasOwn(body, "draft") ? { draft: body.draft } : {}),
    operationId: body.operationId,
    ...(Object.hasOwn(body, "originId") ? { originId: body.originId } : {}),
    sessionId: request.params.sessionId
  });
}

function sessionInput(request) {
  return {
    sessionId: request.params.sessionId
  };
}

function temporaryConversationInput(request) {
  return {
    conversationId: request.params.conversationId,
    sessionId: request.params.sessionId
  };
}

function withoutVibe64User(input = {}) {
  const { vibe64User: _ignored, ...safeInput } = input || {};
  void _ignored;
  return safeInput;
}

function withVibe64User(request, input = {}) {
  const safeInput = withoutVibe64User(input);
  return request.vibe64User ? { ...safeInput, vibe64User: request.vibe64User } : safeInput;
}

function firstForwardedHeader(value = "") {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").split(",")[0]?.trim() || "";
}

function requestPublicRouting(request = {}) {
  return {
    publicHost: firstForwardedHeader(request.headers?.["x-forwarded-host"]) || request.headers?.host || "",
    publicProtocol: firstForwardedHeader(request.headers?.["x-forwarded-proto"]) || request.protocol || ""
  };
}

function firstRequestValue(value = "") {
  const rawValue = Array.isArray(value) ? value[0] : value;
  return String(rawValue || "").trim();
}

function requestQueryValue(request, key) {
  return firstRequestValue(request?.query?.[key] ?? request?.input?.query?.[key] ?? "");
}

function terminalRouteInput(request) {
  return { ...sessionInput(request), terminalSessionId: request.params.terminalSessionId };
}

// Global terminals belong to no session.
function terminalInputFor(prefix) {
  return prefix === "global-terminal"
    ? (request) => ({ terminalSessionId: request.params.terminalSessionId })
    : terminalRouteInput;
}

function registerVibe64TerminalWebSocketRoutes(fastify, routes, terminals, { projectContext = null } = {}) {
  registerTerminalWebSocketRoute(fastify, {
    projectContext,
    routePath: `${routes.routeBase}/codex-terminal/:terminalSessionId/ws`,
    service: terminals,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { subscriber, terminalSessionId }) {
      return service.subscribeGlobalCodexTerminal(terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, terminalSessionId }) {
      return service.resizeGlobalCodexTerminal(terminalSessionId, { cols, rows });
    },
    write(service, { data, request, terminalSessionId }) {
      return service.writeGlobalCodexTerminal(
        terminalSessionId,
        data,
        withVibe64User(request)
      );
    }
  });

  registerTerminalWebSocketRoute(fastify, {
    projectContext,
    routePath: `${routes.routeBase}/sessions/:sessionId/agent-terminal/:terminalSessionId/ws`,
    service: terminals,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeAgentTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId }) {
      return service.resizeAgentTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, request, sessionId, terminalSessionId }) {
      return service.writeAgentTerminal(sessionId, terminalSessionId, data, {
        originId: requestQueryValue(request, "originId"),
        request
      });
    }
  });

  registerTerminalWebSocketRoute(fastify, {
    projectContext,
    routePath: `${routes.routeBase}/sessions/:sessionId/output-runs/:terminalSessionId/terminal/ws`,
    service: terminals,
    serviceUnavailableMessage: VIBE64_TERMINALS_UNAVAILABLE,
    subscribe(service, { sessionId, subscriber, terminalSessionId, isClosed }) {
      return isClosed?.() ? { ok: true } : service.subscribeOutputTargetTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId, isClosed }) {
      return isClosed?.() ? { ok: true } : service.resizeOutputTargetTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeOutputTargetTerminal(sessionId, terminalSessionId, data);
    }
  });
}

export { registerRoutes };
