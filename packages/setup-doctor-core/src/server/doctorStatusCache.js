import { createHash } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import process from "node:process";
import {
  isVibe64LogLevelEnabled,
  resolveVibe64LogLevel
} from "@local/vibe64-core/shared";

const DEFAULT_READY_STATUS_CACHE_TTL_MS = 120_000;
const DEFAULT_RECENT_NOT_READY_STATUS_CACHE_TTL_MS = 10_000;
const READY_STATUS_RECORD_SCHEMA_VERSION = 1;

function createReadyStatusCache({
  ttlMs = DEFAULT_READY_STATUS_CACHE_TTL_MS
} = {}) {
  let cached = null;

  function read() {
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= Date.now()) {
      cached = null;
      return null;
    }
    return cached.status;
  }

  function remember(status) {
    if (status?.ready === true) {
      cached = {
        expiresAt: Date.now() + ttlMs,
        status
      };
    } else {
      cached = null;
    }
    return status;
  }

  return Object.freeze({
    read,
    remember
  });
}

function missingPath(error) {
  return error?.code === "ENOENT" || error?.code === "ENOTDIR";
}

function normalizeCacheRoot(root) {
  return path.resolve(String(root || process.cwd()));
}

function safeCacheId(id = "") {
  const safe = String(id || "doctor")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
  return safe || "doctor";
}

function defaultDoctorStatusStateRoot({
  env = process.env,
  home = os.homedir()
} = {}) {
  if (String(env.VIBE64_DOCTOR_STATUS_ROOT || "").trim()) {
    return normalizeCacheRoot(env.VIBE64_DOCTOR_STATUS_ROOT);
  }
  if (String(env.XDG_STATE_HOME || "").trim()) {
    return path.join(normalizeCacheRoot(env.XDG_STATE_HOME), "vibe64", "doctor-status");
  }
  if (String(env.LOCALAPPDATA || "").trim()) {
    return path.join(normalizeCacheRoot(env.LOCALAPPDATA), "Vibe64", "doctor-status");
  }

  return path.join(normalizeCacheRoot(home || process.cwd()), ".local", "state", "vibe64", "doctor-status");
}

function readyStatusCacheIdentity({
  doctorId = "",
  scope = "",
  studioRoot = "",
  targetRoot = ""
} = {}) {
  return {
    doctorId: String(doctorId || "doctor").trim() || "doctor",
    scope: String(scope || ""),
    studioRoot: studioRoot ? normalizeCacheRoot(studioRoot) : "",
    targetRoot: normalizeCacheRoot(targetRoot)
  };
}

function readyStatusCacheKey(identity) {
  return JSON.stringify({
    doctorId: identity.doctorId,
    scope: identity.scope,
    studioRoot: identity.studioRoot,
    targetRoot: identity.targetRoot
  });
}

function readyStatusCachePath({
  doctorId = "",
  scope = "",
  stateRoot = "",
  studioRoot = "",
  targetRoot = ""
} = {}) {
  const identity = readyStatusCacheIdentity({
    doctorId,
    scope,
    studioRoot,
    targetRoot
  });
  const cacheKey = readyStatusCacheKey(identity);
  const hash = createHash("sha256").update(cacheKey).digest("hex").slice(0, 32);
  return {
    cacheKey,
    filePath: path.join(
      normalizeCacheRoot(stateRoot || defaultDoctorStatusStateRoot()),
      `${safeCacheId(identity.doctorId)}-${hash}.json`
    ),
    identity
  };
}

function warnReadyStatusCache(operation, filePath, error) {
  if (!isVibe64LogLevelEnabled("warn", resolveVibe64LogLevel().level)) {
    return;
  }
  console.warn(
    `Vibe64 doctor ready cache ${operation} failed for ${filePath}: ${String(error?.message || error)}`
  );
}

async function readReadyStatusRecord(filePath) {
  try {
    return JSON.parse(await readFile(filePath, "utf8"));
  } catch (error) {
    if (missingPath(error)) {
      return null;
    }
    warnReadyStatusCache("read", filePath, error);
    return null;
  }
}

function recordReadyStatus(record, cacheKey) {
  if (
    record?.schemaVersion !== READY_STATUS_RECORD_SCHEMA_VERSION ||
    record?.cacheKey !== cacheKey ||
    record?.status?.ready !== true
  ) {
    return null;
  }
  return record.status;
}

async function writeReadyStatusRecord(filePath, record) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  const tempPath = path.join(
    path.dirname(filePath),
    `.${path.basename(filePath)}.${process.pid}.${Date.now()}.tmp`
  );
  await writeFile(tempPath, `${JSON.stringify(record, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

function createRepositoryReadyStatusCache({
  doctorId = "",
  recentNotReadyTtlMs = DEFAULT_RECENT_NOT_READY_STATUS_CACHE_TTL_MS,
  scope = "",
  stateRoot = "",
  studioRoot = "",
  targetRoot = ""
} = {}) {
  let memoryRecord = null;
  const {
    cacheKey,
    filePath,
    identity
  } = readyStatusCachePath({
    doctorId,
    scope,
    stateRoot,
    studioRoot,
    targetRoot
  });

  function readMemoryStatus() {
    if (!memoryRecord) {
      return null;
    }
    if (memoryRecord.expiresAt && memoryRecord.expiresAt <= Date.now()) {
      memoryRecord = null;
      return null;
    }
    return memoryRecord.status;
  }

  function rememberMemoryStatus(status) {
    if (status?.ready === true) {
      memoryRecord = {
        expiresAt: 0,
        status
      };
      return;
    }

    if (status?.ready === false && status?.ok !== false && recentNotReadyTtlMs > 0) {
      memoryRecord = {
        expiresAt: Date.now() + recentNotReadyTtlMs,
        status
      };
      return;
    }

    memoryRecord = null;
  }

  async function read() {
    const memoryStatus = readMemoryStatus();
    if (memoryStatus) {
      return memoryStatus;
    }

    const status = recordReadyStatus(await readReadyStatusRecord(filePath), cacheKey);
    if (status) {
      rememberMemoryStatus(status);
    }
    return status;
  }

  async function remember(status) {
    if (status?.ready === true) {
      rememberMemoryStatus(status);
      try {
        await writeReadyStatusRecord(filePath, {
          cacheKey,
          identity,
          schemaVersion: READY_STATUS_RECORD_SCHEMA_VERSION,
          status,
          updatedAt: new Date().toISOString()
        });
      } catch (error) {
        warnReadyStatusCache("write", filePath, error);
      }
      return status;
    }

    rememberMemoryStatus(status);
    try {
      await rm(filePath, {
        force: true
      });
    } catch (error) {
      warnReadyStatusCache("clear", filePath, error);
    }
    return status;
  }

  return Object.freeze({
    filePath,
    read,
    remember
  });
}

export {
  createReadyStatusCache,
  createRepositoryReadyStatusCache,
  defaultDoctorStatusStateRoot
};
