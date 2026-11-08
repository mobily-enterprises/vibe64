import { stat } from "node:fs/promises";
import path from "node:path";
import { conversationAgentRunRecord } from "@jskit-ai/assistant-core/server/conversation";
import { isMissingPathError, isPlainObject, pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { readVibe64CurrentSessionAlias } from "./currentSessionAlias.js";
import {
  assertSafeAgentRunId,
  assertSafeBackgroundTaskId,
  isSafeAgentRunId,
  isSafeBackgroundTaskId,
  LEARNING_SESSION_METADATA,
  learningSessionBinding,
  METADATA_NAME_PATTERN,
  normalizeBackgroundTaskStatus,
  normalizeVibe64AgentRunState,
  SESSION_LABEL_METADATA,
  SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES,
  VIBE64_SESSION_STATUS,
  vibe64AgentRunStateIsActive
} from "./sessionRecordRules.js";
import {
  agentRunFilePath,
  backgroundTaskFilePath,
  createParsedFileCache,
  metadataFilePath,
  normalizeManifest,
  normalizeSessionLabel,
  readDirectoryEntries,
  readTextIfExists,
  revisionNumber,
  sortedFileNames
} from "./sessionStoreLayout.js";
import { fileIdentity } from "./sessionFiles.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */

const agentRunFileCache = createParsedFileCache(256);
// Whether a session has an active agent run, by its runs folder, for the
// session list's every refresh. A run write here forgets its folder's answer
// and a change from elsewhere changes the folder, so only then are runs reread.
const agentRunActivityCache = new Map();

/**
 * Reads a session's files from its paths: status, metadata, manifest, agent
 * runs, background tasks, the whole session and its summary, and the pinned
 * session.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 */
function createSessionRecordFiles({ state, storePaths }) {
  async function assertStoredLearningScope(sessionPaths) {
    if (state.admittedLearningScope || await pathExists(metadataFilePath(sessionPaths, LEARNING_SESSION_METADATA))) {
      await readMetadataFromPaths(sessionPaths);
    }
  }

  async function readStatusFromPaths(sessionPaths) {
    return toText(await readTextIfExists(sessionPaths.statusPath)) || VIBE64_SESSION_STATUS.ACTIVE;
  }

  async function readMetadataFromPaths(sessionPaths) {
    const metadata = await readUnboundMetadataFromPaths(sessionPaths);
    learningSessionBinding(metadata, state.admittedLearningScope, sessionPaths.sessionId);
    return metadata;
  }

  /**
   * Offline upgrades validate a supported old record before adding its binding.
   * Ordinary readers always pass through readMetadataFromPaths above.
   */
  async function readUnboundMetadataFromPaths(sessionPaths) {
    const names = sortedFileNames(
      await readDirectoryEntries(sessionPaths.metadataRoot),
      (name) => METADATA_NAME_PATTERN.test(name)
    );
    const metadataEntries = await Promise.all(
      names.map(async (name) => {
        return [
          name,
          toText(await readTextIfExists(metadataFilePath(sessionPaths, name)))
        ];
      })
    );
    return Object.fromEntries(metadataEntries);
  }

  async function readSessionSourceDescriptorFromPaths(sessionPaths) {
    if (state.admittedLearningScope) await readMetadataFromPaths(sessionPaths);
    const metadataEntries = await Promise.all(
      SESSION_SOURCE_DESCRIPTOR_METADATA_NAMES.map(async (name) => [
        name,
        toText(await readTextIfExists(metadataFilePath(sessionPaths, name)))
      ])
    );
    return {
      metadata: Object.fromEntries(metadataEntries),
      projectContextRoot: sessionPaths.projectContextRoot,
      sessionId: sessionPaths.sessionId,
      sessionRoot: sessionPaths.sessionRoot
    };
  }
  async function sessionNameForSession(sessionPaths, metadata = {}) {
    return normalizeSessionLabel(metadata[SESSION_LABEL_METADATA]) || sessionPaths.sessionId;
  }

  async function readAgentRunFromPath(sessionPaths, runId) {
    const normalizedRunId = assertSafeAgentRunId(runId);
    let record;
    try {
      // Every session read lists every run; reuse unchanged parsed records.
      record = await agentRunFileCache.read(agentRunFilePath(sessionPaths, normalizedRunId), (text) => text ? JSON.parse(text) : null);
    } catch (error) {
      if (isMissingPathError(error)) return null;
      if (!(error instanceof SyntaxError)) throw error;
      record = undefined;
    }
    if (record === null) {
      return null;
    }
    try {
      if (record === undefined) throw new SyntaxError();
      return conversationAgentRunRecord(record, normalizedRunId, {
        normalizeState: normalizeVibe64AgentRunState,
        isActive: vibe64AgentRunStateIsActive
      });
    } catch {
      throw vibe64Error(
        `Invalid vibe64 agent run: ${normalizedRunId}`,
        "vibe64_invalid_agent_run"
      );
    }
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
        const timeComparison = toText(left.updatedAt).localeCompare(toText(right.updatedAt));
        return timeComparison || toText(left.id).localeCompare(toText(right.id));
      });
  }

  async function readAgentRunActivityFromPaths(sessionPaths) {
    const folder = sessionPaths.agentRunsRoot;
    const generation = agentRunActivityCache.get(folder)?.generation || 0;
    let identity = "";
    try {
      identity = fileIdentity(await stat(folder, { bigint: true }));
    } catch (error) {
      if (!isMissingPathError(error)) throw error;
    }
    const cached = agentRunActivityCache.get(folder);
    if (cached && "active" in cached && cached.generation === generation && cached.identity === identity) {
      return { active: cached.active };
    }
    const active = (await readAgentRunsFromPaths(sessionPaths)).some((run) => run.active);
    // A run written while these were read leaves the answer to the next reader.
    if ((agentRunActivityCache.get(folder)?.generation || 0) === generation) {
      agentRunActivityCache.set(folder, { active, generation, identity });
    }
    return { active };
  }

  function forgetAgentRunActivity(sessionPaths) {
    const folder = sessionPaths.agentRunsRoot;
    agentRunActivityCache.set(folder, { generation: (agentRunActivityCache.get(folder)?.generation || 0) + 1 });
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
        const timeComparison = toText(left.updatedAt).localeCompare(toText(right.updatedAt));
        return timeComparison || toText(left.id).localeCompare(toText(right.id));
      });
  }

  function conversationPaths(sessionPaths, conversationId) {
    if (!/^[a-zA-Z0-9_-]{1,128}$/u.test(String(conversationId || ""))) {
      throw vibe64Error("Invalid assistant conversation id.", "vibe64_invalid_conversation_id");
    }
    const root = path.join(sessionPaths.conversationsRoot, conversationId);
    return { ...sessionPaths, conversationRoot: root, conversationLogRoot: path.join(root, "conversation-log") };
  }

  /**
   * A session's temporary chat and AI task records, oldest first.
   * @param {object} sessionPaths
   */
  async function readConversationsFromPaths(sessionPaths) {
    const entries = await readDirectoryEntries(sessionPaths.conversationsRoot);
    const records = await Promise.all(entries.filter((entry) => entry.isDirectory()).map(async (entry) => {
      const text = await readTextIfExists(path.join(conversationPaths(sessionPaths, entry.name).conversationRoot, "conversation.json"));
      return text ? JSON.parse(text) : null;
    }));
    return records.filter(Boolean).sort((left, right) => left.createdAt.localeCompare(right.createdAt));
  }

  async function readManifestFromPaths(sessionPaths) {
    const manifestText = await readTextIfExists(sessionPaths.manifestPath);
    try {
      return normalizeManifest(JSON.parse(manifestText));
    } catch {
      throw vibe64Error(`Invalid vibe64 session manifest: ${sessionPaths.sessionId}`, "vibe64_invalid_manifest");
    }
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
      pinnedSessionId: await readPinnedSessionId(),
      sessionRoot: archived ? "" : sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      updatedAt: toText(manifest.updatedAt || manifest.createdAt),
      ...(archived
        ? {
            archivePath: archiveRecord.archivePath,
            archiveStatus: archiveRecord.status,
            archived: true,
            archivedAt: toText(archiveRecord.archivedAt),
            archiveMetadataPath: archiveRecord.metadataPath
          }
        : {})
    };
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
      createdAt: toText(manifest.createdAt),
      manifest: {
        createdAt: toText(manifest.createdAt),
        revision: revisionNumber(manifest.revision),
        runtimeKind: toText(manifest.runtimeKind),
        updatedAt: toText(manifest.updatedAt || manifest.createdAt)
      },
      metadata,
      projectContextRoot: sessionPaths.projectContextRoot,
      revision: revisionNumber(manifest.revision),
      sessionId: sessionPaths.sessionId,
      sessionName,
      pinnedSessionId: await readPinnedSessionId(),
      sessionRoot: sessionPaths.sessionRoot,
      stateRoot: sessionPaths.stateRoot,
      status,
      updatedAt: toText(manifest.updatedAt || manifest.createdAt)
    };
  }

  async function readPinnedSessionId() {
    const alias = storePaths.paths().currentSessionAliasPath;
    return alias ? readVibe64CurrentSessionAlias({ aliasPath: path.join(path.dirname(alias), "pinned") }) : "";
  }

  async function assertSessionNotPinned(sessionId) {
    if (await readPinnedSessionId() === sessionId) {
      throw vibe64Error("Unpin this session before archiving or renewing it.", "vibe64_session_pinned");
    }
  }

  return Object.freeze({
    assertSessionNotPinned,
    assertStoredLearningScope,
    conversationPaths,
    forgetAgentRunActivity,
    readAgentRunActivityFromPaths,
    readAgentRunFromPath,
    readAgentRunsFromPaths,
    readBackgroundTaskFromPath,
    readBackgroundTasksFromPaths,
    readConversationsFromPaths,
    readManifestFromPaths,
    readMetadataFromPaths,
    readPinnedSessionId,
    readSessionFromPaths,
    readSessionSourceDescriptorFromPaths,
    readSessionSummaryFromPaths,
    readStatusFromPaths,
    readUnboundMetadataFromPaths
  });
}

export {
  createSessionRecordFiles
};
