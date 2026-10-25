// The project's saved baseline as a release sees it: which repository holds the
// saved work, which commit is saved, whether it is pushed, and the remote that
// release tags go to. Reads use Git without prompts; only pushing tags uses the
// person's own Git sign-in (their credential helper), exactly as their own
// `git push` would.
import { execFile } from "node:child_process";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { promisify } from "node:util";

import { COMMIT_ID } from "@local/vibe64-packaging/server/git";
import { tagSavedCommit } from "@local/vibe64-packaging/server/tagSavedCommit";
import { readSourceVersion } from "@local/vibe64-packaging/server/release";
import { inspectVibe64Packaging } from "@local/vibe64-genesis/server";

const run = promisify(execFile);

function repositoryError(message, code = "vibe64_publishing_repository_unavailable") {
  return Object.assign(new Error(message), { code });
}

async function git(root, args, { optional = false, interactiveCredentials = false, timeout = 60_000 } = {}) {
  try {
    const { stdout } = await run("git", ["-C", root, ...args], {
      env: { ...process.env, GIT_TERMINAL_PROMPT: "0", ...(interactiveCredentials ? {} : { GIT_ASKPASS: "", SSH_ASKPASS: "" }) },
      maxBuffer: 8 * 1024 * 1024,
      timeout
    });
    return stdout.trim();
  } catch (error) {
    if (optional) return null;
    const detail = String(error?.stderr || error?.message || "").replace(/(https?:\/\/)[^\s/@]+@/gu, "$1[credentials]@").trim();
    throw repositoryError(`Git: ${detail.slice(0, 600)}`, "vibe64_publishing_git_failed");
  }
}

// "owner/name" for a GitHub remote address, or null.
function githubRepositoryOf(url = "") {
  const match = /github\.com[/:]([A-Za-z0-9-]+)\/([A-Za-z0-9._-]+?)(?:\.git)?\/?$/u.exec(String(url).trim());
  return match ? `${match[1]}/${match[2]}` : null;
}

function createProjectRepository({ readProject } = {}) {
  if (typeof readProject !== "function") throw new TypeError("The release repository needs readProject().");

  async function baseline() {
    const project = await readProject();
    const mode = project?.repositoryMode || project?.repository?.mode || "";
    const branch = String(project?.repository?.defaultBranch || "").trim();
    if (!branch) return { supported: false, message: "This project has no saved branch yet." };
    if (mode === "local_source") {
      const root = String(project.sourceRoot || "").trim();
      if (!path.isAbsolute(root)) return { supported: false, message: "This project's folder is not available." };
      const baselineRef = `refs/heads/${branch}`;
      const commit = await git(root, ["rev-parse", "--verify", "--quiet", `${baselineRef}^{commit}`], { optional: true });
      if (!commit) return { supported: false, message: `The project has no saved work on ${branch} yet.` };
      const upstreamRef = await git(root, ["rev-parse", "--symbolic-full-name", `${branch}@{upstream}`], { optional: true });
      const dirty = Boolean(await git(root, ["status", "--porcelain", "--untracked-files=normal"], { optional: true }));
      if (!upstreamRef || !upstreamRef.startsWith("refs/remotes/")) {
        return {
          supported: true, mode, repositoryRoot: root, branch, baselineRef, upstreamRef: baselineRef, commit, dirty,
          saved: !dirty, pushed: true, remote: null,
          message: "This project has no remote; release tags stay in its folder."
        };
      }
      const remoteName = upstreamRef.split("/")[2];
      const url = await git(root, ["remote", "get-url", remoteName], { optional: true }) || "";
      const pushed = await git(root, ["merge-base", "--is-ancestor", commit, upstreamRef], { optional: true }) !== null;
      return {
        supported: true, mode, repositoryRoot: root, branch, baselineRef, upstreamRef, commit, dirty, saved: !dirty, pushed,
        remote: { name: remoteName, url: url.replace(/(https?:\/\/)[^\s/@]+@/gu, "$1"), githubRepository: githubRepositoryOf(url) },
        message: pushed ? `Saved and pushed to ${remoteName}.` : `Saved, but not pushed to ${remoteName} yet.`
      };
    }
    if (mode === "managed_git") {
      const root = String(project.canonicalRepositoryPath || "").trim();
      if (!path.isAbsolute(root)) return { supported: false, message: "This project's saved repository is not available." };
      const baselineRef = `refs/heads/${branch}`;
      const commit = await git(root, ["rev-parse", "--verify", "--quiet", `${baselineRef}^{commit}`], { optional: true });
      if (!commit) return { supported: false, message: `The project has no saved work on ${branch} yet.` };
      return {
        supported: true, mode, repositoryRoot: root, branch, baselineRef, upstreamRef: baselineRef, commit, dirty: false,
        saved: true, pushed: true, remote: null, message: "Saved in Vibe64's repository for this project."
      };
    }
    return { supported: false, message: "Releasing from this computer works for projects saved in a folder or in Vibe64's own repository." };
  }

  async function existingTags(repositoryRoot, tags = []) {
    const found = [];
    for (const tag of tags) {
      const commit = await git(repositoryRoot, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], { optional: true });
      if (commit) found.push({ tag, commit });
    }
    return found;
  }

  // A real Git checkout of exactly the saved commit (shared objects, so cheap),
  // for reading Packaging and versions and for running the project's checks.
  async function withCheckout(repositoryRoot, commit, operation) {
    if (!COMMIT_ID.test(commit || "")) throw repositoryError("A checkout needs a full commit id.");
    const parent = await mkdtemp(path.join(os.tmpdir(), "vibe64-release-checkout-"));
    const root = path.join(parent, "project");
    try {
      await run("git", ["clone", "--quiet", "--no-checkout", "--shared", repositoryRoot, root], { env: { ...process.env, GIT_TERMINAL_PROMPT: "0" } });
      await git(root, ["-c", "advice.detachedHead=false", "checkout", "--quiet", "--detach", commit]);
      return await operation(root);
    } finally {
      await rm(parent, { recursive: true, force: true });
    }
  }

  // Packaging and every versioned package's version at the saved commit.
  async function readRelease(repositoryRoot, commit) {
    return withCheckout(repositoryRoot, commit, async (root) => {
      const packaging = await inspectVibe64Packaging({ projectRoot: root });
      const versions = {};
      for (const entry of packaging.status === "ready" ? packaging.packages : []) {
        if (!entry.versionFrom) continue;
        try {
          versions[entry.id] = await readSourceVersion({ projectRoot: root, entry });
        } catch {
          versions[entry.id] = null;
        }
      }
      return { packaging, versions };
    });
  }

  // Commit subjects since a tag (or the last 30), as a starting point for notes.
  async function subjectsSince(repositoryRoot, commit, tag = null) {
    const range = tag && await git(repositoryRoot, ["rev-parse", "--verify", "--quiet", `refs/tags/${tag}^{commit}`], { optional: true })
      ? `refs/tags/${tag}..${commit}`
      : commit;
    const output = await git(repositoryRoot, ["log", "--no-merges", "--format=%s", "-n", "30", range], { optional: true }) || "";
    return output.split("\n").map((line) => line.trim()).filter(Boolean);
  }

  async function createTags(facts, { commit, tags }) {
    return tagSavedCommit({
      repositoryRoot: facts.repositoryRoot,
      projectRuntimeRoot: facts.projectRuntimeRoot,
      baselineRef: facts.baselineRef,
      upstreamRef: facts.upstreamRef,
      expectedCommit: commit,
      tags
    });
  }

  // Sends the release tags to the project's remote, so GitHub (and anyone
  // cloning) sees them. Uses the person's own Git sign-in; never forced.
  async function pushTags(facts, tags) {
    if (!facts.remote || !tags.length) return { pushed: [] };
    await git(facts.repositoryRoot, ["push", "--quiet", facts.remote.name, ...tags.map((tag) => `refs/tags/${tag}:refs/tags/${tag}`)], {
      interactiveCredentials: true,
      timeout: 120_000
    });
    return { pushed: tags };
  }

  // Sends the saved branch to its upstream branch, as the person's own
  // `git push` would: their Git sign-in, fast-forward only, never forced.
  async function pushSaved(facts) {
    if (!facts.remote || facts.pushed) return { pushed: false };
    const upstreamBranch = facts.upstreamRef.split("/").slice(3).join("/");
    await git(facts.repositoryRoot, ["push", "--quiet", facts.remote.name, `${facts.commit}:refs/heads/${upstreamBranch}`], {
      interactiveCredentials: true,
      timeout: 120_000
    });
    // Keep the remote-tracking branch current, so "pushed" reads true at once.
    await git(facts.repositoryRoot, ["update-ref", facts.upstreamRef, facts.commit]);
    return { pushed: true, remote: facts.remote.name, branch: upstreamBranch };
  }

  async function fileAtCommit(repositoryRoot, commit, file) {
    return git(repositoryRoot, ["show", `${commit}:${file}`], { optional: true });
  }

  return Object.freeze({ baseline, createTags, existingTags, fileAtCommit, pushSaved, pushTags, readRelease, subjectsSince, withCheckout });
}

export { createProjectRepository, githubRepositoryOf };
