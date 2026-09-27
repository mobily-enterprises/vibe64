import crypto from "node:crypto";
import { link, mkdir, open, readdir, rename, rm } from "node:fs/promises";
import path from "node:path";

import {
  tryAcquireExclusiveFileLock
} from "@local/vibe64-execution/server";
import {
  vibe64AgentExecutionProfileAuditSnapshot
} from "@local/vibe64-runtime/shared";

const CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION = 1;
const CODEX_HELPER_THREAD_LEDGER_DIRECTORY = "codex-helper-thread-ownership";
const CODEX_HELPER_THREAD_LEDGER_MAX_FILE_BYTES = 64 * 1024;
const CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS = 1024;
const CODEX_HELPER_THREAD_LEDGER_LOCK_WAIT_MS = 5000;
const CODEX_HELPER_THREAD_LEDGER_LOCK_POLL_MS = 20;
const codexHelperThreadLedgerMutationQueues = new Map();
const codexHelperThreadLedgerProcessId = crypto.randomUUID();
const CODEX_HELPER_THREAD_LIFECYCLES = Object.freeze({
  ACTIVE: "active",
  CLEANUP_REQUIRED: "cleanup_required",
  READY: "ready",
  STARTING_TURN: "starting_turn"
});
const CODEX_HELPER_THREAD_LIFECYCLE_VALUES = new Set(
  Object.values(CODEX_HELPER_THREAD_LIFECYCLES)
);
const RECORD_KEYS = Object.freeze([
  "createdAt",
  "executionProfile",
  "identity",
  "lifecycle",
  "ownershipId",
  "projectContextRoot",
  "projectRuntimeRoot",
  "revision",
  "schemaVersion",
  "sessionId",
  "threadId",
  "turnId",
  "updatedAt",
  "workdir"
]);
const IDENTITY_KEYS = Object.freeze([
  "providerId",
  "providerKeyFingerprint",
  "runtime",
  "server",
  "transportId"
]);
const RUNTIME_IDENTITY_KEYS = Object.freeze([
  "accountIdentitySignature",
  "authStateSignature",
  "endpoint",
  "executionMode",
  "executionContextHash",
  "provider",
  "runtimeDir",
  "runtimesHash",
  "terminalEnvHash",
  "toolHomeSource",
  "transport"
]);
const SERVER_IDENTITY_KEYS = Object.freeze([
  "userAgent"
]);
const PROFILE_KEYS = Object.freeze([
  "limits",
  "model",
  "policy",
  "profileId",
  "providerId",
  "request",
  "revision",
  "thinking",
  "workloadId"
]);
const PROFILE_LIMIT_KEYS = Object.freeze([
  "maxInputCharacters",
  "maxOutputCharacters",
  "timeoutMs"
]);
const PROFILE_POLICY_KEYS = Object.freeze([
  "environmentAccess",
  "networkAccess",
  "repositoryWrite",
  "tools"
]);
const PROFILE_REQUEST_KEYS = Object.freeze([
  "allowProviderModelFallback",
  "reasoning",
  "summary"
]);

function normalizeText(value) {
  return String(value ?? "").trim();
}

function isRecord(value) {
  return Boolean(value && typeof value === "object" && !Array.isArray(value));
}

function ledgerError(message = "", code = "vibe64_codex_helper_ledger_invalid") {
  const error = new Error(normalizeText(message) || "Codex helper ownership record is invalid.");
  error.code = code;
  error.retryable = true;
  return error;
}

function assertExactKeys(value, expectedKeys, label) {
  if (!isRecord(value)) {
    throw ledgerError(`${label} must be an object.`);
  }
  const actual = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  if (
    actual.length !== expected.length ||
    actual.some((key, index) => key !== expected[index])
  ) {
    throw ledgerError(`${label} has an unsupported shape.`);
  }
}

function requiredText(value, label, maxLength = 4096) {
  const normalized = normalizeText(value);
  if (!normalized) {
    throw ledgerError(`${label} is required.`);
  }
  if (normalized.length > maxLength) {
    throw ledgerError(`${label} exceeds ${maxLength} characters.`);
  }
  return normalized;
}

function requiredSha256Signature(value, label) {
  const signature = requiredText(value, label, 71);
  if (!/^sha256:[a-f0-9]{64}$/u.test(signature)) {
    throw ledgerError(`${label} must be a SHA-256 signature.`);
  }
  return signature;
}

function requiredVersionedStateSignature(value, label) {
  const signature = requiredText(value, label, 32);
  if (!/^v[1-9][0-9]*:[a-f0-9]{24}$/u.test(signature)) {
    throw ledgerError(`${label} must be a versioned state signature.`);
  }
  return signature;
}

function requiredStableHash(value, label) {
  const hash = requiredText(value, label, 12);
  if (!/^[a-f0-9]{12}$/u.test(hash)) {
    throw ledgerError(`${label} must be a stable hash.`);
  }
  return hash;
}

function optionalText(value, label = "value", maxLength = 4096) {
  const normalized = normalizeText(value);
  if (normalized.length > maxLength) {
    throw ledgerError(`${label} exceeds ${maxLength} characters.`);
  }
  return normalized;
}

function absolutePath(value, label) {
  const normalized = requiredText(value, label, 8192);
  if (!path.isAbsolute(normalized) || path.normalize(normalized) !== normalized) {
    throw ledgerError(`${label} must be a normalized absolute path.`);
  }
  return normalized;
}

function optionalAbsolutePath(value, label) {
  const normalized = optionalText(value, label, 8192);
  if (normalized && (!path.isAbsolute(normalized) || path.normalize(normalized) !== normalized)) {
    throw ledgerError(`${label} must be a normalized absolute path when present.`);
  }
  return normalized;
}

function timestamp(value, label) {
  const normalized = requiredText(value, label);
  const parsed = Date.parse(normalized);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== normalized) {
    throw ledgerError(`${label} must be an ISO timestamp.`);
  }
  return normalized;
}

function positiveInteger(value, label) {
  const normalized = Number(value);
  if (!Number.isSafeInteger(normalized) || normalized < 1) {
    throw ledgerError(`${label} must be a positive integer.`);
  }
  return normalized;
}

function strictExecutionProfile(value) {
  assertExactKeys(value, PROFILE_KEYS, "executionProfile");
  assertExactKeys(value.limits, PROFILE_LIMIT_KEYS, "executionProfile.limits");
  assertExactKeys(value.policy, PROFILE_POLICY_KEYS, "executionProfile.policy");
  assertExactKeys(value.request, PROFILE_REQUEST_KEYS, "executionProfile.request");
  return vibe64AgentExecutionProfileAuditSnapshot(value);
}

function strictIdentity(value) {
  assertExactKeys(value, IDENTITY_KEYS, "identity");
  assertExactKeys(value.runtime, RUNTIME_IDENTITY_KEYS, "identity.runtime");
  assertExactKeys(value.server, SERVER_IDENTITY_KEYS, "identity.server");
  const runtime = value.runtime;
  const providerId = requiredText(value.providerId, "identity.providerId", 64);
  const executionMode = requiredText(
    runtime.executionMode,
    "identity.runtime.executionMode",
    64
  );
  const provider = requiredText(runtime.provider, "identity.runtime.provider");
  const toolHomeSource = optionalAbsolutePath(
    runtime.toolHomeSource,
    "identity.runtime.toolHomeSource"
  );
  const transportId = requiredText(value.transportId, "identity.transportId", 64);
  const transport = requiredText(runtime.transport, "identity.runtime.transport", 64);
  const endpoint = requiredText(runtime.endpoint, "identity.runtime.endpoint", 8192);
  const endpointPath = endpoint.startsWith("unix://") ? endpoint.slice("unix://".length) : "";
  if (
    providerId !== "codex" ||
    !["helper", "interactive"].includes(executionMode) ||
    provider !== "codex_app_server" ||
    transport !== "unix" ||
    !endpointPath ||
    !path.isAbsolute(endpointPath) ||
    path.normalize(endpointPath) !== endpointPath ||
    transportId !== "codex_app_server"
  ) {
    throw ledgerError(
      "Codex helper ownership identity must use the managed Codex app-server."
    );
  }
  return Object.freeze({
    providerId,
    providerKeyFingerprint: requiredSha256Signature(
      value.providerKeyFingerprint,
      "identity.providerKeyFingerprint"
    ),
    runtime: Object.freeze({
      accountIdentitySignature: requiredSha256Signature(
        runtime.accountIdentitySignature,
        "identity.runtime.accountIdentitySignature"
      ),
      authStateSignature: requiredVersionedStateSignature(
        runtime.authStateSignature,
        "identity.runtime.authStateSignature"
      ),
      endpoint,
      executionMode,
      executionContextHash: requiredStableHash(
        runtime.executionContextHash,
        "identity.runtime.executionContextHash"
      ),
      provider,
      runtimeDir: absolutePath(runtime.runtimeDir, "identity.runtime.runtimeDir"),
      runtimesHash: requiredStableHash(
        runtime.runtimesHash,
        "identity.runtime.runtimesHash"
      ),
      terminalEnvHash: requiredStableHash(
        runtime.terminalEnvHash,
        "identity.runtime.terminalEnvHash"
      ),
      toolHomeSource,
      transport
    }),
    server: Object.freeze({
      userAgent: requiredText(value.server.userAgent, "identity.server.userAgent", 512)
    }),
    transportId
  });
}

function codexHelperThreadRecordId({
  projectRuntimeRoot = "",
  sessionId = "",
  threadId = ""
} = {}) {
  return crypto.createHash("sha256").update([
    absolutePath(projectRuntimeRoot, "projectRuntimeRoot"),
    requiredText(sessionId, "sessionId", 256),
    requiredText(threadId, "threadId", 256)
  ].join("\0")).digest("hex");
}

function defineCodexHelperThreadRecord(value = {}) {
  assertExactKeys(value, RECORD_KEYS, "Codex helper ownership record");
  if (Number(value.schemaVersion) !== CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION) {
    throw ledgerError(
      `Unsupported Codex helper ownership schema: ${String(value.schemaVersion ?? "missing")}.`
    );
  }
  const lifecycle = requiredText(value.lifecycle, "lifecycle");
  if (!CODEX_HELPER_THREAD_LIFECYCLE_VALUES.has(lifecycle)) {
    throw ledgerError(`Unsupported Codex helper ownership lifecycle: ${lifecycle}.`);
  }
  const turnId = optionalText(value.turnId);
  if (lifecycle === CODEX_HELPER_THREAD_LIFECYCLES.ACTIVE && !turnId) {
    throw ledgerError("An active Codex helper ownership record requires turnId.");
  }
  if (lifecycle === CODEX_HELPER_THREAD_LIFECYCLES.READY && turnId) {
    throw ledgerError(`${lifecycle} Codex helper ownership cannot retain turnId.`);
  }
  const createdAt = timestamp(value.createdAt, "createdAt");
  const updatedAt = timestamp(value.updatedAt, "updatedAt");
  if (Date.parse(updatedAt) < Date.parse(createdAt)) {
    throw ledgerError("updatedAt cannot precede createdAt.");
  }
  return Object.freeze({
    createdAt,
    executionProfile: strictExecutionProfile(value.executionProfile),
    identity: strictIdentity(value.identity),
    lifecycle,
    ownershipId: requiredText(value.ownershipId, "ownershipId", 128),
    projectContextRoot: absolutePath(value.projectContextRoot, "projectContextRoot"),
    projectRuntimeRoot: absolutePath(value.projectRuntimeRoot, "projectRuntimeRoot"),
    revision: positiveInteger(value.revision, "revision"),
    schemaVersion: CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
    sessionId: requiredText(value.sessionId, "sessionId", 256),
    threadId: requiredText(value.threadId, "threadId", 256),
    turnId: optionalText(turnId, "turnId", 256),
    updatedAt,
    workdir: absolutePath(value.workdir, "workdir")
  });
}

function codexHelperThreadLedgerRoot(projectRuntimeRoot = "") {
  return path.join(
    absolutePath(projectRuntimeRoot, "projectRuntimeRoot"),
    CODEX_HELPER_THREAD_LEDGER_DIRECTORY
  );
}

function recordsMatch(left = {}, right = {}) {
  return JSON.stringify(left) === JSON.stringify(right);
}

function stableOwnershipMatches(left = {}, right = {}) {
  return left.createdAt === right.createdAt &&
    JSON.stringify(left.executionProfile) === JSON.stringify(right.executionProfile) &&
    JSON.stringify(left.identity) === JSON.stringify(right.identity) &&
    left.ownershipId === right.ownershipId &&
    left.projectContextRoot === right.projectContextRoot &&
    left.projectRuntimeRoot === right.projectRuntimeRoot &&
    left.sessionId === right.sessionId &&
    left.threadId === right.threadId &&
    left.workdir === right.workdir;
}

function delay(milliseconds = 0) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readBoundedFile(
  filePath = "",
  maxBytes = CODEX_HELPER_THREAD_LEDGER_MAX_FILE_BYTES
) {
  const handle = await open(filePath, "r");
  try {
    const buffer = Buffer.alloc(maxBytes + 1);
    const { bytesRead } = await handle.read(buffer, 0, buffer.length, 0);
    if (bytesRead > maxBytes) {
      throw ledgerError(
        `Codex helper ownership state exceeds ${maxBytes} bytes: ${path.basename(filePath)}.`
      );
    }
    return buffer.subarray(0, bytesRead).toString("utf8");
  } finally {
    await handle.close();
  }
}

async function syncDirectory(directory = "") {
  const handle = await open(directory, "r");
  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

async function readRecordFile(filePath = "") {
  let value;
  try {
    value = JSON.parse(await readBoundedFile(filePath));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw error;
    }
    throw ledgerError(
      `Codex helper ownership record cannot be read: ${path.basename(filePath)} (${error.message})`
    );
  }
  const record = defineCodexHelperThreadRecord(value);
  if (path.basename(filePath) !== `${codexHelperThreadRecordId(record)}.json`) {
    throw ledgerError(
      `Codex helper ownership record filename does not match its identity: ${path.basename(filePath)}.`
    );
  }
  return record;
}

async function withMutationQueue(key = "", callback = async () => undefined) {
  const previous = codexHelperThreadLedgerMutationQueues.get(key) || Promise.resolve();
  let release = () => undefined;
  const current = new Promise((resolve) => {
    release = resolve;
  });
  codexHelperThreadLedgerMutationQueues.set(key, current);
  await previous.catch(() => null);
  try {
    return await callback();
  } finally {
    release();
    if (codexHelperThreadLedgerMutationQueues.get(key) === current) {
      codexHelperThreadLedgerMutationQueues.delete(key);
    }
  }
}

function defineLockOwner(value = {}) {
  assertExactKeys(
    value,
    ["createdAt", "pid", "processId", "token"],
    "Codex helper ownership lock"
  );
  return Object.freeze({
    createdAt: timestamp(value.createdAt, "lock.createdAt"),
    pid: positiveInteger(value.pid, "lock.pid"),
    processId: requiredText(value.processId, "lock.processId", 128),
    token: requiredText(value.token, "lock.token", 128)
  });
}

async function readLockOwner(lockPath = "") {
  try {
    return defineLockOwner(JSON.parse(await readBoundedFile(lockPath, 4096)));
  } catch (error) {
    if (error?.code === "ENOENT") {
      throw error;
    }
    throw ledgerError(
      `Codex helper ownership lock cannot be verified: ${path.basename(lockPath)} (${error.message})`
    );
  }
}

function lockOwnerIsAlive(owner = {}) {
  try {
    process.kill(owner.pid, 0);
    return true;
  } catch (error) {
    if (error?.code === "ESRCH") {
      return false;
    }
    if (error?.code === "EPERM") {
      return true;
    }
    throw error;
  }
}

async function acquireHostLock(root = "", recordId = "", {
  observeLock = null
} = {}) {
  const lockPath = path.join(
    root,
    `.${requiredText(recordId, "recordId", 128)}.host-lock`
  );
  const deadline = Date.now() + CODEX_HELPER_THREAD_LEDGER_LOCK_WAIT_MS;
  while (true) {
    let releaseFileLock = null;
    try {
      releaseFileLock = await tryAcquireExclusiveFileLock(lockPath, { cwd: root });
      if (!releaseFileLock) {
        await observeLock?.({ stage: "host-contended" });
        if (Date.now() >= deadline) {
          throw ledgerError(
            "Codex helper ownership is busy in another process.",
            "vibe64_codex_helper_ledger_busy"
          );
        }
        await delay(CODEX_HELPER_THREAD_LEDGER_LOCK_POLL_MS);
        continue;
      }
      await observeLock?.({ stage: "host-acquired" });
      let released = false;
      return async () => {
        if (released) {
          return;
        }
        released = true;
        try {
          await releaseFileLock();
        } catch (error) {
          throw ledgerError(`Codex helper ownership host lock failed: ${error.message}`);
        }
      };
    } catch (error) {
      throw error?.code?.startsWith?.("vibe64_codex_helper_")
        ? error
        : ledgerError(`Codex helper ownership host lock failed: ${error.message}`);
    }
  }
}

async function acquireFilesystemLock(root = "", recordId = "", {
  observeLock = null
} = {}) {
  const locksRoot = path.join(root, ".locks");
  await mkdir(locksRoot, { mode: 0o770, recursive: true });
  const releaseHostLock = await acquireHostLock(root, recordId, { observeLock });
  try {
    const lockPath = path.join(locksRoot, `${requiredText(recordId, "recordId", 128)}.lock`);
    const deadline = Date.now() + CODEX_HELPER_THREAD_LEDGER_LOCK_WAIT_MS;
    const owner = defineLockOwner({
      createdAt: new Date().toISOString(),
      pid: process.pid,
      processId: codexHelperThreadLedgerProcessId,
      token: crypto.randomUUID()
    });
    const candidatePath = `${lockPath}.${owner.token}.candidate`;
    const candidateHandle = await open(candidatePath, "wx", 0o660);
    try {
      await candidateHandle.writeFile(`${JSON.stringify(owner)}\n`, "utf8");
      await candidateHandle.sync();
    } finally {
      await candidateHandle.close();
    }
    await syncDirectory(locksRoot);
    try {
      while (true) {
        try {
          await link(candidatePath, lockPath);
          await syncDirectory(locksRoot);
          break;
        } catch (error) {
          if (error?.code !== "EEXIST") {
            throw error;
          }
          let current;
          try {
            current = await readLockOwner(lockPath);
          } catch (readError) {
            if (readError?.code === "ENOENT") {
              continue;
            }
            throw readError;
          }
          if (!lockOwnerIsAlive(current)) {
            const verified = await readLockOwner(lockPath).catch((readError) => {
              if (readError?.code === "ENOENT") {
                return null;
              }
              throw readError;
            });
            if (verified?.token === current.token) {
              await observeLock?.({ stage: "stale-verified" });
              await rm(lockPath).catch((removeError) => {
                if (removeError?.code !== "ENOENT") {
                  throw removeError;
                }
              });
              await syncDirectory(locksRoot);
            }
            continue;
          }
          if (Date.now() >= deadline) {
            throw ledgerError(
              "Codex helper ownership is busy in another process.",
              "vibe64_codex_helper_ledger_busy"
            );
          }
          await delay(CODEX_HELPER_THREAD_LEDGER_LOCK_POLL_MS);
        }
      }
    } finally {
      await rm(candidatePath, { force: true }).catch(() => null);
      await syncDirectory(locksRoot);
    }
    return async () => {
      try {
        const current = await readLockOwner(lockPath);
        if (current.token !== owner.token || current.processId !== owner.processId) {
          throw ledgerError(
            "Codex helper ownership lock changed before it could be released.",
            "vibe64_codex_helper_ledger_conflict"
          );
        }
        await rm(lockPath);
        await syncDirectory(locksRoot);
      } finally {
        await releaseHostLock();
      }
    };
  } catch (error) {
    await releaseHostLock();
    throw error;
  }
}

async function withFilesystemMutationLock(
  root = "",
  callback = async () => undefined,
  options = {}
) {
  const key = `${root}\0ledger`;
  return withMutationQueue(key, async () => {
    const release = await acquireFilesystemLock(root, "ledger", options);
    try {
      return await callback();
    } finally {
      await release();
    }
  });
}

function createCodexHelperThreadLedger({
  observeLock = null,
  projectRuntimeRoot = ""
} = {}) {
  const normalizedProjectRuntimeRoot = absolutePath(projectRuntimeRoot, "projectRuntimeRoot");
  const root = codexHelperThreadLedgerRoot(normalizedProjectRuntimeRoot);

  async function readAll() {
    let entries;
    try {
      entries = await readdir(root, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return { failures: [], records: [] };
      }
      throw error;
    }
    const recordEntries = entries.filter(
      (entry) => entry.isFile() && entry.name.endsWith(".json")
    );
    if (recordEntries.length > CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS) {
      return {
        failures: [Object.freeze({
          code: "vibe64_codex_helper_ledger_invalid",
          error: `Codex helper ownership ledger exceeds ${CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS} records.`,
          fileName: "",
          retryable: true
        })],
        records: []
      };
    }
    const failures = [];
    const records = [];
    for (const entry of recordEntries.sort((left, right) => left.name.localeCompare(right.name))) {
      const filePath = path.join(root, entry.name);
      try {
        records.push(await readRecordFile(filePath));
      } catch (error) {
        failures.push(Object.freeze({
          code: normalizeText(error?.code),
          error: normalizeText(error?.message || error),
          fileName: entry.name,
          retryable: true
        }));
      }
    }
    return { failures, records };
  }

  async function write(recordValue = {}, { expected = null } = {}) {
    const record = defineCodexHelperThreadRecord(recordValue);
    const expectedRecord = expected ? defineCodexHelperThreadRecord(expected) : null;
    if (record.projectRuntimeRoot !== normalizedProjectRuntimeRoot) {
      throw ledgerError("Codex helper ownership project runtime root does not match its ledger.");
    }
    const recordId = codexHelperThreadRecordId(record);
    if (expectedRecord && codexHelperThreadRecordId(expectedRecord) !== recordId) {
      throw ledgerError(
        "Codex helper ownership identity cannot change during an update.",
        "vibe64_codex_helper_ledger_conflict"
      );
    }
    if (!expectedRecord && record.revision !== 1) {
      throw ledgerError("New Codex helper ownership must start at revision 1.");
    }
    if (expectedRecord && (
      record.revision !== expectedRecord.revision + 1 ||
      Date.parse(record.updatedAt) < Date.parse(expectedRecord.updatedAt) ||
      !stableOwnershipMatches(record, expectedRecord)
    )) {
      throw ledgerError(
        "Codex helper ownership update changed immutable identity, revision, or time.",
        "vibe64_codex_helper_ledger_conflict"
      );
    }
    const filePath = path.join(root, `${recordId}.json`);
    await mkdir(root, { mode: 0o770, recursive: true });
    return withFilesystemMutationLock(root, async () => {
      if (expectedRecord) {
        let current;
        try {
          current = await readRecordFile(filePath);
        } catch (error) {
          if (error?.code === "ENOENT") {
            throw ledgerError(
              "Codex helper ownership changed before it could be updated.",
              "vibe64_codex_helper_ledger_conflict"
            );
          }
          throw error;
        }
        if (!recordsMatch(current, expectedRecord)) {
          throw ledgerError(
            "Codex helper ownership changed before it could be updated.",
            "vibe64_codex_helper_ledger_conflict"
          );
        }
      } else {
        const entries = await readdir(root, { withFileTypes: true });
        const recordCount = entries.filter(
          (entry) => entry.isFile() && entry.name.endsWith(".json")
        ).length;
        if (recordCount >= CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS) {
          throw ledgerError(
            `Codex helper ownership ledger cannot exceed ${CODEX_HELPER_THREAD_LEDGER_MAX_RECORDS} records.`
          );
        }
        try {
          await readBoundedFile(filePath);
          throw ledgerError(
            "Codex helper ownership already exists for this thread.",
            "vibe64_codex_helper_ledger_conflict"
          );
        } catch (error) {
          if (error?.code !== "ENOENT") {
            throw error;
          }
        }
      }
      const serialized = `${JSON.stringify(record, null, 2)}\n`;
      if (Buffer.byteLength(serialized) > CODEX_HELPER_THREAD_LEDGER_MAX_FILE_BYTES) {
        throw ledgerError(
          `Codex helper ownership state exceeds ${CODEX_HELPER_THREAD_LEDGER_MAX_FILE_BYTES} bytes.`
        );
      }
      const temporaryPath = path.join(
        root,
        `.${path.basename(filePath)}.${process.pid}.${crypto.randomUUID()}.tmp`
      );
      let handle = null;
      try {
        handle = await open(temporaryPath, "wx", 0o660);
        await handle.writeFile(serialized, "utf8");
        await handle.sync();
        await handle.close();
        handle = null;
        await rename(temporaryPath, filePath);
        await syncDirectory(root);
      } catch (error) {
        await handle?.close().catch(() => null);
        await rm(temporaryPath, { force: true }).catch(() => null);
        throw error;
      }
      return record;
    }, { observeLock });
  }

  async function remove(expectedValue = {}) {
    const expected = defineCodexHelperThreadRecord(expectedValue);
    const recordId = codexHelperThreadRecordId(expected);
    const filePath = path.join(root, `${recordId}.json`);
    await mkdir(root, { mode: 0o770, recursive: true });
    return withFilesystemMutationLock(root, async () => {
      let current;
      try {
        current = await readRecordFile(filePath);
      } catch (error) {
        if (error?.code === "ENOENT") {
          throw ledgerError(
            "Codex helper ownership changed before it could be removed.",
            "vibe64_codex_helper_ledger_conflict"
          );
        }
        throw error;
      }
      if (!recordsMatch(current, expected)) {
        throw ledgerError(
          "Codex helper ownership changed before it could be removed.",
          "vibe64_codex_helper_ledger_conflict"
        );
      }
      await rm(filePath);
      await syncDirectory(root);
      return true;
    }, { observeLock });
  }

  return Object.freeze({
    projectRuntimeRoot: normalizedProjectRuntimeRoot,
    readAll,
    remove,
    root,
    write
  });
}

export {
  CODEX_HELPER_THREAD_LEDGER_SCHEMA_VERSION,
  CODEX_HELPER_THREAD_LIFECYCLES,
  codexHelperThreadRecordId,
  createCodexHelperThreadLedger,
  defineCodexHelperThreadRecord
};
