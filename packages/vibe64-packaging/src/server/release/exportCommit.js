// A release builds from exactly one saved commit, never from a working tree.
// This writes that commit's files into a fresh folder through a private Git index
// (the repository's own index, HEAD and worktree are untouched) and gives every
// file the commit's time, so builds that record file times are reproducible.
import { mkdir, mkdtemp, readdir, rm, stat, utimes } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { publishError } from "../errors.js";
import { COMMIT_ID, releaseGit } from "../git.js";

function git(projectRoot, args, env = {}, { workTree = null } = {}) {
  return releaseGit(projectRoot, [...(workTree ? [`--work-tree=${workTree}`] : []), ...args], {
    code: "VIBE64_PUBLISH_EXPORT_FAILED", env, maxBuffer: 16 * 1024 * 1024
  });
}

async function setTimes(root, seconds) {
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const file = path.join(root, entry.name);
    if (entry.isDirectory()) await setTimes(file, seconds);
    if (!entry.isSymbolicLink()) await utimes(file, seconds, seconds);
  }
  await utimes(root, seconds, seconds);
}

// `exclude` names top-level-relative paths (folders or files) left out of the
// export, such as the project's Genesis and agent files for a package build.
async function exportSavedCommit({ projectRoot, commit, directory, exclude = [] } = {}) {
  if (typeof projectRoot !== "string" || !path.isAbsolute(projectRoot)) {
    throw publishError("VIBE64_PUBLISH_EXPORT_FAILED", "The project root must be an absolute path.");
  }
  if (!COMMIT_ID.test(commit || "")) throw publishError("VIBE64_PUBLISH_EXPORT_FAILED", "Export needs a full commit id.");
  if (typeof directory !== "string" || !path.isAbsolute(directory)) {
    throw publishError("VIBE64_PUBLISH_EXPORT_FAILED", "The export folder must be an absolute path.");
  }
  const existing = await stat(directory).catch(() => null);
  if (existing && (await readdir(directory)).length) {
    throw publishError("VIBE64_PUBLISH_EXPORT_FAILED", "The export folder must be new or empty.");
  }
  await mkdir(directory, { recursive: true });
  const indexHome = await mkdtemp(path.join(os.tmpdir(), "vibe64-export-index-"));
  try {
    const env = { GIT_INDEX_FILE: path.join(indexHome, "index") };
    await git(projectRoot, ["read-tree", commit], env);
    if (exclude.length) await git(projectRoot, ["rm", "--cached", "-r", "-q", "--ignore-unmatch", "--", ...exclude], env, { workTree: directory });
    // The export folder is the work tree, so a bare canonical repository exports too.
    await git(projectRoot, ["checkout-index", "--all", "--force", `--prefix=${directory}${path.sep}`], env, { workTree: directory });
  } finally {
    await rm(indexHome, { recursive: true, force: true });
  }
  const commitTime = Number(await git(projectRoot, ["show", "-s", "--format=%ct", commit]));
  await setTimes(directory, commitTime);
  return { directory, commit, commitTime };
}

export { exportSavedCommit };
