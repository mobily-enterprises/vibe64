import { VIBE64_UPLOAD_MAX_LABEL } from "@local/vibe64-core/shared";
import { BACKUP_RETENTION_MS, withProjectBackupsLock } from "@local/vibe64-runtime/server/projectBackups";
import crypto from "node:crypto";
import { createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { link, lstat, mkdir, rename, rm } from "node:fs/promises";
import path from "node:path";
import { isMissingPathError, normalizeText } from "@local/vibe64-core/server/core";
import { sourceEditorFilePolicy } from "./filePolicy.js";
import { sessionClosingReason } from "@local/vibe64-runtime/server/sessionLifecycle";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import {
  absoluteSourceEditorPath,
  directoryNode,
  downloadSessionFile,
  ensureSourceEditorParentDirectory,
  normalizeNewSourceEditorFilePath,
  normalizeSourceEditorRelativePath,
  readSourceEditorFile,
  runSourceEditorOperation,
  saveSourceEditorFile,
  sourceEditorDirectoryPage,
  sourceEditorError,
  sourceEditorPathStats,
  sourceEditorResultOffset
} from "./sourceFiles.js";

// Files areas (Session, Drop Zone and Backups): authorization, area-to-root
// resolution, locking and the per-operation file actions.
function createFileArea(projectService) {

  // Every Files request enters here inside the trusted project request context.
  // Operations receive a resolved root; neither HTTP bodies nor callers select it.
  async function fileArea(input, operation, { readUpload = null } = {}) {
    return runSourceEditorOperation(async () => {
      const requestContext = currentProjectRequestContext();
      if (!requestContext) {
        throw sourceEditorError("Files require a project request.", "vibe64_files_access_required", {}, 403);
      }
      const owner = !requestContext.vibe64User || requestContext.vibe64User.role === "owner";
      const area = String(input.area || "");
      const writable = ["drop-zone", "backups"].includes(area);
      const reads = ["tree", "file", "download", "archive"];
      const writes = ["upload", "save", "rename", "delete", "mkdir"];
      const writing = writes.includes(operation);
      if (operation !== "areas" && (
        !["session", "drop-zone", "backups"].includes(area) || (!reads.includes(operation) && !writing)
      )) {
        throw sourceEditorError("Unknown file area or operation.", "vibe64_files_invalid_area", {}, 404);
      }
      if (area === "session" && !owner) {
        throw sourceEditorError("Only the workspace owner can read Session files.", "vibe64_files_owner_required", {}, 403);
      }
      if (writing && !writable) {
        throw sourceEditorError("Session files are read only.", "vibe64_files_read_only", {}, 403);
      }
      const sessionId = normalizeText(input.sessionId);
      const runtime = await projectService.createRuntime({ sessionId });
      // This store belongs to the URL's project, so IDs from another project do
      // not resolve. Reading the summary also enforces renewal visibility.
      const session = await runtime.store.readSessionSummary(sessionId);
      if (operation === "areas") {
        return { ok: true, areas: ["repo", "drop-zone", "backups", ...(owner ? ["session"] : [])] };
      }
      const policy = {
        ...sourceEditorFilePolicy(),
        exclude: [],
        protectSourceContract: false,
        maxTreeDepth: Infinity,
        maxTreeEntries: Infinity
      };
      if (operation === "archive") {
        if (area !== "session" || !session.archivePath) {
          throw sourceEditorError("This session has no archive available.", "vibe64_files_archive_unavailable", {}, 404);
        }
        return downloadSessionFile({ sourceRoot: path.dirname(session.archivePath), policy }, path.basename(session.archivePath));
      }
      const perform = async (sessionPaths) => {
        const sourceRoot = area === "backups" ? sessionPaths.projectBackupsRoot
          : writable ? sessionPaths.dropZoneRoot : sessionPaths.sessionRoot;
        const context = { policy, sourceRoot, sourceEditorTempRoot: sourceRoot };
        await sourceEditorPathStats(sourceRoot);
        const relativePath = normalizeSourceEditorRelativePath(input.path);
        if (["mkdir", "delete", "rename"].includes(operation) && !relativePath) {
          throw sourceEditorError("Choose an item inside this folder.", "vibe64_invalid_source_editor_path");
        }
        switch (operation) {
          case "tree": {
            const tree = await sourceEditorDirectoryPage(context, {
              path: relativePath, offset: sourceEditorResultOffset(input.offset)
            });
            if (area === "backups") {
              for (const entry of tree.children) {
                if (entry.type !== "file") continue;
                const info = await sourceEditorPathStats(sourceRoot, entry.path);
                entry.expiresAt = new Date(Math.max(info.mtimeMs, info.ctimeMs) + BACKUP_RETENTION_MS).toISOString();
              }
            }
            return { ok: true, location: writable ? sourceRoot : "", tree };
          }
          case "file":
            return { ok: true, file: await readSourceEditorFile(context, relativePath) };
          case "download":
            return downloadSessionFile(context, relativePath);
          case "save":
            return { ok: true, file: { ...await saveSourceEditorFile(context, input), text: String(input.text ?? "") } };
          case "upload":
            return uploadDropZoneFile(context, input, readUpload);
          case "mkdir":
            await ensureSourceEditorParentDirectory(context, relativePath);
            return { ok: true };
          case "delete":
            await sourceEditorPathStats(sourceRoot, relativePath);
            await rm(absoluteSourceEditorPath(sourceRoot, relativePath), { recursive: true });
            return { ok: true };
          case "rename": {
            await sourceEditorPathStats(sourceRoot, relativePath);
            const destination = normalizeNewSourceEditorFilePath(input.destination);
            const parent = path.posix.dirname(destination);
            await sourceEditorPathStats(sourceRoot, parent === "." ? "" : parent);
            const target = absoluteSourceEditorPath(sourceRoot, destination);
            try {
              await lstat(target);
              throw sourceEditorError("An item already exists at that path.", "vibe64_files_exists", {}, 409);
            } catch (error) {
              if (!isMissingPathError(error)) throw error;
            }
            await rename(absoluteSourceEditorPath(sourceRoot, relativePath), target);
            return { ok: true };
          }
        }
      };
      if (area === "backups") {
        const paths = runtime.store.paths(sessionId);
        if (!writing) {
          try { return await perform(paths); }
          catch (error) {
            if (!isMissingPathError(error) || input.path || operation !== "tree") throw error;
            return { ok: true, location: paths.projectBackupsRoot, tree: directoryNode("", [], { loaded: true }) };
          }
        }
        return withProjectBackupsLock(paths.stateRoot, async () => {
          await mkdir(paths.projectBackupsRoot, { recursive: true, mode: 0o700 });
          return perform(paths);
        });
      }
      const livePaths = session.sessionRoot ? {
        sessionRoot: session.sessionRoot,
        dropZoneRoot: path.join(session.sessionRoot, "drop-zone")
      } : null;
      if (!writable) {
        return livePaths ? perform(livePaths) : runtime.store.withReadableSessionPaths(sessionId, perform);
      }
      if (!session.sessionRoot) {
        if (operation === "tree") return { ok: true, expired: true, tree: directoryNode("", [], { loaded: true }) };
        throw sourceEditorError("This session's Drop Zone has expired.", "vibe64_files_expired", {}, 410);
      }
      if (!writing) {
        // Normal reads do not mutate session metadata. Older live sessions get
        // their missing Drop Zone once, under the same archival mutation lease.
        try {
          await lstat(livePaths.dropZoneRoot);
          return perform(livePaths);
        } catch (error) {
          if (!isMissingPathError(error)) throw error;
        }
      }
      return runtime.store.mutateSession(sessionId, async (sessionPaths) => {
        const current = await runtime.store.readSessionSummary(sessionId);
        if (sessionClosingReason(current) || current.status === "archived") {
          throw sourceEditorError("The Drop Zone is unavailable while this session closes.", "vibe64_session_closing", {}, 409);
        }
        await mkdir(sessionPaths.dropZoneRoot, { recursive: true });
        return perform(sessionPaths);
      });
    });
  }

  return fileArea;
}

async function uploadDropZoneFile(context, input, readUpload) {
  if (typeof readUpload !== "function") throw sourceEditorError("Choose a file to upload.", "vibe64_files_upload_required");
  const relativePath = normalizeNewSourceEditorFilePath(input.path);
  const parent = path.posix.dirname(relativePath);
  await sourceEditorPathStats(context.sourceRoot, parent === "." ? "" : parent);
  const target = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  const staged = path.join(context.sourceRoot, `.upload-${crypto.randomUUID()}`);
  try {
    let count = 0;
    for await (const part of readUpload()) {
      if (++count !== 1 || part.type !== "file" || part.fieldname !== "file") {
        part.file?.resume();
        throw sourceEditorError("Upload exactly one file.", "vibe64_files_invalid_upload");
      }
      // Multipart limits can close the stream before the iterator yields it.
      if (part.file.destroyed) {
        throw sourceEditorError("Upload was interrupted or exceeded the allowed limits.", "vibe64_files_invalid_upload");
      }
      await pipeline(part.file, createWriteStream(staged, { flags: "wx", mode: vibe64SharedModes().file }));
      if (part.file.truncated) throw sourceEditorError(`Upload exceeds the ${VIBE64_UPLOAD_MAX_LABEL} limit.`, "vibe64_files_upload_too_large", {}, 413);
    }
    if (count !== 1) throw sourceEditorError("Choose a file to upload.", "vibe64_files_upload_required");
    // Publish without overwriting or making another temporary copy.
    try {
      await link(staged, target);
    } catch (error) {
      if (error.code === "EEXIST") throw sourceEditorError("An item already exists at that path. Rename it or delete it before uploading again.", "vibe64_files_exists", {}, 409);
      throw error;
    }
    return { ok: true, path: relativePath };
  } catch (error) {
    if (error.code === "FST_REQ_FILE_TOO_LARGE") {
      throw sourceEditorError(`Upload exceeds the ${VIBE64_UPLOAD_MAX_LABEL} limit.`, "vibe64_files_upload_too_large", {}, 413);
    }
    throw error;
  } finally {
    await rm(staged, { force: true });
  }
}

export {
  createFileArea
};
