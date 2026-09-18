import path from "node:path";

import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  sessionRepositoryProject,
  normalizeRepositoryMode
} from "@local/vibe64-core/server/projectRepository";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import { runVibe64Command } from "@local/vibe64-execution/server";
import {
  exactFileDiffPathspecs,
  parseGitNameStatusZ,
  parseGitNumstatZ,
  safeChangePath
} from "./sessionWorkSave.js";
import {
  GIT_HISTORY_RECORD_FORMAT,
  parseGitHistoryRecords
} from "./gitHistoryRecords.js";

const DEFAULT_HISTORY_LIMIT = 30;
const MAX_HISTORY_LIMIT = 50;
const DEFAULT_FILE_LIMIT = 200;
const MAX_FILE_LIMIT = 500;
const DEFAULT_DIFF_LINE_LIMIT = 800;
const MAX_DIFF_LINE_LIMIT = 5000;
const HISTORY_TIMEOUT_MS = 30_000;

function text(value = "") {
  return String(value || "").trim();
}

function repositoryError(message, code = "vibe64_repository_history_failed") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function boundedInteger(value, fallback, maximum) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(number) && number > 0 ? Math.min(number, maximum) : fallback;
}

function commitObjectId(value = "", errorCode = "vibe64_repository_history_commit_invalid") {
  const commit = text(value);
  if (!/^[a-f0-9]{40,64}$/u.test(commit)) {
    throw repositoryError("Choose a version from this project history.", errorCode);
  }
  return commit;
}

function repositoryReadContext(project = {}, session = null) {
  project = sessionRepositoryProject(project, session);
  const mode = normalizeRepositoryMode(project.repositoryMode || project.repository?.mode);
  const branch = text(
    project.repository?.defaultBranch ||
    session?.metadata?.source_default_branch ||
    session?.metadata?.base_branch
  );
  const sessionSourceRoot = session ? sessionSourcePath(session) : "";
  if (!mode || !branch) {
    throw repositoryError(
      "Version history requires a repository mode and default branch.",
      "vibe64_repository_history_context_incomplete"
    );
  }
  if (session && !sessionSourceRoot) {
    throw repositoryError(
      "Create the session source before opening its version history.",
      "vibe64_repository_history_session_source_missing"
    );
  }
  if (sessionSourceRoot) {
    return {
      argsPrefix: [],
      branch,
      cwd: sessionSourceRoot,
      executionRoot: sessionSourceRoot,
      mode,
      sessionId: text(session.sessionId || session.id),
      snapshotRef:
        text(session?.metadata?.canonical_commit) ||
        text(session?.metadata?.base_commit) ||
        `refs/heads/${branch}`
    };
  }
  if (mode === PROJECT_REPOSITORY_MODE_GITHUB || mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    const repositoryPath = mode === PROJECT_REPOSITORY_MODE_GITHUB
      ? text(project.githubMirrorPath)
      : text(project.canonicalRepositoryPath);
    if (!repositoryPath) {
      throw repositoryError(
        "The project repository cache is not available yet.",
        "vibe64_repository_history_cache_missing"
      );
    }
    const repositoryStorageRoot = path.dirname(repositoryPath);
    return {
      argsPrefix: ["--git-dir", repositoryPath],
      branch,
      cwd: repositoryStorageRoot,
      executionRoot: repositoryStorageRoot,
      mode,
      repositoryPath,
      sessionId: "",
      snapshotRef: `refs/heads/${branch}`
    };
  }
  if (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    const standaloneSourceRoot = text(project.sourceRoot);
    if (!standaloneSourceRoot) {
      throw repositoryError(
        "Standalone version history requires the explicitly selected local source folder.",
        "vibe64_repository_history_local_source_missing"
      );
    }
    return {
      argsPrefix: [],
      branch,
      cwd: standaloneSourceRoot,
      executionRoot: standaloneSourceRoot,
      mode,
      sessionId: "",
      snapshotRef: `refs/heads/${branch}`
    };
  }
  throw repositoryError("This repository mode has no history reader.", "vibe64_repository_history_mode_invalid");
}

async function git(context, args, {
  input,
  required = true,
  runCommand = runVibe64Command
} = {}) {
  const roots = [
    context.cwd,
    ...(context.repositoryPath ? [context.repositoryPath, path.dirname(context.repositoryPath)] : [])
  ];
  const result = await runCommand({
    actor: "daemon",
    allowedRoots: roots,
    args: [...context.argsPrefix, ...args],
    command: "git",
    cwd: context.cwd,
    envPolicy: "session",
    gitSafeDirectories: roots,
    input,
    mode: "capture",
    project: {
      projectRoot: context.executionRoot,
      repositoryMode: context.mode,
      sessionId: context.sessionId
    },
    purpose: "source",
    runtimes: ["git"],
    timeout: HISTORY_TIMEOUT_MS
  });
  if (required && result?.ok !== true) {
    throw repositoryError(
      text(result?.stderr || result?.stdout || result?.output || result?.error) || "Version history Git command failed."
    );
  }
  return result;
}

function output(result = {}) {
  return String(result.stdout || result.output || "");
}

async function gitText(context, args, options = {}) {
  return text(output(await git(context, args, options)));
}

function encodeCursor(value = {}) {
  return Buffer.from(JSON.stringify(value), "utf8").toString("base64url");
}

function decodeCursor(value = "") {
  if (!value) {
    return null;
  }
  try {
    const parsed = JSON.parse(Buffer.from(String(value), "base64url").toString("utf8"));
    if (!parsed || typeof parsed !== "object" || !/^[a-f0-9]{40,64}$/u.test(text(parsed.snapshot))) {
      throw new Error("invalid cursor");
    }
    const offset = Number(parsed.offset);
    if (!Number.isSafeInteger(offset) || offset < 0 || offset > 1_000_000) {
      throw new Error("invalid cursor offset");
    }
    return { offset, snapshot: text(parsed.snapshot) };
  } catch {
    throw repositoryError("Version history has an invalid page cursor.", "vibe64_repository_history_cursor_invalid");
  }
}

async function resolveSnapshot(context, cursor, runCommand) {
  const decoded = decodeCursor(cursor);
  const candidate = decoded?.snapshot || context.snapshotRef;
  const snapshot = await gitText(context, ["rev-parse", "--verify", `${candidate}^{commit}`], { runCommand });
  if (!/^[a-f0-9]{40,64}$/u.test(snapshot)) {
    throw repositoryError("Version history could not pin a repository version.", "vibe64_repository_history_snapshot_invalid");
  }
  return { offset: decoded?.offset || 0, snapshot };
}

async function inspectRepositoryHistory({
  cursor = "",
  limit = DEFAULT_HISTORY_LIMIT,
  project = {},
  runCommand = runVibe64Command,
  session = null
} = {}) {
  const context = repositoryReadContext(project, session);
  const pinned = await resolveSnapshot(context, cursor, runCommand);
  const boundedLimit = boundedInteger(limit, DEFAULT_HISTORY_LIMIT, MAX_HISTORY_LIMIT);
  const result = await git(context, [
    "log",
    "--first-parent",
    `--max-count=${boundedLimit + 1}`,
    `--skip=${pinned.offset}`,
    "-z",
    `--format=${GIT_HISTORY_RECORD_FORMAT}`,
    pinned.snapshot
  ], { runCommand });
  const records = parseGitHistoryRecords(output(result));
  const hasMore = records.length > boundedLimit;
  const versions = records.slice(0, boundedLimit);
  return {
    authorityAsOf: pinned.snapshot,
    hasMore,
    historySnapshotCommit: pinned.snapshot,
    limit: boundedLimit,
    nextCursor: hasMore
      ? encodeCursor({ offset: pinned.offset + boundedLimit, snapshot: pinned.snapshot })
      : "",
    ok: true,
    repositoryMode: context.mode,
    versions
  };
}

async function assertReachableCommit(context, commit, snapshot, runCommand) {
  commit = commitObjectId(commit);
  snapshot = commitObjectId(snapshot, "vibe64_repository_history_snapshot_invalid");
  const resolved = commit === snapshot
    ? snapshot
    : await gitText(context, ["rev-parse", "--verify", `${commit}^{commit}`], { runCommand });
  if (resolved !== commit) {
    throw repositoryError("Choose a version from this project history.", "vibe64_repository_history_commit_invalid");
  }
  const reachable = await git(context, ["merge-base", "--is-ancestor", commit, snapshot], {
    required: false,
    runCommand
  });
  if (reachable?.ok !== true) {
    throw repositoryError("That version is not part of the selected project history.", "vibe64_repository_history_commit_unreachable");
  }
  return resolved;
}

async function versionComparison(context, commit, runCommand) {
  const record = await gitText(context, ["rev-list", "--parents", "-n", "1", commit], { runCommand });
  const [, firstParent = ""] = record.split(/\s+/u);
  return firstParent
    ? { args: [firstParent, commit], parent: firstParent }
    : { args: ["--root", commit], parent: "" };
}

async function repositoryVersionFiles({
  commit = "",
  historySnapshotCommit = "",
  limit = DEFAULT_FILE_LIMIT,
  offset = 0,
  project = {},
  runCommand = runVibe64Command,
  session = null
} = {}) {
  const context = repositoryReadContext(project, session);
  const requestedSnapshot = commitObjectId(
    historySnapshotCommit,
    "vibe64_repository_history_snapshot_invalid"
  );
  const snapshot = await gitText(context, ["rev-parse", "--verify", `${requestedSnapshot}^{commit}`], { runCommand });
  commit = commitObjectId(commit);
  await assertReachableCommit(context, commit, snapshot, runCommand);
  const comparison = await versionComparison(context, commit, runCommand);
  const [statusResult, statResult] = await Promise.all([
    git(context, ["diff-tree", "--no-commit-id", "-r", "-M", "--name-status", "-z", ...comparison.args], { runCommand }),
    git(context, ["diff-tree", "--no-commit-id", "-r", "-M", "--numstat", "-z", ...comparison.args], { runCommand })
  ]);
  const statuses = parseGitNameStatusZ(output(statusResult));
  const stats = parseGitNumstatZ(output(statResult));
  const files = [...statuses.values()]
    .map((file) => ({ ...file, ...(stats.get(file.path) || { added: 0, deleted: 0 }) }))
    .sort((left, right) => left.path.localeCompare(right.path));
  const boundedLimit = boundedInteger(limit, DEFAULT_FILE_LIMIT, MAX_FILE_LIMIT);
  const boundedOffset = Math.max(0, Number.parseInt(String(offset ?? ""), 10) || 0);
  return {
    commit,
    files: files.slice(boundedOffset, boundedOffset + boundedLimit),
    historySnapshotCommit: snapshot,
    limit: boundedLimit,
    offset: boundedOffset,
    ok: true,
    parent: comparison.parent,
    totalCount: files.length,
    truncated: boundedOffset + boundedLimit < files.length
  };
}

async function repositoryVersionFileDiff({
  commit = "",
  historySnapshotCommit = "",
  lineLimit = DEFAULT_DIFF_LINE_LIMIT,
  path: requestedPath = "",
  project = {},
  runCommand = runVibe64Command,
  session = null
} = {}) {
  const context = repositoryReadContext(project, session);
  const requestedSnapshot = commitObjectId(
    historySnapshotCommit,
    "vibe64_repository_history_snapshot_invalid"
  );
  const snapshot = await gitText(context, ["rev-parse", "--verify", `${requestedSnapshot}^{commit}`], { runCommand });
  commit = commitObjectId(commit);
  await assertReachableCommit(context, commit, snapshot, runCommand);
  const comparison = await versionComparison(context, commit, runCommand);
  const filePath = safeChangePath(requestedPath);
  const result = comparison.parent
    ? await git(context, [
        "--no-literal-pathspecs",
        "diff",
        "--no-ext-diff",
        "--find-renames",
        "--unified=3",
        comparison.parent,
        commit,
        "--",
        ...exactFileDiffPathspecs(filePath)
      ], { runCommand })
    : await git(context, [
        "--no-literal-pathspecs",
        "show",
        "--format=",
        "--no-ext-diff",
        "--find-renames",
        "--unified=3",
        commit,
        "--",
        ...exactFileDiffPathspecs(filePath)
      ], { runCommand });
  const lines = output(result).replaceAll("\r\n", "\n").split("\n");
  const boundedLimit = boundedInteger(lineLimit, DEFAULT_DIFF_LINE_LIMIT, MAX_DIFF_LINE_LIMIT);
  return {
    commit,
    diff: lines.slice(0, boundedLimit).join("\n"),
    historySnapshotCommit: snapshot,
    lineLimit: boundedLimit,
    ok: true,
    parent: comparison.parent,
    path: filePath,
    shownLines: Math.min(lines.length, boundedLimit),
    totalLines: lines.length,
    truncated: lines.length > boundedLimit
  };
}

export {
  inspectRepositoryHistory,
  repositoryReadContext,
  repositoryVersionFileDiff,
  repositoryVersionFiles
};
