import { AsyncLocalStorage } from "node:async_hooks";
import path from "node:path";
import {
  createConversationOperationLease as createSessionOperationLease,
  beginConversationOperation as beginSessionOperation,
  finishConversationOperation as finishSessionOperation
} from "@jskit-ai/assistant-core/server/conversation";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { writeJsonFile } from "./sessionFiles.js";
import { acquireSessionLock, sessionLockPath } from "./sessionLocks.js";
import { assertValidVibe64SessionId, SESSION_RENEWAL_STATE_FILE_PATTERN } from "./sessionRecordRules.js";
import { readDirectoryEntries, readTextIfExists, sortedFileNames } from "./sessionStoreLayout.js";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */

const SESSION_MUTATION_LOCK_WAIT_MS = 60_000;
const sessionMutationChains = new Map();
const sessionExclusiveContext = new AsyncLocalStorage();

function enqueueSessionMutation(key, operation) {
  const previous = sessionMutationChains.get(key) || Promise.resolve();
  const queued = previous.catch(() => null).then(operation);
  const stored = queued.catch(() => null).finally(() => {
    if (sessionMutationChains.get(key) === stored) {
      sessionMutationChains.delete(key);
    }
  });
  sessionMutationChains.set(key, stored);
  return queued;
}

/**
 * The store's locks: in-process writer queues under cross-process session
 * locks, re-entrant exclusive sections, and the renewal state records
 * written under the renewal state lock.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 */
function createSessionStoreLocks({ state, storePaths }) {
  function acquireStoreSessionLock(sessionPaths, lockName = "", options = {}) {
    return acquireSessionLock(sessionPaths, lockName, {
      ...options,
      logger: state.logger,
      processPlatform: state.sessionLockProcessPlatform
    });
  }

  /**
   * Serialize in-process writers on queueKey, then hold the cross-process
   * session lock for the operation.
   */
  function withQueuedSessionLock(queueKey, sessionPaths, lockName, { timeoutMessage, timeoutCode }, operation) {
    return enqueueSessionMutation(queueKey, async () => {
      const release = await acquireStoreSessionLock(sessionPaths, lockName, {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(timeoutMessage, timeoutCode);
      }
      try {
        return await operation();
      } finally {
        await release();
      }
    });
  }

  async function readSessionRenewalStateRecord(sessionId = "") {
    return readTextIfExists(storePaths.renewalStatePath(sessionId));
  }

  async function writeSessionRenewalStateRecord(sessionId = "", value = {}) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    await writeJsonFile(storePaths.renewalStatePath(normalizedSessionId), value);
    return value;
  }

  async function listSessionRenewalStateSessionIds() {
    return sortedFileNames(
      await readDirectoryEntries(storePaths.renewalStateRoot()),
      (name) => SESSION_RENEWAL_STATE_FILE_PATTERN.test(name)
    ).map((name) => name.match(SESSION_RENEWAL_STATE_FILE_PATTERN)?.[1] || "")
      .filter(Boolean);
  }

  async function runSessionRenewalStateExclusive(sessionId = "", operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Session renewal state mutation requires an operation.");
    }
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const statePath = storePaths.renewalStatePath(normalizedSessionId);
    const lockPaths = storePaths.pathsForSessionRoot(normalizedSessionId, "");
    return withQueuedSessionLock(statePath, lockPaths, "renewal-state", {
      timeoutMessage: `Timed out waiting to update Vibe64 session renewal: ${normalizedSessionId}`,
      timeoutCode: "vibe64_session_renewal_state_lock_timeout"
    }, operation);
  }

  async function runSessionRenewalWorkflowExclusive(sessionId = "", operation, {
    waitMs = 0
  } = {}) {
    if (typeof operation !== "function") {
      throw new TypeError("Session renewal workflow requires an operation.");
    }
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const lockPaths = storePaths.pathsForSessionRoot(normalizedSessionId, "");
    const lockPath = sessionLockPath(lockPaths, "renewal-workflow");
    return runReentrantExclusive(lockPath, async () => {
      const release = await acquireStoreSessionLock(lockPaths, "renewal-workflow", {
        waitMs
      });
      return release ? { release } : {
        rejected: {
          acquired: false,
          value: null
        }
      };
    }, operation);
  }

  /**
   * Run operation under lockPath. A caller already inside that lock joins the
   * existing lease; otherwise acquire() takes the lock or names the rejection.
   */
  async function runReentrantExclusive(lockPath, acquire, operation, beforeOperation = null) {
    const activeLocks = sessionExclusiveContext.getStore();
    const inheritedContext = activeLocks?.get(lockPath);
    if (inheritedContext?.participant?.active === true) {
      const participant = beginSessionOperation(inheritedContext.lease);
      const nestedLocks = new Map(activeLocks);
      nestedLocks.set(lockPath, {
        lease: inheritedContext.lease,
        participant
      });
      try {
        return {
          acquired: true,
          value: await sessionExclusiveContext.run(nestedLocks, operation)
        };
      } finally {
        finishSessionOperation(inheritedContext.lease, participant);
      }
    }
    const { rejected, release } = await acquire();
    if (!release) {
      return rejected;
    }
    const lease = createSessionOperationLease();
    const participant = beginSessionOperation(lease);
    const nextLocks = new Map(activeLocks || []);
    nextLocks.set(lockPath, {
      lease,
      participant
    });
    try {
      if (beforeOperation) {
        await beforeOperation();
      }
      return await sessionExclusiveContext.run(nextLocks, async () => ({
        acquired: true,
        value: await operation()
      }));
    } finally {
      finishSessionOperation(lease, participant);
      await lease.idle;
      await release();
    }
  }

  async function runSessionArchiveExclusive(sessionId, operation) {
    const sessionPaths = storePaths.paths(sessionId);
    const archiveLockPath = sessionLockPath(sessionPaths, "archive");
    return withQueuedSessionLock(archiveLockPath, sessionPaths, "archive", {
      timeoutMessage: `Timed out waiting to archive Vibe64 session: ${sessionPaths.sessionId}`,
      timeoutCode: "vibe64_session_archive_lock_timeout"
    }, operation);
  }

  async function runRenewalTransitionExclusive(operation) {
    const rootPaths = storePaths.paths();
    const transitionPaths = storePaths.pathsForSessionRoot("renewal-transitions", "");
    const transitionKey = path.join(rootPaths.sessionsRoot, ".renewal-transition");
    return withQueuedSessionLock(transitionKey, transitionPaths, "transition", {
      timeoutMessage: "Timed out waiting to transition renewed Vibe64 sessions.",
      timeoutCode: "vibe64_session_renewal_transition_lock_timeout"
    }, operation);
  }

  return Object.freeze({
    acquireStoreSessionLock,
    listSessionRenewalStateSessionIds,
    readSessionRenewalStateRecord,
    runReentrantExclusive,
    runRenewalTransitionExclusive,
    runSessionArchiveExclusive,
    runSessionRenewalStateExclusive,
    runSessionRenewalWorkflowExclusive,
    withQueuedSessionLock,
    writeSessionRenewalStateRecord
  });
}

export {
  createSessionStoreLocks,
  SESSION_MUTATION_LOCK_WAIT_MS,
  enqueueSessionMutation
};
