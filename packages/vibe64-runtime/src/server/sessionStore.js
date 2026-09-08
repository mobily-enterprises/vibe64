import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { copyFile, cp, mkdir, readdir, readFile, rename, rm, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  vibe64Error,
  isPlainObject,
  isMissingPathError,
  normalizeTargetRoot,
  normalizeText,
  pathExists
} from "@local/vibe64-core/server/core";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";
import {
  normalizeVibe64ConversationAttachments
} from "../shared/conversationAttachments.js";
import {
  clearVibe64CurrentSessionAliasIfMatches,
  readVibe64CurrentSessionAlias,
  resolveVibe64CurrentSessionAliasPath,
  updateVibe64CurrentSessionAlias
} from "./currentSessionAlias.js";
const VIBE64_SESSION_SCHEMA_VERSION = 2;
const VIBE64_SESSION_ARCHIVE_SCHEMA_VERSION = 2;
const SESSION_LABEL_METADATA = "label";
const SESSION_LABEL_MAX_LENGTH = 120;
const VIBE64_SESSION_STATUS = deepFreeze({
  ACTIVE: "active",
  ARCHIVED: "archived",
  BLOCKED: "blocked",
  RENEWAL_ACTIVATING: "renewal_activating",
  RENEWAL_PENDING: "renewal_pending",
  RENEWAL_QUIESCED: "renewal_quiesced"
});
const VIBE64_SESSION_STATUSES = new Set(Object.values(VIBE64_SESSION_STATUS));
const OPEN_VIBE64_SESSION_STATUSES = new Set([
  VIBE64_SESSION_STATUS.ACTIVE,
  VIBE64_SESSION_STATUS.BLOCKED,
  VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
]);
const HIDDEN_VIBE64_SESSION_STATUSES = new Set([
  VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING,
  VIBE64_SESSION_STATUS.RENEWAL_PENDING
]);
const RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES = new Set([
  ...HIDDEN_VIBE64_SESSION_STATUSES,
  VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
]);
const SESSION_ARCHIVE_KIND = "vibe64.session_archive";
const RENEWAL_ARCHIVE_SELECTION_METADATA = "renewal_selected_before_archive";
const RENEWAL_ARCHIVE_SELECTION_NONE = "none";
const SESSION_ARCHIVE_INDEX_METADATA_NAMES = Object.freeze([
  "base_branch",
  "base_commit",
  "canonical_commit",
  "branch",
  "renewal_acknowledged_at",
  "renewal_activated_at",
  "renewal_actor_display_name",
  "renewal_actor_id",
  "renewal_archived_at",
  "renewal_confirmed_at",
  "renewal_finalized_at",
  "renewal_handover_delivered_at",
  "renewal_id",
  "renewal_quiesced_at",
  "renewal_quiesced_id",
  "renewal_restored_at",
  "renewal_restored_id",
  "renewal_rolled_back_at",
  "renewal_started_at",
  "renewal_successor_created_at",
  "renewed_at",
  "renewed_from",
  "renewed_to",
  "source_default_branch",
  "source_kind",
  "source_path",
  "source_recovery_base_branch",
  "source_recovery_base_commit",
  "source_recovery_branch",
  "source_recovery_bundle_artifact",
  "source_recovery_checkpoint_bundle_artifact",
  "source_recovery_default_branch",
  "source_recovery_dirty",
  "source_recovery_head",
  "source_recovery_kind",
  "source_recovery_patch_artifact",
  "source_recovery_remote_url",
  "source_recovery_saved",
  "source_recovery_saved_at",
  "source_recovery_session_name",
  "source_recovery_source_path",
  "source_recovery_untracked_artifact",
  "source_recovery_untracked_count",
  "source_remote_url",
  "source_removed"
]);
const SESSION_ARCHIVE_TIMEOUT_MS = 60_000;
const COMMAND_BUFFER_BYTES = 50 * 1024 * 1024;
const BACKGROUND_TASK_EVENT_LIMIT = 200;
const AGENT_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const ARTIFACT_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const BACKGROUND_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const SESSION_RENEWAL_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;
const SESSION_RENEWAL_STATE_FILE_PATTERN = /^([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/u;
const CONVERSATION_ACTIVITY_ROLES = new Set([
  "commentary",
  "thinking"
]);
const CONVERSATION_MESSAGE_ROLES = deepFreeze([
  "assistant",
  "commentary",
  "system",
  "thinking",
  "user"
]);
const CONVERSATION_MESSAGE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const CONVERSATION_MESSAGE_FILE_PATTERN =
  /^(user|assistant|commentary|system|thinking)\.(\d{8}T\d{9}Z)(?:\.([A-Za-z0-9][A-Za-z0-9_-]{0,127}))?\.md$/u;
const CONVERSATION_TURN_ID_PATTERN = /^\d{6}$/u;
const CONVERSATION_TURN_ATTACHMENTS_FILE = "attachments.json";
const CONVERSATION_TURN_METADATA_FILE = "metadata.json";
const SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES = Object.freeze([
  "base_commit",
  "canonical_commit",
  "repository_mode",
  "source",
  "source_kind",
  "source_path",
  "source_path_authority",
  "source_removed"
]);
const METADATA_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const BACKGROUND_TASK_STATUS = Object.freeze({
  FAILED: "failed",
  READY: "ready",
  RUNNING: "running"
});
const BACKGROUND_TASK_STATUSES = new Set(Object.values(BACKGROUND_TASK_STATUS));
const VIBE64_AGENT_RUN_STATE = Object.freeze({
  ACTIVE: "active",
  CANCELLED: "cancelled",
  COMPLETED: "completed",
  FAILED: "failed",
  FINALIZING: "finalizing",
  INTERRUPTED: "interrupted",
  STARTING: "starting",
  TIMED_OUT: "timed_out"
});
const AGENT_RUN_STATES = new Set(Object.values(VIBE64_AGENT_RUN_STATE));
const TERMINAL_AGENT_RUN_STATES = new Set([
  VIBE64_AGENT_RUN_STATE.CANCELLED,
  VIBE64_AGENT_RUN_STATE.COMPLETED,
  VIBE64_AGENT_RUN_STATE.FAILED,
  VIBE64_AGENT_RUN_STATE.INTERRUPTED,
  VIBE64_AGENT_RUN_STATE.TIMED_OUT
]);

const ACTIVE_AGENT_RUN_STATES = new Set([
  VIBE64_AGENT_RUN_STATE.ACTIVE,
  VIBE64_AGENT_RUN_STATE.FINALIZING,
  VIBE64_AGENT_RUN_STATE.STARTING
]);
const SESSION_LOCK_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SESSION_LOCK_OWNER_GRACE_MS = 2_000;
const SESSION_LOCK_OWNER_SCHEMA_VERSION = 1;
const SESSION_LOCK_POLL_MS = 20;
const SESSION_LOCK_PROCESS_IDENTITY_PLATFORM = "linux-proc";
const SESSION_LOCK_PROCESS_IDENTITY_PID_ONLY_PLATFORM = "pid-only";
const SESSION_MUTATION_LOCK_WAIT_MS = 60_000;
const sessionMutationChains = new Map();
const sessionMutationContext = new AsyncLocalStorage();
const sessionExclusiveContext = new AsyncLocalStorage();

function isValidVibe64SessionId(sessionId) {
  const normalizedSessionId = normalizeText(sessionId);
  return SESSION_ID_PATTERN.test(normalizedSessionId);
}

function isSafeAgentRunId(runId) {
  return AGENT_RUN_ID_PATTERN.test(normalizeText(runId));
}

function isSafeBackgroundTaskId(taskId) {
  return BACKGROUND_TASK_ID_PATTERN.test(normalizeText(taskId));
}

function assertValidVibe64SessionId(sessionId) {
  const normalizedSessionId = normalizeText(sessionId);
  if (!isValidVibe64SessionId(normalizedSessionId)) {
    throw vibe64Error(`Invalid vibe64 session id: ${normalizedSessionId || "(empty)"}`, "vibe64_invalid_session_id");
  }
  return normalizedSessionId;
}

function assertSafeMetadataName(name) {
  const normalizedName = normalizeText(name);
  if (!METADATA_NAME_PATTERN.test(normalizedName)) {
    throw vibe64Error(`Invalid vibe64 metadata name: ${normalizedName || "(empty)"}`, "vibe64_invalid_metadata_name");
  }
  return normalizedName;
}

function assertSafeAgentRunId(runId) {
  const normalizedRunId = normalizeText(runId);
  if (!isSafeAgentRunId(normalizedRunId)) {
    throw vibe64Error(
      `Invalid vibe64 agent run id: ${normalizedRunId || "(empty)"}`,
      "vibe64_invalid_agent_run_id"
    );
  }
  return normalizedRunId;
}

function assertSafeBackgroundTaskId(taskId) {
  const normalizedTaskId = normalizeText(taskId);
  if (!isSafeBackgroundTaskId(normalizedTaskId)) {
    throw vibe64Error(
      `Invalid vibe64 background task id: ${normalizedTaskId || "(empty)"}`,
      "vibe64_invalid_background_task_id"
    );
  }
  return normalizedTaskId;
}

function assertRenewalId(renewalId) {
  const normalizedRenewalId = normalizeText(renewalId);
  if (!SESSION_RENEWAL_ID_PATTERN.test(normalizedRenewalId)) {
    throw vibe64Error(
      `Invalid Vibe64 session renewal id: ${normalizedRenewalId || "(empty)"}`,
      "vibe64_invalid_session_renewal_id"
    );
  }
  return normalizedRenewalId;
}

function sessionIsUnfinishedRenewalRecord(session = {}) {
  const metadata = isPlainObject(session.metadata) ? session.metadata : {};
  const renewalId = session.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
    ? normalizeText(metadata.renewal_quiesced_id)
    : normalizeText(metadata.renewal_id);
  if (
    !SESSION_RENEWAL_ID_PATTERN.test(renewalId) ||
    (
      session.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED &&
      normalizeText(metadata.renewal_finalized_at)
    )
  ) {
    return false;
  }
  if ([
    VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING,
    VIBE64_SESSION_STATUS.RENEWAL_PENDING
  ].includes(session.status)) {
    return isValidVibe64SessionId(metadata.renewed_from);
  }
  if (session.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
    return Boolean(normalizeText(metadata.renewal_quiesced_at));
  }
  if (session.status === VIBE64_SESSION_STATUS.ARCHIVED) {
    return isValidVibe64SessionId(metadata.renewed_to);
  }
  return session.status === VIBE64_SESSION_STATUS.ACTIVE &&
    isValidVibe64SessionId(metadata.renewed_from) &&
    !normalizeText(metadata.renewed_to);
}

function normalizeVibe64AgentRunState(state) {
  const normalizedState = normalizeText(state) || VIBE64_AGENT_RUN_STATE.STARTING;
  if (!AGENT_RUN_STATES.has(normalizedState)) {
    throw vibe64Error(
      `Invalid vibe64 agent run state: ${normalizedState}`,
      "vibe64_invalid_agent_run_state"
    );
  }
  return normalizedState;
}

function vibe64AgentRunStateIsActive(state) {
  return ACTIVE_AGENT_RUN_STATES.has(normalizeVibe64AgentRunState(state));
}

function vibe64AgentRunStateIsTerminal(state) {
  return TERMINAL_AGENT_RUN_STATES.has(normalizeVibe64AgentRunState(state));
}

function normalizeBackgroundTaskStatus(status) {
  const normalizedStatus = normalizeText(status) || BACKGROUND_TASK_STATUS.RUNNING;
  if (!BACKGROUND_TASK_STATUSES.has(normalizedStatus)) {
    throw vibe64Error(
      `Invalid vibe64 background task status: ${normalizedStatus}`,
      "vibe64_invalid_background_task_status"
    );
  }
  return normalizedStatus;
}

function assertVibe64SessionStatus(status) {
  const normalizedStatus = normalizeText(status) || VIBE64_SESSION_STATUS.ACTIVE;
  if (!VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
    throw vibe64Error(`Invalid vibe64 session status: ${normalizedStatus}`, "vibe64_invalid_session_status");
  }
  return normalizedStatus;
}

function vibe64SessionStatusIsOpen(status) {
  return OPEN_VIBE64_SESSION_STATUSES.has(assertVibe64SessionStatus(status));
}

function vibe64SessionStatusIsHidden(status) {
  return HIDDEN_VIBE64_SESSION_STATUSES.has(assertVibe64SessionStatus(status));
}

function assertNormalSessionIsReadable(session = {}) {
  const status = assertVibe64SessionStatus(session.status);
  if (HIDDEN_VIBE64_SESSION_STATUSES.has(status)) {
    throw vibe64Error(
      `Vibe64 session is reserved for an in-progress renewal: ${normalizeText(session.sessionId) || "(unknown)"}`,
      "vibe64_session_renewal_private"
    );
  }
  return session;
}

function assertNormalSessionIsMutable(session = {}) {
  const readable = assertNormalSessionIsReadable(session);
  if (readable.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
    throw vibe64Error(
      `Vibe64 session is read-only while its renewal is in progress: ${normalizeText(session.sessionId) || "(unknown)"}`,
      "vibe64_session_renewal_quiesced"
    );
  }
  return readable;
}

function normalizeSessionListStatusGroup(statusGroup = "") {
  const normalizedStatusGroup = normalizeText(statusGroup);
  if (!normalizedStatusGroup) {
    return "";
  }
  if (["all", "archived", "open"].includes(normalizedStatusGroup)) {
    return normalizedStatusGroup;
  }
  throw vibe64Error(`Invalid vibe64 session list status group: ${normalizedStatusGroup}`, "vibe64_invalid_session_list_status_group");
}

function normalizeSessionListStatuses(statuses = []) {
  return new Set((Array.isArray(statuses) ? statuses : [])
    .map((status) => normalizeText(status))
    .filter(Boolean)
    .map(assertVibe64SessionStatus));
}

function normalizeSessionListOptions(options = {}) {
  return {
    statusGroup: normalizeSessionListStatusGroup(options.statusGroup),
    statuses: normalizeSessionListStatuses(options.statuses)
  };
}

function sessionStatusMatchesListOptions(status, {
  statusGroup = "",
  statuses = new Set()
} = {}) {
  const normalizedStatus = normalizeText(status) || VIBE64_SESSION_STATUS.ACTIVE;
  if (HIDDEN_VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
    return false;
  }
  if (statuses.size > 0 && !statuses.has(normalizedStatus)) {
    return false;
  }
  if (statusGroup === "open") {
    return OPEN_VIBE64_SESSION_STATUSES.has(normalizedStatus);
  }
  if (statusGroup === "archived") {
    return normalizedStatus === VIBE64_SESSION_STATUS.ARCHIVED;
  }
  return OPEN_VIBE64_SESSION_STATUSES.has(normalizedStatus) ||
    normalizedStatus === VIBE64_SESSION_STATUS.ARCHIVED;
}

function sessionListMayIncludeArchived({
  statusGroup = "",
  statuses = new Set()
} = {}) {
  return statusGroup !== "open" && (
    statuses.size < 1 ||
    statuses.has(VIBE64_SESSION_STATUS.ARCHIVED)
  );
}

async function readTextIfExists(filePath) {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isMissingPathError(error)) {
      return "";
    }
    throw error;
  }
}

async function writeTextFile(filePath, text) {
  await mkdir(path.dirname(filePath), {
    recursive: true
  });
  await writeFile(filePath, String(text), "utf8");
}

async function writeJsonFile(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, {
    recursive: true
  });
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, {
      force: true
    });
    throw error;
  }
}

async function runCommand(command, args = [], {
  allowedRoots = [],
  cwd = "",
  maxBuffer = COMMAND_BUFFER_BYTES,
  timeout = SESSION_ARCHIVE_TIMEOUT_MS
} = {}) {
  const resolvedCwd = cwd || process.cwd();
  const result = await runVibe64Command({
    actor: "daemon",
    allowedRoots: [
      resolvedCwd,
      ...allowedRoots
    ].filter(Boolean),
    args,
    command,
    cwd: resolvedCwd,
    envPolicy: "session",
    maxBuffer,
    mode: "capture",
    purpose: "source",
    timeout
  });
  return {
    ok: result.ok === true,
    output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`) ||
      normalizeText(result.output || result.error),
    stdout: String(result.stdout || ""),
    stderr: String(result.stderr || "")
  };
}

function revisionNumber(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function normalizeManifest(manifest = {}) {
  return {
    ...manifest,
    revision: revisionNumber(manifest.revision)
  };
}

function withRevisionMarker(value, manifest = {}, sessionId = "") {
  if (!isPlainObject(value) || normalizeText(value.sessionId) !== sessionId) {
    return value;
  }
  const normalizedManifest = normalizeManifest(manifest);
  return {
    ...value,
    manifest: isPlainObject(value.manifest)
      ? {
          ...value.manifest,
          revision: normalizedManifest.revision,
          updatedAt: normalizeText(normalizedManifest.updatedAt)
        }
      : value.manifest,
    revision: normalizedManifest.revision,
    updatedAt: normalizeText(normalizedManifest.updatedAt)
  };
}

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

function createSessionOperationLease() {
  let resolveIdle = () => null;
  const idle = new Promise((resolve) => {
    resolveIdle = resolve;
  });
  return {
    idle,
    operations: 0,
    resolveIdle
  };
}

function beginSessionOperation(lease) {
  lease.operations += 1;
  return {
    active: true
  };
}

function finishSessionOperation(lease, participant) {
  participant.active = false;
  lease.operations -= 1;
  if (lease.operations === 0) {
    lease.resolveIdle();
  }
}

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

function linuxProcessStartTimeTicks(statText = "") {
  const text = String(statText || "").trim();
  const commandEnd = text.lastIndexOf(")");
  if (commandEnd < 0) {
    return "";
  }
  const fields = text.slice(commandEnd + 1).trim().split(/\s+/u);
  const state = String(fields[0] || "");
  const startTimeTicks = String(fields[19] || "");
  return /^[A-Z]$/u.test(state) && /^\d+$/u.test(startTimeTicks)
    ? startTimeTicks
    : "";
}

async function readLinuxProcessStartTimeTicks(pid) {
  const normalizedPid = Number(pid);
  if (
    process.platform !== "linux" ||
    !Number.isSafeInteger(normalizedPid) ||
    normalizedPid <= 0
  ) {
    return {
      status: "ambiguous",
      startTimeTicks: ""
    };
  }
  try {
    const startTimeTicks = linuxProcessStartTimeTicks(
      await readFile(`/proc/${normalizedPid}/stat`, "utf8")
    );
    return startTimeTicks
      ? { status: "exact", startTimeTicks }
      : { status: "ambiguous", startTimeTicks: "" };
  } catch (error) {
    return isMissingPathError(error)
      ? { status: "absent", startTimeTicks: "" }
      : { status: "ambiguous", startTimeTicks: "" };
  }
}

async function currentSessionLockProcessIdentity(processPlatform = process.platform) {
  if (processPlatform !== "linux") {
    return {
      platform: SESSION_LOCK_PROCESS_IDENTITY_PID_ONLY_PLATFORM,
      startTimeTicks: ""
    };
  }
  const observed = await readLinuxProcessStartTimeTicks(process.pid);
  if (observed.status !== "exact") {
    throw vibe64Error(
      "Vibe64 could not establish the session-lock owner process identity.",
      "vibe64_session_lock_process_identity_unavailable"
    );
  }
  return {
    platform: SESSION_LOCK_PROCESS_IDENTITY_PLATFORM,
    startTimeTicks: observed.startTimeTicks
  };
}

async function sessionLockOwnerProcessStatus(owner = {}) {
  const pid = Number(owner?.pid);
  if (!Number.isSafeInteger(pid) || pid <= 0) {
    return "ambiguous";
  }
  const observed = await readLinuxProcessStartTimeTicks(pid);
  if (observed.status === "absent") {
    return "absent";
  }
  const identity = isPlainObject(owner?.processIdentity)
    ? owner.processIdentity
    : {};
  if (
    Number(owner?.schemaVersion) !== SESSION_LOCK_OWNER_SCHEMA_VERSION ||
    normalizeText(identity.platform) !== SESSION_LOCK_PROCESS_IDENTITY_PLATFORM ||
    !/^\d+$/u.test(normalizeText(identity.startTimeTicks)) ||
    observed.status !== "exact"
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
      logOperationalEvent(logger, ["contended", "rejected"].includes(event) ? "warn" : "info", {
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
  await mkdir(lockRoot, {
    recursive: true
  });
  while (true) {
    try {
      await mkdir(lockPath, {
        mode: 0o700
      });
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
        await rm(lockPath, {
          force: true,
          recursive: true
        });
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
        await rm(releasedPath, {
          force: true,
          recursive: true
        });
        logLockEvent("released", { heldMs: Date.now() - acquiredAtMs });
      };
    } catch (error) {
      if (error?.code !== "EEXIST") {
        throw error;
      }
      if (await quarantineAbandonedSessionLock(lockPath)) {
        continue;
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
  }
}

async function readDirectoryEntries(directoryPath) {
  try {
    return await readdir(directoryPath, {
      withFileTypes: true
    });
  } catch (error) {
    if (isMissingPathError(error)) {
      return [];
    }
    throw error;
  }
}

function sortedFileNames(entries, isAllowedName) {
  return entries
    .filter((entry) => entry.isFile() && isAllowedName(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function sortedDirectoryNames(entries, isAllowedName) {
  return entries
    .filter((entry) => entry.isDirectory() && isAllowedName(entry.name))
    .map((entry) => entry.name)
    .sort((left, right) => left.localeCompare(right));
}

function toDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw vibe64Error("Invalid vibe64 clock value.", "vibe64_invalid_clock");
  }
  return date;
}

function timestampForSessionId(date) {
  return toDate(date)
    .toISOString()
    .replace(/\.\d{3}Z$/u, "")
    .replace("T", "_")
    .replaceAll(":", "-");
}

function timestampForConversationFile(date) {
  return toDate(date)
    .toISOString()
    .replace(/[-:]/gu, "")
    .replace(".", "");
}

function isoFromConversationTimestamp(timestamp = "") {
  const value = normalizeText(timestamp);
  const match = value.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(\d{3})Z$/u);
  if (!match) {
    return "";
  }
  return `${match[1]}-${match[2]}-${match[3]}T${match[4]}:${match[5]}:${match[6]}.${match[7]}Z`;
}

function sessionPathsFromRoot({
  activeSessionsRoot = "",
  closingSessionsRoot = "",
  archivedSessionsRoot = "",
  currentSessionAliasPath = "",
  projectContextRoot = "",
  sessionId = "",
  sessionRoot = "",
  sessionsRoot = "",
  stateRoot = ""
} = {}) {
  return {
    activeSessionsRoot,
    agentRunsRoot: sessionRoot ? path.join(sessionRoot, "agent-runs") : "",
    artifactsRoot: sessionRoot ? path.join(sessionRoot, "artifacts") : "",
    backgroundTasksRoot: sessionRoot ? path.join(sessionRoot, "background-tasks") : "",
    closingSessionsRoot,
    archivedSessionsRoot,
    conversationLogRoot: sessionRoot ? path.join(sessionRoot, "conversation-log") : "",
    currentSessionAliasPath,
    manifestPath: sessionRoot ? path.join(sessionRoot, "session.json") : "",
    metadataRoot: sessionRoot ? path.join(sessionRoot, "metadata") : "",
    projectContextRoot,
    sessionId,
    sessionRoot,
    sessionsRoot,
    stateRoot,
    statusPath: sessionRoot ? path.join(sessionRoot, "status") : ""
  };
}

function resolveVibe64SessionPaths({
  projectContextRoot = process.cwd(),
  projectRuntimeRoot = "",
  projectSessionSourceRoot = "",
  sessionId = ""
} = {}) {
  const normalizedProjectContextRoot = normalizeTargetRoot(projectContextRoot);
  const resolvedStateRoot = projectRuntimeRoot ? path.resolve(projectRuntimeRoot) : "";
  if (!resolvedStateRoot) {
    throw vibe64Error("Vibe64 session paths require projectRuntimeRoot.", "vibe64_project_runtime_root_required");
  }
  const sessionsRoot = path.join(resolvedStateRoot, "sessions");
  const sourceSessionsRoot = projectSessionSourceRoot
    ? path.join(path.resolve(projectSessionSourceRoot), "sessions")
    : "";
  const activeSessionsRoot = path.join(sessionsRoot, "active");
  const closingSessionsRoot = path.join(sessionsRoot, "closing");
  const archivedSessionsRoot = path.join(sessionsRoot, "archived");
  const normalizedSessionId = normalizeText(sessionId);
  const sessionRoot = normalizedSessionId ? path.join(activeSessionsRoot, assertValidVibe64SessionId(normalizedSessionId)) : "";
  return sessionPathsFromRoot({
    activeSessionsRoot,
    closingSessionsRoot,
    archivedSessionsRoot,
    currentSessionAliasPath: sourceSessionsRoot
      ? resolveVibe64CurrentSessionAliasPath(sourceSessionsRoot)
      : "",
    projectContextRoot: normalizedProjectContextRoot,
    sessionId: normalizedSessionId,
    sessionRoot,
    sessionsRoot,
    stateRoot: resolvedStateRoot
  });
}

function createClockNow(clock) {
  if (typeof clock === "function") {
    return () => toDate(clock());
  }
  return () => new Date();
}

async function createAvailableSessionId(rootPaths, now) {
  const baseSessionId = timestampForSessionId(now);
  for (let index = 0; index < 1000; index += 1) {
    const sessionId = index === 0 ? baseSessionId : `${baseSessionId}_${index + 1}`;
    if (!await sessionRecordExists(rootPaths, sessionId)) {
      return sessionId;
    }
  }
  throw vibe64Error("Unable to allocate an vibe64 session id.", "vibe64_session_id_exhausted");
}

function sessionArchivePath(rootPaths = {}, sessionId = "") {
  return path.join(rootPaths.archivedSessionsRoot, `${assertValidVibe64SessionId(sessionId)}.tar.gz`);
}

function sessionArchiveMetadataPath(rootPaths = {}, sessionId = "") {
  return path.join(rootPaths.archivedSessionsRoot, `${assertValidVibe64SessionId(sessionId)}.json`);
}

function sessionArchiveStagingRoot(rootPaths = {}) {
  return path.join(rootPaths.archivedSessionsRoot, ".staging");
}

function renewalArchiveStagingRoot(rootPaths = {}) {
  return path.join(rootPaths.archivedSessionsRoot, ".renewals");
}

function preparedRenewalArchiveRoot(rootPaths = {}, sessionId = "") {
  return path.join(
    renewalArchiveStagingRoot(rootPaths),
    assertValidVibe64SessionId(sessionId)
  );
}

function buildingRenewalArchiveRoot(rootPaths = {}, sessionId = "") {
  return path.join(
    renewalArchiveStagingRoot(rootPaths),
    ".building",
    assertValidVibe64SessionId(sessionId)
  );
}

function publishingRenewalArchiveRoot(rootPaths = {}, sessionId = "") {
  return path.join(
    renewalArchiveStagingRoot(rootPaths),
    ".publishing",
    assertValidVibe64SessionId(sessionId)
  );
}

function preparedRenewalArchivePath(rootPaths = {}, sessionId = "") {
  const normalizedSessionId = assertValidVibe64SessionId(sessionId);
  return path.join(
    preparedRenewalArchiveRoot(rootPaths, normalizedSessionId),
    `${normalizedSessionId}.tar.gz`
  );
}

function preparedRenewalMetadataPath(rootPaths = {}, sessionId = "") {
  const normalizedSessionId = assertValidVibe64SessionId(sessionId);
  return path.join(
    preparedRenewalArchiveRoot(rootPaths, normalizedSessionId),
    `${normalizedSessionId}.json`
  );
}

function closingSessionRoot(rootPaths = {}, sessionId = "") {
  return path.join(rootPaths.closingSessionsRoot, assertValidVibe64SessionId(sessionId));
}

function sessionCreationStagingRoot(rootPaths = {}) {
  return path.join(rootPaths.activeSessionsRoot, ".creating");
}

async function removeStaleSessionCreationStages(rootPaths = {}, sessionId = "") {
  const normalizedSessionId = assertValidVibe64SessionId(sessionId);
  const stagingRoot = sessionCreationStagingRoot(rootPaths);
  const entries = await readDirectoryEntries(stagingRoot);
  await Promise.all(entries
    .filter((entry) => entry.isDirectory() && entry.name.startsWith(`${normalizedSessionId}.`))
    .map((entry) => rm(path.join(stagingRoot, entry.name), {
      force: true,
      recursive: true
    })));
}

async function sessionArchiveRecordExists(rootPaths = {}, sessionId = "") {
  const normalizedSessionId = assertValidVibe64SessionId(sessionId);
  return await pathExists(sessionArchiveMetadataPath(rootPaths, normalizedSessionId)) ||
    await pathExists(sessionArchivePath(rootPaths, normalizedSessionId));
}

async function sessionRecordExists(rootPaths = {}, sessionId = "") {
  const normalizedSessionId = assertValidVibe64SessionId(sessionId);
  return await pathExists(path.join(rootPaths.activeSessionsRoot, normalizedSessionId)) ||
    await pathExists(closingSessionRoot(rootPaths, normalizedSessionId)) ||
    await sessionArchiveRecordExists(rootPaths, normalizedSessionId);
}

function metadataFilePath(sessionPaths, name) {
  return path.join(sessionPaths.metadataRoot, assertSafeMetadataName(name));
}

function normalizeSessionLabel(value = "") {
  return normalizeText(value).slice(0, SESSION_LABEL_MAX_LENGTH);
}

function assertSafeArtifactPath(relativePath) {
  const normalizedPath = normalizeText(relativePath);
  const segments = normalizedPath.split("/");
  if (
    !normalizedPath
    || normalizedPath.includes("\\")
    || segments.some((segment) => !ARTIFACT_PATH_SEGMENT_PATTERN.test(segment))
  ) {
    throw vibe64Error(`Invalid vibe64 artifact path: ${normalizedPath || "(empty)"}`, "vibe64_invalid_artifact_path");
  }
  return segments.join("/");
}

function artifactFilePath(sessionPaths, relativePath) {
  const safeRelativePath = assertSafeArtifactPath(relativePath);
  const artifactsRoot = path.resolve(sessionPaths.artifactsRoot);
  const artifactPath = path.resolve(artifactsRoot, ...safeRelativePath.split("/"));
  const pathFromRoot = path.relative(artifactsRoot, artifactPath);
  if (pathFromRoot.startsWith("..") || path.isAbsolute(pathFromRoot)) {
    throw vibe64Error(`Invalid vibe64 artifact path: ${safeRelativePath}`, "vibe64_invalid_artifact_path");
  }
  return artifactPath;
}

function agentRunFilePath(sessionPaths, runId) {
  return path.join(sessionPaths.agentRunsRoot, `${assertSafeAgentRunId(runId)}.json`);
}

function backgroundTaskFilePath(sessionPaths, taskId) {
  return path.join(sessionPaths.backgroundTasksRoot, `${assertSafeBackgroundTaskId(taskId)}.json`);
}

function conversationTurnRoot(sessionPaths, turnId) {
  const normalizedTurnId = normalizeText(turnId);
  if (!CONVERSATION_TURN_ID_PATTERN.test(normalizedTurnId)) {
    throw vibe64Error(`Invalid vibe64 conversation turn id: ${normalizedTurnId || "(empty)"}`, "vibe64_invalid_conversation_turn_id");
  }
  return path.join(sessionPaths.conversationLogRoot, normalizedTurnId);
}

function conversationMessageFileName(role = "", date, messageId = "") {
  const normalizedRole = normalizeText(role);
  if (!CONVERSATION_MESSAGE_ROLES.includes(normalizedRole)) {
    throw vibe64Error(`Invalid vibe64 conversation role: ${normalizedRole || "(empty)"}`, "vibe64_invalid_conversation_role");
  }
  const normalizedMessageId = normalizeText(messageId);
  if (normalizedMessageId && !CONVERSATION_MESSAGE_ID_PATTERN.test(normalizedMessageId)) {
    throw vibe64Error(
      `Invalid vibe64 conversation message id: ${normalizedMessageId}`,
      "vibe64_invalid_conversation_message_id"
    );
  }
  const idSuffix = normalizedMessageId ? `.${normalizedMessageId}` : "";
  return `${normalizedRole}.${timestampForConversationFile(date)}${idSuffix}.md`;
}

function nextConversationTurnId(turnIds = []) {
  const latest = [...turnIds]
    .filter((turnId) => CONVERSATION_TURN_ID_PATTERN.test(turnId))
    .map((turnId) => Number.parseInt(turnId, 10))
    .filter((turnId) => Number.isSafeInteger(turnId) && turnId > 0)
    .sort((left, right) => left - right)
    .at(-1) || 0;
  return String(latest + 1).padStart(6, "0");
}

function conversationTurnHasMessages(turn = {}) {
  return Boolean(
    turn.system ||
    turn.user ||
    turn.assistant ||
    turn.commentary?.length ||
    turn.thinking?.length
  );
}

function createVibe64SessionStore({
  clock = undefined,
  logger = null,
  onRenewalArchiveCommitStep = null,
  onRenewalQuiesceStep = null,
  projectContextRoot = process.cwd(),
  projectRuntimeRoot = "",
  projectSessionSourceRoot = "",
  sessionLockProcessPlatform = process.platform
} = {}) {
  const normalizedProjectContextRoot = normalizeTargetRoot(projectContextRoot);
  const resolvedProjectRuntimeRoot = String(projectRuntimeRoot || "").trim();
  if (!resolvedProjectRuntimeRoot) {
    throw vibe64Error("Vibe64 session store requires projectRuntimeRoot.", "vibe64_project_runtime_root_required");
  }
  const normalizedStateRoot = path.resolve(resolvedProjectRuntimeRoot);
  const now = createClockNow(clock);
  const renewalArchiveCommitStep = typeof onRenewalArchiveCommitStep === "function"
    ? onRenewalArchiveCommitStep
    : async () => undefined;
  const renewalQuiesceStep = typeof onRenewalQuiesceStep === "function"
    ? onRenewalQuiesceStep
    : async () => undefined;

  function acquireStoreSessionLock(sessionPaths, lockName = "", options = {}) {
    return acquireSessionLock(sessionPaths, lockName, {
      ...options,
      logger,
      processPlatform: sessionLockProcessPlatform
    });
  }

  function paths(sessionId = "") {
    return resolveVibe64SessionPaths({
      projectContextRoot: normalizedProjectContextRoot,
      projectRuntimeRoot: normalizedStateRoot,
      projectSessionSourceRoot,
      sessionId
    });
  }

  function renewalStateRoot() {
    return path.join(normalizedStateRoot, "session-renewals");
  }

  function renewalStatePath(sessionId = "") {
    return path.join(
      renewalStateRoot(),
      `${assertValidVibe64SessionId(sessionId)}.json`
    );
  }

  async function readSessionRenewalStateRecord(sessionId = "") {
    return readTextIfExists(renewalStatePath(sessionId));
  }

  async function writeSessionRenewalStateRecord(sessionId = "", value = {}) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    await writeJsonFile(renewalStatePath(normalizedSessionId), value);
    return value;
  }

  async function listSessionRenewalStateSessionIds() {
    return sortedFileNames(
      await readDirectoryEntries(renewalStateRoot()),
      (name) => SESSION_RENEWAL_STATE_FILE_PATTERN.test(name)
    ).map((name) => name.match(SESSION_RENEWAL_STATE_FILE_PATTERN)?.[1] || "")
      .filter(Boolean);
  }

  async function runSessionRenewalStateExclusive(sessionId = "", operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Session renewal state mutation requires an operation.");
    }
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const statePath = renewalStatePath(normalizedSessionId);
    const lockPaths = pathsForSessionRoot(normalizedSessionId, "");
    return enqueueSessionMutation(statePath, async () => {
      const release = await acquireStoreSessionLock(lockPaths, "renewal-state", {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(
          `Timed out waiting to update Vibe64 session renewal: ${normalizedSessionId}`,
          "vibe64_session_renewal_state_lock_timeout"
        );
      }
      try {
        return await operation();
      } finally {
        await release();
      }
    });
  }

  async function runSessionRenewalWorkflowExclusive(sessionId = "", operation, {
    waitMs = 0
  } = {}) {
    if (typeof operation !== "function") {
      throw new TypeError("Session renewal workflow requires an operation.");
    }
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const lockPaths = pathsForSessionRoot(normalizedSessionId, "");
    const lockPath = sessionLockPath(lockPaths, "renewal-workflow");
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
    const release = await acquireStoreSessionLock(lockPaths, "renewal-workflow", {
      waitMs
    });
    if (!release) {
      return {
        acquired: false,
        value: null
      };
    }
    const lease = createSessionOperationLease();
    const participant = beginSessionOperation(lease);
    const nextLocks = new Map(activeLocks || []);
    nextLocks.set(lockPath, {
      lease,
      participant
    });
    try {
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

  function pathsForSessionRoot(sessionId = "", sessionRoot = "") {
    const rootPaths = paths();
    return sessionPathsFromRoot({
      activeSessionsRoot: rootPaths.activeSessionsRoot,
      closingSessionsRoot: rootPaths.closingSessionsRoot,
      archivedSessionsRoot: rootPaths.archivedSessionsRoot,
      currentSessionAliasPath: rootPaths.currentSessionAliasPath,
      projectContextRoot: rootPaths.projectContextRoot,
      sessionId: assertValidVibe64SessionId(sessionId),
      sessionRoot,
      sessionsRoot: rootPaths.sessionsRoot,
      stateRoot: rootPaths.stateRoot
    });
  }

  async function ensureActiveSessionRoot(sessionId) {
    const sessionPaths = paths(sessionId);
    if (!await pathExists(sessionPaths.manifestPath)) {
      const closingSession = closingSessionPaths(sessionPaths.sessionId);
      if (
        await pathExists(closingSession.manifestPath) ||
        await readSessionArchiveRecord(sessionPaths.sessionId)
      ) {
        throw vibe64Error(
          `Vibe64 session is already archived: ${sessionPaths.sessionId}`,
          "vibe64_session_archived"
        );
      }
      throw vibe64Error(
        `Unknown vibe64 session: ${sessionPaths.sessionId}`,
        "vibe64_session_not_found"
      );
    }
    return sessionPaths;
  }

  function closingSessionPaths(sessionId = "") {
    const rootPaths = paths();
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    return pathsForSessionRoot(
      normalizedSessionId,
      closingSessionRoot(rootPaths, normalizedSessionId)
    );
  }

  function sessionArchiveRecordFromJson(value = {}, {
    archivePath = "",
    metadataPath = ""
  } = {}) {
    if (
      !isPlainObject(value) ||
      value.kind !== SESSION_ARCHIVE_KIND ||
      value.schemaVersion !== VIBE64_SESSION_ARCHIVE_SCHEMA_VERSION ||
      !isValidVibe64SessionId(value.sessionId) ||
      !isPlainObject(value.index) ||
      normalizeText(value.index.sessionId) !== normalizeText(value.sessionId)
    ) {
      throw vibe64Error(
        `Invalid Vibe64 session archive metadata: ${metadataPath}`,
        "vibe64_invalid_session_archive_metadata"
      );
    }
    const normalizedStatus = assertVibe64SessionStatus(value.status);
    if (
      normalizedStatus !== VIBE64_SESSION_STATUS.ARCHIVED ||
      normalizeText(value.index.status) !== VIBE64_SESSION_STATUS.ARCHIVED
    ) {
      throw vibe64Error(
        `Invalid Vibe64 session archive status: ${normalizedStatus}`,
        "vibe64_invalid_session_archive_status"
      );
    }
    return {
      ...value,
      archivePath,
      index: value.index,
      metadataPath,
      status: normalizedStatus
    };
  }

  async function readSessionArchiveRecordFromRoot(rootPaths, sessionId) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const metadataPath = sessionArchiveMetadataPath(rootPaths, normalizedSessionId);
    if (!await pathExists(metadataPath)) {
      return null;
    }
    try {
      return sessionArchiveRecordFromJson(JSON.parse(await readFile(metadataPath, "utf8")), {
        archivePath: sessionArchivePath(rootPaths, normalizedSessionId),
        metadataPath
      });
    } catch (error) {
      if (error?.code?.startsWith?.("vibe64_")) {
        throw error;
      }
      throw vibe64Error(
        `Invalid Vibe64 session archive metadata: ${metadataPath}`,
        "vibe64_invalid_session_archive_metadata"
      );
    }
  }

  async function readSessionArchiveRecord(sessionId) {
    const rootPaths = paths();
    return readSessionArchiveRecordFromRoot(rootPaths, sessionId);
  }

  async function readPreparedRenewalArchive(sessionId) {
    const rootPaths = paths();
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const archivePath = preparedRenewalArchivePath(rootPaths, normalizedSessionId);
    const metadataPath = preparedRenewalMetadataPath(rootPaths, normalizedSessionId);
    const [archiveExists, metadataExists] = await Promise.all([
      pathExists(archivePath),
      pathExists(metadataPath)
    ]);
    if (!archiveExists && !metadataExists) {
      return null;
    }
    if (!archiveExists || !metadataExists) {
      throw vibe64Error(
        `Prepared renewal archive is incomplete for ${normalizedSessionId}.`,
        "vibe64_session_renewal_archive_incomplete"
      );
    }
    let value;
    try {
      value = JSON.parse(await readFile(metadataPath, "utf8"));
    } catch (error) {
      if (error?.code?.startsWith?.("vibe64_")) {
        throw error;
      }
      throw vibe64Error(
        `Invalid prepared renewal archive metadata: ${metadataPath}`,
        "vibe64_invalid_session_archive_metadata"
      );
    }
    return sessionArchiveRecordFromJson(value, {
      archivePath,
      metadataPath
    });
  }

  async function readSessionArchiveRecords() {
    const rootPaths = paths();
    const entries = await readDirectoryEntries(rootPaths.archivedSessionsRoot);
    const metadataFileNames = sortedFileNames(entries, (name) => {
      return name.endsWith(".json") && isValidVibe64SessionId(name.slice(0, -".json".length));
    });
    return (await Promise.all(metadataFileNames.map((fileName) => {
      return readSessionArchiveRecordFromRoot(rootPaths, fileName.slice(0, -".json".length));
    }))).filter(Boolean);
  }

  function sessionArchiveIndexMetadata(metadata = {}) {
    if (!isPlainObject(metadata)) {
      return {};
    }
    const entries = SESSION_ARCHIVE_INDEX_METADATA_NAMES
      .map((name) => [
        name,
        normalizeText(metadata[name])
      ])
      .filter(([, value]) => value);
    return Object.fromEntries(entries);
  }

  function sessionArchiveIndexFromSummary(summary = {}, {
    sessionId = ""
  } = {}) {
    const manifest = isPlainObject(summary.manifest) ? summary.manifest : {};
    const createdAt = normalizeText(summary.createdAt || manifest.createdAt);
    const updatedAt = normalizeText(summary.updatedAt || manifest.updatedAt || createdAt);
    return {
      createdAt,
      manifest: {
        createdAt,
        revision: revisionNumber(summary.revision ?? manifest.revision),
        runtimeKind: normalizeText(manifest.runtimeKind),
        updatedAt
      },
      metadata: sessionArchiveIndexMetadata(summary.metadata),
      revision: revisionNumber(summary.revision ?? manifest.revision),
      sessionId: assertValidVibe64SessionId(sessionId || summary.sessionId),
      sessionName: normalizeText(summary.sessionName),
      sessionRoot: "",
      status: VIBE64_SESSION_STATUS.ARCHIVED,
      updatedAt
    };
  }

  function sessionArchiveSummary(record = {}) {
    const index = isPlainObject(record.index) ? record.index : {};
    return {
      createdAt: normalizeText(index.createdAt),
      manifest: isPlainObject(index.manifest) ? index.manifest : {},
      metadata: isPlainObject(index.metadata) ? index.metadata : {},
      revision: revisionNumber(index.revision),
      sessionName: normalizeText(index.sessionName),
      updatedAt: normalizeText(index.updatedAt),
      archiveMetadataPath: record.metadataPath,
      archivePath: record.archivePath,
      archiveStatus: record.status,
      archived: true,
      archivedAt: normalizeText(record.archivedAt),
      sessionId: normalizeText(index.sessionId) || normalizeText(record.sessionId),
      sessionRoot: "",
      status: normalizeText(index.status) || normalizeText(record.status)
    };
  }

  function sessionArchiveMetadataRecord({
    archivePath = "",
    archivedAt = "",
    metadataPath = "",
    sessionId = "",
    summary = {}
  } = {}) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const archiveFileName = path.basename(archivePath);
    const metadataFileName = path.basename(metadataPath);
    return {
      archive: {
        fileName: archiveFileName,
        relativePath: `archived/${archiveFileName}`
      },
      archivedAt: normalizeText(archivedAt),
      index: sessionArchiveIndexFromSummary(summary, {
        sessionId: normalizedSessionId
      }),
      kind: SESSION_ARCHIVE_KIND,
      metadata: {
        fileName: metadataFileName,
        relativePath: `archived/${metadataFileName}`
      },
      schemaVersion: VIBE64_SESSION_ARCHIVE_SCHEMA_VERSION,
      sessionId: normalizedSessionId,
      status: VIBE64_SESSION_STATUS.ARCHIVED
    };
  }

  async function withExtractedSessionArchive(record, operation) {
    const extractionRoot = path.join(paths().sessionsRoot, ".archive-read", `${record.sessionId}-${randomUUID()}`);
    const extractedSessionRoot = path.join(extractionRoot, record.sessionId);
    try {
      await mkdir(extractionRoot, {
        recursive: true
      });
      const extractResult = await runCommand("tar", [
        "-xzf",
        record.archivePath,
        "-C",
        extractionRoot
      ], {
        allowedRoots: [
          extractionRoot,
          path.dirname(record.archivePath)
        ],
        cwd: normalizedProjectContextRoot
      });
      if (!extractResult.ok) {
        throw vibe64Error(
          `Cannot read Vibe64 session archive ${record.archivePath}: ${extractResult.output}`,
          "vibe64_session_archive_read_failed"
        );
      }
      const sessionPaths = pathsForSessionRoot(record.sessionId, extractedSessionRoot);
      if (!await pathExists(sessionPaths.manifestPath)) {
        throw vibe64Error(
          `Vibe64 session archive does not contain session ${record.sessionId}.`,
          "vibe64_session_archive_missing_session"
        );
      }
      return await operation(sessionPaths, record);
    } finally {
      await rm(extractionRoot, {
        force: true,
        recursive: true
      });
    }
  }

  async function readUnarchivedSessionIfPresent(sessionId, operation) {
    for (const sessionPaths of [
      paths(sessionId),
      closingSessionPaths(sessionId)
    ]) {
      if (!await pathExists(sessionPaths.manifestPath)) {
        continue;
      }
      try {
        const value = await operation(sessionPaths, null);
        if (await pathExists(sessionPaths.manifestPath)) {
          return {
            found: true,
            value
          };
        }
      } catch (error) {
        // Closing only renames the tree; its contents do not change. Retry at
        // the next location only when the manifest moved during this read.
        if (await pathExists(sessionPaths.manifestPath)) {
          throw error;
        }
      }
    }
    return {
      found: false
    };
  }

  async function withReadableSessionPathsForRenewal(sessionId, operation) {
    const activePaths = paths(sessionId);
    const unarchivedRead = await readUnarchivedSessionIfPresent(sessionId, operation);
    if (unarchivedRead.found) {
      return unarchivedRead.value;
    }
    const publishedArchive = await readSessionArchiveRecord(sessionId);
    if (publishedArchive) {
      return withExtractedSessionArchive(publishedArchive, operation);
    }
    throw vibe64Error(`Unknown vibe64 session: ${activePaths.sessionId}`, "vibe64_session_not_found");
  }

  async function withPublishedRenewalSession(sessionId, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Published renewal session work requires an operation.");
    }
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const archiveRecord = await readSessionArchiveRecord(normalizedSessionId);
    if (!archiveRecord) {
      throw vibe64Error(
        `Renewal predecessor has no published archive: ${normalizedSessionId}`,
        "vibe64_session_renewal_archive_required"
      );
    }
    return withExtractedSessionArchive(archiveRecord, async (sessionPaths, record) => {
      const session = await readSessionFromPaths(sessionPaths, record);
      return operation({
        ...session,
        artifactsRoot: sessionPaths.artifactsRoot,
        sessionRoot: sessionPaths.sessionRoot
      });
    });
  }

  async function withPreparedRenewalSession(sessionId, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Prepared renewal session work requires an operation.");
    }
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const archiveRecord = await readPreparedRenewalArchive(normalizedSessionId);
    if (!archiveRecord) {
      throw vibe64Error(
        `Renewal predecessor has no prepared archive: ${normalizedSessionId}`,
        "vibe64_session_renewal_archive_required"
      );
    }
    await validateSessionArchive(archiveRecord.archivePath);
    return withExtractedSessionArchive(archiveRecord, async (sessionPaths, record) => {
      const session = await readSessionFromPaths(sessionPaths, record);
      return operation({
        ...session,
        artifactsRoot: sessionPaths.artifactsRoot,
        sessionRoot: sessionPaths.sessionRoot
      });
    });
  }

  async function withReadableSessionPaths(sessionId, operation) {
    return withReadableSessionPathsForRenewal(sessionId, async (sessionPaths, archiveRecord) => {
      assertNormalSessionIsReadable({
        sessionId: sessionPaths.sessionId,
        status: await readStatusFromPaths(sessionPaths)
      });
      return operation(sessionPaths, archiveRecord);
    });
  }

  async function bumpSessionRevision(sessionPaths) {
    const manifest = await readManifestFromPaths(sessionPaths);
    const nextManifest = {
      ...manifest,
      revision: revisionNumber(manifest.revision) + 1,
      updatedAt: now().toISOString()
    };
    await writeJsonFile(sessionPaths.manifestPath, nextManifest);
    return nextManifest;
  }

  async function mutateSessionRecord(sessionId, operation, {
    renewal = false
  } = {}) {
    const requestedPaths = paths(sessionId);
    const key = requestedPaths.sessionRoot;
    const inheritedContext = sessionMutationContext.getStore();
    if (inheritedContext?.key === key && inheritedContext.participant?.active === true) {
      const participant = beginSessionOperation(inheritedContext.lease);
      try {
        return await sessionMutationContext.run({
          key,
          lease: inheritedContext.lease,
          participant,
          renewal: renewal || inheritedContext.renewal === true,
          sessionPaths: inheritedContext.sessionPaths
        }, () => operation(inheritedContext.sessionPaths));
      } finally {
        finishSessionOperation(inheritedContext.lease, participant);
      }
    }
    return enqueueSessionMutation(key, async () => {
      const release = await acquireStoreSessionLock(requestedPaths, "mutation", {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(
          `Timed out waiting to update Vibe64 session: ${requestedPaths.sessionId}`,
          "vibe64_session_mutation_lock_timeout"
        );
      }
      try {
        // Resolve the active tree only after acquiring the stable session lock.
        // A close operation may have detached it while this writer was queued.
        const sessionPaths = await ensureActiveSessionRoot(requestedPaths.sessionId);
        const lease = createSessionOperationLease();
        const participant = beginSessionOperation(lease);
        let result;
        try {
          result = await sessionMutationContext.run({
            key,
            lease,
            participant,
            renewal,
            sessionPaths
          }, () => operation(sessionPaths));
        } finally {
          finishSessionOperation(lease, participant);
          await lease.idle;
        }
        const manifest = await bumpSessionRevision(sessionPaths);
        return withRevisionMarker(result, manifest, sessionPaths.sessionId);
      } finally {
        await release();
      }
    });
  }

  async function mutateSession(sessionId, operation) {
    const requestedPaths = paths(sessionId);
    const inheritedContext = sessionMutationContext.getStore();
    if (
      inheritedContext?.key === requestedPaths.sessionRoot &&
      inheritedContext.participant?.active === true &&
      inheritedContext.renewal === true
    ) {
      return mutateSessionRecord(sessionId, operation, {
        renewal: true
      });
    }
    return mutateSessionRecord(sessionId, async (sessionPaths) => {
      assertNormalSessionIsMutable({
        sessionId: sessionPaths.sessionId,
        status: await readStatusFromPaths(sessionPaths)
      });
      return operation(sessionPaths);
    });
  }

  async function mutateSessionForRenewal(sessionId, operation) {
    return mutateSessionRecord(sessionId, operation, {
      renewal: true
    });
  }

  async function runSessionExclusiveRecord(sessionId, operationName, operation, {
    operation: diagnosticOperation = "",
    renewal = false,
    waitMs = 0
  } = {}) {
    if (typeof operation !== "function") {
      throw new TypeError("Exclusive Vibe64 session work requires an operation.");
    }
    const sessionPaths = await ensureActiveSessionRoot(sessionId);
    const lockPath = sessionLockPath(sessionPaths, operationName);
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
    let blockingOperation = "";
    const release = await acquireStoreSessionLock(sessionPaths, operationName, {
      onRejected: (ownerOperation) => { blockingOperation = ownerOperation; },
      operation: diagnosticOperation,
      waitMs
    });
    if (!release) {
      return {
        acquired: false,
        blockingOperation,
        value: null
      };
    }
    const lease = createSessionOperationLease();
    const participant = beginSessionOperation(lease);
    const nextLocks = new Map(activeLocks || []);
    nextLocks.set(lockPath, {
      lease,
      participant
    });
    try {
      if (!renewal) {
        assertNormalSessionIsMutable({
          sessionId: sessionPaths.sessionId,
          status: await readStatusFromPaths(sessionPaths)
        });
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

  async function runSessionExclusive(sessionId, operationName, operation, options = {}) {
    return runSessionExclusiveRecord(sessionId, operationName, operation, options);
  }

  async function runSessionExclusiveForRenewal(sessionId, operationName, operation, options = {}) {
    return runSessionExclusiveRecord(sessionId, operationName, operation, {
      ...options,
      renewal: true
    });
  }

  async function writeStatus(sessionId, status) {
    const normalizedStatus = assertVibe64SessionStatus(status);
    if (RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
      throw vibe64Error(
        `Renewal session status requires a renewal transition: ${normalizedStatus}`,
        "vibe64_session_renewal_transition_required"
      );
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      const currentStatus = await readStatusFromPaths(sessionPaths);
      if (RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES.has(currentStatus)) {
        throw vibe64Error(
          `Renewal session status requires a renewal transition: ${currentStatus}`,
          "vibe64_session_renewal_transition_required"
        );
      }
      await writeTextFile(sessionPaths.statusPath, `${normalizedStatus}\n`);
    });
  }

  async function readStatus(sessionId) {
    const status = await readStatusForRenewal(sessionId);
    if (HIDDEN_VIBE64_SESSION_STATUSES.has(status)) {
      throw vibe64Error(
        `Vibe64 session is reserved for an in-progress renewal: ${assertValidVibe64SessionId(sessionId)}`,
        "vibe64_session_renewal_private"
      );
    }
    return status;
  }

  async function readStatusForRenewal(sessionId) {
    return withReadableSessionPathsForRenewal(sessionId, readStatusFromPaths);
  }

  async function readStatusFromPaths(sessionPaths) {
    return normalizeText(await readTextIfExists(sessionPaths.statusPath)) || VIBE64_SESSION_STATUS.ACTIVE;
  }

  async function writeMetadataValue(sessionId, name, value) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await writeTextFile(metadataFilePath(sessionPaths, name), `${normalizeText(value)}\n`);
    });
  }

  async function writeMetadataValueForRenewal(sessionId, name, value) {
    return mutateSessionForRenewal(sessionId, async (sessionPaths) => {
      await writeTextFile(metadataFilePath(sessionPaths, name), `${normalizeText(value)}\n`);
    });
  }

  async function writeSessionLabel(sessionId, sessionLabel) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const sessionName = normalizeSessionLabel(sessionLabel);
      if (!sessionName) {
        await rm(metadataFilePath(sessionPaths, SESSION_LABEL_METADATA), {
          force: true
        });
        return "";
      }
      await writeTextFile(metadataFilePath(sessionPaths, SESSION_LABEL_METADATA), `${sessionName}\n`);
      return sessionName;
    });
  }

  async function readMetadataValue(sessionId, name) {
    return withReadableSessionPaths(sessionId, async (sessionPaths) => {
      return normalizeText(await readTextIfExists(metadataFilePath(sessionPaths, name)));
    });
  }

  async function deleteMetadataValue(sessionId, name) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await rm(metadataFilePath(sessionPaths, name), {
        force: true
      });
    });
  }

  async function deleteMetadataValues(sessionId, names = []) {
    await Promise.all(names.map((name) => deleteMetadataValue(sessionId, name)));
  }

  async function readMetadata(sessionId) {
    return withReadableSessionPaths(sessionId, readMetadataFromPaths);
  }

  async function readMetadataFromPaths(sessionPaths) {
    const names = sortedFileNames(
      await readDirectoryEntries(sessionPaths.metadataRoot),
      (name) => METADATA_NAME_PATTERN.test(name)
    );
    const metadataEntries = await Promise.all(
      names.map(async (name) => {
        return [
          name,
          normalizeText(await readTextIfExists(metadataFilePath(sessionPaths, name)))
        ];
      })
    );
    return Object.fromEntries(metadataEntries);
  }

  async function readSessionSourceDescriptor(sessionId) {
    return withReadableSessionPaths(sessionId, async (sessionPaths) => {
      const metadataEntries = await Promise.all(
        SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES.map(async (name) => [
          name,
          normalizeText(await readTextIfExists(metadataFilePath(sessionPaths, name)))
        ])
      );
      return {
        metadata: Object.fromEntries(metadataEntries),
        projectContextRoot: sessionPaths.projectContextRoot,
        sessionId: sessionPaths.sessionId,
        sessionRoot: sessionPaths.sessionRoot
      };
    });
  }

  async function sessionNameForSession(sessionPaths, metadata = {}) {
    return normalizeSessionLabel(metadata[SESSION_LABEL_METADATA]) || sessionPaths.sessionId;
  }

  async function writeArtifact(sessionId, relativePath, text) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const artifactPath = artifactFilePath(sessionPaths, relativePath);
      await writeTextFile(artifactPath, text);
      return artifactPath;
    });
  }

  async function writeJsonArtifact(sessionId, relativePath, value) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const artifactPath = artifactFilePath(sessionPaths, relativePath);
      await writeJsonFile(artifactPath, value);
      return artifactPath;
    });
  }

  async function readArtifact(sessionId, relativePath) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => {
      return readTextIfExists(artifactFilePath(sessionPaths, relativePath));
    });
  }

  async function readArtifactForRenewal(sessionId, relativePath) {
    return withReadableSessionPathsForRenewal(sessionId, (sessionPaths) => {
      return readTextIfExists(artifactFilePath(sessionPaths, relativePath));
    });
  }

  async function writeJsonArtifactForRenewal(sessionId, relativePath, value) {
    return mutateSessionForRenewal(sessionId, async (sessionPaths) => {
      const artifactPath = artifactFilePath(sessionPaths, relativePath);
      await writeJsonFile(artifactPath, value);
      return artifactPath;
    });
  }

  async function readAgentRunFromPath(sessionPaths, runId) {
    const normalizedRunId = assertSafeAgentRunId(runId);
    const runText = await readTextIfExists(agentRunFilePath(sessionPaths, normalizedRunId));
    if (!runText) {
      return null;
    }
    try {
      const record = JSON.parse(runText);
      return isPlainObject(record)
        ? {
            ...record,
            active: vibe64AgentRunStateIsActive(record.state),
            events: Array.isArray(record.events) ? record.events.filter(isPlainObject) : [],
            id: normalizedRunId,
            state: normalizeVibe64AgentRunState(record.state)
          }
        : null;
    } catch {
      throw vibe64Error(
        `Invalid vibe64 agent run: ${normalizedRunId}`,
        "vibe64_invalid_agent_run"
      );
    }
  }

  async function readAgentRun(sessionId, runId) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readAgentRunFromPath(sessionPaths, runId));
  }

  async function readAgentRuns(sessionId) {
    return withReadableSessionPaths(sessionId, readAgentRunsFromPaths);
  }

  async function readAgentRunsFromPaths(sessionPaths) {
    const runNames = sortedFileNames(
      await readDirectoryEntries(sessionPaths.agentRunsRoot),
      (name) => name.endsWith(".json") && isSafeAgentRunId(name.slice(0, -".json".length))
    );
    const runs = await Promise.all(runNames.map((fileName) => {
      return readAgentRunFromPath(sessionPaths, fileName.slice(0, -".json".length));
    }));
    return runs
      .filter(Boolean)
      .sort((left, right) => {
        const timeComparison = normalizeText(left.updatedAt).localeCompare(normalizeText(right.updatedAt));
        return timeComparison || normalizeText(left.id).localeCompare(normalizeText(right.id));
      });
  }

  async function writeAgentRunEvent(sessionId, runId, {
    event = {},
    patch = {}
  } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedRunId = assertSafeAgentRunId(runId);
      const previous = await readAgentRunFromPath(sessionPaths, normalizedRunId) || {
        events: [],
        id: normalizedRunId
      };
      const eventAt = normalizeText(event.at || patch.updatedAt) || now().toISOString();
      const state = normalizeVibe64AgentRunState(patch.state || event.state || previous.state);
      const terminalState = vibe64AgentRunStateIsTerminal(state);
      const eventRecord = {
        ...event,
        at: eventAt,
        kind: normalizeText(event.kind || state || "updated"),
        message: normalizeText(event.message || patch.message),
        state
      };
      const record = {
        ...previous,
        ...patch,
        active: !terminalState,
        events: [
          ...(Array.isArray(previous.events) ? previous.events : []),
          eventRecord
        ],
        finishedAt: terminalState
          ? normalizeText(patch.finishedAt || previous.finishedAt) || eventAt
          : "",
        id: normalizedRunId,
        startedAt: normalizeText(previous.startedAt || patch.startedAt) || eventAt,
        state,
        updatedAt: eventAt
      };
      if (!terminalState && !Object.hasOwn(patch, "error")) {
        record.error = "";
      }
      await writeJsonFile(agentRunFilePath(sessionPaths, normalizedRunId), record);
      return record;
    });
  }

  async function readBackgroundTaskFromPath(sessionPaths, taskId) {
    const normalizedTaskId = assertSafeBackgroundTaskId(taskId);
    const taskText = await readTextIfExists(backgroundTaskFilePath(sessionPaths, normalizedTaskId));
    if (!taskText) {
      return null;
    }
    try {
      const record = JSON.parse(taskText);
      return isPlainObject(record)
        ? {
            ...record,
            events: Array.isArray(record.events) ? record.events.filter(isPlainObject) : [],
            id: normalizedTaskId,
            status: normalizeBackgroundTaskStatus(record.status)
          }
        : null;
    } catch {
      throw vibe64Error(
        `Invalid vibe64 background task: ${normalizedTaskId}`,
        "vibe64_invalid_background_task"
      );
    }
  }

  async function readBackgroundTask(sessionId, taskId) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readBackgroundTaskFromPath(sessionPaths, taskId));
  }

  async function readBackgroundTasks(sessionId) {
    return withReadableSessionPaths(sessionId, readBackgroundTasksFromPaths);
  }

  async function readBackgroundTasksFromPaths(sessionPaths) {
    const taskNames = sortedFileNames(
      await readDirectoryEntries(sessionPaths.backgroundTasksRoot),
      (name) => name.endsWith(".json") && isSafeBackgroundTaskId(name.slice(0, -".json".length))
    );
    const tasks = await Promise.all(taskNames.map((fileName) => {
      return readBackgroundTaskFromPath(sessionPaths, fileName.slice(0, -".json".length));
    }));
    return tasks
      .filter(Boolean)
      .sort((left, right) => {
        const timeComparison = normalizeText(left.updatedAt).localeCompare(normalizeText(right.updatedAt));
        return timeComparison || normalizeText(left.id).localeCompare(normalizeText(right.id));
      });
  }

  async function writeBackgroundTaskEvent(sessionId, taskId, {
    event = {},
    patch = {},
    reset = false,
    shouldWrite = null
  } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedTaskId = assertSafeBackgroundTaskId(taskId);
      const previous = reset === true
        ? { events: [], id: normalizedTaskId }
        : await readBackgroundTaskFromPath(sessionPaths, normalizedTaskId) || {
            events: [],
            id: normalizedTaskId
          };
      const eventAt = normalizeText(event.at || patch.updatedAt) || now().toISOString();
      const status = normalizeBackgroundTaskStatus(patch.status || event.status || previous.status);
      const previousStatus = normalizeText(previous.status);
      const eventRecord = {
        ...event,
        at: eventAt,
        kind: normalizeText(event.kind || status || "updated"),
        message: normalizeText(event.message || patch.message),
        status
      };
      if (typeof shouldWrite === "function" && !shouldWrite({
        event: eventRecord,
        patch,
        previous,
        status
      })) {
        return previous;
      }
      const record = {
        ...previous,
        ...patch,
        events: [
          ...(Array.isArray(previous.events) ? previous.events : []),
          eventRecord
        ].slice(-BACKGROUND_TASK_EVENT_LIMIT),
        finishedAt: status === BACKGROUND_TASK_STATUS.RUNNING
          ? ""
          : normalizeText(patch.finishedAt || previous.finishedAt) || eventAt,
        id: normalizedTaskId,
        kind: Object.hasOwn(patch, "kind")
          ? normalizeText(patch.kind)
          : normalizeText(eventRecord.kind || previous.kind),
        message: Object.hasOwn(patch, "message")
          ? normalizeText(patch.message)
          : Object.hasOwn(event, "message")
            ? normalizeText(event.message)
            : normalizeText(previous.message),
        startedAt: status === BACKGROUND_TASK_STATUS.RUNNING && previousStatus !== BACKGROUND_TASK_STATUS.RUNNING
          ? eventAt
          : normalizeText(patch.startedAt || previous.startedAt) || eventAt,
        status,
        updatedAt: eventAt
      };
      if (status !== BACKGROUND_TASK_STATUS.RUNNING && !Object.hasOwn(patch, "stage")) {
        delete record.stage;
      }
      if (status !== BACKGROUND_TASK_STATUS.FAILED && !Object.hasOwn(patch, "error")) {
        record.error = "";
      }
      await writeJsonFile(backgroundTaskFilePath(sessionPaths, normalizedTaskId), record);
      return record;
    });
  }

  async function readConversationMessage(sessionPaths, turnId, fileName) {
    const match = normalizeText(fileName).match(CONVERSATION_MESSAGE_FILE_PATTERN);
    if (!match) {
      return null;
    }
    const messageId = normalizeText(match[3]);
    return {
      at: isoFromConversationTimestamp(match[2]),
      role: match[1],
      text: normalizeText(await readTextIfExists(path.join(conversationTurnRoot(sessionPaths, turnId), fileName))),
      ...(messageId ? { messageId } : {})
    };
  }

  async function readConversationTurn(sessionPaths, turnId) {
    const fileNames = sortedFileNames(
      await readDirectoryEntries(conversationTurnRoot(sessionPaths, turnId)),
      (name) => CONVERSATION_MESSAGE_FILE_PATTERN.test(name)
    );
    const messages = (await Promise.all(
      fileNames.map((fileName) => readConversationMessage(sessionPaths, turnId, fileName))
    )).filter((message) => message && message.text);
    const storedUser = messages.find((message) => message.role === "user") || null;
    const assistant = messages.find((message) => message.role === "assistant") || null;
    const commentary = messages.filter((message) => message.role === "commentary");
    const system = messages.find((message) => message.role === "system") || null;
    const thinking = messages.filter((message) => message.role === "thinking");
    const activity = [...thinking, ...commentary]
      .sort((left, right) => left.at.localeCompare(right.at));
    const [attachments, metadata] = await Promise.all([
      readConversationTurnAttachments(sessionPaths, turnId),
      readConversationTurnMetadata(sessionPaths, turnId)
    ]);
    const user = storedUser && attachments.length
      ? { ...storedUser, attachments }
      : storedUser;
    return {
      assistant,
      commentary,
      messages: [system, user, ...activity, assistant].filter(Boolean),
      ...(metadata ? { metadata } : {}),
      ...(system ? { system } : {}),
      thinking,
      turnId,
      user
    };
  }

  async function readConversationTurnAttachments(sessionPaths, turnId) {
    const source = await readTextIfExists(path.join(
      conversationTurnRoot(sessionPaths, turnId),
      CONVERSATION_TURN_ATTACHMENTS_FILE
    ));
    if (!source) {
      return [];
    }
    try {
      const value = JSON.parse(source);
      const attachments = normalizeVibe64ConversationAttachments(value);
      if (!Array.isArray(value) || attachments.length !== value.length) {
        throw new TypeError("Conversation attachments must be a valid attachment list.");
      }
      return attachments;
    } catch (error) {
      throw vibe64Error(
        `Conversation turn ${turnId} attachments are invalid: ${normalizeText(error?.message) || "unknown error"}`,
        "vibe64_invalid_conversation_turn_attachments"
      );
    }
  }

  async function readConversationTurnMetadata(sessionPaths, turnId) {
    const text = await readTextIfExists(path.join(
      conversationTurnRoot(sessionPaths, turnId),
      CONVERSATION_TURN_METADATA_FILE
    ));
    if (!text) {
      return null;
    }
    try {
      return normalizeConversationTurnMetadata(JSON.parse(text));
    } catch (error) {
      if (error instanceof SyntaxError) {
        throw vibe64Error(
          `Conversation turn ${turnId} metadata is not valid JSON.`,
          "vibe64_invalid_conversation_turn_metadata"
        );
      }
      throw error;
    }
  }

  function normalizeConversationTurnMetadata(value = null) {
    if (!isPlainObject(value)) {
      throw vibe64Error(
        "Conversation turn metadata must be an object.",
        "vibe64_invalid_conversation_turn_metadata"
      );
    }
    return {
      actorDisplayName: normalizeText(value.actorDisplayName),
      actorId: normalizeText(value.actorId)
    };
  }

  async function conversationTurnIds(sessionPaths) {
    return sortedDirectoryNames(
      await readDirectoryEntries(sessionPaths.conversationLogRoot),
      (name) => CONVERSATION_TURN_ID_PATTERN.test(name)
    );
  }

  async function conversationMessageIdExistsFromPaths(sessionPaths, messageId = "") {
    const normalizedMessageId = normalizeText(messageId);
    if (!normalizedMessageId) {
      return false;
    }
    if (!CONVERSATION_MESSAGE_ID_PATTERN.test(normalizedMessageId)) {
      throw vibe64Error(
        `Invalid vibe64 conversation message id: ${normalizedMessageId}`,
        "vibe64_invalid_conversation_message_id"
      );
    }
    const suffix = `.${normalizedMessageId}.md`;
    const turnIds = await conversationTurnIds(sessionPaths);
    for (const turnId of [...turnIds].reverse()) {
      const entries = await readDirectoryEntries(conversationTurnRoot(sessionPaths, turnId));
      if (entries.some((entry) => (
        entry.isFile() &&
        entry.name.endsWith(suffix) &&
        CONVERSATION_MESSAGE_FILE_PATTERN.test(entry.name)
      ))) {
        return true;
      }
    }
    return false;
  }

  async function tailOpenConversationTurnId(sessionPaths) {
    const turnIds = await conversationTurnIds(sessionPaths);
    const turnId = turnIds.at(-1) || "";
    if (!turnId) {
      return "";
    }
    const turn = await readConversationTurn(sessionPaths, turnId);
    return turn.user && !turn.assistant ? turnId : "";
  }

  async function tailThinkingOnlyConversationTurnId(sessionPaths, {
    messageAt = ""
  } = {}) {
    const turnIds = await conversationTurnIds(sessionPaths);
    const turnId = turnIds.at(-1) || "";
    if (!turnId || !messageAt) {
      return "";
    }
    const turn = await readConversationTurn(sessionPaths, turnId);
    if (turn.system || turn.user || turn.assistant || turn.commentary.length || !turn.thinking.length) {
      return "";
    }
    return turn.thinking.some((message) => message.at === messageAt) ? turnId : "";
  }

  async function readConversationLog(sessionId) {
    return withReadableSessionPaths(sessionId, readConversationLogFromPaths);
  }

  async function readConversationLogFromPaths(sessionPaths) {
    const turnIds = await conversationTurnIds(sessionPaths);
    const turns = await Promise.all(turnIds.map((turnId) => readConversationTurn(sessionPaths, turnId)));
    return turns.filter(conversationTurnHasMessages);
  }

  async function readConversationLogPage(sessionId, options = {}) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readConversationLogPageFromPaths(sessionPaths, options));
  }

  async function readConversationLogPageFromPaths(sessionPaths, options = {}) {
    const turnIds = await conversationTurnIds(sessionPaths);
    const page = conversationLogPageTurnIds(turnIds, options);
    const turns = await Promise.all(page.turnIds.map((turnId) => readConversationTurn(sessionPaths, turnId)));
    const conversationLog = turns.filter(conversationTurnHasMessages);
    return {
      conversationLog,
      pagination: {
        beforeTurnId: page.beforeTurnId,
        count: conversationLog.length,
        hasMoreBefore: page.hasMoreBefore,
        limit: page.limit,
        newestTurnId: conversationLog.at(-1)?.turnId || "",
        nextBeforeTurnId: page.hasMoreBefore ? conversationLog[0]?.turnId || page.nextBeforeTurnId : "",
        oldestTurnId: conversationLog[0]?.turnId || "",
        totalTurnCount: turnIds.length
      }
    };
  }

  function conversationLogPageTurnIds(turnIds = [], {
    beforeTurnId = "",
    limit = 0
  } = {}) {
    const ids = Array.isArray(turnIds) ? turnIds.filter((turnId) => CONVERSATION_TURN_ID_PATTERN.test(turnId)) : [];
    const normalizedBeforeTurnId = normalizeText(beforeTurnId);
    const normalizedLimit = normalizeConversationLogPageLimit(limit);
    const beforeIndex = normalizedBeforeTurnId && ids.includes(normalizedBeforeTurnId)
      ? ids.indexOf(normalizedBeforeTurnId)
      : ids.length;
    const endIndex = Math.max(0, beforeIndex);
    const startIndex = normalizedLimit > 0
      ? Math.max(0, endIndex - normalizedLimit)
      : 0;
    const pageIds = ids.slice(startIndex, endIndex);
    return {
      beforeTurnId: normalizedBeforeTurnId,
      hasMoreBefore: startIndex > 0,
      limit: normalizedLimit,
      nextBeforeTurnId: pageIds[0] || "",
      turnIds: pageIds
    };
  }

  function normalizeConversationLogPageLimit(value = 0) {
    const number = Number.parseInt(String(value || ""), 10);
    if (!Number.isFinite(number) || number < 1) {
      return 0;
    }
    return Math.min(number, 100);
  }

  async function conversationMessageIdExists(sessionId, messageId = "") {
    return withReadableSessionPaths(sessionId, (sessionPaths) => (
      conversationMessageIdExistsFromPaths(sessionPaths, messageId)
    ));
  }

  async function writeConversationUserMessage(sessionId, {
    attachments = [],
    messageId = "",
    text = "",
    turnMetadata = null
  } = {}) {
    const messageText = normalizeText(text);
    const normalizedMessageId = normalizeText(messageId);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      if (
        normalizedMessageId &&
        await conversationMessageIdExistsFromPaths(sessionPaths, normalizedMessageId)
      ) {
        return null;
      }
      const turnId = nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      const displayAttachments = normalizeVibe64ConversationAttachments(attachments);
      if (displayAttachments.length) {
        await writeJsonFile(
          path.join(conversationTurnRoot(sessionPaths, turnId), CONVERSATION_TURN_ATTACHMENTS_FILE),
          displayAttachments
        );
      }
      if (turnMetadata) {
        await writeJsonFile(
          path.join(conversationTurnRoot(sessionPaths, turnId), CONVERSATION_TURN_METADATA_FILE),
          normalizeConversationTurnMetadata(turnMetadata)
        );
      }
      await writeTextFile(
        path.join(
          conversationTurnRoot(sessionPaths, turnId),
          conversationMessageFileName("user", createdAt, normalizedMessageId)
        ),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function writeConversationAssistantMessage(sessionId, {
    messageId = "",
    text = ""
  } = {}) {
    const messageText = normalizeText(text);
    const normalizedMessageId = normalizeText(messageId);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      if (
        normalizedMessageId &&
        await conversationMessageIdExistsFromPaths(sessionPaths, normalizedMessageId)
      ) {
        return null;
      }
      const turnId = await tailOpenConversationTurnId(sessionPaths) ||
        nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      await writeTextFile(
        path.join(
          conversationTurnRoot(sessionPaths, turnId),
          conversationMessageFileName("assistant", createdAt, normalizedMessageId)
        ),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function upsertConversationAssistantMessage(sessionId, {
    text = "",
    turnId = ""
  } = {}) {
    const messageText = normalizeText(text);
    const normalizedTurnId = normalizeText(turnId);
    if (!messageText) {
      return null;
    }
    if (!CONVERSATION_TURN_ID_PATTERN.test(normalizedTurnId)) {
      throw vibe64Error(
        `Invalid vibe64 conversation turn id: ${normalizedTurnId || "(empty)"}`,
        "vibe64_invalid_conversation_turn_id"
      );
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      const turnRoot = conversationTurnRoot(sessionPaths, normalizedTurnId);
      const assistantFiles = sortedFileNames(
        await readDirectoryEntries(turnRoot),
        (name) => name.startsWith("assistant.") && CONVERSATION_MESSAGE_FILE_PATTERN.test(name)
      );
      const assistantFile = assistantFiles[0] || conversationMessageFileName("assistant", now());
      await writeTextFile(path.join(turnRoot, assistantFile), `${messageText}\n`);
      await Promise.all(assistantFiles.slice(1).map((fileName) => rm(path.join(turnRoot, fileName), {
        force: true
      })));
      return readConversationTurn(sessionPaths, normalizedTurnId);
    });
  }

  async function writeConversationActivityMessage(sessionId, role, {
    at = "",
    messageId = "",
    requireOpenTurn = false,
    text = ""
  } = {}) {
    if (!CONVERSATION_ACTIVITY_ROLES.has(role)) {
      throw vibe64Error(
        `Invalid vibe64 conversation activity role: ${role || "(empty)"}`,
        "vibe64_invalid_conversation_role"
      );
    }
    const messageText = normalizeText(text);
    const normalizedMessageId = normalizeText(messageId);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      if (
        normalizedMessageId &&
        await conversationMessageIdExistsFromPaths(sessionPaths, normalizedMessageId)
      ) {
        return null;
      }
      const createdAt = at ? toDate(at) : now();
      const openTurnId = await tailOpenConversationTurnId(sessionPaths);
      if (requireOpenTurn && !openTurnId) {
        return null;
      }
      const thinkingOnlyTurnId = role === "thinking" && !openTurnId
        ? await tailThinkingOnlyConversationTurnId(sessionPaths, {
            messageAt: at ? createdAt.toISOString() : ""
          })
        : "";
      const turnId = openTurnId || thinkingOnlyTurnId || nextConversationTurnId(await conversationTurnIds(sessionPaths));
      await writeTextFile(
        path.join(
          conversationTurnRoot(sessionPaths, turnId),
          conversationMessageFileName(role, createdAt, normalizedMessageId)
        ),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function writeConversationCommentaryMessage(sessionId, options = {}) {
    return writeConversationActivityMessage(sessionId, "commentary", options);
  }

  async function writeConversationThinkingMessage(sessionId, options = {}) {
    return writeConversationActivityMessage(sessionId, "thinking", options);
  }

  async function writeConversationSystemMessage(sessionId, {
    messageId = "",
    text = ""
  } = {}) {
    const messageText = normalizeText(text);
    const normalizedMessageId = normalizeText(messageId);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      if (
        normalizedMessageId &&
        await conversationMessageIdExistsFromPaths(sessionPaths, normalizedMessageId)
      ) {
        return null;
      }
      const turnId = nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      await writeTextFile(
        path.join(
          conversationTurnRoot(sessionPaths, turnId),
          conversationMessageFileName("system", createdAt, normalizedMessageId)
        ),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function readManifest(sessionId) {
    return withReadableSessionPaths(sessionId, readManifestFromPaths);
  }

  async function readManifestFromPaths(sessionPaths) {
    const manifestText = await readTextIfExists(sessionPaths.manifestPath);
    try {
      return normalizeManifest(JSON.parse(manifestText));
    } catch {
      throw vibe64Error(`Invalid vibe64 session manifest: ${sessionPaths.sessionId}`, "vibe64_invalid_manifest");
    }
  }

  async function readSession(sessionId) {
    return assertNormalSessionIsReadable(await readSessionForRenewal(sessionId));
  }

  async function readSessionForRenewal(sessionId) {
    return withReadableSessionPathsForRenewal(sessionId, readSessionFromPaths);
  }

  async function readSessionFromPaths(sessionPaths, archiveRecord = null) {
    const [
      manifest,
      status,
      metadata,
      agentRuns,
      backgroundTasks
    ] = await Promise.all([
      readManifestFromPaths(sessionPaths),
      readStatusFromPaths(sessionPaths),
      readMetadataFromPaths(sessionPaths),
      readAgentRunsFromPaths(sessionPaths),
      readBackgroundTasksFromPaths(sessionPaths)
    ]);
    const archived = Boolean(archiveRecord);
    const sessionName = await sessionNameForSession(sessionPaths, metadata);
    return {
      agentRuns,
      agentRunsRoot: archived ? "" : sessionPaths.agentRunsRoot,
      artifactsRoot: archived ? "" : sessionPaths.artifactsRoot,
      backgroundTasks,
      backgroundTasksRoot: archived ? "" : sessionPaths.backgroundTasksRoot,
      conversationLogRoot: archived ? "" : sessionPaths.conversationLogRoot,
      manifest,
      metadata,
      metadataRoot: archived ? "" : sessionPaths.metadataRoot,
      projectContextRoot: sessionPaths.projectContextRoot,
      revision: revisionNumber(manifest.revision),
      sessionId: sessionPaths.sessionId,
      sessionName,
      sessionRoot: archived ? "" : sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt),
      ...(archived
        ? {
            archivePath: archiveRecord.archivePath,
            archiveStatus: archiveRecord.status,
            archived: true,
            archivedAt: normalizeText(archiveRecord.archivedAt),
            archiveMetadataPath: archiveRecord.metadataPath
          }
        : {})
    };
  }

  async function readSessionSummary(sessionId) {
    return assertNormalSessionIsReadable(await readSessionSummaryForRenewal(sessionId));
  }

  async function readSessionSummaryForRenewal(sessionId) {
    const activePaths = paths(sessionId);
    const unarchivedRead = await readUnarchivedSessionIfPresent(
      sessionId,
      readSessionSummaryFromPaths
    );
    if (unarchivedRead.found) {
      return unarchivedRead.value;
    }
    const publishedArchive = await readSessionArchiveRecord(sessionId);
    if (publishedArchive) {
      return sessionArchiveSummary(publishedArchive);
    }
    throw vibe64Error(`Unknown vibe64 session: ${activePaths.sessionId}`, "vibe64_session_not_found");
  }

  async function readSessionSummaryFromPaths(sessionPaths) {
    const [
      manifest,
      status,
      metadata
    ] = await Promise.all([
      readManifestFromPaths(sessionPaths),
      readStatusFromPaths(sessionPaths),
      readMetadataFromPaths(sessionPaths)
    ]);
    const sessionName = await sessionNameForSession(sessionPaths, metadata);
    return {
      createdAt: normalizeText(manifest.createdAt),
      manifest: {
        createdAt: normalizeText(manifest.createdAt),
        revision: revisionNumber(manifest.revision),
        runtimeKind: normalizeText(manifest.runtimeKind),
        updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
      },
      metadata,
      projectContextRoot: sessionPaths.projectContextRoot,
      revision: revisionNumber(manifest.revision),
      sessionId: sessionPaths.sessionId,
      sessionName,
      sessionRoot: sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
    };
  }

  async function validateSessionArchive(archivePath) {
    const result = await runCommand("tar", [
      "-tzf",
      archivePath
    ], {
      allowedRoots: [path.dirname(archivePath)],
      cwd: normalizedProjectContextRoot
    });
    if (!result.ok) {
      throw vibe64Error(
        `Invalid Vibe64 session archive ${archivePath}: ${result.output}`,
        "vibe64_session_archive_invalid"
      );
    }
  }

  async function requireSessionArchiveRecord(rootPaths, sessionId) {
    const record = await readSessionArchiveRecordFromRoot(rootPaths, sessionId);
    if (!record) {
      throw vibe64Error(
        `Vibe64 session archive is incomplete for ${sessionId}.`,
        "vibe64_session_archive_incomplete"
      );
    }
    return record;
  }

  async function moveActiveSessionToClosing(activePaths, closingPaths) {
    const moveSessionRoot = async () => {
      await mkdir(activePaths.closingSessionsRoot, {
        recursive: true
      });
      await rename(activePaths.sessionRoot, closingPaths.sessionRoot);
    };
    if (!activePaths.currentSessionAliasPath) {
      return moveSessionRoot();
    }
    return enqueueSessionMutation(activePaths.currentSessionAliasPath, async () => {
      await moveSessionRoot();
      await clearVibe64CurrentSessionAliasIfMatches({
        aliasPath: activePaths.currentSessionAliasPath,
        sessionId: activePaths.sessionId
      });
    });
  }

  async function clearClosingSessionAlias(sessionPaths) {
    if (!sessionPaths.currentSessionAliasPath) {
      return;
    }
    await enqueueSessionMutation(sessionPaths.currentSessionAliasPath, () => (
      clearVibe64CurrentSessionAliasIfMatches({
        aliasPath: sessionPaths.currentSessionAliasPath,
        sessionId: sessionPaths.sessionId
      })
    ));
  }

  function assertRenewalArchiveOwnership({
    metadata = {},
    renewalId = "",
    selectionMarkerRequired = true,
    sessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    if (
      normalizeText(metadata.renewal_id) !== normalizedRenewalId ||
      normalizeText(metadata.renewed_to) !== normalizedSuccessorSessionId
    ) {
      throw vibe64Error(
        `Renewal predecessor does not belong to renewal ${normalizedRenewalId}: ${normalizedSessionId}`,
        "vibe64_session_renewal_link_mismatch"
      );
    }
    const selectedBeforeArchive = normalizeText(metadata[RENEWAL_ARCHIVE_SELECTION_METADATA]);
    if (
      (selectionMarkerRequired || selectedBeforeArchive) &&
      ![normalizedSessionId, RENEWAL_ARCHIVE_SELECTION_NONE].includes(selectedBeforeArchive)
    ) {
      throw vibe64Error(
        `Renewal predecessor has no exact archive-selection marker: ${normalizedSessionId}`,
        "vibe64_session_renewal_archive_marker_invalid"
      );
    }
    return {
      renewalId: normalizedRenewalId,
      selectedBeforeArchive,
      sessionId: normalizedSessionId,
      successorSessionId: normalizedSuccessorSessionId
    };
  }

  async function readPublishedRenewalArchive({
    renewalId = "",
    sessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    if (!await sessionArchiveRecordExists(paths(), normalizedSessionId)) {
      return null;
    }
    const archiveRecord = await readSessionArchiveRecord(normalizedSessionId);
    if (!archiveRecord) {
      throw vibe64Error(
        `Renewal predecessor has a partially published archive: ${normalizedSessionId}`,
        "vibe64_session_renewal_archive_published"
      );
    }
    if (
      normalizeText(archiveRecord.index?.metadata?.renewal_id) !== assertRenewalId(renewalId) ||
      normalizeText(archiveRecord.index?.metadata?.renewed_to) !== assertValidVibe64SessionId(successorSessionId)
    ) {
      throw vibe64Error(
        `Published predecessor archive belongs to another renewal: ${normalizedSessionId}`,
        "vibe64_session_renewal_link_mismatch"
      );
    }
    return archiveRecord;
  }

  async function requirePreparedRenewalArchive({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const archiveRecord = await readPreparedRenewalArchive(normalizedSourceSessionId);
    if (!archiveRecord) {
      throw vibe64Error(
        `Renewal predecessor has no prepared archive: ${normalizedSourceSessionId}`,
        "vibe64_session_renewal_archive_required"
      );
    }
    await validateSessionArchive(archiveRecord.archivePath);
    if (
      normalizeText(archiveRecord.index?.metadata?.renewal_id) !== normalizedRenewalId ||
      normalizeText(archiveRecord.index?.metadata?.renewed_to) !== normalizedSuccessorSessionId
    ) {
      throw vibe64Error(
        `Prepared predecessor archive belongs to another renewal: ${normalizedSourceSessionId}`,
        "vibe64_session_renewal_link_mismatch"
      );
    }
    return archiveRecord;
  }

  async function prepareRenewalArchiveExclusive({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const rootPaths = paths();
    if (await sessionArchiveRecordExists(rootPaths, normalizedSourceSessionId)) {
      throw vibe64Error(
        `Renewal predecessor was published before its durable commit: ${normalizedSourceSessionId}`,
        "vibe64_session_renewal_archive_published"
      );
    }
    const buildRoot = buildingRenewalArchiveRoot(rootPaths, normalizedSourceSessionId);
    await rm(buildRoot, { force: true, recursive: true });
    const existing = await readPreparedRenewalArchive(normalizedSourceSessionId);
    if (existing) {
      return requirePreparedRenewalArchive({
        renewalId: normalizedRenewalId,
        sourceSessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      });
    }

    const sourcePaths = paths(normalizedSourceSessionId);
    const successorPaths = paths(normalizedSuccessorSessionId);
    const [sourceStatus, sourceMetadata, successorStatus, successorMetadata] = await Promise.all([
      readStatusFromPaths(sourcePaths),
      readMetadataFromPaths(sourcePaths),
      readStatusFromPaths(successorPaths),
      readMetadataFromPaths(successorPaths)
    ]);
    if (
      sourceStatus !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
      normalizeText(sourceMetadata.renewal_quiesced_id) !== normalizedRenewalId ||
      successorStatus !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
      normalizeText(successorMetadata.renewal_id) !== normalizedRenewalId ||
      normalizeText(successorMetadata.renewed_from) !== normalizedSourceSessionId
    ) {
      throw vibe64Error(
        `Renewal archive cannot be prepared from ${sourceStatus} -> ${successorStatus}.`,
        "vibe64_session_renewal_transition_invalid"
      );
    }
    const selectedSessionId = rootPaths.currentSessionAliasPath
      ? await readVibe64CurrentSessionAlias({
          aliasPath: rootPaths.currentSessionAliasPath
        })
      : "";
    const selectedBeforeArchive = selectedSessionId === normalizedSourceSessionId
      ? normalizedSourceSessionId
      : RENEWAL_ARCHIVE_SELECTION_NONE;
    const preparedRoot = preparedRenewalArchiveRoot(rootPaths, normalizedSourceSessionId);
    const snapshotRoot = path.join(buildRoot, normalizedSourceSessionId);
    const stagedArchivePath = path.join(buildRoot, `${normalizedSourceSessionId}.tar.gz`);
    const stagedMetadataPath = path.join(buildRoot, `${normalizedSourceSessionId}.json`);
    const finalArchivePath = sessionArchivePath(rootPaths, normalizedSourceSessionId);
    const finalMetadataPath = sessionArchiveMetadataPath(rootPaths, normalizedSourceSessionId);
    const archivedAt = now().toISOString();
    try {
      await mkdir(buildRoot, { recursive: true });
      await cp(sourcePaths.sessionRoot, snapshotRoot, { recursive: true });
      const snapshotPaths = pathsForSessionRoot(normalizedSourceSessionId, snapshotRoot);
      await Promise.all([
        "renewal_activated_at",
        "renewal_archived_at",
        "renewal_finalized_at",
        "renewal_restored_at",
        "renewal_restored_id",
        "renewal_rolled_back_at"
      ].map((name) => rm(metadataFilePath(snapshotPaths, name), { force: true })));
      await Promise.all([
        ...Object.entries({
          renewal_acknowledged_at: normalizeText(successorMetadata.renewal_acknowledged_at),
          renewal_actor_display_name: normalizeText(successorMetadata.renewal_actor_display_name),
          renewal_actor_id: normalizeText(successorMetadata.renewal_actor_id),
          renewal_archived_at: archivedAt,
          renewal_confirmed_at: normalizeText(successorMetadata.renewal_confirmed_at),
          renewal_handover_delivered_at: normalizeText(
            successorMetadata.renewal_handover_delivered_at
          ),
          renewal_id: normalizedRenewalId,
          renewal_started_at: normalizeText(successorMetadata.renewal_started_at),
          renewal_successor_created_at: normalizeText(successorMetadata.renewal_successor_created_at),
          renewed_at: normalizeText(successorMetadata.renewed_at),
          renewed_to: normalizedSuccessorSessionId,
          [RENEWAL_ARCHIVE_SELECTION_METADATA]: selectedBeforeArchive
        }).map(([name, value]) => (
          writeTextFile(metadataFilePath(snapshotPaths, name), `${value}\n`)
        )),
        writeTextFile(
          snapshotPaths.statusPath,
          `${VIBE64_SESSION_STATUS.ARCHIVED}\n`
        )
      ]);
      const summary = await readSessionSummaryFromPaths(snapshotPaths);
      const metadataRecord = sessionArchiveMetadataRecord({
        archivePath: finalArchivePath,
        archivedAt,
        metadataPath: finalMetadataPath,
        sessionId: normalizedSourceSessionId,
        summary
      });
      const tarResult = await runCommand("tar", [
        "-czf",
        stagedArchivePath,
        "-C",
        buildRoot,
        normalizedSourceSessionId
      ], {
        allowedRoots: [buildRoot],
        cwd: normalizedProjectContextRoot
      });
      if (!tarResult.ok) {
          throw vibe64Error(
            `Cannot prepare renewal archive ${normalizedSourceSessionId}: ${tarResult.output}`,
            "vibe64_session_archive_write_failed"
        );
      }
      await validateSessionArchive(stagedArchivePath);
      await writeJsonFile(stagedMetadataPath, metadataRecord);
      await rm(snapshotRoot, { force: true, recursive: true });
      await mkdir(path.dirname(preparedRoot), { recursive: true });
      await rename(buildRoot, preparedRoot);
      return requirePreparedRenewalArchive({
        renewalId: normalizedRenewalId,
        sourceSessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      });
    } finally {
      await rm(buildRoot, { force: true, recursive: true });
    }
  }

  async function detachSessionForArchive(sessionId) {
    const activePaths = paths(sessionId);
    const closingPaths = closingSessionPaths(activePaths.sessionId);
    const mutationKey = activePaths.sessionRoot;
    const mutationContext = sessionMutationContext.getStore();
    if (
      mutationContext?.key === mutationKey &&
      mutationContext.participant?.active === true
    ) {
      throw vibe64Error(
        `Cannot archive Vibe64 session during an active mutation: ${activePaths.sessionId}`,
        "vibe64_session_archive_during_mutation"
      );
    }
    return enqueueSessionMutation(mutationKey, async () => {
      const release = await acquireStoreSessionLock(activePaths, "mutation", {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(
          `Timed out waiting to archive Vibe64 session: ${activePaths.sessionId}`,
          "vibe64_session_mutation_lock_timeout"
        );
      }
      try {
        const [activeExists, closingExists] = await Promise.all([
          pathExists(activePaths.manifestPath),
          pathExists(closingPaths.manifestPath)
        ]);
        if (activeExists && closingExists) {
          throw vibe64Error(
            `Vibe64 session exists in both active and archiving state: ${activePaths.sessionId}`,
            "vibe64_session_archive_state_conflict"
          );
        }
        if (closingExists) {
          const [closingStatus, closingMetadata] = await Promise.all([
            readStatusFromPaths(closingPaths),
            readMetadataFromPaths(closingPaths)
          ]);
          assertNormalSessionIsMutable({
            sessionId: closingPaths.sessionId,
            status: closingStatus
          });
          if (
            normalizeText(closingMetadata.renewal_id) &&
            normalizeText(closingMetadata.renewed_to)
          ) {
            throw vibe64Error(
              `Renewal predecessor must use the renewal archive transaction: ${activePaths.sessionId}`,
              "vibe64_session_renewal_archive_api_required"
            );
          }
          await clearClosingSessionAlias(closingPaths);
          return;
        }
        if (!activeExists) {
          if (await readSessionArchiveRecord(activePaths.sessionId)) {
            return;
          }
          throw vibe64Error(
            `Unknown vibe64 session: ${activePaths.sessionId}`,
            "vibe64_session_not_found"
          );
        }
        const [status, metadata] = await Promise.all([
          readStatusFromPaths(activePaths),
          readMetadataFromPaths(activePaths)
        ]);
        assertNormalSessionIsMutable({
          sessionId: activePaths.sessionId,
          status
        });
        if (status !== VIBE64_SESSION_STATUS.ARCHIVED) {
          throw vibe64Error(
            `Cannot archive open Vibe64 session ${activePaths.sessionId} with status ${status}.`,
            "vibe64_session_archive_open_status"
          );
        }
        if (
          normalizeText(metadata.renewal_id) &&
          normalizeText(metadata.renewed_to)
        ) {
          throw vibe64Error(
            `Renewal predecessor must use the renewal archive transaction: ${activePaths.sessionId}`,
            "vibe64_session_renewal_archive_api_required"
          );
        }

        // Compression must never observe a mutable live tree. The atomic rename
        // is the archive barrier: earlier writers are included, and later writers
        // re-check the active namespace after acquiring this same lock.
        await moveActiveSessionToClosing(activePaths, closingPaths);
      } finally {
        await release();
      }
    });
  }

  async function runSessionArchiveExclusive(sessionId, operation) {
    const sessionPaths = paths(sessionId);
    const archiveLockPath = sessionLockPath(sessionPaths, "archive");
    return enqueueSessionMutation(archiveLockPath, async () => {
      const release = await acquireStoreSessionLock(sessionPaths, "archive", {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(
          `Timed out waiting to archive Vibe64 session: ${sessionPaths.sessionId}`,
          "vibe64_session_archive_lock_timeout"
        );
      }
      try {
        return await operation();
      } finally {
        await release();
      }
    });
  }

  async function publishSessionArchive(sessionId) {
    // Detachment is the archive barrier. Queue it before any archive work so a
    // later writer can never overtake finalisation, even while another process
    // is publishing the archive.
    await detachSessionForArchive(sessionId);
    return runSessionArchiveExclusive(
      sessionId,
      () => publishSessionArchiveExclusive(sessionId)
    );
  }

  async function detachRenewedSessionForArchive(options = {}) {
    return runSessionArchiveExclusive(
      options.sourceSessionId,
      async () => {
        const sourcePaths = paths(options.sourceSessionId);
        const mutationKey = sourcePaths.sessionRoot;
        const mutationContext = sessionMutationContext.getStore();
        if (
          mutationContext?.key === mutationKey &&
          mutationContext.participant?.active === true
        ) {
          throw vibe64Error(
            `Cannot prepare renewal archive during an active mutation: ${sourcePaths.sessionId}`,
            "vibe64_session_archive_during_mutation"
          );
        }
        return enqueueSessionMutation(mutationKey, async () => {
          const release = await acquireStoreSessionLock(sourcePaths, "mutation", {
            waitMs: SESSION_MUTATION_LOCK_WAIT_MS
          });
          if (!release) {
            throw vibe64Error(
              `Timed out waiting to prepare renewed Vibe64 session: ${sourcePaths.sessionId}`,
              "vibe64_session_mutation_lock_timeout"
            );
          }
          try {
            const archiveRecord = await prepareRenewalArchiveExclusive(options);
            return {
              archiveRecord,
              detached: false,
              prepared: true,
              published: false,
              renewalId: assertRenewalId(options.renewalId),
              sessionId: sourcePaths.sessionId,
              successorSessionId: assertValidVibe64SessionId(options.successorSessionId)
            };
          } finally {
            await release();
          }
        });
      }
    );
  }

  async function prepareRenewalSessionArchive(options = {}) {
    const prepared = await detachRenewedSessionForArchive(options);
    return prepared.archiveRecord;
  }

  async function restoreRenewalClosingSession({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    return runSessionArchiveExclusive(normalizedSourceSessionId, async () => {
      const activePaths = paths(normalizedSourceSessionId);
      const closingPaths = closingSessionPaths(normalizedSourceSessionId);
      return enqueueSessionMutation(activePaths.sessionRoot, async () => {
        const release = await acquireStoreSessionLock(activePaths, "mutation", {
          waitMs: SESSION_MUTATION_LOCK_WAIT_MS
        });
        if (!release) {
          throw vibe64Error(
            `Timed out waiting to restore renewed Vibe64 session: ${normalizedSourceSessionId}`,
            "vibe64_session_mutation_lock_timeout"
          );
        }
        try {
          const [activeExists, closingExists] = await Promise.all([
            pathExists(activePaths.manifestPath),
            pathExists(closingPaths.manifestPath)
          ]);
          if (activeExists && closingExists) {
            throw vibe64Error(
              `Vibe64 session exists in both active and closing state: ${normalizedSourceSessionId}`,
              "vibe64_session_archive_state_conflict"
            );
          }
          if (
            closingExists ||
            await sessionArchiveRecordExists(paths(), normalizedSourceSessionId)
          ) {
            throw vibe64Error(
              `A committed predecessor archive cannot be restored: ${normalizedSourceSessionId}`,
              "vibe64_session_renewal_archive_published"
            );
          }
          if (!activeExists) {
            throw vibe64Error(
              `Unknown vibe64 session: ${normalizedSourceSessionId}`,
              "vibe64_session_not_found"
            );
          }
          const [status, metadata] = await Promise.all([
            readStatusFromPaths(activePaths),
            readMetadataFromPaths(activePaths)
          ]);
          if (
            status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
            normalizeText(metadata.renewal_quiesced_id) !== normalizedRenewalId
          ) {
            throw vibe64Error(
              `Renewal predecessor cannot be restored from status ${status}: ${normalizedSourceSessionId}`,
              "vibe64_session_renewal_archive_status_invalid"
            );
          }
          let selectedBeforeArchive = RENEWAL_ARCHIVE_SELECTION_NONE;
          const prepared = await readPreparedRenewalArchive(normalizedSourceSessionId);
          if (prepared) {
            selectedBeforeArchive = await withPreparedRenewalSession(
              normalizedSourceSessionId,
              (preparedSession) => assertRenewalArchiveOwnership({
                metadata: preparedSession.metadata,
                renewalId: normalizedRenewalId,
                sessionId: normalizedSourceSessionId,
                successorSessionId: normalizedSuccessorSessionId
              }).selectedBeforeArchive
            );
            await rm(
              preparedRenewalArchiveRoot(paths(), normalizedSourceSessionId),
              { force: true, recursive: true }
            );
          }
          return {
            renewalId: normalizedRenewalId,
            restored: Boolean(prepared),
            selectedBeforeArchive,
            sessionId: normalizedSourceSessionId,
            status,
            successorSessionId: normalizedSuccessorSessionId
          };
        } finally {
          await release();
        }
      });
    });
  }

  async function commitRenewalArchive({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    return runSessionArchiveExclusive(normalizedSourceSessionId, async () => {
      const rootPaths = paths();
      const finalArchivePath = sessionArchivePath(rootPaths, normalizedSourceSessionId);
      const finalMetadataPath = sessionArchiveMetadataPath(rootPaths, normalizedSourceSessionId);
      const publishingRoot = publishingRenewalArchiveRoot(
        rootPaths,
        normalizedSourceSessionId
      );
      await rm(publishingRoot, { force: true, recursive: true });
      const [initialArchiveExists, initialMetadataExists] = await Promise.all([
        pathExists(finalArchivePath),
        pathExists(finalMetadataPath)
      ]);
      const prepared = await requirePreparedRenewalArchive({
        renewalId: normalizedRenewalId,
        sourceSessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      });
      const preparedSession = await withPreparedRenewalSession(
        normalizedSourceSessionId,
        (session) => session
      );
      const ownership = assertRenewalArchiveOwnership({
        metadata: preparedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      });
      const activePaths = paths(normalizedSourceSessionId);
      const closingPaths = closingSessionPaths(normalizedSourceSessionId);
      return enqueueSessionMutation(activePaths.sessionRoot, async () => {
        const release = await acquireStoreSessionLock(activePaths, "mutation", {
          waitMs: SESSION_MUTATION_LOCK_WAIT_MS
        });
        if (!release) {
          throw vibe64Error(
            `Timed out waiting to commit renewed Vibe64 session: ${normalizedSourceSessionId}`,
            "vibe64_session_mutation_lock_timeout"
          );
        }
        try {
          const [activeExists, closingExists] = await Promise.all([
            pathExists(activePaths.manifestPath),
            pathExists(closingPaths.manifestPath)
          ]);
          if (activeExists && closingExists) {
            throw vibe64Error(
              `Vibe64 session exists in both active and archiving state: ${normalizedSourceSessionId}`,
              "vibe64_session_archive_state_conflict"
            );
          }
          if (activeExists) {
            const [status, metadata] = await Promise.all([
              readStatusFromPaths(activePaths),
              readMetadataFromPaths(activePaths)
            ]);
            if (
              status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
              normalizeText(metadata.renewal_quiesced_id) !== normalizedRenewalId
            ) {
              throw vibe64Error(
                `Renewal predecessor cannot be committed from status ${status}: ${normalizedSourceSessionId}`,
                "vibe64_session_renewal_archive_status_invalid"
              );
            }
            await moveActiveSessionToClosing(activePaths, closingPaths);
            await renewalArchiveCommitStep({
              renewalId: normalizedRenewalId,
              sessionId: normalizedSourceSessionId,
              step: "closing-renamed"
            });
          } else if (!closingExists) {
            throw vibe64Error(
              `Unknown vibe64 session: ${normalizedSourceSessionId}`,
              "vibe64_session_not_found"
            );
          }

          const [closingStatus, closingMetadata] = await Promise.all([
            readStatusFromPaths(closingPaths),
            readMetadataFromPaths(closingPaths)
          ]);
          if (closingStatus === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
            if (
              normalizeText(closingMetadata.renewal_quiesced_id) !==
                normalizedRenewalId
            ) {
              throw vibe64Error(
                `Renewal predecessor closing ownership is invalid: ${normalizedSourceSessionId}`,
                "vibe64_session_renewal_archive_status_invalid"
              );
            }
            for (const name of [
              "renewal_activated_at",
              "renewal_archived_at",
              "renewal_finalized_at",
              "renewal_restored_at",
              "renewal_restored_id",
              "renewal_rolled_back_at"
            ]) {
              await rm(metadataFilePath(closingPaths, name), { force: true });
            }
            for (const [name, value] of Object.entries({
              renewal_acknowledged_at: normalizeText(preparedSession.metadata.renewal_acknowledged_at),
              renewal_actor_display_name: normalizeText(preparedSession.metadata.renewal_actor_display_name),
              renewal_actor_id: normalizeText(preparedSession.metadata.renewal_actor_id),
              renewal_archived_at: normalizeText(preparedSession.metadata.renewal_archived_at),
              renewal_confirmed_at: normalizeText(preparedSession.metadata.renewal_confirmed_at),
              renewal_handover_delivered_at: normalizeText(
                preparedSession.metadata.renewal_handover_delivered_at
              ),
              renewal_id: normalizedRenewalId,
              renewal_started_at: normalizeText(preparedSession.metadata.renewal_started_at),
              renewal_successor_created_at: normalizeText(preparedSession.metadata.renewal_successor_created_at),
              renewed_at: normalizeText(preparedSession.metadata.renewed_at),
              renewed_to: normalizedSuccessorSessionId,
              [RENEWAL_ARCHIVE_SELECTION_METADATA]: ownership.selectedBeforeArchive
            })) {
              await writeTextFile(metadataFilePath(closingPaths, name), `${value}\n`);
              await renewalArchiveCommitStep({
                metadataName: name,
                renewalId: normalizedRenewalId,
                sessionId: normalizedSourceSessionId,
                step: "closing-metadata-written"
              });
            }
            await writeTextFile(
              closingPaths.statusPath,
              `${VIBE64_SESSION_STATUS.ARCHIVED}\n`
            );
            await renewalArchiveCommitStep({
              renewalId: normalizedRenewalId,
              sessionId: normalizedSourceSessionId,
              step: "closing-status-written"
            });
          } else if (closingStatus === VIBE64_SESSION_STATUS.ARCHIVED) {
            assertRenewalArchiveOwnership({
              metadata: closingMetadata,
              renewalId: normalizedRenewalId,
              sessionId: normalizedSourceSessionId,
              successorSessionId: normalizedSuccessorSessionId
            });
          } else {
            throw vibe64Error(
              `Renewal predecessor closing status is invalid: ${normalizedSourceSessionId}`,
              "vibe64_session_renewal_archive_status_invalid"
            );
          }

          const archiveExists = initialArchiveExists || await pathExists(finalArchivePath);
          const metadataExists = initialMetadataExists || await pathExists(finalMetadataPath);
          if (archiveExists && metadataExists) {
            const published = await readPublishedRenewalArchive({
              renewalId: normalizedRenewalId,
              sessionId: normalizedSourceSessionId,
              successorSessionId: normalizedSuccessorSessionId
            });
            await validateSessionArchive(published.archivePath);
            return published;
          }
          if (archiveExists || metadataExists) {
            await Promise.all([
              rm(finalArchivePath, { force: true }),
              rm(finalMetadataPath, { force: true })
            ]);
          }
          await mkdir(path.dirname(finalArchivePath), { recursive: true });
          const stagedArchivePath = path.join(
            publishingRoot,
            `${normalizedSourceSessionId}.tar.gz`
          );
          const stagedMetadataPath = path.join(
            publishingRoot,
            `${normalizedSourceSessionId}.json`
          );
          await mkdir(publishingRoot, { recursive: true });
          try {
            await copyFile(prepared.archivePath, stagedArchivePath);
            await copyFile(prepared.metadataPath, stagedMetadataPath);
            await validateSessionArchive(stagedArchivePath);
            await rename(stagedArchivePath, finalArchivePath);
            await rename(stagedMetadataPath, finalMetadataPath);
          } finally {
            await rm(publishingRoot, { force: true, recursive: true });
          }
          const committed = await readPublishedRenewalArchive({
            renewalId: normalizedRenewalId,
            sessionId: normalizedSourceSessionId,
            successorSessionId: normalizedSuccessorSessionId
          });
          await validateSessionArchive(committed.archivePath);
          return committed;
        } finally {
          await release();
        }
      });
    });
  }

  async function finalizeRenewalArchiveCommit({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const published = await readPublishedRenewalArchive({
      renewalId: normalizedRenewalId,
      sessionId: normalizedSourceSessionId,
      successorSessionId: normalizedSuccessorSessionId
    });
    if (!published) {
      throw vibe64Error(
        `Renewal predecessor has no published archive: ${normalizedSourceSessionId}`,
        "vibe64_session_renewal_archive_required"
      );
    }
    const finalized = await runSessionArchiveExclusive(
      normalizedSourceSessionId,
      () => publishSessionArchiveExclusive(normalizedSourceSessionId)
    );
    await rm(
      preparedRenewalArchiveRoot(paths(), normalizedSourceSessionId),
      { force: true, recursive: true }
    );
    return finalized;
  }

  async function publishSessionArchiveExclusive(sessionId, {
    retainSessionRoot = false
  } = {}) {
    const rootPaths = paths();
    const sessionPaths = closingSessionPaths(sessionId);
    if (!await pathExists(sessionPaths.manifestPath)) {
      const archiveRecord = await readSessionArchiveRecord(sessionId);
      if (!archiveRecord) {
        throw vibe64Error(
          `Unknown vibe64 session: ${assertValidVibe64SessionId(sessionId)}`,
          "vibe64_session_not_found"
        );
      }
      await validateSessionArchive(archiveRecord.archivePath);
      return archiveRecord;
    }
    const status = await readStatusFromPaths(sessionPaths);
    if (status !== VIBE64_SESSION_STATUS.ARCHIVED) {
      throw vibe64Error(
        `Cannot archive open Vibe64 session ${sessionPaths.sessionId} with status ${status}.`,
        "vibe64_session_archive_open_status"
      );
    }

    const finalArchivePath = sessionArchivePath(rootPaths, sessionPaths.sessionId);
    const finalMetadataPath = sessionArchiveMetadataPath(rootPaths, sessionPaths.sessionId);
    const finalArchiveExists = await pathExists(finalArchivePath);
    const finalMetadataExists = await pathExists(finalMetadataPath);
    if (finalArchiveExists && finalMetadataExists) {
      const archiveRecord = await requireSessionArchiveRecord(
        rootPaths,
        sessionPaths.sessionId
      );
      await validateSessionArchive(archiveRecord.archivePath);
      if (!retainSessionRoot) {
        await rm(sessionPaths.sessionRoot, {
          force: true,
          recursive: true
        });
      }
      return archiveRecord;
    }
    if (finalArchiveExists || finalMetadataExists) {
      // The closing tree is the durable source of truth until both published
      // files exist. A process interruption between the two renames is retried
      // from that immutable tree instead of stranding a half-archived session.
      await Promise.all([
        rm(finalArchivePath, {
          force: true
        }),
        rm(finalMetadataPath, {
          force: true
        })
      ]);
    }

    const stagedRoot = path.join(sessionArchiveStagingRoot(rootPaths), `${sessionPaths.sessionId}-${randomUUID()}`);
    const stagedArchivePath = path.join(stagedRoot, `${sessionPaths.sessionId}.tar.gz`);
    const stagedMetadataPath = path.join(stagedRoot, `${sessionPaths.sessionId}.json`);
    const archivedAt = now().toISOString();
    const summary = await readSessionSummaryFromPaths(sessionPaths);
    const metadataRecord = sessionArchiveMetadataRecord({
      archivePath: finalArchivePath,
      archivedAt,
      metadataPath: finalMetadataPath,
      sessionId: sessionPaths.sessionId,
      summary
    });
    let archiveFinalized = false;
    let metadataFinalized = false;
    try {
      await mkdir(stagedRoot, {
        recursive: true
      });
      const tarResult = await runCommand("tar", [
        "-czf",
        stagedArchivePath,
        "-C",
        rootPaths.closingSessionsRoot,
        sessionPaths.sessionId
      ], {
        allowedRoots: [
          rootPaths.closingSessionsRoot,
          stagedRoot
        ],
        cwd: normalizedProjectContextRoot
      });
      if (!tarResult.ok) {
        throw vibe64Error(
          `Cannot archive Vibe64 session ${sessionPaths.sessionId}: ${tarResult.output}`,
          "vibe64_session_archive_write_failed"
        );
      }
      await validateSessionArchive(stagedArchivePath);
      await writeJsonFile(stagedMetadataPath, metadataRecord);
      await mkdir(path.dirname(finalArchivePath), {
        recursive: true
      });
      await rename(stagedArchivePath, finalArchivePath);
      archiveFinalized = true;
      await rename(stagedMetadataPath, finalMetadataPath);
      metadataFinalized = true;
      const archiveRecord = await requireSessionArchiveRecord(
        rootPaths,
        sessionPaths.sessionId
      );
      if (!retainSessionRoot) {
        await rm(sessionPaths.sessionRoot, {
          force: true,
          recursive: true
        });
      }
      return archiveRecord;
    } catch (error) {
      if (!metadataFinalized) {
        await rm(stagedMetadataPath, {
          force: true
        });
      }
      if (!archiveFinalized) {
        await rm(stagedArchivePath, {
          force: true
        });
      }
      if (archiveFinalized && !metadataFinalized) {
        await rm(finalArchivePath, {
          force: true
        });
      }
      throw error;
    } finally {
      await rm(stagedRoot, {
        force: true,
        recursive: true
      });
    }
  }

  async function updateCurrentSession(sessionId = "") {
    const selectedSessionId = normalizeText(sessionId);
    const rootPaths = paths();
    if (!rootPaths.currentSessionAliasPath) {
      throw vibe64Error(
        "Updating the current Vibe64 session requires projectSessionSourceRoot.",
        "vibe64_project_session_source_root_required"
      );
    }
    return enqueueSessionMutation(rootPaths.currentSessionAliasPath, async () => {
      if (selectedSessionId) {
        const selectedSession = await readSessionForRenewal(selectedSessionId);
        if (!OPEN_VIBE64_SESSION_STATUSES.has(selectedSession.status)) {
          throw vibe64Error(
            `Vibe64 session cannot be selected while it is ${selectedSession.status}: ${selectedSessionId}`,
            HIDDEN_VIBE64_SESSION_STATUSES.has(selectedSession.status)
              ? "vibe64_session_renewal_private"
              : "vibe64_session_not_selectable"
          );
        }
      }
      await updateVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath,
        sessionId: selectedSessionId
      });
      return {
        sessionId: selectedSessionId
      };
    });
  }

  async function finalizeRenewalCurrentSession({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const ownership = await withPreparedRenewalSession(
      normalizedSourceSessionId,
      async (publishedSession) => assertRenewalArchiveOwnership({
        metadata: publishedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      })
    );
    const rootPaths = paths();
    if (!rootPaths.currentSessionAliasPath) {
      return {
        changed: false,
        selectedBeforeArchive: ownership.selectedBeforeArchive,
        sessionId: ""
      };
    }
    return enqueueSessionMutation(rootPaths.currentSessionAliasPath, async () => {
      const successor = await readSessionForRenewal(normalizedSuccessorSessionId);
      if (
        successor.status !== VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING ||
        normalizeText(successor.metadata.renewal_id) !== normalizedRenewalId ||
        normalizeText(successor.metadata.renewed_from) !== normalizedSourceSessionId
      ) {
        throw vibe64Error(
          `Renewal successor is not prepared for renewal ${normalizedRenewalId}: ${normalizedSuccessorSessionId}`,
          "vibe64_session_renewal_link_mismatch"
        );
      }
      const selectedSessionId = await readVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath
      });
      return {
        changed: false,
        selectedBeforeArchive: ownership.selectedBeforeArchive,
        sessionId: selectedSessionId,
        successorWillBeSelected:
          ownership.selectedBeforeArchive === normalizedSourceSessionId &&
          (!selectedSessionId || selectedSessionId === normalizedSourceSessionId)
      };
    });
  }

  async function commitRenewalCurrentSession({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const ownership = await withPublishedRenewalSession(
      normalizedSourceSessionId,
      async (publishedSession) => assertRenewalArchiveOwnership({
        metadata: publishedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      })
    );
    const rootPaths = paths();
    if (!rootPaths.currentSessionAliasPath) {
      return {
        changed: false,
        selectedBeforeArchive: ownership.selectedBeforeArchive,
        sessionId: ""
      };
    }
    return enqueueSessionMutation(rootPaths.currentSessionAliasPath, async () => {
      const successor = await readSessionForRenewal(normalizedSuccessorSessionId);
      if (
        successor.status !== VIBE64_SESSION_STATUS.ACTIVE ||
        normalizeText(successor.metadata.renewal_id) !== normalizedRenewalId ||
        normalizeText(successor.metadata.renewed_from) !== normalizedSourceSessionId ||
        !normalizeText(successor.metadata.renewal_activated_at)
      ) {
        throw vibe64Error(
          `Renewal successor is not committed for renewal ${normalizedRenewalId}: ${normalizedSuccessorSessionId}`,
          "vibe64_session_renewal_link_mismatch"
        );
      }
      const selectedSessionId = await readVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath
      });
      if (
        ownership.selectedBeforeArchive !== normalizedSourceSessionId ||
        (
          selectedSessionId &&
          selectedSessionId !== normalizedSourceSessionId &&
          selectedSessionId !== normalizedSuccessorSessionId
        )
      ) {
        return {
          changed: false,
          selectedBeforeArchive: ownership.selectedBeforeArchive,
          sessionId: selectedSessionId
        };
      }
      if (selectedSessionId === normalizedSuccessorSessionId) {
        return {
          changed: false,
          selectedBeforeArchive: ownership.selectedBeforeArchive,
          sessionId: selectedSessionId
        };
      }
      await updateVibe64CurrentSessionAlias({
        aliasPath: rootPaths.currentSessionAliasPath,
        sessionId: normalizedSuccessorSessionId
      });
      return {
        changed: true,
        selectedBeforeArchive: ownership.selectedBeforeArchive,
        sessionId: normalizedSuccessorSessionId
      };
    });
  }

  async function readCurrentSession() {
    const rootPaths = paths();
    if (!rootPaths.currentSessionAliasPath) {
      return null;
    }
    const sessionId = await readVibe64CurrentSessionAlias({
      aliasPath: rootPaths.currentSessionAliasPath
    });
    if (!sessionId) {
      return null;
    }
    const session = await readSessionForRenewal(assertValidVibe64SessionId(sessionId));
    return OPEN_VIBE64_SESSION_STATUSES.has(session.status) ? session : null;
  }

  async function createSessionRecord({
    metadata = {},
    runtimeKind = "",
    sessionId = "",
    status = VIBE64_SESSION_STATUS.ACTIVE
  } = {}) {
    const normalizedMetadata = Object.fromEntries(
      Object.entries(metadata).map(([name, value]) => [assertSafeMetadataName(name), normalizeText(value)])
    );
    const normalizedStatus = assertVibe64SessionStatus(status);
    const rootPaths = paths();
    await mkdir(rootPaths.activeSessionsRoot, {
      recursive: true
    });
    const createdAt = now().toISOString();
    const resolvedSessionId = sessionId
      ? assertValidVibe64SessionId(sessionId)
      : await createAvailableSessionId(rootPaths, createdAt);
    const sessionPaths = paths(resolvedSessionId);
    return enqueueSessionMutation(sessionPaths.sessionRoot, async () => {
      const release = await acquireStoreSessionLock(sessionPaths, "create", {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(
          `Vibe64 session creation is already in progress: ${resolvedSessionId}`,
          "vibe64_session_busy"
        );
      }
      const stagingRoot = sessionCreationStagingRoot(rootPaths);
      const stagedSessionRoot = path.join(
        stagingRoot,
        `${resolvedSessionId}.${process.pid}.${randomUUID()}`
      );
      const stagedPaths = pathsForSessionRoot(resolvedSessionId, stagedSessionRoot);
      let published = false;
      try {
        if (await sessionRecordExists(rootPaths, resolvedSessionId)) {
          throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
        }
        await mkdir(stagedSessionRoot, { recursive: true });
        await Promise.all([
          mkdir(stagedPaths.agentRunsRoot, {
            recursive: true
          }),
          mkdir(stagedPaths.artifactsRoot, {
            recursive: true
          }),
          mkdir(stagedPaths.backgroundTasksRoot, {
            recursive: true
          }),
          mkdir(stagedPaths.metadataRoot, {
            recursive: true
          })
        ]);
        const normalizedRuntimeKind = normalizeText(runtimeKind);
        const manifest = {
          ...(normalizedRuntimeKind ? { runtimeKind: normalizedRuntimeKind } : {}),
          createdAt,
          product: "vibe64",
          revision: 1,
          schemaVersion: VIBE64_SESSION_SCHEMA_VERSION,
          sessionId: resolvedSessionId,
          updatedAt: createdAt
        };
        await Promise.all([
          writeJsonFile(stagedPaths.manifestPath, manifest),
          writeTextFile(stagedPaths.statusPath, `${normalizedStatus}\n`),
          ...Object.entries(normalizedMetadata).map(([name, value]) => {
            return writeTextFile(metadataFilePath(stagedPaths, name), `${value}\n`);
          })
        ]);
        if (await sessionRecordExists(rootPaths, resolvedSessionId)) {
          throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
        }
        await rename(stagedSessionRoot, sessionPaths.sessionRoot);
        published = true;
        await removeStaleSessionCreationStages(rootPaths, resolvedSessionId).catch(() => null);
        return readSessionForRenewal(resolvedSessionId);
      } catch (error) {
        if (["EEXIST", "ENOTEMPTY"].includes(error?.code)) {
          throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
        }
        throw error;
      } finally {
        if (!published) {
          await rm(stagedSessionRoot, {
            force: true,
            recursive: true
          });
        }
        await release();
      }
    });
  }

  async function createSession(options = {}) {
    const status = assertVibe64SessionStatus(options.status);
    if (RENEWAL_TRANSITION_VIBE64_SESSION_STATUSES.has(status)) {
      throw vibe64Error(
        `Renewal session status requires createRenewalPendingSession: ${status}`,
        "vibe64_session_renewal_transition_required"
      );
    }
    return createSessionRecord({
      ...options,
      status
    });
  }

  async function quiesceSessionForRenewal({
    quiescedAt = "",
    renewalId = "",
    sourceSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const requestedQuiescedAt = quiescedAt
      ? toDate(quiescedAt).toISOString()
      : now().toISOString();
    return runRenewalTransitionExclusive(async () => {
      return mutateSessionForRenewal(normalizedSourceSessionId, async (sourcePaths) => {
        const [status, metadata] = await Promise.all([
          readStatusFromPaths(sourcePaths),
          readMetadataFromPaths(sourcePaths)
        ]);
        const currentQuiescedId = normalizeText(metadata.renewal_quiesced_id);
        if (status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED) {
          if (currentQuiescedId && currentQuiescedId !== normalizedRenewalId) {
            throw vibe64Error(
              `Session is quiesced for another renewal: ${normalizedSourceSessionId}`,
              "vibe64_session_renewal_conflict"
            );
          }
          const normalizedQuiescedAt = normalizeText(metadata.renewal_quiesced_at) ||
            requestedQuiescedAt;
          await Promise.all([
            writeTextFile(
              metadataFilePath(sourcePaths, "renewal_quiesced_at"),
              `${normalizedQuiescedAt}\n`
            ),
            writeTextFile(
              metadataFilePath(sourcePaths, "renewal_quiesced_id"),
              `${normalizedRenewalId}\n`
            )
          ]);
          return readSessionFromPaths(sourcePaths);
        }
        const source = await readSessionFromPaths(sourcePaths);
        if (
          status !== VIBE64_SESSION_STATUS.ACTIVE ||
          sessionIsUnfinishedRenewalRecord(source)
        ) {
          throw vibe64Error(
            `A session can only be quiesced for renewal while it is active: ${normalizedSourceSessionId}`,
            "vibe64_session_renewal_source_not_active"
          );
        }

        // Status is the durable write barrier. Once it changes, every ordinary
        // writer and exclusive operation rejects the session, even if this
        // process stops before the provenance files finish writing.
        await writeTextFile(
          sourcePaths.statusPath,
          `${VIBE64_SESSION_STATUS.RENEWAL_QUIESCED}\n`
        );
        await renewalQuiesceStep({
          renewalId: normalizedRenewalId,
          sessionId: normalizedSourceSessionId,
          step: "status-written"
        });
        await Promise.all([
          rm(metadataFilePath(sourcePaths, "renewal_restored_at"), { force: true }),
          rm(metadataFilePath(sourcePaths, "renewal_restored_id"), { force: true }),
          writeTextFile(
            metadataFilePath(sourcePaths, "renewal_quiesced_at"),
            `${requestedQuiescedAt}\n`
          ),
          writeTextFile(
            metadataFilePath(sourcePaths, "renewal_quiesced_id"),
            `${normalizedRenewalId}\n`
          )
        ]);
        return readSessionFromPaths(sourcePaths);
      });
    });
  }

  async function restoreSessionAfterRenewalCancellation({
    renewalId = "",
    restoredAt = "",
    sourceSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const requestedRestoredAt = restoredAt
      ? toDate(restoredAt).toISOString()
      : now().toISOString();
    return runRenewalTransitionExclusive(async () => {
      return mutateSessionForRenewal(normalizedSourceSessionId, async (sourcePaths) => {
        const [status, metadata] = await Promise.all([
          readStatusFromPaths(sourcePaths),
          readMetadataFromPaths(sourcePaths)
        ]);
        const currentQuiescedId = normalizeText(metadata.renewal_quiesced_id);
        const currentRestoredId = normalizeText(metadata.renewal_restored_id);
        if (
          status === VIBE64_SESSION_STATUS.ACTIVE &&
          currentRestoredId === normalizedRenewalId
        ) {
          await Promise.all([
            rm(metadataFilePath(sourcePaths, "renewal_quiesced_at"), { force: true }),
            rm(metadataFilePath(sourcePaths, "renewal_quiesced_id"), { force: true })
          ]);
          return readSessionFromPaths(sourcePaths);
        }
        if (
          status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
          currentQuiescedId !== normalizedRenewalId ||
          normalizeText(metadata.renewed_to)
        ) {
          throw vibe64Error(
            `Session cannot be restored from renewal ${normalizedRenewalId}: ${normalizedSourceSessionId}`,
            "vibe64_session_renewal_transition_invalid"
          );
        }
        const normalizedRestoredAt = normalizeText(metadata.renewal_restored_at) ||
          requestedRestoredAt;
        await Promise.all([
          writeTextFile(
            metadataFilePath(sourcePaths, "renewal_restored_at"),
            `${normalizedRestoredAt}\n`
          ),
          writeTextFile(
            metadataFilePath(sourcePaths, "renewal_restored_id"),
            `${normalizedRenewalId}\n`
          )
        ]);
        await writeTextFile(sourcePaths.statusPath, `${VIBE64_SESSION_STATUS.ACTIVE}\n`);
        await Promise.all([
          rm(metadataFilePath(sourcePaths, "renewal_quiesced_at"), { force: true }),
          rm(metadataFilePath(sourcePaths, "renewal_quiesced_id"), { force: true })
        ]);
        return readSessionFromPaths(sourcePaths);
      });
    });
  }

  async function createRenewalPendingSession({
    actorDisplayName = "",
    actorId = "",
    confirmedAt = "",
    metadata = {},
    renewalId = "",
    renewedFrom = "",
    runtimeKind = "",
    sessionId = "",
    startedAt = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const sourceSessionId = assertValidVibe64SessionId(renewedFrom);
    const successorSessionId = sessionId ? assertValidVibe64SessionId(sessionId) : "";
    if (successorSessionId && successorSessionId === sourceSessionId) {
      throw vibe64Error(
        "A renewed session must have a different session id from its predecessor.",
        "vibe64_session_renewal_same_session"
      );
    }
    const normalizedActorId = normalizeText(actorId);
    if (!normalizedActorId) {
      throw vibe64Error(
        "A renewed session requires actor attribution.",
        "vibe64_session_renewal_actor_required"
      );
    }
    if (!normalizeText(confirmedAt)) {
      throw vibe64Error(
        "A renewed session requires the confirmation timestamp.",
        "vibe64_session_renewal_confirmation_required"
      );
    }
    const normalizedConfirmedAt = toDate(confirmedAt).toISOString();
    const normalizedStartedAt = startedAt ? toDate(startedAt).toISOString() : "";
    return runRenewalTransitionExclusive(async () => {
      const sourceSession = await readSessionForRenewal(sourceSessionId);
      if (
        sourceSession.status !== VIBE64_SESSION_STATUS.RENEWAL_QUIESCED ||
        normalizeText(sourceSession.metadata.renewal_quiesced_id) !== normalizedRenewalId
      ) {
        throw vibe64Error(
          `A renewed session can only be prepared from its quiesced predecessor: ${sourceSessionId}`,
          sourceSession.status === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
            ? "vibe64_session_renewal_conflict"
            : "vibe64_session_renewal_source_not_quiesced"
        );
      }
      const renewalRecords = await listSessionsForRenewal();
      const foreignOwner = renewalRecords.find((session) => (
        session.sessionId !== sourceSessionId &&
        normalizeText(session.metadata.renewal_quiesced_id) === normalizedRenewalId
      ));
      if (foreignOwner) {
        throw vibe64Error(
          `Renewal ${normalizedRenewalId} belongs to another predecessor.`,
          "vibe64_session_renewal_conflict"
        );
      }
      const existingSuccessor = renewalRecords.find((session) => (
        session.sessionId !== sourceSessionId &&
        (
          normalizeText(session.metadata.renewal_id) === normalizedRenewalId ||
          normalizeText(session.metadata.renewed_from) === sourceSessionId
        )
      ));
      if (existingSuccessor) {
        const exactRetry =
          existingSuccessor.status === VIBE64_SESSION_STATUS.RENEWAL_PENDING &&
          normalizeText(existingSuccessor.metadata.renewal_id) === normalizedRenewalId &&
          normalizeText(existingSuccessor.metadata.renewed_from) === sourceSessionId &&
          normalizeText(existingSuccessor.metadata.renewal_actor_id) === normalizedActorId &&
          normalizeText(existingSuccessor.metadata.renewal_actor_display_name) === normalizeText(actorDisplayName) &&
          normalizeText(existingSuccessor.metadata.renewal_confirmed_at) === normalizedConfirmedAt &&
          (
            !normalizedStartedAt ||
            normalizeText(existingSuccessor.metadata.renewal_started_at) === normalizedStartedAt
          ) &&
          (!successorSessionId || existingSuccessor.sessionId === successorSessionId);
        if (exactRetry) {
          return existingSuccessor;
        }
        throw vibe64Error(
          `Another renewal is already prepared for session ${sourceSessionId}.`,
          "vibe64_session_renewal_conflict"
        );
      }
      const successorCreatedAt = now().toISOString();
      return createSessionRecord({
        metadata: {
          ...(isPlainObject(metadata) ? metadata : {}),
          renewal_actor_display_name: normalizeText(actorDisplayName),
          renewal_actor_id: normalizedActorId,
          renewal_confirmed_at: normalizedConfirmedAt,
          renewal_id: normalizedRenewalId,
          renewal_started_at: normalizedStartedAt || successorCreatedAt,
          renewal_successor_created_at: successorCreatedAt,
          renewed_from: sourceSessionId
        },
        runtimeKind,
        sessionId: successorSessionId,
        status: VIBE64_SESSION_STATUS.RENEWAL_PENDING
      });
    });
  }

  async function runRenewalTransitionExclusive(operation) {
    const rootPaths = paths();
    const transitionPaths = pathsForSessionRoot("renewal-transitions", "");
    const transitionKey = path.join(rootPaths.sessionsRoot, ".renewal-transition");
    return enqueueSessionMutation(transitionKey, async () => {
      const release = await acquireStoreSessionLock(transitionPaths, "transition", {
        waitMs: SESSION_MUTATION_LOCK_WAIT_MS
      });
      if (!release) {
        throw vibe64Error(
          "Timed out waiting to transition renewed Vibe64 sessions.",
          "vibe64_session_renewal_transition_lock_timeout"
        );
      }
      try {
        return await operation();
      } finally {
        await release();
      }
    });
  }

  async function transitionRenewalSuccessor({
    acknowledgedAt = "",
    actorDisplayName = "",
    actorId = "",
    handoverDeliveredAt = "",
    renewedAt = "",
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    if (normalizedSourceSessionId === normalizedSuccessorSessionId) {
      throw vibe64Error(
        "A renewed session must have a different session id from its predecessor.",
        "vibe64_session_renewal_same_session"
      );
    }
    const acknowledgedTimestamp = normalizeText(acknowledgedAt);
    const deliveredTimestamp = normalizeText(handoverDeliveredAt);
    if (!acknowledgedTimestamp && !deliveredTimestamp) {
      throw vibe64Error(
        "A renewed session cannot become active before its handover reaches the fresh agent thread.",
        "vibe64_session_renewal_handover_required"
      );
    }
    const normalizedAcknowledgedAt = acknowledgedTimestamp
      ? toDate(acknowledgedTimestamp).toISOString()
      : "";
    const normalizedHandoverDeliveredAt = toDate(
      deliveredTimestamp || normalizedAcknowledgedAt
    ).toISOString();
    const normalizedRenewedAt = renewedAt
      ? toDate(renewedAt).toISOString()
      : now().toISOString();

    return runRenewalTransitionExclusive(async () => {
      const transition = await mutateSessionForRenewal(normalizedSourceSessionId, async (sourcePaths) => {
        return mutateSessionForRenewal(normalizedSuccessorSessionId, async (successorPaths) => {
          const [sourceStatus, sourceMetadata, successorStatus, successorMetadata] = await Promise.all([
            readStatusFromPaths(sourcePaths),
            readMetadataFromPaths(sourcePaths),
            readStatusFromPaths(successorPaths),
            readMetadataFromPaths(successorPaths)
          ]);
          const successorRenewalId = normalizeText(successorMetadata.renewal_id);
          const successorRenewedFrom = normalizeText(successorMetadata.renewed_from);
          const sourceQuiescedId = normalizeText(sourceMetadata.renewal_quiesced_id);
          if (
            successorRenewalId !== normalizedRenewalId ||
            successorRenewedFrom !== normalizedSourceSessionId ||
            sourceQuiescedId !== normalizedRenewalId
          ) {
            throw vibe64Error(
              `Renewal successor does not match renewal ${normalizedRenewalId}: ${normalizedSuccessorSessionId}`,
              "vibe64_session_renewal_link_mismatch"
            );
          }
          if (!normalizeText(successorMetadata.renewal_actor_id)) {
            throw vibe64Error(
              "A renewed session requires actor attribution.",
              "vibe64_session_renewal_actor_required"
            );
          }
          const transitionActorId = normalizeText(actorId) ||
            normalizeText(successorMetadata.renewal_actor_id);
          const transitionActorDisplayName = normalizeText(actorDisplayName) ||
            normalizeText(successorMetadata.renewal_actor_display_name);
          if (!transitionActorId) {
            throw vibe64Error(
              "A renewed session requires actor attribution.",
              "vibe64_session_renewal_actor_required"
            );
          }
          const validTransition = sourceStatus === VIBE64_SESSION_STATUS.RENEWAL_QUIESCED &&
            successorStatus === VIBE64_SESSION_STATUS.RENEWAL_PENDING;
          if (!validTransition) {
            throw vibe64Error(
              `Invalid renewal transition ${sourceStatus} -> ${successorStatus}.`,
              "vibe64_session_renewal_transition_invalid"
            );
          }

          const sharedMetadata = {
            ...(normalizedAcknowledgedAt
              ? {
                  renewal_acknowledged_at: normalizeText(
                    successorMetadata.renewal_acknowledged_at
                  ) || normalizedAcknowledgedAt
                }
              : {}),
            renewal_actor_display_name: transitionActorDisplayName,
            renewal_actor_id: transitionActorId,
            renewal_confirmed_at: normalizeText(successorMetadata.renewal_confirmed_at),
            renewal_handover_delivered_at: normalizeText(
              successorMetadata.renewal_handover_delivered_at
            ) || normalizedHandoverDeliveredAt,
            renewal_id: normalizedRenewalId,
            renewal_started_at: normalizeText(successorMetadata.renewal_started_at),
            renewal_successor_created_at: normalizeText(successorMetadata.renewal_successor_created_at),
            renewed_at: normalizeText(
              successorMetadata.renewed_at
            ) || normalizedRenewedAt
          };
          await Promise.all([
            ...Object.entries({
              ...sharedMetadata,
              renewed_from: normalizedSourceSessionId
            }).map(([name, value]) => (
              writeTextFile(metadataFilePath(successorPaths, name), `${value}\n`)
            ))
          ]);

          // Pre-commit ownership is private: the ordinary predecessor remains
          // quiesced, visible, and selected until its prepared archive proves
          // the exact successor and the renewal state records the commit.
          return {
            renewalId: normalizedRenewalId,
            sourceSessionId: normalizedSourceSessionId,
            successorSessionId: normalizedSuccessorSessionId
          };
        });
      });

      return transition;
    });
  }

  async function activateRenewalSuccessor({
    preparedAt = "",
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const requestedPreparedAt = preparedAt
      ? toDate(preparedAt).toISOString()
      : now().toISOString();
    await withPreparedRenewalSession(normalizedSourceSessionId, (preparedSession) => (
      assertRenewalArchiveOwnership({
        metadata: preparedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      })
    ));
    return runRenewalTransitionExclusive(() => (
      mutateSessionForRenewal(normalizedSuccessorSessionId, async (successorPaths) => {
        const [status, metadata] = await Promise.all([
          readStatusFromPaths(successorPaths),
          readMetadataFromPaths(successorPaths)
        ]);
        if (
          normalizeText(metadata.renewal_id) !== normalizedRenewalId ||
          normalizeText(metadata.renewed_from) !== normalizedSourceSessionId
        ) {
          throw vibe64Error(
            `Renewal successor does not match renewal ${normalizedRenewalId}: ${normalizedSuccessorSessionId}`,
            "vibe64_session_renewal_link_mismatch"
          );
        }
        if (status === VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING) {
          if (!normalizeText(metadata.renewal_activation_prepared_at)) {
            throw vibe64Error(
              `Prepared renewal successor has no activation proof: ${normalizedSuccessorSessionId}`,
              "vibe64_session_renewal_transition_invalid"
            );
          }
          return readSessionFromPaths(successorPaths);
        }
        if (status !== VIBE64_SESSION_STATUS.RENEWAL_PENDING) {
          throw vibe64Error(
            `Renewal successor cannot be activated from status ${status}: ${normalizedSuccessorSessionId}`,
            "vibe64_session_renewal_transition_invalid"
          );
        }
        const normalizedPreparedAt = normalizeText(metadata.renewal_activation_prepared_at) ||
          requestedPreparedAt;
        await writeTextFile(
          metadataFilePath(successorPaths, "renewal_activation_prepared_at"),
          `${normalizedPreparedAt}\n`
        );
        await writeTextFile(
          successorPaths.statusPath,
          `${VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING}\n`
        );
        return readSessionFromPaths(successorPaths);
      })
    ));
  }

  async function rollbackRenewalSuccessorActivation({
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    return runRenewalTransitionExclusive(() => (
      mutateSessionForRenewal(normalizedSuccessorSessionId, async (successorPaths) => {
        const [status, metadata] = await Promise.all([
          readStatusFromPaths(successorPaths),
          readMetadataFromPaths(successorPaths)
        ]);
        if (
          normalizeText(metadata.renewal_id) !== normalizedRenewalId ||
          normalizeText(metadata.renewed_from) !== normalizedSourceSessionId
        ) {
          throw vibe64Error(
            `Renewal successor does not match renewal ${normalizedRenewalId}: ${normalizedSuccessorSessionId}`,
            "vibe64_session_renewal_link_mismatch"
          );
        }
        if (status === VIBE64_SESSION_STATUS.RENEWAL_PENDING) {
          await rm(
            metadataFilePath(successorPaths, "renewal_activation_prepared_at"),
            { force: true }
          );
          return readSessionFromPaths(successorPaths);
        }
        if (status !== VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING) {
          throw vibe64Error(
            `Renewal successor activation cannot be rolled back from status ${status}: ${normalizedSuccessorSessionId}`,
            "vibe64_session_renewal_transition_invalid"
          );
        }
        await writeTextFile(
          successorPaths.statusPath,
          `${VIBE64_SESSION_STATUS.RENEWAL_PENDING}\n`
        );
        await rm(
          metadataFilePath(successorPaths, "renewal_activation_prepared_at"),
          { force: true }
        );
        return readSessionFromPaths(successorPaths);
      })
    ));
  }

  async function commitRenewalSuccessor({
    committedAt = "",
    renewalId = "",
    sourceSessionId = "",
    successorSessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSourceSessionId = assertValidVibe64SessionId(sourceSessionId);
    const normalizedSuccessorSessionId = assertValidVibe64SessionId(successorSessionId);
    const normalizedCommittedAt = toDate(committedAt).toISOString();
    await withPublishedRenewalSession(normalizedSourceSessionId, (publishedSession) => (
      assertRenewalArchiveOwnership({
        metadata: publishedSession.metadata,
        renewalId: normalizedRenewalId,
        sessionId: normalizedSourceSessionId,
        successorSessionId: normalizedSuccessorSessionId
      })
    ));
    return runRenewalTransitionExclusive(() => (
      mutateSessionForRenewal(normalizedSuccessorSessionId, async (successorPaths) => {
        const [status, metadata] = await Promise.all([
          readStatusFromPaths(successorPaths),
          readMetadataFromPaths(successorPaths)
        ]);
        if (
          normalizeText(metadata.renewal_id) !== normalizedRenewalId ||
          normalizeText(metadata.renewed_from) !== normalizedSourceSessionId
        ) {
          throw vibe64Error(
            `Renewal successor does not match renewal ${normalizedRenewalId}: ${normalizedSuccessorSessionId}`,
            "vibe64_session_renewal_link_mismatch"
          );
        }
        if (status === VIBE64_SESSION_STATUS.ACTIVE) {
          if (normalizeText(metadata.renewal_activated_at) !== normalizedCommittedAt) {
            throw vibe64Error(
              `Active renewal successor has a different commit marker: ${normalizedSuccessorSessionId}`,
              "vibe64_session_renewal_transition_invalid"
            );
          }
          return readSessionFromPaths(successorPaths);
        }
        if (
          status !== VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING ||
          !normalizeText(metadata.renewal_activation_prepared_at)
        ) {
          throw vibe64Error(
            `Renewal successor is not prepared for commit: ${normalizedSuccessorSessionId}`,
            "vibe64_session_renewal_transition_invalid"
          );
        }
        await writeTextFile(
          metadataFilePath(successorPaths, "renewal_activated_at"),
          `${normalizedCommittedAt}\n`
        );
        await writeTextFile(successorPaths.statusPath, `${VIBE64_SESSION_STATUS.ACTIVE}\n`);
        return readSessionFromPaths(successorPaths);
      })
    ));
  }

  async function removeRenewalPendingSession({
    renewalId = "",
    sessionId = ""
  } = {}) {
    const normalizedRenewalId = assertRenewalId(renewalId);
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    return runRenewalTransitionExclusive(async () => {
      const sessionPaths = paths(normalizedSessionId);
      const mutationKey = sessionPaths.sessionRoot;
      return enqueueSessionMutation(mutationKey, async () => {
        const release = await acquireStoreSessionLock(sessionPaths, "mutation", {
          waitMs: SESSION_MUTATION_LOCK_WAIT_MS
        });
        if (!release) {
          throw vibe64Error(
            `Timed out waiting to remove renewal successor: ${normalizedSessionId}`,
            "vibe64_session_mutation_lock_timeout"
          );
        }
        try {
          if (!await pathExists(sessionPaths.manifestPath)) {
            if (await readSessionArchiveRecord(normalizedSessionId)) {
              throw vibe64Error(
                `An archived session cannot be removed as a pending renewal successor: ${normalizedSessionId}`,
                "vibe64_session_renewal_transition_invalid"
              );
            }
            return {
              removed: false,
              renewalId: normalizedRenewalId,
              sessionId: normalizedSessionId
            };
          }
          const [status, metadata] = await Promise.all([
            readStatusFromPaths(sessionPaths),
            readMetadataFromPaths(sessionPaths)
          ]);
          if (
            status !== VIBE64_SESSION_STATUS.RENEWAL_PENDING ||
            normalizeText(metadata.renewal_id) !== normalizedRenewalId
          ) {
            throw vibe64Error(
              `Session is not the pending successor for renewal ${normalizedRenewalId}: ${normalizedSessionId}`,
              "vibe64_session_renewal_transition_invalid"
            );
          }
          const rootPaths = paths();
          if (rootPaths.currentSessionAliasPath) {
            await clearVibe64CurrentSessionAliasIfMatches({
              aliasPath: rootPaths.currentSessionAliasPath,
              sessionId: normalizedSessionId
            });
          }
          await rm(sessionPaths.sessionRoot, {
            force: true,
            recursive: true
          });
          return {
            removed: true,
            renewalId: normalizedRenewalId,
            sessionId: normalizedSessionId
          };
        } finally {
          await release();
        }
      });
    });
  }

  async function readUnarchivedSessionRecords() {
    const rootPaths = paths();
    const [activeEntries, closingEntries] = await Promise.all([
      readDirectoryEntries(rootPaths.activeSessionsRoot),
      readDirectoryEntries(rootPaths.closingSessionsRoot)
    ]);
    const activeSessionIds = sortedDirectoryNames(activeEntries, isValidVibe64SessionId);
    const closingSessionIds = sortedDirectoryNames(closingEntries, isValidVibe64SessionId);
    const sessionIds = [...new Set([
      ...activeSessionIds,
      ...closingSessionIds
    ])].sort((left, right) => left.localeCompare(right));
    return Promise.all(sessionIds.map(async (sessionId) => ({
      sessionId,
      status: await readStatusForRenewal(sessionId)
    })));
  }

  async function sessionRecordsForList(options = {}) {
    const listOptions = normalizeSessionListOptions(options);
    let unarchivedRecords = await readUnarchivedSessionRecords();
    if (sessionListMayIncludeArchived(listOptions)) {
      // A process can stop after recording the terminal status but before
      // publishing the archive. Archived-session reads are the recovery boundary.
      for (const record of unarchivedRecords) {
        if (record.status === VIBE64_SESSION_STATUS.ARCHIVED) {
          const session = await readSessionForRenewal(record.sessionId);
          if (
            normalizeText(session.metadata.renewal_id) &&
            normalizeText(session.metadata.renewed_to)
          ) {
            // Renewal owns a reversible close transaction. Ordinary history
            // reads must neither publish it nor interfere with its rollback.
            continue;
          }
          await publishSessionArchive(record.sessionId);
        }
      }
      unarchivedRecords = unarchivedRecords.filter((record) => (
        record.status !== VIBE64_SESSION_STATUS.ARCHIVED
      ));
    }
    unarchivedRecords = unarchivedRecords.filter(({ status }) => (
      sessionStatusMatchesListOptions(status, listOptions)
    ));
    const unarchivedSessionIds = new Set(unarchivedRecords.map((record) => record.sessionId));
    const archivedRecords = sessionListMayIncludeArchived(listOptions)
      ? (await readSessionArchiveRecords())
          .filter((record) => !unarchivedSessionIds.has(record.sessionId))
          .filter((record) => sessionStatusMatchesListOptions(record.status, listOptions))
      : [];
    return {
      archivedRecords,
      unarchivedRecords
    };
  }

  async function listSessions(options = {}) {
    const {
      archivedRecords,
      unarchivedRecords
    } = await sessionRecordsForList(options);
    const sessionIds = [
      ...unarchivedRecords.map((record) => record.sessionId),
      ...archivedRecords.map((record) => record.sessionId)
    ].sort((left, right) => left.localeCompare(right));
    return Promise.all(sessionIds.map((entrySessionId) => readSession(entrySessionId)));
  }

  async function listSessionSummaries(options = {}) {
    const {
      archivedRecords,
      unarchivedRecords
    } = await sessionRecordsForList(options);
    const unarchivedSummaries = await Promise.all(unarchivedRecords.map((record) => (
      readSessionSummary(record.sessionId)
    )));
    return [
      ...unarchivedSummaries,
      ...archivedRecords.map(sessionArchiveSummary)
    ].sort((left, right) => normalizeText(left.sessionId).localeCompare(normalizeText(right.sessionId)));
  }

  async function listSessionsForRenewal() {
    const sessions = await Promise.all(
      (await readUnarchivedSessionRecords())
        .filter(({ status }) => [
          VIBE64_SESSION_STATUS.ARCHIVED,
          VIBE64_SESSION_STATUS.ACTIVE,
          VIBE64_SESSION_STATUS.BLOCKED,
          VIBE64_SESSION_STATUS.RENEWAL_ACTIVATING,
          VIBE64_SESSION_STATUS.RENEWAL_PENDING,
          VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
        ].includes(status))
        .map(({ sessionId }) => readSessionForRenewal(sessionId))
    );
    return sessions.filter((session) => (
      [
        VIBE64_SESSION_STATUS.ACTIVE,
        VIBE64_SESSION_STATUS.BLOCKED,
        VIBE64_SESSION_STATUS.RENEWAL_QUIESCED
      ].includes(session.status) ||
      sessionIsUnfinishedRenewalRecord(session)
    ));
  }

  return {
    createSession,
    createRenewalPendingSession,
    commitRenewalArchive,
    commitRenewalCurrentSession,
    commitRenewalSuccessor,
    publishSessionArchive,
    prepareRenewalSessionArchive,
    conversationMessageIdExists,
    deleteMetadataValue,
    deleteMetadataValues,
    detachRenewedSessionForArchive,
    finalizeRenewalArchiveCommit,
    listSessions,
    listSessionsForRenewal,
    listSessionRenewalStateSessionIds,
    listSessionSummaries,
    mutateSession,
    mutateSessionForRenewal,
    paths,
    readArtifact,
    withReadableSessionPaths,
    readArtifactForRenewal,
    readAgentRun,
    readAgentRuns,
    readBackgroundTask,
    readBackgroundTasks,
    readConversationLog,
    readConversationLogPage,
    readCurrentSession,
    readManifest,
    readMetadata,
    readMetadataValue,
    readSession,
    readSessionForRenewal,
    readSessionRenewalStateRecord,
    readSessionSourceDescriptor,
    readSessionSummary,
    readStatus,
    readStatusForRenewal,
    quiesceSessionForRenewal,
    removeRenewalPendingSession,
    activateRenewalSuccessor,
    rollbackRenewalSuccessorActivation,
    restoreRenewalClosingSession,
    restoreSessionAfterRenewalCancellation,
    runSessionExclusive,
    runSessionExclusiveForRenewal,
    runSessionRenewalStateExclusive,
    runSessionRenewalWorkflowExclusive,
    updateCurrentSession,
    transitionRenewalSuccessor,
    finalizeRenewalCurrentSession,
    writeArtifact,
    writeJsonArtifact,
    writeAgentRunEvent,
    writeBackgroundTaskEvent,
    upsertConversationAssistantMessage,
    writeConversationAssistantMessage,
    writeConversationCommentaryMessage,
    writeConversationSystemMessage,
    writeConversationThinkingMessage,
    writeConversationUserMessage,
    writeMetadataValue,
    writeMetadataValueForRenewal,
    writeJsonArtifactForRenewal,
    writeSessionRenewalStateRecord,
    withPublishedRenewalSession,
    writeSessionLabel,
    writeStatus
  };
}

export {
  VIBE64_AGENT_RUN_STATE,
  VIBE64_SESSION_SCHEMA_VERSION,
  VIBE64_SESSION_STATUS,
  assertVibe64SessionStatus,
  assertValidVibe64SessionId,
  createVibe64SessionStore,
  isValidVibe64SessionId,
  normalizeVibe64AgentRunState,
  resolveVibe64SessionPaths,
  vibe64AgentRunStateIsActive,
  vibe64AgentRunStateIsTerminal,
  vibe64SessionStatusIsHidden,
  vibe64SessionStatusIsOpen
};
