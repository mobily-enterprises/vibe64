import { AsyncLocalStorage } from "node:async_hooks";
import { execFile } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import { mkdir, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import {
  VIBE64_STATE_DIR,
  vibe64Error,
  isPlainObject,
  isMissingPathError,
  normalizeTargetRoot,
  normalizeText,
  plainClone,
  pathExists
} from "@local/vibe64-core/server/core";
import {
  VIBE64_PROJECT_LOCAL_DIR
} from "@local/vibe64-core/server/studioRoots";
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";

const VIBE64_SESSION_SCHEMA_VERSION = 1;
const VIBE64_CLOSED_SESSION_ARCHIVE_SCHEMA_VERSION = 1;
const PRIVATE_INPUT_SCHEMA_VERSION = 1;
const VIBE64_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION = 1;
const VIBE64_INITIAL_STEP = "session_created";
const ISSUE_WORD_ARTIFACT = "issue_word";
const WORK_WORD_ARTIFACT = "work_word";
const REPORT_ARTIFACT = "report.md";
const ISSUE_WORD_MAX_LENGTH = 24;
const VIBE64_SESSION_STATUS = deepFreeze({
  ABANDONED: "abandoned",
  ACTIVE: "active",
  BLOCKED: "blocked",
  FINISHED: "finished"
});
const VIBE64_SESSION_STATUSES = new Set(Object.values(VIBE64_SESSION_STATUS));
const CLOSED_VIBE64_SESSION_STATUSES = new Set([
  VIBE64_SESSION_STATUS.ABANDONED,
  VIBE64_SESSION_STATUS.FINISHED
]);
const CLOSED_VIBE64_SESSION_STATUS_LIST = [
  VIBE64_SESSION_STATUS.ABANDONED,
  VIBE64_SESSION_STATUS.FINISHED
];
const CLOSED_SESSION_ARCHIVE_KIND = "vibe64.closed_session_archive";
const CLOSED_SESSION_INDEX_METADATA_NAMES = Object.freeze([
  "accepted_commit",
  "base_branch",
  "base_commit",
  "branch",
  "issue_title",
  "issue_url",
  "issue_word",
  "local_commit_only",
  "main_checkout_synced",
  "merge_skipped",
  "pr_merged",
  "pr_url",
  "pull_request_path",
  "session_branch",
  "session_finished",
  "source_pr_title",
  "source_pr_update_mode",
  "source_pr_url",
  "work_source",
  "work_word",
  "workflow_definition",
  "worktree",
  "worktree_path",
  "worktree_recovery_branch",
  "worktree_recovery_dirty",
  "worktree_recovery_excluded_untracked_count",
  "worktree_recovery_head",
  "worktree_recovery_patch_artifact",
  "worktree_recovery_saved",
  "worktree_recovery_saved_at",
  "worktree_recovery_session_name",
  "worktree_recovery_untracked_artifact",
  "worktree_recovery_untracked_count",
  "worktree_removed"
]);
const CLOSED_SESSION_ARCHIVE_TIMEOUT_MS = 60_000;
const COMMAND_BUFFER_BYTES = 50 * 1024 * 1024;
const ACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const ACTION_ATTEMPT_FILE_PATTERN = /^(\d{6})-([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/u;
const AGENT_RUN_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const ARTIFACT_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const BACKGROUND_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const COMMAND_LIFECYCLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const CONVERSATION_MESSAGE_ROLES = deepFreeze([
  "assistant",
  "system",
  "thinking",
  "user"
]);
const CONVERSATION_MESSAGE_FILE_PATTERN = /^(user|assistant|system|thinking)\.(\d{8}T\d{9}Z)\.md$/u;
const CONVERSATION_TURN_ID_PATTERN = /^\d{6}$/u;
const METADATA_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const PRIVATE_INPUT_FILE_PATTERN = /^(\d{6})-([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const COMMAND_LIFECYCLE_PHASE_RANK = Object.freeze({
  starting: 10,
  started: 20,
  terminal_exited: 30,
  result_writing: 40,
  result_written: 50,
  advanced: 60,
  post_commit_running: 70,
  done: 80,
  failed: 90
});
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
const sessionMutationChains = new Map();
const sessionMutationContext = new AsyncLocalStorage();
const execFileAsync = promisify(execFile);

function isValidVibe64SessionId(sessionId) {
  const normalizedSessionId = normalizeText(sessionId);
  return SESSION_ID_PATTERN.test(normalizedSessionId);
}

function artifactFingerprint(text = "") {
  return createHash("sha256").update(String(text || "")).digest("hex");
}

function isSafeStepId(stepId) {
  return STEP_ID_PATTERN.test(normalizeText(stepId));
}

function isSafeActionId(actionId) {
  return ACTION_ID_PATTERN.test(normalizeText(actionId));
}

function isSafeCommandLifecycleId(lifecycleId) {
  return COMMAND_LIFECYCLE_ID_PATTERN.test(normalizeText(lifecycleId));
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

function assertSafeStepId(stepId) {
  const normalizedStepId = normalizeText(stepId);
  if (!isSafeStepId(normalizedStepId)) {
    throw vibe64Error(`Invalid vibe64 step id: ${normalizedStepId || "(empty)"}`, "vibe64_invalid_step_id");
  }
  return normalizedStepId;
}

function assertSafeActionId(actionId) {
  const normalizedActionId = normalizeText(actionId);
  if (!isSafeActionId(normalizedActionId)) {
    throw vibe64Error(`Invalid vibe64 action id: ${normalizedActionId || "(empty)"}`, "vibe64_invalid_action_id");
  }
  return normalizedActionId;
}

function assertSafeCommandLifecycleId(lifecycleId) {
  const normalizedLifecycleId = normalizeText(lifecycleId);
  if (!isSafeCommandLifecycleId(normalizedLifecycleId)) {
    throw vibe64Error(
      `Invalid vibe64 command lifecycle id: ${normalizedLifecycleId || "(empty)"}`,
      "vibe64_invalid_command_lifecycle_id"
    );
  }
  return normalizedLifecycleId;
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

function normalizeSessionListStatusGroup(statusGroup = "") {
  const normalizedStatusGroup = normalizeText(statusGroup);
  if (!normalizedStatusGroup) {
    return "";
  }
  if (["all", "closed", "open"].includes(normalizedStatusGroup)) {
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
  if (statuses.size > 0 && !statuses.has(normalizedStatus)) {
    return false;
  }
  if (statusGroup === "open") {
    return !CLOSED_VIBE64_SESSION_STATUSES.has(normalizedStatus);
  }
  if (statusGroup === "closed") {
    return CLOSED_VIBE64_SESSION_STATUSES.has(normalizedStatus);
  }
  return true;
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

async function writePrivateJsonFile(filePath, value) {
  const directory = path.dirname(filePath);
  const tempPath = path.join(directory, `.${path.basename(filePath)}.${process.pid}.${randomUUID()}.tmp`);
  await mkdir(directory, {
    mode: 0o700,
    recursive: true
  });
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      mode: 0o600
    });
    await rename(tempPath, filePath);
  } catch (error) {
    await rm(tempPath, {
      force: true
    });
    throw error;
  }
}

function commandOutput(error = {}) {
  return normalizeText(`${error.stdout || ""}\n${error.stderr || ""}`) ||
    normalizeText(error.message);
}

async function runCommand(command, args = [], {
  cwd = "",
  maxBuffer = COMMAND_BUFFER_BYTES,
  timeout = CLOSED_SESSION_ARCHIVE_TIMEOUT_MS
} = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd,
      maxBuffer,
      timeout
    });
    return {
      ok: true,
      output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`),
      stdout: String(result.stdout || ""),
      stderr: String(result.stderr || "")
    };
  } catch (error) {
    return {
      ok: false,
      output: commandOutput(error),
      stdout: String(error.stdout || ""),
      stderr: String(error.stderr || "")
    };
  }
}

function revisionNumber(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 0 ? revision : 0;
}

function stepRevisionNumber(value) {
  const revision = Number(value);
  return Number.isSafeInteger(revision) && revision >= 1 ? revision : 1;
}

function normalizeManifest(manifest = {}) {
  return {
    ...manifest,
    revision: revisionNumber(manifest.revision),
    stepRevision: stepRevisionNumber(manifest.stepRevision)
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
          stepRevision: normalizedManifest.stepRevision,
          updatedAt: normalizeText(normalizedManifest.updatedAt)
        }
      : value.manifest,
    revision: normalizedManifest.revision,
    stepRevision: normalizedManifest.stepRevision,
    updatedAt: normalizeText(normalizedManifest.updatedAt)
  };
}

function enqueueSessionMutation(key, operation) {
  const previous = sessionMutationChains.get(key) || Promise.resolve();
  const run = () => sessionMutationContext.run({
    key
  }, operation);
  const queued = previous.catch(() => null).then(run);
  const stored = queued.catch(() => null).finally(() => {
    if (sessionMutationChains.get(key) === stored) {
      sessionMutationChains.delete(key);
    }
  });
  sessionMutationChains.set(key, stored);
  return queued;
}

function normalizePromptContextSnapshot(snapshot = {}) {
  if (!isPlainObject(snapshot) || !isPlainObject(snapshot.adapter)) {
    return null;
  }
  return {
    adapter: plainClone(snapshot.adapter),
    createdAt: normalizeText(snapshot.createdAt),
    schemaVersion: snapshot.schemaVersion === VIBE64_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION
      ? VIBE64_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION
      : VIBE64_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION
  };
}

function normalizeCommandLifecyclePhase(value = "") {
  const phase = normalizeText(value);
  return COMMAND_LIFECYCLE_PHASE_RANK[phase] ? phase : "";
}

function commandLifecyclePhaseRank(value = "") {
  return COMMAND_LIFECYCLE_PHASE_RANK[normalizeCommandLifecyclePhase(value)] || 0;
}

function latestCommandLifecyclePhase(previousPhase = "", nextPhase = "") {
  const normalizedPreviousPhase = normalizeCommandLifecyclePhase(previousPhase);
  const normalizedNextPhase = normalizeCommandLifecyclePhase(nextPhase);
  if (!normalizedNextPhase) {
    return normalizedPreviousPhase;
  }
  if (!normalizedPreviousPhase) {
    return normalizedNextPhase;
  }
  return commandLifecyclePhaseRank(normalizedNextPhase) >= commandLifecyclePhaseRank(normalizedPreviousPhase)
    ? normalizedNextPhase
    : normalizedPreviousPhase;
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

async function sortedArtifactPaths(rootPath, relativeDirectory = "") {
  const directoryPath = relativeDirectory ? path.join(rootPath, ...relativeDirectory.split("/")) : rootPath;
  const entries = await readDirectoryEntries(directoryPath);
  const files = sortedFileNames(entries, (name) => ARTIFACT_PATH_SEGMENT_PATTERN.test(name))
    .map((name) => relativeDirectory ? `${relativeDirectory}/${name}` : name);
  const directories = sortedDirectoryNames(entries, (name) => ARTIFACT_PATH_SEGMENT_PATTERN.test(name));
  const nestedFiles = await Promise.all(directories.map((directoryName) => {
    const nestedDirectory = relativeDirectory ? `${relativeDirectory}/${directoryName}` : directoryName;
    return sortedArtifactPaths(rootPath, nestedDirectory);
  }));
  return [
    ...files,
    ...nestedFiles.flat()
  ].sort((left, right) => left.localeCompare(right));
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
  closedSessionsRoot = "",
  sessionId = "",
  sessionRoot = "",
  sessionsRoot = "",
  stateRoot = "",
  targetRoot = ""
} = {}) {
  return {
    actionsRoot: sessionRoot ? path.join(sessionRoot, "actions") : "",
    actionAttemptsRoot: sessionRoot ? path.join(sessionRoot, "action-attempts") : "",
    activeSessionsRoot,
    agentRunsRoot: sessionRoot ? path.join(sessionRoot, "agent-runs") : "",
    artifactsRoot: sessionRoot ? path.join(sessionRoot, "artifacts") : "",
    backgroundTasksRoot: sessionRoot ? path.join(sessionRoot, "background-tasks") : "",
    closedSessionsRoot,
    commandLifecyclesRoot: sessionRoot ? path.join(sessionRoot, "command-lifecycle") : "",
    commandLogPath: sessionRoot ? path.join(sessionRoot, "command-log.jsonl") : "",
    conversationLogRoot: sessionRoot ? path.join(sessionRoot, "conversation-log") : "",
    currentStepPath: sessionRoot ? path.join(sessionRoot, "current_step") : "",
    manifestPath: sessionRoot ? path.join(sessionRoot, "session.json") : "",
    metadataRoot: sessionRoot ? path.join(sessionRoot, "metadata") : "",
    privateInputsRoot: sessionRoot ? path.join(sessionRoot, "private-inputs") : "",
    promptContextSnapshotPath: sessionRoot ? path.join(sessionRoot, "prompt-context.json") : "",
    sessionId,
    sessionRoot,
    sessionsRoot,
    stateRoot,
    statusPath: sessionRoot ? path.join(sessionRoot, "status") : "",
    stepStatesRoot: sessionRoot ? path.join(sessionRoot, "step-state") : "",
    stepsRoot: sessionRoot ? path.join(sessionRoot, "steps") : "",
    targetRoot
  };
}

function resolveVibe64SessionPaths({
  sessionId = "",
  stateRoot = "",
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = normalizeTargetRoot(targetRoot);
  const resolvedStateRoot = stateRoot ? path.resolve(stateRoot) : path.join(normalizedTargetRoot, VIBE64_PROJECT_LOCAL_DIR);
  const sessionsRoot = path.join(resolvedStateRoot, "sessions");
  const activeSessionsRoot = path.join(sessionsRoot, "active");
  const closedSessionsRoot = path.join(sessionsRoot, "closed");
  const normalizedSessionId = normalizeText(sessionId);
  const sessionRoot = normalizedSessionId ? path.join(activeSessionsRoot, assertValidVibe64SessionId(normalizedSessionId)) : "";
  return sessionPathsFromRoot({
    activeSessionsRoot,
    closedSessionsRoot,
    sessionId: normalizedSessionId,
    sessionRoot,
    sessionsRoot,
    stateRoot: resolvedStateRoot,
    targetRoot: normalizedTargetRoot
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

function closedSessionStatusRoot(rootPaths = {}, status = "") {
  const normalizedStatus = assertVibe64SessionStatus(status);
  if (!CLOSED_VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
    throw vibe64Error(
      `Cannot archive open Vibe64 session status: ${normalizedStatus}`,
      "vibe64_session_archive_open_status"
    );
  }
  return path.join(rootPaths.closedSessionsRoot, normalizedStatus);
}

function closedSessionArchivePath(rootPaths = {}, status = "", sessionId = "") {
  return path.join(closedSessionStatusRoot(rootPaths, status), `${assertValidVibe64SessionId(sessionId)}.tar.gz`);
}

function closedSessionMetadataPath(rootPaths = {}, status = "", sessionId = "") {
  return path.join(closedSessionStatusRoot(rootPaths, status), `${assertValidVibe64SessionId(sessionId)}.json`);
}

function closedSessionStagingRoot(rootPaths = {}) {
  return path.join(rootPaths.closedSessionsRoot, ".staging");
}

async function closedSessionRecordExists(rootPaths = {}, sessionId = "") {
  const normalizedSessionId = assertValidVibe64SessionId(sessionId);
  return (await Promise.all(CLOSED_VIBE64_SESSION_STATUS_LIST.map(async (status) => {
    return await pathExists(closedSessionMetadataPath(rootPaths, status, normalizedSessionId)) ||
      await pathExists(closedSessionArchivePath(rootPaths, status, normalizedSessionId));
  }))).some(Boolean);
}

async function sessionRecordExists(rootPaths = {}, sessionId = "") {
  const normalizedSessionId = assertValidVibe64SessionId(sessionId);
  return await pathExists(path.join(rootPaths.activeSessionsRoot, normalizedSessionId)) ||
    await closedSessionRecordExists(rootPaths, normalizedSessionId);
}

function metadataFilePath(sessionPaths, name) {
  return path.join(sessionPaths.metadataRoot, assertSafeMetadataName(name));
}

function sessionNameFromIssueWord(issueWord = "") {
  return normalizeText(issueWord)
    .split(/\s+/u)
    .map((word) => word.replaceAll(/[^A-Za-z0-9_-]/gu, "").slice(0, ISSUE_WORD_MAX_LENGTH))
    .find(Boolean) || "";
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

function actionResultFilePath(sessionPaths, actionId) {
  return path.join(sessionPaths.actionsRoot, assertSafeActionId(actionId));
}

function actionAttemptFilePath(sessionPaths, attemptFileName) {
  const normalizedFileName = normalizeText(attemptFileName);
  if (!ACTION_ATTEMPT_FILE_PATTERN.test(normalizedFileName)) {
    throw vibe64Error(`Invalid vibe64 action attempt file: ${normalizedFileName || "(empty)"}`, "vibe64_invalid_action_attempt");
  }
  return path.join(sessionPaths.actionAttemptsRoot, normalizedFileName);
}

function assertSafePrivateInputOwnerId(ownerId) {
  const normalizedOwnerId = normalizeText(ownerId);
  if (!ACTION_ID_PATTERN.test(normalizedOwnerId)) {
    throw vibe64Error(
      `Invalid vibe64 private input owner: ${normalizedOwnerId || "(empty)"}`,
      "vibe64_invalid_private_input_owner"
    );
  }
  return normalizedOwnerId;
}

function privateInputFilePath(sessionPaths, fileName) {
  const normalizedFileName = normalizeText(fileName);
  if (!PRIVATE_INPUT_FILE_PATTERN.test(normalizedFileName)) {
    throw vibe64Error(
      `Invalid vibe64 private input file: ${normalizedFileName || "(empty)"}`,
      "vibe64_invalid_private_input_file"
    );
  }
  return path.join(sessionPaths.privateInputsRoot, normalizedFileName);
}

function agentRunFilePath(sessionPaths, runId) {
  return path.join(sessionPaths.agentRunsRoot, `${assertSafeAgentRunId(runId)}.json`);
}

function backgroundTaskFilePath(sessionPaths, taskId) {
  return path.join(sessionPaths.backgroundTasksRoot, `${assertSafeBackgroundTaskId(taskId)}.json`);
}

function commandLifecycleFilePath(sessionPaths, lifecycleId) {
  return path.join(sessionPaths.commandLifecyclesRoot, `${assertSafeCommandLifecycleId(lifecycleId)}.json`);
}

function completedStepFilePath(sessionPaths, stepId) {
  return path.join(sessionPaths.stepsRoot, assertSafeStepId(stepId));
}

function stepStateFilePath(sessionPaths, stepId) {
  return path.join(sessionPaths.stepStatesRoot, assertSafeStepId(stepId));
}

function conversationTurnRoot(sessionPaths, turnId) {
  const normalizedTurnId = normalizeText(turnId);
  if (!CONVERSATION_TURN_ID_PATTERN.test(normalizedTurnId)) {
    throw vibe64Error(`Invalid vibe64 conversation turn id: ${normalizedTurnId || "(empty)"}`, "vibe64_invalid_conversation_turn_id");
  }
  return path.join(sessionPaths.conversationLogRoot, normalizedTurnId);
}

function conversationMessageFileName(role = "", date) {
  const normalizedRole = normalizeText(role);
  if (!CONVERSATION_MESSAGE_ROLES.includes(normalizedRole)) {
    throw vibe64Error(`Invalid vibe64 conversation role: ${normalizedRole || "(empty)"}`, "vibe64_invalid_conversation_role");
  }
  return `${normalizedRole}.${timestampForConversationFile(date)}.md`;
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

function createVibe64SessionStore({
  clock = undefined,
  projectLocalRoot = "",
  stateRoot = "",
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = normalizeTargetRoot(targetRoot);
  const resolvedProjectLocalRoot = String(projectLocalRoot || stateRoot || "").trim();
  if (!resolvedProjectLocalRoot) {
    throw vibe64Error("Vibe64 session store requires projectLocalRoot.", "vibe64_project_local_root_required");
  }
  const normalizedStateRoot = path.resolve(resolvedProjectLocalRoot);
  const now = createClockNow(clock);

  function paths(sessionId = "") {
    return resolveVibe64SessionPaths({
      sessionId,
      stateRoot: normalizedStateRoot,
      targetRoot: normalizedTargetRoot
    });
  }

  function pathsForSessionRoot(sessionId = "", sessionRoot = "") {
    const rootPaths = paths();
    return sessionPathsFromRoot({
      activeSessionsRoot: rootPaths.activeSessionsRoot,
      closedSessionsRoot: rootPaths.closedSessionsRoot,
      sessionId: assertValidVibe64SessionId(sessionId),
      sessionRoot,
      sessionsRoot: rootPaths.sessionsRoot,
      stateRoot: rootPaths.stateRoot,
      targetRoot: rootPaths.targetRoot
    });
  }

  async function ensureActiveSessionRoot(sessionId) {
    const sessionPaths = paths(sessionId);
    if (!await pathExists(sessionPaths.manifestPath)) {
      throw vibe64Error(`Unknown vibe64 session: ${sessionPaths.sessionId}`, "vibe64_session_not_found");
    }
    return sessionPaths;
  }

  function closedArchiveRecordFromJson(value = {}, {
    archivePath = "",
    metadataPath = "",
    status = ""
  } = {}) {
    if (
      !isPlainObject(value) ||
      value.kind !== CLOSED_SESSION_ARCHIVE_KIND ||
      value.schemaVersion !== VIBE64_CLOSED_SESSION_ARCHIVE_SCHEMA_VERSION ||
      !isValidVibe64SessionId(value.sessionId)
    ) {
      throw vibe64Error(
        `Invalid closed Vibe64 session archive metadata: ${metadataPath}`,
        "vibe64_invalid_closed_session_archive_metadata"
      );
    }
    const normalizedStatus = assertVibe64SessionStatus(value.status || status);
    if (!CLOSED_VIBE64_SESSION_STATUSES.has(normalizedStatus)) {
      throw vibe64Error(
        `Invalid closed Vibe64 session archive status: ${normalizedStatus}`,
        "vibe64_invalid_closed_session_archive_status"
      );
    }
    return {
      ...value,
      archivePath,
      index: isPlainObject(value.index) ? value.index : {},
      metadataPath,
      status: normalizedStatus
    };
  }

  async function readClosedArchiveRecordForStatus(rootPaths, status, sessionId) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const metadataPath = closedSessionMetadataPath(rootPaths, status, normalizedSessionId);
    if (!await pathExists(metadataPath)) {
      return null;
    }
    try {
      return closedArchiveRecordFromJson(JSON.parse(await readFile(metadataPath, "utf8")), {
        archivePath: closedSessionArchivePath(rootPaths, status, normalizedSessionId),
        metadataPath,
        status
      });
    } catch (error) {
      if (error?.code?.startsWith?.("vibe64_")) {
        throw error;
      }
      throw vibe64Error(
        `Invalid closed Vibe64 session archive metadata: ${metadataPath}`,
        "vibe64_invalid_closed_session_archive_metadata"
      );
    }
  }

  async function readClosedArchiveRecord(sessionId) {
    const rootPaths = paths();
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    for (const status of CLOSED_VIBE64_SESSION_STATUS_LIST) {
      const record = await readClosedArchiveRecordForStatus(rootPaths, status, normalizedSessionId);
      if (record) {
        return record;
      }
    }
    return null;
  }

  async function readClosedArchiveRecords() {
    const rootPaths = paths();
    const statusRecords = await Promise.all(CLOSED_VIBE64_SESSION_STATUS_LIST.map(async (status) => {
      const entries = await readDirectoryEntries(closedSessionStatusRoot(rootPaths, status));
      const metadataFileNames = sortedFileNames(entries, (name) => {
        return name.endsWith(".json") && isValidVibe64SessionId(name.slice(0, -".json".length));
      });
      return Promise.all(metadataFileNames.map((fileName) => {
        return readClosedArchiveRecordForStatus(rootPaths, status, fileName.slice(0, -".json".length));
      }));
    }));
    return statusRecords.flat().filter(Boolean);
  }

  function closedArchiveIndexMetadata(metadata = {}) {
    if (!isPlainObject(metadata)) {
      return {};
    }
    const entries = CLOSED_SESSION_INDEX_METADATA_NAMES
      .map((name) => [
        name,
        normalizeText(metadata[name])
      ])
      .filter(([, value]) => value);
    return Object.fromEntries(entries);
  }

  function closedArchiveIndexFromSummary(summary = {}, {
    sessionId = "",
    status = ""
  } = {}) {
    const manifest = isPlainObject(summary.manifest) ? summary.manifest : {};
    const createdAt = normalizeText(summary.createdAt || manifest.createdAt);
    const updatedAt = normalizeText(summary.updatedAt || manifest.updatedAt || createdAt);
    const completedStepCount = Number(summary.completedStepCount);
    return {
      completedStepCount: Number.isSafeInteger(completedStepCount) && completedStepCount >= 0
        ? completedStepCount
        : 0,
      createdAt,
      currentStep: normalizeText(summary.currentStep),
      manifest: {
        createdAt,
        revision: revisionNumber(summary.revision ?? manifest.revision),
        stepRevision: stepRevisionNumber(summary.stepRevision ?? manifest.stepRevision),
        updatedAt
      },
      metadata: closedArchiveIndexMetadata(summary.metadata),
      revision: revisionNumber(summary.revision ?? manifest.revision),
      sessionId: assertValidVibe64SessionId(sessionId || summary.sessionId),
      sessionName: normalizeText(summary.sessionName),
      sessionRoot: "",
      status: assertVibe64SessionStatus(status || summary.status),
      stepRevision: stepRevisionNumber(summary.stepRevision ?? manifest.stepRevision),
      targetRoot: normalizeText(summary.targetRoot),
      updatedAt
    };
  }

  function closedArchiveSummary(record = {}) {
    const index = isPlainObject(record.index) ? record.index : {};
    return {
      ...index,
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

  function closedArchiveMetadataRecord({
    archivePath = "",
    archivedAt = "",
    metadataPath = "",
    sessionId = "",
    status = "",
    summary = {}
  } = {}) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const normalizedStatus = assertVibe64SessionStatus(status);
    const archiveFileName = path.basename(archivePath);
    const metadataFileName = path.basename(metadataPath);
    return {
      archive: {
        fileName: archiveFileName,
        relativePath: `closed/${normalizedStatus}/${archiveFileName}`
      },
      archivedAt: normalizeText(archivedAt),
      index: closedArchiveIndexFromSummary(summary, {
        sessionId: normalizedSessionId,
        status: normalizedStatus
      }),
      kind: CLOSED_SESSION_ARCHIVE_KIND,
      metadata: {
        fileName: metadataFileName,
        relativePath: `closed/${normalizedStatus}/${metadataFileName}`
      },
      schemaVersion: VIBE64_CLOSED_SESSION_ARCHIVE_SCHEMA_VERSION,
      sessionId: normalizedSessionId,
      status: normalizedStatus
    };
  }

  async function withExtractedClosedArchive(record, operation) {
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
      ]);
      if (!extractResult.ok) {
        throw vibe64Error(
          `Cannot read closed Vibe64 session archive ${record.archivePath}: ${extractResult.output}`,
          "vibe64_closed_session_archive_read_failed"
        );
      }
      const sessionPaths = pathsForSessionRoot(record.sessionId, extractedSessionRoot);
      if (!await pathExists(sessionPaths.manifestPath)) {
        throw vibe64Error(
          `Closed Vibe64 session archive does not contain session ${record.sessionId}.`,
          "vibe64_closed_session_archive_missing_session"
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

  async function withReadableSessionPaths(sessionId, operation) {
    const activePaths = paths(sessionId);
    if (await pathExists(activePaths.manifestPath)) {
      return operation(activePaths, null);
    }
    const record = await readClosedArchiveRecord(sessionId);
    if (record) {
      return withExtractedClosedArchive(record, operation);
    }
    throw vibe64Error(`Unknown vibe64 session: ${activePaths.sessionId}`, "vibe64_session_not_found");
  }

  async function bumpSessionRevision(sessionPaths) {
    const manifest = await readManifest(sessionPaths.sessionId);
    const nextManifest = {
      ...manifest,
      revision: revisionNumber(manifest.revision) + 1,
      updatedAt: now().toISOString()
    };
    await writeJsonFile(sessionPaths.manifestPath, nextManifest);
    return nextManifest;
  }

  async function bumpSessionStepRevision(sessionPaths) {
    const manifest = await readManifestFromPaths(sessionPaths);
    const nextManifest = {
      ...manifest,
      stepRevision: stepRevisionNumber(manifest.stepRevision) + 1
    };
    await writeJsonFile(sessionPaths.manifestPath, nextManifest);
    return nextManifest;
  }

  async function mutateSession(sessionId, operation) {
    const sessionPaths = await ensureActiveSessionRoot(sessionId);
    const key = sessionPaths.sessionRoot;
    if (sessionMutationContext.getStore()?.key === key) {
      return operation(sessionPaths);
    }
    return enqueueSessionMutation(key, async () => {
      const result = await operation(sessionPaths);
      const manifest = await bumpSessionRevision(sessionPaths);
      return withRevisionMarker(result, manifest, sessionPaths.sessionId);
    });
  }

  async function writeStatus(sessionId, status) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await writeTextFile(sessionPaths.statusPath, `${assertVibe64SessionStatus(status)}\n`);
    });
  }

  async function readStatus(sessionId) {
    return withReadableSessionPaths(sessionId, readStatusFromPaths);
  }

  async function readStatusFromPaths(sessionPaths) {
    return normalizeText(await readTextIfExists(sessionPaths.statusPath)) || VIBE64_SESSION_STATUS.ACTIVE;
  }

  async function writeCurrentStep(sessionId, currentStep) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const nextStep = normalizeText(currentStep) || VIBE64_INITIAL_STEP;
      const previousStep = normalizeText(await readTextIfExists(sessionPaths.currentStepPath)) || VIBE64_INITIAL_STEP;
      await writeTextFile(sessionPaths.currentStepPath, `${nextStep}\n`);
      if (previousStep !== nextStep) {
        await bumpSessionStepRevision(sessionPaths);
      }
    });
  }

  async function readCurrentStep(sessionId) {
    return withReadableSessionPaths(sessionId, readCurrentStepFromPaths);
  }

  async function readCurrentStepFromPaths(sessionPaths) {
    return normalizeText(await readTextIfExists(sessionPaths.currentStepPath)) || VIBE64_INITIAL_STEP;
  }

  async function writeMetadataValue(sessionId, name, value) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await writeTextFile(metadataFilePath(sessionPaths, name), `${normalizeText(value)}\n`);
    });
  }

  async function writeIssueWordMetadata(sessionId, issueWord) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const sessionName = sessionNameFromIssueWord(issueWord);
      if (!sessionName) {
        await rm(metadataFilePath(sessionPaths, ISSUE_WORD_ARTIFACT), {
          force: true
        });
        return "";
      }
      await writeTextFile(metadataFilePath(sessionPaths, ISSUE_WORD_ARTIFACT), `${sessionName}\n`);
      return sessionName;
    });
  }

  async function writeSessionLabel(sessionId, sessionLabel) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const sessionName = sessionNameFromIssueWord(sessionLabel);
      if (!sessionName) {
        return "";
      }
      await Promise.all([
        writeTextFile(metadataFilePath(sessionPaths, ISSUE_WORD_ARTIFACT), `${sessionName}\n`),
        writeTextFile(metadataFilePath(sessionPaths, WORK_WORD_ARTIFACT), `${sessionName}\n`),
        writeTextFile(artifactFilePath(sessionPaths, ISSUE_WORD_ARTIFACT), `${sessionName}\n`),
        writeTextFile(artifactFilePath(sessionPaths, WORK_WORD_ARTIFACT), `${sessionName}\n`)
      ]);
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

  async function sessionNameForSession(sessionPaths, metadata = {}) {
    const existingSessionName = sessionNameFromIssueWord(metadata[ISSUE_WORD_ARTIFACT]);
    if (existingSessionName) {
      return existingSessionName;
    }

    return sessionNameFromIssueWord(await readTextIfExists(artifactFilePath(sessionPaths, ISSUE_WORD_ARTIFACT)));
  }

  async function writeArtifact(sessionId, relativePath, text) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const artifactPath = artifactFilePath(sessionPaths, relativePath);
      await writeTextFile(artifactPath, text);
      return artifactPath;
    });
  }

  async function readArtifact(sessionId, relativePath) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => {
      return readTextIfExists(artifactFilePath(sessionPaths, relativePath));
    });
  }

  async function deleteArtifact(sessionId, relativePath) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await rm(artifactFilePath(sessionPaths, relativePath), {
        force: true
      });
    });
  }

  async function deleteArtifacts(sessionId, relativePaths = []) {
    await Promise.all(relativePaths.map((relativePath) => deleteArtifact(sessionId, relativePath)));
  }

  async function readArtifactReadiness(sessionId) {
    return withReadableSessionPaths(sessionId, readArtifactReadinessFromPaths);
  }

  async function readArtifactReadinessFromPaths(sessionPaths) {
    const names = await sortedArtifactPaths(sessionPaths.artifactsRoot);
    const entries = await Promise.all(names.map(async (name) => {
      const text = await readTextIfExists(artifactFilePath(sessionPaths, name));
      return [
        name,
        {
          exists: true,
          fingerprint: artifactFingerprint(text),
          nonEmpty: Boolean(normalizeText(text))
        }
      ];
    }));
    return Object.fromEntries(entries);
  }

  async function artifactExists(sessionId, relativePath) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => {
      return pathExists(artifactFilePath(sessionPaths, relativePath));
    });
  }

  async function appendCommandLogEntry(sessionId, entry = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const payload = {
        ...entry,
        at: normalizeText(entry.at) || now().toISOString()
      };
      await mkdir(path.dirname(sessionPaths.commandLogPath), {
        recursive: true
      });
      await writeFile(sessionPaths.commandLogPath, `${JSON.stringify(payload)}\n`, {
        encoding: "utf8",
        flag: "a"
      });
    });
  }

  async function readCommandLog(sessionId) {
    return withReadableSessionPaths(sessionId, readCommandLogFromPaths);
  }

  async function readCommandLogFromPaths(sessionPaths) {
    return (await readTextIfExists(sessionPaths.commandLogPath))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
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
    shouldWrite = null
  } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedTaskId = assertSafeBackgroundTaskId(taskId);
      const previous = await readBackgroundTaskFromPath(sessionPaths, normalizedTaskId) || {
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
        ],
        finishedAt: status === BACKGROUND_TASK_STATUS.RUNNING
          ? ""
          : normalizeText(patch.finishedAt || previous.finishedAt) || eventAt,
        id: normalizedTaskId,
        startedAt: status === BACKGROUND_TASK_STATUS.RUNNING && previousStatus !== BACKGROUND_TASK_STATUS.RUNNING
          ? eventAt
          : normalizeText(patch.startedAt || previous.startedAt) || eventAt,
        status,
        updatedAt: eventAt
      };
      if (status !== BACKGROUND_TASK_STATUS.FAILED && !Object.hasOwn(patch, "error")) {
        record.error = "";
      }
      await writeJsonFile(backgroundTaskFilePath(sessionPaths, normalizedTaskId), record);
      return record;
    });
  }

  async function readCommandLifecycleFromPath(sessionPaths, lifecycleId) {
    const normalizedLifecycleId = assertSafeCommandLifecycleId(lifecycleId);
    const lifecycleText = await readTextIfExists(commandLifecycleFilePath(sessionPaths, normalizedLifecycleId));
    if (!lifecycleText) {
      return null;
    }
    try {
      const record = JSON.parse(lifecycleText);
      return isPlainObject(record)
        ? {
            ...record,
            events: Array.isArray(record.events) ? record.events.filter(isPlainObject) : [],
            id: normalizedLifecycleId,
            phase: normalizeCommandLifecyclePhase(record.phase || record.status),
            status: normalizeCommandLifecyclePhase(record.phase || record.status)
          }
        : null;
    } catch {
      throw vibe64Error(
        `Invalid vibe64 command lifecycle: ${normalizedLifecycleId}`,
        "vibe64_invalid_command_lifecycle"
      );
    }
  }

  async function readCommandLifecycle(sessionId, lifecycleId) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readCommandLifecycleFromPath(sessionPaths, lifecycleId));
  }

  async function readCommandLifecycles(sessionId) {
    return withReadableSessionPaths(sessionId, readCommandLifecyclesFromPaths);
  }

  async function readCommandLifecyclesFromPaths(sessionPaths) {
    const lifecycleNames = sortedFileNames(
      await readDirectoryEntries(sessionPaths.commandLifecyclesRoot),
      (name) => name.endsWith(".json") && isSafeCommandLifecycleId(name.slice(0, -".json".length))
    );
    const lifecycles = await Promise.all(lifecycleNames.map((fileName) => {
      return readCommandLifecycleFromPath(sessionPaths, fileName.slice(0, -".json".length));
    }));
    return lifecycles
      .filter(Boolean)
      .sort((left, right) => {
        const timeComparison = normalizeText(left.updatedAt).localeCompare(normalizeText(right.updatedAt));
        return timeComparison || normalizeText(left.id).localeCompare(normalizeText(right.id));
      });
  }

  async function writeCommandLifecycleEvent(sessionId, lifecycleId, {
    event = {},
    patch = {}
  } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedLifecycleId = assertSafeCommandLifecycleId(lifecycleId);
      const previous = await readCommandLifecycleFromPath(sessionPaths, normalizedLifecycleId) || {
        events: [],
        id: normalizedLifecycleId
      };
      const eventAt = normalizeText(event.at || patch.updatedAt) || now().toISOString();
      const requestedPhase = normalizeCommandLifecyclePhase(
        patch.phase || patch.status || event.phase || event.status
      );
      const phase = latestCommandLifecyclePhase(previous.phase || previous.status, requestedPhase);
      const outcome = normalizeText(patch.outcome || event.outcome || previous.outcome);
      const eventRecord = {
        ...event,
        at: eventAt,
        kind: normalizeText(event.kind || requestedPhase || "updated"),
        outcome,
        phase: requestedPhase || phase,
        status: requestedPhase || phase
      };
      const record = {
        ...previous,
        ...patch,
        events: [
          ...(Array.isArray(previous.events) ? previous.events : []),
          eventRecord
        ],
        finishedAt: normalizeText(patch.finishedAt || previous.finishedAt),
        id: normalizedLifecycleId,
        outcome,
        phase,
        startedAt: normalizeText(previous.startedAt || patch.startedAt) || eventAt,
        status: phase,
        updatedAt: eventAt
      };
      if (phase === "done" || phase === "failed") {
        record.finishedAt = record.finishedAt || eventAt;
      }
      await writeJsonFile(commandLifecycleFilePath(sessionPaths, normalizedLifecycleId), record);
      return record;
    });
  }

  async function readConversationMessage(sessionPaths, turnId, fileName) {
    const match = normalizeText(fileName).match(CONVERSATION_MESSAGE_FILE_PATTERN);
    if (!match) {
      return null;
    }
    return {
      at: isoFromConversationTimestamp(match[2]),
      role: match[1],
      text: normalizeText(await readTextIfExists(path.join(conversationTurnRoot(sessionPaths, turnId), fileName)))
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
    const user = messages.find((message) => message.role === "user") || null;
    const assistant = messages.find((message) => message.role === "assistant") || null;
    const system = messages.find((message) => message.role === "system") || null;
    const thinking = messages.filter((message) => message.role === "thinking");
    return {
      assistant,
      messages: [system, user, ...thinking, assistant].filter(Boolean),
      ...(system ? { system } : {}),
      thinking,
      turnId,
      user
    };
  }

  async function conversationTurnIds(sessionPaths) {
    return sortedDirectoryNames(
      await readDirectoryEntries(sessionPaths.conversationLogRoot),
      (name) => CONVERSATION_TURN_ID_PATTERN.test(name)
    );
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
    if (turn.system || turn.user || turn.assistant || !turn.thinking.length) {
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
    return turns.filter((turn) => turn.system || turn.user || turn.assistant || turn.thinking.length);
  }

  async function readConversationLogPage(sessionId, options = {}) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readConversationLogPageFromPaths(sessionPaths, options));
  }

  async function readConversationLogPageFromPaths(sessionPaths, options = {}) {
    const turnIds = await conversationTurnIds(sessionPaths);
    const page = conversationLogPageTurnIds(turnIds, options);
    const turns = await Promise.all(page.turnIds.map((turnId) => readConversationTurn(sessionPaths, turnId)));
    const conversationLog = turns.filter((turn) => turn.system || turn.user || turn.assistant || turn.thinking.length);
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

  async function writeConversationUserMessage(sessionId, {
    text = ""
  } = {}) {
    const messageText = normalizeText(text);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      const turnId = nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      await writeTextFile(
        path.join(conversationTurnRoot(sessionPaths, turnId), conversationMessageFileName("user", createdAt)),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function writeConversationAssistantMessage(sessionId, {
    text = ""
  } = {}) {
    const messageText = normalizeText(text);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      const turnId = await tailOpenConversationTurnId(sessionPaths) ||
        nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      await writeTextFile(
        path.join(conversationTurnRoot(sessionPaths, turnId), conversationMessageFileName("assistant", createdAt)),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function writeConversationThinkingMessage(sessionId, {
    at = "",
    requireOpenTurn = false,
    text = ""
  } = {}) {
    const messageText = normalizeText(text);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      const createdAt = at ? toDate(at) : now();
      const openTurnId = await tailOpenConversationTurnId(sessionPaths);
      if (requireOpenTurn && !openTurnId) {
        return null;
      }
      const thinkingOnlyTurnId = openTurnId ? "" : await tailThinkingOnlyConversationTurnId(sessionPaths, {
        messageAt: at ? createdAt.toISOString() : ""
      });
      const turnId = openTurnId || thinkingOnlyTurnId || nextConversationTurnId(await conversationTurnIds(sessionPaths));
      await writeTextFile(
        path.join(conversationTurnRoot(sessionPaths, turnId), conversationMessageFileName("thinking", createdAt)),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function writeConversationSystemMessage(sessionId, {
    text = ""
  } = {}) {
    const messageText = normalizeText(text);
    if (!messageText) {
      return null;
    }
    return mutateSession(sessionId, async (sessionPaths) => {
      const turnId = nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      await writeTextFile(
        path.join(conversationTurnRoot(sessionPaths, turnId), conversationMessageFileName("system", createdAt)),
        `${messageText}\n`
      );
      return readConversationTurn(sessionPaths, turnId);
    });
  }

  async function actionAttemptFileNames(sessionPaths) {
    return sortedFileNames(
      await readDirectoryEntries(sessionPaths.actionAttemptsRoot),
      (name) => ACTION_ATTEMPT_FILE_PATTERN.test(name)
    );
  }

  async function privateInputFileNames(sessionPaths) {
    return sortedFileNames(
      await readDirectoryEntries(sessionPaths.privateInputsRoot),
      (name) => PRIVATE_INPUT_FILE_PATTERN.test(name)
    );
  }

  function nextActionAttemptFileName(existingFileNames = [], actionId = "") {
    const nextNumber = existingFileNames
      .map((fileName) => ACTION_ATTEMPT_FILE_PATTERN.exec(fileName))
      .filter(Boolean)
      .map((match) => Number.parseInt(match[1], 10))
      .filter((number) => Number.isSafeInteger(number) && number > 0)
      .sort((left, right) => left - right)
      .at(-1) || 0;
    return `${String(nextNumber + 1).padStart(6, "0")}-${assertSafeActionId(actionId)}.json`;
  }

  function nextPrivateInputFileName(existingFileNames = [], ownerId = "") {
    const nextNumber = existingFileNames
      .map((fileName) => PRIVATE_INPUT_FILE_PATTERN.exec(fileName))
      .filter(Boolean)
      .map((match) => Number.parseInt(match[1], 10))
      .filter((number) => Number.isSafeInteger(number) && number > 0)
      .sort((left, right) => left - right)
      .at(-1) || 0;
    return `${String(nextNumber + 1).padStart(6, "0")}-${assertSafePrivateInputOwnerId(ownerId)}.json`;
  }

  async function writePrivateInput(sessionId, ownerId, input = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedOwnerId = assertSafePrivateInputOwnerId(ownerId);
      const fileName = nextPrivateInputFileName(
        await privateInputFileNames(sessionPaths),
        normalizedOwnerId
      );
      const record = {
        fields: Array.isArray(input.fields) ? input.fields : [],
        owner: isPlainObject(input.owner) ? input.owner : {
          id: normalizedOwnerId
        },
        schemaVersion: PRIVATE_INPUT_SCHEMA_VERSION,
        sessionId: sessionPaths.sessionId,
        stepId: normalizeText(input.stepId),
        stepStatus: normalizeText(input.stepStatus),
        values: isPlainObject(input.values) ? input.values : {},
        writtenAt: now().toISOString()
      };
      const filePath = privateInputFilePath(sessionPaths, fileName);
      await writePrivateJsonFile(filePath, record);
      return {
        fields: record.fields,
        fileName,
        path: filePath,
        relativePath: `private-inputs/${fileName}`,
        schemaVersion: PRIVATE_INPUT_SCHEMA_VERSION,
        writtenAt: record.writtenAt
      };
    });
  }

  async function writeActionResult(sessionId, actionId, result = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedActionId = assertSafeActionId(actionId);
      const attemptFileName = nextActionAttemptFileName(
        await actionAttemptFileNames(sessionPaths),
        normalizedActionId
      );
      const attemptNumber = Number.parseInt(attemptFileName.slice(0, 6), 10);
      const codexPromptHandoff = result.codexPromptHandoff &&
        typeof result.codexPromptHandoff === "object" &&
        !Array.isArray(result.codexPromptHandoff)
        ? {
            ...result.codexPromptHandoff,
            actionId: normalizedActionId,
            attemptFile: attemptFileName,
            attemptNumber,
            handoffId: `${attemptFileName}:${String(result.codexPromptHandoff.promptId || normalizedActionId).trim() || normalizedActionId}`
          }
        : result.codexPromptHandoff;
      const record = {
        ...result,
        ...(codexPromptHandoff ? { codexPromptHandoff } : {}),
        actionId: normalizedActionId,
        attemptFile: attemptFileName,
        attemptNumber,
        at: normalizeText(result.at) || now().toISOString()
      };
      await writeJsonFile(actionAttemptFilePath(sessionPaths, attemptFileName), record);
      await writeJsonFile(actionResultFilePath(sessionPaths, normalizedActionId), record);
      return record;
    });
  }

  async function readActionResult(sessionId, actionId) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readActionResultFromPaths(sessionPaths, actionId));
  }

  async function readActionResultFromPaths(sessionPaths, actionId) {
    const normalizedActionId = assertSafeActionId(actionId);
    const actionText = await readTextIfExists(actionResultFilePath(sessionPaths, normalizedActionId));
    if (!actionText) {
      return null;
    }
    try {
      return JSON.parse(actionText);
    } catch {
      throw vibe64Error(`Invalid vibe64 action result: ${normalizedActionId}`, "vibe64_invalid_action_result");
    }
  }

  async function deleteActionResult(sessionId, actionId) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await rm(actionResultFilePath(sessionPaths, actionId), {
        force: true
      });
    });
  }

  async function deleteActionResults(sessionId, actionIds = []) {
    await Promise.all(actionIds.map((actionId) => deleteActionResult(sessionId, actionId)));
  }

  async function readActionResults(sessionId) {
    return withReadableSessionPaths(sessionId, readActionResultsFromPaths);
  }

  async function readActionResultsFromPaths(sessionPaths) {
    const actionNames = sortedFileNames(await readDirectoryEntries(sessionPaths.actionsRoot), isSafeActionId);
    const actionResults = await Promise.all(actionNames.map((actionName) => readActionResultFromPaths(sessionPaths, actionName)));
    return actionResults.filter(Boolean);
  }

  async function readActionAttempt(sessionPaths, fileName) {
    const attemptText = await readTextIfExists(actionAttemptFilePath(sessionPaths, fileName));
    if (!attemptText) {
      return null;
    }
    try {
      return JSON.parse(attemptText);
    } catch {
      throw vibe64Error(`Invalid vibe64 action attempt: ${fileName}`, "vibe64_invalid_action_attempt");
    }
  }

  async function readActionAttempts(sessionId) {
    return withReadableSessionPaths(sessionId, readActionAttemptsFromPaths);
  }

  async function readActionAttemptsFromPaths(sessionPaths) {
    const fileNames = await actionAttemptFileNames(sessionPaths);
    const attempts = await Promise.all(fileNames.map((fileName) => readActionAttempt(sessionPaths, fileName)));
    return attempts.filter(Boolean);
  }

  async function writePromptContextSnapshot(sessionId, snapshot = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const record = normalizePromptContextSnapshot(snapshot);
      if (!record) {
        throw vibe64Error(
          "Invalid vibe64 prompt context snapshot.",
          "vibe64_invalid_prompt_context_snapshot"
        );
      }
      await writeJsonFile(sessionPaths.promptContextSnapshotPath, record);
      return record;
    });
  }

  async function readPromptContextSnapshot(sessionId) {
    return withReadableSessionPaths(sessionId, readPromptContextSnapshotFromPaths);
  }

  async function readPromptContextSnapshotFromPaths(sessionPaths) {
    const snapshotText = await readTextIfExists(sessionPaths.promptContextSnapshotPath);
    if (!snapshotText) {
      return null;
    }
    try {
      const snapshot = normalizePromptContextSnapshot(JSON.parse(snapshotText));
      if (!snapshot) {
        throw new Error("Invalid prompt context snapshot.");
      }
      return snapshot;
    } catch {
      throw vibe64Error(
        `Invalid vibe64 prompt context snapshot: ${sessionPaths.sessionId}`,
        "vibe64_invalid_prompt_context_snapshot"
      );
    }
  }

  async function deletePromptContextSnapshot(sessionId) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await rm(sessionPaths.promptContextSnapshotPath, {
        force: true
      });
    });
  }

  async function writeCompletedStep(sessionId, stepId, {
    message = ""
  } = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedStepId = assertSafeStepId(stepId);
      const record = {
        at: now().toISOString(),
        message: normalizeText(message),
        stepId: normalizedStepId
      };
      await writeJsonFile(completedStepFilePath(sessionPaths, normalizedStepId), record);
      return record;
    });
  }

  async function readCompletedSteps(sessionId) {
    return withReadableSessionPaths(sessionId, readCompletedStepsFromPaths);
  }

  async function readCompletedStepsFromPaths(sessionPaths) {
    return sortedFileNames(await readDirectoryEntries(sessionPaths.stepsRoot), isSafeStepId);
  }

  async function deleteCompletedStep(sessionId, stepId) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await rm(completedStepFilePath(sessionPaths, stepId), {
        force: true
      });
    });
  }

  async function deleteCompletedSteps(sessionId, stepIds = []) {
    await Promise.all(stepIds.map((stepId) => deleteCompletedStep(sessionId, stepId)));
  }

  async function readStepState(sessionId, stepId) {
    return withReadableSessionPaths(sessionId, (sessionPaths) => readStepStateFromPaths(sessionPaths, stepId));
  }

  async function readStepStateFromPaths(sessionPaths, stepId) {
    const stateText = await readTextIfExists(stepStateFilePath(sessionPaths, stepId));
    if (!stateText) {
      return null;
    }
    try {
      const state = JSON.parse(stateText);
      return isPlainObject(state) ? state : null;
    } catch {
      throw vibe64Error(`Invalid vibe64 step state: ${assertSafeStepId(stepId)}`, "vibe64_invalid_step_state");
    }
  }

  async function writeStepState(sessionId, stepId, state = {}) {
    return mutateSession(sessionId, async (sessionPaths) => {
      const normalizedStepId = assertSafeStepId(stepId);
      const record = {
        ...state,
        at: normalizeText(state.at) || now().toISOString(),
        stepId: normalizedStepId
      };
      await writeJsonFile(stepStateFilePath(sessionPaths, normalizedStepId), record);
      return record;
    });
  }

  async function deleteStepState(sessionId, stepId) {
    return mutateSession(sessionId, async (sessionPaths) => {
      await rm(stepStateFilePath(sessionPaths, stepId), {
        force: true
      });
    });
  }

  async function deleteStepStates(sessionId, stepIds = []) {
    await Promise.all(stepIds.map((stepId) => deleteStepState(sessionId, stepId)));
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
    return withReadableSessionPaths(sessionId, readSessionFromPaths);
  }

  async function readSessionFromPaths(sessionPaths, archiveRecord = null) {
    const [
      manifest,
      status,
      currentStep,
      metadata,
      completedSteps,
      artifactReadiness,
      actionResults,
      actionAttempts,
      agentRuns,
      backgroundTasks,
      commandLifecycles,
      promptContextSnapshot
    ] = await Promise.all([
      readManifestFromPaths(sessionPaths),
      readStatusFromPaths(sessionPaths),
      readCurrentStepFromPaths(sessionPaths),
      readMetadataFromPaths(sessionPaths),
      readCompletedStepsFromPaths(sessionPaths),
      readArtifactReadinessFromPaths(sessionPaths),
      readActionResultsFromPaths(sessionPaths),
      readActionAttemptsFromPaths(sessionPaths),
      readAgentRunsFromPaths(sessionPaths),
      readBackgroundTasksFromPaths(sessionPaths),
      readCommandLifecyclesFromPaths(sessionPaths),
      readPromptContextSnapshotFromPaths(sessionPaths)
    ]);
    const archived = Boolean(archiveRecord);
    const sessionName = await sessionNameForSession(sessionPaths, metadata);
    const reportReady = artifactReadiness[REPORT_ARTIFACT]?.nonEmpty === true;
    const currentCommandLifecycle = commandLifecycles
      .filter((lifecycle) => {
        return normalizeText(lifecycle.stepId) === currentStep &&
          stepRevisionNumber(lifecycle.stepRevision) === stepRevisionNumber(manifest.stepRevision);
      })
      .at(-1) || null;
    return {
      actionResults,
      actionAttempts,
      actionAttemptsRoot: archived ? "" : sessionPaths.actionAttemptsRoot,
      actionsRoot: archived ? "" : sessionPaths.actionsRoot,
      agentRuns,
      agentRunsRoot: archived ? "" : sessionPaths.agentRunsRoot,
      artifactReadiness,
      artifactsRoot: archived ? "" : sessionPaths.artifactsRoot,
      backgroundTasks,
      backgroundTasksRoot: archived ? "" : sessionPaths.backgroundTasksRoot,
      commandLifecycles,
      commandLifecyclesRoot: archived ? "" : sessionPaths.commandLifecyclesRoot,
      currentCommandLifecycle,
      commandLogPath: archived ? "" : sessionPaths.commandLogPath,
      completedSteps,
      conversationLogRoot: archived ? "" : sessionPaths.conversationLogRoot,
      currentStep,
      manifest,
      metadata,
      metadataRoot: archived ? "" : sessionPaths.metadataRoot,
      privateInputsRoot: archived ? "" : sessionPaths.privateInputsRoot,
      promptContextSnapshot,
      promptContextSnapshotPath: archived ? "" : sessionPaths.promptContextSnapshotPath,
      reportPath: !archived && reportReady ? artifactFilePath(sessionPaths, REPORT_ARTIFACT) : "",
      revision: revisionNumber(manifest.revision),
      sessionId: sessionPaths.sessionId,
      sessionName,
      sessionRoot: archived ? "" : sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      stepRevision: stepRevisionNumber(manifest.stepRevision),
      stepStatesRoot: archived ? "" : sessionPaths.stepStatesRoot,
      stepsRoot: archived ? "" : sessionPaths.stepsRoot,
      targetRoot: sessionPaths.targetRoot,
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
    const activePaths = paths(sessionId);
    if (await pathExists(activePaths.manifestPath)) {
      return readSessionSummaryFromPaths(activePaths);
    }
    const archiveRecord = await readClosedArchiveRecord(sessionId);
    if (archiveRecord) {
      return closedArchiveSummary(archiveRecord);
    }
    throw vibe64Error(`Unknown vibe64 session: ${activePaths.sessionId}`, "vibe64_session_not_found");
  }

  async function readSessionSummaryFromPaths(sessionPaths) {
    const [
      manifest,
      status,
      currentStep,
      metadata,
      completedSteps
    ] = await Promise.all([
      readManifestFromPaths(sessionPaths),
      readStatusFromPaths(sessionPaths),
      readCurrentStepFromPaths(sessionPaths),
      readMetadataFromPaths(sessionPaths),
      readCompletedStepsFromPaths(sessionPaths)
    ]);
    const stepMachine = currentStep
      ? await readStepStateFromPaths(sessionPaths, currentStep)
      : null;
    const sessionName = await sessionNameForSession(sessionPaths, metadata);
    return {
      completedStepCount: completedSteps.length,
      completedSteps,
      createdAt: normalizeText(manifest.createdAt),
      currentStep,
      manifest: {
        createdAt: normalizeText(manifest.createdAt),
        revision: revisionNumber(manifest.revision),
        stepRevision: stepRevisionNumber(manifest.stepRevision),
        updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
      },
      metadata,
      revision: revisionNumber(manifest.revision),
      sessionId: sessionPaths.sessionId,
      sessionName,
      sessionRoot: sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      stepMachine,
      stepRevision: stepRevisionNumber(manifest.stepRevision),
      targetRoot: sessionPaths.targetRoot,
      updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
    };
  }

  async function validateClosedSessionArchive(archivePath) {
    const result = await runCommand("tar", [
      "-tzf",
      archivePath
    ]);
    if (!result.ok) {
      throw vibe64Error(
        `Invalid closed Vibe64 session archive ${archivePath}: ${result.output}`,
        "vibe64_closed_session_archive_invalid"
      );
    }
  }

  async function compactClosedSession(sessionId) {
    const rootPaths = paths();
    const sessionPaths = await ensureActiveSessionRoot(sessionId);
    const status = await readStatusFromPaths(sessionPaths);
    if (!CLOSED_VIBE64_SESSION_STATUSES.has(status)) {
      throw vibe64Error(
        `Cannot compact open Vibe64 session ${sessionPaths.sessionId} with status ${status}.`,
        "vibe64_session_compact_open_status"
      );
    }

    const finalArchivePath = closedSessionArchivePath(rootPaths, status, sessionPaths.sessionId);
    const finalMetadataPath = closedSessionMetadataPath(rootPaths, status, sessionPaths.sessionId);
    const finalArchiveExists = await pathExists(finalArchivePath);
    const finalMetadataExists = await pathExists(finalMetadataPath);
    if (finalArchiveExists || finalMetadataExists) {
      if (finalArchiveExists && finalMetadataExists) {
        await validateClosedSessionArchive(finalArchivePath);
        await rm(sessionPaths.sessionRoot, {
          force: true,
          recursive: true
        });
        return readClosedArchiveRecordForStatus(rootPaths, status, sessionPaths.sessionId);
      }
      throw vibe64Error(
        `Closed Vibe64 session archive is incomplete for ${sessionPaths.sessionId}.`,
        "vibe64_closed_session_archive_incomplete"
      );
    }

    const stagedRoot = path.join(closedSessionStagingRoot(rootPaths), `${sessionPaths.sessionId}-${randomUUID()}`);
    const stagedArchivePath = path.join(stagedRoot, `${sessionPaths.sessionId}.tar.gz`);
    const stagedMetadataPath = path.join(stagedRoot, `${sessionPaths.sessionId}.json`);
    const archivedAt = now().toISOString();
    const summary = await readSessionSummaryFromPaths(sessionPaths);
    const metadataRecord = closedArchiveMetadataRecord({
      archivePath: finalArchivePath,
      archivedAt,
      metadataPath: finalMetadataPath,
      sessionId: sessionPaths.sessionId,
      status,
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
        rootPaths.activeSessionsRoot,
        sessionPaths.sessionId
      ]);
      if (!tarResult.ok) {
        throw vibe64Error(
          `Cannot compact Vibe64 session ${sessionPaths.sessionId}: ${tarResult.output}`,
          "vibe64_closed_session_archive_write_failed"
        );
      }
      await validateClosedSessionArchive(stagedArchivePath);
      await writeJsonFile(stagedMetadataPath, metadataRecord);
      await mkdir(path.dirname(finalArchivePath), {
        recursive: true
      });
      await rename(stagedArchivePath, finalArchivePath);
      archiveFinalized = true;
      await rename(stagedMetadataPath, finalMetadataPath);
      metadataFinalized = true;
      await rm(sessionPaths.sessionRoot, {
        force: true,
        recursive: true
      });
      return readClosedArchiveRecordForStatus(rootPaths, status, sessionPaths.sessionId);
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

  async function createSession({
    initialStep = VIBE64_INITIAL_STEP,
    metadata = {},
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
    if (await sessionRecordExists(rootPaths, resolvedSessionId)) {
      throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
    }
    try {
      await mkdir(sessionPaths.sessionRoot);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw vibe64Error(`Vibe64 session already exists: ${resolvedSessionId}`, "vibe64_session_exists");
      }
      throw error;
    }
    await Promise.all([
      mkdir(sessionPaths.actionsRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.actionAttemptsRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.agentRunsRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.artifactsRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.backgroundTasksRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.commandLifecyclesRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.metadataRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.privateInputsRoot, {
        mode: 0o700,
        recursive: true
      }),
      mkdir(sessionPaths.stepStatesRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.stepsRoot, {
        recursive: true
      })
    ]);
    const manifest = {
      createdAt,
      product: "vibe64",
      revision: 1,
      schemaVersion: VIBE64_SESSION_SCHEMA_VERSION,
      sessionId: resolvedSessionId,
      stepRevision: 1,
      targetRoot: sessionPaths.targetRoot,
      updatedAt: createdAt
    };
    await Promise.all([
      writeJsonFile(sessionPaths.manifestPath, manifest),
      writeTextFile(sessionPaths.currentStepPath, `${normalizeText(initialStep) || VIBE64_INITIAL_STEP}\n`),
      writeTextFile(sessionPaths.statusPath, `${normalizedStatus}\n`),
      ...Object.entries(normalizedMetadata).map(([name, value]) => {
        return writeTextFile(metadataFilePath(sessionPaths, name), `${value}\n`);
      })
    ]);
    return readSession(resolvedSessionId);
  }

  async function listSessions(options = {}) {
    const rootPaths = paths();
    const activeSessionIds = sortedDirectoryNames(
      await readDirectoryEntries(rootPaths.activeSessionsRoot),
      isValidVibe64SessionId
    );
    const listOptions = normalizeSessionListOptions(options);
    const activeSessionRecords = listOptions.statusGroup || listOptions.statuses.size > 0
      ? (await Promise.all(activeSessionIds.map(async (entrySessionId) => ({
        sessionId: entrySessionId,
        status: await readStatus(entrySessionId)
      })))).filter(({ status }) => sessionStatusMatchesListOptions(status, listOptions))
      : activeSessionIds.map((sessionId) => ({
        sessionId,
        status: ""
      }));
    const activeSessionIdSet = new Set(activeSessionIds);
    const closedSessionRecords = (await readClosedArchiveRecords())
      .filter((record) => !activeSessionIdSet.has(record.sessionId))
      .filter((record) => sessionStatusMatchesListOptions(record.status, listOptions));
    const sessionIds = [
      ...activeSessionRecords.map((record) => record.sessionId),
      ...closedSessionRecords.map((record) => record.sessionId)
    ].sort((left, right) => left.localeCompare(right));
    return Promise.all(sessionIds.map((entrySessionId) => readSession(entrySessionId)));
  }

  async function listSessionSummaries(options = {}) {
    const rootPaths = paths();
    const activeSessionIds = sortedDirectoryNames(
      await readDirectoryEntries(rootPaths.activeSessionsRoot),
      isValidVibe64SessionId
    );
    const listOptions = normalizeSessionListOptions(options);
    const activeSessionRecords = listOptions.statusGroup || listOptions.statuses.size > 0
      ? (await Promise.all(activeSessionIds.map(async (entrySessionId) => ({
        sessionId: entrySessionId,
        status: await readStatus(entrySessionId)
      })))).filter(({ status }) => sessionStatusMatchesListOptions(status, listOptions))
      : activeSessionIds.map((sessionId) => ({
        sessionId,
        status: ""
      }));
    const activeSessionIdSet = new Set(activeSessionIds);
    const activeSummaries = await Promise.all(activeSessionRecords.map((record) => readSessionSummary(record.sessionId)));
    const closedSummaries = (await readClosedArchiveRecords())
      .filter((record) => !activeSessionIdSet.has(record.sessionId))
      .map(closedArchiveSummary)
      .filter((summary) => sessionStatusMatchesListOptions(summary.status, listOptions));
    return [
      ...activeSummaries,
      ...closedSummaries
    ].sort((left, right) => normalizeText(left.sessionId).localeCompare(normalizeText(right.sessionId)));
  }

  return {
    appendCommandLogEntry,
    artifactExists,
    createSession,
    compactClosedSession,
    deleteActionResult,
    deleteActionResults,
    deleteArtifact,
    deleteArtifacts,
    deleteCompletedStep,
    deleteCompletedSteps,
    deleteMetadataValue,
    deleteMetadataValues,
    deletePromptContextSnapshot,
    deleteStepState,
    deleteStepStates,
    listSessions,
    listSessionSummaries,
    mutateSession,
    paths,
    readArtifact,
    readArtifactReadiness,
    readActionAttempts,
    readActionResult,
    readActionResults,
    readAgentRun,
    readAgentRuns,
    readBackgroundTask,
    readBackgroundTasks,
    readCommandLifecycle,
    readCommandLifecycles,
    readCommandLog,
    readCompletedSteps,
    readConversationLog,
    readConversationLogPage,
    readCurrentStep,
    readManifest,
    readMetadata,
    readMetadataValue,
    readPromptContextSnapshot,
    readSession,
    readSessionSummary,
    readStatus,
    readStepState,
    writeArtifact,
    writeAgentRunEvent,
    writeBackgroundTaskEvent,
    writeCommandLifecycleEvent,
    writeActionResult,
    writeCompletedStep,
    writeConversationAssistantMessage,
    writeConversationSystemMessage,
    writeConversationThinkingMessage,
    writeConversationUserMessage,
    writeCurrentStep,
    writeIssueWordMetadata,
    writeMetadataValue,
    writePrivateInput,
    writePromptContextSnapshot,
    writeSessionLabel,
    writeStepState,
    writeStatus
  };
}

export {
  VIBE64_INITIAL_STEP,
  PRIVATE_INPUT_SCHEMA_VERSION,
  VIBE64_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
  VIBE64_AGENT_RUN_STATE,
  VIBE64_SESSION_SCHEMA_VERSION,
  VIBE64_SESSION_STATUS,
  VIBE64_STATE_DIR,
  assertVibe64SessionStatus,
  assertSafeActionId,
  assertSafeStepId,
  assertValidVibe64SessionId,
  createVibe64SessionStore,
  isSafeActionId,
  isSafeStepId,
  isValidVibe64SessionId,
  normalizeVibe64AgentRunState,
  resolveVibe64SessionPaths,
  vibe64AgentRunStateIsActive,
  vibe64AgentRunStateIsTerminal
};
