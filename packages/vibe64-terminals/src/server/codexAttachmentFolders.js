// Where a session's attachments live, their ids, and the leases and locks that guard their folders.

import { mkdir, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { tryAcquireExclusiveFileLock, stableHash } from "@local/vibe64-execution/server";
import { targetRuntimeIdentity } from "@local/vibe64-core/server/projectRuntimeIdentity";
import { codexAttachmentHostRoot } from "@local/vibe64-runtime/server/codexAttachmentPaths";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const ATTACHMENT_FILES_DIRECTORY = "files";
const ATTACHMENT_LOCKS_DIRECTORY = "locks";
const ATTACHMENT_LEASE_LOCK_FILE = ".lease-lock";
const ATTACHMENT_SUGGESTION_PIN_PREFIX = ".suggestion-pin-";
const ATTACHMENT_LOCK_POLL_MS = 25;

const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;

function attachmentSessionKey(executionRoot, sessionId) {
  return path.join(stableHash(targetRuntimeIdentity(executionRoot)), stableHash(sessionId));
}

/** @typedef {{ env: RuntimeEnv }} AttachmentRootOptions the env that names the attachment root */

/** @param {AttachmentRootOptions} options */
function attachmentFilesRoot({ env }) {
  return path.join(codexAttachmentHostRoot({ env }), ATTACHMENT_FILES_DIRECTORY);
}

/** @param {AttachmentRootOptions} options */
function attachmentLocksRoot({ env }) {
  return path.join(codexAttachmentHostRoot({ env }), ATTACHMENT_LOCKS_DIRECTORY);
}

/**
 * @param {string} projectKey
 * @param {string} sessionKey
 * @param {AttachmentRootOptions} options
 */
function attachmentSessionLockPathFromKeys(projectKey, sessionKey, options) {
  return path.join(attachmentLocksRoot(options), projectKey, `${sessionKey}.lock`);
}

/**
 * @param {string} projectKey
 * @param {string} sessionKey
 * @param {AttachmentRootOptions} options
 */
function attachmentSessionTimerKey(projectKey, sessionKey, options) {
  return path.resolve(attachmentSessionLockPathFromKeys(projectKey, sessionKey, options));
}

/**
 * @param {string} executionRoot
 * @param {string} sessionId
 * @param {string} attachmentId one attachment's folder, or "" for the session's
 * @param {AttachmentRootOptions} options
 */
function attachmentHostDirectory(executionRoot, sessionId, attachmentId, options) {
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

/** @param {import("node:fs").Dirent} entry */
function isSuggestionPin(entry) {
  return entry.isFile() && entry.name.startsWith(ATTACHMENT_SUGGESTION_PIN_PREFIX);
}

/**
 * An attachment refusal. `options` carries `messageCode` for a refusal that keeps a code callers branch on.
 */
function attachmentUploadValidationError(code, message, statusCode = 400, options = {}) {
  return new AppError(statusCode, message, { ...options, code });
}

function waitForAttachmentLock() {
  return new Promise((resolve) => setTimeout(resolve, ATTACHMENT_LOCK_POLL_MS));
}

function attachmentLockWaitMs(options = {}, fallback = 0) {
  const configured = Number(options.lockWaitMs);
  return Number.isFinite(configured) && configured >= 0 ? configured : fallback;
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

async function acquireAttachmentDirectoryLock(directory, options = {}) {
  const {
    waitMs = 0
  } = options;
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

/**
 * @param {string} executionRoot
 * @param {string} sessionId
 * @param {AttachmentRootOptions} options
 * @param {{ waitMs?: number }} lockOptions
 */
async function acquireAttachmentSessionLock(
  executionRoot,
  sessionId,
  options,
  lockOptions
) {
  const [projectKey, sessionKey] = attachmentSessionKey(executionRoot, sessionId).split(path.sep);
  return acquireAttachmentSessionKeyLock(projectKey, sessionKey, options, lockOptions);
}

/**
 * @param {string} projectKey
 * @param {string} sessionKey
 * @param {AttachmentRootOptions} lockOptions
 * @param {{ waitMs?: number }} options
 */
async function acquireAttachmentSessionKeyLock(
  projectKey,
  sessionKey,
  lockOptions,
  options
) {
  const {
    waitMs = 0
  } = options;
  const lockPath = path.join(attachmentLocksRoot(lockOptions), projectKey, `${sessionKey}.lock`);
  const lockDirectory = path.dirname(lockPath);
  await mkdir(lockDirectory, { mode: vibe64SharedModes().directory, recursive: true });
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

export {
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
};
