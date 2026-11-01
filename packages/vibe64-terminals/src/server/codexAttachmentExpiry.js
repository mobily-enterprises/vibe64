// Expiry and cleanup of a session's attachments: their timers, retirement of expired folders and session scans.

import crypto from "node:crypto";
import {
  readdir,
  rename,
  rm,
  rmdir,
  stat
} from "node:fs/promises";
import path from "node:path";
import { VIBE64_CODEX_ATTACHMENTS_ROOT_ENV } from "@local/vibe64-runtime/server/codexAttachmentPaths";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import {
  acquireAttachmentDirectoryLock,
  acquireAttachmentSessionKeyLock,
  acquireAttachmentSessionLock,
  assertAttachmentId,
  ATTACHMENT_FILES_DIRECTORY,
  ATTACHMENT_ID_PATTERN,
  ATTACHMENT_LEASE_LOCK_FILE,
  attachmentDirectoryExists,
  attachmentFilesRoot,
  attachmentHostDirectory,
  attachmentLockWaitMs,
  attachmentSessionKey,
  attachmentSessionTimerKey,
  attachmentUploadValidationError,
  isSuggestionPin,
  readDirectoryEntries,
  withAttachmentDirectoryLock
} from "./codexAttachmentFolders.js";

const ATTACHMENT_TTL_MS = 30 * 60 * 1000;
const ATTACHMENT_RENEW_LOCK_WAIT_MS = 500;
const ATTACHMENT_DELETE_LOCK_WAIT_MS = 30_000;
const ATTACHMENT_EXPIRY_RETRY_MS = 1_000;
const ATTACHMENT_EXPIRY_ERROR_RETRY_MS = 5_000;
const ATTACHMENT_SESSION_RETRY_MS = 1_000;
const ATTACHMENT_HASH_PATTERN = /^[a-f0-9]{12}$/u;
const attachmentCleanupTimers = new Map();
const attachmentForcedCleanupTimers = new Map();
const attachmentRetiredDirectoryTimers = new Map();
const attachmentSessionCleanupTimers = new Map();
const attachmentSessionScanTimers = new Map();

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
  timer.unref();
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
  timer.unref();
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
  timer.unref();
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
  timer.unref();
  attachmentSessionCleanupTimers.set(timerKey, timer);
}

async function scanAttachmentSession(projectKey, sessionKey, options = {}) {
  const {
    env = process.env,
    lockWaitMs = ATTACHMENT_RENEW_LOCK_WAIT_MS,
    now = Date.now()
  } = options;
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
  timer.unref();
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

export {
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
};
