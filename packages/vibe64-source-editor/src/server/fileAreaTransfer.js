import { constants, createWriteStream } from "node:fs";
import { lstat, lutimes, mkdir, open, readdir, realpath, rename, rm, rmdir, unlink } from "node:fs/promises";
import path from "node:path";
import { pipeline } from "node:stream/promises";
import { isMissingPathError, pathInsideOrEqual } from "@local/vibe64-core/server/core";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import { openedFileWithin } from "@local/vibe64-terminals/server/openedFileWithin";
import { sourceEditorPathExcluded } from "./filePolicy.js";
import {
  absoluteSourceEditorPath,
  normalizeSourceEditorRelativePath,
  sourceEditorError,
  sourceEditorPathStats
} from "./sourceFiles.js";
import {
  availableName,
  changedError,
  existsError,
  folderOf,
  joinRelative,
  protectedError,
  sameEntry,
  sameFile
} from "./fileAreaItems.js";
import { keptError, publishStaged, stagedItem, withAreaFolder, withOpenFolder, withStaging } from "./fileAreaStaging.js";

// Server-side move and copy between Files areas, and the conflict rule an
// incoming upload or transfer applies at its destination.
const TRANSFER_MAX_ENTRIES = 10_000;
const TRANSFER_MAX_BYTES = 2 * 1024 ** 3;
const TRANSFER_MAX_LABEL = "2 GiB";

/**
 * Where an incoming item goes in the open destination folder under the chosen
 * conflict rule: fail (the default), replace, keep both under a free name, or
 * skip.
 */
async function resolveTarget(context, destination, folder, name, conflict = "fail") {
  const relativePath = joinRelative(folder, name);
  const existing = await lstat(destination.at(name)).catch((error) => {
    if (isMissingPathError(error)) return null;
    throw error;
  });
  if (!existing) return { relativePath };
  if (conflict === "skip") return { relativePath, skipped: true };
  if (conflict === "replace") {
    // Replacing deletes the folder that is there, so it may hold only what
    // this area could move or copy: no links and nothing it protects.
    if (existing.isDirectory()) await transferPlan(destination.at(name), relativePath, existing, context.policy, "replaced");
    return { relativePath, replace: true };
  }
  if (conflict === "keep-both") return { relativePath: joinRelative(folder, await availableName(destination, name)) };
  throw existsError(name);
}

/**
 * The regular files and folders a transfer carries (or a Replace would
 * delete), each with the identity, size and modification time it had when
 * listed. `itemAt` names the item through its open folder, and each folder is
 * listed through itself held open, so a folder swapped for a link is refused.
 * Links, special files and paths the area protects are refused, so move and
 * copy behave alike.
 */
async function transferPlan(itemAt, itemPath, stats, policy, action = "moved or copied") {
  if (stats.isFile()) return [{ relative: "", directory: false, stats }];
  if (!stats.isDirectory()) {
    throw sourceEditorError(
      `“${itemPath}” is a link or special file and cannot be ${action}.`,
      "vibe64_files_unsupported_entry",
      { path: itemPath },
      422
    );
  }
  const entries = [{ relative: "", directory: true, stats }];
  const visit = (folderAt, relative, folderStats) => withOpenFolder(folderAt, folderStats, async (folder) => {
    for (const name of await readdir(folder.at())) {
      const child = joinRelative(relative, name);
      const label = `${itemPath}/${child}`;
      if (sourceEditorPathExcluded(policy, label)) {
        throw sourceEditorError(`“${label}” is protected and cannot be ${action}.`, "vibe64_files_protected_entry", { path: label }, 403);
      }
      const childStats = await lstat(folder.at(name));
      if (!childStats.isFile() && !childStats.isDirectory()) {
        throw sourceEditorError(
          `“${label}” is a link or special file and cannot be ${action}.`,
          "vibe64_files_unsupported_entry",
          { path: label },
          422
        );
      }
      if (entries.push({ relative: child, directory: childStats.isDirectory(), stats: childStats }) > TRANSFER_MAX_ENTRIES) {
        throw sourceEditorError(`This folder has too many items to be ${action} at once.`, "vibe64_files_transfer_too_large", {}, 413);
      }
      if (childStats.isDirectory()) await visit(folder.at(name), child, childStats);
    }
  });
  await visit(itemAt, "", stats);
  return entries;
}

/**
 * One move or copy holds its areas' locks while it copies, so it carries at
 * most TRANSFER_MAX_BYTES; this is checked from the plan before copying.
 */
function assertTransferSize(entries) {
  const bytes = entries.reduce((total, entry) => total + (entry.directory ? 0 : entry.stats.size), 0);
  if (bytes > TRANSFER_MAX_BYTES) {
    throw sourceEditorError(
      `This is larger than the ${TRANSFER_MAX_LABEL} one move or copy can carry. Move or copy it in smaller parts.`,
      "vibe64_files_transfer_too_large",
      {},
      413
    );
  }
}

/**
 * Copies the planned entries into `staged`. Each opened file must be the one
 * the plan listed, unchanged, and must really be at its path inside the area,
 * so a folder swapped for a link mid-copy cannot pull in anything from outside
 * it; a file changed while it is copied fails the copy.
 */
async function copyPlan(from, sourcePath, staged, entries) {
  const { file: fileMode } = vibe64SharedModes();
  const realRoot = await realpath(from.sourceRoot);
  for (const entry of entries) {
    const relativePath = joinRelative(sourcePath, entry.relative);
    const to = entry.relative ? path.join(staged, entry.relative) : staged;
    if (entry.directory) {
      await mkdir(to);
      continue;
    }
    const absolutePath = absoluteSourceEditorPath(from.sourceRoot, relativePath);
    const handle = await open(absolutePath, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK);
    try {
      const stats = await handle.stat();
      if (!stats.isFile() || !sameFile(stats, entry.stats)
        || !await openedFileWithin(handle, absolutePath, (opened) => opened === path.resolve(realRoot, relativePath))) throw changedError();
      // A copied script stays runnable: execute follows the shared read bits.
      const executable = stats.mode & 0o100 ? (fileMode & 0o440) >> 2 : 0;
      await pipeline(handle.createReadStream({ autoClose: false }), createWriteStream(to, { flags: "wx", mode: fileMode | executable }));
      if (!sameFile(await handle.stat(), entry.stats)) throw changedError();
    } finally {
      await handle.close();
    }
  }
}

/**
 * After a copy-based move, removes only what was copied: files that are still
 * the planned ones, unchanged since they were copied, then the planned folders
 * deepest first, so anything added or changed meanwhile stays.
 */
async function removePlanned(sourceAbsolute, entries) {
  for (const entry of entries) {
    if (entry.directory) continue;
    const item = path.join(sourceAbsolute, entry.relative);
    const current = await lstat(item).catch((error) => {
      if (isMissingPathError(error)) return null;
      throw error;
    });
    if (current && sameFile(current, entry.stats)) await unlink(item);
  }
  for (const entry of entries.filter((candidate) => candidate.directory).reverse()) {
    await rmdir(path.join(sourceAbsolute, entry.relative)).catch((error) => {
      if (error.code !== "ENOTEMPTY" && error.code !== "EEXIST" && !isMissingPathError(error)) throw error;
    });
  }
}

async function transferEntry(from, to, input, mode) {
  await sourceEditorPathStats(from.sourceRoot);
  await sourceEditorPathStats(to.sourceRoot);
  const sourcePath = normalizeSourceEditorRelativePath(input.path);
  if (!sourcePath) throw sourceEditorError("Choose an item to move or copy.", "vibe64_invalid_source_editor_path");
  if (sourceEditorPathExcluded(from.policy, sourcePath)) {
    throw sourceEditorError(
      `“${sourcePath}” is protected and cannot be moved or copied.`,
      "vibe64_files_protected_entry",
      { path: sourcePath },
      403
    );
  }
  const folder = normalizeSourceEditorRelativePath(input.targetPath);
  if (folder && sourceEditorPathExcluded(to.policy, folder)) {
    throw sourceEditorError("That folder is protected.", "vibe64_files_protected_entry", { path: folder }, 403);
  }
  // The item is named through its open folder and arrives through the open
  // destination folder, so neither can be redirected outside its area.
  return withAreaFolder(to, folder, (destination) => withAreaFolder(
    from,
    folderOf(sourcePath),
    (origin) => transferItem(from, to, { input, mode, sourcePath, folder, origin, destination })
  ));
}

async function transferItem(from, to, { input, mode, sourcePath, folder, origin, destination }) {
  const name = path.posix.basename(sourcePath);
  const sourceAt = origin.at(name);
  const sourceStats = await lstat(sourceAt);
  const sameRoot = path.resolve(from.sourceRoot) === path.resolve(to.sourceRoot);
  if (sameRoot && sourceStats.isDirectory() && (folder === sourcePath || folder.startsWith(`${sourcePath}/`))) {
    throw sourceEditorError("A folder cannot be moved or copied into itself.", "vibe64_files_invalid_destination");
  }
  if (sameRoot && mode === "move" && folderOf(sourcePath) === folder) {
    throw sourceEditorError("It is already in this folder.", "vibe64_files_invalid_destination");
  }
  const entries = await transferPlan(sourceAt, sourcePath, sourceStats, from.policy);
  if (mode === "copy") assertTransferSize(entries);
  const target = await resolveTarget(to, destination, folder, name, input.conflict);
  if (target.skipped) return { ok: true, skipped: true, path: target.relativePath, mode };
  // Replacing deletes what is there: never the item itself or a folder holding it.
  const sourceAbsolute = absoluteSourceEditorPath(from.sourceRoot, sourcePath);
  if (target.replace && pathInsideOrEqual(absoluteSourceEditorPath(to.sourceRoot, target.relativePath), sourceAbsolute)) {
    throw sourceEditorError("An item cannot replace itself or a folder that contains it.", "vibe64_files_invalid_destination");
  }
  for (const entry of entries) {
    const arriving = joinRelative(target.relativePath, entry.relative);
    if (sourceEditorPathExcluded(to.policy, arriving)) throw protectedError(arriving);
  }
  return withStaging(to, (staging) => carryItem(from, to, {
    mode,
    sourcePath,
    sourceAt,
    sourceStats,
    entries,
    target,
    destination,
    staging
  }));
}

/**
 * A move renames when both areas share a filesystem; otherwise it copies and
 * removes the source only after the copy is published.
 */
async function carryItem(from, to, { mode, sourcePath, sourceAt, sourceStats, entries, target, destination, staging }) {
  const staged = stagedItem(staging);
  let renamed = false;
  try {
    if (mode === "move") {
      try {
        await rename(sourceAt, staged);
        renamed = true;
      } catch (error) {
        if (error.code !== "EXDEV") throw error;
      }
      // What was renamed must be the item the plan checked.
      if (renamed && !sameEntry(await lstat(staged), sourceStats)) throw changedError();
    }
    if (!renamed) {
      if (mode === "move") assertTransferSize(entries);
      await copyPlan(from, sourcePath, staged, entries);
    }
    // A rename keeps change times, so a move into Project Backups refreshes
    // them (keeping each file's modification time) to start its 14 days now.
    if (renamed && to.area === "backups") {
      for (const { relative, stats } of entries) await lutimes(path.join(staged, relative), stats.atimeMs / 1000, stats.mtimeMs / 1000);
    }
    await destination.check();
    await publishStaged(to, staging, staged, destination.at(path.posix.basename(target.relativePath)), {
      replace: target.replace,
      directory: sourceStats.isDirectory()
    });
  } catch (error) {
    if (renamed) {
      await rename(staged, sourceAt).catch(() => {
        throw keptError(to, staged);
      });
    } else {
      await rm(staged, { recursive: true, force: true });
    }
    throw error;
  }
  if (mode === "move" && !renamed) await removePlanned(sourceAt, entries);
  return { ok: true, path: target.relativePath, mode };
}

export {
  resolveTarget,
  transferEntry
};
