import { readFile } from "node:fs/promises";
import path from "node:path";
import { isPlainObject, normalizeText, pathExists, vibe64Error } from "@local/vibe64-core/server/core";
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

/** @typedef {ReturnType<typeof import("./sessionStoreState.js").createSessionStoreState>} SessionStoreState */
/** @typedef {ReturnType<typeof import("./sessionStorePaths.js").createSessionStorePaths>} SessionStorePaths */

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
      // readable-check: allow optional-call - data: a caught error's code may be absent or not text
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
    const rootPaths = storePaths.paths();
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
      throw archiveCommandError(result, result.code
        ? `Vibe64 could not check session archive ${archivePath}: ${result.output}`
        : `Invalid Vibe64 session archive ${archivePath}: ${result.output}`,
      "vibe64_session_archive_invalid");
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
