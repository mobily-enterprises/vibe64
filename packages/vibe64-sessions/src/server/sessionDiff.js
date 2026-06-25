import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);
const GIT_DIFF_BUFFER_BYTES = 8 * 1024 * 1024;
const GIT_COMMAND_TIMEOUT_MS = 30_000;

function normalizeOutput(value = "") {
  return String(value || "").trim();
}

async function gitOutput(cwd, args, {
  allowDiffExit = false
} = {}) {
  try {
    const result = await execFileAsync("git", args, {
      cwd,
      maxBuffer: GIT_DIFF_BUFFER_BYTES,
      timeout: GIT_COMMAND_TIMEOUT_MS
    });
    return normalizeOutput(result.stdout);
  } catch (error) {
    if (allowDiffExit && error?.code === 1) {
      return normalizeOutput(error.stdout);
    }
    throw new Error(normalizeOutput(error.stderr || error.stdout || error.message));
  }
}

async function untrackedFiles(worktreePath) {
  const output = await gitOutput(worktreePath, [
    "ls-files",
    "--others",
    "--exclude-standard"
  ]);
  return output
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

async function untrackedFileDiff(worktreePath, relativePath) {
  return gitOutput(worktreePath, [
    "diff",
    "--no-index",
    "--",
    "/dev/null",
    relativePath
  ], {
    allowDiffExit: true
  });
}

async function untrackedDiff(worktreePath) {
  const files = await untrackedFiles(worktreePath);
  const diffs = await Promise.all(files.map((relativePath) => {
    return untrackedFileDiff(worktreePath, relativePath);
  }));
  return diffs.filter(Boolean).join("\n");
}

async function inspectSessionDiff(session = {}) {
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  if (!worktreePath) {
    return {
      error: "Create the session clone before reviewing changes.",
      ok: false
    };
  }

  const [gitStatus, stagedDiff, unstagedDiff, extraDiff] = await Promise.all([
    gitOutput(worktreePath, ["status", "--short"]),
    gitOutput(worktreePath, ["diff", "--cached", "--binary"]),
    gitOutput(worktreePath, ["diff", "--binary"]),
    untrackedDiff(worktreePath)
  ]);
  const hasChanges = Boolean(gitStatus || stagedDiff || unstagedDiff || extraDiff);

  return {
    gitStatus,
    hasChanges,
    ok: true,
    stagedDiff,
    unstagedDiff,
    untrackedDiff: extraDiff,
    worktreePath
  };
}

export { inspectSessionDiff };
