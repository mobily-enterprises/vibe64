import { lstat, readFile } from "node:fs/promises";
import path from "node:path";
import { isMissingPathError, isPlainObject, pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import { fileIdentity } from "./sessionFiles.js";
import {
  assertValidVibe64SessionId,
  assertVibe64SessionStatus,
  isValidVibe64SessionId,
  SESSION_ARCHIVE_INDEX_METADATA_NAMES,
  SESSION_ARCHIVE_KIND,
  unknownSessionError,
  VIBE64_SESSION_ARCHIVE_SCHEMA_VERSION,
  VIBE64_SESSION_STATUS
} from "./sessionRecordRules.js";
import {
  ARCHIVE_EXECUTIONS,
  archiveCommandError,
  preparedRenewalArchivePath,
  preparedRenewalMetadataPath,
  readDirectoryEntries,
  revisionNumber,
  runCommand,
  sessionArchiveMetadataPath,
  sessionArchivePath,
  sortedFileNames
} from "./sessionStoreLayout.js";
import { toText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */

// An archived session's record is published once, by renaming it into the
// archive directory; a retried publication replaces it the same way. Listing
// the archive keeps each record it has read while its file's identity (device,
// inode, size and modification time) stays the same, so a list reads only the
// records that are new or replaced, not the whole archive every time.
const ARCHIVE_LIST_CACHE_DIRECTORIES = 64;
/** @type {Map<string, Map<string, { identity: string, source: string }>>} */
const archiveListCache = new Map();

function rememberArchiveList(directory, records) {
  archiveListCache.delete(directory);
  archiveListCache.set(directory, records);
  while (archiveListCache.size > ARCHIVE_LIST_CACHE_DIRECTORIES) {
    archiveListCache.delete(archiveListCache.keys().next().value);
  }
}

/**
 * Archive records: their JSON, index metadata and summaries, prepared renewal
 * archives and archive checks, and the active session root, which refuses a
 * session once it is archived.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 */
function createSessionArchiveRecords({ state, storePaths }) {
  async function ensureActiveSessionRoot(sessionId) {
    const sessionPaths = storePaths.paths(sessionId);
    if (!await pathExists(sessionPaths.manifestPath)) {
      const closingSession = storePaths.closingSessionPaths(sessionPaths.sessionId);
      if (
        await pathExists(closingSession.manifestPath) ||
        await readSessionArchiveRecord(sessionPaths.sessionId)
      ) {
        throw vibe64Error(
          `Vibe64 session is already archived: ${sessionPaths.sessionId}`,
          "vibe64_session_archived"
        );
      }
      throw unknownSessionError(sessionPaths.sessionId);
    }
    return sessionPaths;
  }

  function sessionArchiveRecordFromJson(value = {}, options = {}) {
    const {
      archivePath = "",
      metadataPath = ""
    } = options;
    if (
      !isPlainObject(value) ||
      value.kind !== SESSION_ARCHIVE_KIND ||
      value.schemaVersion !== VIBE64_SESSION_ARCHIVE_SCHEMA_VERSION ||
      !isValidVibe64SessionId(value.sessionId) ||
      !isPlainObject(value.index) ||
      toText(value.index.sessionId) !== toText(value.sessionId)
    ) {
      throw new Error(`Invalid Vibe64 session archive metadata: ${metadataPath}`);
    }
    const normalizedStatus = assertVibe64SessionStatus(value.status);
    if (
      normalizedStatus !== VIBE64_SESSION_STATUS.ARCHIVED ||
      toText(value.index.status) !== VIBE64_SESSION_STATUS.ARCHIVED
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

  function sessionArchiveRecordFromSource(rootPaths, sessionId, source) {
    const metadataPath = sessionArchiveMetadataPath(rootPaths, sessionId);
    try {
      return sessionArchiveRecordFromJson(JSON.parse(source), {
        archivePath: sessionArchivePath(rootPaths, sessionId),
        metadataPath
      });
    } catch (error) {
      // readable-check: allow optional-call - data: a caught error's code may be absent or not text
      if (error?.code?.startsWith?.("vibe64_")) {
        throw error;
      }
      throw new Error(`Invalid Vibe64 session archive metadata: ${metadataPath}`);
    }
  }

  async function readSessionArchiveRecordFromRoot(rootPaths, sessionId) {
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const metadataPath = sessionArchiveMetadataPath(rootPaths, normalizedSessionId);
    if (!await pathExists(metadataPath)) {
      return null;
    }
    return sessionArchiveRecordFromSource(rootPaths, normalizedSessionId, await readFile(metadataPath, "utf8"));
  }

  async function readSessionArchiveRecord(sessionId) {
    const rootPaths = storePaths.paths();
    return readSessionArchiveRecordFromRoot(rootPaths, sessionId);
  }

  async function readPreparedRenewalArchive(sessionId) {
    const rootPaths = storePaths.paths();
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
      // readable-check: allow optional-call - data: a caught error's code may be absent or not text
      if (error?.code?.startsWith?.("vibe64_")) {
        throw error;
      }
      throw new Error(`Invalid prepared renewal archive metadata: ${metadataPath}`);
    }
    return sessionArchiveRecordFromJson(value, {
      archivePath,
      metadataPath
    });
  }

  async function readSessionArchiveRecords() {
    const rootPaths = storePaths.paths();
    const directory = rootPaths.archivedSessionsRoot;
    const entries = await readDirectoryEntries(directory);
    const metadataFileNames = sortedFileNames(entries, (name) => {
      return name.endsWith(".json") && isValidVibe64SessionId(name.slice(0, -".json".length));
    });
    const known = archiveListCache.get(directory) || new Map();
    const listed = new Map();
    const records = await Promise.all(metadataFileNames.map(async (fileName) => {
      const sessionId = fileName.slice(0, -".json".length);
      const metadataPath = sessionArchiveMetadataPath(rootPaths, sessionId);
      let identity;
      try {
        // The identity is taken before the read: a file replaced in between is
        // read again next time instead of being kept under its new identity.
        identity = fileIdentity(await lstat(metadataPath, { bigint: true }));
      } catch (error) {
        if (isMissingPathError(error)) return null;
        throw error;
      }
      const cached = known.get(fileName);
      const source = cached?.identity === identity ? cached.source : await readFile(metadataPath, "utf8").catch((error) => {
        if (isMissingPathError(error)) return null;
        throw error;
      });
      if (source === null) return null;
      const record = sessionArchiveRecordFromSource(rootPaths, sessionId, source);
      listed.set(fileName, { identity, source });
      return record;
    }));
    rememberArchiveList(directory, listed);
    return records.filter(Boolean);
  }

  function sessionArchiveIndexMetadata(metadata = {}) {
    if (!isPlainObject(metadata)) {
      return {};
    }
    const entries = SESSION_ARCHIVE_INDEX_METADATA_NAMES
      .map((name) => [
        name,
        toText(metadata[name])
      ])
      .filter(([, value]) => value);
    return Object.fromEntries(entries);
  }

  function sessionArchiveIndexFromSummary(summary = {}, options = {}) {
    const {
      sessionId = ""
    } = options;
    const manifest = isPlainObject(summary.manifest) ? summary.manifest : {};
    const createdAt = toText(summary.createdAt || manifest.createdAt);
    const updatedAt = toText(summary.updatedAt || manifest.updatedAt || createdAt);
    return {
      createdAt,
      manifest: {
        createdAt,
        revision: revisionNumber(summary.revision ?? manifest.revision),
        runtimeKind: toText(manifest.runtimeKind),
        updatedAt
      },
      metadata: sessionArchiveIndexMetadata(summary.metadata),
      revision: revisionNumber(summary.revision ?? manifest.revision),
      sessionId: assertValidVibe64SessionId(sessionId || summary.sessionId),
      sessionName: toText(summary.sessionName),
      sessionRoot: "",
      status: VIBE64_SESSION_STATUS.ARCHIVED,
      updatedAt
    };
  }

  function sessionArchiveSummary(record = {}) {
    const index = isPlainObject(record.index) ? record.index : {};
    return {
      createdAt: toText(index.createdAt),
      manifest: isPlainObject(index.manifest) ? index.manifest : {},
      metadata: isPlainObject(index.metadata) ? index.metadata : {},
      revision: revisionNumber(index.revision),
      sessionName: toText(index.sessionName),
      updatedAt: toText(index.updatedAt),
      archiveMetadataPath: record.metadataPath,
      archivePath: record.archivePath,
      archiveStatus: record.status,
      archived: true,
      archivedAt: toText(record.archivedAt),
      sessionId: toText(index.sessionId) || toText(record.sessionId),
      sessionRoot: "",
      status: toText(index.status) || toText(record.status)
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
      archivedAt: toText(archivedAt),
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

  async function validateSessionArchive(archivePath) {
    const result = await runCommand("tar", [
      "-tzf",
      archivePath
    ], {
      allowedRoots: [path.dirname(archivePath)],
      cwd: state.normalizedProjectContextRoot,
      execution: ARCHIVE_EXECUTIONS.check
    });
    if (!result.ok) {
      throw archiveCommandError(
        result,
        result.code
          ? `Vibe64 could not check session archive ${archivePath}: ${result.output}`
          : `Invalid Vibe64 session archive ${archivePath}: ${result.output}`,
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

  return Object.freeze({
    ensureActiveSessionRoot,
    readPreparedRenewalArchive,
    readSessionArchiveRecord,
    readSessionArchiveRecords,
    requireSessionArchiveRecord,
    sessionArchiveMetadataRecord,
    sessionArchiveRecordFromJson,
    sessionArchiveSummary,
    validateSessionArchive
  });
}

export {
  createSessionArchiveRecords
};
