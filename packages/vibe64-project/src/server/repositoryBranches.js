import path from "node:path";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { validRepositoryBranch } from "@local/vibe64-core/server/projectRepository";
import { githubApi, requireGithubRepository } from "./githubApi.js";
import { runProjectSourceExclusive } from "./projectSourceMutationLock.js";

async function repositoryBranches(project, input = {}, {
  runCommand = runVibe64Command, env = process.env, runExclusive = runProjectSourceExclusive
} = {}) {
  const mode = project.repositoryMode || project.repository?.mode;
  if (!["github", "managed_git"].includes(mode)) {
    throw new Error("Use the local Git controls to switch the opened folder before creating a session.");
  }
  const api = mode === "github" ? githubApi(input, { env, runCommand, feature: "Branches" }) : null;
  const repository = api ? requireGithubRepository(project, "Branches") : "";
  const root = project.canonicalRepositoryPath;
  async function git(args) {
    if (!path.isAbsolute(root || "")) throw new Error("The Vibe64 repository is unavailable.");
    const result = await runCommand({
      actor: "daemon", allowedRoots: [root], command: "git", args: ["--git-dir", root, ...args],
      cwd: root, envPolicy: "project", mode: "capture", purpose: "source", runtimes: ["git"],
      timeout: 60_000, maxBuffer: 4 * 1024 * 1024
    });
    if (!result.ok) throw new Error(result.stderr || result.error || "The repository branch operation failed.");
    return String(result.stdout || "").trim();
  }
  return runExclusive(project.projectRuntimeRoot, async () => {
    const branches = [];
    if (api) {
      for (let page = 1; ; page += 1) {
        const rows = await api(`repos/${repository}/branches?per_page=100&page=${page}`, undefined, "GET");
        if (!Array.isArray(rows)) throw new Error("GitHub returned an unreadable branch list.");
        branches.push(...rows.map((row) => ({ name: row.name, commit: row.commit?.sha })));
        if (rows.length < 100) break;
      }
    } else {
      const refs = await git(["for-each-ref", "--format=%(refname:lstrip=2)%09%(objectname)", "refs/heads"]);
      branches.push(...refs.split("\n").filter(Boolean).map((line) => {
        const [name, commit] = line.split("\t");
        return { name, commit };
      }));
    }
    if (!input.selection) return { ok: true, branches, defaultBranch: project.repository.defaultBranch };
    const { name, fromBranch, expectedCommit } = input.selection;
    if (!validRepositoryBranch(name) || (fromBranch && !validRepositoryBranch(fromBranch))) {
      throw new Error("Choose a valid repository branch.");
    }
    const source = branches.find((branch) => branch.name === (fromBranch || name));
    if (!source || !/^[a-f0-9]{40,64}$/u.test(expectedCommit || "") || source.commit !== expectedCommit) {
      throw new Error("The source branch changed. Refresh the branch list and review it again.");
    }
    if (fromBranch) {
      if (branches.some((branch) => branch.name === name)) throw new Error("That branch already exists. Open it as a session instead.");
      if (api) {
        await api(`repos/${repository}/git/refs`, { ref: `refs/heads/${name}`, sha: source.commit });
      } else {
        await git(["push", "--push-option=vibe64-atomic", `--force-with-lease=refs/heads/${name}:`,
          root, `${source.commit}:refs/heads/${name}`]);
      }
    }
    return { name, commit: source.commit };
  }, { operation: input.selection?.fromBranch ? "create-session-branch" : "read-repository-branches" });
}

export { repositoryBranches };
