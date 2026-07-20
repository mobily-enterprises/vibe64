import { lstat } from "node:fs/promises";
import path from "node:path";

import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT,
  WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR,
  WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE,
  normalizeRepositoryMode,
  normalizeWorkflowRepositoryProfile
} from "@local/vibe64-core/server/projectRepository";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  runVibe64Command
} from "@local/vibe64-execution/server";

const GIT_COMMAND_TIMEOUT_MS = 15_000;
const EMPTY_GIT_TREE = "4b825dc642cb6eb9a060e54bf8d69288fbee4904";
const MAX_UNPUSHED_COMMITS = 500;
const MAX_SOURCE_SAFETY_CHANGE_UNITS = 500;
const MAX_COUNTED_UNTRACKED_BYTES = 50_000;
const UNTRACKED_BYTES_PER_CHANGE_UNIT = 100;

function normalizeOutput(value = "") {
  return String(value || "").trim();
}

async function gitResult(cwd, args = []) {
  return runVibe64Command({
    actor: "daemon",
    allowedRoots: [cwd],
    args,
    command: "git",
    cwd,
    envPolicy: "session",
    gitSafeDirectories: [cwd],
    mode: "capture",
    purpose: "source-editor",
    runtimes: ["git"],
    timeout: GIT_COMMAND_TIMEOUT_MS
  });
}

async function gitOutput(cwd, args = [], {
  optional = false,
  trim = true
} = {}) {
  const result = await gitResult(cwd, args);
  if (result.ok === true) {
    return trim ? normalizeOutput(result.stdout) : String(result.stdout || "");
  }
  if (optional) {
    return "";
  }
  throw new Error(
    normalizeOutput(result.stderr || result.stdout || result.output || result.error) ||
    "Git inspection failed."
  );
}

function outputLines(value = "") {
  return String(value || "")
    .split(/\r?\n/u)
    .map((line) => line.trim())
    .filter(Boolean);
}

function parseGitStatus(status = "") {
  const entries = outputLines(status);
  return {
    changedFileCount: entries.length,
    hasUncommittedChanges: entries.length > 0,
    untrackedFileCount: entries.filter((entry) => entry.startsWith("?? ")).length
  };
}

function parseGitNumstat(numstat = "") {
  let binaryFileCount = 0;
  let changedLineCount = 0;
  for (const line of outputLines(numstat)) {
    const [added = "", removed = ""] = line.split("\t", 3);
    if (added === "-" || removed === "-") {
      binaryFileCount += 1;
      continue;
    }
    changedLineCount += Math.max(0, Number(added) || 0);
    changedLineCount += Math.max(0, Number(removed) || 0);
  }
  return {
    binaryFileCount,
    changedLineCount
  };
}

function safeWorktreeChildPath(worktreePath = "", relativePath = "") {
  const root = path.resolve(worktreePath);
  const child = path.resolve(root, relativePath);
  if (child !== root && child.startsWith(`${root}${path.sep}`)) {
    return child;
  }
  return "";
}

async function untrackedFileBytes(worktreePath = "") {
  const output = await gitOutput(worktreePath, [
    "ls-files",
    "--others",
    "--exclude-standard",
    "-z"
  ], {
    trim: false
  });
  const paths = output.split("\0").filter(Boolean);
  let byteCount = 0;
  for (const relativePath of paths) {
    const filePath = safeWorktreeChildPath(worktreePath, relativePath);
    if (!filePath) {
      continue;
    }
    try {
      const stats = await lstat(filePath);
      if (stats.isFile()) {
        byteCount += stats.size;
      }
    } catch (error) {
      if (error?.code !== "ENOENT") {
        throw error;
      }
    }
    if (byteCount >= MAX_COUNTED_UNTRACKED_BYTES) {
      return MAX_COUNTED_UNTRACKED_BYTES;
    }
  }
  return byteCount;
}

function repositorySafetyProfile(session = {}, remoteNames = []) {
  const repositoryMode = normalizeRepositoryMode(session.metadata?.repository_mode);
  const workflowRepositoryProfile = normalizeWorkflowRepositoryProfile(
    session.metadata?.workflow_repository_profile
  );
  const explicitlyLocal = repositoryMode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE ||
    workflowRepositoryProfile === WORKFLOW_REPOSITORY_PROFILE_LOCAL_SOURCE;
  const explicitlyRemote = repositoryMode === PROJECT_REPOSITORY_MODE_GITHUB ||
    repositoryMode === PROJECT_REPOSITORY_MODE_MANAGED_GIT ||
    workflowRepositoryProfile === WORKFLOW_REPOSITORY_PROFILE_GITHUB_PR ||
    workflowRepositoryProfile === WORKFLOW_REPOSITORY_PROFILE_CANONICAL_GIT;
  const requiresPush = explicitlyLocal
    ? false
    : explicitlyRemote || remoteNames.length > 0;
  return {
    repositoryMode: repositoryMode || (
      requiresPush ? PROJECT_REPOSITORY_MODE_MANAGED_GIT : PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    ),
    requiresPush,
    workflowRepositoryProfile
  };
}

async function validCommit(cwd, candidate = "") {
  const commit = normalizeOutput(candidate);
  if (!commit) {
    return "";
  }
  const result = await gitResult(cwd, ["cat-file", "-e", `${commit}^{commit}`]);
  return result.ok === true ? commit : "";
}

async function originMainContainsHead(cwd) {
  const remoteMain = await validCommit(cwd, "refs/remotes/origin/main");
  if (!remoteMain) {
    return false;
  }
  const result = await gitResult(cwd, [
    "merge-base",
    "--is-ancestor",
    "HEAD",
    "refs/remotes/origin/main"
  ]);
  return result.ok === true;
}

async function unpushedCommits(cwd, {
  baseCommit = "",
  head = ""
} = {}) {
  if (!head) {
    return [];
  }
  if (await originMainContainsHead(cwd)) {
    return [];
  }

  const validBaseCommit = await validCommit(cwd, baseCommit);
  const revision = validBaseCommit ? `${validBaseCommit}..HEAD` : "HEAD";
  return outputLines(await gitOutput(cwd, [
    "rev-list",
    "--reverse",
    `--max-count=${MAX_UNPUSHED_COMMITS}`,
    revision
  ]));
}

async function unpushedDiffBase(cwd, commits = []) {
  const oldestCommit = commits[0] || "";
  if (!oldestCommit) {
    return "HEAD";
  }
  return await gitOutput(cwd, ["rev-parse", "--verify", `${oldestCommit}^`], {
    optional: true
  }) || EMPTY_GIT_TREE;
}

function sourceSafetyChangeUnits({
  binaryFileCount = 0,
  changedFileCount = 0,
  changedLineCount = 0,
  unpushedCommitCount = 0,
  untrackedByteCount = 0,
  unsafe = false
} = {}) {
  if (!unsafe) {
    return 0;
  }
  return Math.max(
    1,
    Math.max(0, Number(changedLineCount) || 0) +
      (Math.max(0, Number(binaryFileCount) || 0) * 50) +
      Math.ceil(
        Math.max(0, Number(untrackedByteCount) || 0) / UNTRACKED_BYTES_PER_CHANGE_UNIT
      ) +
      (Math.max(0, Number(unpushedCommitCount) || 0) * 5) +
      Math.max(0, Number(changedFileCount) || 0)
  );
}

function sourceSafetySeverity(changeUnits = 0) {
  const units = Math.max(0, Number(changeUnits) || 0);
  const ratio = Math.min(1, units / MAX_SOURCE_SAFETY_CHANGE_UNITS);
  return Math.round(ratio * 100);
}

function unavailableSourceSafety(session = {}) {
  const profile = repositorySafetyProfile(session);
  return {
    available: false,
    branch: "",
    changeUnits: 0,
    changedFileCount: 0,
    changedLineCount: 0,
    checkedAt: new Date().toISOString(),
    hasUncommittedChanges: false,
    hasUnpushedCommits: false,
    head: "",
    ok: true,
    repositoryMode: profile.repositoryMode,
    requiresPush: profile.requiresPush,
    sessionId: normalizeOutput(session.sessionId),
    severity: 0,
    unpushedCommitCount: 0,
    untrackedByteCount: 0,
    untrackedFileCount: 0,
    unsafe: false,
    workflowRepositoryProfile: profile.workflowRepositoryProfile
  };
}

async function inspectSessionSourceSafety(session = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    return unavailableSourceSafety(session);
  }

  const [
    branch,
    head,
    remoteNamesOutput,
    statusOutput,
    untrackedByteCount
  ] = await Promise.all([
    gitOutput(worktreePath, ["symbolic-ref", "--quiet", "--short", "HEAD"], {
      optional: true
    }),
    gitOutput(worktreePath, ["rev-parse", "--verify", "HEAD"], {
      optional: true
    }),
    gitOutput(worktreePath, ["remote"]),
    gitOutput(worktreePath, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all"
    ]),
    untrackedFileBytes(worktreePath)
  ]);
  const remoteNames = outputLines(remoteNamesOutput);
  const profile = repositorySafetyProfile(session, remoteNames);
  const status = parseGitStatus(statusOutput);
  const commits = profile.requiresPush
    ? await unpushedCommits(worktreePath, {
        baseCommit: session.metadata?.base_commit,
        head
      })
    : [];
  const unpushedCommitCount = commits.length;
  const hasUnpushedCommits = unpushedCommitCount > 0;
  const unsafe = status.hasUncommittedChanges || hasUnpushedCommits;
  const diffBase = head
    ? await unpushedDiffBase(worktreePath, commits)
    : EMPTY_GIT_TREE;
  const numstat = parseGitNumstat(await gitOutput(worktreePath, [
    "diff",
    "--numstat",
    diffBase
  ]));
  const changeUnits = sourceSafetyChangeUnits({
    ...numstat,
    ...status,
    unpushedCommitCount,
    untrackedByteCount,
    unsafe
  });

  return {
    available: true,
    branch,
    changeUnits,
    changedFileCount: status.changedFileCount,
    changedLineCount: numstat.changedLineCount,
    checkedAt: new Date().toISOString(),
    hasUncommittedChanges: status.hasUncommittedChanges,
    hasUnpushedCommits,
    head,
    ok: true,
    remoteCount: remoteNames.length,
    repositoryMode: profile.repositoryMode,
    requiresPush: profile.requiresPush,
    sessionId: normalizeOutput(session.sessionId),
    severity: sourceSafetySeverity(changeUnits),
    unpushedCommitCount,
    untrackedByteCount,
    untrackedFileCount: status.untrackedFileCount,
    unsafe,
    workflowRepositoryProfile: profile.workflowRepositoryProfile
  };
}

export {
  inspectSessionSourceSafety,
  parseGitNumstat,
  parseGitStatus,
  repositorySafetyProfile,
  sourceSafetyChangeUnits,
  sourceSafetySeverity
};
