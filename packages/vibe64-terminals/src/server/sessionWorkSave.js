import crypto from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  PROJECT_REPOSITORY_MODE_GITHUB,
  PROJECT_REPOSITORY_MODE_LOCAL_SOURCE,
  PROJECT_REPOSITORY_MODE_MANAGED_GIT,
  normalizeRepositoryMode
} from "@local/vibe64-core/server/projectRepository";
import {
  repositoryUpdateRelationship,
  repositoryUpdateStrategy
} from "@local/vibe64-core/shared";
import {
  checkpointRefs,
  createGitTurnCheckpoint,
  githubMirrorRefreshInvocation,
  runVibe64Command,
  writeGitWorktreeTree
} from "@local/vibe64-execution/server";
import {
  GIT_HISTORY_RECORD_FORMAT,
  parseGitHistoryRecords
} from "./gitHistoryRecords.js";

const SAVE_TIMEOUT_MS = 120_000;
const DEFAULT_CHANGE_FILE_LIMIT = 200;
const MAX_CHANGE_FILE_LIMIT = 500;
const DEFAULT_CHANGE_DIFF_LINE_LIMIT = 800;
const MAX_CHANGE_DIFF_LINE_LIMIT = 5000;
const INCOMING_VERSION_LIMIT = 5;
const SESSION_WORK_COMMAND_SCOPE = Symbol("vibe64-session-work-command-scope");
const SESSION_WORK_OPERATION_COMMAND_PATH = fileURLToPath(new URL(
  "./sessionWorkOperationCommand.js",
  import.meta.url
));

function text(value = "") {
  return String(value || "").trim();
}

function normalizedDerivedArtifactPaths(paths = []) {
  return [...new Set((Array.isArray(paths) ? paths : [])
    .map(text)
    .filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function metadata(session = {}) {
  return session?.metadata && typeof session.metadata === "object"
    ? session.metadata
    : {};
}

function saveError(message, code = "vibe64_session_save_failed", details = {}) {
  const error = new Error(message || "Vibe64 could not save this session.");
  error.code = code;
  error.details = details && typeof details === "object" && !Array.isArray(details)
    ? { ...details }
    : {};
  Object.assign(error, details);
  return error;
}

function repositoryContext(session = {}, project = {}) {
  const sessionMetadata = metadata(session);
  const mode = normalizeRepositoryMode(project.repositoryMode || project.repository?.mode);
  const branch = text(
    project.repository?.defaultBranch ||
    sessionMetadata.source_default_branch ||
    sessionMetadata.base_branch
  );
  const worktreePath = text(session.sourcePath || sessionMetadata.source_path);
  const sessionId = text(session.sessionId || session.id);
  const baseCommit = text(sessionMetadata.base_commit);
  const lastCanonicalCommit = text(sessionMetadata.canonical_commit) || baseCommit;
  const standaloneSourceRoot = mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
    ? text(project.sourceRoot)
    : "";
  if (
    !mode ||
    !branch ||
    !worktreePath ||
    !sessionId ||
    !baseCommit ||
    (mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE && !standaloneSourceRoot)
  ) {
    throw saveError(
      "Session Save requires a complete repository mode, branch, session source, base commit, and authority.",
      "vibe64_session_save_context_incomplete"
    );
  }
  const remoteUrl = mode === PROJECT_REPOSITORY_MODE_GITHUB
    ? text(project.githubRepository?.cloneUrl || project.repository?.github?.cloneUrl || sessionMetadata.source_remote_url)
    : mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT
      ? text(project.canonicalRepositoryPath || sessionMetadata.source_remote_url)
      : standaloneSourceRoot;
  if (!remoteUrl) {
    throw saveError(
      "Session Save cannot find the canonical repository authority.",
      "vibe64_session_save_authority_missing"
    );
  }
  return {
    baseCommit,
    branch,
    lastCanonicalCommit,
    mode,
    remoteUrl,
    sessionId,
    standaloneSourceRoot,
    worktreePath
  };
}

function commandProject(context = {}, project = {}) {
  return {
    ownerUserKey: text(project.ownerUserKey || project.githubRepository?.owner),
    projectRoot: context.worktreePath,
    repositoryMode: context.mode,
    sessionId: context.sessionId
  };
}

function scopedSessionWorkCommand(runCommand, context = {}, project = {}, {
  label = "Session repository work",
  operationId = crypto.randomUUID()
} = {}) {
  if (runCommand?.[SESSION_WORK_COMMAND_SCOPE]) {
    return runCommand;
  }
  const projectSlug = text(project.slug || project.projectSlug);
  let commandTail = Promise.resolve();
  const scoped = (request = {}) => {
    const command = commandTail.then(() => runCommand({
      ...request,
      execution: {
        ...(request.execution || {}),
        kind: "job",
        label,
        lifecycle: "finite",
        operationId: text(operationId),
        ownerId: context.sessionId,
        projectSlug,
        sessionId: context.sessionId
      },
      project: {
        ...(request.project || {}),
        ...(projectSlug ? { slug: projectSlug } : {})
      },
      session: {
        ...(request.session || {}),
        sessionId: context.sessionId
      }
    }));
    commandTail = command.then(() => undefined, () => undefined);
    return command;
  };
  Object.defineProperty(scoped, SESSION_WORK_COMMAND_SCOPE, { value: true });
  return scoped;
}

async function saveCommand(runCommand, context, command, args, {
  additionalAllowedRoots = [],
  commandOptions = {},
  cwd = context.worktreePath,
  env = {},
  input,
  project = {}
} = {}) {
  const allowedRoots = [
    context.worktreePath,
    path.dirname(context.worktreePath),
    ...(context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      ? [context.standaloneSourceRoot, path.dirname(context.standaloneSourceRoot)]
      : []),
    ...(path.isAbsolute(context.remoteUrl) ? [context.remoteUrl, path.dirname(context.remoteUrl)] : []),
    ...additionalAllowedRoots.flatMap((root) => {
      const normalized = text(root);
      return normalized ? [normalized, path.dirname(normalized)] : [];
    })
  ];
  return runCommand({
    actor: "daemon",
    allowedRoots,
    args,
    command,
    cwd,
    env,
    envPolicy: "session",
    gitSafeDirectories: allowedRoots,
    input,
    mode: "capture",
    project: commandProject(context, project),
    purpose: commandOptions.gitTransport?.startsWith("github") ? "github" : "source",
    runtimes: commandOptions.gitTransport === "github-https" ? ["git", "gh"] : ["git"],
    timeout: SAVE_TIMEOUT_MS,
    ...commandOptions
  });
}

function sessionWorkOperationProject(context, project = {}) {
  const projectSlug = text(project.slug || project.projectSlug);
  return {
    ...(context.mode === PROJECT_REPOSITORY_MODE_GITHUB
      ? {
          githubMirrorPath: text(project.githubMirrorPath),
          githubRepository: { cloneUrl: context.remoteUrl }
        }
      : {}),
    ...(context.mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT
      ? { canonicalRepositoryPath: context.remoteUrl }
      : {}),
    ...(context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE
      ? { sourceRoot: context.standaloneSourceRoot }
      : {}),
    ownerUserKey: text(project.ownerUserKey || project.githubRepository?.owner),
    projectSlug,
    repository: {
      defaultBranch: context.branch,
      mode: context.mode,
      ...(context.mode === PROJECT_REPOSITORY_MODE_GITHUB
        ? { github: { cloneUrl: context.remoteUrl } }
        : {})
    },
    repositoryMode: context.mode,
    slug: projectSlug
  };
}

function sessionWorkOperationSession(context) {
  return {
    metadata: {
      base_branch: context.branch,
      base_commit: context.baseCommit,
      canonical_commit: context.lastCanonicalCommit,
      source_path: context.worktreePath,
      source_remote_url: context.remoteUrl
    },
    sessionId: context.sessionId,
    sourcePath: context.worktreePath
  };
}

async function runSessionWorkOperation({
  commandOptions = {},
  context,
  input = {},
  label,
  operation,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand
}) {
  const scopedRunCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label,
    operationId
  });
  const result = await saveCommand(
    scopedRunCommand,
    context,
    "node",
    [SESSION_WORK_OPERATION_COMMAND_PATH],
    {
      additionalAllowedRoots: [path.dirname(SESSION_WORK_OPERATION_COMMAND_PATH)],
      commandOptions: {
        ...commandOptions,
        runtimes: [
          "node26",
          "git",
          ...(commandOptions.gitTransport === "github-https" ? ["gh"] : [])
        ]
      },
      input: JSON.stringify({
        input: {
          ...input,
          operationId,
          project: sessionWorkOperationProject(context, project),
          session: sessionWorkOperationSession(context)
        },
        operation
      }),
      project
    }
  );
  const serialized = String(result?.stdout || result?.output || "").trim();
  let response = null;
  try {
    response = JSON.parse(serialized);
  } catch {
    // The managed command result below carries the useful execution failure.
  }
  if (response?.ok === true) {
    return response.value;
  }
  if (response?.error) {
    throw saveError(
      response.error.message,
      response.error.code || "vibe64_session_work_operation_failed",
      response.error.details
    );
  }
  throw saveError(
    text(result?.stderr || result?.error || result?.output) || "Session repository inspection failed.",
    text(result?.code) || "vibe64_session_work_operation_failed"
  );
}

async function git(runCommand, context, args, {
  required = true,
  ...options
} = {}) {
  const result = await saveCommand(runCommand, context, "git", args, options);
  if (required && result?.ok !== true) {
    throw saveError(
      text(result?.stderr || result?.stdout || result?.output || result?.error) || "Git Save command failed.",
      text(result?.code) || "vibe64_session_save_git_failed",
      { gitArgs: args }
    );
  }
  return result;
}

function output(result = {}) {
  return text(result.stdout || result.output);
}

async function gitOutput(runCommand, context, args, options = {}) {
  return output(await git(runCommand, context, args, options));
}

async function changedPathsBetween(runCommand, context, baseCommit, tree, options = {}) {
  const result = await git(runCommand, context, [
    "diff-tree",
    "--no-commit-id",
    "--name-status",
    "-r",
    "-z",
    baseCommit,
    tree
  ], options);
  return [...parseGitNameStatusZ(result.stdout || result.output).keys()]
    .sort((left, right) => left.localeCompare(right));
}

async function countCommitsBetween(runCommand, context, fromCommit, toCommit, options = {}) {
  const count = Number(await gitOutput(runCommand, context, [
    "rev-list",
    "--count",
    `${fromCommit}..${toCommit}`
  ], options));
  return Number.isSafeInteger(count) && count >= 0 ? count : 0;
}

async function incomingVersionsBetween(
  runCommand,
  context,
  fromCommit,
  toCommit,
  options = {}
) {
  const result = await git(runCommand, context, [
    "log",
    "--topo-order",
    `--max-count=${INCOMING_VERSION_LIMIT + 1}`,
    "-z",
    `--format=${GIT_HISTORY_RECORD_FORMAT}`,
    `${fromCommit}..${toCommit}`
  ], options);
  const records = parseGitHistoryRecords(String(result.stdout || result.output || ""));
  return {
    incomingVersions: records.slice(0, INCOMING_VERSION_LIMIT),
    incomingVersionsTruncated: records.length > INCOMING_VERSION_LIMIT
  };
}

async function optionalGitOutput(runCommand, context, args, options = {}) {
  const result = await git(runCommand, context, args, {
    ...options,
    required: false
  });
  return result?.ok === true ? output(result) : "";
}

async function commitTree(runCommand, context, commit, options = {}) {
  return gitOutput(runCommand, context, [
    "rev-parse",
    "--verify",
    `${commit}^{tree}`
  ], options);
}

async function commitIsAncestor(runCommand, context, ancestor, descendant, options = {}) {
  if (ancestor === descendant) {
    return true;
  }
  const result = await git(runCommand, context, [
    "merge-base",
    "--is-ancestor",
    ancestor,
    descendant
  ], {
    ...options,
    required: false
  });
  return result?.ok === true;
}

async function observedCanonicalCommit(runCommand, context, options = {}) {
  const [stable, recorded, base] = await Promise.all([
    optionalGitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      `${canonicalRef(context)}^{commit}`
    ], options),
    context.lastCanonicalCommit
    ? await optionalGitOutput(runCommand, context, [
        "rev-parse",
        "--verify",
        `${context.lastCanonicalCommit}^{commit}`
      ], options)
      : "",
    gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      `${context.baseCommit}^{commit}`
    ], options)
  ]);
  let observed = stable || recorded || base;
  for (const candidate of [recorded, base].filter(Boolean)) {
    if (candidate === observed) {
      continue;
    }
    if (await commitIsAncestor(runCommand, context, observed, candidate, options)) {
      observed = candidate;
    }
  }
  return observed;
}

async function sessionWorkComparison(runCommand, context, {
  baseCommit,
  canonicalCommit,
  sessionHead,
  worktreeTree
}, options = {}) {
  const [baseTree, canonicalTree] = await Promise.all([
    commitTree(runCommand, context, baseCommit, options),
    commitTree(runCommand, context, canonicalCommit, options)
  ]);
  if (worktreeTree === canonicalTree) {
    return {
      baseTree,
      canonicalTree,
      changeBaseCommit: canonicalCommit,
      changeBaseTree: canonicalTree,
      changedPaths: [],
      sessionMatchesCanonical: true
    };
  }
  const changeBaseCommit = await gitOutput(runCommand, context, [
    "merge-base",
    canonicalCommit,
    sessionHead
  ], options);
  const changeBaseTree = changeBaseCommit === canonicalCommit
    ? canonicalTree
    : await commitTree(runCommand, context, changeBaseCommit, options);
  const changedPaths = worktreeTree === changeBaseTree
    ? []
    : await changedPathsBetween(
        runCommand,
        context,
        changeBaseCommit,
        worktreeTree,
        options
      );
  return {
    baseTree,
    canonicalTree,
    changeBaseCommit,
    changeBaseTree,
    changedPaths,
    sessionMatchesCanonical: worktreeTree === canonicalTree
  };
}

function boundedInteger(value, fallback, maximum) {
  const number = Number.parseInt(String(value ?? ""), 10);
  return Number.isSafeInteger(number) && number > 0
    ? Math.min(number, maximum)
    : fallback;
}

function parseGitNameStatusZ(value = "") {
  const fields = String(value || "").split("\0");
  const files = new Map();
  for (let index = 0; index < fields.length;) {
    const status = text(fields[index++]);
    if (!status) {
      continue;
    }
    const previousPath = /^[CR]/u.test(status) ? fields[index++] : "";
    const filePath = fields[index++];
    if (!filePath) {
      continue;
    }
    files.set(filePath, {
      path: filePath,
      ...(previousPath ? { previousPath } : {}),
      status: status.slice(0, 1)
    });
  }
  return files;
}

function numericStat(value = "") {
  const normalized = text(value);
  if (normalized === "-") {
    return null;
  }
  const number = Number.parseInt(normalized, 10);
  return Number.isSafeInteger(number) && number >= 0 ? number : 0;
}

function parseGitNumstatZ(value = "") {
  const fields = String(value || "").split("\0");
  const stats = new Map();
  for (let index = 0; index < fields.length;) {
    const record = fields[index++];
    if (!record) {
      continue;
    }
    const firstTab = record.indexOf("\t");
    const secondTab = record.indexOf("\t", firstTab + 1);
    const filePath = record.slice(secondTab + 1);
    const renamed = !filePath;
    if (renamed) {
      index += 1;
    }
    const targetPath = renamed ? fields[index++] : filePath;
    if (!targetPath) {
      continue;
    }
    stats.set(targetPath, {
      added: numericStat(record.slice(0, firstTab)),
      deleted: numericStat(record.slice(firstTab + 1, secondTab))
    });
  }
  return stats;
}

async function sessionChangeFiles(runCommand, context, canonicalCommit, worktreeTree, options = {}) {
  const [statusResult, statResult] = await Promise.all([
    git(runCommand, context, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      "-M",
      "--name-status",
      "-z",
      canonicalCommit,
      worktreeTree
    ], options),
    git(runCommand, context, [
      "diff-tree",
      "--no-commit-id",
      "-r",
      "-M",
      "--numstat",
      "-z",
      canonicalCommit,
      worktreeTree
    ], options)
  ]);
  const files = parseGitNameStatusZ(statusResult.stdout || statusResult.output);
  const stats = parseGitNumstatZ(statResult.stdout || statResult.output);
  return [...files.values()]
    .map((file) => ({
      ...file,
      ...(stats.get(file.path) || { added: 0, deleted: 0 })
    }))
    .sort((left, right) => left.path.localeCompare(right.path));
}

function safeChangePath(value = "") {
  const filePath = String(value || "");
  if (
    !filePath ||
    filePath.includes("\0") ||
    path.posix.isAbsolute(filePath) ||
    path.posix.normalize(filePath) !== filePath ||
    filePath === ".." ||
    filePath.startsWith("../")
  ) {
    throw saveError("Choose a changed project file.", "vibe64_session_change_path_invalid");
  }
  return filePath;
}

function exactFileDiffPathspecs(filePath) {
  // Literal pathspecs still include descendants; exclude those, not the entry itself.
  const escapedPath = filePath.replace(/[*?[\]\\]/gu, "\\$&");
  return [`:(literal)${filePath}`, `:(glob,exclude)${escapedPath}/**`];
}

async function sessionChangeDiff(runCommand, context, work, requestedPath, {
  commandOptions = {},
  lineLimit = DEFAULT_CHANGE_DIFF_LINE_LIMIT,
  project = {}
} = {}) {
  const filePath = safeChangePath(requestedPath);
  if (!work.changedPaths.includes(filePath)) {
    throw saveError("That file is not part of the current saved-work difference.", "vibe64_session_change_not_found");
  }
  const result = await git(runCommand, context, [
    "--no-literal-pathspecs",
    "diff",
    "--no-ext-diff",
    "--find-renames",
    "--unified=3",
    work.changeBaseCommit,
    work.worktreeTree,
    "--",
    ...exactFileDiffPathspecs(filePath)
  ], {
    commandOptions,
    project
  });
  const lines = String(result.stdout || result.output || "").replaceAll("\r\n", "\n").split("\n");
  const boundedLimit = boundedInteger(lineLimit, DEFAULT_CHANGE_DIFF_LINE_LIMIT, MAX_CHANGE_DIFF_LINE_LIMIT);
  return {
    canonicalCommit: work.canonicalCommit,
    changeBaseCommit: work.changeBaseCommit,
    diff: lines.slice(0, boundedLimit).join("\n"),
    lineLimit: boundedLimit,
    ok: true,
    path: filePath,
    shownLines: Math.min(lines.length, boundedLimit),
    totalLines: lines.length,
    truncated: lines.length > boundedLimit,
    worktreeTree: work.worktreeTree
  };
}

async function inspectSessionChangesDirect({
  commandOptions = {},
  derivedArtifactPaths = [],
  includeInitialDiff = true,
  limit = DEFAULT_CHANGE_FILE_LIMIT,
  offset = 0,
  project = {},
  runCommand = runVibe64Command,
  session = {},
  worktreeTree = ""
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Inspecting session changes"
  });
  const work = await inspectSessionWorkDirect({
    commandOptions,
    derivedArtifactPaths,
    project,
    runCommand,
    session,
    worktreeTree
  });
  const changedPathSet = new Set(work.changedPaths);
  const files = work.unsaved
    ? await sessionChangeFiles(runCommand, context, work.changeBaseCommit, work.worktreeTree, {
        commandOptions,
        project
      }).then((items) => items.filter((item) => changedPathSet.has(item.path)))
    : [];
  const boundedLimit = boundedInteger(limit, DEFAULT_CHANGE_FILE_LIMIT, MAX_CHANGE_FILE_LIMIT);
  const boundedOffset = Math.max(0, Number.parseInt(String(offset ?? ""), 10) || 0);
  const pageFiles = files.slice(boundedOffset, boundedOffset + boundedLimit);
  const initialDiff = includeInitialDiff && boundedOffset === 0 && pageFiles.length > 0
    ? await sessionChangeDiff(runCommand, context, work, pageFiles[0].path, {
        commandOptions,
        project
      })
    : null;
  return {
    ...work,
    files: pageFiles,
    initialDiff,
    limit: boundedLimit,
    offset: boundedOffset,
    totalCount: files.length,
    truncated: boundedOffset + boundedLimit < files.length
  };
}

async function inspectSessionChangeDiffDirect({
  commandOptions = {},
  derivedArtifactPaths = [],
  lineLimit = DEFAULT_CHANGE_DIFF_LINE_LIMIT,
  path: requestedPath = "",
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const filePath = safeChangePath(requestedPath);
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Inspecting a session change"
  });
  const work = await inspectSessionWorkDirect({
    commandOptions,
    derivedArtifactPaths,
    project,
    runCommand,
    session
  });
  return sessionChangeDiff(runCommand, context, work, filePath, {
    commandOptions,
    lineLimit,
    project
  });
}

async function inspectSessionWorkDirect({
  commandOptions = {},
  derivedArtifactPaths = [],
  project = {},
  runCommand = runVibe64Command,
  session = {},
  worktreeTree = ""
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Inspecting session work"
  });
  const tree = text(worktreeTree) || await writeGitWorktreeTree({
    baseCommit: "HEAD",
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
  const [canonicalCommit, sessionHead, worktreePorcelain, worktreeTopLevel] = await Promise.all([
    observedCanonicalCommit(runCommand, context, { commandOptions, project }),
    gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      "HEAD^{commit}"
    ], {
      commandOptions,
      project
    }),
    gitOutput(runCommand, context, [
      "status",
      "--porcelain=v1",
      "--untracked-files=all",
      "--ignore-submodules=none",
      "-z"
    ], {
      commandOptions,
      project
    }),
    gitOutput(runCommand, context, [
      "rev-parse",
      "--show-toplevel"
    ], {
      commandOptions,
      project
    })
  ]);
  const [headTree, ahead, behind, comparison] = await Promise.all([
    gitOutput(runCommand, context, [
      "rev-parse",
      `${sessionHead}^{tree}`
    ], {
      commandOptions,
      project
    }),
    countCommitsBetween(runCommand, context, canonicalCommit, sessionHead, {
      commandOptions,
      project
    }),
    countCommitsBetween(runCommand, context, sessionHead, canonicalCommit, {
      commandOptions,
      project
    }),
    sessionWorkComparison(runCommand, context, {
      baseCommit: context.baseCommit,
      canonicalCommit,
      sessionHead,
      worktreeTree: tree
    }, { commandOptions, project })
  ]);
  const derivedPathSet = new Set((Array.isArray(derivedArtifactPaths) ? derivedArtifactPaths : [])
    .map(text)
    .filter(Boolean));
  const changedPaths = comparison.changedPaths.filter((filePath) => !derivedPathSet.has(filePath));
  const relationship = repositoryUpdateRelationship(ahead, behind);
  const worktreeClean = worktreePorcelain.length === 0;
  return {
    ahead,
    baseCommit: context.baseCommit,
    behind,
    branch: context.branch,
    canonicalCommit,
    canonicalTree: comparison.canonicalTree,
    changeBaseCommit: comparison.changeBaseCommit,
    changeBaseTree: comparison.changeBaseTree,
    changedPaths,
    dirty: tree !== headTree || !worktreeClean,
    mode: context.mode,
    ok: true,
    repositoryMode: context.mode,
    relationship,
    sessionMatchesCanonical: changedPaths.length === 0,
    sessionHead,
    sessionId: context.sessionId,
    tree,
    updateAvailable: behind > 0,
    updateStrategy: repositoryUpdateStrategy(relationship),
    unsaved: changedPaths.length > 0,
    worktreeClean,
    worktreeTree: tree,
    worktreeTopLevel,
    worktreePath: context.worktreePath
  };
}

async function inspectSessionWork({
  commandOptions = {},
  derivedArtifactPaths = [],
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: { derivedArtifactPaths },
    label: "Inspecting session work",
    operation: "work",
    project,
    runCommand
  });
}

async function inspectSessionChanges({
  commandOptions = {},
  derivedArtifactPaths = [],
  limit = DEFAULT_CHANGE_FILE_LIMIT,
  offset = 0,
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: { derivedArtifactPaths, limit, offset },
    label: "Inspecting session changes",
    operation: "changes",
    project,
    runCommand
  });
}

async function inspectSessionChangeDiff({
  commandOptions = {},
  derivedArtifactPaths = [],
  lineLimit = DEFAULT_CHANGE_DIFF_LINE_LIMIT,
  path: requestedPath = "",
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: {
      derivedArtifactPaths,
      lineLimit,
      path: safeChangePath(requestedPath)
    },
    label: "Inspecting a session change",
    operation: "change-diff",
    project,
    runCommand
  });
}

async function assertBranch(runCommand, context, options) {
  await git(runCommand, context, ["check-ref-format", "--branch", context.branch], options);
}

function saveRef(context, operationId, label) {
  const digest = crypto.createHash("sha256")
    .update(`${context.sessionId}\0${operationId}`)
    .digest("hex")
    .slice(0, 32);
  return `refs/vibe64/save/${digest}/${label}`;
}

function preparedSaveRef(context, operationId) {
  return saveRef(context, operationId, "prepared");
}

function saveCheckpointRef(context, operationId) {
  return checkpointRefs({
    outerTurnId: `save:${operationId}`,
    sessionId: context.sessionId
  }).turnRef;
}

function canonicalRef(context) {
  const digest = crypto.createHash("sha256")
    .update(context.branch)
    .digest("hex")
    .slice(0, 32);
  return `refs/vibe64/canonical/${digest}`;
}

async function deleteOperationRef(runCommand, context, ref, options = {}) {
  if (!text(ref)) {
    return;
  }
  await git(runCommand, context, ["update-ref", "-d", ref], {
    ...options,
    required: false
  });
}

async function rememberPreparedSaveCommit(runCommand, context, operationId, commit, options = {}) {
  const ref = preparedSaveRef(context, operationId);
  await git(runCommand, context, ["update-ref", ref, commit], options);
  return ref;
}

async function rememberCanonicalCommit(runCommand, context, commit, options = {}) {
  const verified = await gitOutput(runCommand, context, [
    "rev-parse",
    "--verify",
    `${commit}^{commit}`
  ], options);
  await git(runCommand, context, [
    "update-ref",
    canonicalRef(context),
    verified
  ], options);
  return verified;
}

async function readRemoteCanonical(runCommand, context, operationId, options) {
  await git(runCommand, context, ["remote", "set-url", "origin", context.remoteUrl], options);
  const operationRef = saveRef(context, operationId, "canonical");
  try {
    await git(runCommand, context, [
      "fetch",
      "--no-tags",
      "origin",
      `+refs/heads/${context.branch}:${operationRef}`
    ], options);
    const commit = await gitOutput(runCommand, context, ["rev-parse", "--verify", operationRef], options);
    return rememberCanonicalCommit(runCommand, context, commit, options);
  } finally {
    await deleteOperationRef(runCommand, context, operationRef, options);
  }
}

async function assertLocalAuthority(runCommand, context, options) {
  const branch = await gitOutput(runCommand, context, ["branch", "--show-current"], {
    ...options,
    cwd: context.standaloneSourceRoot
  });
  if (branch !== context.branch) {
    throw saveError(
      `The project baseline must have ${context.branch} checked out before Save.`,
      "vibe64_session_save_local_branch_mismatch"
    );
  }
  const status = await gitOutput(runCommand, context, ["status", "--porcelain", "--untracked-files=all"], {
    ...options,
    cwd: context.standaloneSourceRoot
  });
  if (status) {
    throw saveError(
      "The local project baseline has unsaved work. Save cannot overwrite it.",
      "vibe64_session_save_local_authority_dirty"
    );
  }
  for (const marker of ["MERGE_HEAD", "CHERRY_PICK_HEAD", "REVERT_HEAD", "REBASE_HEAD"]) {
    const markerResult = await git(runCommand, context, ["rev-parse", "--verify", "-q", marker], {
      ...options,
      cwd: context.standaloneSourceRoot,
      required: false
    });
    if (markerResult?.ok === true) {
      throw saveError(
        "The local project baseline has an unfinished Git operation.",
        "vibe64_session_save_local_operation_in_progress"
      );
    }
  }
  return gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD"], {
    ...options,
    cwd: context.standaloneSourceRoot
  });
}

async function readCanonical(runCommand, context, operationId, options) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    return readRemoteCanonical(runCommand, context, operationId, options);
  }
  const authorityCommit = await assertLocalAuthority(runCommand, context, options);
  const operationRef = saveRef(context, operationId, "canonical");
  try {
    await git(runCommand, context, [
      "fetch",
      "--no-tags",
      context.standaloneSourceRoot,
      `+refs/heads/${context.branch}:${operationRef}`
    ], options);
    const importedCommit = await gitOutput(runCommand, context, [
      "rev-parse",
      "--verify",
      operationRef
    ], options);
    if (importedCommit !== authorityCommit) {
      throw saveError(
        "The local project baseline changed while Vibe64 was reading it.",
        "vibe64_session_save_authority_advanced"
      );
    }
    return rememberCanonicalCommit(runCommand, context, importedCommit, options);
  } finally {
    await deleteOperationRef(runCommand, context, operationRef, options);
  }
}

async function mergeTrees(runCommand, context, {
  baseCommit,
  canonicalCommit,
  checkpointTree,
  commandOptions,
  identity,
  project,
  virtualCommit = ""
}) {
  const mergeInputCommit = virtualCommit || await createVirtualCommit(runCommand, context, {
    baseCommit,
    commandOptions,
    identity,
    message: "Vibe64 session rebase input",
    project,
    tree: checkpointTree
  });
  const merged = await git(runCommand, context, [
    "merge-tree",
    "--write-tree",
    "--messages",
    "--name-only",
    "-z",
    canonicalCommit,
    mergeInputCommit
  ], {
    commandOptions,
    project,
    required: false
  });
  const tokens = String(merged?.stdout || merged?.output || "").split("\0");
  const mergedTree = text(tokens.shift());
  if (!/^[0-9a-f]{40,64}$/u.test(mergedTree)) {
    throw saveError(
      merged?.ok === true
        ? "Git did not produce a valid rebased tree."
        : "Vibe64 could not prepare the conflicting files for review.",
      "vibe64_session_update_merge_invalid"
    );
  }
  if (merged?.ok !== true) {
    const conflictPaths = [];
    while (tokens.length > 0) {
      const value = tokens.shift();
      if (!value) {
        break;
      }
      conflictPaths.push(value);
    }
    if (!conflictPaths.length) {
      throw saveError(
        "Vibe64 could not identify which files conflict with the latest saved version.",
        "vibe64_session_update_merge_invalid"
      );
    }
    return {
      conflictPaths: [...new Set(conflictPaths)].sort((left, right) => left.localeCompare(right)),
      conflictTree: mergedTree,
      mergedTree: "",
      virtualCommit: mergeInputCommit
    };
  }
  return {
    conflictPaths: [],
    conflictTree: "",
    mergedTree,
    virtualCommit: mergeInputCommit
  };
}

function normalizedConflictRecovery(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const conflictPaths = Array.isArray(value.conflictPaths)
    ? [...new Set(value.conflictPaths.map(String).filter(Boolean))]
      .sort((left, right) => left.localeCompare(right))
    : [];
  const recovery = {
    baseCommit: text(value.baseCommit),
    canonicalCommit: text(value.canonicalCommit),
    checkpointTree: text(value.checkpointTree),
    conflictPaths,
    conflictTree: text(value.conflictTree),
    oldHead: text(value.oldHead),
    oldIndexTree: text(value.oldIndexTree)
  };
  return Object.values(recovery).some((entry) => Array.isArray(entry) ? entry.length === 0 : !entry)
    ? null
    : recovery;
}

function samePaths(left = [], right = []) {
  return left.length === right.length && left.every((entry, index) => entry === right[index]);
}

function conflictMessage(conflictPaths = [], reason = "") {
  const count = conflictPaths.length;
  const files = conflictPaths.slice(0, 3).join(", ");
  const suffix = count > 3 ? ` and ${count - 3} more` : "";
  if (reason === "unchanged") {
    return `The ${count === 1 ? "conflicting file has" : "conflicting files have"} not changed since the failed update. Review ${count === 1 ? "it" : "them"} with Temporary AI, then retry Update this session (rebase).`;
  }
  if (reason === "outside") {
    return "Files outside the original conflict changed after the failed update. Review the update again before retrying.";
  }
  return `${count} ${count === 1 ? "file needs" : "files need"} review before this session can update: ${files}${suffix}. Open Temporary AI, resolve the listed ${count === 1 ? "file" : "files"}, then retry Update this session (rebase).`;
}

function conflictRecoveryError(recovery, reason = "") {
  return saveError(
    conflictMessage(recovery.conflictPaths, reason),
    "vibe64_session_update_conflict",
    {
      conflictPaths: recovery.conflictPaths,
      conflictRecovery: recovery
    }
  );
}

async function resolvedConflictTree(runCommand, context, {
  checkpointTree,
  commandOptions,
  currentRecovery,
  previousRecovery,
  project
}) {
  const previous = normalizedConflictRecovery(previousRecovery);
  if (!previous) {
    throw conflictRecoveryError(currentRecovery);
  }
  const stable = [
    "baseCommit",
    "canonicalCommit",
    "oldHead",
    "oldIndexTree"
  ].every((key) => previous[key] === currentRecovery[key]) &&
    samePaths(previous.conflictPaths, currentRecovery.conflictPaths);
  if (!stable) {
    throw conflictRecoveryError(currentRecovery);
  }
  const changedAfterFailure = await changedPathsBetween(
    runCommand,
    context,
    previous.checkpointTree,
    checkpointTree,
    { commandOptions, project }
  );
  if (!changedAfterFailure.length) {
    throw conflictRecoveryError(currentRecovery, "unchanged");
  }
  const conflictPathSet = new Set(currentRecovery.conflictPaths);
  if (changedAfterFailure.some((entry) => !conflictPathSet.has(entry))) {
    throw conflictRecoveryError(currentRecovery, "outside");
  }
  return writeGitWorktreeTree({
    baseCommit: currentRecovery.conflictTree,
    paths: currentRecovery.conflictPaths,
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
}

async function createVirtualCommit(runCommand, context, {
  baseCommit,
  commandOptions,
  identity,
  message,
  project,
  tree
}) {
  return gitOutput(runCommand, context, [
    "-c", `user.name=${identity.name}`,
    "-c", `user.email=${identity.email}`,
    "commit-tree",
    tree,
    "-p",
    baseCommit
  ], {
    commandOptions,
    input: `${text(message) || "Vibe64 virtual commit"}\n`,
    project
  });
}

async function treeWithDerivedArtifactsFromCommit(runCommand, context, {
  commandOptions,
  derivedArtifactPaths = [],
  project,
  sourceCommit,
  tree
}) {
  const paths = normalizedDerivedArtifactPaths(derivedArtifactPaths);
  if (!paths.length) {
    return tree;
  }
  const temporaryRoot = await mkdtemp(path.join(path.dirname(context.worktreePath), ".vibe64-derived-index-"));
  const indexFile = path.join(temporaryRoot, "index");
  const env = { GIT_INDEX_FILE: indexFile };
  const options = {
    additionalAllowedRoots: [temporaryRoot],
    commandOptions,
    env,
    project
  };
  try {
    await git(runCommand, context, ["read-tree", tree], options);
    for (const filePath of paths) {
      const result = await git(runCommand, context, [
        "ls-tree",
        "-z",
        sourceCommit,
        "--",
        filePath
      ], {
        commandOptions,
        project
      });
      const match = /^(\d+)\s+\S+\s+([0-9a-f]{40,64})\t([^\0]+)\0$/u.exec(String(result.stdout || ""));
      if (match && match[3] === filePath) {
        await git(runCommand, context, [
          "update-index",
          "--add",
          "--cacheinfo",
          match[1],
          match[2],
          filePath
        ], options);
      } else {
        await git(runCommand, context, [
          "update-index",
          "--force-remove",
          "--",
          filePath
        ], {
          ...options,
          required: false
        });
      }
    }
    return await gitOutput(runCommand, context, ["write-tree"], options);
  } finally {
    await rm(temporaryRoot, { force: true, recursive: true });
  }
}

async function regenerateDerivedArtifactTree(runCommand, context, {
  baseCommit,
  commandOptions,
  derivedArtifactPaths = [],
  identity,
  project,
  refreshDerivedArtifacts,
  tree
}) {
  const paths = normalizedDerivedArtifactPaths(derivedArtifactPaths);
  if (!paths.length) {
    return tree;
  }
  if (typeof refreshDerivedArtifacts !== "function") {
    throw saveError(
      "The project declares generated artifacts but their owning tool is unavailable.",
      "vibe64_session_derived_artifact_refresh_unavailable"
    );
  }
  const sourceCommit = await createVirtualCommit(runCommand, context, {
    baseCommit,
    commandOptions,
    identity,
    message: "Vibe64 derived artifact input",
    project,
    tree
  });
  const temporaryRoot = await mkdtemp(path.join(path.dirname(context.worktreePath), ".vibe64-derived-worktree-"));
  const temporaryWorktree = path.join(temporaryRoot, "source");
  const options = {
    additionalAllowedRoots: [temporaryRoot, temporaryWorktree],
    commandOptions,
    project
  };
  let registered = false;
  try {
    await git(runCommand, context, [
      "worktree",
      "add",
      "--detach",
      temporaryWorktree,
      sourceCommit
    ], options);
    registered = true;
    await refreshDerivedArtifacts({ projectRoot: temporaryWorktree });
    return await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: temporaryWorktree
    });
  } finally {
    if (registered) {
      await git(runCommand, context, [
        "worktree",
        "remove",
        "--force",
        temporaryWorktree
      ], {
        ...options,
        required: false
      });
    }
    await rm(temporaryRoot, { force: true, recursive: true });
    await git(runCommand, context, ["worktree", "prune"], {
      commandOptions,
      project,
      required: false
    });
  }
}

async function createSaveCommit(runCommand, context, {
  canonicalCommit,
  commandOptions,
  identity,
  mergedTree,
  message,
  project
}) {
  const subject = text(message);
  if (!subject) {
    throw saveError(
      "Save requires an assistant-generated commit subject.",
      "vibe64_session_save_message_required"
    );
  }
  return gitOutput(runCommand, context, [
    "-c", `user.name=${identity.name}`,
    "-c", `user.email=${identity.email}`,
    "commit-tree",
    mergedTree,
    "-p",
    canonicalCommit
  ], {
    commandOptions,
    input: `${subject}\n`,
    project
  });
}

async function publishSaveCommit(runCommand, context, saveCommit, canonicalCommit, options) {
  if (context.mode === PROJECT_REPOSITORY_MODE_LOCAL_SOURCE) {
    const current = await assertLocalAuthority(runCommand, context, options);
    if (current !== canonicalCommit) {
      throw saveError(
        "The local project baseline advanced during Save.",
        "vibe64_session_save_authority_advanced"
      );
    }
    await git(runCommand, context, ["fetch", context.worktreePath, saveCommit], {
      ...options,
      cwd: context.standaloneSourceRoot
    });
    await git(runCommand, context, ["merge", "--ff-only", saveCommit], {
      ...options,
      cwd: context.standaloneSourceRoot
    });
    const verified = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      ...options,
      cwd: context.standaloneSourceRoot
    });
    await rememberCanonicalCommit(runCommand, context, verified, options);
    return verified;
  }
  const pushArgs = ["push"];
  if (context.mode === PROJECT_REPOSITORY_MODE_MANAGED_GIT) {
    pushArgs.push("--push-option=vibe64-atomic");
  }
  pushArgs.push("origin", `${saveCommit}:refs/heads/${context.branch}`);
  const pushed = await git(runCommand, context, pushArgs, {
    ...options,
    required: false
  });
  if (pushed?.ok !== true) {
    const remote = await git(runCommand, context, [
      "ls-remote",
      "--heads",
      "origin",
      `refs/heads/${context.branch}`
    ], {
      ...options,
      required: false
    });
    const remoteCommit = output(remote).split(/\s+/u)[0] || "";
    if (remoteCommit && remoteCommit !== canonicalCommit) {
      throw saveError(
        "The saved project changed while Save was publishing. Update this session (rebase), then save again.",
        "vibe64_session_save_update_required",
        {
          canonicalCommit: remoteCommit,
          reconciledCommit: canonicalCommit,
          updateRequired: true
        }
      );
    }
    throw saveError(
      text(pushed?.stderr || pushed?.stdout || pushed?.output || pushed?.error) || "Git Save publication failed.",
      text(pushed?.code) || "vibe64_session_save_git_failed"
    );
  }
  const remote = await gitOutput(runCommand, context, [
    "ls-remote",
    "--heads",
    "origin",
    `refs/heads/${context.branch}`
  ], options);
  const verified = remote.split(/\s+/u)[0] || "";
  if (verified !== saveCommit) {
    throw saveError(
      "Canonical repository verification did not return the commit Vibe64 published.",
      "vibe64_session_save_verification_failed"
    );
  }
  await rememberCanonicalCommit(runCommand, context, verified, options);
  return verified;
}

async function refreshVerifiedGithubMirror(
  runCommand,
  context,
  verifiedCommit,
  { commandOptions = {}, project = {} } = {}
) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return {
      attempted: false,
      kind: "none",
      retryable: false,
      status: "not_applicable"
    };
  }
  const mirrorPath = text(project.githubMirrorPath);
  const retryable = (code, reason) => ({
    attempted: Boolean(mirrorPath),
    branch: context.branch,
    code,
    kind: "github_mirror",
    message: "Your work was saved, but Vibe64 could not refresh its local clone cache. A later session or Save will retry it.",
    reason,
    retryable: true,
    status: "retryable",
    verifiedCommit
  });
  if (!mirrorPath || !path.isAbsolute(mirrorPath)) {
    return retryable(
      "vibe64_session_save_github_mirror_missing",
      "configuration_missing"
    );
  }

  try {
    const [command, ...args] = githubMirrorRefreshInvocation({
      mirrorPath,
      remoteUrl: context.remoteUrl
    });
    const refresh = await saveCommand(runCommand, context, command, args, {
      additionalAllowedRoots: [mirrorPath],
      commandOptions,
      project
    });
    if (refresh?.ok !== true) {
      return retryable(
        text(refresh?.code) || "vibe64_session_save_github_mirror_refresh_failed",
        "refresh_failed"
      );
    }
    const localOptions = {
      additionalAllowedRoots: [mirrorPath],
      commandOptions,
      project,
      required: false
    };
    const [mirrorCommitResult, mirrorOriginResult] = await Promise.all([
      git(runCommand, context, [
        "--git-dir", mirrorPath,
        "rev-parse", "--verify", `refs/heads/${context.branch}^{commit}`
      ], localOptions),
      git(runCommand, context, [
        "--git-dir", mirrorPath,
        "remote", "get-url", "origin"
      ], localOptions)
    ]);
    const mirrorCommit = mirrorCommitResult?.ok === true ? output(mirrorCommitResult) : "";
    const mirrorOrigin = mirrorOriginResult?.ok === true ? output(mirrorOriginResult) : "";
    if (mirrorCommit !== verifiedCommit || mirrorOrigin !== context.remoteUrl) {
      return {
        ...retryable(
          "vibe64_session_save_github_mirror_verification_failed",
          "verification_failed"
        ),
        mirrorCommit
      };
    }
    return {
      attempted: true,
      branch: context.branch,
      kind: "github_mirror",
      mirrorCommit,
      retryable: false,
      status: "current",
      verifiedCommit
    };
  } catch {
    return retryable(
      "vibe64_session_save_github_mirror_refresh_failed",
      "refresh_interrupted"
    );
  }
}

async function currentCanonicalCommit(runCommand, context, operationId, options) {
  return readCanonical(runCommand, context, operationId, options);
}

async function checkSessionUpdatesDirect({
  commandOptions = {},
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Checking repository for updates",
    operationId
  });
  await assertBranch(runCommand, context, { commandOptions, project });
  const canonicalCommit = await currentCanonicalCommit(
    runCommand,
    context,
    operationId,
    { commandOptions, project }
  );
  const [sessionHead, worktreeTree] = await Promise.all([
    gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
      commandOptions,
      project
    }),
    writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    })
  ]);
  const ancestor = await git(runCommand, context, [
    "merge-base",
    "--is-ancestor",
    context.baseCommit,
    canonicalCommit
  ], {
    commandOptions,
    project,
    required: false
  });
  if (ancestor?.ok !== true) {
    throw saveError(
      "The saved project history no longer descends from this session's starting version.",
      "vibe64_session_update_history_diverged"
    );
  }
  const [ahead, behind, canonicalInSession, canonicalTree] = await Promise.all([
    countCommitsBetween(runCommand, context, canonicalCommit, sessionHead, {
      commandOptions,
      project
    }),
    countCommitsBetween(runCommand, context, sessionHead, canonicalCommit, {
      commandOptions,
      project
    }),
    commitIsAncestor(runCommand, context, canonicalCommit, sessionHead, {
      commandOptions,
      project
    }),
    commitTree(runCommand, context, canonicalCommit, { commandOptions, project })
  ]);
  const relationship = repositoryUpdateRelationship(ahead, behind);
  const incoming = behind > 0
    ? await incomingVersionsBetween(runCommand, context, sessionHead, canonicalCommit, {
        commandOptions,
        project
      })
    : { incomingVersions: [], incomingVersionsTruncated: false };
  return {
    ahead,
    baseCommit: context.baseCommit,
    behind,
    canonicalCommit,
    ...incoming,
    ok: true,
    operationId,
    reconciled: canonicalInSession,
    repositoryMode: context.mode,
    relationship,
    sessionCurrent: canonicalInSession,
    sessionHead,
    sessionMatchesCanonical: worktreeTree === canonicalTree,
    updateAvailable: !canonicalInSession,
    updateStrategy: repositoryUpdateStrategy(relationship)
  };
}

async function checkSessionUpdates({
  commandOptions = {},
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runProjectSourceExclusive(() => runSessionWorkOperation({
    commandOptions,
    context,
    label: "Checking repository for updates",
    operation: "check-updates",
    operationId,
    project,
    runCommand
  }), {
    operation: `check-session-updates:${context.sessionId}`
  });
}

async function applySessionUpdate(runCommand, context, {
  canonicalCommit,
  checkpointCommit,
  checkpointTree,
  commandOptions,
  mergedCommit,
  mergedTree,
  oldHead,
  oldIndexTree,
  project
}) {
  const currentTree = await writeGitWorktreeTree({
    baseCommit: "HEAD",
    project: commandProject(context, project),
    runCommand,
    worktreePath: context.worktreePath
  });
  if (currentTree !== checkpointTree) {
    throw saveError(
      "This session changed while its update was being prepared. Retry when the assistant is idle.",
      "vibe64_session_update_worktree_changed"
    );
  }
  try {
    await git(runCommand, context, ["read-tree", "--reset", "-u", mergedCommit], {
      commandOptions,
      project
    });
    await git(runCommand, context, ["update-ref", "HEAD", canonicalCommit, oldHead], {
      commandOptions,
      project
    });
    await git(runCommand, context, ["read-tree", canonicalCommit], {
      commandOptions,
      project
    });
    const updatedTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    if (updatedTree !== mergedTree) {
      throw saveError(
        "The updated session did not match the prepared merged work.",
        "vibe64_session_update_verification_failed"
      );
    }
    await rememberCanonicalCommit(runCommand, context, canonicalCommit, {
      commandOptions,
      project
    });
    return { currentTree: updatedTree, reconciled: true, status: "updated" };
  } catch (error) {
    const currentHead = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    }).catch(() => "");
    await git(runCommand, context, ["read-tree", "--reset", "-u", checkpointCommit], {
      commandOptions,
      project,
      required: false
    });
    if (currentHead && currentHead !== oldHead) {
      await git(runCommand, context, ["update-ref", "HEAD", oldHead, currentHead], {
        commandOptions,
        project,
        required: false
      });
    }
    await git(runCommand, context, ["read-tree", oldIndexTree], {
      commandOptions,
      project,
      required: false
    });
    throw error;
  }
}

async function updateSessionWork({
  beforeSourceChange = async () => {},
  commandOptions = {},
  conflictRecovery = null,
  derivedArtifactPaths = [],
  identity = {},
  onProgress = async () => null,
  operationId = crypto.randomUUID(),
  project = {},
  refreshDerivedArtifacts = null,
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Updating session from repository",
    operationId
  });
  const author = {
    email: text(identity.email) || "vibe64@localhost",
    name: text(identity.name) || "Vibe64 Update"
  };
  return runProjectSourceExclusive(async () => {
    await assertBranch(runCommand, context, { commandOptions, project });
    await onProgress({ kind: "checkpoint", message: "Capturing this session's complete worktree.", stage: "checkpointing" });
    const checkpoint = await createGitTurnCheckpoint({
      outerTurnId: `update:${operationId}`,
      outcome: "completed",
      project: commandProject(context, project),
      runCommand,
      sessionId: context.sessionId,
      timestamp: new Date().toISOString(),
      worktreePath: context.worktreePath
    });
    const [oldHead, oldIndexTree] = await Promise.all([
      gitOutput(runCommand, context, ["rev-parse", "HEAD"], { commandOptions, project }),
      gitOutput(runCommand, context, ["write-tree"], { commandOptions, project })
    ]);
    await onProgress({
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      kind: "checkpoint",
      message: "Session checkpoint captured.",
      oldHead,
      oldIndexTree,
      stage: "checkpointed"
    });
    const canonicalCommit = await currentCanonicalCommit(
      runCommand,
      context,
      operationId,
      { commandOptions, project }
    );
    const ancestor = await git(runCommand, context, [
      "merge-base",
      "--is-ancestor",
      context.baseCommit,
      canonicalCommit
    ], {
      commandOptions,
      project,
      required: false
    });
    if (ancestor?.ok !== true) {
      throw saveError(
        "The saved project history no longer descends from this session's starting version.",
        "vibe64_session_update_history_diverged"
      );
    }
    const comparison = await sessionWorkComparison(runCommand, context, {
      baseCommit: context.baseCommit,
      canonicalCommit,
      sessionHead: oldHead,
      worktreeTree: checkpoint.tree
    }, { commandOptions, project });
    const derivedPathSet = new Set(normalizedDerivedArtifactPaths(derivedArtifactPaths));
    const authoredChangedPaths = comparison.changedPaths
      .filter((filePath) => !derivedPathSet.has(filePath));
    const canonicalInSession = await commitIsAncestor(
      runCommand,
      context,
      canonicalCommit,
      oldHead,
      { commandOptions, project }
    );
    if (canonicalInSession) {
      return {
        baseCommit: context.baseCommit,
        canonicalCommit,
        canonicalTree: comparison.canonicalTree,
        changeBaseCommit: comparison.changeBaseCommit,
        checkpointCommit: checkpoint.commit,
        checkpointTree: checkpoint.tree,
        currentTree: checkpoint.tree,
        ok: true,
        operationId,
        mode: context.mode,
        reconciled: true,
        repositoryMode: context.mode,
        sessionCurrent: canonicalInSession,
        sessionMatchesCanonical: comparison.sessionMatchesCanonical,
        status: "already_current"
      };
    }
    if (!authoredChangedPaths.length) {
      const mergedTree = await regenerateDerivedArtifactTree(runCommand, context, {
        baseCommit: canonicalCommit,
        commandOptions,
        derivedArtifactPaths,
        identity: author,
        project,
        refreshDerivedArtifacts,
        tree: comparison.canonicalTree
      });
      const mergedCommit = mergedTree === comparison.canonicalTree
        ? canonicalCommit
        : await createVirtualCommit(runCommand, context, {
            baseCommit: canonicalCommit,
            commandOptions,
            identity: author,
            message: "Vibe64 regenerated derived artifacts",
            project,
            tree: mergedTree
          });
      await onProgress({
        canonicalCommit,
        checkpointCommit: checkpoint.commit,
        checkpointTree: checkpoint.tree,
        kind: "update",
        mergedCommit,
        mergedTree,
        message: "A conflict-free session update is ready.",
        oldHead,
        oldIndexTree,
        stage: "prepared"
      });
      await onProgress({ kind: "update", message: "Updating this session (rebase).", stage: "mutating" });
      await beforeSourceChange();
      const reconciliation = await applySessionUpdate(runCommand, context, {
        canonicalCommit,
        checkpointCommit: checkpoint.commit,
        checkpointTree: checkpoint.tree,
        commandOptions,
        mergedCommit,
        mergedTree,
        oldHead,
        oldIndexTree,
        project
      });
      return {
        baseCommit: context.baseCommit,
        canonicalCommit,
        canonicalTree: comparison.canonicalTree,
        changeBaseCommit: comparison.changeBaseCommit,
        checkpointCommit: checkpoint.commit,
        checkpointTree: checkpoint.tree,
        mergedCommit,
        mergedTree,
        ok: true,
        oldHead,
        oldIndexTree,
        operationId,
        mode: context.mode,
        repositoryMode: context.mode,
        sessionCurrent: true,
        sessionMatchesCanonical: true,
        ...reconciliation
      };
    }
    const checkpointTreeForMerge = await treeWithDerivedArtifactsFromCommit(runCommand, context, {
      commandOptions,
      derivedArtifactPaths,
      project,
      sourceCommit: canonicalCommit,
      tree: checkpoint.tree
    });
    const mergeResult = await mergeTrees(runCommand, context, {
      baseCommit: comparison.changeBaseCommit,
      canonicalCommit,
      checkpointTree: checkpointTreeForMerge,
      commandOptions,
      identity: author,
      project
    });
    const currentRecovery = mergeResult.conflictPaths.length > 0
      ? {
          baseCommit: comparison.changeBaseCommit,
          canonicalCommit,
          checkpointTree: checkpoint.tree,
          conflictPaths: mergeResult.conflictPaths,
          conflictTree: mergeResult.conflictTree,
          oldHead,
          oldIndexTree
        }
      : null;
    const mergedSourceTree = currentRecovery
      ? await resolvedConflictTree(runCommand, context, {
          checkpointTree: checkpoint.tree,
          commandOptions,
          currentRecovery,
          previousRecovery: conflictRecovery,
          project
      })
      : mergeResult.mergedTree;
    const mergedTree = await regenerateDerivedArtifactTree(runCommand, context, {
      baseCommit: canonicalCommit,
      commandOptions,
      derivedArtifactPaths,
      identity: author,
      project,
      refreshDerivedArtifacts,
      tree: mergedSourceTree
    });
    const mergedCommit = await createVirtualCommit(runCommand, context, {
      baseCommit: canonicalCommit,
      commandOptions,
      identity: author,
      message: "Vibe64 session update result",
      project,
      tree: mergedTree
    });
    await onProgress({
      canonicalCommit,
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      kind: "update",
      mergedCommit,
      mergedTree,
      message: "A conflict-free session update is ready.",
      oldHead,
      oldIndexTree,
      stage: "prepared"
    });
    await onProgress({ kind: "update", message: "Updating this session (rebase).", stage: "mutating" });
    await beforeSourceChange();
    const reconciliation = await applySessionUpdate(runCommand, context, {
      canonicalCommit,
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      commandOptions,
      mergedCommit,
      mergedTree,
      oldHead,
      oldIndexTree,
      project
    });
    return {
      baseCommit: context.baseCommit,
      canonicalCommit,
      changeBaseCommit: comparison.changeBaseCommit,
      checkpointCommit: checkpoint.commit,
      checkpointTree: checkpoint.tree,
      mergedCommit,
      mergedTree,
      ok: true,
      oldHead,
      oldIndexTree,
      operationId,
      mode: context.mode,
      repositoryMode: context.mode,
      ...reconciliation
    };
  }, {
    operation: `update-session:${context.sessionId}`
  });
}

async function recoverSessionWorkUpdate({
  beforeSourceChange = async () => {},
  commandOptions = {},
  project = {},
  recovery = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Recovering session update",
    operationId: text(recovery.operationId) || crypto.randomUUID()
  });
  const required = [
    "canonicalCommit",
    "checkpointCommit",
    "checkpointTree",
    "mergedCommit",
    "mergedTree",
    "oldHead",
    "oldIndexTree"
  ];
  if (required.some((key) => !text(recovery[key]))) {
    throw saveError(
      "The interrupted session update stopped before mutation and can be retried.",
      "vibe64_session_update_interrupted_retryable",
      { retryable: true }
    );
  }
  return runProjectSourceExclusive(async () => {
    const head = await gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    });
    const tree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    const headIsOld = head === recovery.oldHead;
    const headIsCanonical = head === recovery.canonicalCommit;
    const treeIsCheckpoint = tree === recovery.checkpointTree;
    const treeIsMerged = tree === recovery.mergedTree;
    if ((!headIsOld && !headIsCanonical) || (!treeIsCheckpoint && !treeIsMerged)) {
      throw saveError(
        "The interrupted session update cannot be recovered automatically because the worktree changed.",
        "vibe64_session_update_recovery_changed"
      );
    }
    await beforeSourceChange();
    if (treeIsCheckpoint) {
      await git(runCommand, context, ["read-tree", "--reset", "-u", recovery.mergedCommit], {
        commandOptions,
        project
      });
    }
    if (headIsOld) {
      await git(runCommand, context, [
        "update-ref",
        "HEAD",
        recovery.canonicalCommit,
        recovery.oldHead
      ], {
        commandOptions,
        project
      });
    }
    await git(runCommand, context, ["read-tree", recovery.canonicalCommit], {
      commandOptions,
      project
    });
    const recoveredTree = await writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    });
    if (recoveredTree !== recovery.mergedTree) {
      throw saveError(
        "The interrupted session update could not reproduce its prepared worktree.",
        "vibe64_session_update_verification_failed"
      );
    }
    await rememberCanonicalCommit(runCommand, context, recovery.canonicalCommit, {
      commandOptions,
      project
    });
    return {
      ...recovery,
      currentTree: recoveredTree,
      ok: true,
      reconciled: true,
      recovered: true,
      status: "updated"
    };
  }, {
    operation: `recover-update-session:${context.sessionId}`
  });
}

async function reconcileSession(runCommand, context, {
  checkpointCommit,
  checkpointTree,
  commandOptions,
  project,
  saveCommit,
  sessionHead = ""
}) {
  const [currentTree, oldHead, saveTree] = await Promise.all([
    writeGitWorktreeTree({
      baseCommit: "HEAD",
      project: commandProject(context, project),
      runCommand,
      worktreePath: context.worktreePath
    }),
    gitOutput(runCommand, context, ["rev-parse", "HEAD"], {
      commandOptions,
      project
    }),
    commitTree(runCommand, context, saveCommit, {
      commandOptions,
      project
    })
  ]);
  if (oldHead === saveCommit) {
    return {
      currentTree,
      reconciled: true,
      status: "saved"
    };
  }
  if (sessionHead && oldHead !== sessionHead) {
    return {
      currentTree,
      reconciled: false,
      status: "published_needs_reconcile"
    };
  }
  const preserveLaterWork = currentTree !== checkpointTree && currentTree !== saveTree;
  const oldIndexTree = await gitOutput(runCommand, context, ["write-tree"], {
    commandOptions,
    project
  });
  try {
    if (preserveLaterWork) {
      await git(runCommand, context, ["read-tree", checkpointCommit], {
        commandOptions,
        project
      });
      await git(runCommand, context, ["read-tree", "-m", "-u", checkpointCommit, saveCommit], {
        commandOptions,
        project
      });
    } else {
      await git(runCommand, context, ["read-tree", "--reset", "-u", saveCommit], {
        commandOptions,
        project
      });
    }
    await git(runCommand, context, ["update-ref", "HEAD", saveCommit, oldHead], {
      commandOptions,
      project
    });
    return {
      currentTree,
      reconciled: true,
      status: "saved"
    };
  } catch (error) {
    if (!preserveLaterWork) {
      await git(runCommand, context, ["read-tree", "--reset", "-u", checkpointCommit], {
        commandOptions,
        project,
        required: false
      });
    }
    await git(runCommand, context, ["read-tree", oldIndexTree], {
      commandOptions,
      project,
      required: false
    });
    return {
      currentTree,
      error: text(error?.message || error),
      reconciled: false,
      status: "published_needs_reconcile"
    };
  }
}

async function captureSessionWorkSaveCheckpoint(runCommand, context, {
  commandOptions = {},
  operationId,
  project = {}
} = {}) {
  await assertBranch(runCommand, context, { commandOptions, project });
  const checkpoint = await createGitTurnCheckpoint({
    outerTurnId: `save:${operationId}`,
    outcome: "completed",
    project: commandProject(context, project),
    runCommand,
    sessionId: context.sessionId,
    timestamp: new Date().toISOString(),
    worktreePath: context.worktreePath
  });
  const sessionHead = await gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
    commandOptions,
    project
  });
  return {
    baseCommit: context.baseCommit,
    branch: context.branch,
    checkpointCommit: checkpoint.commit,
    checkpointTree: checkpoint.tree,
    mode: context.mode,
    operationId,
    sessionHead
  };
}

async function prepareSessionWorkSaveMessageDirect({
  commandOptions = {},
  derivedArtifactPaths = [],
  limit = 40,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Capturing work for Save",
    operationId
  });
  const checkpoint = await captureSessionWorkSaveCheckpoint(runCommand, context, {
    commandOptions,
    operationId,
    project
  });
  const changes = await inspectSessionChangesDirect({
    commandOptions,
    derivedArtifactPaths,
    includeInitialDiff: false,
    limit,
    project,
    runCommand,
    session,
    worktreeTree: checkpoint.checkpointTree
  });
  if (!changes.totalCount) {
    throw saveError(
      "This session has no work to save.",
      "vibe64_session_save_no_changes"
    );
  }
  return {
    changes,
    checkpoint
  };
}

async function assertSessionWorkSaveCheckpoint(runCommand, context, checkpoint, {
  commandOptions = {},
  operationId,
  project = {}
} = {}) {
  const checkpointCommit = text(checkpoint?.checkpointCommit);
  const checkpointTree = text(checkpoint?.checkpointTree);
  if (
    !checkpointCommit ||
    !checkpointTree ||
    text(checkpoint?.operationId) !== text(operationId) ||
    text(checkpoint?.baseCommit) !== context.baseCommit ||
    text(checkpoint?.branch) !== context.branch ||
    text(checkpoint?.mode) !== context.mode
  ) {
    throw saveError(
      "Save cannot verify the captured worktree. Capture and name the work again.",
      "vibe64_session_save_checkpoint_invalid"
    );
  }
  const recordedTree = await commitTree(runCommand, context, checkpointCommit, {
    commandOptions,
    project
  });
  if (recordedTree !== checkpointTree) {
    throw saveError(
      "Save cannot verify the captured worktree. Capture and name the work again.",
      "vibe64_session_save_checkpoint_invalid"
    );
  }
  const checkpointSessionHead = text(checkpoint?.sessionHead);
  const currentSessionHead = checkpointSessionHead
    ? await gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
        commandOptions,
        project
      })
    : "";
  if (checkpointSessionHead && currentSessionHead !== checkpointSessionHead) {
    throw saveError(
      "The session history changed while Vibe64 was naming this work. Save was not started; try again.",
      "vibe64_session_save_message_stale"
    );
  }
  return checkpoint;
}

async function prepareSessionWorkSave(runCommand, context, {
  checkpoint = {},
  commandOptions = {},
  derivedArtifactPaths = [],
  identity = {},
  message = "",
  operationId,
  project = {},
  refreshDerivedArtifacts = null
} = {}) {
  const checkpointTree = text(checkpoint.checkpointTree);
  const [canonicalCommit, sessionHead] = await Promise.all([
    readCanonical(runCommand, context, operationId, { commandOptions, project }),
    gitOutput(runCommand, context, ["rev-parse", "--verify", "HEAD^{commit}"], {
      commandOptions,
      project
    })
  ]);
  const ancestor = await git(runCommand, context, [
    "merge-base",
    "--is-ancestor",
    context.baseCommit,
    canonicalCommit
  ], {
    commandOptions,
    project,
    required: false
  });
  if (ancestor?.ok !== true) {
    throw saveError(
      "Canonical history no longer descends from this session's saved base.",
      "vibe64_session_save_history_diverged"
    );
  }
  const canonicalInSession = await commitIsAncestor(
    runCommand,
    context,
    canonicalCommit,
    sessionHead,
    { commandOptions, project }
  );
  if (canonicalCommit !== context.baseCommit && !canonicalInSession) {
    throw saveError(
      "The saved project has changed. Update this session (rebase) before saving its work.",
      "vibe64_session_save_update_required",
      {
        canonicalCommit,
        reconciledCommit: context.baseCommit,
        updateRequired: true
      }
    );
  }
  const comparison = await sessionWorkComparison(runCommand, context, {
    baseCommit: context.baseCommit,
    canonicalCommit,
    sessionHead,
    worktreeTree: checkpointTree
  }, { commandOptions, project });
  const derivedPathSet = new Set(normalizedDerivedArtifactPaths(derivedArtifactPaths));
  const changedPaths = comparison.changedPaths.filter((filePath) => !derivedPathSet.has(filePath));
  if (!changedPaths.length) {
    throw saveError(
      "This session has no work to save.",
      "vibe64_session_save_no_changes"
    );
  }
  const author = {
    email: text(identity.email) || "vibe64@localhost",
    name: text(identity.name) || "Vibe64 Save"
  };
  const sourceTree = await treeWithDerivedArtifactsFromCommit(runCommand, context, {
    commandOptions,
    derivedArtifactPaths,
    project,
    sourceCommit: canonicalCommit,
    tree: checkpointTree
  });
  const mergedTree = await regenerateDerivedArtifactTree(runCommand, context, {
    baseCommit: canonicalCommit,
    commandOptions,
    derivedArtifactPaths,
    identity: author,
    project,
    refreshDerivedArtifacts,
    tree: sourceTree
  });
  const saveCommit = await createSaveCommit(runCommand, context, {
    canonicalCommit,
    commandOptions,
    identity: author,
    mergedTree,
    message,
    project
  });
  const preparedRef = await rememberPreparedSaveCommit(
    runCommand,
    context,
    operationId,
    saveCommit,
    { commandOptions, project }
  );
  return {
    canonicalCommit,
    changeBaseCommit: comparison.changeBaseCommit,
    changedPaths,
    mergedTree,
    preparedRef,
    saveCommit
  };
}

async function publishPreparedSessionWorkSave(runCommand, context, {
  commandOptions = {},
  prepared = {},
  project = {}
} = {}) {
  return publishSaveCommit(
    runCommand,
    context,
    text(prepared.saveCommit),
    text(prepared.canonicalCommit),
    { commandOptions, project }
  );
}

function completedSessionWorkSave(context, checkpoint, prepared, verifiedCommit, finalized) {
  return {
    baseCommit: context.baseCommit,
    cacheMaintenance: finalized.cacheMaintenance,
    canonicalCommit: prepared.canonicalCommit,
    changeBaseCommit: prepared.changeBaseCommit,
    changedPaths: prepared.changedPaths,
    checkpointCommit: checkpoint.checkpointCommit,
    checkpointTree: checkpoint.checkpointTree,
    mergedTree: prepared.mergedTree,
    mode: context.mode,
    ok: true,
    operationId: checkpoint.operationId,
    preparedRef: prepared.preparedRef,
    saveCommit: prepared.saveCommit,
    sessionHead: checkpoint.sessionHead,
    status: finalized.status,
    verifiedCommit,
    ...finalized
  };
}

function deferredCacheMaintenance(context, verifiedCommit) {
  if (context.mode !== PROJECT_REPOSITORY_MODE_GITHUB) {
    return {
      attempted: false,
      kind: "none",
      retryable: false,
      status: "not_applicable"
    };
  }
  return {
    attempted: false,
    branch: context.branch,
    kind: "github_mirror",
    retryable: false,
    status: "deferred",
    verifiedCommit
  };
}

function failedCacheMaintenance(context, verifiedCommit, error) {
  return {
    attempted: false,
    branch: context.branch,
    code: text(error?.code) || "vibe64_session_save_github_mirror_refresh_failed",
    kind: "github_mirror",
    message: "Your work was saved, but Vibe64 could not refresh its local clone cache. A later session or Save will retry it.",
    reason: "refresh_interrupted",
    retryable: true,
    status: "retryable",
    verifiedCommit
  };
}

async function refreshSessionWorkSaveCacheDirect({
  commandOptions = {},
  operationId = "",
  project = {},
  runCommand = runVibe64Command,
  session = {},
  verifiedCommit = ""
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Maintaining saved repository cache",
    operationId
  });
  return refreshVerifiedGithubMirror(
    runCommand,
    context,
    text(verifiedCommit),
    { commandOptions, project }
  );
}

async function deletePreparedSaveRef(runCommand, context, operationId, options = {}) {
  if (text(operationId)) {
    await deleteOperationRef(
      runCommand,
      context,
      preparedSaveRef(context, operationId),
      options
    );
  }
}

async function saveSessionWorkDirect({
  checkpoint: suppliedCheckpoint = null,
  commandOptions = {},
  deferCacheMaintenance = false,
  derivedArtifactPaths = [],
  identity = {},
  message = "",
  operationId = crypto.randomUUID(),
  project = {},
  refreshDerivedArtifacts = null,
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  onProgress = async () => null,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Saving session work",
    operationId
  });
  await onProgress({
    kind: "lock",
    message: "Waiting for exclusive repository access.",
    stage: "repository-lock"
  });
  return runProjectSourceExclusive(async () => {
    await onProgress({
      baseCommit: context.baseCommit,
      branch: context.branch,
      kind: "checkpoint",
      message: "Capturing the complete session worktree.",
      mode: context.mode,
      operationId,
      stage: "checkpointing"
    });
    let checkpoint;
    if (suppliedCheckpoint) {
      await assertBranch(runCommand, context, { commandOptions, project });
      checkpoint = await assertSessionWorkSaveCheckpoint(runCommand, context, suppliedCheckpoint, {
        commandOptions,
        operationId,
        project
      });
    } else {
      checkpoint = await captureSessionWorkSaveCheckpoint(runCommand, context, {
        commandOptions,
        operationId,
        project
      });
    }
    await onProgress({
      checkpointCommit: checkpoint.checkpointCommit,
      checkpointTree: checkpoint.checkpointTree,
      kind: "checkpoint",
      message: "Session checkpoint captured.",
      stage: "checkpointed"
    });
    await onProgress({ kind: "canonical", message: "Reading the current canonical branch.", stage: "canonical-reading" });
    const prepared = await prepareSessionWorkSave(runCommand, context, {
      checkpoint,
      commandOptions,
      derivedArtifactPaths,
      identity,
      message,
      operationId,
      project,
      refreshDerivedArtifacts
    });
    await onProgress({
      expectedCanonicalCommit: prepared.canonicalCommit,
      kind: "canonical",
      message: "Canonical branch read.",
      stage: "canonical-read"
    });
    await onProgress({
      expectedCanonicalCommit: prepared.canonicalCommit,
      kind: "publish",
      mergedTree: prepared.mergedTree,
      message: "Save commit prepared.",
      proposedCommit: prepared.saveCommit,
      stage: "prepared"
    });
    await onProgress({ kind: "publish", message: "Publishing one ordinary Save commit.", stage: "publishing" });
    const verifiedCommit = await publishPreparedSessionWorkSave(runCommand, context, {
      commandOptions,
      prepared,
      project
    });
    await onProgress({
      kind: "publish",
      message: "Canonical Save commit verified.",
      stage: "published",
      verifiedCommit
    });
    await onProgress({ kind: "reconcile", message: "Reconciling the session onto the saved commit.", stage: "reconciling" });
    const reconciliation = await reconcileSession(runCommand, context, {
      checkpointCommit: checkpoint.checkpointCommit,
      checkpointTree: checkpoint.checkpointTree,
      commandOptions,
      project,
      saveCommit: prepared.saveCommit,
      sessionHead: checkpoint.sessionHead
    });
    const cacheMaintenance = deferCacheMaintenance
      ? deferredCacheMaintenance(context, verifiedCommit)
      : await refreshSessionWorkSaveCacheDirect({
          commandOptions,
          operationId,
          project,
          runCommand,
          session,
          verifiedCommit
        });
    if (cacheMaintenance.retryable === true) {
      await onProgress({
        cacheMaintenance,
        kind: "cache-warning",
        message: cacheMaintenance.message,
        stage: "cache-maintenance-warning"
      });
    }
    if (!deferCacheMaintenance) {
      await deletePreparedSaveRef(runCommand, context, operationId, {
        commandOptions,
        project
      });
    }
    return completedSessionWorkSave(
      context,
      checkpoint,
      prepared,
      verifiedCommit,
      { cacheMaintenance, ...reconciliation }
    );
  }, {
    operation: `save-session:${context.sessionId}`
  });
}

async function prepareSessionWorkSaveMessage({
  commandOptions = {},
  derivedArtifactPaths = [],
  limit = 40,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  return runSessionWorkOperation({
    commandOptions,
    context,
    input: { derivedArtifactPaths, limit },
    label: "Capturing work for Save",
    operation: "save-message",
    operationId,
    project,
    runCommand
  });
}

async function saveSessionWork({
  checkpoint = {},
  commandOptions = {},
  derivedArtifactPaths = [],
  identity = {},
  message = "",
  onCacheMaintenance = async () => null,
  operationId = crypto.randomUUID(),
  project = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  onProgress = async () => null,
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const saved = await runProjectSourceExclusive(async () => {
    await onProgress({
      checkpointCommit: text(checkpoint.checkpointCommit),
      checkpointTree: text(checkpoint.checkpointTree),
      kind: "publish",
      message: "Publishing the captured work.",
      operationId,
      sessionHead: text(checkpoint.sessionHead),
      stage: "publishing"
    });
    return runSessionWorkOperation({
      commandOptions,
      context,
      input: {
        checkpoint,
        derivedArtifactPaths,
        identity,
        message
      },
      label: "Saving session work",
      operation: "save",
      operationId,
      project,
      runCommand
    });
  }, {
    operation: `save-session:${context.sessionId}`
  });
  if (context.mode === PROJECT_REPOSITORY_MODE_GITHUB) {
    queueMicrotask(() => {
      void runSessionWorkOperation({
        commandOptions,
        context,
        input: {
          operationId,
          verifiedCommit: saved.verifiedCommit
        },
        label: "Maintaining saved repository cache",
        operation: "save-maintenance",
        operationId,
        project,
        runCommand
      }).then(onCacheMaintenance).catch((error) => (
        onCacheMaintenance(failedCacheMaintenance(context, saved.verifiedCommit, error))
      )).catch(() => {});
    });
  }
  return saved;
}

async function recoverSessionWorkSave({
  commandOptions = {},
  project = {},
  recovery = {},
  runCommand = runVibe64Command,
  runProjectSourceExclusive = async (operation) => operation(),
  session = {}
} = {}) {
  const context = repositoryContext(session, project);
  const operationId = text(recovery.operationId);
  runCommand = scopedSessionWorkCommand(runCommand, context, project, {
    label: "Recovering session save",
    operationId: operationId || crypto.randomUUID()
  });
  const preparedRef = operationId ? preparedSaveRef(context, operationId) : "";
  const recordedProposedCommit = preparedRef
    ? await optionalGitOutput(runCommand, context, ["rev-parse", "--verify", `${preparedRef}^{commit}`], {
        commandOptions,
        project
      })
    : "";
  const proposedCommit = text(recovery.proposedCommit) || recordedProposedCommit;
  if (
    text(recovery.proposedCommit) &&
    recordedProposedCommit &&
    text(recovery.proposedCommit) !== recordedProposedCommit
  ) {
    throw saveError(
      "The interrupted Save has inconsistent prepared-commit evidence.",
      "vibe64_session_save_recovery_evidence_invalid"
    );
  }
  const expectedCanonicalCommit = text(recovery.expectedCanonicalCommit) || (
    proposedCommit
      ? await optionalGitOutput(runCommand, context, ["rev-parse", "--verify", `${proposedCommit}^`], {
          commandOptions,
          project
        })
      : ""
  );
  const recordedCheckpointCommit = operationId
    ? await optionalGitOutput(runCommand, context, [
        "rev-parse",
        "--verify",
        `${saveCheckpointRef(context, operationId)}^{commit}`
      ], { commandOptions, project })
    : "";
  const checkpointCommit = text(recovery.checkpointCommit) || recordedCheckpointCommit;
  const checkpointTree = text(recovery.checkpointTree) || (
    checkpointCommit
      ? await optionalGitOutput(runCommand, context, ["rev-parse", "--verify", `${checkpointCommit}^{tree}`], {
          commandOptions,
          project
        })
      : ""
  );
  if (!operationId || !expectedCanonicalCommit || !proposedCommit || !checkpointCommit || !checkpointTree) {
    throw saveError(
      "The interrupted Save stopped before a publishable commit was durably prepared. Retry Save.",
      "vibe64_session_save_interrupted_retryable",
      { retryable: true }
    );
  }
  if (await commitTree(runCommand, context, checkpointCommit, { commandOptions, project }) !== checkpointTree) {
    throw saveError(
      "The interrupted Save has inconsistent checkpoint evidence.",
      "vibe64_session_save_recovery_evidence_invalid"
    );
  }
  return runProjectSourceExclusive(async () => {
    const authorityCommit = await currentCanonicalCommit(
      runCommand,
      context,
      operationId,
      { commandOptions, project }
    );
    if (authorityCommit === expectedCanonicalCommit) {
      throw saveError(
        "The interrupted Save did not publish. Retry Save when ready.",
        "vibe64_session_save_interrupted_retryable",
        { retryable: true }
      );
    }
    if (authorityCommit !== proposedCommit) {
      throw saveError(
        "Canonical history advanced while the interrupted Save was being recovered.",
        "vibe64_session_save_authority_advanced",
        { authorityCommit, expectedCanonicalCommit, proposedCommit }
      );
    }
    const cacheMaintenance = await refreshVerifiedGithubMirror(
      runCommand,
      context,
      proposedCommit,
      { commandOptions, project }
    );
    const reconciliation = await reconcileSession(runCommand, context, {
      checkpointCommit,
      checkpointTree,
      commandOptions,
      project,
      saveCommit: proposedCommit,
      sessionHead: text(recovery.sessionHead)
    });
    return {
      ...recovery,
      authorityCommit,
      cacheMaintenance,
      ok: true,
      recovered: true,
      preparedRef,
      saveCommit: proposedCommit,
      status: reconciliation.status,
      verifiedCommit: proposedCommit,
      ...reconciliation
    };
  }, {
    operation: `recover-save-session:${context.sessionId}`
  });
}

export {
  checkSessionUpdates,
  checkSessionUpdatesDirect,
  exactFileDiffPathspecs,
  inspectSessionChangeDiff,
  inspectSessionChangeDiffDirect,
  inspectSessionChanges,
  inspectSessionChangesDirect,
  inspectSessionWork,
  inspectSessionWorkDirect,
  parseGitNameStatusZ,
  parseGitNumstatZ,
  prepareSessionWorkSaveMessage,
  prepareSessionWorkSaveMessageDirect,
  repositoryUpdateRelationship,
  repositoryUpdateStrategy,
  recoverSessionWorkSave,
  recoverSessionWorkUpdate,
  refreshSessionWorkSaveCacheDirect,
  repositoryContext,
  safeChangePath,
  saveSessionWork,
  saveSessionWorkDirect,
  updateSessionWork
};
