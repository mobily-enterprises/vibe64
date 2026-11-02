import crypto from "node:crypto";
import { constants } from "node:fs";
import { link, lstat, mkdir, open, readdir, realpath, rename, rm } from "node:fs/promises";
import path from "node:path";
import { isMissingPathError } from "@local/vibe64-core/server/core";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { vibe64SharedModes } from "@local/vibe64-execution/server/hostProfile";
import { openedFileWithin } from "@local/vibe64-terminals/server/openedFileWithin";
import { absoluteSourceEditorPath, sourceEditorError, sourceEditorPathStats } from "./sourceFiles.js";
import { changedError, existsError, pathExists, sameEntry } from "./fileAreaItems.js";

// Files areas' folders and staging: a folder is held open while an item is
// named through it, and every incoming item is staged, then published.
// Incoming files and folders are written into the area's staging folder and
// published by link or rename, so readers never see a partial item. Other
// areas stage in STAGING_FOLDER at their root, which Files hides and refuses
// as a name; Repo stages in REPO_STAGING_FOLDER inside its Git directory, which
// `git status` and a Save never see. A server stopped mid-write leaves its
// item there; the area's next write removes it after STAGING_STALE_DAYS.
const STAGING_FOLDER = ".vibe64-staging";
const REPO_STAGING_FOLDER = "vibe64-file-staging";
const STAGING_STALE_DAYS = 7;

/**
 * When putting an item back fails, the error says where it is kept.
 */
function keptError(context, keptAt) {
  const where = `${context.staging}/${path.basename(keptAt)}`;
  return sourceEditorError(
    `This could not finish, and the item could not be put back. It is kept as “${where}” for ${STAGING_STALE_DAYS} days; move it back before then.`,
    "vibe64_files_item_kept",
    { path: where },
    500
  );
}

/**
 * Holds the folder at `folderPath` open while `perform` runs, if it is still
 * the folder `stats` describes. On Linux, at(name) names an item through the
 * open folder, so a folder swapped for a link cannot redirect what is done to
 * that item; elsewhere it is the path.
 */
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

/**
 * Holds a folder of the area open (see withOpenFolder) once its real location
 * is exactly `relativePath` under the area's real root. check() repeats that
 * just before publishing.
 */
async function withAreaFolder(context, relativePath, perform) {
  const stats = await sourceEditorPathStats(context.sourceRoot, relativePath);
  if (!stats.isDirectory()) throw sourceEditorError("Choose a folder.", "vibe64_invalid_source_editor_folder");
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

/**
 * The area's staging folder, created when missing and held open like any
 * other folder, so a link swapped into its path cannot divert a staged item.
 */
async function withStaging(context, perform) {
  const absolutePath = absoluteSourceEditorPath(context.sourceRoot, context.staging);
  await mkdir(absolutePath, { mode: vibe64SharedModes().directory }).catch((error) => {
    if (error.code !== "EEXIST") throw error;
  });
  if (!(await lstat(absolutePath)).isDirectory()) {
    throw sourceEditorError(
      `Files keeps unfinished items in “${context.staging}”, which is not a folder here. Move that item away, then try again.`,
      "vibe64_files_staging_unavailable",
      { path: context.staging },
      409
    );
  }
  return withAreaFolder(context, context.staging, perform);
}

/**
 * A new, unused name in the staging folder.
 */
function stagedItem(staging) {
  return staging.at(crypto.randomUUID());
}

/**
 * Repo's staging folder lives in the checkout's own Git directory, on the
 * same filesystem, so a staged item publishes into the worktree by link or
 * rename. A Git directory outside the checkout is refused. Returns its path
 * inside the checkout.
 */
async function repoStagingFolder(sourceRoot) {
  const result = await runVibe64Command({
    actor: "daemon",
    allowedRoots: [sourceRoot],
    args: ["rev-parse", "--absolute-git-dir"],
    command: "git",
    cwd: sourceRoot,
    gitSafeDirectories: [sourceRoot],
    mode: "capture",
    purpose: "source",
    runtimes: ["git"],
    timeout: 10_000
  });
  const gitDirectory = result.ok === true ? String(result.stdout || "").trim() : "";
  const realRoot = await realpath(sourceRoot);
  const realGitDirectory = gitDirectory ? await realpath(gitDirectory).catch(() => "") : "";
  if (!realGitDirectory.startsWith(`${realRoot}${path.sep}`)) {
    throw sourceEditorError(
      "Repo has no Git folder of its own, so Files cannot write into it.",
      "vibe64_files_repo_git_unavailable",
      {},
      409
    );
  }
  return path.relative(realRoot, path.join(realGitDirectory, REPO_STAGING_FOLDER));
}

/**
 * Runs under the area's lock. Everything in the staging folder is Files' own;
 * writing or renaming an item in refreshes its change time, so only items
 * abandoned by a stopped server look old.
 */
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

/**
 * Publishes a completely written staged item. Without replace it never
 * overwrites: a file publishes by hard link, which fails on a taken name (a
 * stopped server can leave the staged second link only in the staging
 * folder, which its sweep removes); a folder publishes by rename into a name
 * checked free. Replacing sets the old item aside in the staging folder until
 * the new one is in place.
 */
async function publishStaged(context, staging, staged, target, options = {}) {
  const { replace = false, directory = false } = options;
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

export {
  REPO_STAGING_FOLDER,
  STAGING_FOLDER,
  publishStaged,
  removeStaleStaging,
  repoStagingFolder,
  stagedItem,
  withAreaFolder,
  withOpenFolder,
  withStaging,
  keptError
};
