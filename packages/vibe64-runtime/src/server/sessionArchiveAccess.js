import { randomUUID } from "node:crypto";
import { lstat, mkdir, open, realpath, rename, rm } from "node:fs/promises";
import { constants as fsConstants } from "node:fs";
import path from "node:path";
import { isMissingPathError, pathExists, vibe64Error } from "@local/vibe64-core/server/core";
import {
  assertNormalSessionIsReadable,
  assertValidVibe64SessionId,
  unknownSessionError,
  VIBE64_SESSION_STATUS
} from "./sessionRecordRules.js";
import {
  ARCHIVE_EXECUTIONS,
  archiveCommandError,
  artifactFilePath,
  assertSafeArtifactPath,
  readDirectoryEntries,
  runCommand
} from "./sessionStoreLayout.js";

/** @typedef {import("./types.js").SessionStoreState} SessionStoreState */
/** @typedef {import("./types.js").SessionStorePaths} SessionStorePaths */
/** @typedef {import("./types.js").SessionStoreLocks} SessionStoreLocks */
/** @typedef {import("./types.js").SessionRecordFiles} SessionRecordFiles */
/** @typedef {import("./types.js").SessionArchiveRecords} SessionArchiveRecords */

/**
 * Opens archived sessions: extracts an archive for a read or a change,
 * republishes it, prunes its artifacts and attachments, and resolves the
 * readable paths of open and archived sessions.
 * @param {object} dependencies
 * @param {SessionStoreState} dependencies.state
 * @param {SessionStorePaths} dependencies.storePaths
 * @param {SessionStoreLocks} dependencies.locks
 * @param {SessionRecordFiles} dependencies.recordFiles
 * @param {SessionArchiveRecords} dependencies.archiveRecords
 */
function createSessionArchiveAccess({ state, storePaths, locks, recordFiles, archiveRecords }) {
  async function withExtractedSessionArchive(record, operation, { temporaryRoot = "" } = {}) {
    const extractionRoot = path.join(temporaryRoot || path.join(storePaths.paths().sessionsRoot, ".archive-read"), `${record.sessionId}-${randomUUID()}`);
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
        cwd: state.normalizedProjectContextRoot,
        execution: ARCHIVE_EXECUTIONS.read
      });
      if (!extractResult.ok) {
        throw archiveCommandError(extractResult,
          `Cannot read Vibe64 session archive ${record.archivePath}: ${extractResult.output}`,
          "vibe64_session_archive_read_failed");
      }
      const sessionPaths = storePaths.pathsForSessionRoot(record.sessionId, extractedSessionRoot);
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
      storePaths.paths(sessionId),
      storePaths.closingSessionPaths(sessionId)
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
    const read = async (sessionPaths, archiveRecord) => {
      await recordFiles.assertStoredLearningScope(sessionPaths);
      return operation(sessionPaths, archiveRecord);
    };
    const activePaths = storePaths.paths(sessionId);
    const unarchivedRead = await readUnarchivedSessionIfPresent(sessionId, read);
    if (unarchivedRead.found) {
      return unarchivedRead.value;
    }
    const publishedArchive = await archiveRecords.readSessionArchiveRecord(sessionId);
    if (publishedArchive) {
      return withExtractedSessionArchive(publishedArchive, read);
    }
    throw unknownSessionError(activePaths.sessionId);
  }

  async function withPublishedRenewalSession(sessionId, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Published renewal session work requires an operation.");
    }
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const archiveRecord = await archiveRecords.readSessionArchiveRecord(normalizedSessionId);
    if (!archiveRecord) {
      throw vibe64Error(
        `Renewal predecessor has no published archive: ${normalizedSessionId}`,
        "vibe64_session_renewal_archive_required"
      );
    }
    return withExtractedSessionArchive(archiveRecord, async (sessionPaths, record) => {
      const session = await recordFiles.readSessionFromPaths(sessionPaths, record);
      return operation({
        ...session,
        artifactsRoot: sessionPaths.artifactsRoot,
        sessionRoot: sessionPaths.sessionRoot
      });
    });
  }

  async function withArchivedSession(sessionId, operation, { beforeWork } = {}) {
    if (typeof operation !== "function") {
      throw new TypeError("Archived session work requires an operation.");
    }
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    return locks.runSessionArchiveExclusive(normalizedSessionId, async () => {
      // A published renewal can still retain its predecessor until the source
      // transaction commits. It is not yet eligible for post-archive work.
      for (const sessionPaths of [storePaths.paths(normalizedSessionId), storePaths.closingSessionPaths(normalizedSessionId)]) {
        if (await pathExists(sessionPaths.sessionRoot)) {
          throw vibe64Error(
            `Session archive is not finalized: ${normalizedSessionId}`,
            "vibe64_session_archive_not_finalized"
          );
        }
      }
      const archiveRecord = await archiveRecords.requireSessionArchiveRecord(storePaths.paths(), normalizedSessionId);
      if (archiveRecord.sessionId !== normalizedSessionId) {
        throw vibe64Error(
          `Session archive identity does not match: ${normalizedSessionId}`,
          "vibe64_invalid_session_archive_metadata"
        );
      }
      await archiveRecords.validateSessionArchive(archiveRecord.archivePath);
      await beforeWork?.({ stage: "extract", archivePath: archiveRecord.archivePath });
      return withExtractedSessionArchive(archiveRecord, async (sessionPaths, record) => {
        const session = await recordFiles.readSessionFromPaths(sessionPaths, record);
        if (session.status !== VIBE64_SESSION_STATUS.ARCHIVED) {
          throw vibe64Error(
            `Session archive contains an unarchived session: ${normalizedSessionId}`,
            "vibe64_session_archive_not_finalized"
          );
        }
        const archived = {
          ...session,
          artifactsRoot: sessionPaths.artifactsRoot,
          sessionRoot: sessionPaths.sessionRoot
        };
        let available = true;
        let publishing = false;
        const requireExclusive = () => {
          if (!available || publishing) throw new Error("Archived artifact publication is outside its exclusive operation.");
        };
        // Each change inside this extraction publishes at once. A failed one
        // leaves it unavailable, so a retry never publishes a partly modified
        // extraction.
        const change = async (work) => {
          requireExclusive();
          publishing = true;
          try { return await work(); }
          catch (error) { available = false; throw error; }
          finally { publishing = false; }
        };
        const publishArtifacts = async (files) => {
          requireExclusive();
          if (!Array.isArray(files) || !files.length || files.length > 1000) throw new TypeError("Archived artifact publication requires a bounded file list.");
          return change(async () => {
            const published = new Set();
            for (const file of files) {
              const relativePath = assertSafeArtifactPath(file.relativePath);
              if (published.has(relativePath)) throw new Error("Archived artifact publication repeats a path.");
              published.add(relativePath);
              const target = await archivedArtifactPath(archived, relativePath, { createParents: true });
              const sourcePath = path.resolve(file.sourcePath || "");
              if (!path.isAbsolute(file.sourcePath || "") || await realpath(sourcePath) !== sourcePath) {
                throw new Error("Archived artifact source must be an absolute regular file without symlink parents.");
              }
              const identity = await lstat(sourcePath);
              if (!identity.isFile()) throw new Error("Archived artifact source is not a regular file.");
              const source = await open(sourcePath, fsConstants.O_RDONLY | fsConstants.O_NOFOLLOW | fsConstants.O_NONBLOCK);
              const temporary = `${target}.${randomUUID()}.tmp`;
              try {
                const before = await source.stat();
                if (!before.isFile() || before.ino !== identity.ino || before.dev !== identity.dev) {
                  throw new Error("Archived artifact source changed before publication.");
                }
                const destination = await open(temporary, "wx", 0o600);
                try {
                  if (before.size) await destination.writeFile(source.createReadStream({ autoClose: false, end: before.size - 1 }));
                  await destination.sync();
                } finally { await destination.close(); }
                const after = await source.stat();
                if (before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) {
                  throw new Error("Archived artifact source changed during publication.");
                }
                await rename(temporary, target);
              } finally { await source.close(); await rm(temporary, { force: true }); }
            }
            await publishExtractedSessionArchive(archived, { beforeWork });
            return { ok: true, paths: [...published].sort() };
          });
        };
        const pruneArtifacts = async (relativePaths, { beforePrune } = {}) => {
          const requested = artifactExpiryRequest(relativePaths, beforePrune);
          return change(() => pruneExtractedArtifacts(archived, requested, { beforePrune, beforeWork }));
        };
        const pruneAttachments = async ({ beforePrune } = {}) => {
          if (typeof beforePrune !== "function") throw new TypeError("Attachment expiry requires a host callback.");
          return change(() => pruneExtractedAttachments(archived, { beforePrune, beforeWork }));
        };
        try { return await operation(archived, { publishArtifacts, pruneArtifacts, pruneAttachments }); }
        finally { available = false; }
      });
    });
  }

  async function archivedArtifactPath(session, relativePath, { createParents = false } = {}) {
    if (!(await lstat(session.sessionRoot)).isDirectory() || await realpath(session.sessionRoot) !== path.resolve(session.sessionRoot)) {
      throw new Error("Archived artifact root must be a regular directory without symlink parents.");
    }
    const target = artifactFilePath(session, relativePath);
    const parts = path.relative(session.sessionRoot, target).split(path.sep);
    let current = session.sessionRoot;
    for (let index = 0; index < parts.length; index++) {
      current = path.join(current, parts[index]);
      const parent = index < parts.length - 1;
      if (parent && createParents) await mkdir(current, { recursive: false }).catch((error) => { if (error.code !== "EEXIST") throw error; });
      const info = await lstat(current).catch((error) => { if (isMissingPathError(error)) return null; throw error; });
      if (!info) continue;
      if (info.isSymbolicLink() || (parent ? !info.isDirectory() : !info.isFile())) {
        throw new Error("Archived artifact paths must contain only regular directories and files.");
      }
    }
    return target;
  }

  async function publishExtractedSessionArchive(session, { beforePublish, beforeWork } = {}) {
    await beforeWork?.({ stage: "publish", archivePath: session.archivePath, sessionRoot: session.sessionRoot });
    const candidatePath = `${session.archivePath}.${randomUUID()}.tmp`;
    try {
      const result = await runCommand("tar", ["-czf", candidatePath, "-C", path.dirname(session.sessionRoot), session.sessionId], {
        allowedRoots: [path.dirname(session.sessionRoot), path.dirname(session.archivePath)], cwd: state.normalizedProjectContextRoot,
        execution: ARCHIVE_EXECUTIONS.write
      });
      if (!result.ok) {
        throw archiveCommandError(result, `Cannot prepare updated session archive: ${result.output}`,
          "vibe64_session_archive_write_failed");
      }
      await archiveRecords.validateSessionArchive(candidatePath);
      await beforePublish?.(candidatePath);
      const candidate = await open(candidatePath, "r");
      try { await candidate.sync(); } finally { await candidate.close(); }
      // Keep the archive index, metadata, messages and archival time unchanged.
      await rename(candidatePath, session.archivePath);
      const directory = await open(path.dirname(session.archivePath), "r");
      try { await directory.sync(); } finally { await directory.close(); }
    } finally { await rm(candidatePath, { force: true }); }
  }

  function artifactExpiryRequest(relativePaths, beforePrune) {
    if (typeof beforePrune !== "function") throw new TypeError("Artifact expiry requires a host callback.");
    if (!Array.isArray(relativePaths) || relativePaths.length > 1000) throw new TypeError("Artifact expiry requires a bounded exact path list.");
    return [...new Set(relativePaths.map(assertSafeArtifactPath))].sort();
  }

  async function pruneExtractedArtifacts(session, requested, { beforePrune, beforeWork }) {
    const removed = [];
    for (const relativePath of requested) {
      const target = await archivedArtifactPath(session, relativePath);
      try { await rm(target); removed.push(relativePath); }
      catch (error) { if (!isMissingPathError(error)) throw error; }
    }
    if (removed.length) {
      await publishExtractedSessionArchive(session, {
        beforeWork,
        beforePublish: async (candidatePath) => {
          const proof = await beforePrune({ session, relativePaths: removed, candidatePath });
          if (proof?.ok !== true) throw new Error("The host did not confirm artifact expiry.");
        }
      });
    }
    return { ok: true, paths: removed };
  }

  async function pruneExtractedAttachments(session, { beforePrune, beforeWork }) {
    const attachmentRoot = path.join(session.artifactsRoot, "attachments");
    const removed = [];
    for (const directory of [session.artifactsRoot, attachmentRoot]) {
      const info = await lstat(directory).catch((error) => { if (isMissingPathError(error)) return null; throw error; });
      if (!info) return { ok: true, attachmentIds: [] };
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error("Archived attachments must use regular directories.");
    }
    for (const entry of await readDirectoryEntries(attachmentRoot)) {
      if (!/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/iu.test(entry.name) || !entry.isDirectory()) {
        throw new Error("Archived attachments contain an unknown entry; inspect it before expiry.");
      }
      const payload = path.join(attachmentRoot, entry.name, "file");
      const info = await lstat(payload).catch((error) => { if (isMissingPathError(error)) return null; throw error; });
      if (!info) continue;
      if (!info.isFile() || info.isSymbolicLink()) throw new Error("Archived attachment payload is not a regular file.");
      await rm(payload);
      removed.push(entry.name);
    }
    if (!removed.length) return { ok: true, attachmentIds: [] };
    await publishExtractedSessionArchive(session, {
      beforeWork,
      beforePublish: async (candidatePath) => {
        const proof = await beforePrune({ session, attachmentIds: [...removed].sort(), candidatePath });
        if (proof?.ok !== true) throw new Error("The host did not confirm attachment expiry.");
      }
    });
    return { ok: true, attachmentIds: removed.sort() };
  }

  async function pruneArchivedSessionArtifacts(sessionId, { relativePaths, beforePrune, beforeWork } = {}) {
    artifactExpiryRequest(relativePaths, beforePrune);
    return withArchivedSession(sessionId, (_session, { pruneArtifacts }) => pruneArtifacts(relativePaths, { beforePrune }),
      { beforeWork });
  }

  async function pruneArchivedSessionAttachments(sessionId, { beforePrune, beforeWork } = {}) {
    if (typeof beforePrune !== "function") throw new TypeError("Attachment expiry requires a host callback.");
    return withArchivedSession(sessionId, (_session, { pruneAttachments }) => pruneAttachments({ beforePrune }),
      { beforeWork });
  }

  async function withPreparedRenewalSession(sessionId, operation) {
    if (typeof operation !== "function") {
      throw new TypeError("Prepared renewal session work requires an operation.");
    }
    const normalizedSessionId = assertValidVibe64SessionId(sessionId);
    const archiveRecord = await archiveRecords.readPreparedRenewalArchive(normalizedSessionId);
    if (!archiveRecord) {
      throw vibe64Error(
        `Renewal predecessor has no prepared archive: ${normalizedSessionId}`,
        "vibe64_session_renewal_archive_required"
      );
    }
    await archiveRecords.validateSessionArchive(archiveRecord.archivePath);
    return withExtractedSessionArchive(archiveRecord, async (sessionPaths, record) => {
      const session = await recordFiles.readSessionFromPaths(sessionPaths, record);
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
        status: await recordFiles.readStatusFromPaths(sessionPaths)
      });
      return operation(sessionPaths, archiveRecord);
    });
  }

  return Object.freeze({
    pruneArchivedSessionArtifacts,
    pruneArchivedSessionAttachments,
    readUnarchivedSessionIfPresent,
    withArchivedSession,
    withExtractedSessionArchive,
    withPreparedRenewalSession,
    withPublishedRenewalSession,
    withReadableSessionPaths,
    withReadableSessionPathsForRenewal
  });
}

export {
  createSessionArchiveAccess
};
