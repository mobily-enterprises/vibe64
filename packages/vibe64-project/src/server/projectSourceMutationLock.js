import crypto from "node:crypto";
import process from "node:process";
import path from "node:path";
import {
  mkdir,
  open,
  readFile,
  rm,
  stat
} from "node:fs/promises";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";

const DEFAULT_LOCK_TIMEOUT_MS = 30_000;
const SESSION_POLICY_LOCK_TIMEOUT_MS = 300_000;
const LOCK_POLL_MS = 40;

function text(value = "") {
  return String(value || "").trim();
}

function lockError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function processAlive(pid) {
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return false;
  }
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error?.code === "EPERM";
  }
}

async function lockOwner(lockPath) {
  try {
    return JSON.parse(await readFile(lockPath, "utf8"));
  } catch {
    return null;
  }
}

async function removeStaleLock(lockPath) {
  const [owner, details] = await Promise.all([
    lockOwner(lockPath),
    stat(lockPath).catch(() => null)
  ]);
  if (!details) {
    return true;
  }
  if (owner && processAlive(Number(owner.pid))) {
    return false;
  }
  const staleForMs = Date.now() - details.mtimeMs;
  if (owner || staleForMs >= DEFAULT_LOCK_TIMEOUT_MS) {
    await rm(lockPath, { force: true });
    return true;
  }
  return false;
}

function sleep(durationMs) {
  return new Promise((resolve) => setTimeout(resolve, durationMs));
}

async function acquireProjectOperationLock(projectRuntimeRoot, lockName, {
  operation = "project-source-mutation",
  rootErrorCode = "vibe64_project_source_lock_root_invalid",
  rootErrorLabel = "Project source mutation locking",
  timeoutErrorCode = "vibe64_project_source_lock_timeout",
  timeoutErrorMessage = "Another project source operation is still running.",
  timeoutMs = DEFAULT_LOCK_TIMEOUT_MS
} = {}) {
  const root = text(projectRuntimeRoot);
  if (!path.isAbsolute(root)) {
    throw lockError(
      `${rootErrorLabel} requires an absolute project runtime root.`,
      rootErrorCode
    );
  }
  const lockRoot = path.join(root, "locks");
  const lockPath = path.join(lockRoot, lockName);
  await mkdir(lockRoot, { recursive: true, mode: vibe64SharedModes().inheritingDirectory });
  const token = crypto.randomUUID();
  const deadline = Date.now() + Math.max(1, Number(timeoutMs) || DEFAULT_LOCK_TIMEOUT_MS);
  while (Date.now() <= deadline) {
    let handle;
    try {
      handle = await open(lockPath, "wx", vibe64SharedModes().file);
      await handle.writeFile(`${JSON.stringify({
        operation: text(operation),
        pid: process.pid,
        token
      })}\n`, "utf8");
      await handle.close();
      return {
        lockPath,
        token
      };
    } catch (error) {
      await handle?.close().catch(() => null);
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (!await removeStaleLock(lockPath)) {
        await sleep(LOCK_POLL_MS);
      }
    }
  }
  throw lockError(
    timeoutErrorMessage,
    timeoutErrorCode
  );
}

async function acquireProjectSourceMutationLock(projectRuntimeRoot, options = {}) {
  return acquireProjectOperationLock(projectRuntimeRoot, "source-mutation.lock", options);
}

async function acquireProjectSessionPolicyLock(projectRuntimeRoot, options = {}) {
  return acquireProjectOperationLock(projectRuntimeRoot, "session-policy.lock", {
    operation: "session-policy",
    rootErrorCode: "vibe64_project_session_policy_lock_root_invalid",
    rootErrorLabel: "Project session policy locking",
    timeoutErrorCode: "vibe64_project_session_policy_lock_timeout",
    timeoutErrorMessage: "Another project session operation is still running.",
    timeoutMs: SESSION_POLICY_LOCK_TIMEOUT_MS,
    ...options
  });
}

async function releaseProjectOperationLock(lock = {}) {
  const owner = await lockOwner(lock.lockPath);
  if (owner?.token === lock.token && owner?.pid === process.pid) {
    await rm(lock.lockPath, { force: true });
    return true;
  }
  return false;
}

async function releaseProjectSourceMutationLock(lock = {}) {
  return releaseProjectOperationLock(lock);
}

async function releaseProjectSessionPolicyLock(lock = {}) {
  return releaseProjectOperationLock(lock);
}

async function runProjectSourceExclusive(projectRuntimeRoot, operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("runProjectSourceExclusive requires an operation.");
  }
  const lock = await acquireProjectSourceMutationLock(projectRuntimeRoot, options);
  try {
    return await operation();
  } finally {
    await releaseProjectSourceMutationLock(lock);
  }
}

async function runProjectSessionPolicyExclusive(projectRuntimeRoot, operation, options = {}) {
  if (typeof operation !== "function") {
    throw new TypeError("runProjectSessionPolicyExclusive requires an operation.");
  }
  const lock = await acquireProjectSessionPolicyLock(projectRuntimeRoot, options);
  try {
    return await operation();
  } finally {
    await releaseProjectSessionPolicyLock(lock);
  }
}

export {
  acquireProjectSessionPolicyLock,
  acquireProjectSourceMutationLock,
  releaseProjectSessionPolicyLock,
  releaseProjectSourceMutationLock,
  runProjectSessionPolicyExclusive,
  runProjectSourceExclusive
};
