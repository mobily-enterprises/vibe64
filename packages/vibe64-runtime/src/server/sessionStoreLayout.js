import { open, readdir, readFile, rm } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  isMissingPathError,
  isPlainObject,
  normalizeTargetRoot,
  normalizeText,
  pathExists,
  pathInsideOrEqual,
  vibe64Error
} from "@local/vibe64-core/server/core";
import { runSourceCommand } from "./sourceCommand.js";
import { fileIdentity } from "./sessionFiles.js";
import { resolveVibe64CurrentSessionAliasPath } from "./currentSessionAlias.js";
import {
  ARTIFACT_PATH_SEGMENT_PATTERN,
  assertSafeAgentRunId,
  assertSafeBackgroundTaskId,
  assertSafeMetadataName,
  assertValidVibe64SessionId,
  COMMAND_BUFFER_BYTES,
  CONVERSATION_TURN_ID_PATTERN,
  SESSION_ARCHIVE_TIMEOUT_MS,
  SESSION_LABEL_MAX_LENGTH
} from "./sessionRecordRules.js";

// Where a session store keeps its files and the helpers that read them:
// session and archive paths, directory listings, parsed-file caches, manifest
// revisions, session ids from the clock, and archive commands.

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


/**
 * Parsed files reused while their identity is unchanged. Every writer here
 * publishes by rename, which gives the file a new inode; another writer
 * changes at least its size or modification time. Callers must not mutate the
 * shared parsed value.
 */
function createParsedFileCache(limit) {
  const entries = new Map();
  function remember(filePath, identity, value) {
    entries.delete(filePath);
    entries.set(filePath, { identity, value });
    if (entries.size > limit) entries.delete(entries.keys().next().value);
    return value;
  }

  async function read(filePath, parse) {
    const handle = await open(filePath, "r");
    try {
      const identity = fileIdentity(await handle.stat({ bigint: true }));
      const cached = entries.get(filePath);
      if (cached?.identity === identity) return remember(filePath, identity, cached.value);
      return remember(filePath, identity, parse(await handle.readFile("utf8")));
    } finally {
      await handle.close();
    }
  }

  return Object.freeze({ remember, read });
}

async function runCommand(command, args = [], {
  allowedRoots = [],
  cwd = "",
  execution,
  maxBuffer = COMMAND_BUFFER_BYTES,
  timeout = SESSION_ARCHIVE_TIMEOUT_MS
} = {}) {
  return runSourceCommand(command, args, {
    allowedRoots,
    cwd: cwd || process.cwd(),
    execution,
    maxBuffer,
    timeout
  });
}

// Each archive command is one execution of its own; Resources shows its name.
const ARCHIVE_EXECUTIONS = Object.freeze({
  check: Object.freeze({ operationId: "session-archive-check", label: "Checking a session archive" }),
  read: Object.freeze({ operationId: "session-archive-read", label: "Opening an archived session" }),
  write: Object.freeze({ operationId: "session-archive-write", label: "Writing a session archive" })
});

/**
 * Only a tar that ran and failed says something about the archive. A refused,
 * timed-out or undrained run keeps its own code and whether to retry.
 */
function archiveCommandError(result, message, code) {
  if (!result.code) return vibe64Error(message, code);
  return Object.assign(vibe64Error(message, result.code), result.retryable ? { retryable: true } : {});
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
    conversationsRoot: sessionRoot ? path.join(sessionRoot, "conversations") : "",
    currentSessionAliasPath,
    dropZoneRoot: sessionRoot ? path.join(sessionRoot, "drop-zone") : "",
    manifestPath: sessionRoot ? path.join(sessionRoot, "session.json") : "",
    metadataRoot: sessionRoot ? path.join(sessionRoot, "metadata") : "",
    projectContextRoot,
    projectBackupsRoot: stateRoot ? path.join(stateRoot, "backups") : "",
    projectDropZoneRoot: stateRoot ? path.join(stateRoot, "drop-zone") : "",
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

/**
 * One metadata value of every active session, read without a store instance so
 * project lists never start a project runtime.
 */
async function readActiveSessionMetadataValues({ projectRuntimeRoot = "", name = "" } = {}) {
  const { activeSessionsRoot } = resolveVibe64SessionPaths({ projectRuntimeRoot });
  const entries = await readdir(activeSessionsRoot, { withFileTypes: true }).catch((error) => {
    if (error?.code === "ENOENT") return [];
    throw error;
  });
  const values = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const sessionPaths = sessionPathsFromRoot({ sessionRoot: path.join(activeSessionsRoot, entry.name) });
    values.push({ sessionId: entry.name, value: await readTextIfExists(metadataFilePath(sessionPaths, name)) });
  }
  return values;
}

/**
 * The time now, for a store composed without its own clock.
 */
function systemClock() {
  return new Date();
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
  if (!pathInsideOrEqual(artifactsRoot, artifactPath)) {
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

export {
  ARCHIVE_EXECUTIONS,
  agentRunFilePath,
  archiveCommandError,
  artifactFilePath,
  assertSafeArtifactPath,
  backgroundTaskFilePath,
  buildingRenewalArchiveRoot,
  closingSessionRoot,
  conversationTurnRoot,
  createAvailableSessionId,
  createClockNow,
  createParsedFileCache,
  isoFromConversationTimestamp,
  metadataFilePath,
  normalizeManifest,
  normalizeSessionLabel,
  preparedRenewalArchivePath,
  preparedRenewalArchiveRoot,
  preparedRenewalMetadataPath,
  publishingRenewalArchiveRoot,
  readActiveSessionMetadataValues,
  readDirectoryEntries,
  readTextIfExists,
  removeStaleSessionCreationStages,
  renewalArchiveStagingRoot,
  resolveVibe64SessionPaths,
  revisionNumber,
  runCommand,
  sessionArchiveMetadataPath,
  sessionArchivePath,
  sessionArchiveRecordExists,
  sessionArchiveStagingRoot,
  sessionCreationStagingRoot,
  sessionPathsFromRoot,
  sessionRecordExists,
  sortedDirectoryNames,
  sortedFileNames,
  systemClock,
  toDate,
  withRevisionMarker
};
