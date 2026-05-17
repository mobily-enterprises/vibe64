import { mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import process from "node:process";
import {
  aiStudioError,
  isMissingPathError,
  normalizeTargetRoot,
  normalizeText,
  pathExists
} from "./core.js";
import { deepFreeze } from "./deepFreeze.js";

const AI_STUDIO_STATE_DIR = ".ai-studio";
const AI_STUDIO_SESSION_SCHEMA_VERSION = 1;
const AI_STUDIO_INITIAL_STEP = "session_created";
const AI_STUDIO_SESSION_STATUS = deepFreeze({
  ABANDONED: "abandoned",
  ACTIVE: "active",
  BLOCKED: "blocked",
  FINISHED: "finished"
});
const AI_STUDIO_SESSION_STATUSES = new Set(Object.values(AI_STUDIO_SESSION_STATUS));
const ACTION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const ARTIFACT_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const METADATA_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const SESSION_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;
const STEP_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

function isValidAiStudioSessionId(sessionId) {
  const normalizedSessionId = normalizeText(sessionId);
  return SESSION_ID_PATTERN.test(normalizedSessionId);
}

function isSafeStepId(stepId) {
  return STEP_ID_PATTERN.test(normalizeText(stepId));
}

function isSafeActionId(actionId) {
  return ACTION_ID_PATTERN.test(normalizeText(actionId));
}

function assertValidAiStudioSessionId(sessionId) {
  const normalizedSessionId = normalizeText(sessionId);
  if (!isValidAiStudioSessionId(normalizedSessionId)) {
    throw aiStudioError(`Invalid ai-studio session id: ${normalizedSessionId || "(empty)"}`, "ai_studio_invalid_session_id");
  }
  return normalizedSessionId;
}

function assertSafeMetadataName(name) {
  const normalizedName = normalizeText(name);
  if (!METADATA_NAME_PATTERN.test(normalizedName)) {
    throw aiStudioError(`Invalid ai-studio metadata name: ${normalizedName || "(empty)"}`, "ai_studio_invalid_metadata_name");
  }
  return normalizedName;
}

function assertSafeStepId(stepId) {
  const normalizedStepId = normalizeText(stepId);
  if (!isSafeStepId(normalizedStepId)) {
    throw aiStudioError(`Invalid ai-studio step id: ${normalizedStepId || "(empty)"}`, "ai_studio_invalid_step_id");
  }
  return normalizedStepId;
}

function assertSafeActionId(actionId) {
  const normalizedActionId = normalizeText(actionId);
  if (!isSafeActionId(normalizedActionId)) {
    throw aiStudioError(`Invalid ai-studio action id: ${normalizedActionId || "(empty)"}`, "ai_studio_invalid_action_id");
  }
  return normalizedActionId;
}

function assertAiStudioSessionStatus(status) {
  const normalizedStatus = normalizeText(status) || AI_STUDIO_SESSION_STATUS.ACTIVE;
  if (!AI_STUDIO_SESSION_STATUSES.has(normalizedStatus)) {
    throw aiStudioError(`Invalid ai-studio session status: ${normalizedStatus}`, "ai_studio_invalid_session_status");
  }
  return normalizedStatus;
}

function pathIsInsideRoot(candidatePath, rootPath) {
  return candidatePath === rootPath || candidatePath.startsWith(`${rootPath}${path.sep}`);
}

function resolveSafeChildPath(root, relativePath, {
  code = "ai_studio_invalid_relative_path",
  label = "relative path"
} = {}) {
  const normalizedRelativePath = normalizeText(relativePath);
  if (!normalizedRelativePath || path.isAbsolute(normalizedRelativePath)) {
    throw aiStudioError(`Invalid ai-studio ${label}: ${normalizedRelativePath || "(empty)"}`, code);
  }
  const normalizedRoot = path.resolve(root);
  const resolvedPath = path.resolve(normalizedRoot, normalizedRelativePath);
  if (!pathIsInsideRoot(resolvedPath, normalizedRoot)) {
    throw aiStudioError(`Invalid ai-studio ${label}: ${normalizedRelativePath}`, code);
  }
  return resolvedPath;
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
    throw aiStudioError("Invalid ai-studio clock value.", "ai_studio_invalid_clock");
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

function resolveAiStudioSessionPaths({
  sessionId = "",
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = normalizeTargetRoot(targetRoot);
  const stateRoot = path.join(normalizedTargetRoot, AI_STUDIO_STATE_DIR);
  const sessionsRoot = path.join(stateRoot, "sessions");
  const activeSessionsRoot = path.join(sessionsRoot, "active");
  const normalizedSessionId = normalizeText(sessionId);
  const sessionRoot = normalizedSessionId ? path.join(activeSessionsRoot, assertValidAiStudioSessionId(normalizedSessionId)) : "";
  return {
    actionsRoot: sessionRoot ? path.join(sessionRoot, "actions") : "",
    activeSessionsRoot,
    artifactsRoot: sessionRoot ? path.join(sessionRoot, "artifacts") : "",
    commandLogPath: sessionRoot ? path.join(sessionRoot, "command-log.jsonl") : "",
    currentStepPath: sessionRoot ? path.join(sessionRoot, "current_step") : "",
    manifestPath: sessionRoot ? path.join(sessionRoot, "session.json") : "",
    metadataRoot: sessionRoot ? path.join(sessionRoot, "metadata") : "",
    sessionId: normalizedSessionId,
    sessionRoot,
    sessionsRoot,
    stateRoot,
    statusPath: sessionRoot ? path.join(sessionRoot, "status") : "",
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
  throw aiStudioError("Unable to allocate an ai-studio session id.", "ai_studio_session_id_exhausted");
}

function metadataFilePath(sessionPaths, name) {
  return path.join(sessionPaths.metadataRoot, assertSafeMetadataName(name));
}

function artifactFilePath(sessionPaths, relativePath) {
  return resolveSafeChildPath(sessionPaths.artifactsRoot, relativePath, {
    code: "ai_studio_invalid_artifact_path",
    label: "artifact path"
  });
}

function actionResultFilePath(sessionPaths, actionId) {
  return path.join(sessionPaths.actionsRoot, assertSafeActionId(actionId));
}

function completedStepFilePath(sessionPaths, stepId) {
  return path.join(sessionPaths.stepsRoot, assertSafeStepId(stepId));
}

function createAiStudioSessionStore({
  clock = undefined,
  targetRoot = process.cwd()
} = {}) {
  const normalizedTargetRoot = normalizeTargetRoot(targetRoot);
  const now = createClockNow(clock);

  function paths(sessionId = "") {
    return resolveAiStudioSessionPaths({
      sessionId,
      targetRoot: normalizedTargetRoot
    });
  }

  async function ensureSessionRoot(sessionId) {
    const sessionPaths = paths(sessionId);
    if (!await pathExists(sessionPaths.manifestPath)) {
      throw aiStudioError(`Unknown ai-studio session: ${sessionPaths.sessionId}`, "ai_studio_session_not_found");
    }
    return sessionPaths;
  }

  async function writeStatus(sessionId, status) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    await writeTextFile(sessionPaths.statusPath, `${assertAiStudioSessionStatus(status)}\n`);
  }

  async function readStatus(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    return normalizeText(await readTextIfExists(sessionPaths.statusPath)) || AI_STUDIO_SESSION_STATUS.ACTIVE;
  }

  async function writeCurrentStep(sessionId, currentStep) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    await writeTextFile(sessionPaths.currentStepPath, `${normalizeText(currentStep) || AI_STUDIO_INITIAL_STEP}\n`);
  }

  async function readCurrentStep(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    return normalizeText(await readTextIfExists(sessionPaths.currentStepPath)) || AI_STUDIO_INITIAL_STEP;
  }

  async function writeMetadataValue(sessionId, name, value) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    await writeTextFile(metadataFilePath(sessionPaths, name), `${normalizeText(value)}\n`);
  }

  async function readMetadataValue(sessionId, name) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    return normalizeText(await readTextIfExists(metadataFilePath(sessionPaths, name)));
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

  async function writeArtifact(sessionId, relativePath, text) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const artifactPath = artifactFilePath(sessionPaths, relativePath);
    await writeTextFile(artifactPath, text);
    return artifactPath;
  }

  async function readArtifact(sessionId, relativePath) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    return await readTextIfExists(artifactFilePath(sessionPaths, relativePath));
  }

  async function readArtifactReadiness(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const names = sortedFileNames(
      await readDirectoryEntries(sessionPaths.artifactsRoot),
      (name) => ARTIFACT_NAME_PATTERN.test(name)
    );
    const entries = await Promise.all(names.map(async (name) => {
      const text = await readTextIfExists(artifactFilePath(sessionPaths, name));
      return [
        name,
        {
          exists: true,
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
    const sessionPaths = await ensureSessionRoot(sessionId);
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
  }

  async function readCommandLog(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    return (await readTextIfExists(sessionPaths.commandLogPath))
      .split(/\r?\n/u)
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  }

  async function writeActionResult(sessionId, actionId, result = {}) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const normalizedActionId = assertSafeActionId(actionId);
    const record = {
      ...result,
      actionId: normalizedActionId,
      at: normalizeText(result.at) || now().toISOString()
    };
    await writeJsonFile(actionResultFilePath(sessionPaths, normalizedActionId), record);
    return record;
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
      throw aiStudioError(`Invalid ai-studio action result: ${normalizedActionId}`, "ai_studio_invalid_action_result");
    }
  }

  async function readActionResults(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const actionNames = sortedFileNames(await readDirectoryEntries(sessionPaths.actionsRoot), isSafeActionId);
    const actionResults = await Promise.all(actionNames.map((actionName) => readActionResult(sessionId, actionName)));
    return actionResults.filter(Boolean);
  }

  async function writeCompletedStep(sessionId, stepId, {
    message = ""
  } = {}) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const normalizedStepId = assertSafeStepId(stepId);
    const record = {
      at: now().toISOString(),
      message: normalizeText(message),
      stepId: normalizedStepId
    };
    await writeJsonFile(completedStepFilePath(sessionPaths, normalizedStepId), record);
    return record;
  }

  async function readCompletedSteps(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    return sortedFileNames(await readDirectoryEntries(sessionPaths.stepsRoot), isSafeStepId);
  }

  async function readManifest(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const manifestText = await readTextIfExists(sessionPaths.manifestPath);
    try {
      return JSON.parse(manifestText);
    } catch {
      throw aiStudioError(`Invalid ai-studio session manifest: ${sessionPaths.sessionId}`, "ai_studio_invalid_manifest");
    }
  }

  async function readSession(sessionId) {
    const sessionPaths = await ensureSessionRoot(sessionId);
    const [manifest, status, currentStep, metadata, completedSteps, artifactReadiness, actionResults] = await Promise.all([
      readManifest(sessionPaths.sessionId),
      readStatus(sessionPaths.sessionId),
      readCurrentStep(sessionPaths.sessionId),
      readMetadata(sessionPaths.sessionId),
      readCompletedSteps(sessionPaths.sessionId),
      readArtifactReadiness(sessionPaths.sessionId),
      readActionResults(sessionPaths.sessionId)
    ]);
    return {
      actionResults,
      actionsRoot: sessionPaths.actionsRoot,
      artifactReadiness,
      artifactsRoot: sessionPaths.artifactsRoot,
      commandLogPath: sessionPaths.commandLogPath,
      completedSteps,
      currentStep,
      manifest,
      metadata,
      metadataRoot: sessionPaths.metadataRoot,
      sessionId: sessionPaths.sessionId,
      sessionRoot: sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      stepsRoot: sessionPaths.stepsRoot,
      targetRoot: sessionPaths.targetRoot
    };
  }

  async function createSession({
    initialStep = AI_STUDIO_INITIAL_STEP,
    metadata = {},
    sessionId = "",
    status = AI_STUDIO_SESSION_STATUS.ACTIVE
  } = {}) {
    const normalizedMetadata = Object.fromEntries(
      Object.entries(metadata).map(([name, value]) => [assertSafeMetadataName(name), normalizeText(value)])
    );
    const normalizedStatus = assertAiStudioSessionStatus(status);
    const rootPaths = paths();
    await mkdir(rootPaths.activeSessionsRoot, {
      recursive: true
    });
    const createdAt = now().toISOString();
    const resolvedSessionId = sessionId
      ? assertValidAiStudioSessionId(sessionId)
      : await createAvailableSessionId(rootPaths, createdAt);
    const sessionPaths = paths(resolvedSessionId);
    try {
      await mkdir(sessionPaths.sessionRoot);
    } catch (error) {
      if (error?.code === "EEXIST") {
        throw aiStudioError(`AI Studio session already exists: ${resolvedSessionId}`, "ai_studio_session_exists");
      }
      throw error;
    }
    await Promise.all([
      mkdir(sessionPaths.actionsRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.artifactsRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.metadataRoot, {
        recursive: true
      }),
      mkdir(sessionPaths.stepsRoot, {
        recursive: true
      })
    ]);
    const manifest = {
      createdAt,
      product: "ai-studio",
      schemaVersion: AI_STUDIO_SESSION_SCHEMA_VERSION,
      sessionId: resolvedSessionId,
      targetRoot: sessionPaths.targetRoot,
      updatedAt: createdAt
    };
    await Promise.all([
      writeJsonFile(sessionPaths.manifestPath, manifest),
      writeTextFile(sessionPaths.currentStepPath, `${normalizeText(initialStep) || AI_STUDIO_INITIAL_STEP}\n`),
      writeTextFile(sessionPaths.statusPath, `${normalizedStatus}\n`),
      ...Object.entries(normalizedMetadata).map(([name, value]) => {
        return writeTextFile(metadataFilePath(sessionPaths, name), `${value}\n`);
      })
    ]);
    return readSession(resolvedSessionId);
  }

  async function listSessions() {
    const rootPaths = paths();
    const sessionIds = sortedDirectoryNames(
      await readDirectoryEntries(rootPaths.activeSessionsRoot),
      isValidAiStudioSessionId
    );
    return Promise.all(sessionIds.map((entrySessionId) => readSession(entrySessionId)));
  }

  return {
    appendCommandLogEntry,
    artifactExists,
    createSession,
    listSessions,
    paths,
    readArtifact,
    readArtifactReadiness,
    readActionResult,
    readActionResults,
    readCommandLog,
    readCompletedSteps,
    readCurrentStep,
    readManifest,
    readMetadata,
    readMetadataValue,
    readSession,
    readStatus,
    writeArtifact,
    writeActionResult,
    writeCompletedStep,
    writeCurrentStep,
    writeMetadataValue,
    writeStatus
  };
}

export {
  AI_STUDIO_INITIAL_STEP,
  AI_STUDIO_SESSION_SCHEMA_VERSION,
  AI_STUDIO_SESSION_STATUS,
  AI_STUDIO_STATE_DIR,
  assertAiStudioSessionStatus,
  assertSafeActionId,
  assertSafeStepId,
  assertValidAiStudioSessionId,
  createAiStudioSessionStore,
  isSafeActionId,
  isSafeStepId,
  isValidAiStudioSessionId,
  resolveAiStudioSessionPaths
};
