import { lstat, mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { PROJECT_REPOSITORY_MODE_GITHUB, PROJECT_REPOSITORY_MODE_MANAGED_GIT } from "@local/vibe64-core/server/projectRepository";
import { runVibe64Command } from "@local/vibe64-execution/server";
import { inspectGenesisStackComponents } from "@local/vibe64-genesis/server";
import { canonicalProjectSource, githubSourceCommandOptions, prepareGithubMirrorReference } from "./sessionSource.js";

const MAX_INPUT_BYTES = 1024 * 1024;
const MAX_INPUT_FILES = 128;

function inspectionError(code, message) {
  return Object.assign(new Error(message), { code });
}

// Caller holds the existing project source lock, so conversion cannot change
// repository identity between source selection and inspection.
async function inspectCanonicalProjectStack({ project, temporaryRoot, vibe64User = null,
  env = process.env, signal, runCommand = runVibe64Command } = {}) {
  const source = canonicalProjectSource(project, project?.sourceRoot);
  if (![PROJECT_REPOSITORY_MODE_GITHUB, PROJECT_REPOSITORY_MODE_MANAGED_GIT].includes(source.mode)) {
    throw inspectionError("vibe64_stack_repository_mode", "Saved Stack inspection requires a managed project repository.");
  }
  if (!path.isAbsolute(temporaryRoot || "")) throw new TypeError("Stack inspection requires an absolute temporary root.");
  await mkdir(temporaryRoot, { recursive: true, mode: 0o700 });
  if (await realpath(temporaryRoot) !== temporaryRoot) throw new Error("Unsafe Stack inspection directory.");
  const scratch = await mkdtemp(path.join(temporaryRoot, "stack-inspection-"));
  const roots = [scratch, ...(source.mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT ? [source.source] : []),
    ...(source.mirrorPath ? [source.mirrorPath, path.dirname(source.mirrorPath)] : [])];
  async function git(args, { cwd = scratch, auth = {} } = {}) {
    signal?.throwIfAborted();
    const result = await runCommand({
      actor: "daemon", ...auth, command: "git", args, cwd,
      allowedRoots: roots, gitSafeDirectories: roots, mode: "capture", envPolicy: "project",
      purpose: auth.gitTransport ? "github" : "source", runtimes: auth.gitTransport === "github-https" ? ["git", "gh"] : ["git"],
      timeout: 30_000, maxBuffer: MAX_INPUT_BYTES + 4096, signal
    });
    signal?.throwIfAborted();
    if (result?.ok !== true) throw inspectionError("vibe64_stack_repository_read_failed", "The saved project repository could not be verified or read.");
    return String(result.stdout ?? result.output ?? "");
  }
  try {
    let repositoryPath = source.source;
    let commit;
    if (source.mode === PROJECT_REPOSITORY_MODE_GITHUB) {
      const auth = await githubSourceCommandOptions(vibe64User, env, { runCommand });
      const reference = await prepareGithubMirrorReference({
        mirrorPath: source.mirrorPath, remoteUrl: source.remoteUrl, commandOptions: { ...auth, runCommand }
      });
      // Remote verification is mandatory even when every object is cached.
      const remote = await git(["ls-remote", "--exit-code", "--", source.remoteUrl, `refs/heads/${source.branch}`], { auth });
      const lines = remote.trim().split("\n");
      const [objectId, ref] = lines[0].split(/\s+/u);
      if (lines.length !== 1 || !/^[a-f0-9]{40,64}$/u.test(objectId) || ref !== `refs/heads/${source.branch}`) {
        throw inspectionError("vibe64_stack_repository_authority_invalid", "The configured GitHub branch could not be verified.");
      }
      commit = objectId;
      repositoryPath = reference.referenceRoot;
      if (!repositoryPath) {
        repositoryPath = path.join(scratch, "repository.git");
        await git(["init", "--bare", "--template=", repositoryPath]);
      }
      // Fetch the exact verified object into the cache if refresh did not supply
      // it. A force push between verification and fetch fails without fallback.
      const object = await runCommand({ actor: "daemon", command: "git",
        args: ["--git-dir", repositoryPath, "cat-file", "-e", `${commit}^{commit}`], cwd: scratch,
        allowedRoots: roots, gitSafeDirectories: roots, envPolicy: "project", purpose: "source",
        runtimes: ["git"], mode: "capture", timeout: 30_000, signal });
      if (object?.ok !== true) await git(["--git-dir", repositoryPath, "fetch", "--no-tags", "--depth=1", "--", source.remoteUrl, commit], { auth });
    } else {
      const info = await lstat(repositoryPath);
      if (!info.isDirectory() || await realpath(repositoryPath) !== repositoryPath) throw new Error("Unsafe canonical repository directory.");
      commit = (await git(["--git-dir", repositoryPath, "rev-parse", "--verify", `refs/heads/${source.branch}^{commit}`])).trim();
    }
    if (!/^[a-f0-9]{40,64}$/u.test(commit)) throw inspectionError("vibe64_stack_repository_authority_invalid", "Invalid repository commit.");
    const listing = await git(["--git-dir", repositoryPath, "ls-tree", "-r", "-z", "--long", commit, "--", "genesis/version", "genesis/stack.md", "genesis/stack"]);
    if (Buffer.byteLength(listing) > MAX_INPUT_BYTES) throw new Error("Stack input inventory is too large.");
    const files = listing.split("\0").filter(Boolean);
    if (files.length > MAX_INPUT_FILES) throw new Error("Stack has too many input files.");
    const inputs = files.map((line) => {
      const match = /^(100644|100755) blob ([a-f0-9]{40,64})\s+(\d+)\t(genesis\/(?:version|stack\.md|stack\/[a-z0-9-]+\.md))$/u.exec(line);
      if (!match) throw inspectionError("vibe64_stack_input_unsafe", "Stack inputs must be ordinary files at supported paths.");
      return { objectId: match[2], bytes: Number(match[3]), file: match[4] };
    });
    if (inputs.reduce((sum, entry) => sum + entry.bytes, 0) > MAX_INPUT_BYTES) throw new Error("Stack input is too large.");
    const projectRoot = path.join(scratch, "source");
    await mkdir(projectRoot);
    await git(["init", "--template=", projectRoot]);
    for (const input of inputs) {
      const contents = await git(["--git-dir", repositoryPath, "cat-file", "blob", input.objectId]);
      if (Buffer.byteLength(contents) !== input.bytes) throw new Error("Stack input was truncated.");
      const file = path.join(projectRoot, input.file);
      await mkdir(path.dirname(file), { recursive: true });
      await writeFile(file, contents, { mode: 0o600 });
    }
    const stack = await inspectGenesisStackComponents({ projectRoot });
    return { ...stack, repositoryMode: source.mode, repository: source.remoteUrl,
      branch: source.branch, commit, checkedAt: new Date().toISOString() };
  } finally {
    await rm(scratch, { recursive: true, force: true });
  }
}

export { inspectCanonicalProjectStack };
