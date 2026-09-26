import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import {
  mkdir,
  readdir,
  rename,
  rm,
  rmdir,
  stat,
  utimes
} from "node:fs/promises";
import path from "node:path";
import { Transform } from "node:stream";
import { pipeline } from "node:stream/promises";

import {
  stableHash
} from "./terminalShared.js";
import {
  tryAcquireExclusiveFileLock
} from "@local/vibe64-execution/server";
import {
  targetRuntimeIdentity
} from "@local/vibe64-core/server/projectRuntimeIdentity";
import {
  CODEX_ATTACHMENT_HOST_ROOT,
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@local/vibe64-runtime/server/sessionDebugLog";
const CODEX_ATTACHMENT_MAX_BYTES = 100_000_000;
const CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES = CODEX_ATTACHMENT_MAX_BYTES + 1_000_000;
const ATTACHMENT_TTL_MS = 30 * 60 * 1000;
const ATTACHMENT_FILES_DIRECTORY = "files";
const ATTACHMENT_LOCKS_DIRECTORY = "locks";
const ATTACHMENT_LEASE_LOCK_FILE = ".lease-lock";
const ATTACHMENT_SUGGESTION_PIN_PREFIX = ".suggestion-pin-";
const ATTACHMENT_LOCK_POLL_MS = 25;
const ATTACHMENT_RENEW_LOCK_WAIT_MS = 500;
const ATTACHMENT_DELETE_LOCK_WAIT_MS = 30_000;
const ATTACHMENT_EXPIRY_RETRY_MS = 1_000;
const ATTACHMENT_EXPIRY_ERROR_RETRY_MS = 5_000;
const ATTACHMENT_SESSION_RETRY_MS = 1_000;
const ATTACHMENT_HASH_PATTERN = /^[a-f0-9]{12}$/u;
const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const attachmentCleanupTimers = new Map();
const attachmentForcedCleanupTimers = new Map();
const attachmentRetiredDirectoryTimers = new Map();
const attachmentSessionCleanupTimers = new Map();
const attachmentSessionScanTimers = new Map();

function attachmentSessionKey(executionRoot, sessionId) {
  return path.join(stableHash(targetRuntimeIdentity(executionRoot)), stableHash(sessionId));
}

function attachmentFilesRoot(options = {}) {
  return path.join(codexAttachmentHostRoot(options), ATTACHMENT_FILES_DIRECTORY);
}

function attachmentLocksRoot(options = {}) {
  return path.join(codexAttachmentHostRoot(options), ATTACHMENT_LOCKS_DIRECTORY);
}

function attachmentSessionLockPathFromKeys(projectKey, sessionKey, options = {}) {
  return path.join(attachmentLocksRoot(options), projectKey, `${sessionKey}.lock`);
}

function attachmentSessionTimerKey(projectKey, sessionKey, options = {}) {
  return path.resolve(attachmentSessionLockPathFromKeys(projectKey, sessionKey, options));
}

function attachmentHostDirectory(executionRoot, sessionId, attachmentId = "", options = {}) {
  const parts = [
    attachmentFilesRoot(options),
    ...attachmentSessionKey(executionRoot, sessionId).split(path.sep)
  ];
  if (attachmentId) {
    parts.push(attachmentId);
  }
  return path.join(...parts);
}

function assertAttachmentId(attachmentId = "") {
  const normalized = String(attachmentId || "").trim();
  if (!ATTACHMENT_ID_PATTERN.test(normalized)) {
    throw attachmentUploadValidationError(
      "vibe64_invalid_agent_attachment_id",
      "Attachment id is invalid."
    );
  }
  return normalized;
}

function isSuggestionPin(entry = {}) {
  return entry.isFile() && entry.name.startsWith(ATTACHMENT_SUGGESTION_PIN_PREFIX);
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

function attachmentUploadValidationError(code, message, statusCode = 400) {
  const error = new Error(message);
  error.code = code;
  error.statusCode = statusCode;
  return error;
}

function attachmentLimitLabel(maxBytes = CODEX_ATTACHMENT_MAX_BYTES) {
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

async function cleanupCodexAttachments(executionRoot, sessionId, attachmentId = "", options = {}) {
  const normalizedAttachmentId = attachmentId ? assertAttachmentId(attachmentId) : "";
  const cleanupPath = normalizedAttachmentId
    ? attachmentHostDirectory(executionRoot, sessionId, normalizedAttachmentId, options)
    : attachmentHostDirectory(executionRoot, sessionId, "", options);
  if (normalizedAttachmentId) {
    try {
      const deletion = await withAttachmentDirectoryLock(cleanupPath, async () => {
        const entries = await readDirectoryEntries(cleanupPath);
        if (entries.some(isSuggestionPin)) {
          throw attachmentUploadValidationError(
            "vibe64_agent_attachment_retained",
            "This attachment is retained by a historical message request.",
            409
          );
        }
        return retireAttachmentDirectory(cleanupPath);
      }, {
        waitMs: attachmentLockWaitMs(options, ATTACHMENT_DELETE_LOCK_WAIT_MS)
      });
      if (deletion.busy) {
        throw attachmentUploadValidationError(
          "vibe64_agent_attachment_busy",
          "Attachment is still in use. Try removing it again.",
          409
        );
      }
      clearAttachmentCleanupTimer(cleanupPath);
      clearAttachmentForcedCleanupTimer(cleanupPath);
      await pruneAttachmentSessionDirectory(executionRoot, sessionId, options);
      return deletion.value === true;
    } catch (error) {
      if (
        error?.code !== "vibe64_agent_attachment_retained" &&
        await attachmentDirectoryExists(cleanupPath)
      ) {
        scheduleAttachmentForcedCleanup(
          executionRoot,
          sessionId,
          normalizedAttachmentId,
          options,
          error?.code === "vibe64_agent_attachment_busy"
            ? ATTACHMENT_EXPIRY_RETRY_MS
            : ATTACHMENT_EXPIRY_ERROR_RETRY_MS
        );
      }
      throw error;
    }
  }

  if (!await attachmentDirectoryExists(cleanupPath)) {
    clearAttachmentSessionCleanupTimer(executionRoot, sessionId, options);
    clearAttachmentSessionScanTimer(executionRoot, sessionId, options);
    return false;
  }
  const sessionLock = await acquireAttachmentSessionLock(executionRoot, sessionId, options, {
    waitMs: attachmentLockWaitMs(options, ATTACHMENT_DELETE_LOCK_WAIT_MS)
  });
  if (!sessionLock.release) {
    scheduleAttachmentSessionCleanup(executionRoot, sessionId, options);
    return false;
  }
  const attachmentLocks = [];
  try {
    const entries = await readDirectoryEntries(cleanupPath);
    if (entries.length < 1 && !await attachmentDirectoryExists(cleanupPath)) {
      clearAttachmentSessionCleanupTimer(executionRoot, sessionId, options);
      return false;
    }
    const attachmentEntries = entries.filter((entry) => (
      entry.isDirectory() && ATTACHMENT_ID_PATTERN.test(entry.name)
    ));
    const deadline = Date.now() + attachmentLockWaitMs(options, ATTACHMENT_DELETE_LOCK_WAIT_MS);
    for (const entry of attachmentEntries) {
      const directory = path.join(cleanupPath, entry.name);
      const lock = await acquireAttachmentDirectoryLock(directory, {
        waitMs: Math.max(0, deadline - Date.now())
      });
      if (!lock.release) {
        if (!lock.exists) {
          clearAttachmentCleanupTimer(directory);
          continue;
        }
        for (const candidate of attachmentEntries) {
          scheduleAttachmentForcedCleanup(
            executionRoot,
            sessionId,
            candidate.name,
            options
          );
        }
        return false;
      }
      attachmentLocks.push({ directory, release: lock.release });
    }
    const quarantine = path.join(
      path.dirname(cleanupPath),
      `.expired-session-${path.basename(cleanupPath)}-${process.pid}-${crypto.randomUUID()}`
    );
    try {
      await rename(cleanupPath, quarantine);
    } catch (error) {
      if (error?.code === "ENOENT") {
        clearAttachmentSessionCleanupTimer(executionRoot, sessionId, options);
        return false;
      }
      throw error;
    }
    for (const { directory } of attachmentLocks) {
      clearAttachmentCleanupTimer(directory);
      clearAttachmentForcedCleanupTimer(directory);
    }
    clearAttachmentSessionCleanupTimer(executionRoot, sessionId, options);
    clearAttachmentSessionScanTimer(executionRoot, sessionId, options);
    try {
      await rm(quarantine, { force: true, recursive: true });
    } catch (error) {
      vibe64SessionDebugLog("server.codexAttachments.sessionQuarantine.error", {
        directory: quarantine,
        error: vibe64SessionDebugError(error)
      });
      scheduleRetiredDirectoryRemoval(quarantine);
    }
    return true;
  } finally {
    for (const lock of attachmentLocks.reverse()) {
      await lock.release();
    }
    await sessionLock.release();
  }
}

async function releaseCodexSessionAttachments(executionRoot, sessionId, options = {}) {
  const sessionDirectory = attachmentHostDirectory(executionRoot, sessionId, "", options);
  const existed = await attachmentDirectoryExists(sessionDirectory);
  await cleanupCodexAttachments(executionRoot, sessionId, "", options);
  if (await attachmentDirectoryExists(sessionDirectory)) {
    const error = attachmentUploadValidationError(
      "vibe64_agent_attachment_busy",
      "Session attachments are still in use. Try releasing them again.",
      409
    );
    error.retryable = true;
    throw error;
  }
  return {
    alreadyReleased: !existed,
    released: true
  };
}

async function retireAttachmentDirectory(directory) {
  const resolvedDirectory = path.resolve(directory);
  const quarantine = path.join(
    path.dirname(resolvedDirectory),
    `.expired-${path.basename(resolvedDirectory)}-${process.pid}-${crypto.randomUUID()}`
  );
  try {
    await rename(resolvedDirectory, quarantine);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
  try {
    await removeRetiredDirectory(quarantine);
  } catch (error) {
    vibe64SessionDebugLog("server.codexAttachments.quarantine.error", {
      directory: quarantine,
      error: vibe64SessionDebugError(error)
    });
    scheduleRetiredDirectoryRemoval(quarantine);
  }
  return true;
}

function waitForAttachmentLock() {
  return new Promise((resolve) => setTimeout(resolve, ATTACHMENT_LOCK_POLL_MS));
}

function attachmentLockWaitMs(options = {}, fallback = 0) {
  const configured = Number(options?.lockWaitMs);
  return Number.isFinite(configured) && configured >= 0 ? configured : fallback;
}

function clearScheduledTimer(timers, timerKey) {
  const timer = timers.get(timerKey);
  if (!timer) {
    return false;
  }
  clearTimeout(timer);
  timers.delete(timerKey);
  return true;
}

function clearAttachmentCleanupTimer(directory) {
  return clearScheduledTimer(attachmentCleanupTimers, path.resolve(directory));
}

function clearAttachmentForcedCleanupTimer(directory) {
  return clearScheduledTimer(attachmentForcedCleanupTimers, path.resolve(directory));
}

function clearAttachmentSessionCleanupTimer(executionRoot, sessionId, options = {}) {
  const [projectKey, sessionKey] = attachmentSessionKey(executionRoot, sessionId).split(path.sep);
  return clearScheduledTimer(
    attachmentSessionCleanupTimers,
    attachmentSessionTimerKey(projectKey, sessionKey, options)
  );
}

function clearAttachmentSessionScanTimer(executionRoot, sessionId, options = {}) {
  const [projectKey, sessionKey] = attachmentSessionKey(executionRoot, sessionId).split(path.sep);
  return clearScheduledTimer(
    attachmentSessionScanTimers,
    attachmentSessionTimerKey(projectKey, sessionKey, options)
  );
}

async function pruneAttachmentSessionDirectory(executionRoot, sessionId, options = {}) {
  const [projectKey, sessionKey] = attachmentSessionKey(executionRoot, sessionId).split(path.sep);
  const sessionDirectory = attachmentHostDirectory(executionRoot, sessionId, "", options);
  if (!await attachmentDirectoryExists(sessionDirectory)) {
    return false;
  }
  const sessionLock = await acquireAttachmentSessionKeyLock(
    projectKey,
    sessionKey,
    options,
    { waitMs: attachmentLockWaitMs(options, ATTACHMENT_RENEW_LOCK_WAIT_MS) }
  );
  if (!sessionLock.release) {
    scheduleAttachmentSessionScan(projectKey, sessionKey, {
      env: options.env,
      lockWaitMs: attachmentLockWaitMs(options, ATTACHMENT_RENEW_LOCK_WAIT_MS)
    });
    return false;
  }
  try {
    if ((await readDirectoryEntries(sessionDirectory)).length > 0) {
      return false;
    }
    try {
      await rmdir(sessionDirectory);
      clearAttachmentSessionScanTimer(executionRoot, sessionId, options);
      return true;
    } catch (error) {
      if (error?.code === "ENOENT") {
        return false;
      }
      if (error?.code === "ENOTEMPTY" || error?.code === "EEXIST") {
        return false;
      }
      throw error;
    }
  } finally {
    await sessionLock.release();
  }
}

async function attachmentDirectoryExists(directory) {
  try {
    return (await stat(directory)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return false;
    }
    throw error;
  }
}

function attachmentLockCwd(directory) {
  return path.dirname(path.dirname(path.dirname(path.resolve(directory))));
}

async function acquireAttachmentDirectoryLock(directory, {
  waitMs = 0
} = {}) {
  const lockPath = path.join(directory, ATTACHMENT_LEASE_LOCK_FILE);
  const deadline = Date.now() + Math.max(0, waitMs);
  while (true) {
    if (!await attachmentDirectoryExists(directory)) {
      return {
        busy: false,
        exists: false,
        release: null
      };
    }
    let release = null;
    try {
      release = await tryAcquireExclusiveFileLock(lockPath, {
        cwd: attachmentLockCwd(directory)
      });
    } catch (error) {
      if (!await attachmentDirectoryExists(directory)) {
        return {
          busy: false,
          exists: false,
          release: null
        };
      }
      throw error;
    }
    if (release) {
      return {
        busy: false,
        exists: true,
        release
      };
    }
    if (Date.now() >= deadline) {
      return {
        busy: true,
        exists: true,
        release: null
      };
    }
    await waitForAttachmentLock();
  }
}

async function acquireAttachmentSessionLock(
  executionRoot,
  sessionId,
  options = {},
  lockOptions = {}
) {
  const [projectKey, sessionKey] = attachmentSessionKey(executionRoot, sessionId).split(path.sep);
  return acquireAttachmentSessionKeyLock(projectKey, sessionKey, options, lockOptions);
}

async function acquireAttachmentSessionKeyLock(
  projectKey,
  sessionKey,
  options = {},
  {
    waitMs = 0
  } = {}
) {
  const lockPath = path.join(attachmentLocksRoot(options), projectKey, `${sessionKey}.lock`);
  const lockDirectory = path.dirname(lockPath);
  await mkdir(lockDirectory, { mode: 0o770, recursive: true });
  const deadline = Date.now() + Math.max(0, waitMs);
  while (true) {
    const release = await tryAcquireExclusiveFileLock(lockPath, {
      cwd: lockDirectory
    });
    if (release) {
      return {
        busy: false,
        release
      };
    }
    if (Date.now() >= deadline) {
      return {
        busy: true,
        release: null
      };
    }
    await waitForAttachmentLock();
  }
}

async function withAttachmentDirectoryLock(directory, operation, options = {}) {
  const lock = await acquireAttachmentDirectoryLock(directory, options);
  if (!lock.release) {
    return {
      busy: lock.busy,
      exists: lock.exists,
      value: null
    };
  }
  try {
    return {
      busy: false,
      exists: true,
      value: await operation()
    };
  } finally {
    await lock.release();
  }
}

async function attachmentDirectoryActivity(directory, now = Date.now(), retry = true) {
  let entries = [];
  try {
    entries = (await readdir(directory, { withFileTypes: true }))
      .filter((entry) => entry.name !== ATTACHMENT_LEASE_LOCK_FILE);
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
  const pinned = entries.some(isSuggestionPin);
  const contentEntries = entries.filter((entry) => !isSuggestionPin(entry));
  const storedFiles = contentEntries.filter((entry) => entry.isFile() && !entry.name.startsWith(".uploading-"));
  const stagedFiles = contentEntries.filter((entry) => entry.isFile() && entry.name.startsWith(".uploading-"));
  const isStored = storedFiles.length === 1 && stagedFiles.length === 0 && contentEntries.length === 1;
  const isUploading = storedFiles.length === 0 && stagedFiles.length === 1 && contentEntries.length === 1;
  if (!isStored && !isUploading) {
    return {
      ageMs: ATTACHMENT_TTL_MS,
      valid: false
    };
  }
  const activityPath = path.join(directory, (isStored ? storedFiles : stagedFiles)[0].name);
  try {
    return {
      ageMs: pinned ? 0 : Math.max(0, now - (await stat(activityPath)).mtimeMs),
      pinned,
      valid: true
    };
  } catch (error) {
    if (retry && error?.code === "ENOENT") {
      return attachmentDirectoryActivity(directory, now, false);
    }
    throw error;
  }
}

async function expireAttachmentDirectory(directory, now = Date.now()) {
  const result = await withAttachmentDirectoryLock(directory, async () => {
    const activity = await attachmentDirectoryActivity(directory, now);
    if (!activity || !activity.valid || activity.ageMs >= ATTACHMENT_TTL_MS) {
      await retireAttachmentDirectory(directory);
      return {
        expired: true
      };
    }
    return {
      delayMs: ATTACHMENT_TTL_MS - activity.ageMs,
      expired: false
    };
  });
  if (!result.exists) {
    return false;
  }
  if (result.busy) {
    scheduleAttachmentCleanup(directory, ATTACHMENT_EXPIRY_RETRY_MS);
    return false;
  }
  if (result.value.expired) {
    scheduleAttachmentSessionScanForDirectory(directory);
  } else {
    scheduleAttachmentCleanup(directory, result.value.delayMs);
  }
  return result.value.expired;
}

function scheduleAttachmentCleanup(directory, delayMs = ATTACHMENT_TTL_MS) {
  const timerKey = path.resolve(directory);
  const existingTimer = attachmentCleanupTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    attachmentCleanupTimers.delete(timerKey);
    void expireAttachmentDirectory(timerKey).catch((error) => {
      vibe64SessionDebugLog("server.codexAttachments.expiry.error", {
        directory: timerKey,
        error: vibe64SessionDebugError(error)
      });
      scheduleAttachmentCleanup(timerKey, ATTACHMENT_EXPIRY_ERROR_RETRY_MS);
    });
  }, Math.max(1, delayMs));
  timer.unref?.();
  attachmentCleanupTimers.set(timerKey, timer);
}

function scheduleAttachmentForcedCleanup(
  executionRoot,
  sessionId,
  attachmentId,
  options = {},
  delayMs = ATTACHMENT_EXPIRY_RETRY_MS
) {
  const cleanupPath = attachmentHostDirectory(
    executionRoot,
    sessionId,
    attachmentId,
    options
  );
  const timerKey = path.resolve(cleanupPath);
  const existingTimer = attachmentForcedCleanupTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    attachmentForcedCleanupTimers.delete(timerKey);
    void cleanupCodexAttachments(
      executionRoot,
      sessionId,
      attachmentId,
      options
    ).catch((error) => {
      vibe64SessionDebugLog("server.codexAttachments.forcedCleanup.error", {
        attachmentId,
        error: vibe64SessionDebugError(error),
        sessionId
      });
      scheduleAttachmentForcedCleanup(
        executionRoot,
        sessionId,
        attachmentId,
        options,
        ATTACHMENT_EXPIRY_ERROR_RETRY_MS
      );
    });
  }, Math.max(1, delayMs));
  timer.unref?.();
  attachmentForcedCleanupTimers.set(timerKey, timer);
}

async function removeRetiredDirectory(directory) {
  const timerKey = path.resolve(directory);
  clearScheduledTimer(attachmentRetiredDirectoryTimers, timerKey);
  await rm(timerKey, {
    force: true,
    recursive: true
  });
}

function scheduleRetiredDirectoryRemoval(directory, delayMs = ATTACHMENT_EXPIRY_RETRY_MS) {
  const timerKey = path.resolve(directory);
  const existingTimer = attachmentRetiredDirectoryTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    attachmentRetiredDirectoryTimers.delete(timerKey);
    void removeRetiredDirectory(timerKey).catch((error) => {
      vibe64SessionDebugLog("server.codexAttachments.quarantineRetry.error", {
        directory: timerKey,
        error: vibe64SessionDebugError(error)
      });
      scheduleRetiredDirectoryRemoval(timerKey, ATTACHMENT_EXPIRY_ERROR_RETRY_MS);
    });
  }, Math.max(1, delayMs));
  timer.unref?.();
  attachmentRetiredDirectoryTimers.set(timerKey, timer);
}

function scheduleAttachmentSessionCleanup(
  executionRoot,
  sessionId,
  options = {},
  delayMs = ATTACHMENT_SESSION_RETRY_MS
) {
  const [projectKey, sessionKey] = attachmentSessionKey(executionRoot, sessionId).split(path.sep);
  const timerKey = attachmentSessionTimerKey(projectKey, sessionKey, options);
  const existingTimer = attachmentSessionCleanupTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    attachmentSessionCleanupTimers.delete(timerKey);
    void cleanupCodexAttachments(executionRoot, sessionId, "", options).catch((error) => {
      vibe64SessionDebugLog("server.codexAttachments.sessionCleanupRetry.error", {
        error: vibe64SessionDebugError(error),
        sessionId: sessionKey
      });
      scheduleAttachmentSessionCleanup(
        executionRoot,
        sessionId,
        options,
        ATTACHMENT_EXPIRY_ERROR_RETRY_MS
      );
    });
  }, Math.max(1, delayMs));
  timer.unref?.();
  attachmentSessionCleanupTimers.set(timerKey, timer);
}

async function scanAttachmentSession(projectKey, sessionKey, {
  env = process.env,
  lockWaitMs = ATTACHMENT_RENEW_LOCK_WAIT_MS,
  now = Date.now()
} = {}) {
  const sessionDirectory = path.join(attachmentFilesRoot({ env }), projectKey, sessionKey);
  if (!await attachmentDirectoryExists(sessionDirectory)) {
    clearScheduledTimer(
      attachmentSessionScanTimers,
      attachmentSessionTimerKey(projectKey, sessionKey, { env })
    );
    return false;
  }
  const sessionLock = await acquireAttachmentSessionKeyLock(
    projectKey,
    sessionKey,
    { env },
    { waitMs: lockWaitMs }
  );
  if (!sessionLock.release) {
    scheduleAttachmentSessionScan(projectKey, sessionKey, { env, lockWaitMs, now });
    return false;
  }
  try {
    if (!await attachmentDirectoryExists(sessionDirectory)) {
      return false;
    }
    const attachmentEntries = await readDirectoryEntries(sessionDirectory);
    for (const attachmentEntry of attachmentEntries) {
      const attachmentDirectory = path.join(sessionDirectory, attachmentEntry.name);
      if (attachmentEntry.name.startsWith(".expired-")) {
        try {
          await removeRetiredDirectory(attachmentDirectory);
        } catch (error) {
          vibe64SessionDebugLog("server.codexAttachments.startupQuarantine.error", {
            directory: attachmentDirectory,
            error: vibe64SessionDebugError(error)
          });
          scheduleRetiredDirectoryRemoval(attachmentDirectory);
        }
        continue;
      }
      if (!attachmentEntry.isDirectory() || !ATTACHMENT_ID_PATTERN.test(attachmentEntry.name)) {
        continue;
      }
      await expireAttachmentDirectory(attachmentDirectory, now);
    }
    if ((await readDirectoryEntries(sessionDirectory)).length < 1) {
      try {
        await rmdir(sessionDirectory);
      } catch (error) {
        if (error?.code !== "ENOENT" && error?.code !== "ENOTEMPTY" && error?.code !== "EEXIST") {
          throw error;
        }
      }
    }
    clearScheduledTimer(
      attachmentSessionScanTimers,
      attachmentSessionTimerKey(projectKey, sessionKey, { env })
    );
    return true;
  } finally {
    await sessionLock.release();
  }
}

function scheduleAttachmentSessionScan(
  projectKey,
  sessionKey,
  options = {},
  delayMs = ATTACHMENT_SESSION_RETRY_MS
) {
  const timerKey = attachmentSessionTimerKey(projectKey, sessionKey, options);
  const existingTimer = attachmentSessionScanTimers.get(timerKey);
  if (existingTimer) {
    clearTimeout(existingTimer);
  }
  const timer = setTimeout(() => {
    attachmentSessionScanTimers.delete(timerKey);
    void scanAttachmentSession(projectKey, sessionKey, {
      ...options,
      now: Math.max(Number(options.now) || 0, Date.now())
    }).catch((error) => {
      vibe64SessionDebugLog("server.codexAttachments.startupRetry.error", {
        error: vibe64SessionDebugError(error),
        sessionId: sessionKey
      });
      scheduleAttachmentSessionScan(
        projectKey,
        sessionKey,
        options,
        ATTACHMENT_EXPIRY_ERROR_RETRY_MS
      );
    });
  }, Math.max(1, delayMs));
  timer.unref?.();
  attachmentSessionScanTimers.set(timerKey, timer);
}

function scheduleAttachmentSessionScanForDirectory(
  attachmentDirectory,
  delayMs = ATTACHMENT_EXPIRY_RETRY_MS
) {
  const sessionDirectory = path.dirname(path.resolve(attachmentDirectory));
  const projectDirectory = path.dirname(sessionDirectory);
  const filesRoot = path.dirname(projectDirectory);
  const projectKey = path.basename(projectDirectory);
  const sessionKey = path.basename(sessionDirectory);
  if (
    path.basename(filesRoot) !== ATTACHMENT_FILES_DIRECTORY ||
    !ATTACHMENT_HASH_PATTERN.test(projectKey) ||
    !ATTACHMENT_HASH_PATTERN.test(sessionKey)
  ) {
    return;
  }
  scheduleAttachmentSessionScan(projectKey, sessionKey, {
    env: {
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: path.dirname(filesRoot)
    }
  }, delayMs);
}

async function prepareCodexAttachmentStorage({
  env = process.env,
  lockWaitMs = ATTACHMENT_RENEW_LOCK_WAIT_MS,
  now = Date.now()
} = {}) {
  await prepareCodexAttachmentRoot({ env });
  const filesRoot = attachmentFilesRoot({ env });
  await mkdir(filesRoot, { mode: 0o770, recursive: true });
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
          env,
          lockWaitMs: attachmentLockWaitMs({ lockWaitMs }, ATTACHMENT_RENEW_LOCK_WAIT_MS),
          now
        }
      );
    }
  }
  return filesRoot;
}

async function readDirectoryEntries(directory) {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return [];
    }
    throw error;
  }
}

async function renewCodexAttachments(executionRoot, sessionId, attachmentIds = [], options = {}) {
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

// The shared conversation layer uses the same upload lease as expiry and deletion.
// Keep it held until the caller has copied or opened the file.
async function withUploadedAgentAttachment(executionRoot, sessionId, attachmentId, operation, options = {}) {
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

async function storeCodexAttachment({
  beforeCreate = null,
  env = process.env,
  input = {},
  lockWaitMs = undefined,
  maxBytes = CODEX_ATTACHMENT_MAX_BYTES,
  sessionId = "",
  executionRoot = ""
} = {}) {
  const fileName = sanitizeAttachmentFileName(input?.fileName);
  if (!input?.stream || typeof input.stream.pipe !== "function") {
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
    if (typeof beforeCreate === "function") {
      await beforeCreate();
    }
    clearAttachmentSessionCleanupTimer(executionRoot, sessionId, { env });
    await mkdir(sessionDirectory, { mode: 0o770, recursive: true });
    await mkdir(hostDirectory, {
      mode: 0o770,
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
        mode: 0o660
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
    contentType: String(input?.contentType || ""),
    expiresInMs: ATTACHMENT_TTL_MS,
    fileName,
    size: counter.size
  };
}

export {
  CODEX_ATTACHMENT_HOST_ROOT,
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
