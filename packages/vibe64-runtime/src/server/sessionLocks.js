import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, rm, stat } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  vibe64Error,
  isPlainObject,
  isMissingPathError,
  normalizeText
} from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import {
  processStartIdentityPlatform,
  readProcessStart
} from "@local/vibe64-execution/server";
import { writeJsonFile } from "./sessionFiles.js";

// Cross-process session locks: a lock is a directory under sessionsRoot/.locks
// whose owner.json names the holding process, so abandoned locks can be
// recognised and quarantined.
const SESSION_LOCK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SESSION_LOCK_OWNER_GRACE_MS = 2_000;
const SESSION_LOCK_OWNER_SCHEMA_VERSION = 1;
const SESSION_LOCK_POLL_MS = 20;
const SESSION_LOCK_PROCESS_IDENTITY_PID_ONLY_PLATFORM = "pid-only";
const sessionLockWaiters = new Map();

function delay(milliseconds = 0) {
  return new Promise((resolve) => {
    setTimeout(resolve, milliseconds);
  });
}

function processIsAlive(pid) {
  const normalizedPid = Number(pid);
  if (!Number.isSafeInteger(normalizedPid) || normalizedPid <= 0) {
    return false;
  }
  try {
    process.kill(normalizedPid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

// Locks record only owners whose state letter is upper case; any other observed
// state stays ambiguous.
const LOCK_OWNER_STATE_PATTERN = /^[A-Z]$/u;
// Where the owner check spawns ps, a contended waiter reuses a live answer
// briefly instead of probing on every poll.
const SESSION_LOCK_OWNER_PROBE_REUSE_MS = 250;
const recentLiveSessionLockOwners = new Map();
// The server's own start identity never changes, so it is read once per platform.
const ownSessionLockProcessIdentities = new Map();

function currentSessionLockProcessIdentity(processPlatform = process.platform) {
  const platform = processStartIdentityPlatform(processPlatform);
  if (!platform) {
    return Promise.resolve({
      platform: SESSION_LOCK_PROCESS_IDENTITY_PID_ONLY_PLATFORM,
      startTimeTicks: ""
    });
  }
  if (!ownSessionLockProcessIdentities.has(platform)) {
    const pending = readProcessStart(process.pid, { platform: processPlatform }).then((observed) => {
      if (observed.status !== "exact" || !LOCK_OWNER_STATE_PATTERN.test(observed.state)) {
        throw vibe64Error(
          "Vibe64 could not establish the session-lock owner process identity.",
          "vibe64_session_lock_process_identity_unavailable"
        );
      }
      return {
        platform,
        startTimeTicks: observed.startTimeTicks
      };
    });
    pending.catch(() => ownSessionLockProcessIdentities.delete(platform));
    ownSessionLockProcessIdentities.set(platform, pending);
  }
  return ownSessionLockProcessIdentities.get(platform);
}

async function observeSessionLockOwner(pid, identity = {}) {
  const reusable = processStartIdentityPlatform() === "darwin-ps";
  const key = `${pid}:${normalizeText(identity.startTimeTicks)}`;
  const recent = reusable ? recentLiveSessionLockOwners.get(key) : null;
  if (recent && Date.now() - recent.atMs < SESSION_LOCK_OWNER_PROBE_REUSE_MS) {
    return recent.observed;
  }
  const observed = await readProcessStart(pid);
  if (reusable) {
    for (const [entryKey, entry] of recentLiveSessionLockOwners) {
      if (Date.now() - entry.atMs >= SESSION_LOCK_OWNER_PROBE_REUSE_MS) {
        recentLiveSessionLockOwners.delete(entryKey);
      }
    }
    if (observed.status === "exact") {
      recentLiveSessionLockOwners.set(key, { atMs: Date.now(), observed });
    }
  }
  return observed;
}

async function sessionLockOwnerProcessStatus(owner = {}) {
  const pid = Number(owner?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return "ambiguous";
  }
  const identity = isPlainObject(owner?.processIdentity)
    ? owner.processIdentity
    : {};
  const observed = await observeSessionLockOwner(pid, identity);
  if (observed.status === "absent") {
    return "absent";
  }
  if (
    Number(owner?.schemaVersion) !== SESSION_LOCK_OWNER_SCHEMA_VERSION ||
    normalizeText(identity.platform) !== processStartIdentityPlatform() ||
    !/^\d+$/u.test(normalizeText(identity.startTimeTicks)) ||
    observed.status !== "exact" ||
    !LOCK_OWNER_STATE_PATTERN.test(observed.state)
  ) {
    return processIsAlive(pid) ? "ambiguous" : "absent";
  }
  return observed.startTimeTicks === normalizeText(identity.startTimeTicks)
    ? "exact"
    : "reused";
}

function sessionLockPath(sessionPaths, lockName = "") {
  const normalizedLockName = normalizeText(lockName);
  if (!SESSION_LOCK_NAME_PATTERN.test(normalizedLockName)) {
    throw vibe64Error(`Invalid vibe64 session lock name: ${normalizedLockName || "(empty)"}`, "vibe64_session_lock_name_invalid");
  }
  return path.join(
    sessionPaths.sessionsRoot,
    ".locks",
    sessionPaths.sessionId,
    `${normalizedLockName}.lock`
  );
}

async function readSessionLockOwner(lockPath = "") {
  try {
    return JSON.parse(await readFile(path.join(lockPath, "owner.json"), "utf8"));
  } catch {
    return null;
  }
}

async function sessionLockIsAbandoned(lockPath = "") {
  const owner = await readSessionLockOwner(lockPath);
  if (owner?.pid) {
    return ["absent", "reused"].includes(
      await sessionLockOwnerProcessStatus(owner)
    );
  }
  try {
    const lockStat = await stat(lockPath);
    return Date.now() - lockStat.mtimeMs >= SESSION_LOCK_OWNER_GRACE_MS;
  } catch (error) {
    return isMissingPathError(error);
  }
}

async function quarantineAbandonedSessionLock(lockPath = "") {
  if (!await sessionLockIsAbandoned(lockPath)) {
    return false;
  }
  const quarantinePath = `${lockPath}.abandoned.${process.pid}.${randomUUID()}`;
  try {
    await rename(lockPath, quarantinePath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return true;
    }
    return false;
  }
  await rm(quarantinePath, {
    force: true,
    recursive: true
  });
  return true;
}

async function acquireSessionLock(sessionPaths, lockName = "", {
  // The caller retries or falls back, so a refusal is routine information.
  expectedRefusal = false,
  logger = null,
  onRejected = null,
  operation = "",
  processPlatform = process.platform,
  waitMs = 0
} = {}) {
  const lockPath = sessionLockPath(sessionPaths, lockName);
  const lockRoot = path.dirname(lockPath);
  const processIdentity = await currentSessionLockProcessIdentity(processPlatform);
  const token = randomUUID();
  const attemptId = randomUUID();
  const startedAtMs = Date.now();
  let contentionLogged = false;
  function logLockEvent(event, fields = {}) {
    if (!operation) {
      return;
    }
    try {
      const warning = event === "contended" || (event === "rejected" && !expectedRefusal);
      logOperationalEvent(logger, warning ? "warn" : "info", {
        component: "vibe64.session_lock",
        event: `vibe64.session_lock.${event}`,
        projectRoot: sessionPaths.projectContextRoot,
        sessionId: sessionPaths.sessionId,
        lockName,
        operation,
        attemptId,
        pid: process.pid,
        waitMs,
        ...fields
      }, `Session lock ${event}.`);
    } catch {
      // Diagnostics must never affect lock ownership or operation admission.
    }
  }
  // Keep newer polling reads behind requests already waiting in this process.
  // The filesystem lock still arbitrates ownership across processes.
  const waiters = sessionLockWaiters.get(lockPath) || new Set();
  sessionLockWaiters.set(lockPath, waiters);
  waiters.add(attemptId);
  try {
    await mkdir(lockRoot, { recursive: true });
    while (true) {
      if (waiters.values().next().value === attemptId) {
        try {
          await mkdir(lockPath, { mode: 0o700 });
          const acquiredAtMs = Date.now();
          try {
            await writeJsonFile(path.join(lockPath, "owner.json"), {
              createdAt: new Date(acquiredAtMs).toISOString(),
              operation: operation || lockName,
              attemptId,
              pid: process.pid,
              processIdentity,
              schemaVersion: SESSION_LOCK_OWNER_SCHEMA_VERSION,
              token
            });
          } catch (error) {
            await rm(lockPath, { force: true, recursive: true });
            throw error;
          }
          logLockEvent("acquired", { waitedMs: Date.now() - startedAtMs });
          return async () => {
            const owner = await readSessionLockOwner(lockPath);
            if (normalizeText(owner?.token) !== token) {
              return;
            }
            const releasedPath = `${lockPath}.released.${process.pid}.${token}`;
            try {
              await rename(lockPath, releasedPath);
            } catch (error) {
              if (isMissingPathError(error)) {
                return;
              }
              throw error;
            }
            await rm(releasedPath, { force: true, recursive: true });
            logLockEvent("released", { heldMs: Date.now() - acquiredAtMs });
          };
        } catch (error) {
          if (error?.code !== "EEXIST") {
            throw error;
          }
          if (await quarantineAbandonedSessionLock(lockPath)) {
            continue;
          }
        }
      }
      const waitedMs = Date.now() - startedAtMs;
      const rejected = waitedMs >= waitMs;
      if (rejected || (operation && !contentionLogged)) {
        const owner = await readSessionLockOwner(lockPath);
        if (rejected) {
          onRejected?.(normalizeText(owner?.operation));
        }
        const acquiredAtMs = Date.parse(owner?.createdAt);
        logLockEvent(rejected ? "rejected" : "contended", {
          waitedMs,
          owner: owner ? {
            operation: normalizeText(owner.operation) || "unknown",
            attemptId: normalizeText(owner.attemptId),
            pid: owner.pid,
            createdAt: owner.createdAt,
            heldMs: Number.isFinite(acquiredAtMs) ? Math.max(0, Date.now() - acquiredAtMs) : null,
            processStatus: await sessionLockOwnerProcessStatus(owner)
          } : null
        });
        contentionLogged = true;
      }
      if (rejected) {
        return null;
      }
      await delay(Math.min(SESSION_LOCK_POLL_MS, Math.max(1, waitMs - (Date.now() - startedAtMs))));
    }
  } finally {
    waiters.delete(attemptId);
    if (waiters.size === 0) sessionLockWaiters.delete(lockPath);
  }
}

export {
  acquireSessionLock,
  sessionLockIsAbandoned,
  sessionLockPath
};
