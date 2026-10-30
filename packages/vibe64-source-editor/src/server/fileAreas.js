import { VIBE64_UPLOAD_MAX_LABEL } from "@local/vibe64-core/shared";
import { BACKUP_RETENTION_MS, withProjectBackupsLock } from "@local/vibe64-runtime/server/projectBackups";
import crypto from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { link, lstat, mkdir, open, readdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMissingPathError, normalizeText } from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { sourceEditorFilePolicy, sourceEditorPathExcluded } from "./filePolicy.js";
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

// Files areas: authorization, area-to-root resolution, locking, the
// per-operation file actions and server-side move and copy between areas.
// Repo's own browsing and editing belong to the source editor; Files reaches
// Repo only to list destination folders and to move or copy items.
const FILE_AREAS = Object.freeze({
  repo: { scope: "session", operations: ["tree", "conflicts", "transfer"] },
  "drop-zone": { scope: "session" },
  session: { scope: "session", ownerOnly: true, readOnly: true },
  "project-drop-zone": { scope: "project" },
  backups: { scope: "project" }
});
const READS = ["tree", "file", "download", "archive", "conflicts"];
const WRITES = ["upload", "create", "save", "rename", "delete", "mkdir", "transfer"];
// Incoming files and folders are written under this hidden name beside their
// destination and published by rename or link, so readers never see a partial item.
const STAGING_PREFIX = ".vibe64-incoming-";
const TRANSFER_MAX_ENTRIES = 10_000;
const CONFLICT_NAMES_MAX = 500;

function createFileArea(projectService, { repoChanged = () => {} } = {}) {

  // Opens one area for this request: checks the caller and operation, resolves
  // its trusted root and returns run(perform), which holds the area's lock.
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
      ...sourceEditorFilePolicy(), exclude: [], protectSourceContract: false, maxTreeDepth: Infinity, maxTreeEntries: Infinity
    };
    const context = (sourceRoot, extra = {}) => ({ area, policy, sourceRoot, sourceEditorTempRoot: sourceRoot, ...extra });

    if (definition.scope === "project") {
      const { stateRoot, projectBackupsRoot, projectDropZoneRoot } = runtime.store.paths();
      const root = area === "backups" ? projectBackupsRoot : projectDropZoneRoot;
      if (!write) {
        // Reads never create the folder; a missing one is simply empty.
        return { key, session, run: async (perform) => perform(context(root, {
          location: root,
          missing: await lstat(root).then(() => false, (error) => {
            if (isMissingPathError(error)) return true;
            throw error;
          })
        })) };
      }
      const prepare = async (perform) => {
        await mkdir(root, { recursive: true, ...(area === "backups" ? { mode: 0o700 } : {}) });
        return perform(context(root, { location: root }));
      };
      // Project Backups mutations share one lock with retention maintenance.
      return { key, session, run: (perform) => area === "backups" ? withProjectBackupsLock(stateRoot, () => prepare(perform)) : prepare(perform) };
    }

    if (area === "repo") {
      const root = sessionSourcePath(session);
      if (!root) {
        throw sourceEditorError("This session has no Repo files.", "vibe64_source_editor_source_unavailable", {}, 409);
      }
      if (!write) return { key, session, run: (perform) => perform(context(root)) };
      // Repo writes take the same exclusive source write as the source editor.
      return { key, session, run: async (perform) => {
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          try {
            return await perform(context(root));
          } finally {
            repoChanged(root);
          }
        }, { operation: "source-editor-write" });
        if (!exclusive.acquired) {
          throw sourceEditorError(normalizeText(exclusive.value?.error) || "Another source-changing operation is starting. Try again in a moment.",
            normalizeText(exclusive.value?.code) || "vibe64_source_editor_write_busy", {}, 409);
        }
        return exclusive.value;
      } };
    }

    if (area === "session") {
      return { key, session, run: (perform) => session.sessionRoot ? perform(context(session.sessionRoot))
        : runtime.store.withReadableSessionPaths(sessionId, (sessionPaths) => perform(context(sessionPaths.sessionRoot))) };
    }

    if (!session.sessionRoot) {
      if (operation === "tree") return { key, session, run: (perform) => perform({ expired: true }) };
      throw sourceEditorError("This session's Drop Zone has expired.", "vibe64_files_expired", {}, 410);
    }
    const liveRoot = path.join(session.sessionRoot, "drop-zone");
    return { key, session, run: async (perform) => {
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
        return perform(context(sessionPaths.dropZoneRoot, { location: sessionPaths.dropZoneRoot }));
      });
    } };
  }

  // Every Files request enters here inside the trusted project request context.
  // Operations receive resolved roots; neither HTTP bodies nor callers select them.
  async function fileArea(input, operation, { readUpload = null } = {}) {
    return runSourceEditorOperation(async () => {
      const requestContext = currentProjectRequestContext();
      if (!requestContext) {
        throw sourceEditorError("Files require a project request.", "vibe64_files_access_required", {}, 403);
      }
      const owner = !requestContext.vibe64User || requestContext.vibe64User.role === "owner";
      const sessionId = normalizeText(input.sessionId);
      const runtime = await projectService.createRuntime({ sessionId });
      if (operation === "areas") {
        await runtime.store.readSessionSummary(sessionId);
        return { ok: true, areas: ["repo", "drop-zone", ...(owner ? ["session"] : [])] };
      }
      const area = String(input.area || "");
      if (!READS.includes(operation) && !WRITES.includes(operation)) {
        throw sourceEditorError("Unknown file area or operation.", "vibe64_files_invalid_area", {}, 404);
      }
      if (operation === "transfer") {
        const mode = input.mode === "move" ? "move" : "copy";
        const targetSessionId = normalizeText(input.targetSessionId) || sessionId;
        // Only project areas send into another session, so a transfer never
        // holds two sessions' leases at once.
        if (targetSessionId !== sessionId && FILE_AREAS[area]?.scope !== "project") {
          throw sourceEditorError("Move or copy within this session or into the project's areas.", "vibe64_files_invalid_destination", {}, 400);
        }
        const from = await openArea({ runtime, area, sessionId, owner, operation, write: mode === "move" });
        const to = await openArea({ runtime, area: String(input.targetArea || ""), sessionId: targetSessionId, owner, operation, write: true });
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
        return downloadSessionFile({ sourceRoot: path.dirname(opened.session.archivePath), policy }, path.basename(opened.session.archivePath));
      }
      return opened.run((context) => areaOperation(operation, context, input, readUpload));
    });
  }

  return fileArea;
}

async function areaOperation(operation, context, input, readUpload) {
  if (context.expired) return { ok: true, expired: true, tree: directoryNode("", [], { loaded: true }) };
  const { sourceRoot } = context;
  const relativePath = normalizeSourceEditorRelativePath(input.path);
  if (context.missing) {
    if (operation === "tree" && !relativePath) return { ok: true, location: context.location, tree: directoryNode("", [], { loaded: true }) };
    if (operation === "conflicts" && !relativePath) return { ok: true, existing: [] };
  }
  await sourceEditorPathStats(sourceRoot);
  if (["mkdir", "delete", "rename"].includes(operation) && !relativePath) {
    throw sourceEditorError("Choose an item inside this folder.", "vibe64_invalid_source_editor_path");
  }
  switch (operation) {
    case "tree": {
      const tree = await sourceEditorDirectoryPage(context, {
        path: relativePath, offset: sourceEditorResultOffset(input.offset)
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
      return uploadAreaFile(context, input, readUpload);
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

function existsError(name) {
  return sourceEditorError(`“${name}” already exists in this folder.`, "vibe64_files_exists", { name }, 409);
}

async function pathExists(absolutePath) {
  return lstat(absolutePath).then(() => true, (error) => {
    if (isMissingPathError(error)) return false;
    throw error;
  });
}

function stagingPath(directory) {
  return path.join(directory, `${STAGING_PREFIX}${crypto.randomUUID()}`);
}

function folderOf(relativePath) {
  const parent = path.posix.dirname(relativePath);
  return parent === "." ? "" : parent;
}

function joinRelative(folder, name) {
  return folder ? `${folder}/${name}` : name;
}

// The names among `names` that already exist in a folder, so one question can
// cover a whole upload or transfer.
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

// "report (1).pdf", "report (2).pdf", …: the first free name beside the original.
async function availableName(directory, name) {
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let number = 1; number < 1000; number += 1) {
    const candidate = `${stem} (${number})${extension}`;
    if (!(await pathExists(path.join(directory, candidate)))) return candidate;
  }
  throw sourceEditorError("Too many items with this name already exist here.", "vibe64_files_exists", { name }, 409);
}

// Where an incoming item goes under the chosen conflict rule: fail (the
// default), replace, keep both under a free name, or skip.
async function resolveTarget(context, folder, name, conflict = "fail") {
  const relativePath = joinRelative(folder, name);
  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  if (!(await pathExists(absolutePath))) return { relativePath };
  if (conflict === "skip") return { relativePath, skipped: true };
  if (conflict === "replace") return { relativePath, replace: true };
  if (conflict === "keep-both") return { relativePath: joinRelative(folder, await availableName(path.dirname(absolutePath), name)) };
  throw existsError(name);
}

// Publishes a completely written staged item. Without replace it never
// overwrites: files publish by hard link, folders only into a free name.
// Replacing sets the old item aside until the new one is in place.
async function publishStaged(staged, target, { replace = false, directory = false } = {}) {
  if (!replace) {
    if (directory) {
      if (await pathExists(target)) throw existsError(path.basename(target));
      await rename(staged, target);
      return;
    }
    try {
      await link(staged, target);
    } catch (error) {
      if (error.code === "EEXIST") throw existsError(path.basename(target));
      throw error;
    }
    await rm(staged, { force: true });
    return;
  }
  const current = await lstat(target).catch((error) => {
    if (isMissingPathError(error)) return null;
    throw error;
  });
  if (!current || (!directory && current.isFile())) {
    await rename(staged, target);
    return;
  }
  const aside = stagingPath(path.dirname(target));
  await rename(target, aside);
  try {
    await rename(staged, target);
  } catch (error) {
    await rename(aside, target).catch(() => null);
    throw error;
  }
  await rm(aside, { recursive: true, force: true });
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
  const folder = folderOf(relativePath);
  if (!(await sourceEditorPathStats(context.sourceRoot, folder)).isDirectory()) {
    throw sourceEditorError("Choose a folder.", "vibe64_invalid_source_editor_path");
  }
  const staged = stagingPath(absoluteSourceEditorPath(context.sourceRoot, folder));
  try {
    await writeFile(staged, content, { flag: "wx", mode: vibe64SharedModes().file });
    await publishStaged(staged, absoluteSourceEditorPath(context.sourceRoot, relativePath));
  } finally {
    await rm(staged, { force: true });
  }
  return { ok: true, file: await readSourceEditorFile(context, relativePath) };
}

async function uploadAreaFile(context, input, readUpload) {
  if (typeof readUpload !== "function") throw sourceEditorError("Choose a file to upload.", "vibe64_files_upload_required");
  const requested = normalizeNewSourceEditorFilePath(input.path);
  const folder = folderOf(requested);
  await sourceEditorPathStats(context.sourceRoot, folder);
  const staged = stagingPath(absoluteSourceEditorPath(context.sourceRoot, folder));
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
    const target = await resolveTarget(context, folder, path.posix.basename(requested), input.conflict);
    await publishStaged(staged, absoluteSourceEditorPath(context.sourceRoot, target.relativePath), { replace: target.replace });
    return { ok: true, path: target.relativePath };
  } catch (error) {
    if (error.code === "FST_REQ_FILE_TOO_LARGE") {
      throw sourceEditorError(`Upload exceeds the ${VIBE64_UPLOAD_MAX_LABEL} limit.`, "vibe64_files_upload_too_large", {}, 413);
    }
    throw error;
  } finally {
    await rm(staged, { force: true });
  }
}

// The regular files and folders a transfer carries. Links, special files and
// paths either area protects are refused, so move and copy behave alike.
async function transferPlan(context, sourcePath, stats) {
  if (stats.isFile()) return [{ relative: "", directory: false }];
  if (!stats.isDirectory()) {
    throw sourceEditorError("Files can move or copy only files and folders.", "vibe64_files_unsupported_entry", { path: sourcePath }, 422);
  }
  const entries = [{ relative: "", directory: true }];
  async function visit(relative) {
    const directory = absoluteSourceEditorPath(context.sourceRoot, joinRelative(sourcePath, relative));
    for (const entry of await readdir(directory, { withFileTypes: true })) {
      const child = joinRelative(relative, entry.name);
      const label = `${sourcePath}/${child}`;
      if (sourceEditorPathExcluded(context.policy, label)) {
        throw sourceEditorError(`“${label}” is protected and cannot be moved or copied.`, "vibe64_files_protected_entry", { path: label }, 403);
      }
      if (!entry.isFile() && !entry.isDirectory()) {
        throw sourceEditorError(`“${label}” is a link or special file; Files can move or copy only files and folders.`,
          "vibe64_files_unsupported_entry", { path: label }, 422);
      }
      if (entries.push({ relative: child, directory: entry.isDirectory() }) > TRANSFER_MAX_ENTRIES) {
        throw sourceEditorError("This folder has too many items to move or copy at once.", "vibe64_files_transfer_too_large", {}, 413);
      }
      if (entry.isDirectory()) await visit(child);
    }
  }
  await visit("");
  return entries;
}

// Copies the planned entries into `staged`, streaming each file from a
// descriptor opened without following links.
async function copyPlan(sourceAbsolute, staged, entries) {
  const { file: fileMode } = vibe64SharedModes();
  for (const entry of entries) {
    const from = entry.relative ? path.join(sourceAbsolute, entry.relative) : sourceAbsolute;
    const to = entry.relative ? path.join(staged, entry.relative) : staged;
    if (entry.directory) {
      await mkdir(to);
      continue;
    }
    const handle = await open(from, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stats = await handle.stat();
      if (!stats.isFile()) {
        throw sourceEditorError("A file changed while it was being copied. Try again.", "vibe64_source_editor_file_changed", {}, 409);
      }
      // A copied script stays runnable: execute follows the shared read bits.
      const executable = stats.mode & 0o100 ? (fileMode & 0o440) >> 2 : 0;
      await pipeline(handle.createReadStream({ autoClose: false }), createWriteStream(to, { flags: "wx", mode: fileMode | executable }));
    } finally {
      await handle.close();
    }
  }
}

async function transferEntry(from, to, input, mode) {
  await sourceEditorPathStats(from.sourceRoot);
  await sourceEditorPathStats(to.sourceRoot);
  const sourcePath = normalizeSourceEditorRelativePath(input.path);
  if (!sourcePath) throw sourceEditorError("Choose an item to move or copy.", "vibe64_invalid_source_editor_path");
  if (sourceEditorPathExcluded(from.policy, sourcePath)) {
    throw sourceEditorError(`“${sourcePath}” is protected and cannot be moved or copied.`, "vibe64_files_protected_entry", { path: sourcePath }, 403);
  }
  const sourceStats = await sourceEditorPathStats(from.sourceRoot, sourcePath);
  const folder = normalizeSourceEditorRelativePath(input.targetPath);
  if (folder && sourceEditorPathExcluded(to.policy, folder)) {
    throw sourceEditorError("That folder is protected.", "vibe64_files_protected_entry", { path: folder }, 403);
  }
  if (!(await sourceEditorPathStats(to.sourceRoot, folder)).isDirectory()) {
    throw sourceEditorError("Choose a folder to move or copy into.", "vibe64_invalid_source_editor_path");
  }
  const sameRoot = path.resolve(from.sourceRoot) === path.resolve(to.sourceRoot);
  if (sameRoot && sourceStats.isDirectory() && (folder === sourcePath || folder.startsWith(`${sourcePath}/`))) {
    throw sourceEditorError("A folder cannot be moved or copied into itself.", "vibe64_files_invalid_destination");
  }
  if (sameRoot && mode === "move" && folderOf(sourcePath) === folder) {
    throw sourceEditorError("It is already in this folder.", "vibe64_files_invalid_destination");
  }
  const entries = await transferPlan(from, sourcePath, sourceStats);
  const target = await resolveTarget(to, folder, path.posix.basename(sourcePath), input.conflict);
  if (target.skipped) return { ok: true, skipped: true, path: target.relativePath, mode };
  if (sameRoot && target.relativePath === sourcePath) {
    throw sourceEditorError("An item cannot replace itself.", "vibe64_files_invalid_destination");
  }
  for (const entry of entries) {
    const destination = joinRelative(target.relativePath, entry.relative);
    if (sourceEditorPathExcluded(to.policy, destination)) {
      throw sourceEditorError(`“${destination}” is protected in this area.`, "vibe64_files_protected_entry", { path: destination }, 403);
    }
  }
  const sourceAbsolute = absoluteSourceEditorPath(from.sourceRoot, sourcePath);
  const targetAbsolute = absoluteSourceEditorPath(to.sourceRoot, target.relativePath);
  const staged = stagingPath(path.dirname(targetAbsolute));
  // A move renames when both areas share a filesystem; otherwise it copies
  // and removes the source only after the copy is published.
  let renamed = false;
  try {
    if (mode === "move") {
      try {
        await rename(sourceAbsolute, staged);
        renamed = true;
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
      }
    }
    if (!renamed) await copyPlan(sourceAbsolute, staged, entries);
    await publishStaged(staged, targetAbsolute, { replace: target.replace, directory: sourceStats.isDirectory() });
  } catch (error) {
    if (renamed) await rename(staged, sourceAbsolute).catch(() => null);
    else await rm(staged, { recursive: true, force: true });
    throw error;
  }
  if (mode === "move" && !renamed) await rm(sourceAbsolute, { recursive: true });
  return { ok: true, path: target.relativePath, mode };
}

export {
  createFileArea
};
