import { VIBE64_UPLOAD_MAX_LABEL } from "@local/vibe64-core/shared";
import { BACKUP_RETENTION_MS, withProjectBackupsLock, withProjectDropZoneLock } from "@local/vibe64-runtime/server/projectBackups";
import crypto from "node:crypto";
import { constants, createWriteStream } from "node:fs";
import { pipeline } from "node:stream/promises";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { link, lstat, lutimes, mkdir, open, readdir, realpath, rename, rm, rmdir, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import { isMissingPathError, normalizeText, pathInsideOrEqual } from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64AgentWriteExclusive } from "@local/vibe64-runtime/server/agentWriteLock";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { openedFileWithin } from "@local/vibe64-terminals/server/openedFileWithin";
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
// Repo only to list destination folders, upload, and move or copy items.
const FILE_AREAS = Object.freeze({
  repo: { scope: "session", operations: ["tree", "conflicts", "upload", "transfer"] },
  "drop-zone": { scope: "session" },
  session: { scope: "session", ownerOnly: true, readOnly: true },
  "project-drop-zone": { scope: "project" },
  backups: { scope: "project" }
});
const READS = ["tree", "file", "download", "archive", "conflicts"];
const WRITES = ["upload", "create", "save", "rename", "delete", "mkdir", "transfer"];
// Incoming files and folders are written into the area's staging folder and
// published by link or rename, so readers never see a partial item. Other
// areas stage in STAGING_FOLDER at their root, which Files hides and refuses
// as a name; Repo stages in REPO_STAGING_FOLDER inside its Git directory, which
// `git status` and a Save never see. A server stopped mid-write leaves its
// item there; the area's next write removes it after STAGING_STALE_DAYS.
const STAGING_FOLDER = ".vibe64-staging";
const REPO_STAGING_FOLDER = "vibe64-file-staging";
const STAGING_STALE_DAYS = 7;
// A finished Repo upload waits this long for Save, Update or another source
// change to let go of the exclusive write before it reports busy.
const REPO_PUBLISH_WAIT_MS = 30_000;
const TRANSFER_MAX_ENTRIES = 10_000;
const TRANSFER_MAX_BYTES = 2 * 1024 ** 3;
const TRANSFER_MAX_LABEL = "2 GiB";
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
      ...sourceEditorFilePolicy(), exclude: [`${STAGING_FOLDER}/**`], protectSourceContract: false, maxTreeDepth: Infinity, maxTreeEntries: Infinity
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
        throw sourceEditorError(`This area's folder “${root}” is not a folder. Move that item away, then try again.`,
          "vibe64_files_area_not_folder", { path: root }, 409);
      }
      // Reads never create the folder; a missing one is simply empty.
      if (!write) return { key, session, run: (perform) => perform(context(root, { location: root, missing: !rootStats })) };
      await mkdir(root, { recursive: true, mode: vibe64SharedModes().directory });
      const writeContext = context(root, { location: root, staging: STAGING_FOLDER });
      // Each project area's writes share one lock; Backups' also covers retention.
      const lock = area === "backups" ? withProjectBackupsLock : withProjectDropZoneLock;
      const run = (perform) => lock(stateRoot, async () => {
        await removeStaleStaging(writeContext);
        return perform(writeContext);
      });
      // An upload streams in without the lock and takes it only to publish.
      return { key, session, run, receive: (perform) => perform({ ...writeContext, publish: run }) };
    }

    if (area === "repo") {
      const root = sessionSourcePath(session);
      if (!root) {
        throw sourceEditorError("This session has no Repo files.", "vibe64_source_editor_source_unavailable", {}, 409);
      }
      if (!write) return { key, session, run: (perform) => perform(context(root)) };
      const writeContext = context(root, { staging: await repoStagingFolder(root) });
      // Repo writes take the same exclusive source write as the source editor;
      // a move or copy refuses rather than waits while it is held.
      const run = async (perform, { waitMs = 0 } = {}) => {
        const exclusive = await runVibe64AgentWriteExclusive(runtime, sessionId, async () => {
          await removeStaleStaging(writeContext);
          try {
            return await perform(writeContext);
          } finally {
            repoChanged(root);
          }
        }, { operation: "source-editor-write", waitMs });
        if (!exclusive.acquired) {
          throw sourceEditorError(normalizeText(exclusive.value?.error) || "Another source-changing operation is starting. Try again in a moment.",
            normalizeText(exclusive.value?.code) || "vibe64_source_editor_write_busy", {}, 409);
        }
        return exclusive.value;
      };
      // An upload streams in without the exclusive write, so Save, Update and
      // the assistant never wait on it; it takes the write only to publish,
      // waiting briefly for one of them to finish.
      const publish = (perform) => run(perform, { waitMs: REPO_PUBLISH_WAIT_MS });
      return { key, session, run, receive: (perform) => perform({ ...writeContext, publish }) };
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
        const dropZone = context(sessionPaths.dropZoneRoot, { location: sessionPaths.dropZoneRoot, staging: STAGING_FOLDER });
        if (write) await removeStaleStaging(dropZone);
        return perform(dropZone);
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
      // Areas that can receive an upload before taking their lock do so.
      const enter = operation === "upload" && opened.receive ? opened.receive : opened.run;
      return enter((context) => areaOperation(operation, context, input, readUpload));
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
  for (const item of [relativePath, operation === "rename" ? normalizeSourceEditorRelativePath(input.destination) : ""]) {
    if (item && sourceEditorPathExcluded(context.policy, item)) throw protectedError(item);
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

function protectedError(item) {
  return sourceEditorError(`“${item}” is protected in this area.`, "vibe64_files_protected_entry", { path: item }, 403);
}

function changedError() {
  return sourceEditorError("An item changed while it was being moved or copied. Try again.", "vibe64_source_editor_file_changed", {}, 409);
}

// When putting an item back fails, the error says where it is kept.
function keptError(context, keptAt) {
  const where = `${context.staging}/${path.basename(keptAt)}`;
  return sourceEditorError(`This could not finish, and the item could not be put back. It is kept as “${where}” for ${STAGING_STALE_DAYS} days; move it back before then.`,
    "vibe64_files_item_kept", { path: where }, 500);
}

function sameEntry(left, right) {
  return left.dev === right.dev && left.ino === right.ino;
}

// The same file, unchanged: identity, size and modification time.
function sameFile(left, right) {
  return sameEntry(left, right) && left.size === right.size && left.mtimeMs === right.mtimeMs;
}

// Holds the folder at `folderPath` open while `perform` runs, if it is still
// the folder `stats` describes. On Linux, at(name) names an item through the
// open folder, so a folder swapped for a link cannot redirect what is done to
// that item; elsewhere it is the path.
async function withOpenFolder(folderPath, stats, perform) {
  const handle = await open(folderPath, constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW).catch((error) => {
    throw ["ELOOP", "ENOTDIR"].includes(error.code) ? changedError() : error;
  });
  try {
    if (!sameEntry(await handle.stat(), stats)) throw changedError();
    const base = process.platform === "linux" ? `/proc/self/fd/${handle.fd}` : folderPath;
    return await perform({ at: (name = "") => path.join(base, name), handle });
  } finally {
    await handle.close();
  }
}

// Holds a folder of the area open (see withOpenFolder) once its real location
// is exactly `relativePath` under the area's real root. check() repeats that
// just before publishing.
async function withAreaFolder(context, relativePath, perform) {
  const stats = await sourceEditorPathStats(context.sourceRoot, relativePath);
  if (!stats.isDirectory()) throw sourceEditorError("Choose a folder.", "vibe64_invalid_source_editor_path");
  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, relativePath);
  const expected = path.resolve(await realpath(context.sourceRoot), relativePath);
  return withOpenFolder(absolutePath, stats, async ({ at, handle }) => {
    const folder = {
      at,
      async check() {
        if (!await openedFileWithin(handle, absolutePath, (opened) => opened === expected)) throw changedError();
      }
    };
    await folder.check();
    return perform(folder);
  });
}

// The area's staging folder, created when missing and held open like any
// other folder, so a link swapped into its path cannot divert a staged item.
async function withStaging(context, perform) {
  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, context.staging);
  await mkdir(absolutePath, { mode: vibe64SharedModes().directory }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  if (!(await lstat(absolutePath)).isDirectory()) {
    throw sourceEditorError(`Files keeps unfinished items in “${context.staging}”, which is not a folder here. Move that item away, then try again.`,
      "vibe64_files_staging_unavailable", { path: context.staging }, 409);
  }
  return withAreaFolder(context, context.staging, perform);
}

async function pathExists(absolutePath) {
  return lstat(absolutePath).then(() => true, (error) => {
    if (isMissingPathError(error)) return false;
    throw error;
  });
}

// A new, unused name in the staging folder.
function stagedItem(staging) {
  return staging.at(crypto.randomUUID());
}

// Repo's staging folder lives in the checkout's own Git directory, on the
// same filesystem, so a staged item publishes into the worktree by link or
// rename. A Git directory outside the checkout is refused. Returns its path
// inside the checkout.
async function repoStagingFolder(sourceRoot) {
  const result = await runVibe64Command({
    actor: "daemon", allowedRoots: [sourceRoot], args: ["rev-parse", "--absolute-git-dir"], command: "git", cwd: sourceRoot,
    gitSafeDirectories: [sourceRoot], mode: "capture", purpose: "source", runtimes: ["git"], timeout: 10_000
  });
  const gitDirectory = result.ok === true ? String(result.stdout || "").trim() : "";
  const realRoot = await realpath(sourceRoot);
  const realGitDirectory = gitDirectory ? await realpath(gitDirectory).catch(() => "") : "";
  if (!realGitDirectory.startsWith(`${realRoot}${path.sep}`)) {
    throw sourceEditorError("Repo has no Git folder of its own, so Files cannot write into it.", "vibe64_files_repo_git_unavailable", {}, 409);
  }
  return path.relative(realRoot, path.join(realGitDirectory, REPO_STAGING_FOLDER));
}

// Runs under the area's lock. Everything in the staging folder is Files' own;
// writing or renaming an item in refreshes its change time, so only items
// abandoned by a stopped server look old.
async function removeStaleStaging(context) {
  const stats = await lstat(absoluteSourceEditorPath(context.sourceRoot, context.staging)).catch(() => null);
  if (!stats?.isDirectory()) return;
  const cutoff = Date.now() - STAGING_STALE_DAYS * 24 * 60 * 60 * 1000;
  await withAreaFolder(context, context.staging, async (staging) => {
    for (const name of await readdir(staging.at())) {
      const item = staging.at(name);
      if ((await lstat(item).catch(() => null))?.ctimeMs < cutoff) await rm(item, { recursive: true, force: true });
    }
  });
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
async function availableName(destination, name) {
  const extension = path.extname(name);
  const stem = extension ? name.slice(0, -extension.length) : name;
  for (let number = 1; number < 1000; number += 1) {
    const candidate = `${stem} (${number})${extension}`;
    if (!(await pathExists(destination.at(candidate)))) return candidate;
  }
  throw sourceEditorError("Too many items with this name already exist here.", "vibe64_files_exists", { name }, 409);
}

// Where an incoming item goes in the open destination folder under the chosen
// conflict rule: fail (the default), replace, keep both under a free name, or
// skip.
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

// Publishes a completely written staged item. Without replace it never
// overwrites: a file publishes by hard link, which fails on a taken name (a
// stopped server can leave the staged second link only in the staging
// folder, which its sweep removes); a folder publishes by rename into a name
// checked free. Replacing sets the old item aside in the staging folder until
// the new one is in place.
async function publishStaged(context, staging, staged, target, { replace = false, directory = false } = {}) {
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
  const aside = stagedItem(staging);
  await rename(target, aside);
  try {
    await rename(staged, target);
  } catch (error) {
    await rename(aside, target).catch(() => {
      throw keptError(context, aside);
    });
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

async function uploadAreaFile(context, input, readUpload) {
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
      if (part.file.truncated) throw sourceEditorError(`Upload exceeds the ${VIBE64_UPLOAD_MAX_LABEL} limit.`, "vibe64_files_upload_too_large", {}, 413);
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

// The regular files and folders a transfer carries (or a Replace would
// delete), each with the identity, size and modification time it had when
// listed. `itemAt` names the item through its open folder, and each folder is
// listed through itself held open, so a folder swapped for a link is refused.
// Links, special files and paths the area protects are refused, so move and
// copy behave alike.
async function transferPlan(itemAt, itemPath, stats, policy, action = "moved or copied") {
  if (stats.isFile()) return [{ relative: "", directory: false, stats }];
  if (!stats.isDirectory()) {
    throw sourceEditorError(`“${itemPath}” is a link or special file and cannot be ${action}.`, "vibe64_files_unsupported_entry", { path: itemPath }, 422);
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
        throw sourceEditorError(`“${label}” is a link or special file and cannot be ${action}.`, "vibe64_files_unsupported_entry", { path: label }, 422);
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

// One move or copy holds its areas' locks while it copies, so it carries at
// most TRANSFER_MAX_BYTES; this is checked from the plan before copying.
function assertTransferSize(entries) {
  const bytes = entries.reduce((total, entry) => total + (entry.directory ? 0 : entry.stats.size), 0);
  if (bytes > TRANSFER_MAX_BYTES) {
    throw sourceEditorError(`This is larger than the ${TRANSFER_MAX_LABEL} one move or copy can carry. Move or copy it in smaller parts.`,
      "vibe64_files_transfer_too_large", {}, 413);
  }
}

// Copies the planned entries into `staged`. Each opened file must be the one
// the plan listed, unchanged, and must really be at its path inside the area,
// so a folder swapped for a link mid-copy cannot pull in anything from outside
// it; a file changed while it is copied fails the copy.
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

// After a copy-based move, removes only what was copied: files that are still
// the planned ones, unchanged since they were copied, then the planned folders
// deepest first, so anything added or changed meanwhile stays.
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
    throw sourceEditorError(`“${sourcePath}” is protected and cannot be moved or copied.`, "vibe64_files_protected_entry", { path: sourcePath }, 403);
  }
  const folder = normalizeSourceEditorRelativePath(input.targetPath);
  if (folder && sourceEditorPathExcluded(to.policy, folder)) {
    throw sourceEditorError("That folder is protected.", "vibe64_files_protected_entry", { path: folder }, 403);
  }
  // The item is named through its open folder and arrives through the open
  // destination folder, so neither can be redirected outside its area.
  return withAreaFolder(to, folder, (destination) => withAreaFolder(from, folderOf(sourcePath),
    (origin) => transferItem(from, to, { input, mode, sourcePath, folder, origin, destination })));
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
    mode, sourcePath, sourceAt, sourceStats, entries, target, destination, staging
  }));
}

// A move renames when both areas share a filesystem; otherwise it copies and
// removes the source only after the copy is published.
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
      replace: target.replace, directory: sourceStats.isDirectory()
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
  createFileArea
};
