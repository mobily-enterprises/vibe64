import crypto from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  stableHash
} from "./terminalShared.js";
import {
  STUDIO_TEMP_DIR_NAME
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const CODEX_ATTACHMENT_CONTAINER_ROOT = "/studio-attachments";
const CODEX_ATTACHMENT_HOST_ROOT = path.join(
  tmpdir(),
  STUDIO_TEMP_DIR_NAME,
  "attachments",
  crypto.randomUUID()
);
const CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES = Number.MAX_SAFE_INTEGER;
const ATTACHMENT_TTL_MS = 30 * 60 * 1000;
const attachmentCleanupTimers = new Map();

function attachmentSessionKey(targetRoot, sessionId) {
  return path.join(stableHash(targetRoot), stableHash(sessionId));
}

function attachmentHostDirectory(targetRoot, sessionId, attachmentId = "") {
  const parts = [
    CODEX_ATTACHMENT_HOST_ROOT,
    ...attachmentSessionKey(targetRoot, sessionId).split(path.sep)
  ];
  if (attachmentId) {
    parts.push(attachmentId);
  }
  return path.join(...parts);
}

function attachmentContainerPath(targetRoot, sessionId, attachmentId, fileName) {
  return path.posix.join(
    CODEX_ATTACHMENT_CONTAINER_ROOT,
    ...attachmentSessionKey(targetRoot, sessionId).split(path.sep),
    attachmentId,
    fileName
  );
}

function sanitizeAttachmentFileName(fileName = "") {
  const baseName = path.basename(String(fileName || "attachment").replaceAll("\\", "/"));
  const sanitized = baseName
    .replace(/[^\w .@+-]/gu, "_")
    .replace(/^\.+/u, "")
    .trim()
    .slice(0, 160);
  return sanitized || "attachment";
}

function decodeAttachmentData(value = "") {
  const raw = String(value || "").trim();
  const data = raw.includes(",") && /^data:[^,]+;base64,/iu.test(raw)
    ? raw.slice(raw.indexOf(",") + 1)
    : raw;
  const normalized = data.replace(/\s/gu, "");
  if (!normalized || !/^[A-Za-z0-9+/]*={0,2}$/u.test(normalized)) {
    return null;
  }
  return Buffer.from(normalized, "base64");
}

async function prepareCodexAttachmentRoot() {
  await mkdir(CODEX_ATTACHMENT_HOST_ROOT, {
    recursive: true
  });
}

async function cleanupCodexAttachments(targetRoot, sessionId, attachmentId = "") {
  const cleanupPath = attachmentId
    ? attachmentHostDirectory(targetRoot, sessionId, attachmentId)
    : attachmentHostDirectory(targetRoot, sessionId);
  const timerKey = `${stableHash(targetRoot)}:${stableHash(sessionId)}:${attachmentId}`;
  const timer = attachmentCleanupTimers.get(timerKey);
  if (timer) {
    clearTimeout(timer);
    attachmentCleanupTimers.delete(timerKey);
  }
  await rm(cleanupPath, {
    force: true,
    recursive: true
  });
}

function scheduleAttachmentCleanup(targetRoot, sessionId, attachmentId) {
  const timerKey = `${stableHash(targetRoot)}:${stableHash(sessionId)}:${attachmentId}`;
  const existingTimer = attachmentCleanupTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    attachmentCleanupTimers.delete(timerKey);
    void cleanupCodexAttachments(targetRoot, sessionId, attachmentId);
  }, ATTACHMENT_TTL_MS);
  timer.unref?.();
  attachmentCleanupTimers.set(timerKey, timer);
}

async function storeCodexAttachment({
  input = {},
  sessionId = "",
  targetRoot = ""
} = {}) {
  const fileName = sanitizeAttachmentFileName(input?.fileName);
  const data = decodeAttachmentData(input?.dataBase64);
  if (!data || data.length < 1) {
    return {
      ok: false,
      error: "Attachment data is invalid."
    };
  }

  const attachmentId = crypto.randomUUID();
  const hostDirectory = attachmentHostDirectory(targetRoot, sessionId, attachmentId);
  const hostPath = path.join(hostDirectory, fileName);
  await mkdir(hostDirectory, {
    recursive: true
  });
  await writeFile(hostPath, data);
  scheduleAttachmentCleanup(targetRoot, sessionId, attachmentId);

  return {
    ok: true,
    attachmentId,
    containerPath: attachmentContainerPath(targetRoot, sessionId, attachmentId, fileName),
    contentType: String(input?.contentType || ""),
    expiresInMs: ATTACHMENT_TTL_MS,
    fileName,
    size: data.length
  };
}

export {
  CODEX_ATTACHMENT_CONTAINER_ROOT,
  CODEX_ATTACHMENT_HOST_ROOT,
  CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES,
  cleanupCodexAttachments,
  prepareCodexAttachmentRoot,
  storeCodexAttachment
};
