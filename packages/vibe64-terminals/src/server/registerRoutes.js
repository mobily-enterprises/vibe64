import {
  outputTargetInputValidator,
  previewIdentityInputValidator,
  terminalControlKeyInputValidator,
  terminalControlTextInputValidator
} from "./inputSchemas.js";
import {
  ACTION_CANCEL_SESSION_PROMPT_HINTS,
  ACTION_OPEN_OUTPUT_TARGET,
  ACTION_CREATE_TEMPORARY_CONVERSATION,
  ACTION_DELETE_AGENT_ATTACHMENT,
  ACTION_DELETE_TEMPORARY_CONVERSATION,
  ACTION_GENERATE_SESSION_PROMPT_HINTS,
  ACTION_READ_TEMPORARY_CONVERSATION,
  ACTION_SELECT_PREVIEW_IDENTITY,
  ACTION_START_OUTPUT_TARGET,
  ACTION_START_TEMPORARY_CONVERSATION_TURN,
  ACTION_STOP_TEMPORARY_CONVERSATION,
  ACTION_UPLOAD_AGENT_ATTACHMENT
} from "./actions.js";
import {
  CODEX_ATTACHMENT_MAX_BYTES,
  CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES
} from "./codexAttachments.js";
import {
  createUploadFieldError
} from "@jskit-ai/uploads-runtime/server/policy/uploadPolicy";
import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";
import { registerTerminalWebSocketRoute } from "@local/vibe64-core/server/terminalWebSocketRoutes";
import {
  terminalKeyInput,
  terminalSessionContainsText,
  terminalSessionControlSnapshot
} from "@local/vibe64-execution/server/terminalSessions";

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
    return attachmentMultipartError("Attachment file is too large. Maximum allowed size is 100 MB.");
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
    routeSurface = "",
    routeRelativePath = "",
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
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 terminal routes only accept loopback Studio requests.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-terminals"]
  });
  const terminalService = () => terminals;

  routes.serviceRoute("GET", "/codex-terminal", {
    summary: "Read global Vibe64 Codex terminal status."
  }, () => {
    return terminalService().globalCodexTerminalState();
  });

  routes.serviceRoute("POST", "/codex-terminal", {
    summary: "Start a global Vibe64 Codex terminal."
  }, (request) => {
    return terminalService().startGlobalCodexTerminal(withVibe64User(request));
  });

  routes.serviceRoute("POST", "/agent-sessions/reconcile", {
    summary: "Reconnect assistant sessions for the current project."
  }, () => {
    return terminalService().reconcileOpenAgentSessions();
  });

  routes.serviceRoute("POST", "/project-runtime/open", {
    summary: "Mark the current Vibe64 project runtime open."
  }, (request) => {
    return terminalService().openProjectRuntime(routes.requestBody(request));
  });

  routes.serviceRoute("POST", "/project-runtime/close", {
    summary: "Close all Vibe64 runtime processes for the current project."
  }, (request) => {
    return terminalService().closeProjectRuntime(routes.requestBody(request));
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/outputs", {
    summary: "Read Vibe64 output target and run status."
  }, (request) => {
    return terminalService().outputTargetStatus(request.params.sessionId, {
      ...requestPublicRouting(request)
    });
  });

  routes.actionRoute("POST", "/sessions/:sessionId/output-runs", {
    actionId: ACTION_START_OUTPUT_TARGET,
    body: outputTargetInputValidator,
    buildInput: (request) => withVibe64User(request, bodyWithSessionId(routes)(request)),
    summary: "Start a Vibe64 output target."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/output-runs/open", {
    actionId: ACTION_OPEN_OUTPUT_TARGET,
    buildInput: sessionInput,
    summary: "Open the latest Vibe64 web output."
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/output-results/:resultId", {
    summary: "Download one immutable Vibe64 output result."
  }, async (request, reply) => {
    const opened = await terminalService().readOutputResult(
      request.params.sessionId,
      request.params.resultId
    );
    const { fileHandle, result } = opened;
    try {
      const digest = Buffer.from(result.sha256, "hex").toString("base64");
      const stream = fileHandle.createReadStream({ autoClose: true });
      return reply
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
    actionId: ACTION_SELECT_PREVIEW_IDENTITY,
    body: previewIdentityInputValidator,
    buildInput(request) {
      const body = routes.requestBody(request);
      return {
        identityName: String(body.identityName || ""),
        mode: body.mode,
        ...requestPublicRouting(request),
        sessionId: request.params.sessionId
      };
    },
    summary: "Select the application identity for this preview browser."
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-terminal", {
    summary: "Start a Vibe64 AI terminal."
  }, (request) => {
    return terminalService().startAgentTerminal(
      request.params.sessionId,
      withVibe64User(request, routes.requestBody(request))
    );
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-session", {
    summary: "Prepare the Vibe64 assistant session."
  }, (request) => {
    return terminalService().ensureAgentSession(
      request.params.sessionId,
      withVibe64User(request, routes.requestBody(request))
    );
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/agent-attachments", {
    bodyLimit: CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES,
    summary: "Upload a temporary assistant attachment for a Vibe64 session."
  }, async (request) => {
    let result = null;
    try {
      return await withExactlyOneAttachment(request, async (file) => {
        result = await request.executeAction({
          actionId: ACTION_UPLOAD_AGENT_ATTACHMENT,
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
          actionId: ACTION_DELETE_AGENT_ATTACHMENT,
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
    actionId: ACTION_DELETE_AGENT_ATTACHMENT,
    buildInput: (request) => ({
      attachmentId: request.params.attachmentId,
      sessionId: request.params.sessionId
    }),
    summary: "Delete one temporary assistant attachment."
  });

  routes.serviceRoute("GET", "/sessions/:sessionId/agent-attachments/:attachmentId", {
    summary: "Read an attachment belonging to this conversation."
  }, async (request, reply) => {
    const { attachment, fileHandle } = await terminalService().readAgentAttachment(
      request.params.sessionId, request.params.attachmentId
    );
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

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations", {
    actionId: ACTION_CREATE_TEMPORARY_CONVERSATION,
    buildInput: (request) => withVibe64User(request, bodyWithSessionId(routes)(request)),
    summary: "Create an ephemeral Vibe64 assistant conversation."
  });

  routes.actionRoute("GET", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: ACTION_READ_TEMPORARY_CONVERSATION,
    buildInput: temporaryConversationInput,
    summary: "Read an ephemeral Vibe64 assistant conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations/:conversationId/turns", {
    actionId: ACTION_START_TEMPORARY_CONVERSATION_TURN,
    buildInput: (request) => withVibe64User(request, {
      ...routes.requestBody(request),
      ...temporaryConversationInput(request)
    }),
    summary: "Start a turn in an ephemeral Vibe64 assistant conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/temporary-conversations/:conversationId/stop", {
    actionId: ACTION_STOP_TEMPORARY_CONVERSATION,
    buildInput: (request) => ({
      ...routes.requestBody(request),
      ...temporaryConversationInput(request)
    }),
    summary: "Stop an ephemeral Vibe64 assistant conversation."
  });

  routes.actionRoute("DELETE", "/sessions/:sessionId/temporary-conversations/:conversationId", {
    actionId: ACTION_DELETE_TEMPORARY_CONVERSATION,
    buildInput: temporaryConversationInput,
    summary: "Delete an ephemeral Vibe64 assistant conversation."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/prompt-hints", {
    actionId: ACTION_GENERATE_SESSION_PROMPT_HINTS,
    buildInput: (request) => promptHintRouteInput(routes, request),
    summary: "Suggest useful next prompts for a Vibe64 session."
  });

  routes.actionRoute("POST", "/sessions/:sessionId/prompt-hints/cancel", {
    actionId: ACTION_CANCEL_SESSION_PROMPT_HINTS,
    buildInput: (request) => promptHintRouteInput(routes, request),
    summary: "Cancel prompt suggestions that are no longer relevant."
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeOutputTargetTerminal(sessionId, terminalSessionId),
    path: "/sessions/:sessionId/output-runs/:terminalSessionId/terminal",
    read: (sessionId, terminalSessionId) => terminalService().readOutputTargetTerminal(sessionId, terminalSessionId),
    readSummary: "Read a Vibe64 output terminal snapshot.",
    closeSummary: "Close a Vibe64 output terminal.",
    write: (sessionId, terminalSessionId, data) => terminalService().writeOutputTargetTerminal(sessionId, terminalSessionId, data)
  });

  routes.serviceRoute("POST", "/sessions/:sessionId/output-runs/:terminalSessionId/stop", {
    statusCode: 200,
    summary: "Stop a Vibe64 output target without deleting its log."
  }, (request) => {
    const input = terminalRouteInput(request);
    return terminalService().stopOutputTargetTerminal(input.sessionId, input.terminalSessionId);
  });

  registerTerminalSnapshotRoutes(routes, {
    close: (sessionId, terminalSessionId) => terminalService().closeAgentTerminal(sessionId, terminalSessionId),
    control: true,
    path: "/sessions/:sessionId/agent-terminal/:terminalSessionId",
    read: (sessionId, terminalSessionId) => terminalService().readAgentTerminal(sessionId, terminalSessionId),
    readSummary: "Read a Vibe64 AI terminal snapshot.",
    closeSummary: "Close a Vibe64 AI terminal.",
    write: (sessionId, terminalSessionId, data, input) => terminalService().writeAgentTerminal(sessionId, terminalSessionId, data, input)
  });

  registerGlobalTerminalSnapshotRoutes(routes, {
    close: (terminalSessionId) => terminalService().closeGlobalCodexTerminal(terminalSessionId),
    control: true,
    path: "/codex-terminal/:terminalSessionId",
    read: (terminalSessionId) => terminalService().readGlobalCodexTerminal(terminalSessionId),
    readSummary: "Read a global Vibe64 Codex terminal snapshot.",
    closeSummary: "Close a global Vibe64 Codex terminal.",
    write: (terminalSessionId, data, input) => terminalService().writeGlobalCodexTerminal(terminalSessionId, data, input)
  });

  registerVibe64TerminalWebSocketRoutes(fastify, routes, terminals, {
    projectContext
  });
}

function bodyWithSessionId(routes) {
  return function buildBodyWithSessionId(request) {
    return {
      ...routes.requestBody(request),
      sessionId: request.params.sessionId
    };
  };
}

function promptHintRouteInput(routes, request) {
  const body = routes.requestBody(request);
  return withVibe64User(request, {
    draft: body.draft,
    operationId: body.operationId,
    originId: body.originId,
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

function withVibe64User(request, input = {}) {
  const vibe64User = request.vibe64User || null;
  const {
    vibe64User: _ignoredVibe64User,
    ...safeInput
  } = input || {};
  void _ignoredVibe64User;
  if (!vibe64User) {
    return safeInput;
  }
  return {
    ...safeInput,
    vibe64User
  };
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

function terminalControlInputFields(body = {}) {
  const originId = firstRequestValue(body?.originId);
  return {
    ...(Array.isArray(body?.attachmentIds) ? { attachmentIds: body.attachmentIds } : {}),
    ...(originId ? { originId } : {}),
    trackGitActor: true
  };
}

function terminalRouteInput(request, input = {}) {
  return withVibe64User(request, {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
    sessionId: request.params.sessionId,
    terminalSessionId: request.params.terminalSessionId
  });
}

function globalTerminalRouteInput(request, input = {}) {
  return withVibe64User(request, {
    ...(input && typeof input === "object" && !Array.isArray(input) ? input : {}),
    terminalSessionId: request.params.terminalSessionId
  });
}

function registerTerminalSnapshotRoutes(routes, {
  close,
  closeSummary,
  control = false,
  path,
  read,
  readSummary,
  write = null
}) {
  routes.serviceRoute("GET", path, {
    failureStatus: 404,
    successStatus: 200,
    summary: readSummary
  }, (request) => {
    const input = terminalRouteInput(request);
    return read(input.sessionId, input.terminalSessionId, input);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = terminalRouteInput(request);
    return close(input.sessionId, input.terminalSessionId, input);
  });

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: terminalRouteInput,
      path,
      read: (input) => read(input.sessionId, input.terminalSessionId, input),
      write: write
        ? (input, data) => write(input.sessionId, input.terminalSessionId, data, input)
        : null
    });
  }
}

function registerGlobalTerminalSnapshotRoutes(routes, {
  close,
  closeSummary,
  control = false,
  path,
  read,
  readSummary,
  write = null
}) {
  routes.serviceRoute("GET", path, {
    failureStatus: 404,
    successStatus: 200,
    summary: readSummary
  }, (request) => {
    const input = globalTerminalRouteInput(request);
    return read(input.terminalSessionId);
  });

  routes.serviceRoute("DELETE", path, {
    statusCode: 200,
    summary: closeSummary
  }, (request) => {
    const input = globalTerminalRouteInput(request);
    return close(input.terminalSessionId);
  });

  if (control) {
    registerTerminalControlRoutes(routes, {
      inputForRequest: globalTerminalRouteInput,
      path,
      read: (input) => read(input.terminalSessionId),
      write: write
        ? (input, data) => write(input.terminalSessionId, data, input)
        : null
    });
  }
}

function registerTerminalControlRoutes(routes, {
  inputForRequest,
  path,
  read,
  write
}) {
  routes.serviceRoute("GET", `${path}/control/snapshot`, {
    failureStatus: 404,
    successStatus: 200,
    summary: "Read a terminal control snapshot."
  }, async (request) => {
    return terminalSessionControlSnapshot(await read(inputForRequest(request)));
  });

  routes.serviceRoute("GET", `${path}/control/quiet`, {
    failureStatus: 404,
    successStatus: 200,
    summary: "Read whether a terminal has been quiet recently."
  }, async (request) => {
    return terminalSessionControlSnapshot(await read(inputForRequest(request)));
  });

  routes.serviceRoute("POST", `${path}/control/check-text`, {
    body: terminalControlTextInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Check whether a terminal snapshot contains literal text."
  }, async (request) => {
    return terminalSessionContainsText(
      await read(inputForRequest(request)),
      routes.requestBody(request).text
    );
  });

  if (!write) {
    return;
  }

  routes.serviceRoute("POST", `${path}/control/text`, {
    body: terminalControlTextInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Send exact text to a terminal."
  }, async (request) => {
    const body = routes.requestBody(request);
    return terminalSessionControlSnapshot(
      await write(inputForRequest(request, terminalControlInputFields(body)), body.text)
    );
  });

  routes.serviceRoute("POST", `${path}/control/key`, {
    body: terminalControlKeyInputValidator,
    failureStatus: 404,
    successStatus: 200,
    summary: "Send a narrow supported key to a terminal."
  }, async (request) => {
    const body = routes.requestBody(request);
    const key = body.key;
    const input = terminalKeyInput(key);
    if (!input) {
      return {
        ok: false,
        error: `Unsupported terminal key: ${String(key || "")}`
      };
    }
    return terminalSessionControlSnapshot(await write(inputForRequest(request, terminalControlInputFields(body)), input));
  });
}

function registerVibe64TerminalWebSocketRoutes(fastify, routes, terminals, {
  projectContext = null
} = {}) {
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
    subscribe(service, { sessionId, subscriber, terminalSessionId }) {
      return service.subscribeOutputTargetTerminal(sessionId, terminalSessionId, subscriber);
    },
    resize(service, { cols, rows, sessionId, terminalSessionId }) {
      return service.resizeOutputTargetTerminal(sessionId, terminalSessionId, { cols, rows });
    },
    write(service, { data, sessionId, terminalSessionId }) {
      return service.writeOutputTargetTerminal(sessionId, terminalSessionId, data);
    }
  });

}

export { registerRoutes };
