import { AsyncLocalStorage } from "node:async_hooks";
import { createHash } from "node:crypto";
import { mkdir, readdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
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
import { deepFreeze } from "@local/vibe64-core/server/deepFreeze";

const VIBE64_SESSION_SCHEMA_VERSION = 1;
const VIBE64_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION = 1;
const VIBE64_INITIAL_STEP = "session_created";
const ISSUE_WORD_ARTIFACT = "issue_word";
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
const ACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const ACTION_ATTEMPT_FILE_PATTERN = /^(\d{6})-([A-Za-z0-9][A-Za-z0-9_-]{0,127})\.json$/u;
const ARTIFACT_PATH_SEGMENT_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const BACKGROUND_TASK_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const COMMAND_LIFECYCLE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,191}$/u;
const CONVERSATION_MESSAGE_FILE_PATTERN = /^(user|assistant|system)\.(\d{8}T\d{9}Z)\.md$/u;
const CONVERSATION_TURN_ID_PATTERN = /^\d{6}$/u;
const METADATA_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
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
const sessionMutationChains = new Map();
const sessionMutationContext = new AsyncLocalStorage();

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
  await writeTextFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
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

function resolveVibe64SessionPaths({
  sessionId = "",
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = normalizeTargetRoot(targetRoot);
  const stateRoot = path.join(normalizedTargetRoot, VIBE64_STATE_DIR);
  const sessionsRoot = path.join(stateRoot, "sessions");
  const activeSessionsRoot = path.join(sessionsRoot, "active");
  const normalizedSessionId = normalizeText(sessionId);
  const sessionRoot = normalizedSessionId ? path.join(activeSessionsRoot, assertValidVibe64SessionId(normalizedSessionId)) : "";
  return {
    actionsRoot: sessionRoot ? path.join(sessionRoot, "actions") : "",
    actionAttemptsRoot: sessionRoot ? path.join(sessionRoot, "action-attempts") : "",
    activeSessionsRoot,
    artifactsRoot: sessionRoot ? path.join(sessionRoot, "artifacts") : "",
    backgroundTasksRoot: sessionRoot ? path.join(sessionRoot, "background-tasks") : "",
    commandLifecyclesRoot: sessionRoot ? path.join(sessionRoot, "command-lifecycle") : "",
    commandLogPath: sessionRoot ? path.join(sessionRoot, "command-log.jsonl") : "",
    conversationLogRoot: sessionRoot ? path.join(sessionRoot, "conversation-log") : "",
    currentStepPath: sessionRoot ? path.join(sessionRoot, "current_step") : "",
    manifestPath: sessionRoot ? path.join(sessionRoot, "session.json") : "",
    metadataRoot: sessionRoot ? path.join(sessionRoot, "metadata") : "",
    promptContextSnapshotPath: sessionRoot ? path.join(sessionRoot, "prompt-context.json") : "",
    sessionId: normalizedSessionId,
    sessionRoot,
    sessionsRoot,
    stateRoot,
    statusPath: sessionRoot ? path.join(sessionRoot, "status") : "",
    stepStatesRoot: sessionRoot ? path.join(sessionRoot, "step-state") : "",
    stepsRoot: sessionRoot ? path.join(sessionRoot, "steps") : "",
    targetRoot: normalizedTargetRoot
  };
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
    if (!await pathExists(path.join(rootPaths.activeSessionsRoot, sessionId))) {
      return sessionId;
    }
  }
  throw vibe64Error("Unable to allocate an vibe64 session id.", "vibe64_session_id_exhausted");
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
  if (!["assistant", "system", "user"].includes(normalizedRole)) {
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
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = normalizeTargetRoot(targetRoot);
  const now = createClockNow(clock);

  function paths(sessionId = "") {
    return resolveVibe64SessionPaths({
      sessionId,
      targetRoot: normalizedTargetRoot
    });
  }

  async function ensureSessionRoot(sessionId) {
    const sessionPaths = paths(sessionId);
    if (!await pathExists(sessionPaths.manifestPath)) {
      throw vibe64Error(`Unknown vibe64 session: ${sessionPaths.sessionId}`, "vibe64_session_not_found");
    }
    return sessionPaths;
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
    const manifest = await readManifest(sessionPaths.sessionId);
    const nextManifest = {
      ...manifest,
      stepRevision: stepRevisionNumber(manifest.stepRevision) + 1
    };
    await writeJsonFile(sessionPaths.manifestPath, nextManifest);
    return nextManifest;
  }

  async function mutateSession(sessionId, operation) {
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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

  async function readMetadataValue(sessionId, name) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    return normalizeText(await readTextIfExists(metadataFilePath(sessionPaths, name)));
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    const sessionPaths = await ensureSessionRoot(sessionId);
    return await readTextIfExists(artifactFilePath(sessionPaths, relativePath));
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    const sessionPaths = await ensureSessionRoot(sessionId);
    return pathExists(artifactFilePath(sessionPaths, relativePath));
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
    const sessionPaths = await ensureSessionRoot(sessionId);
    return (await readTextIfExists(sessionPaths.commandLogPath))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
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
    const sessionPaths = await ensureSessionRoot(sessionId);
    return readBackgroundTaskFromPath(sessionPaths, taskId);
  }

  async function readBackgroundTasks(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    patch = {}
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
    const sessionPaths = await ensureSessionRoot(sessionId);
    return readCommandLifecycleFromPath(sessionPaths, lifecycleId);
  }

  async function readCommandLifecycles(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    return {
      assistant,
      messages: [system, user, assistant].filter(Boolean),
      ...(system ? { system } : {}),
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

  async function latestOpenConversationTurnId(sessionPaths) {
    const turnIds = await conversationTurnIds(sessionPaths);
    for (const turnId of [...turnIds].reverse()) {
      const turn = await readConversationTurn(sessionPaths, turnId);
      if (turn.user && !turn.assistant) {
        return turnId;
      }
    }
    return "";
  }

  async function readConversationLog(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const turnIds = await conversationTurnIds(sessionPaths);
    const turns = await Promise.all(turnIds.map((turnId) => readConversationTurn(sessionPaths, turnId)));
    return turns.filter((turn) => turn.system || turn.user || turn.assistant);
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
      const turnId = await latestOpenConversationTurnId(sessionPaths) ||
        nextConversationTurnId(await conversationTurnIds(sessionPaths));
      const createdAt = now();
      await writeTextFile(
        path.join(conversationTurnRoot(sessionPaths, turnId), conversationMessageFileName("assistant", createdAt)),
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    const sessionPaths = await ensureSessionRoot(sessionId);
    const actionNames = sortedFileNames(await readDirectoryEntries(sessionPaths.actionsRoot), isSafeActionId);
    const actionResults = await Promise.all(actionNames.map((actionName) => readActionResult(sessionId, actionName)));
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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
    const sessionPaths = await ensureSessionRoot(sessionId);
    const manifestText = await readTextIfExists(sessionPaths.manifestPath);
    try {
      return normalizeManifest(JSON.parse(manifestText));
    } catch {
      throw vibe64Error(`Invalid vibe64 session manifest: ${sessionPaths.sessionId}`, "vibe64_invalid_manifest");
    }
  }

  async function readSession(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const [
      manifest,
      status,
      currentStep,
      metadata,
      completedSteps,
      artifactReadiness,
      actionResults,
      actionAttempts,
      backgroundTasks,
      commandLifecycles,
      promptContextSnapshot
    ] = await Promise.all([
      readManifest(sessionPaths.sessionId),
      readStatus(sessionPaths.sessionId),
      readCurrentStep(sessionPaths.sessionId),
      readMetadata(sessionPaths.sessionId),
      readCompletedSteps(sessionPaths.sessionId),
      readArtifactReadiness(sessionPaths.sessionId),
      readActionResults(sessionPaths.sessionId),
      readActionAttempts(sessionPaths.sessionId),
      readBackgroundTasks(sessionPaths.sessionId),
      readCommandLifecycles(sessionPaths.sessionId),
      readPromptContextSnapshot(sessionPaths.sessionId)
    ]);
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
      actionAttemptsRoot: sessionPaths.actionAttemptsRoot,
      actionsRoot: sessionPaths.actionsRoot,
      artifactReadiness,
      artifactsRoot: sessionPaths.artifactsRoot,
      backgroundTasks,
      backgroundTasksRoot: sessionPaths.backgroundTasksRoot,
      commandLifecycles,
      commandLifecyclesRoot: sessionPaths.commandLifecyclesRoot,
      currentCommandLifecycle,
      commandLogPath: sessionPaths.commandLogPath,
      completedSteps,
      conversationLogRoot: sessionPaths.conversationLogRoot,
      currentStep,
      manifest,
      metadata,
      metadataRoot: sessionPaths.metadataRoot,
      promptContextSnapshot,
      promptContextSnapshotPath: sessionPaths.promptContextSnapshotPath,
      reportPath: reportReady ? artifactFilePath(sessionPaths, REPORT_ARTIFACT) : "",
      revision: revisionNumber(manifest.revision),
      sessionId: sessionPaths.sessionId,
      sessionName,
      sessionRoot: sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      stepRevision: stepRevisionNumber(manifest.stepRevision),
      stepStatesRoot: sessionPaths.stepStatesRoot,
      stepsRoot: sessionPaths.stepsRoot,
      targetRoot: sessionPaths.targetRoot,
      updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
    };
  }

  async function readSessionSummary(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const [
      manifest,
      status,
      currentStep,
      metadata,
      completedSteps
    ] = await Promise.all([
      readManifest(sessionPaths.sessionId),
      readStatus(sessionPaths.sessionId),
      readCurrentStep(sessionPaths.sessionId),
      readMetadata(sessionPaths.sessionId),
      readCompletedSteps(sessionPaths.sessionId)
    ]);
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
      status,
      stepRevision: stepRevisionNumber(manifest.stepRevision),
      targetRoot: sessionPaths.targetRoot,
      updatedAt: normalizeText(manifest.updatedAt || manifest.createdAt)
    };
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
    const sessionIds = sortedDirectoryNames(
      await readDirectoryEntries(rootPaths.activeSessionsRoot),
      isValidVibe64SessionId
    );
    const listOptions = normalizeSessionListOptions(options);
    const filteredSessionIds = listOptions.statusGroup || listOptions.statuses.size > 0
      ? (await Promise.all(sessionIds.map(async (entrySessionId) => ({
        sessionId: entrySessionId,
        status: await readStatus(entrySessionId)
      })))).filter(({ status }) => sessionStatusMatchesListOptions(status, listOptions))
        .map(({ sessionId }) => sessionId)
      : sessionIds;
    return Promise.all(filteredSessionIds.map((entrySessionId) => readSession(entrySessionId)));
  }

  async function listSessionSummaries(options = {}) {
    const rootPaths = paths();
    const sessionIds = sortedDirectoryNames(
      await readDirectoryEntries(rootPaths.activeSessionsRoot),
      isValidVibe64SessionId
    );
    const listOptions = normalizeSessionListOptions(options);
    const filteredSessionIds = listOptions.statusGroup || listOptions.statuses.size > 0
      ? (await Promise.all(sessionIds.map(async (entrySessionId) => ({
        sessionId: entrySessionId,
        status: await readStatus(entrySessionId)
      })))).filter(({ status }) => sessionStatusMatchesListOptions(status, listOptions))
        .map(({ sessionId }) => sessionId)
      : sessionIds;
    return Promise.all(filteredSessionIds.map((entrySessionId) => readSessionSummary(entrySessionId)));
  }

  return {
    appendCommandLogEntry,
    artifactExists,
    createSession,
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
    readBackgroundTask,
    readBackgroundTasks,
    readCommandLifecycle,
    readCommandLifecycles,
    readCommandLog,
    readCompletedSteps,
    readConversationLog,
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
    writeBackgroundTaskEvent,
    writeCommandLifecycleEvent,
    writeActionResult,
    writeCompletedStep,
    writeConversationAssistantMessage,
    writeConversationSystemMessage,
    writeConversationUserMessage,
    writeCurrentStep,
    writeIssueWordMetadata,
    writeMetadataValue,
    writePromptContextSnapshot,
    writeStepState,
    writeStatus
  };
}

export {
  VIBE64_INITIAL_STEP,
  VIBE64_PROMPT_CONTEXT_SNAPSHOT_SCHEMA_VERSION,
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
  resolveVibe64SessionPaths
};
