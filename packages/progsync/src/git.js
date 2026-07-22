import fs from "node:fs/promises";

import { runProgSyncCommand } from "./command.js";
import { DEFAULT_GIT_BASE } from "./constants.js";
import { ProgSyncError } from "./errors.js";
import { absoluteProjectPath, slashPath } from "./paths.js";

async function runGit(projectRoot, args, options = {}) {
  try {
    const result = await gitResult(projectRoot, args, options);
    return result.stdout;
  } catch (error) {
    throw new ProgSyncError(
      "GIT_COMMAND_FAILED",
      `Git command failed: git ${args.join(" ")}`,
      {
        exitCode: error?.code,
        stderr: String(error?.stderr || "").trim()
      }
    );
  }
}

async function gitResult(projectRoot, args, options = {}) {
  return runProgSyncCommand("git", args, {
    allowedRoots: options.allowedRoots || [],
    cwd: projectRoot,
    env: options.env || {},
    input: options.input,
    maxBuffer: options.maxBuffer || 32 * 1024 * 1024,
    outputEncoding: "base64",
    reject: options.reject ?? true
  });
}

async function resolveGitBase(projectRoot, requestedBase = DEFAULT_GIT_BASE) {
  const result = await gitResult(
    projectRoot,
    ["rev-parse", "--verify", "--quiet", `${requestedBase}^{commit}`],
    { reject: false }
  );
  if (result.ok) {
    return result.stdout.trim();
  }
  if (requestedBase === DEFAULT_GIT_BASE && result.exitCode === 1) {
    return null;
  }
  throw new ProgSyncError(
    requestedBase === DEFAULT_GIT_BASE ? "GIT_REPOSITORY_REQUIRED" : "GIT_BASE_NOT_FOUND",
    requestedBase === DEFAULT_GIT_BASE
      ? `ProgSync requires a Git worktree: ${projectRoot}`
      : `Git base cannot be resolved: ${requestedBase}`,
    { requestedBase, stderr: String(result.stderr || "").trim() }
  );
}

async function assertGitRepository(projectRoot) {
  const result = await gitResult(
    projectRoot,
    ["rev-parse", "--is-inside-work-tree"],
    { reject: false }
  );
  if (!result.ok || result.stdout.trim() !== "true") {
    throw new ProgSyncError(
      "GIT_REPOSITORY_REQUIRED",
      `ProgSync requires a Git worktree: ${projectRoot}`,
      { stderr: String(result.stderr || "").trim() }
    );
  }
  return true;
}

function trackedFileMode(mode) {
  return (mode & 0o111) === 0 ? 0o644 : 0o755;
}

async function readWorkingFile(projectRoot, relativePath) {
  try {
    const absolutePath = absoluteProjectPath(projectRoot, relativePath);
    const stat = await fs.lstat(absolutePath);
    if (!stat.isFile()) {
      throw new ProgSyncError(
        "REGULAR_FILE_REQUIRED",
        `ProgSync module paths must be regular files: ${relativePath}`
      );
    }
    return {
      exists: true,
      mode: trackedFileMode(stat.mode),
      permissions: stat.mode & 0o777,
      source: await fs.readFile(absolutePath, "utf8")
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return {
        exists: false,
        mode: null,
        permissions: null,
        source: null
      };
    }
    throw error;
  }
}

async function readGitFile(projectRoot, baseCommit, relativePath) {
  if (!baseCommit) {
    return {
      exists: false,
      mode: null,
      permissions: null,
      source: null
    };
  }
  const normalized = slashPath(relativePath);
  const tree = await gitResult(projectRoot, [
    "ls-tree",
    "-z",
    baseCommit,
    "--",
    normalized
  ], { reject: false });
  if (!tree.ok) {
    throw new ProgSyncError(
      "GIT_FILE_READ_FAILED",
      `Cannot inspect ${normalized} at Git base ${baseCommit}.`,
      { stderr: String(tree.stderr || "").trim() }
    );
  }
  if (!tree.stdout) {
    return { exists: false, mode: null, permissions: null, source: null };
  }
  const metadata = tree.stdout.split("\0")[0];
  const modeText = metadata.match(/^(\d{6})\s/u)?.[1];
  if (modeText !== "100644" && modeText !== "100755") {
    throw new ProgSyncError(
      "REGULAR_FILE_REQUIRED",
      `Git baseline path is not a supported regular text file: ${normalized}`,
      { gitMode: modeText || null }
    );
  }
  const result = await gitResult(projectRoot, ["show", `${baseCommit}:${normalized}`], {
    reject: false
  });
  if (!result.ok) {
    throw new ProgSyncError(
      "GIT_FILE_READ_FAILED",
      `Cannot read ${normalized} from Git base ${baseCommit}.`,
      { stderr: String(result.stderr || "").trim() }
    );
  }
  return {
    exists: true,
    mode: modeText === "100755" ? 0o755 : 0o644,
    permissions: modeText === "100755" ? 0o755 : 0o644,
    source: result.stdout
  };
}

async function resolveOptionalCommit(projectRoot, revision) {
  const result = await gitResult(
    projectRoot,
    ["rev-parse", "--verify", "--quiet", `${revision}^{commit}`],
    { reject: false }
  );
  return result.ok ? result.stdout.trim() : null;
}

async function currentGitContext(projectRoot) {
  const [head, branchResult] = await Promise.all([
    resolveGitBase(projectRoot),
    gitResult(projectRoot, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      reject: false
    })
  ]);
  return {
    branch: branchResult.ok ? branchResult.stdout.trim() || null : null,
    head
  };
}

async function isGitAncestor(projectRoot, ancestor, descendant) {
  if (!ancestor || !descendant) {
    return false;
  }
  const result = await gitResult(
    projectRoot,
    ["merge-base", "--is-ancestor", ancestor, descendant],
    { reject: false }
  );
  if (result.exitCode === 0) {
    return true;
  }
  if (result.exitCode === 1) {
    return false;
  }
  throw new ProgSyncError(
    "GIT_ANCESTRY_FAILED",
    `Cannot compare Git commits ${ancestor} and ${descendant}.`,
    { stderr: String(result.stderr || "").trim() }
  );
}

function parseNulPaths(output) {
  return String(output || "")
    .split("\0")
    .map((value) => slashPath(value))
    .filter(Boolean);
}

async function changedGitPaths(projectRoot, { base = DEFAULT_GIT_BASE } = {}) {
  await assertGitRepository(projectRoot);
  const baseCommit = await resolveGitBase(projectRoot, base);
  const paths = new Set();
  if (baseCommit) {
    const changed = await runGit(projectRoot, [
      "diff",
      "--name-only",
      "-z",
      baseCommit,
      "--"
    ]);
    for (const filePath of parseNulPaths(changed)) {
      paths.add(filePath);
    }
  } else {
    const tracked = await runGit(projectRoot, ["ls-files", "-z"]);
    for (const filePath of parseNulPaths(tracked)) {
      paths.add(filePath);
    }
  }
  const untracked = await runGit(projectRoot, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z"
  ]);
  for (const filePath of parseNulPaths(untracked)) {
    paths.add(filePath);
  }
  return {
    baseCommit,
    paths: [...paths].sort((left, right) => left.localeCompare(right))
  };
}

export {
  assertGitRepository,
  changedGitPaths,
  currentGitContext,
  gitResult,
  isGitAncestor,
  readGitFile,
  parseNulPaths,
  readWorkingFile,
  resolveGitBase,
  resolveOptionalCommit,
  runGit
};
