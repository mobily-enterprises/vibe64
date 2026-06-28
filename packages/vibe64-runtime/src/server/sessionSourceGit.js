import { execFile } from "node:child_process";
import { readFile, rm } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";

const execFileAsync = promisify(execFile);
const GIT_TIMEOUT_MS = 30_000;
const GIT_REPACK_TIMEOUT_MS = 60_000;
const COMMAND_BUFFER_BYTES = 4 * 1024 * 1024;

function commandOutput(error = {}) {
  return normalizeText(`${error.stdout || ""}\n${error.stderr || ""}`) ||
    normalizeText(error.message);
}

async function runGit(sourceRoot = "", args = [], {
  timeout = GIT_TIMEOUT_MS
} = {}) {
  try {
    const result = await execFileAsync("git", [
      "-C",
      sourceRoot,
      ...args
    ], {
      maxBuffer: COMMAND_BUFFER_BYTES,
      timeout
    });
    return {
      ok: true,
      output: normalizeText(`${result.stdout || ""}\n${result.stderr || ""}`),
      stderr: String(result.stderr || ""),
      stdout: String(result.stdout || "")
    };
  } catch (error) {
    return {
      ok: false,
      output: commandOutput(error),
      stderr: String(error.stderr || ""),
      stdout: String(error.stdout || "")
    };
  }
}

function pathInsideOrEqual(rootPath = "", candidatePath = "") {
  if (!rootPath || !candidatePath) {
    return false;
  }
  const relativePath = path.relative(rootPath, candidatePath);
  return relativePath === "" || (!relativePath.startsWith("..") && !path.isAbsolute(relativePath));
}

function resolveGitPath(sourceRoot = "", gitPath = "") {
  const normalizedGitPath = normalizeText(gitPath);
  if (!normalizedGitPath) {
    return "";
  }
  return path.isAbsolute(normalizedGitPath)
    ? normalizedGitPath
    : path.resolve(sourceRoot, normalizedGitPath);
}

async function fileHasContent(filePath = "") {
  if (!filePath || !await pathExists(filePath)) {
    return false;
  }
  return normalizeText(await readFile(filePath, "utf8")) !== "";
}

async function sessionSourceGitAlternatesPath(sourceRoot = "") {
  const normalizedSourceRoot = normalizeText(sourceRoot) ? path.resolve(sourceRoot) : "";
  if (!normalizedSourceRoot) {
    throw vibe64Error(
      "Cannot inspect session source Git alternates without a source root.",
      "vibe64_session_source_root_required"
    );
  }
  const worktreeResult = await runGit(normalizedSourceRoot, [
    "rev-parse",
    "--is-inside-work-tree"
  ]);
  if (!worktreeResult.ok || normalizeText(worktreeResult.stdout || worktreeResult.output) !== "true") {
    return "";
  }
  const gitPathResult = await runGit(normalizedSourceRoot, [
    "rev-parse",
    "--git-path",
    "objects/info/alternates"
  ]);
  if (!gitPathResult.ok) {
    throw vibe64Error(
      `Cannot resolve session source Git alternates path: ${gitPathResult.output}`,
      "vibe64_session_source_git_alternates_path_failed"
    );
  }
  return resolveGitPath(normalizedSourceRoot, gitPathResult.stdout || gitPathResult.output);
}

async function ensureSessionSourceGitAlternatesDissociated(sourceRoot = "") {
  const normalizedSourceRoot = normalizeText(sourceRoot) ? path.resolve(sourceRoot) : "";
  if (!normalizedSourceRoot) {
    throw vibe64Error(
      "Cannot dissociate session source Git alternates without a source root.",
      "vibe64_session_source_root_required"
    );
  }
  const alternatesPath = await sessionSourceGitAlternatesPath(normalizedSourceRoot);
  if (!alternatesPath || !await fileHasContent(alternatesPath)) {
    return {
      alternatesPath,
      ok: true,
      repaired: false,
      sourceRoot: normalizedSourceRoot
    };
  }
  if (!pathInsideOrEqual(normalizedSourceRoot, alternatesPath)) {
    throw vibe64Error(
      `Session source Git alternates file is outside the session source: ${alternatesPath}`,
      "vibe64_session_source_git_alternates_outside_source"
    );
  }
  const repackResult = await runGit(normalizedSourceRoot, [
    "repack",
    "-a",
    "-d"
  ], {
    timeout: GIT_REPACK_TIMEOUT_MS
  });
  if (!repackResult.ok) {
    throw vibe64Error(
      `Cannot dissociate session source from Git alternates: ${repackResult.output}`,
      "vibe64_session_source_git_alternates_dissociate_failed"
    );
  }
  await rm(alternatesPath, {
    force: true
  });
  return {
    alternatesPath,
    ok: true,
    repaired: true,
    sourceRoot: normalizedSourceRoot
  };
}

export {
  ensureSessionSourceGitAlternatesDissociated,
  sessionSourceGitAlternatesPath
};
