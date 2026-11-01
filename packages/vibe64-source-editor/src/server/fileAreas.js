import { createWriteStream } from "node:fs";
import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { VIBE64_UPLOAD_MAX_LABEL } from "@local/vibe64-core/shared";
import { isMissingPathError } from "@local/vibe64-core/server/core";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { toText } from "@local/vibe64-core/shared/toText";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { BACKUP_RETENTION_MS, withProjectBackupsLock, withProjectDropZoneLock } from "@local/vibe64-runtime/server/projectBackups";
import { sessionClosingReason } from "@local/vibe64-runtime/server/sessionLifecycle";
import { sourceEditorFilePolicy, sourceEditorPathExcluded } from "./filePolicy.js";
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
import {
  existsError,
  folderOf,
  joinRelative,
  pathExists,
  protectedError
} from "./fileAreaItems.js";
import {
  STAGING_FOLDER,
  publishStaged,
  removeStaleStaging,
  repoStagingFolder,
  stagedItem,
  withAreaFolder,
  withStaging
} from "./fileAreaStaging.js";
import { resolveTarget, transferEntry } from "./fileAreaTransfer.js";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

// Files areas: authorization, area-to-root resolution, locking and the
// per-operation file actions. Staging is in fileAreaStaging.js and server-side
// move and copy between areas in fileAreaTransfer.js.
// Repo's own browsing and editing belong to the source editor; Files reaches
// Repo only to list destination folders, upload, and move or copy items.
const FILE_AREAS = Object.freeze({
  repo: { scope: "session", operations: ["tree", "conflicts", "upload", "transfer"] },
  "drop-zone": { scope: "session" },
  session: { scope: "session", ownerOnly: true, readOnly: true },
  "project-drop-zone": { scope: "project" },
  backups: { scope: "project" }
});
const WRITES = ["upload", "create", "save", "rename", "delete", "mkdir", "transfer"];
// A finished Repo upload waits this long for Save, Update or another source
// change to let go of the exclusive write before it reports busy.
const REPO_PUBLISH_WAIT_MS = 30_000;
const CONFLICT_NAMES_MAX = 500;

/**
 * @param {ProjectService} project
 * @param {object} options
 * @param {(sourceRoot: string) => void} options.repoChanged
 */
function createFileArea(project, { repoChanged }) {

  /**
   * Opens one area for this request: checks the caller and operation, resolves
   * its trusted root and returns run(perform), which holds the area's lock.
   */
  async function openArea({ runtime, area, sessionId, owner, operation, write }) {
    const definition = FILE_AREAS[area];
    if (!definition || (definition.operations && !definition.operations.includes(operation))) {
      throw sourceEditorError("Unknown file area or operation.", "vibe64_files_invalid_area", {}, 404);
    }
    if (definition.ownerOnly && !owner) {
      throw sourceEditorError("Only the workspace owner can read Session files.", "vibe64_files_owner_required", {}, 403);
    }
    if (write && definition.readOnly) {
      throw sourceEditorError("Session files are read only.", "vibe64_files_read_only", {}, 403);
    }
    // This store belongs to the URL's project, so IDs from another project do
    // not resolve. Reading the summary also enforces renewal visibility.
    const session = sessionId ? await runtime.store.readSessionSummary(sessionId) : null;
    if (definition.scope === "session" && !session) {
      throw sourceEditorError("Choose a session for this file area.", "vibe64_files_session_required", {}, 400);
    }
    const key = definition.scope === "session" ? `${area}:${session.sessionId}` : area;
    const policy = area === "repo" ? sourceEditorFilePolicy() : {
      ...sourceEditorFilePolicy(),
      exclude: [`${STAGING_FOLDER}/**`],
      protectSourceContract: false,
      maxTreeDepth: Infinity,
      maxTreeEntries: Infinity
    };
    const context = (sourceRoot, extra = {}) => ({ area, policy, sourceRoot, sourceEditorTempRoot: sourceRoot, ...extra });

    if (definition.scope === "project") {
      const { stateRoot, projectBackupsRoot, projectDropZoneRoot } = runtime.store.paths();
      const root = area === "backups" ? projectBackupsRoot : projectDropZoneRoot;
      const rootStats = await lstat(root).catch((error) => {
        if (isMissingPathError(error)) return null;
        throw error;
      });
      if (rootStats && !rootStats.isDirectory()) {
        throw sourceEditorError(
          `This area's folder “${root}” is not a folder. Move that item away, then try again.`,
          "vibe64_files_area_not_folder",
          { path: root },
          409
        );
      }
      /**
       * Reads never create the folder; a missing one is simply empty.
       */
      if (!write) return { key, session, run: (perform) => perform(context(root, { location: root, missing: !rootStats })) };
      await mkdir(root, { recursive: true, mode: vibe64SharedModes().directory });
      const writeContext = context(root, { location: root, staging: STAGING_FOLDER });
      // Each project area's writes share one lock; Backups' also covers retention.
      const lock = area === "backups" ? withProjectBackupsLock : withProjectDropZoneLock;
      const run = (perform) => lock(stateRoot, async () => {
        await removeStaleStaging(writeContext);
        return perform(writeContext);
      });
      /**
       * An upload streams in without the lock and takes it only to publish.
       */
      return { key, session, run, receive: (perform) => perform({ ...writeContext, publish: run }) };
    }

    if (area === "repo") {
      const root = sessionSourcePath(session);
      if (!root) {
        throw sourceEditorError("This session has no Repo files.", "vibe64_source_editor_source_unavailable", {}, 409);
      }
      if (!write) return { key, session, run: (perform) => perform(context(root)) };
      const writeContext = context(root, { staging: await repoStagingFolder(root) });
      /**
       * Repo writes take the same exclusive source write as the source editor;
       * a move or copy refuses rather than waits while it is held.
       */
      const run = async (perform, options = {}) => {
        const { waitMs = 0 } = options;
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          await removeStaleStaging(writeContext);
          try {
            return await perform(writeContext);
          } finally {
            repoChanged(root);
          }
        }, { operation: "source-editor-write", waitMs });
        if (!exclusive.acquired) {
          throw sourceEditorError(
            toText(exclusive.value?.error) ||
            "Another source-changing operation is starting. Try again in a moment.",
            toText(exclusive.value?.code) || "vibe64_source_editor_write_busy",
            {},
            409
          );
        }
        return exclusive.value;
      };
      /**
       * An upload streams in without the exclusive write, so Save, Update and
       * the assistant never wait on it; it takes the write only to publish,
       * waiting briefly for one of them to finish.
       */
      const publish = (perform) => run(perform, { waitMs: REPO_PUBLISH_WAIT_MS });
      return { key, session, run, receive: (perform) => perform({ ...writeContext, publish }) };
    }

    if (area === "session") {
      return {
        key,
        session,
        run: (perform) => session.sessionRoot ? perform(context(session.sessionRoot))
          : runtime.store.withReadableSessionPaths(sessionId, (sessionPaths) => perform(context(sessionPaths.sessionRoot)))
      };
    }

    if (!session.sessionRoot) {
      if (operation === "tree") return { key, session, run: (perform) => perform({ expired: true }) };
      throw sourceEditorError("This session's Drop Zone has expired.", "vibe64_files_expired", {}, 410);
    }
    const liveRoot = path.join(session.sessionRoot, "drop-zone");
    return {
      key,
      session,
      run: async (perform) => {
        if (!write) {
        // Normal reads do not mutate session metadata. Older live sessions get
        // their missing Drop Zone once, under the same archival mutation lease.
          try {
            await lstat(liveRoot);
            return perform(context(liveRoot, { location: liveRoot }));
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
          const dropZone = context(sessionPaths.dropZoneRoot, { location: sessionPaths.dropZoneRoot, staging: STAGING_FOLDER });
          if (write) await removeStaleStaging(dropZone);
          return perform(dropZone);
        });
      }
    };
  }

  /**
   * Every Files operation enters here inside the trusted project request context.
   * Operations receive resolved roots; neither HTTP bodies nor callers select them.
   */
  async function runFileArea(input, operation, readUpload) {
    return runSourceEditorOperation(async () => {
      const requestContext = currentProjectRequestContext();
      if (!requestContext) {
        throw sourceEditorError("Files require a project request.", "vibe64_files_access_required", {}, 403);
      }
      const owner = !requestContext.vibe64User || requestContext.vibe64User.role === "owner";
      const sessionId = toText(input.sessionId);
      const runtime = await project.createRuntime({ sessionId });
      if (operation === "areas") {
        await runtime.store.readSessionSummary(sessionId);
        return { ok: true, areas: ["repo", "drop-zone", ...(owner ? ["session"] : [])] };
      }
      const area = String(input.area || "");
      if (operation === "transfer") {
        const mode = input.mode === "move" ? "move" : "copy";
        const targetSessionId = toText(input.targetSessionId) || sessionId;
        // Only project areas send into another session, so a transfer never
        // holds two sessions' leases at once.
        if (targetSessionId !== sessionId && FILE_AREAS[area]?.scope !== "project") {
          throw sourceEditorError(
            "Move or copy within this session or into the project's areas.",
            "vibe64_files_invalid_destination",
            {},
            400
          );
        }
        const from = await openArea({ runtime, area, sessionId, owner, operation, write: mode === "move" });
        const to = await openArea({
          runtime,
          area: String(input.targetArea || ""),
          sessionId: targetSessionId,
          owner,
          operation,
          write: true
        });
        // One area is locked once; otherwise the source is held, then the destination.
        if (from.key === to.key) return to.run((target) => transferEntry(target, target, input, mode));
        return from.run((source) => to.run((target) => transferEntry(source, target, input, mode)));
      }
      const opened = await openArea({ runtime, area, sessionId, owner, operation, write: WRITES.includes(operation) });
      if (operation === "archive") {
        if (area !== "session" || !opened.session.archivePath) {
          throw sourceEditorError("This session has no archive available.", "vibe64_files_archive_unavailable", {}, 404);
        }
        const policy = { ...sourceEditorFilePolicy(), exclude: [], protectSourceContract: false };
        return downloadSessionFile({
          sourceRoot: path.dirname(opened.session.archivePath),
          policy
        }, path.basename(opened.session.archivePath));
      }
      // Areas that can receive an upload before taking their lock do so.
      const enter = operation === "upload" && opened.receive ? opened.receive : opened.run;
      return enter((context) => areaOperation(operation, context, input, readUpload));
    });
  }

  /**
   * The file areas this caller may open in the session.
   * @param {object} input
   */
  function readFileAreas(input) {
    return runFileArea(input, "areas");
  }

  /**
   * One page of a folder in an area.
   * @param {object} input
   */
  function readAreaTree(input) {
    return runFileArea(input, "tree");
  }

  /**
   * A text file in an area.
   * @param {object} input
   */
  function readAreaFile(input) {
    return runFileArea(input, "file");
  }

  /**
   * An area file's original bytes, as an open handle for the download transport.
   * @param {object} input
   */
  function downloadAreaFile(input) {
    return runFileArea(input, "download");
  }

  /**
   * The session's archive, from the Session area, as an open handle for the download transport.
   * @param {object} input
   */
  function downloadAreaArchive(input) {
    return runFileArea(input, "archive");
  }

  /**
   * The names among input.names that already exist in a folder of an area.
   * @param {object} input
   */
  function findAreaConflicts(input) {
    return runFileArea(input, "conflicts");
  }

  /**
   * Receives one uploaded file into an area.
   * @param {object} input
   * @param {object} [options]
   * @param {() => AsyncIterable<object>} [options.readUpload] The transport's multipart reader.
   */
  function uploadAreaFile(input, options = {}) {
    const { readUpload } = options;
    return runFileArea(input, "upload", readUpload);
  }

  /**
   * Creates a text file in an area.
   * @param {object} input
   */
  function createAreaFile(input) {
    return runFileArea(input, "create");
  }

  /**
   * Saves a text file in an area against its base hash.
   * @param {object} input
   */
  function saveAreaFile(input) {
    return runFileArea(input, "save");
  }

  /**
   * Renames an item within an area.
   * @param {object} input
   */
  function renameAreaItem(input) {
    return runFileArea(input, "rename");
  }

  /**
   * Creates a folder in an area.
   * @param {object} input
   */
  function createAreaFolder(input) {
    return runFileArea(input, "mkdir");
  }

  /**
   * Deletes an item from an area.
   * @param {object} input
   */
  function deleteAreaItem(input) {
    return runFileArea(input, "delete");
  }

  /**
   * Moves or copies an item between areas without downloading it.
   * @param {object} input
   */
  function transferAreaItem(input) {
    return runFileArea(input, "transfer");
  }

  return Object.freeze({
    readFileAreas,
    readAreaTree,
    readAreaFile,
    downloadAreaFile,
    downloadAreaArchive,
    findAreaConflicts,
    uploadAreaFile,
    createAreaFile,
    saveAreaFile,
    renameAreaItem,
    createAreaFolder,
    deleteAreaItem,
    transferAreaItem
  });
}

async function areaOperation(operation, context, input, readUpload) {
  if (context.expired) return { ok: true, expired: true, tree: directoryNode("", [], { loaded: true }) };
  const { sourceRoot } = context;
  const relativePath = normalizeSourceEditorRelativePath(input.path);
  if (context.missing) {
    if (operation === "tree" && !relativePath) return {
      ok: true,
      location: context.location,
      tree: directoryNode("", [], { loaded: true })
    };
    if (operation === "conflicts" && !relativePath) return { ok: true, existing: [] };
  }
  await sourceEditorPathStats(sourceRoot);
  if (["mkdir", "delete", "rename"].includes(operation) && !relativePath) {
    throw sourceEditorError("Choose an item inside this folder.", "vibe64_invalid_source_editor_path");
  }
  for (const item of [relativePath, operation === "rename" ? normalizeSourceEditorRelativePath(input.destination) : ""]) {
    if (item && sourceEditorPathExcluded(context.policy, item)) throw protectedError(item);
  }
  switch (operation) {
    case "tree": {
      const tree = await sourceEditorDirectoryPage(context, {
        path: relativePath,
        offset: sourceEditorResultOffset(input.offset)
      });
      if (context.area === "backups") {
        for (const entry of tree.children) {
          if (entry.type !== "file") continue;
          const info = await sourceEditorPathStats(sourceRoot, entry.path);
          entry.expiresAt = new Date(Math.max(info.mtimeMs, info.ctimeMs) + BACKUP_RETENTION_MS).toISOString();
        }
      }
      return { ok: true, location: context.location || "", tree };
    }
    case "file":
      return { ok: true, file: await readSourceEditorFile(context, relativePath) };
    case "download":
      return downloadSessionFile(context, relativePath);
    case "save":
      return { ok: true, file: { ...await saveSourceEditorFile(context, input), text: String(input.text ?? "") } };
    case "create":
      return createAreaTextFile(context, input);
    case "upload":
      return uploadIntoArea(context, input, readUpload);
    case "conflicts":
      return { ok: true, existing: await existingNames(context, relativePath, input.names) };
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
      await sourceEditorPathStats(sourceRoot, folderOf(destination));
      const target = absoluteSourceEditorPath(sourceRoot, destination);
      if (await pathExists(target)) throw existsError(path.posix.basename(destination));
      await rename(absoluteSourceEditorPath(sourceRoot, relativePath), target);
      return { ok: true };
    }
  }
}

/**
 * The names among `names` that already exist in a folder, so one question can
 * cover a whole upload or transfer.
 */
async function existingNames(context, folder, names = []) {
  const list = Array.isArray(names) ? names : [];
  if (list.length > CONFLICT_NAMES_MAX) {
    throw sourceEditorError("Check fewer names at once.", "vibe64_files_too_many_names", {}, 413);
  }
  if (!(await sourceEditorPathStats(context.sourceRoot, folder)).isDirectory()) {
    throw sourceEditorError("Choose a folder.", "vibe64_invalid_source_editor_path");
  }
  const existing = [];
  for (const name of list) {
    const candidate = normalizeNewSourceEditorFilePath(name);
    if (candidate.includes("/")) throw sourceEditorError("Names cannot include folders.", "vibe64_invalid_source_editor_path");
    if (await pathExists(absoluteSourceEditorPath(context.sourceRoot, joinRelative(folder, candidate)))) existing.push(candidate);
  }
  return existing;
}

async function createAreaTextFile(context, input) {
  const relativePath = normalizeNewSourceEditorFilePath(input.path);
  const content = Buffer.from(String(input.text ?? ""), "utf8");
  if (content.byteLength > context.policy.maxFileBytes) {
    throw sourceEditorError("The new file is too large for the text editor.", "vibe64_source_editor_file_too_large", {}, 413);
  }
  if (content.includes(0)) {
    throw sourceEditorError("A new file must contain text.", "vibe64_source_editor_binary_file", {}, 415);
  }
  await withAreaFolder(context, folderOf(relativePath), (destination) => withStaging(context, async (staging) => {
    const staged = stagedItem(staging);
    try {
      await writeFile(staged, content, { flag: "wx", mode: vibe64SharedModes().file });
      await publishStaged(context, staging, staged, destination.at(path.posix.basename(relativePath)));
    } finally {
      await rm(staged, { force: true });
    }
  }));
  return { ok: true, file: await readSourceEditorFile(context, relativePath) };
}

async function uploadIntoArea(context, input, readUpload) {
  if (typeof readUpload !== "function") throw sourceEditorError("Choose a file to upload.", "vibe64_files_upload_required");
  const requested = normalizeNewSourceEditorFilePath(input.path);
  if (sourceEditorPathExcluded(context.policy, requested)) throw protectedError(requested);
  const folder = folderOf(requested);
  if (!(await sourceEditorPathStats(context.sourceRoot, folder)).isDirectory()) {
    throw sourceEditorError("Choose a folder to upload into.", "vibe64_invalid_source_editor_path");
  }
  return withStaging(context, (staging) => receiveUpload(context, staging, input, readUpload, requested));
}

async function receiveUpload(context, staging, input, readUpload, requested) {
  const folder = folderOf(requested);
  const staged = stagedItem(staging);
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
      if (part.file.truncated) {
        throw sourceEditorError(`Upload exceeds the ${VIBE64_UPLOAD_MAX_LABEL} limit.`, "vibe64_files_upload_too_large", {}, 413);
      }
    }
    if (count !== 1) throw sourceEditorError("Choose a file to upload.", "vibe64_files_upload_required");
    // Areas that receive without their lock publish under it, into the
    // folder as it is then.
    const publish = context.publish || ((perform) => perform(context));
    return await publish((current) => withAreaFolder(current, folder, async (destination) => {
      const target = await resolveTarget(current, destination, folder, path.posix.basename(requested), input.conflict);
      await publishStaged(current, staging, staged, destination.at(path.posix.basename(target.relativePath)), { replace: target.replace });
      return { ok: true, path: target.relativePath };
    }));
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
