// What a refresh reads: the project as last saved, never a session's unsaved
// work. A command refresh runs in a throwaway checkout of exactly that commit
// (shared objects, so cheap), removed when the run ends. Checkouts live in the
// project's own state, where a host that confines project commands runs them.
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import path from "node:path";

import { vibe64Error } from "@local/vibe64-core/server/core";
import { COMMIT_ID, releaseGit } from "@local/vibe64-packaging/server/git";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

const GIT_CODE = "vibe64_pages_refresh_git_failed";

function sourceRefusal(message) {
  return vibe64Error(message, "vibe64_pages_refresh_source_unavailable", { status: 409 });
}

const git = (root, args, options = {}) => releaseGit(root, args, { code: GIT_CODE, ...options });

/**
 * The repository that holds the saved work, by how the project is kept: its own folder, Vibe64's
 * repository for it, or the copy of GitHub that Save brings up to date.
 * @param {object | null} project
 */
function savedRepository(project) {
  const mode = project?.repositoryMode || project?.repository?.mode || "";
  const root = {
    local_source: project?.sourceRoot,
    managed_git: project?.canonicalRepositoryPath,
    github: project?.githubMirrorPath
  }[mode];
  return { branch: String(project?.repository?.defaultBranch || "").trim(), root: String(root || "").trim() };
}

/**
 * The saved branch and commit.
 * @param {ProjectService} project
 * @returns {Promise<{ root: string, branch: string, commit: string }>}
 */
async function readSavedSource(project) {
  const { branch, root } = savedRepository(await project.readCurrentProject());
  if (!branch || !path.isAbsolute(root)) throw sourceRefusal("This project has no saved version to refresh from yet.");
  const commit = await git(root, ["rev-parse", "--verify", "--quiet", `refs/heads/${branch}^{commit}`], { optional: true });
  if (!commit || !COMMIT_ID.test(commit)) throw sourceRefusal(`The project has no saved work on ${branch} yet.`);
  return { root, branch, commit };
}

/**
 * Runs `operation(folder)` with a checkout of the saved commit at `<folder>/project`, a new folder
 * in `scratchRoot`, then removes the folder whatever happens.
 * @template T
 * @param {{ root: string, commit: string }} saved
 * @param {string} scratchRoot
 * @param {(folder: string) => Promise<T>} operation
 * @returns {Promise<T>}
 */
async function withSavedCheckout({ root, commit }, scratchRoot, operation) {
  await mkdir(scratchRoot, { recursive: true });
  const folder = await mkdtemp(path.join(scratchRoot, "run-"));
  try {
    const checkout = path.join(folder, "project");
    await git(root, ["clone", "--quiet", "--no-checkout", "--shared", root, checkout]);
    await git(checkout, ["-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", commit]);
    await mkdir(path.join(checkout, ".vibe64-refresh", "home"), { recursive: true });
    return await operation(folder);
  } finally {
    await rm(folder, { force: true, recursive: true });
  }
}

export { readSavedSource, withSavedCheckout };
