import {
  buildUploadFieldError
} from "@jskit-ai/uploads-runtime/server/policy/uploadPolicy";
import { VIBE64_UPLOAD_MAX_LABEL } from "@local/vibe64-core/shared";
import {
  CODEX_ATTACHMENT_MAX_BYTES,
  CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES
} from "./codexAttachments.js";
import {
  ACTION_DELETE_AGENT_ATTACHMENT,
  ACTION_READ_AGENT_ATTACHMENT,
  ACTION_READ_OUTPUT_RESULT,
  ACTION_UPLOAD_AGENT_ATTACHMENT
} from "./terminalActions.js";

/** @typedef {ReturnType<typeof import("@jskit-ai/kernel/server/http").createActionRouteScope>} ActionRouteScope */

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
  return buildUploadFieldError("file", message);
}

function normalizeMultipartFilePart(part = {}) {
  const fieldName = String(part.fieldname || "").trim();
  // readable-check: allow method-probe - input validation: only a file part carries a readable file stream
  if (part.type !== "file" || !part.file || typeof part.file.pipe !== "function") {
    throw attachmentMultipartError("Attachment upload accepts exactly one file and no other fields.");
  }
  if (fieldName !== "file") {
    part.file.resume();
    throw attachmentMultipartError(`Attachment field "${fieldName}" is not allowed.`);
  }
  return Object.freeze({
    contentType: String(part.mimetype || "").trim().toLowerCase(),
    fileName: String(part.filename || "").trim(),
    stream: part.file
  });
}

function multipartIterator(request) {
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
    function onEnd() {
      finish();
    }
    function onError(error) {
      finish(error);
    }
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

/**
 * The file transfer routes: one output result download, and an assistant attachment's upload (exactly one multipart
 * file) and read.
 * @param {ActionRouteScope} routes
 */
function registerTerminalTransferRoutes(routes) {
  routes.serviceRoute("GET", "/sessions/:sessionId/output-results/:resultId", {
    summary: "Download one immutable Vibe64 output result."
  }, async (request, reply) => {
    const opened = await request.executeAction({
      actionId: ACTION_READ_OUTPUT_RESULT,
      input: {
        resultId: request.params.resultId,
        sessionId: request.params.sessionId
      }
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

  routes.serviceRoute("GET", "/sessions/:sessionId/agent-attachments/:attachmentId", {
    summary: "Read an attachment belonging to this conversation."
  }, async (request, reply) => {
    const { attachment, fileHandle } = await request.executeAction({
      actionId: ACTION_READ_AGENT_ATTACHMENT,
      input: {
        attachmentId: request.params.attachmentId,
        sessionId: request.params.sessionId
      }
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
}

export {
  registerTerminalTransferRoutes
};
