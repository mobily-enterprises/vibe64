import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  rename,
  rm,
  stat,
  utimes
} from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import { VIBE64_CODEX_ATTACHMENTS_ROOT_ENV, prepareCodexAttachmentRoot } from "@local/vibe64-runtime/server/codexAttachmentPaths";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
import { VIBE64_UPLOAD_MAX_BYTES, VIBE64_UPLOAD_BODY_LIMIT_BYTES } from "@local/vibe64-core/shared";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import {
  acquireAttachmentDirectoryLock,
  acquireAttachmentSessionLock,
  assertAttachmentId,
  ATTACHMENT_LEASE_LOCK_FILE,
  attachmentFilesRoot,
  attachmentHostDirectory,
  attachmentLockWaitMs,
  attachmentUploadValidationError,
  isSuggestionPin,
  readDirectoryEntries,
  withAttachmentDirectoryLock
} from "./codexAttachmentFolders.js";
import {
  ATTACHMENT_HASH_PATTERN,
  ATTACHMENT_RENEW_LOCK_WAIT_MS,
  ATTACHMENT_TTL_MS,
  cleanupCodexAttachments,
  clearAttachmentSessionCleanupTimer,
  releaseCodexSessionAttachments,
  removeRetiredDirectory,
  scanAttachmentSession,
  scheduleAttachmentCleanup,
  scheduleRetiredDirectoryRemoval
} from "./codexAttachmentExpiry.js";
import { doNothing } from "@local/vibe64-core/shared/doNothing";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("./codexAttachmentFolders.js").AttachmentOptions} AttachmentOptions */

const CODEX_ATTACHMENT_MAX_BYTES = VIBE64_UPLOAD_MAX_BYTES;
const CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES = VIBE64_UPLOAD_BODY_LIMIT_BYTES;
function sanitizeAttachmentFileName(fileName = "") {
  const baseName = path.basename(String(fileName || "attachment").replaceAll("\\", "/"));
  const sanitized = baseName
    .replace(/[^\w .@+-]/gu, "_")
    .replace(/^\.+/u, "")
    .trim()
    .slice(0, 160);
  return sanitized || "attachment";
}

function attachmentLimitLabel(maxBytes = CODEX_ATTACHMENT_MAX_BYTES) {
  if (maxBytes % (1024 * 1024) === 0) return `${maxBytes / (1024 * 1024)} MiB`;
  const megabytes = maxBytes / 1_000_000;
  return Number.isInteger(megabytes) && megabytes >= 1
    ? `${megabytes} MB`
    : `${maxBytes} bytes`;
}

function attachmentByteCounter(maxBytes = CODEX_ATTACHMENT_MAX_BYTES) {
  let size = 0;
  const counter = new Transform({
    transform(chunk, encoding, callback) {
      const bytes = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk, encoding);
      size += bytes.length;
      if (size > maxBytes) {
        callback(attachmentUploadValidationError(
          "vibe64_agent_attachment_too_large",
          `Attachment file is too large. Maximum allowed size is ${attachmentLimitLabel(maxBytes)}.`,
          413
        ));
        return;
      }
      callback(null, bytes);
    }
  });
  Object.defineProperty(counter, "size", {
    enumerable: true,
    get: () => size
  });
  return counter;
}

/**
 * Prepares attachment storage at start: retires quarantined sessions and scans each session's expired files.
 * @param {{ env: RuntimeEnv, busyRetryMs?: number, lockWaitMs?: number, now?: number }} options
 */
async function prepareCodexAttachmentStorage({
  busyRetryMs,
  env,
  lockWaitMs = ATTACHMENT_RENEW_LOCK_WAIT_MS,
  now = Date.now()
}) {
  await prepareCodexAttachmentRoot({ env });
  const filesRoot = attachmentFilesRoot({ env });
  await mkdir(filesRoot, { mode: vibe64SharedModes().directory, recursive: true });
  const projectEntries = await readDirectoryEntries(filesRoot);
  for (const projectEntry of projectEntries) {
    if (!projectEntry.isDirectory() || !ATTACHMENT_HASH_PATTERN.test(projectEntry.name)) {
      continue;
    }
    const projectDirectory = path.join(filesRoot, projectEntry.name);
    const sessionEntries = await readDirectoryEntries(projectDirectory);
    for (const sessionEntry of sessionEntries) {
      if (sessionEntry.name.startsWith(".expired-session-")) {
        try {
          await removeRetiredDirectory(path.join(projectDirectory, sessionEntry.name));
        } catch (error) {
          vibe64SessionDebugLog("server.codexAttachments.startupSessionQuarantine.error", {
            directory: path.join(projectDirectory, sessionEntry.name),
            error: vibe64SessionDebugError(error)
          });
          scheduleRetiredDirectoryRemoval(path.join(projectDirectory, sessionEntry.name));
        }
        continue;
      }
      if (!sessionEntry.isDirectory() || !ATTACHMENT_HASH_PATTERN.test(sessionEntry.name)) {
        continue;
      }
      await scanAttachmentSession(
        projectEntry.name,
        sessionEntry.name,
        {
          busyRetryMs,
          env,
          lockWaitMs: attachmentLockWaitMs({ lockWaitMs }, ATTACHMENT_RENEW_LOCK_WAIT_MS),
          now
        }
      );
    }
  }
  return filesRoot;
}

/**
 * @param {string} executionRoot
 * @param {string} sessionId
 * @param {string[]} attachmentIds
 * @param {AttachmentOptions} options
 */
async function renewCodexAttachments(executionRoot, sessionId, attachmentIds, options) {
  const busy = [];
  const retained = [];
  const missing = [];
  const candidates = Array.isArray(attachmentIds) ? attachmentIds : [];
  for (const candidate of new Set(candidates)) {
    const attachmentId = assertAttachmentId(candidate);
    const attachmentDirectory = attachmentHostDirectory(executionRoot, sessionId, attachmentId, options);
    const renewal = await withAttachmentDirectoryLock(attachmentDirectory, async () => {
      const entries = (await readdir(attachmentDirectory, { withFileTypes: true }))
        .filter((entry) => entry.name !== ATTACHMENT_LEASE_LOCK_FILE);
      const storedFiles = entries.filter((entry) => entry.isFile() && !entry.name.startsWith(".uploading-"));
      if (storedFiles.length !== 1 || entries.length !== 1) {
        return false;
      }
      const renewalTime = new Date();
      await utimes(path.join(attachmentDirectory, storedFiles[0].name), renewalTime, renewalTime);
      return true;
    }, {
      waitMs: attachmentLockWaitMs(options, ATTACHMENT_RENEW_LOCK_WAIT_MS)
    });
    if (renewal.busy) {
      busy.push(attachmentId);
      continue;
    }
    if (!renewal.exists || renewal.value !== true) {
      missing.push(attachmentId);
      continue;
    }
    scheduleAttachmentCleanup(attachmentDirectory);
    retained.push(attachmentId);
  }
  return {
    ...(busy.length > 0 ? { busy } : {}),
    missing,
    retained
  };
}

/**
 * The shared conversation layer uses the same upload lease as expiry and deletion.
 * Keep it held until the caller has copied or opened the file.
 * @param {string} executionRoot
 * @param {string} sessionId
 * @param {string} attachmentId
 * @param {(upload: { attachmentId: string, fileName: string, path: string, size: number }) => Promise<unknown>} operation
 * @param {AttachmentOptions} options
 */
async function withUploadedAgentAttachment(executionRoot, sessionId, attachmentId, operation, options) {
  const id = assertAttachmentId(attachmentId);
  const directory = attachmentHostDirectory(executionRoot, sessionId, id, options);
  const result = await withAttachmentDirectoryLock(directory, async () => {
    const entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.name !== ATTACHMENT_LEASE_LOCK_FILE && !isSuggestionPin(entry));
    if (entries.length !== 1 || !entries[0].isFile() || entries[0].name.startsWith(".uploading-")) {
      return null;
    }
    const filePath = path.join(directory, entries[0].name);
    return operation({ attachmentId: id, fileName: entries[0].name, path: filePath, size: (await stat(filePath)).size });
  }, { waitMs: attachmentLockWaitMs(options, ATTACHMENT_RENEW_LOCK_WAIT_MS) });
  if (result.busy || !result.exists || !result.value) {
    throw attachmentUploadValidationError(
      result.busy ? "vibe64_agent_attachment_busy" : "vibe64_agent_attachment_missing",
      result.busy ? "The attachment is busy. Try again." : "This attachment is no longer available. Upload it again.",
      result.busy ? 409 : 404
    );
  }
  return result.value;
}

/**
 * Stores one uploaded attachment for a session.
 * @param {{ beforeCreate?: () => Promise<void> | void, env: RuntimeEnv, input?: object, lockWaitMs?: number, maxBytes?: number, sessionId?: string, executionRoot?: string }} options
 */
async function storeCodexAttachment({
  beforeCreate = doNothing,
  env,
  input = {},
  lockWaitMs = undefined,
  maxBytes = CODEX_ATTACHMENT_MAX_BYTES,
  sessionId = "",
  executionRoot = ""
}) {
  const fileName = sanitizeAttachmentFileName(input.fileName);
  // readable-check: allow method-probe - platform object: an upload stream is a Node readable stream
  if (!input.stream || typeof input.stream.pipe !== "function") {
    return {
      ok: false,
      code: "vibe64_agent_attachment_stream_required",
      error: "Attachment upload stream is required."
    };
  }

  const attachmentId = crypto.randomUUID();
  const hostDirectory = attachmentHostDirectory(executionRoot, sessionId, attachmentId, { env });
  const sessionDirectory = attachmentHostDirectory(executionRoot, sessionId, "", { env });
  const hostPath = path.join(hostDirectory, fileName);
  const partialPath = path.join(hostDirectory, `.uploading-${crypto.randomUUID()}`);
  const counter = attachmentByteCounter(maxBytes);
  const storageLockWaitMs = attachmentLockWaitMs({ lockWaitMs }, ATTACHMENT_RENEW_LOCK_WAIT_MS);
  const sessionLock = await acquireAttachmentSessionLock(executionRoot, sessionId, { env }, {
    waitMs: storageLockWaitMs
  });
  if (!sessionLock.release) {
    return {
      code: "vibe64_agent_attachment_busy",
      error: "Attachment storage is busy. Try uploading the file again.",
      ok: false,
      statusCode: 409
    };
  }
  let attachmentLock = null;
  try {
    await beforeCreate();
    clearAttachmentSessionCleanupTimer(executionRoot, sessionId, { env });
    await mkdir(sessionDirectory, { mode: vibe64SharedModes().directory, recursive: true });
    await mkdir(hostDirectory, {
      mode: vibe64SharedModes().directory,
      recursive: false
    });
    attachmentLock = await acquireAttachmentDirectoryLock(hostDirectory, {
      waitMs: storageLockWaitMs
    });
    if (!attachmentLock.release) {
      await rm(hostDirectory, { force: true, recursive: true });
    }
  } finally {
    await sessionLock.release();
  }
  if (!attachmentLock.release) {
    return {
      code: "vibe64_agent_attachment_busy",
      error: "Attachment storage is busy. Try uploading the file again.",
      ok: false,
      statusCode: 409
    };
  }
  try {
    await pipeline(
      input.stream,
      counter,
      createWriteStream(partialPath, {
        flags: "wx",
        mode: vibe64SharedModes().file
      })
    );
    if (input.stream.truncated === true) {
      throw attachmentUploadValidationError(
        "vibe64_agent_attachment_too_large",
        `Attachment file is too large. Maximum allowed size is ${attachmentLimitLabel(maxBytes)}.`,
        413
      );
    }
    if (counter.size < 1) {
      throw attachmentUploadValidationError(
        "vibe64_agent_attachment_empty",
        "Attachment file is empty."
      );
    }
    await rename(partialPath, hostPath);
  } catch (error) {
    await rm(hostDirectory, {
      force: true,
      recursive: true
    });
    if (
      error?.code === "FST_REQ_FILE_TOO_LARGE" ||
      error?.code === "FST_FILES_LIMIT"
    ) {
      return {
        code: "vibe64_agent_attachment_too_large",
        error: `Attachment file is too large. Maximum allowed size is ${attachmentLimitLabel(maxBytes)}.`,
        ok: false,
        statusCode: 413
      };
    }
    if (String(error?.code || "").startsWith("vibe64_agent_attachment_")) {
      return {
        code: error.code,
        error: error.message,
        ok: false,
        statusCode: error.statusCode
      };
    }
    throw error;
  } finally {
    await attachmentLock.release();
  }
  scheduleAttachmentCleanup(hostDirectory);

  return {
    ok: true,
    attachmentId,
    path: hostPath,
    contentType: String(input.contentType || ""),
    expiresInMs: ATTACHMENT_TTL_MS,
    fileName,
    size: counter.size
  };
}

export {
  CODEX_ATTACHMENT_MAX_BYTES,
  CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES,
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  cleanupCodexAttachments,
  prepareCodexAttachmentStorage,
  prepareCodexAttachmentRoot,
  releaseCodexSessionAttachments,
  renewCodexAttachments,
  withUploadedAgentAttachment,
  storeCodexAttachment
};
